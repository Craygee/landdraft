import { createPrintPreviewPdf } from "@/lib/gis/printPreviewPdf";
import { downloadFile } from "@/lib/gis/export";
import {
  addAnalysisToComposition,
  analysisPrintFrame,
  analysisKind,
  printAnalysisPanels,
  svgDataUrl,
} from "@/lib/gis/analysisArtifacts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Archive,
  Crosshair,
  LocateFixed,
  MapPin,
  Maximize2,
  MessageSquareText,
  Minus,
  Move,
  Printer,
  RotateCcw,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import {
  Map as MlMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type ImageSource,
} from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";

import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import { getBasemap, getBasemapStyle } from "@/lib/gis/basemaps";
import { allLayerIds, buildLayerSpecs, sourceId } from "@/lib/gis/mapStyle";
import { composeLabel } from "@/lib/gis/labels";
import type {
  GisLayer,
  PrintAnnotation,
  PrintComposition,
  PrintFurnitureCorner,
  PrintFurnitureKey,
} from "@/lib/gis/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { createMapSnapshotBlob } from "@/lib/gis/mapPdf";
import { uploadProjectAsset } from "@/lib/gis/projectRecords";
import { PRINT_PAPER_OPTIONS, printPageGeometry } from "@/lib/gis/printLayout";
import { PrintLegend } from "./PrintLegend";
import { buildParcelLabels, isParcelLayer, parcelLabelSourceId } from "@/lib/gis/parcelDisplay";

const uid = () => window.crypto.randomUUID();

const defaultPrintFrame = (
  paper: PrintComposition["paper"],
  orientation: PrintComposition["orientation"],
): PrintComposition["frame"] => {
  if (orientation === "portrait") return { x: 6, y: 10, width: 88, height: 86 };
  return paper === "legal"
    ? { x: 4, y: 12, width: 92, height: 82 }
    : { x: 4, y: 12, width: 92, height: 82 };
};

const defaultComposition = (
  projectName: string,
  layers: GisLayer[],
  view?: PrintComposition["mapView"],
): PrintComposition => ({
  title: projectName,
  subtitle: "",
  paper: "letter",
  orientation: "landscape",
  showTitle: true,
  showLegend: true,
  showCompass: true,
  showScale: false,
  showDate: false,
  showAttribution: true,
  showProjectNotes: false,
  frameBorder: true,
  frame: defaultPrintFrame("letter", "landscape"),
  furniture: {
    legend: { corner: "bottom-right", x: 82, y: 72 },
    compass: { corner: "top-right", x: 91, y: 11 },
    scale: { corner: "bottom-left", x: 14, y: 91 },
    attribution: { corner: "bottom-left", x: 28, y: 96 },
  },
  includedLayerIds: layers.filter((layer) => layer.visible).map((layer) => layer.id),
  legendItems: Object.fromEntries(
    layers.map((layer) => [layer.id, { visible: layer.visible, name: layer.name }]),
  ),
  annotations: [],
  ...(view ? { mapView: view } : {}),
});

export function PrintComposer() {
  const wb = useWorkbench();
  const auth = useAuth();
  const {
    map: liveMap,
    lastPoint,
    setPrintOpen,
    pendingPrintAnalysisId,
    setPendingPrintAnalysisId,
  } = useMapRef();
  const liveView = liveMap
    ? {
        center: [liveMap.getCenter().lng, liveMap.getCenter().lat] as [number, number],
        zoom: liveMap.getZoom(),
        bearing: liveMap.getBearing(),
        pitch: liveMap.getPitch(),
      }
    : undefined;
  const [composition, setComposition] = useState<PrintComposition>(() => {
    const base = wb.printComposition ?? defaultComposition(wb.projectName, wb.displayLayers);
    const normalizedBase =
      base.annotations.length === 0 && base.frame.width < 75
        ? { ...base, frame: defaultPrintFrame(base.paper, base.orientation) }
        : base;
    const known = new Set(wb.displayLayers.map((layer) => layer.id));
    const included = normalizedBase.includedLayerIds.filter((id) => known.has(id));
    const legendItems = Object.fromEntries(
      wb.displayLayers.map((layer) => [
        layer.id,
        normalizedBase.legendItems?.[layer.id] ?? { visible: layer.visible, name: layer.name },
      ]),
    );
    const initial: PrintComposition = {
      ...defaultComposition(wb.projectName, wb.displayLayers, liveView),
      ...normalizedBase,
      furniture: {
        ...defaultComposition(wb.projectName, wb.displayLayers, liveView).furniture,
        ...(normalizedBase.furniture ?? {}),
      },
      ...((liveView ?? normalizedBase.mapView)
        ? { mapView: liveView ?? normalizedBase.mapView }
        : {}),
      includedLayerIds:
        included.length > 0
          ? included
          : wb.displayLayers.filter((layer) => layer.visible).map((layer) => layer.id),
      legendItems,
    };
    initial.showScale = false;
    initial.frame = analysisPrintFrame(initial.frame, Boolean(initial.analysisLayerIds?.length));
    return pendingPrintAnalysisId
      ? addAnalysisToComposition(initial, pendingPrintAnalysisId, wb.layers)
      : initial;
  });
  useEffect(() => {
    setPendingPrintAnalysisId(null);
  }, [setPendingPrintAnalysisId]);
  const analysisPanels = printAnalysisPanels(composition, wb.layers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState<
    null | { kind: "line" | "arrow"; start?: { x: number; y: number } } | { kind: "callout" }
  >(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLElement>(null);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const printMapRef = useRef<MlMap | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfAbort = useRef<AbortController | null>(null);
  useEffect(() => () => pdfAbort.current?.abort(), []);
  const markerRefs = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(liveView?.bearing ?? 0);
  const [mapRevision, setMapRevision] = useState(0);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [saveMapCopy, setSaveMapCopy] = useState(false);
  const [mapCopyFormat, setMapCopyFormat] = useState<"png" | "pdf">("pdf");
  const [fittedPageScale, setFittedPageScale] = useState(1);
  const [pageScaleOverride, setPageScaleOverride] = useState<number | null>(null);
  const setSavedComposition = wb.setPrintComposition;

  const pageGeometry = useMemo(
    () => printPageGeometry(composition.paper, composition.orientation),
    [composition.orientation, composition.paper],
  );
  const pagePreviewScale = pageScaleOverride ?? fittedPageScale;

  const selected = composition.annotations.find((item) => item.id === selectedId);
  const includedLayers = useMemo(
    () => wb.displayLayers.filter((layer) => composition.includedLayerIds.includes(layer.id)),
    [composition.includedLayerIds, wb.displayLayers],
  );
  const legendLayers = useMemo(
    () => wb.displayLayers.filter((layer) => composition.legendItems[layer.id]?.visible),
    [composition.legendItems, wb.displayLayers],
  );
  const printLegendNames = useMemo(
    () => legendLayers.map((layer) => composition.legendItems[layer.id]?.name || layer.name),
    [legendLayers, composition.legendItems],
  );
  const [printLegendSize, setPrintLegendSize] = useState({ width: 176, height: 100 });
  const selectedProjectNotes = wb.records.notes.filter((note) =>
    (composition.includedNoteIds !== undefined
      ? composition.includedNoteIds
      : wb.records.notes.filter((item) => item.includeInPacket).map((item) => item.id)
    ).includes(note.id),
  );
  const furnitureScale = Math.max(
    0.55,
    Math.min(1.12, Math.min(composition.frame.width / 90, composition.frame.height / 78)),
  );
  const update = useCallback((patch: Partial<PrintComposition>) => {
    setComposition((current) => {
      const next = { ...current, ...patch };
      return {
        ...next,
        frame: analysisPrintFrame(next.frame, Boolean(next.analysisLayerIds?.length)),
      };
    });
  }, []);

  const updateAnnotation = useCallback((id: string, patch: Partial<PrintAnnotation>) => {
    setComposition((current) => ({
      ...current,
      annotations: current.annotations.map((item) =>
        item.id === id ? ({ ...item, ...patch } as PrintAnnotation) : item,
      ),
    }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSavedComposition(composition), 500);
    return () => window.clearTimeout(timer);
  }, [composition, setSavedComposition]);

  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;
    const fitPage = () => {
      const styles = window.getComputedStyle(viewport);
      const availableWidth =
        viewport.clientWidth -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight) -
        4;
      const availableHeight =
        viewport.clientHeight -
        Number.parseFloat(styles.paddingTop) -
        Number.parseFloat(styles.paddingBottom) -
        4;
      const nextScale = Math.max(
        0.1,
        Math.min(
          1,
          availableWidth / pageGeometry.widthPixels,
          availableHeight / pageGeometry.heightPixels,
        ),
      );
      setFittedPageScale((current) =>
        Math.abs(current - nextScale) < 0.002 ? current : nextScale,
      );
    };
    fitPage();
    const observer = new ResizeObserver(fitPage);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [pageGeometry.heightPixels, pageGeometry.widthPixels]);

  useEffect(() => {
    if (!mapContainerRef.current || printMapRef.current) return;
    const view = composition.mapView;
    const map = new MlMap({
      container: mapContainerRef.current,
      style: getBasemapStyle(wb.basemapId),
      center: view?.center ?? [-98.5, 31.3],
      zoom: view?.zoom ?? 6,
      bearing: view?.bearing ?? 0,
      pitch: view?.pitch ?? 0,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-left");
    map.on("load", () => setMapReady(true));
    map.on("moveend", () => {
      const center = map.getCenter();
      setMapBearing(map.getBearing());
      setMapRevision((revision) => revision + 1);
      setComposition((current) => ({
        ...current,
        mapView: {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        },
      }));
    });
    printMapRef.current = map;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(mapContainerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      printMapRef.current = null;
    };
    // The print map is a snapshot and deliberately initializes only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = printMapRef.current;
    if (!map) return;
    const timer = window.setTimeout(() => {
      map.resize();
      setMapRevision((revision) => revision + 1);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [composition.frame, composition.orientation, composition.paper]);

  useEffect(() => {
    const map = printMapRef.current;
    if (!map || !mapReady) return;
    const keep = new Set(
      includedLayers.flatMap((layer) => [
        sourceId(`print-${layer.id}`),
        ...(isParcelLayer(layer) ? [parcelLabelSourceId(`print-${layer.id}`)] : []),
      ]),
    );
    for (const spec of map.getStyle().layers ?? []) {
      const sid = (spec as { source?: string }).source;
      if (
        sid &&
        (sid.startsWith("src-print-") || sid.startsWith("src-parcel-labels-print-")) &&
        !keep.has(sid)
      )
        map.removeLayer(spec.id);
    }
    for (const sid of Object.keys(map.getStyle().sources ?? {})) {
      if (
        (sid.startsWith("src-print-") || sid.startsWith("src-parcel-labels-print-")) &&
        !keep.has(sid)
      )
        map.removeSource(sid);
    }
    for (const layer of [...includedLayers].reverse()) {
      const printLayer: GisLayer = { ...layer, id: `print-${layer.id}` };
      const sid = sourceId(printLayer.id);
      const data: FeatureCollection =
        layer.style.labelUseLayerName || layer.style.labelTemplate.trim()
          ? {
              type: "FeatureCollection",
              features: layer.data.features.map((feature) => ({
                ...feature,
                properties: {
                  ...(feature.properties ?? {}),
                  __label: layer.style.labelUseLayerName
                    ? layer.name
                    : composeLabel(feature as never, layer.style.labelTemplate),
                },
              })) as Feature[],
            }
          : layer.data;
      if (isParcelLayer(printLayer)) {
        const labelSid = parcelLabelSourceId(printLayer.id);
        const labels = buildParcelLabels(printLayer, data);
        const labelSource = map.getSource(labelSid) as GeoJSONSource | undefined;
        if (labelSource) labelSource.setData(labels);
        else map.addSource(labelSid, { type: "geojson", data: labels });
      }
      const source = map.getSource(sid);
      if (layer.source.kind === "image") {
        if (source) (source as ImageSource).setCoordinates(layer.source.coordinates);
        else
          map.addSource(sid, {
            type: "image",
            url: layer.source.dataUrl,
            coordinates: layer.source.coordinates,
          });
      } else if (source) (source as GeoJSONSource).setData(data);
      else map.addSource(sid, { type: "geojson", data, generateId: true });
      for (const id of allLayerIds(printLayer.id)) if (map.getLayer(id)) map.removeLayer(id);
      for (const spec of buildLayerSpecs(printLayer, map)) map.addLayer(spec);
      for (const id of allLayerIds(printLayer.id))
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
    }
    const labelOrder = [...includedLayers]
      .reverse()
      .sort(
        (a, b) =>
          Number(Boolean(a.style.labelUseLayerName)) - Number(Boolean(b.style.labelUseLayerName)),
      );
    for (const layer of labelOrder) {
      for (const id of ["label-print-" + layer.id, "label-print-" + layer.id + "-lines"])
        if (map.getLayer(id)) map.moveLayer(id);
    }
  }, [includedLayers, mapReady]);

  useEffect(() => {
    const map = printMapRef.current;
    if (!map || !mapReady) return;
    for (const marker of markerRefs.current) marker.remove();
    markerRefs.current = composition.annotations
      .filter(
        (item): item is Extract<PrintAnnotation, { type: "marker" }> => item.type === "marker",
      )
      .map((item) => {
        const element = document.createElement("button");
        element.className = "print-map-marker";
        element.style.setProperty("--marker-color", item.color);
        element.title = item.label;
        const coordinates =
          item.coordinateFormat === "dms" ? formatDmsGps(item) : formatDecimalGps(item);
        element.innerHTML = `<span></span><b>${item.gpsOnly ? coordinates : escapeHtml(item.label)}${
          item.showCoordinates && !item.gpsOnly ? `<small>${coordinates}</small>` : ""
        }</b>`;
        element.onclick = () => setSelectedId(item.id);
        const marker = new Marker({ element, anchor: "bottom", draggable: true })
          .setLngLat([item.lng, item.lat])
          .addTo(map);
        marker.on("dragend", () => {
          const lngLat = marker.getLngLat();
          updateAnnotation(item.id, { lng: lngLat.lng, lat: lngLat.lat });
        });
        return marker;
      });
    return () => {
      for (const marker of markerRefs.current) marker.remove();
      markerRefs.current = [];
    };
  }, [composition.annotations, mapReady, updateAnnotation]);

  const addAnnotation = (type: "text" | "line" | "arrow") => {
    const item: PrintAnnotation =
      type === "text"
        ? {
            id: uid(),
            type,
            x: 45,
            y: 45,
            text: "Map note",
            textColor: "#17221a",
            backgroundColor: "#ffffff",
            font: "Inter",
            fontSize: 14,
          }
        : {
            id: uid(),
            type,
            x: 35,
            y: 50,
            x2: 62,
            y2: 50,
            color: "#b0453a",
            width: 3,
          };
    update({ annotations: [...composition.annotations, item] });
    setSelectedId(item.id);
  };

  const pointOnPage = (clientX: number, clientY: number) => {
    const page = pageRef.current;
    if (!page) return null;
    const rect = page.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const pointOnMapFrame = (clientX: number, clientY: number) => {
    const frame = mapFrameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(92, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(6, Math.min(94, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const setFurnitureCorner = (key: PrintFurnitureKey, corner: PrintFurnitureCorner) => {
    update({
      furniture: {
        ...composition.furniture,
        [key]: { ...composition.furniture[key], corner },
      },
    });
  };

  const startFurnitureDrag = (event: React.PointerEvent, key: PrintFurnitureKey) => {
    event.preventDefault();
    event.stopPropagation();
    const move = (pointerEvent: PointerEvent) => {
      const point = pointOnMapFrame(pointerEvent.clientX, pointerEvent.clientY);
      if (!point) return;
      setComposition((current) => ({
        ...current,
        furniture: {
          ...current.furniture,
          [key]: { corner: "custom", x: point.x, y: point.y },
        },
      }));
    };
    move(event.nativeEvent);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const startPointDrag = (
    event: React.PointerEvent,
    item: Extract<PrintAnnotation, { type: "line" | "arrow" }>,
    endpoint: "start" | "end" | "whole",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(item.id);
    const origin = pointOnPage(event.clientX, event.clientY);
    if (!origin) return;
    const initial = { x: item.x, y: item.y, x2: item.x2, y2: item.y2 };
    const move = (pointerEvent: PointerEvent) => {
      const point = pointOnPage(pointerEvent.clientX, pointerEvent.clientY);
      if (!point) return;
      if (endpoint === "start") updateAnnotation(item.id, { x: point.x, y: point.y });
      else if (endpoint === "end") updateAnnotation(item.id, { x2: point.x, y2: point.y });
      else {
        const dx = point.x - origin.x;
        const dy = point.y - origin.y;
        updateAnnotation(item.id, {
          x: Math.max(0, Math.min(100, initial.x + dx)),
          y: Math.max(0, Math.min(100, initial.y + dy)),
          x2: Math.max(0, Math.min(100, initial.x2 + dx)),
          y2: Math.max(0, Math.min(100, initial.y2 + dy)),
        });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const startBoxDrag = (
    event: React.PointerEvent,
    item: Extract<PrintAnnotation, { type: "text" | "callout" }>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(item.id);
    const origin = pointOnPage(event.clientX, event.clientY);
    if (!origin) return;
    const initial = { x: item.x, y: item.y };
    const move = (pointerEvent: PointerEvent) => {
      const point = pointOnPage(pointerEvent.clientX, pointerEvent.clientY);
      if (!point) return;
      updateAnnotation(item.id, {
        x: Math.max(0, Math.min(100, initial.x + point.x - origin.x)),
        y: Math.max(0, Math.min(100, initial.y + point.y - origin.y)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const calloutTarget = useCallback(
    (item: Extract<PrintAnnotation, { type: "callout" }>) => {
      void mapRevision;
      const map = printMapRef.current;
      const mapElement = mapContainerRef.current;
      if (!map || !mapElement) return { x: 50, y: 50 };
      const point = map.project([item.lng, item.lat]);
      return {
        x:
          composition.frame.x +
          (point.x / Math.max(1, mapElement.clientWidth)) * composition.frame.width,
        y:
          composition.frame.y +
          (point.y / Math.max(1, mapElement.clientHeight)) * composition.frame.height,
      };
    },
    [composition.frame, mapRevision],
  );

  const arrangeCallouts = (annotations: PrintAnnotation[], map: MlMap): PrintAnnotation[] => {
    const callouts = annotations.filter(
      (item): item is Extract<PrintAnnotation, { type: "callout" }> => item.type === "callout",
    );
    const centerLng = map.getCenter().lng;
    const left = callouts.filter((item) => item.lng <= centerLng).sort((a, b) => b.lat - a.lat);
    const right = callouts.filter((item) => item.lng > centerLng).sort((a, b) => b.lat - a.lat);
    const positions = new Map<string, { x: number; y: number }>();
    const place = (items: typeof callouts, x: number) =>
      items.forEach((item, index) =>
        positions.set(item.id, {
          x,
          y: 20 + ((index + 1) / (items.length + 1)) * 68,
        }),
      );
    place(left, 8);
    place(right, 92);
    return annotations.map((item) => {
      if (item.type !== "callout") return item;
      return { ...item, ...(positions.get(item.id) ?? { x: 8, y: 50 }) };
    });
  };

  const handlePlacement = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!placementMode) return;
    const point = pointOnPage(event.clientX, event.clientY);
    if (!point) return;
    if (placementMode.kind === "line" || placementMode.kind === "arrow") {
      if (!placementMode.start) {
        setPlacementMode({ ...placementMode, start: point });
        return;
      }
      const item: PrintAnnotation = {
        id: uid(),
        type: placementMode.kind,
        x: placementMode.start.x,
        y: placementMode.start.y,
        x2: point.x,
        y2: point.y,
        color: "#b0453a",
        width: 3,
      };
      update({ annotations: [...composition.annotations, item] });
      setSelectedId(item.id);
      setPlacementMode(null);
      return;
    }
    const map = printMapRef.current;
    const mapElement = mapContainerRef.current;
    if (!map || !mapElement) return;
    const rect = mapElement.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    const lngLat = map.unproject([
      ((event.clientX - rect.left) / rect.width) * mapElement.clientWidth,
      ((event.clientY - rect.top) / rect.height) * mapElement.clientHeight,
    ]);
    const item: PrintAnnotation = {
      id: uid(),
      type: "callout",
      lng: lngLat.lng,
      lat: lngLat.lat,
      x: lngLat.lng <= map.getCenter().lng ? 8 : 92,
      y: point.y,
      text: "Location note",
      color: "#b0453a",
      backgroundColor: "#ffffff",
      textColor: "#17221a",
      contentMode: "label",
    };
    const annotations = arrangeCallouts([...composition.annotations, item], map);
    const bounds = map.getBounds();
    bounds.extend([lngLat.lng, lngLat.lat]);
    update({
      annotations,
      frame: { ...composition.frame, x: 8, width: 84 },
    });
    setSelectedId(item.id);
    setPlacementMode(null);
    window.setTimeout(() => {
      map.resize();
      map.fitBounds(bounds, { padding: 55, maxZoom: map.getZoom(), duration: 450 });
    }, 120);
  };

  const addMarker = (
    point?: { lng: number; lat: number } | null,
    gpsOnly = false,
    coordinateFormat: "decimal" | "dms" = "decimal",
  ) => {
    const center = printMapRef.current?.getCenter();
    const location = point ?? (center ? { lng: center.lng, lat: center.lat } : null);
    if (!location) return;
    const item: PrintAnnotation = {
      id: uid(),
      type: "marker",
      lng: location.lng,
      lat: location.lat,
      label: point ? "GPS location" : "Map marker",
      color: "#c9832c",
      showCoordinates: Boolean(point),
      gpsOnly,
      coordinateFormat,
    };
    update({ annotations: [...composition.annotations, item] });
    setSelectedId(item.id);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    update({ annotations: composition.annotations.filter((item) => item.id !== selectedId) });
    setSelectedId(null);
  };

  const resetView = () => {
    if (!liveMap || !printMapRef.current) return;
    printMapRef.current.jumpTo({
      center: liveMap.getCenter(),
      zoom: liveMap.getZoom(),
      bearing: liveMap.getBearing(),
      pitch: liveMap.getPitch(),
    });
  };

  const resetFrame = () => {
    update({ frame: defaultPrintFrame(composition.paper, composition.orientation) });
    window.setTimeout(() => printMapRef.current?.resize(), 90);
  };

  const close = () => {
    setSavedComposition(composition);
    setPrintOpen(false);
  };

  const saveMapToRecords = async () => {
    if (!wb.canEditProject) return;
    const map = printMapRef.current;
    if (!map) throw new Error("The print map is not ready yet");
    if (!auth.user) throw new Error("Sign in before saving a map to Project records");
    const blob = await createMapSnapshotBlob(map, mapCopyFormat, analysisPanels);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${composition.title || wb.projectName}-${stamp}.${mapCopyFormat}`;
    const document = await uploadProjectAsset({
      userId: auth.user.id,
      projectId: wb.projectId,
      folderId: "maps",
      fileName,
      data: blob,
      source: "map",
      uploadedBy: auth.user.name || auth.user.email,
    });
    wb.setProjectRecords({
      ...wb.records,
      documents: [document, ...wb.records.documents],
    });
    wb.addProjectEvent({
      type: "map",
      title: `Saved map ${fileName}`,
      detail: "Stored in Project records / Maps",
      relatedId: document.id,
    });
    window.setTimeout(() => void wb.saveProject("manual"), 300);
    toast.success("Map saved to Project records / Maps");
  };

  const saveMapToRecordsSafely = async () => {
    try {
      await saveMapToRecords();
    } catch (error) {
      toast.error("The map copy could not be stored", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    }
  };

  const printMap = () => {
    // Safari requires print() in the original tap handler, before any await.
    // Optional cloud storage must never consume the browser's user activation.
    if (saveMapCopy) void saveMapToRecordsSafely();
    try {
      window.print();
      toast.info("If no print dialog opens, use Quick PDF beside Print.", { duration: 12000 });
    } catch (error) {
      toast.error("This browser could not open printing. Use Quick PDF.", {
        description: error instanceof Error ? error.message : "Open in Safari for system printing.",
      });
    }
  };

  const quickPdf = async () => {
    const map = printMapRef.current;
    const page = pageRef.current;
    if (!map || !mapReady || !page) {
      toast.error("Wait for the print map to load.");
      return;
    }
    if (pdfAbort.current) return;
    const abort = new AbortController();
    pdfAbort.current = abort;
    setPdfBusy(true);
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      map.triggerRepaint();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const blob = await createPrintPreviewPdf(
        page,
        composition.paper,
        composition.orientation,
        abort.signal,
      );
      const name = (composition.title || wb.projectName || "LandDraft_map")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .slice(0, 100);
      downloadFile(blob, `${name}.pdf`);
    } catch (error) {
      if (page.isConnected)
        toast.error("PDF could not be created", {
          description:
            error instanceof Error
              ? error.message
              : "Wait for preview images to finish loading, then retry.",
        });
    } finally {
      window.clearTimeout(timeout);
      pdfAbort.current = null;
      setPdfBusy(false);
    }
  };

  const furnitureKeys: PrintFurnitureKey[] = ["legend", "compass", "attribution"];
  const furnitureVisible = (key: PrintFurnitureKey) =>
    key === "legend"
      ? composition.showLegend
      : key === "compass"
        ? composition.showCompass
        : composition.showAttribution;

  const furnitureContent = (key: PrintFurnitureKey) => {
    if (key === "legend")
      return (
        <PrintLegend
          layers={legendLayers}
          names={printLegendNames}
          groups={wb.groups}
          grouped={composition.legendGroupLabels !== false}
          onSize={setPrintLegendSize}
        />
      );
    if (key === "compass") return <Compass bearing={mapBearing} scale={furnitureScale} />;
    return (
      <div
        className="max-w-[52cqw] rounded bg-white/85 px-1.5 py-1 leading-tight text-slate-600 shadow-sm"
        style={{ fontSize: `${Math.max(6, 8 * furnitureScale)}px` }}
      >
        {getBasemap(wb.basemapId).blurb}
      </div>
    );
  };

  return (
    <div className="app-overlay-viewport print-composer fixed inset-0 z-[100] flex flex-col bg-[#e9e8e2] text-foreground">
      <style media="print">{`
        @page { size: ${pageGeometry.cssWidth} ${pageGeometry.cssHeight}; margin: 0; }
        html, body { width: ${pageGeometry.cssWidth} !important; height: ${pageGeometry.cssHeight} !important; margin: 0 !important; padding: 0 !important; }
        .print-composer { width: ${pageGeometry.cssWidth} !important; height: ${pageGeometry.cssHeight} !important; }
      `}</style>
      <header className="print-composer-ui flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-3">
        <button
          onClick={close}
          className="rounded-xl p-2 hover:bg-accent"
          aria-label="Close print preview"
        >
          <X className="size-4" />
        </button>
        <div className="hidden shrink-0 sm:block">
          <h1 className="text-sm font-bold">Print map</h1>
          <p className="text-[10px] text-muted-foreground">
            A saved composition—your project map stays unchanged
          </p>
        </div>
        <div
          data-tour="print-tools"
          className="ml-auto flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          <ComposerButton icon={<Type />} label="Text" onClick={() => addAnnotation("text")} />
          <ComposerButton
            icon={<Minus />}
            label="Line"
            active={placementMode?.kind === "line"}
            onClick={() => setPlacementMode({ kind: "line" })}
          />
          <ComposerButton
            icon={<ArrowRight />}
            label="Arrow"
            active={placementMode?.kind === "arrow"}
            onClick={() => setPlacementMode({ kind: "arrow" })}
          />
          <ComposerButton
            icon={<MessageSquareText />}
            label="Callout"
            active={placementMode?.kind === "callout"}
            onClick={() => setPlacementMode({ kind: "callout" })}
          />
          <ComposerButton icon={<MapPin />} label="Marker" onClick={() => addMarker()} />
          <ComposerButton
            icon={<Crosshair />}
            label="Decimal GPS"
            onClick={() => {
              const center = printMapRef.current?.getCenter();
              const point = lastPoint ?? (center ? { lng: center.lng, lat: center.lat } : null);
              addMarker(point, true);
            }}
          />
          <ComposerButton
            icon={<LocateFixed />}
            label="DMS GPS"
            onClick={() => {
              const center = printMapRef.current?.getCenter();
              const point = lastPoint ?? (center ? { lng: center.lng, lat: center.lat } : null);
              addMarker(point, true, "dms");
            }}
          />
          <ComposerButton icon={<RotateCcw />} label="Project view" onClick={resetView} />
          {wb.canEditProject && (
            <ComposerButton
              icon={<Archive />}
              label="Save to Maps"
              onClick={() => void saveMapToRecordsSafely()}
            />
          )}
        </div>
        <button
          onClick={() => setMobileSettingsOpen((value) => !value)}
          aria-expanded={mobileSettingsOpen}
          className="shrink-0 rounded-xl bg-secondary px-2 py-2 text-xs md:hidden"
        >
          Settings
        </button>
        <button
          onClick={printMap}
          data-tour="print-output"
          className="ml-1 flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
        >
          <Printer className="size-4" /> Print
        </button>
        <button
          onClick={() => void quickPdf()}
          disabled={pdfBusy}
          title="Download the complete preview as PDF, including titles, notes, annotations, legend and reports."
          className="shrink-0 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold"
        >
          {pdfBusy ? "Creating PDF…" : "Quick PDF"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          data-tour="print-settings"
          className={cn(
            "print-composer-ui w-64 shrink-0 overflow-y-auto border-r border-border bg-card p-3 text-xs",
            mobileSettingsOpen
              ? "absolute inset-y-14 left-0 z-30 max-w-[85vw] shadow-xl md:static md:max-w-none md:shadow-none"
              : "hidden md:block",
          )}
        >
          <h2 className="mb-2 font-semibold">Page</h2>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={composition.paper}
              onChange={(paper) => {
                const nextPaper = paper as PrintComposition["paper"];
                setPageScaleOverride(null);
                update({
                  paper: nextPaper,
                  frame: defaultPrintFrame(nextPaper, composition.orientation),
                });
              }}
              options={PRINT_PAPER_OPTIONS}
            />
            <Select
              value={composition.orientation}
              onChange={(orientation) => {
                const nextOrientation = orientation as PrintComposition["orientation"];
                setPageScaleOverride(null);
                update({
                  orientation: nextOrientation,
                  frame: defaultPrintFrame(composition.paper, nextOrientation),
                });
              }}
              options={["landscape", "portrait"]}
            />
          </div>
          <div className="mt-2 rounded-xl border border-border bg-secondary/60 p-2">
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() =>
                  setPageScaleOverride(
                    Math.max(0.1, Math.round((pagePreviewScale - 0.1) * 100) / 100),
                  )
                }
                className="rounded-lg bg-card p-1.5 hover:bg-accent disabled:opacity-40"
                aria-label="Zoom page preview out"
                title="Zoom the page preview out"
                disabled={pagePreviewScale <= 0.1}
              >
                <ZoomOut className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPageScaleOverride(null)}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold hover:bg-accent",
                  pageScaleOverride === null ? "bg-primary text-primary-foreground" : "bg-card",
                )}
                aria-label="Fit the whole page in the preview"
                title="Fit the entire paper inside the available preview area"
              >
                <Maximize2 className="size-3" /> Fit page · {Math.round(pagePreviewScale * 100)}%
              </button>
              <button
                type="button"
                onClick={() =>
                  setPageScaleOverride(
                    Math.min(1.5, Math.round((pagePreviewScale + 0.1) * 100) / 100),
                  )
                }
                className="rounded-lg bg-card p-1.5 hover:bg-accent disabled:opacity-40"
                aria-label="Zoom page preview in"
                title="Zoom the page preview in"
                disabled={pagePreviewScale >= 1.5}
              >
                <ZoomIn className="size-3.5" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[9px] text-muted-foreground">
              {pageGeometry.label} · {pageGeometry.displayDimensions} · {composition.orientation}
            </p>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            Output: {pageGeometry.label} · {pageGeometry.displayDimensions}. In the system print
            dialog, use the same paper size and 100% scale for exact dimensions.
          </p>
          <Field label="Title" value={composition.title} onChange={(title) => update({ title })} />
          <Field
            label="Subtitle"
            value={composition.subtitle}
            onChange={(subtitle) => update({ subtitle })}
          />
          <div className="mt-3 grid grid-cols-2 gap-1">
            {(
              [
                ["showTitle", "Title"],
                ["showLegend", "Legend"],
                ["showCompass", "Compass"],
              ] as const
            ).map(([key, label]) => (
              <CheckOption
                key={key}
                checked={composition[key]}
                label={label}
                onChange={(checked) => update({ [key]: checked })}
              />
            ))}
          </div>

          <details className="group mt-3 rounded-xl border border-border">
            <summary className="cursor-pointer list-none px-3 py-2 font-semibold">
              Project notes & repository
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              <CheckOption
                checked={composition.showProjectNotes ?? false}
                label="Show selected notes on map"
                onChange={(showProjectNotes) => update({ showProjectNotes })}
              />
              {(composition.showProjectNotes ?? false) && (
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg bg-secondary p-2">
                  {wb.records.notes.map((note) => {
                    const checked = (
                      composition.includedNoteIds !== undefined
                        ? composition.includedNoteIds
                        : wb.records.notes
                            .filter((item) => item.includeInPacket)
                            .map((item) => item.id)
                    ).includes(note.id);
                    return (
                      <label key={note.id} className="flex items-center gap-2 text-[10px]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const current =
                              composition.includedNoteIds !== undefined
                                ? composition.includedNoteIds
                                : wb.records.notes
                                    .filter((item) => item.includeInPacket)
                                    .map((item) => item.id);
                            update({
                              includedNoteIds: event.target.checked
                                ? Array.from(new Set([...current, note.id]))
                                : current.filter((id) => id !== note.id),
                            });
                          }}
                          className="accent-primary"
                        />
                        <span className="truncate">{note.title}</span>
                      </label>
                    );
                  })}
                  {!wb.records.notes.length && (
                    <p className="text-[10px] text-muted-foreground">
                      Add notes in Project records first.
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <CheckOption
                  checked={saveMapCopy}
                  label="Save copy to Maps when printing"
                  onChange={setSaveMapCopy}
                />
                <select
                  value={mapCopyFormat}
                  onChange={(event) => setMapCopyFormat(event.target.value as "png" | "pdf")}
                  className="rounded-lg border border-border bg-card px-2 text-[10px]"
                  aria-label="Saved map format"
                >
                  <option value="pdf">PDF</option>
                  <option value="png">PNG</option>
                </select>
              </div>
            </div>
          </details>

          <details className="group mt-3 rounded-xl border border-border">
            <summary className="cursor-pointer list-none px-3 py-2 font-semibold">
              Map item placement
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              <p className="text-[9px] leading-relaxed text-muted-foreground">
                Choose a corner or drag an item directly on the map. Items assigned to the same
                corner stack automatically.
              </p>
              <FurniturePlacementControl
                label="Legend"
                value={composition.furniture.legend.corner}
                onChange={(corner) => setFurnitureCorner("legend", corner)}
              />
              <FurniturePlacementControl
                label="Compass"
                value={composition.furniture.compass.corner}
                onChange={(corner) => setFurnitureCorner("compass", corner)}
              />
              <FurniturePlacementControl
                label="Source credit"
                value={composition.furniture.attribution.corner}
                onChange={(corner) => setFurnitureCorner("attribution", corner)}
              />
            </div>
          </details>

          <section className="space-y-2 rounded-xl border p-3">
            <h3 className="font-semibold">Analysis reports</h3>
            <p className="text-xs">
              Add one saved Buildable Area report and one elevation profile. The map frame leaves
              room below.
            </p>
            {wb.layers
              .filter((l) => analysisKind(l))
              .map((l) => (
                <label key={l.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={composition.analysisLayerIds?.includes(l.id) ?? false}
                    onChange={(e) =>
                      setComposition((c) =>
                        e.target.checked
                          ? addAnalysisToComposition(c, l.id, wb.layers)
                          : {
                              ...c,
                              analysisLayerIds: (c.analysisLayerIds ?? []).filter(
                                (id) => id !== l.id,
                              ),
                            },
                      )
                    }
                  />
                  {l.name}
                </label>
              ))}
          </section>
          <details className="group mt-3 rounded-xl border border-border">
            <summary className="cursor-pointer list-none px-3 py-2 font-semibold">
              Map layers
            </summary>
            <div className="space-y-1 border-t border-border p-2">
              <label className="flex items-center gap-2 px-1 py-2 text-xs">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={composition.legendGroupLabels !== false}
                  onChange={(event) => update({ legendGroupLabels: event.target.checked })}
                />
                List legend layers under group labels
              </label>
              <div className="grid grid-cols-[auto_auto_1fr] gap-2 px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Map</span>
                <span>Key</span>
                <span>Legend name</span>
              </div>
              {wb.displayLayers.map((layer) => (
                <div
                  key={layer.id}
                  className="grid grid-cols-[auto_auto_1fr] items-center gap-2 rounded-lg p-1.5 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={composition.includedLayerIds.includes(layer.id)}
                    onChange={(event) =>
                      update({
                        includedLayerIds: event.target.checked
                          ? [...composition.includedLayerIds, layer.id]
                          : composition.includedLayerIds.filter((id) => id !== layer.id),
                      })
                    }
                    className="accent-primary"
                    aria-label={`Show ${layer.name} on print map`}
                  />
                  <input
                    type="checkbox"
                    checked={composition.legendItems[layer.id]?.visible ?? false}
                    onChange={(event) =>
                      update({
                        legendItems: {
                          ...composition.legendItems,
                          [layer.id]: {
                            visible: event.target.checked,
                            name: composition.legendItems[layer.id]?.name ?? layer.name,
                          },
                        },
                      })
                    }
                    className="accent-primary"
                    aria-label={`Show ${layer.name} in legend`}
                  />
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-3 rounded-sm"
                      style={{ background: layer.style.fillColor }}
                    />
                    <input
                      value={composition.legendItems[layer.id]?.name ?? layer.name}
                      onChange={(event) =>
                        update({
                          legendItems: {
                            ...composition.legendItems,
                            [layer.id]: {
                              visible: composition.legendItems[layer.id]?.visible ?? true,
                              name: event.target.value,
                            },
                          },
                        })
                      }
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-primary focus:bg-card"
                      aria-label={`Legend name for ${layer.name}`}
                    />
                  </div>
                </div>
              ))}
              <p className="px-1 pt-1 text-[9px] leading-relaxed text-muted-foreground">
                Map and legend are independent. A layer can appear in either, both, or neither.
              </p>
            </div>
          </details>

          <details className="group mt-2 rounded-xl border border-border">
            <summary className="cursor-pointer list-none px-3 py-2 font-semibold">
              Advanced layout
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              <Range
                label="Map width"
                value={composition.frame.width}
                min={35}
                max={96}
                onChange={(width) => update({ frame: { ...composition.frame, width } })}
              />
              <Range
                label="Map height"
                value={composition.frame.height}
                min={30}
                max={86}
                onChange={(height) => update({ frame: { ...composition.frame, height } })}
              />
              <Range
                label="Map left"
                value={composition.frame.x}
                min={0}
                max={60}
                onChange={(x) => update({ frame: { ...composition.frame, x } })}
              />
              <Range
                label="Map top"
                value={composition.frame.y}
                min={4}
                max={55}
                onChange={(y) => update({ frame: { ...composition.frame, y } })}
              />
              <CheckOption
                checked={composition.frameBorder}
                label="Frame border"
                onChange={(frameBorder) => update({ frameBorder })}
              />
              <CheckOption
                checked={composition.showDate}
                label="Print date"
                onChange={(showDate) => update({ showDate })}
              />
              <CheckOption
                checked={composition.showAttribution}
                label="Source credits"
                onChange={(showAttribution) => update({ showAttribution })}
              />
            </div>
          </details>

          <div className="mt-3 grid grid-cols-2 gap-1">
            <button
              onClick={() =>
                update({
                  annotations: composition.annotations.filter((item) => item.type === "marker"),
                })
              }
              className="rounded-lg bg-secondary px-2 py-2 text-[10px] font-medium"
            >
              Clear overlays
            </button>
            <button
              onClick={() =>
                update({
                  annotations: composition.annotations.filter((item) => item.type !== "marker"),
                })
              }
              className="rounded-lg bg-secondary px-2 py-2 text-[10px] font-medium"
            >
              Clear markers
            </button>
            <button
              data-tour="print-reset"
              onClick={resetFrame}
              className="col-span-2 flex items-center justify-center gap-1 rounded-lg border border-border px-2 py-2 text-[10px] font-medium hover:bg-accent"
            >
              <RotateCcw className="size-3" /> Reset map size & position
            </button>
            <button
              onClick={() =>
                update({
                  annotations: [],
                  analysisLayerIds: [],
                  frame: defaultPrintFrame(composition.paper, composition.orientation),
                })
              }
              className="col-span-2 rounded-lg border border-destructive/30 px-2 py-2 text-[10px] font-medium text-destructive"
            >
              Clear all print additions
            </button>
          </div>
        </aside>

        <main ref={previewViewportRef} className="min-w-0 flex-1 overflow-auto p-6">
          {placementMode && (
            <div className="print-composer-ui sticky top-0 z-50 mx-auto mb-2 w-fit rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-float">
              {placementMode.kind === "callout"
                ? "Click the map feature or location to label"
                : placementMode.start
                  ? "Click the end point"
                  : "Click the start point"}
              <button
                onClick={() => setPlacementMode(null)}
                className="ml-3 opacity-80 hover:opacity-100"
              >
                Cancel
              </button>
            </div>
          )}
          <div
            className="print-composer-stage relative mx-auto overflow-hidden bg-white shadow-2xl"
            style={{
              width: `${pageGeometry.widthPixels * pagePreviewScale}px`,
              height: `${pageGeometry.heightPixels * pagePreviewScale}px`,
            }}
          >
            <div
              ref={pageRef}
              data-tour="print-page"
              className="print-composer-page relative overflow-hidden bg-white"
              style={
                {
                  width: `${pageGeometry.widthPixels}px`,
                  height: `${pageGeometry.heightPixels}px`,
                  transform: `scale(${pagePreviewScale})`,
                  transformOrigin: "top left",
                  "--print-page-width": pageGeometry.cssWidth,
                  "--print-page-height": pageGeometry.cssHeight,
                } as React.CSSProperties
              }
            >
              {composition.showTitle && (
                <div className="absolute inset-x-[5%] top-[3%] z-20 pointer-events-none">
                  <h2 className="text-center text-[clamp(16px,2.2vw,30px)] font-bold tracking-tight">
                    {composition.title}
                  </h2>
                  {composition.subtitle && (
                    <p className="mt-0.5 text-center text-[clamp(9px,1vw,14px)] text-slate-600">
                      {composition.subtitle}
                    </p>
                  )}
                </div>
              )}
              <div
                ref={mapFrameRef}
                data-print-map-frame
                className={cn(
                  "absolute overflow-hidden bg-slate-100 [container-type:inline-size]",
                  composition.frameBorder && "ring-1 ring-slate-700",
                )}
                style={{
                  left: `${composition.frame.x}%`,
                  top: `${composition.frame.y}%`,
                  width: `${composition.frame.width}%`,
                  height: `${composition.frame.height}%`,
                }}
              >
                <div ref={mapContainerRef} className="h-full w-full" />
                {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(
                  (corner) => {
                    const keys = furnitureKeys.filter(
                      (key) =>
                        furnitureVisible(key) && composition.furniture[key].corner === corner,
                    );
                    if (keys.length === 0) return null;
                    return (
                      <div
                        key={corner}
                        className={cn(
                          "pointer-events-none absolute z-20 flex gap-1.5",
                          corner.startsWith("top") ? "flex-col" : "flex-col-reverse",
                          corner.endsWith("left") ? "items-start" : "items-end",
                          corner === "top-left" && "left-2 top-12",
                          corner === "top-right" && "right-2 top-2",
                          corner === "bottom-left" && "bottom-2 left-2",
                          corner === "bottom-right" && "bottom-2 right-2",
                        )}
                      >
                        {keys.map((key) => (
                          <div
                            key={key}
                            className="pointer-events-auto cursor-move touch-none"
                            onPointerDown={(event) => startFurnitureDrag(event, key)}
                            title={`Drag ${furnitureLabel(key)} to place it anywhere`}
                          >
                            {furnitureContent(key)}
                          </div>
                        ))}
                      </div>
                    );
                  },
                )}
                {furnitureKeys
                  .filter(
                    (key) =>
                      furnitureVisible(key) && composition.furniture[key].corner === "custom",
                  )
                  .map((key) => (
                    <div
                      key={key}
                      className="pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none"
                      style={{
                        left:
                          key === "legend"
                            ? `clamp(${printLegendSize.width / 2 + 8}px, ${composition.furniture[key].x}%, calc(100% - ${printLegendSize.width / 2 + 8}px))`
                            : `${composition.furniture[key].x}%`,
                        top:
                          key === "legend"
                            ? `clamp(${printLegendSize.height / 2 + 8}px, ${composition.furniture[key].y}%, calc(100% - ${printLegendSize.height / 2 + 8}px))`
                            : `${composition.furniture[key].y}%`,
                      }}
                      onPointerDown={(event) => startFurnitureDrag(event, key)}
                      title={`Drag ${furnitureLabel(key)} to reposition it`}
                    >
                      {furnitureContent(key)}
                    </div>
                  ))}
              </div>

              {analysisPanels.length > 0 && (
                <div
                  className="absolute z-20 flex gap-2 bg-white"
                  style={{ left: "4%", top: "73%", width: "92%", height: "24%" }}
                >
                  {analysisPanels.map((p) => (
                    <img
                      key={p.id}
                      src={svgDataUrl(p.svg)}
                      alt={p.title}
                      className="h-full min-w-0 flex-1 border bg-white object-contain"
                    />
                  ))}
                </div>
              )}
              <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
                <defs>
                  <marker
                    id="print-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                  </marker>
                </defs>
                {composition.annotations
                  .filter(
                    (item): item is Extract<PrintAnnotation, { type: "line" | "arrow" }> =>
                      item.type === "line" || item.type === "arrow",
                  )
                  .map((item) => (
                    <g key={item.id}>
                      <line
                        x1={`${item.x}%`}
                        y1={`${item.y}%`}
                        x2={`${item.x2}%`}
                        y2={`${item.y2}%`}
                        stroke="transparent"
                        strokeWidth={Math.max(14, item.width + 10)}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={(event) => startPointDrag(event, item, "whole")}
                      />
                      <line
                        x1={`${item.x}%`}
                        y1={`${item.y}%`}
                        x2={`${item.x2}%`}
                        y2={`${item.y2}%`}
                        stroke={item.color}
                        strokeWidth={item.width}
                        markerEnd={item.type === "arrow" ? "url(#print-arrow)" : undefined}
                        className="pointer-events-none"
                      />
                      {selectedId === item.id && (
                        <>
                          <circle
                            cx={`${item.x}%`}
                            cy={`${item.y}%`}
                            data-print-editor-only
                            r="7"
                            fill="white"
                            stroke={item.color}
                            strokeWidth="3"
                            className="pointer-events-auto cursor-grab"
                            onPointerDown={(event) => startPointDrag(event, item, "start")}
                          />
                          <circle
                            cx={`${item.x2}%`}
                            cy={`${item.y2}%`}
                            data-print-editor-only
                            r="7"
                            fill="white"
                            stroke={item.color}
                            strokeWidth="3"
                            className="pointer-events-auto cursor-grab"
                            onPointerDown={(event) => startPointDrag(event, item, "end")}
                          />
                        </>
                      )}
                    </g>
                  ))}
                {composition.annotations
                  .filter(
                    (item): item is Extract<PrintAnnotation, { type: "callout" }> =>
                      item.type === "callout",
                  )
                  .map((item) => {
                    const target = calloutTarget(item);
                    return (
                      <line
                        key={`line-${item.id}`}
                        x1={`${item.x}%`}
                        y1={`${item.y}%`}
                        x2={`${target.x}%`}
                        y2={`${target.y}%`}
                        stroke={item.color}
                        strokeWidth="2.5"
                        markerEnd="url(#print-arrow)"
                        className="pointer-events-none"
                      />
                    );
                  })}
              </svg>
              {composition.annotations
                .filter(
                  (item): item is Extract<PrintAnnotation, { type: "text" }> =>
                    item.type === "text",
                )
                .map((item) => (
                  <button
                    key={item.id}
                    data-print-selected={selectedId === item.id ? "true" : undefined}
                    onClick={() => setSelectedId(item.id)}
                    onPointerDown={(event) => startBoxDrag(event, item)}
                    className={cn(
                      "absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded px-2 py-1 text-left",
                      selectedId === item.id && "ring-2 ring-primary ring-offset-1",
                    )}
                    style={{
                      left: `${item.x}%`,
                      top: `${item.y}%`,
                      color: item.textColor,
                      backgroundColor: item.backgroundColor ?? "transparent",
                      fontFamily: item.font,
                      fontSize: `${item.fontSize}px`,
                    }}
                  >
                    {item.text}
                  </button>
                ))}
              {composition.annotations
                .filter(
                  (item): item is Extract<PrintAnnotation, { type: "callout" }> =>
                    item.type === "callout",
                )
                .map((item) => (
                  <button
                    key={item.id}
                    data-print-selected={selectedId === item.id ? "true" : undefined}
                    onClick={() => setSelectedId(item.id)}
                    onPointerDown={(event) => startBoxDrag(event, item)}
                    className={cn(
                      "absolute z-40 w-[15%] -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1.5 text-left shadow-sm",
                      selectedId === item.id && "ring-2 ring-primary ring-offset-1",
                    )}
                    style={{
                      left: `${item.x}%`,
                      top: `${item.y}%`,
                      color: item.textColor,
                      backgroundColor: item.backgroundColor,
                      borderColor: item.color,
                    }}
                  >
                    <span className="block text-[clamp(7px,.75vw,11px)] font-semibold leading-tight">
                      {item.contentMode === "gps"
                        ? formatDecimalGps(item)
                        : item.contentMode === "dms"
                          ? formatDmsGps(item)
                          : item.text}
                    </span>
                    {(item.contentMode === "label-gps" || item.contentMode === "label-dms") && (
                      <span className="num mt-1 block text-[clamp(6px,.6vw,9px)] opacity-75">
                        {item.contentMode === "label-dms"
                          ? formatDmsGps(item)
                          : formatDecimalGps(item)}
                      </span>
                    )}
                  </button>
                ))}
              {composition.showDate && (
                <div className="absolute bottom-[2%] right-[5%] text-[clamp(6px,.65vw,9px)] text-slate-500">
                  {new Date().toLocaleDateString()}
                </div>
              )}
              {(composition.showProjectNotes ?? false) && selectedProjectNotes.length > 0 && (
                <aside className="absolute bottom-[3%] left-[5%] z-40 max-h-[20%] w-[42%] overflow-hidden rounded-md border border-slate-300 bg-white/95 p-[1.2%] shadow-sm">
                  <strong className="block text-[clamp(7px,.8vw,11px)]">Project notes</strong>
                  <div className="mt-1 space-y-1">
                    {selectedProjectNotes.slice(0, 4).map((note) => (
                      <div key={note.id} className="text-[clamp(6px,.62vw,9px)] leading-tight">
                        <strong>{note.title}:</strong> {note.body.slice(0, 180)}
                        {note.body.length > 180 ? "…" : ""}
                      </div>
                    ))}
                  </div>
                </aside>
              )}
              {placementMode && (
                <div
                  className="absolute inset-0 z-[60] cursor-crosshair bg-transparent"
                  onPointerDown={handlePlacement}
                  data-print-editor-only
                  aria-label="Print item placement surface"
                />
              )}
            </div>
          </div>
        </main>

        {selected && (
          <aside className="print-composer-ui w-64 shrink-0 overflow-y-auto border-l border-border bg-card p-3 text-xs">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold capitalize">{selected.type}</h2>
              <button
                onClick={removeSelected}
                className="ml-auto rounded-lg p-2 text-destructive hover:bg-destructive/10"
                aria-label="Remove selected print item"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            {selected.type === "text" && (
              <>
                <Field
                  label="Text"
                  value={selected.text}
                  onChange={(text) => updateAnnotation(selected.id, { text })}
                />
                <Select
                  value={selected.font}
                  onChange={(font) =>
                    updateAnnotation(selected.id, {
                      font: font as Extract<PrintAnnotation, { type: "text" }>["font"],
                    })
                  }
                  options={["Inter", "Arial", "Georgia", "Courier New"]}
                />
                <Range
                  label="Text size"
                  value={selected.fontSize}
                  min={8}
                  max={36}
                  onChange={(fontSize) => updateAnnotation(selected.id, { fontSize })}
                />
                <Color
                  label="Text color"
                  value={selected.textColor}
                  onChange={(textColor) => updateAnnotation(selected.id, { textColor })}
                />
                <CheckOption
                  checked={selected.backgroundColor !== null}
                  label="Text background"
                  onChange={(checked) =>
                    updateAnnotation(selected.id, { backgroundColor: checked ? "#ffffff" : null })
                  }
                />
                {selected.backgroundColor && (
                  <Color
                    label="Background"
                    value={selected.backgroundColor}
                    onChange={(backgroundColor) =>
                      updateAnnotation(selected.id, { backgroundColor })
                    }
                  />
                )}
              </>
            )}
            {(selected.type === "line" || selected.type === "arrow") && (
              <>
                <Color
                  label="Color"
                  value={selected.color}
                  onChange={(color) => updateAnnotation(selected.id, { color })}
                />
                <Range
                  label="Width"
                  value={selected.width}
                  min={1}
                  max={10}
                  onChange={(width) => updateAnnotation(selected.id, { width })}
                />
              </>
            )}
            {selected.type === "marker" && (
              <>
                <Field
                  label="Label"
                  value={selected.label}
                  onChange={(label) => updateAnnotation(selected.id, { label })}
                />
                <Color
                  label="Marker color"
                  value={selected.color}
                  onChange={(color) => updateAnnotation(selected.id, { color })}
                />
                <CheckOption
                  checked={selected.showCoordinates}
                  label="GPS coordinates"
                  onChange={(showCoordinates) => updateAnnotation(selected.id, { showCoordinates })}
                />
                <CheckOption
                  checked={selected.gpsOnly ?? false}
                  label="GPS only"
                  onChange={(gpsOnly) =>
                    updateAnnotation(selected.id, {
                      gpsOnly,
                      showCoordinates: gpsOnly ? true : selected.showCoordinates,
                    })
                  }
                />
                <label className="mt-2 block">
                  <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
                    Coordinate format
                  </span>
                  <select
                    value={selected.coordinateFormat ?? "decimal"}
                    onChange={(event) =>
                      updateAnnotation(selected.id, {
                        coordinateFormat: event.target.value as "decimal" | "dms",
                      })
                    }
                    className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                  >
                    <option value="decimal">Decimal degrees</option>
                    <option value="dms">Degrees · minutes · seconds</option>
                  </select>
                </label>
                <p className="num mt-2 text-[10px] text-muted-foreground">
                  {(selected.coordinateFormat ?? "decimal") === "dms"
                    ? formatDmsGps(selected)
                    : formatDecimalGps(selected)}
                </p>
              </>
            )}
            {selected.type === "callout" && (
              <>
                <Field
                  label="Callout text"
                  value={selected.text}
                  onChange={(text) => updateAnnotation(selected.id, { text })}
                />
                <label className="mt-2 block">
                  <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
                    Label content
                  </span>
                  <select
                    value={selected.contentMode}
                    onChange={(event) =>
                      updateAnnotation(selected.id, {
                        contentMode: event.target.value as Extract<
                          PrintAnnotation,
                          { type: "callout" }
                        >["contentMode"],
                      })
                    }
                    className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
                  >
                    <option value="label">Label</option>
                    <option value="label-gps">Label + decimal GPS</option>
                    <option value="gps">Decimal GPS only</option>
                    <option value="label-dms">Label + GPS (DMS)</option>
                    <option value="dms">GPS only (DMS)</option>
                  </select>
                </label>
                <Color
                  label="Arrow and border"
                  value={selected.color}
                  onChange={(color) => updateAnnotation(selected.id, { color })}
                />
                <Color
                  label="Text"
                  value={selected.textColor}
                  onChange={(textColor) => updateAnnotation(selected.id, { textColor })}
                />
                <Color
                  label="Box background"
                  value={selected.backgroundColor}
                  onChange={(backgroundColor) => updateAnnotation(selected.id, { backgroundColor })}
                />
                <button
                  onClick={() => {
                    const map = printMapRef.current;
                    if (!map) return;
                    update({ annotations: arrangeCallouts(composition.annotations, map) });
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-secondary px-2 py-2 text-[10px] font-medium"
                >
                  <LocateFixed className="size-3.5" /> Auto-arrange all callouts
                </button>
                <p className="num mt-2 text-[10px] text-muted-foreground">
                  Target: {formatDecimalGps(selected)}
                </p>
              </>
            )}
            {selected.type !== "marker" && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Range
                  label="Left"
                  value={selected.x}
                  min={0}
                  max={100}
                  onChange={(x) => updateAnnotation(selected.id, { x })}
                />
                <Range
                  label="Top"
                  value={selected.y}
                  min={0}
                  max={100}
                  onChange={(y) => updateAnnotation(selected.id, { y })}
                />
              </div>
            )}
            <p className="mt-4 rounded-lg bg-secondary p-2 text-[10px] leading-relaxed text-muted-foreground">
              Print items are saved with this map composition. Map markers stay attached to their
              geographic coordinates.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

function ComposerButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-2 text-[10px] font-medium hover:bg-accent",
        active ? "bg-primary text-primary-foreground" : "bg-secondary",
      )}
    >
      {<span className="[&>svg]:size-3.5">{icon}</span>}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function Compass({ bearing, scale }: { bearing: number; scale: number }) {
  const size = Math.round(54 * scale);
  return (
    <div
      className="relative flex items-center justify-center rounded-full border border-slate-400 bg-white/90 font-bold shadow"
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(6, 8 * scale)}px` }}
    >
      <span className="absolute top-1">N</span>
      <span className="absolute bottom-1">S</span>
      <span className="absolute left-1">W</span>
      <span className="absolute right-1">E</span>
      <div
        className="relative transition-transform"
        style={{
          width: `${Math.max(8, 12 * scale)}px`,
          height: `${Math.max(22, 32 * scale)}px`,
          transform: `rotate(${-bearing}deg)`,
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1/2 bg-red-600 [clip-path:polygon(50%_0,100%_100%,50%_78%,0_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 rotate-180 bg-slate-700 [clip-path:polygon(50%_0,100%_100%,50%_78%,0_100%)]" />
      </div>
    </div>
  );
}

function FurniturePlacementControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PrintFurnitureCorner;
  onChange: (corner: PrintFurnitureCorner) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_7rem] items-center gap-2">
      <span className="flex items-center gap-1.5 text-[10px] font-medium">
        <Move className="size-3 text-muted-foreground" /> {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as PrintFurnitureCorner)}
        className="rounded-lg border border-border bg-card px-2 py-1.5 text-[10px]"
        aria-label={`${label} position`}
        title={`Set the ${label.toLowerCase()} position or drag it on the map`}
      >
        <option value="top-left">Top left</option>
        <option value="top-right">Top right</option>
        <option value="bottom-left">Bottom left</option>
        <option value="bottom-right">Bottom right</option>
        {value === "custom" && <option value="custom">Custom</option>}
      </select>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-2 block">
      <span className="mb-1 block text-[10px] font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-card px-2 py-1.5 outline-none focus:border-primary"
      />
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border border-border bg-card px-2 py-1.5 capitalize"
    >
      {options.map((option) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? option : option.label;
        return (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

function CheckOption({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg bg-secondary p-2 text-[10px] font-medium">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-primary"
      />
      {label}
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}

function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-2 flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="size-8 rounded border-0 bg-transparent"
      />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </label>
  );
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}

function formatDecimalGps(point: { lat: number; lng: number }) {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

function formatDmsGps(point: { lat: number; lng: number }) {
  return `${toDms(point.lat, true)}  ${toDms(point.lng, false)}`;
}

function toDms(value: number, latitude: boolean) {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  const direction = latitude ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${degrees}°${String(minutes).padStart(2, "0")}′${seconds.toFixed(2).padStart(5, "0")}″${direction}`;
}

function furnitureLabel(key: PrintFurnitureKey) {
  return key === "attribution" ? "source credit" : key === "scale" ? "scale bar" : key;
}
