import { syncMapLayers } from "@/lib/gis/syncMapLayers";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MlMap,
  Marker,
  NavigationControl,
  ScaleControl,
  GeolocateControl,
  setWorkerUrl,
  type MapMouseEvent,
  type GeoJSONSource,
  type ImageSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { bbox as turfBbox } from "@turf/turf";
import { toast } from "sonner";
import {
  Copy,
  MapPin,
  Database,
  Crosshair,
  Trash2,
  Check,
  Undo2,
  X,
  Lock,
  Move,
  ZoomIn,
  StickyNote,
  Plus,
  RotateCcw,
  Redo2,
} from "lucide-react";

import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import { getBasemapStyle } from "@/lib/gis/basemaps";
import {
  buildLayerSpecs,
  primaryLabelGeometry,
  sourceId,
  allLayerIds,
  fillId,
  lineId,
  lineHitId,
  markerIconId,
  imageId,
  pointId,
} from "@/lib/gis/mapStyle";
import { composeLabel } from "@/lib/gis/labels";
import { buildParcelLabels, isParcelLayer, parcelLabelSourceId } from "@/lib/gis/parcelDisplay";
import type { GisLayer } from "@/lib/gis/types";
import {
  formatArea,
  formatLength,
  formatLatLon,
  meters,
  squareMeters,
  toDms,
} from "@/lib/gis/measure";
import { cn } from "@/lib/utils";
import { installXweatherMapProtocol } from "@/lib/weather/xweatherProtocol";
import { createSiteObjectFeature, siteObjectDefinition } from "@/lib/gis/siteDesigner";

const TEXAS_CENTER: [number, number] = [-98.5, 31.3];

// Vite can relocate the MapLibre module independently from its worker in
// production builds. Pin the worker to an emitted asset so GeoJSON sources are
// parsed reliably in hosted previews and deployments.
setWorkerUrl(mapLibreWorkerUrl);
installXweatherMapProtocol();

interface MenuState {
  x: number;
  y: number;
  lng: number;
  lat: number;
}

interface SelectionBoxState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface PreparedCacheEntry {
  data: FeatureCollection;
  labelKey: string;
  fc: FeatureCollection;
  labelFc: FeatureCollection | null;
}

type VertexEditMode = "move" | "add" | "delete";
type DraftVertexMode = "add" | "delete";

interface EditGeometrySnapshot {
  key: string;
  layerId: string;
  featureIndex: number;
  geometry: Geometry;
}

const sourcePerformanceOptions = (layer: GisLayer, featureCount: number) => {
  if (layer.source.kind === "remote" && layer.source.requiresViewport)
    return { tolerance: 0.8, maxzoom: 17, buffer: 64, generateId: true };
  if (featureCount >= 10_000) return { tolerance: 2.5, maxzoom: 15, buffer: 32, generateId: true };
  if (featureCount >= 2_000) return { tolerance: 1.25, maxzoom: 16, buffer: 64, generateId: true };
  return { tolerance: 0.375, maxzoom: 18, buffer: 128, generateId: true };
};

const renderedFeatureIndex = (feature: {
  id: string | number | undefined;
  properties: unknown;
}) => {
  const generated = Number(feature.id);
  if (Number.isInteger(generated) && generated >= 0) return generated;
  return Number((feature.properties as Record<string, unknown> | undefined)?.["__idx"] ?? -1);
};

function renderedLayerId(styleLayerId: string): string {
  return styleLayerId.replace(/^(line-hit|hl-point|fill|line|point|marker|label|hl)-/, "");
}

const selectableLayerIds = (layerId: string) => [
  pointId(layerId),
  markerIconId(layerId),
  lineHitId(layerId),
  lineId(layerId),
  fillId(layerId),
];

export function MapCanvas() {
  const [overlap, setOverlap] = useState<{
    options: Array<{ layerId: string; index: number }>;
    base: Array<{ layerId: string; index: number }>;
    additive: boolean;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<MlMap | null>(null);
  const wb = useWorkbench();
  const wbRef = useRef(wb);
  wbRef.current = wb;
  const {
    setMap,
    elevationProfileOpen,
    buildableAreaOpen,
    setLayerRenderErrors,
    setDrawerOpen,
    setPendingCatalogQuery,
    setLastPoint,
    setPendingFeatureSave,
    setPendingMapNoteLocation,
    pendingSiteObject,
    setPendingSiteObject,
    editEnabled,
    setEditEnabled,
  } = useMapRef();

  const elevationProfileOpenRef = useRef(elevationProfileOpen);
  elevationProfileOpenRef.current = elevationProfileOpen || buildableAreaOpen;
  const [cursor, setCursor] = useState<{ lng: number; lat: number } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [draft, setDraft] = useState<Position[]>([]);
  const [ready, setReady] = useState(false);
  const [styleRevision, setStyleRevision] = useState(0);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [panLocked, setPanLocked] = useState(false);
  const [zoomLocked, setZoomLocked] = useState(false);
  const [editVertexMode, setEditVertexMode] = useState<VertexEditMode>("move");
  const [draftVertexMode, setDraftVertexMode] = useState<DraftVertexMode>("add");
  const selectionBoxRef = useRef<SelectionBoxState | null>(null);
  const boxDidSelectRef = useRef(false);
  const editMarkerRefs = useRef<Marker[]>([]);
  const editSnapshotRef = useRef<EditGeometrySnapshot | null>(null);
  const editHistoryRef = useRef<Geometry[]>([]);
  const editRedoRef = useRef<Geometry[]>([]);
  const draftHistoryRef = useRef<Position[][]>([]);
  const draftRedoRef = useRef<Position[][]>([]);
  const styledBasemapRef = useRef(wb.basemapId);
  const preparedCacheRef = useRef(new Map<string, PreparedCacheEntry>());
  const sourcePayloadRef = useRef(new Map<string, FeatureCollection>());
  const styleSignatureRef = useRef(new Map<string, string>());
  const orderSignatureRef = useRef("");
  const renderErrorSignatureRef = useRef("");
  const selectedStateRef = useRef(new Map<string, Set<number>>());
  const appliedProjectRef = useRef("");
  const fittedShareRef = useRef("");

  const drawModeRef = useRef(wb.drawMode);
  drawModeRef.current = wb.drawMode;
  const pendingSiteObjectRef = useRef(pendingSiteObject);
  pendingSiteObjectRef.current = pendingSiteObject;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const updateDraftGeometry = useCallback((update: (current: Position[]) => Position[]) => {
    const current = draftRef.current;
    const next = update(current);
    if (next === current) return;
    draftHistoryRef.current.push(current.map((coordinate) => [...coordinate] as Position));
    draftRedoRef.current = [];
    draftRef.current = next;
    setDraft(next);
  }, []);

  const undoDraftGeometry = useCallback(() => {
    const previous = draftHistoryRef.current.pop();
    if (!previous) return;
    draftRedoRef.current.push(draftRef.current.map((coordinate) => [...coordinate] as Position));
    draftRef.current = previous;
    setDraft(previous);
  }, []);

  const redoDraftGeometry = useCallback(() => {
    const next = draftRedoRef.current.pop();
    if (!next) return;
    draftHistoryRef.current.push(draftRef.current.map((coordinate) => [...coordinate] as Position));
    draftRef.current = next;
    setDraft(next);
  }, []);

  const clearDraftGeometry = useCallback(() => {
    draftRef.current = [];
    setDraft([]);
    draftHistoryRef.current = [];
    draftRedoRef.current = [];
  }, []);

  useEffect(() => {
    if (!wb.canEditProject && editEnabled) setEditEnabled(false);
  }, [editEnabled, setEditEnabled, wb.canEditProject]);

  /* ---------------- map init ---------------- */
  useEffect(() => {
    if (!containerRef.current || mapObj.current) return;
    const map = new MlMap({
      container: containerRef.current,
      style: getBasemapStyle(wb.basemapId),
      center: wb.mapView?.center ?? TEXAS_CENTER,
      zoom: wb.mapView?.zoom ?? 6,
      bearing: wb.mapView?.bearing ?? 0,
      pitch: wb.mapView?.pitch ?? 0,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), "bottom-right");
    map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
    map.addControl(
      new GeolocateControl({ trackUserLocation: false, showAccuracyCircle: true }),
      "bottom-right",
    );
    mapObj.current = map;
    setMap(map);
    const onStyleLoad = () => {
      setStyleRevision((version) => version + 1);
    };
    map.on("style.load", onStyleLoad);
    map.on("load", () => {
      setReady(true);
      setStyleRevision((version) => version + 1);
      map.resize();
    });
    map.on("error", (e) => console.error("[map]", e.error ?? e));
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    map.on("mousemove", (e) => setCursor({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    map.on("mouseout", () => setCursor(null));
    const rememberView = () => {
      const center = map.getCenter();
      wbRef.current.setMapView({
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    };
    map.on("moveend", rememberView);
    return () => {
      observer.disconnect();
      map.off("style.load", onStyleLoad);
      map.off("moveend", rememberView);
      map.remove();
      mapObj.current = null;
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapObj.current;
    const viewKey = `${wb.projectId}:${wb.activeShare?.id ?? "project"}:${wb.activeShare?.updatedAt ?? ""}`;
    if (!map || !ready || appliedProjectRef.current === viewKey) return;
    appliedProjectRef.current = viewKey;
    map.jumpTo({
      center: wb.mapView.center,
      zoom: wb.mapView.zoom,
      bearing: wb.mapView.bearing,
      pitch: wb.mapView.pitch,
    });
  }, [ready, wb.activeShare?.id, wb.activeShare?.updatedAt, wb.mapView, wb.projectId]);

  useEffect(() => {
    const map = mapObj.current;
    const share = wb.activeShare;
    if (!map || !ready || !share) return;
    const shareKey = `${share.id}:${share.updatedAt}`;
    if (fittedShareRef.current === shareKey) return;
    const largest = wb.displayLayers
      .filter((layer) => layer.visible && layer.data.features.length > 0)
      .flatMap((layer) => {
        try {
          const bounds = turfBbox(layer.data);
          if (bounds.length !== 4 || !bounds.every(Number.isFinite)) return [];
          const width = Math.abs(bounds[2] - bounds[0]);
          const height = Math.abs(bounds[3] - bounds[1]);
          return [{ bounds, score: width * height || width + height || 1 }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.score - a.score)[0];
    if (!largest) return;
    fittedShareRef.current = shareKey;
    map.resize();
    const [west, south, east, north] = largest.bounds;
    if (west === east && south === north) {
      map.jumpTo({ center: [west, south], zoom: Math.max(map.getZoom(), 16) });
      return;
    }
    const compact = map.getContainer().clientWidth < 700;
    map.fitBounds([west, south, east, north], {
      padding: compact ? 36 : 72,
      maxZoom: 16,
      duration: 0,
    });
  }, [ready, wb.activeShare, wb.displayLayers]);

  useEffect(() => {
    const applyVerifiedBasemap = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; enabled?: boolean }>).detail;
      if (!detail?.id || detail.id !== styledBasemapRef.current) return;
      const currentMap = mapObj.current;
      if (!currentMap) return;
      currentMap.setStyle(getBasemapStyle(detail.id), { diff: false });
      if (detail.enabled) {
        toast.warning("Basemap provider switched", {
          description:
            "The preferred connection is unavailable, so an equivalent map style is active.",
        });
      }
    };
    window.addEventListener("landdraft:basemap-health", applyVerifiedBasemap);
    return () => window.removeEventListener("landdraft:basemap-health", applyVerifiedBasemap);
  }, []);

  /* ---------------- basemap switching ---------------- */
  useEffect(() => {
    const map = mapObj.current;
    if (!map || !ready || styledBasemapRef.current === wb.basemapId) return;
    styledBasemapRef.current = wb.basemapId;
    map.setStyle(getBasemapStyle(wb.basemapId), { diff: false });
  }, [wb.basemapId, ready]);

  /* ---------------- layer sync ---------------- */
  const prepared = useMemo(() => {
    // Project layer-array order is the global draw stack, independent of category/group.
    // The first layer is frontmost and the final layer is backmost.
    const ordered = wb.displayLayers;
    const nextCache = new Map<string, PreparedCacheEntry>();
    const result = ordered.map((layer) => {
      const rawLabelKey = layer.style.labelUseLayerName
        ? "layer-name:" + layer.name
        : layer.style.labelTemplate;
      const labelKey = isParcelLayer(layer)
        ? rawLabelKey +
          JSON.stringify([
            layer.style.labelSize,
            layer.style.labelScaleWithZoom,
            layer.style.labelLineSpacing,
            layer.style.labelHaloWidth,
          ])
        : rawLabelKey;
      const cached = preparedCacheRef.current.get(layer.id);
      if (cached && cached.data === layer.data && cached.labelKey === labelKey) {
        nextCache.set(layer.id, cached);
        return { layer, fc: cached.fc, labelFc: cached.labelFc };
      }
      if (!rawLabelKey.trim()) {
        const cachedWithoutLabels = { data: layer.data, labelKey, fc: layer.data, labelFc: null };
        nextCache.set(layer.id, cachedWithoutLabels);
        return { layer, fc: layer.data, labelFc: null };
      }
      const features: Feature[] = layer.data.features.map((f) => ({
        ...f,
        properties: {
          ...(f.properties ?? {}),
          __label: layer.style.labelUseLayerName
            ? layer.name
            : composeLabel(f as never, layer.style.labelTemplate),
        },
      }));
      const fc = { type: "FeatureCollection", features } as FeatureCollection;
      const labelFc = isParcelLayer(layer) ? buildParcelLabels(layer, fc) : null;
      nextCache.set(layer.id, { data: layer.data, labelKey, fc, labelFc });
      return { layer, fc, labelFc };
    });
    preparedCacheRef.current = nextCache;
    return result;
  }, [wb.displayLayers]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !ready) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const sync = () => {
      if (cancelled) return;
      try {
        const keep = new Set(
          prepared.flatMap((p) => [
            sourceId(p.layer.id),
            ...(p.labelFc ? [parcelLabelSourceId(p.layer.id)] : []),
          ]),
        );
        let rebuiltLayers = false;
        for (const spec of map.getStyle().layers ?? []) {
          const sid = (spec as { source?: string }).source;
          if (sid && sid.startsWith("src-") && !keep.has(sid)) map.removeLayer(spec.id);
        }
        for (const sid of Object.keys(map.getStyle().sources ?? {})) {
          if (sid.startsWith("src-") && !keep.has(sid)) {
            map.removeSource(sid);
            sourcePayloadRef.current.delete(sid);
            styleSignatureRef.current.delete(sid.replace(/^src-/, ""));
          }
        }

        const syncErrors = syncMapLayers(prepared, ({ layer, fc, labelFc }) => {
          const sid = sourceId(layer.id);
          if (labelFc) {
            const labelSid = parcelLabelSourceId(layer.id);
            const labelSource = map.getSource(labelSid) as GeoJSONSource | undefined;
            if (!labelSource) map.addSource(labelSid, { type: "geojson", data: labelFc });
            else if (sourcePayloadRef.current.get(labelSid) !== labelFc)
              labelSource.setData(labelFc);
            sourcePayloadRef.current.set(labelSid, labelFc);
          }
          const styleSignature = JSON.stringify([
            layer.style,
            layer.style.labelUseLayerName ? layer.name : null,
            primaryLabelGeometry(layer),
            layer.source.kind === "remote" ? layer.source.minZoom : null,
            layer.source.kind === "image" ? [layer.source.dataUrl, layer.source.coordinates] : null,
          ]);
          let existing = map.getSource(sid);
          if (
            layer.source.kind === "image" &&
            existing &&
            styleSignatureRef.current.get(layer.id) !== styleSignature
          ) {
            for (const id of allLayerIds(layer.id)) if (map.getLayer(id)) map.removeLayer(id);
            map.removeSource(sid);
            existing = undefined;
          }
          if (layer.source.kind === "image") {
            if (existing) {
              (existing as ImageSource).setCoordinates(layer.source.coordinates);
            } else {
              map.addSource(sid, {
                type: "image",
                url: layer.source.dataUrl,
                coordinates: layer.source.coordinates,
              });
            }
            sourcePayloadRef.current.delete(sid);
          } else if (existing) {
            if (sourcePayloadRef.current.get(sid) !== fc) (existing as GeoJSONSource).setData(fc);
          } else {
            map.addSource(sid, {
              type: "geojson",
              data: fc,
              ...sourcePerformanceOptions(layer, fc.features.length),
            });
          }
          if (layer.source.kind !== "image") sourcePayloadRef.current.set(sid, fc);

          const sentinelLayerId =
            layer.source.kind === "image" ? imageId(layer.id) : fillId(layer.id);
          if (
            styleSignatureRef.current.get(layer.id) !== styleSignature ||
            !map.getLayer(sentinelLayerId)
          ) {
            for (const id of allLayerIds(layer.id)) if (map.getLayer(id)) map.removeLayer(id);
            for (const spec of buildLayerSpecs(layer, map)) map.addLayer(spec);
            styleSignatureRef.current.set(layer.id, styleSignature);
            rebuiltLayers = true;
          }
          for (const id of allLayerIds(layer.id))
            if (map.getLayer(id))
              map.setLayoutProperty(id, "visibility", layer.visible ? "visible" : "none");
        });
        const renderErrorSignature = JSON.stringify(syncErrors);
        if (renderErrorSignatureRef.current !== renderErrorSignature) {
          renderErrorSignatureRef.current = renderErrorSignature;
          setLayerRenderErrors(syncErrors);
        }
        for (const id of Object.keys(syncErrors)) styleSignatureRef.current.delete(id);

        // Reorder: first item in the composed project/subproject stack is topmost.
        const orderSignature = prepared.map(({ layer }) => layer.id).join("|");
        if (rebuiltLayers || orderSignatureRef.current !== orderSignature) {
          for (const { layer } of [...prepared].reverse()) {
            for (const id of [...allLayerIds(layer.id)].reverse()) {
              if (map.getLayer(id)) map.moveLayer(id);
            }
          }
          // Labels must remain above all fills, not just their own layer's fill.
          const labelOrder = [...prepared].reverse();
          // Layer-name labels are explicit annotations and get placement priority
          // over ordinary attribute labels, while still respecting collision settings.
          labelOrder.sort(
            (a, b) =>
              Number(Boolean(a.layer.style.labelUseLayerName)) -
              Number(Boolean(b.layer.style.labelUseLayerName)),
          );
          for (const { layer } of labelOrder) {
            for (const id of ["label-" + layer.id, "label-" + layer.id + "-lines"])
              if (map.getLayer(id)) map.moveLayer(id);
          }
          orderSignatureRef.current = orderSignature;
        }
        ensureDraftLayers(map);
        map.triggerRepaint();
        if (Object.keys(syncErrors).length)
          throw new Error("Overlay synchronization failed: " + JSON.stringify(syncErrors));
      } catch (error) {
        attempts += 1;
        if (attempts < 20) {
          retryTimer = setTimeout(sync, Math.min(500, attempts * 50));
          return;
        }
        console.error("[map] could not synchronize overlay layers", error);
      }
    };

    sync();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [prepared, ready, styleRevision, setLayerRenderErrors]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !ready) return;
    const next = new Map<string, Set<number>>();
    for (const selection of wb.selectedFeatures) {
      const sid = sourceId(selection.layerId);
      const indexes = next.get(sid) ?? new Set<number>();
      indexes.add(selection.index);
      next.set(sid, indexes);
    }
    for (const [sid, indexes] of selectedStateRef.current) {
      if (!map.getSource(sid)) continue;
      const nextIndexes = next.get(sid) ?? new Set<number>();
      for (const index of indexes)
        if (!nextIndexes.has(index))
          map.setFeatureState({ source: sid, id: index }, { selected: false });
    }
    for (const [sid, indexes] of next) {
      if (!map.getSource(sid)) continue;
      const previous = selectedStateRef.current.get(sid) ?? new Set<number>();
      for (const index of indexes)
        if (!previous.has(index))
          map.setFeatureState({ source: sid, id: index }, { selected: true });
    }
    selectedStateRef.current = next;
  }, [prepared, ready, wb.selectedFeatures]);

  /* ---------------- draft (sketch in progress) ---------------- */
  const draftFc = useMemo<FeatureCollection>(() => {
    const features: Feature[] = draft.map((p, i) => ({
      type: "Feature",
      properties: { vertex: i + 1 },
      geometry: { type: "Point", coordinates: p },
    }));
    if (draft.length >= 2)
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: draft },
      });
    const areaMode = wb.drawMode === "polygon" || wb.drawMode === "measure-area";
    if (areaMode && draft.length >= 3)
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...draft, draft[0] as Position]] },
      });
    return { type: "FeatureCollection", features };
  }, [draft, wb.drawMode]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !ready) return;
    try {
      ensureDraftLayers(map);
      (map.getSource("draft") as GeoJSONSource | undefined)?.setData(draftFc);
      map.triggerRepaint();
    } catch {
      // The layer synchronization pass retries while a replacement style initializes.
    }
  }, [draftFc, ready, styleRevision]);

  const editableFeature = useMemo(() => {
    if (!editEnabled || !wb.selectedFeature) return null;
    const layer = wb.layers.find((item) => item.id === wb.selectedFeature?.layerId);
    if (!layer || layer.source.kind === "remote" || layer.source.kind === "image") return null;
    const feature = layer.data.features[wb.selectedFeature.index];
    return feature && ["Point", "LineString", "Polygon"].includes(feature.geometry.type)
      ? feature
      : null;
  }, [editEnabled, wb.layers, wb.selectedFeature]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !ready) return;
    const sync = () => {
      if (!map.getStyle()) {
        map.once("idle", sync);
        return;
      }
      ensureEditLayers(map);
      const source = map.getSource("feature-edit") as GeoJSONSource | undefined;
      source?.setData(
        editableFeature ? editFeatureCollection(editableFeature) : emptyFeatureCollection(),
      );
      if (editEnabled && !editableFeature) setEditEnabled(false);
    };
    sync();
    return () => {
      map.off("idle", sync);
    };
  }, [editEnabled, editableFeature, ready, setEditEnabled, styleRevision]);

  useEffect(() => {
    if (editEnabled && wb.drawMode !== "none") setEditEnabled(false);
  }, [editEnabled, setEditEnabled, wb.drawMode]);

  useEffect(() => {
    const selection = wb.selectedFeature;
    if (!editEnabled || !editableFeature || !selection) {
      editSnapshotRef.current = null;
      editHistoryRef.current = [];
      editRedoRef.current = [];
      setEditVertexMode("move");
      return;
    }
    const key = `${selection.layerId}:${selection.index}`;
    if (editSnapshotRef.current?.key === key) return;
    editSnapshotRef.current = {
      key,
      layerId: selection.layerId,
      featureIndex: selection.index,
      geometry: structuredClone(editableFeature.geometry),
    };
    editHistoryRef.current = [];
    editRedoRef.current = [];
    setEditVertexMode("move");
  }, [editEnabled, editableFeature, wb.selectedFeature]);

  const persistEditableGeometry = useCallback(
    (nextGeometry: Geometry, trackHistory = true) => {
      const selection = wb.selectedFeature;
      if (!selection || !editableFeature) return;
      if (trackHistory) {
        editHistoryRef.current.push(structuredClone(editableFeature.geometry));
        editRedoRef.current = [];
      }
      wb.updateFeatureGeometry(selection.layerId, selection.index, nextGeometry);
      const measured = { type: "Feature", properties: {}, geometry: nextGeometry } as Feature;
      if (nextGeometry.type === "Point")
        wb.updateFeatureProperties(selection.layerId, selection.index, {
          LON: Number(nextGeometry.coordinates[0]?.toFixed(6)),
          LAT: Number(nextGeometry.coordinates[1]?.toFixed(6)),
        });
      else {
        const sqm = squareMeters(measured);
        const length = meters(measured);
        wb.updateFeatureProperties(selection.layerId, selection.index, {
          ACRES: Number((sqm / 4046.8564224).toFixed(3)),
          SQ_FT: Number((sqm * 10.7639104167).toFixed(0)),
          LENGTH_MI: Number((length / 1609.344).toFixed(3)),
        });
      }
    },
    [editableFeature, wb],
  );

  const changeEditableGeometry = useCallback(
    (coordinate: Position, vertexIndex: number, insert = false) => {
      if (!wb.selectedFeature || !editableFeature) return;
      const geometry = editableFeature.geometry;
      if (geometry.type === "Point") {
        persistEditableGeometry({
          ...geometry,
          coordinates: coordinate,
        });
      } else if (geometry.type === "LineString") {
        const coordinates = geometry.coordinates.map((item) => [...item] as Position);
        if (insert) coordinates.splice(vertexIndex + 1, 0, coordinate);
        else coordinates[vertexIndex] = coordinate;
        persistEditableGeometry({ ...geometry, coordinates });
      } else if (geometry.type === "Polygon") {
        const rings = geometry.coordinates.map((ring) => ring.map((item) => [...item] as Position));
        const vertices = (rings[0] ?? []).slice(0, -1);
        if (insert) vertices.splice(vertexIndex + 1, 0, coordinate);
        else vertices[vertexIndex] = coordinate;
        if (vertices[0]) rings[0] = [...vertices, [...vertices[0]] as Position];
        persistEditableGeometry({
          ...geometry,
          coordinates: rings,
        });
      }
    },
    [editableFeature, persistEditableGeometry, wb.selectedFeature],
  );

  const deleteEditableVertex = useCallback(
    (vertexIndex: number) => {
      if (!editableFeature) return;
      const geometry = editableFeature.geometry;
      if (geometry.type === "Point") {
        toast.error("A point can be moved, but its only vertex cannot be deleted");
        return;
      }
      if (geometry.type === "LineString") {
        if (geometry.coordinates.length <= 2) {
          toast.error("A line needs at least 2 vertices");
          return;
        }
        const coordinates = geometry.coordinates
          .filter((_, index) => index !== vertexIndex)
          .map((coordinate) => [...coordinate] as Position);
        persistEditableGeometry({ ...geometry, coordinates });
      } else if (geometry.type === "Polygon") {
        const rings = geometry.coordinates.map((ring) => ring.map((item) => [...item] as Position));
        const vertices = (rings[0] ?? []).slice(0, -1);
        if (vertices.length <= 3) {
          toast.error("A shape needs at least 3 vertices");
          return;
        }
        vertices.splice(vertexIndex, 1);
        if (vertices[0]) rings[0] = [...vertices, [...vertices[0]] as Position];
        persistEditableGeometry({ ...geometry, coordinates: rings });
      }
      toast.success("Vertex deleted");
    },
    [editableFeature, persistEditableGeometry],
  );

  const undoEditableGeometry = useCallback(() => {
    if (!editableFeature) return;
    const previous = editHistoryRef.current.pop();
    if (!previous) {
      toast.info("No earlier vertex change to undo");
      return;
    }
    editRedoRef.current.push(structuredClone(editableFeature.geometry));
    persistEditableGeometry(previous, false);
  }, [editableFeature, persistEditableGeometry]);

  const redoEditableGeometry = useCallback(() => {
    const next = editRedoRef.current.pop();
    if (!next) {
      toast.info("No vertex change to redo");
      return;
    }
    if (editableFeature) editHistoryRef.current.push(structuredClone(editableFeature.geometry));
    persistEditableGeometry(next, false);
  }, [editableFeature, persistEditableGeometry]);

  const restoreEditableGeometry = useCallback(
    (exitAfterRestore = false) => {
      const snapshot = editSnapshotRef.current;
      if (!snapshot) {
        if (exitAfterRestore) setEditEnabled(false);
        return;
      }
      if (
        wb.selectedFeature?.layerId !== snapshot.layerId ||
        wb.selectedFeature.index !== snapshot.featureIndex
      )
        return;
      persistEditableGeometry(structuredClone(snapshot.geometry), !exitAfterRestore);
      if (exitAfterRestore) {
        setEditEnabled(false);
        toast.success("Vertex changes canceled");
      } else toast.success("Shape restored to the start of this edit");
    },
    [persistEditableGeometry, setEditEnabled, wb.selectedFeature],
  );

  useEffect(() => {
    const map = mapObj.current;
    editMarkerRefs.current.forEach((marker) => marker.remove());
    editMarkerRefs.current = [];
    if (!map || !ready || !editableFeature) return;

    editMarkerRefs.current = editableVertices(editableFeature).map((coordinate, vertexIndex) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "feature-edit-marker";
      element.dataset["mode"] = editVertexMode;
      element.title =
        editVertexMode === "delete"
          ? `Delete vertex ${vertexIndex + 1}`
          : editVertexMode === "move"
            ? `Drag vertex ${vertexIndex + 1}`
            : `Vertex ${vertexIndex + 1}`;
      element.setAttribute("aria-label", element.title);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        if (editVertexMode === "delete") deleteEditableVertex(vertexIndex);
      });

      const marker = new Marker({
        element,
        draggable: editVertexMode === "move",
        anchor: "center",
      })
        .setLngLat([Number(coordinate[0]), Number(coordinate[1])])
        .addTo(map);
      if (editVertexMode === "move")
        marker.on("dragend", () => {
          const next = marker.getLngLat();
          changeEditableGeometry([next.lng, next.lat], vertexIndex);
        });
      return marker;
    });

    return () => {
      editMarkerRefs.current.forEach((marker) => marker.remove());
      editMarkerRefs.current = [];
    };
  }, [changeEditableGeometry, deleteEditableVertex, editableFeature, editVertexMode, ready]);

  /* ---------------- interactions ---------------- */
  const finishDraft = useCallback(() => {
    const coords = draftRef.current;
    const mode = drawModeRef.current;
    if (mode === "none" || mode === "select-multiple" || mode === "select-box" || mode === "note")
      return;
    const isMeasure = mode === "measure-area" || mode === "measure-line";
    const wantsPolygon = mode === "polygon" || mode === "measure-area";
    if (!isMeasure) {
      if (mode === "point") return;
      if (wantsPolygon && coords.length < 3) {
        toast.error("A shape needs at least 3 points");
        return;
      }
      if (mode === "line" && coords.length < 2) {
        toast.error("A line needs at least 2 points");
        return;
      }
      const geometry: Feature["geometry"] = wantsPolygon
        ? { type: "Polygon", coordinates: [[...coords, coords[0] as Position]] }
        : { type: "LineString", coordinates: coords };
      const sqm = squareMeters({ type: "Feature", properties: {}, geometry } as Feature);
      const len = meters({ type: "Feature", properties: {}, geometry } as Feature);
      const feature: Feature = {
        type: "Feature",
        geometry,
        properties: {
          NAME: wantsPolygon ? "New shape" : "New line",
          ACRES: Number((sqm / 4046.8564224).toFixed(3)),
          SQ_FT: Number((sqm * 10.7639104167).toFixed(0)),
          LENGTH_MI: Number((len / 1609.344).toFixed(3)),
          CREATED: new Date().toISOString().slice(0, 10),
        },
      };
      setPendingFeatureSave({
        features: [feature],
        suggestedLayerName: wantsPolygon ? "Drawn areas" : "Drawn lines",
        suggestedFeatureName: wantsPolygon ? "New shape" : "New line",
        defaultGroupId: "sketch",
        source: { kind: "draw" },
      });
      clearDraftGeometry();
      wb.setDrawMode("none");
      return;
    }
    // measurement: keep the draft on screen, just stop adding vertices
    wb.setDrawMode("none");
  }, [clearDraftGeometry, setPendingFeatureSave, wb]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !ready) return;

    const onClick = (e: MapMouseEvent) => {
      if (elevationProfileOpenRef.current) return;
      setMenu(null);
      const siteObjectRequest = pendingSiteObjectRef.current;
      if (siteObjectRequest) {
        const placement = createSiteObjectFeature(siteObjectRequest, [e.lngLat.lng, e.lngLat.lat]);
        const existingLayer = wb.layers.find(
          (layer) =>
            layer.groupId === "design" &&
            layer.source.kind === "draw" &&
            layer.source.purpose === "site-design" &&
            layer.source.siteObjectKind === placement.definition.id,
        );
        if (existingLayer) {
          const featureIndex = existingLayer.data.features.length;
          wb.appendFeature(existingLayer.id, placement.feature as never);
          wb.setActiveLayer(existingLayer.id);
          wb.setSelectedFeature({ layerId: existingLayer.id, index: featureIndex });
        } else {
          const nextLayer = wb.addLayer({
            name: placement.layerName,
            groupId: "design",
            source: {
              kind: "draw",
              purpose: "site-design",
              siteObjectKind: placement.definition.id,
            },
            style: placement.style,
            data: { type: "FeatureCollection", features: [placement.feature as never] },
          });
          wb.setSelectedFeature({ layerId: nextLayer.id, index: 0 });
        }
        setPendingSiteObject(null);
        toast.success(`${placement.definition.name} placed`, {
          description: "Saved in Design overlays. Select it to edit attributes or geometry.",
        });
        return;
      }
      const mode = drawModeRef.current;
      if (mode === "none" || mode === "select-multiple") {
        if (editEnabled && map.getLayer("feature-edit-vertex")) {
          const vertexHit = map.queryRenderedFeatures(e.point, {
            layers: ["feature-edit-vertex"],
          })[0];
          const vertexIndex = Number(vertexHit?.properties?.["vertexIndex"] ?? -1);
          if (vertexIndex >= 0) {
            if (editVertexMode === "delete") deleteEditableVertex(vertexIndex);
            return;
          }
          if (editVertexMode === "add") {
            const segmentHit = map.queryRenderedFeatures(e.point, {
              layers: ["feature-edit-segment-hit"],
            })[0];
            const segmentIndex = Number(segmentHit?.properties?.["segmentIndex"] ?? -1);
            if (segmentIndex >= 0) {
              changeEditableGeometry([e.lngLat.lng, e.lngLat.lat], segmentIndex, true);
              toast.success("Vertex added — switch to Move to refine it");
            } else toast.info("Click a highlighted edge to add a vertex");
            return;
          }
          if (editVertexMode === "delete") {
            toast.info("Click a white vertex to delete it");
            return;
          }
          // Keep the edited feature selected while its move controls are active.
          return;
        }
        if (boxDidSelectRef.current) {
          boxDidSelectRef.current = false;
          return;
        }
        const ids = wb.displayLayers
          .filter((l) => l.visible && !l.selectionLocked)
          .flatMap((l) => selectableLayerIds(l.id))
          .filter((id) => map.getLayer(id));
        const hits = ids.length > 0 ? map.queryRenderedFeatures(e.point, { layers: ids }) : [];
        const uniqueHits = new Map<string, (typeof hits)[number]>();
        for (const candidate of hits) {
          const layerId = renderedLayerId(String(candidate.layer.id));
          const index = renderedFeatureIndex(candidate);
          if (index >= 0 && !uniqueHits.has(`${layerId}:${index}`))
            uniqueHits.set(`${layerId}:${index}`, candidate);
        }
        const candidates = [...uniqueHits.values()];
        const layerOrder = new Map(wb.displayLayers.map((layer, index) => [layer.id, index]));
        candidates.sort(
          (a, b) =>
            (layerOrder.get(renderedLayerId(String(a.layer.id))) ?? Infinity) -
            (layerOrder.get(renderedLayerId(String(b.layer.id))) ?? Infinity),
        );
        const hit = candidates[0];
        const additive =
          mode === "select-multiple" ||
          e.originalEvent.shiftKey ||
          e.originalEvent.ctrlKey ||
          e.originalEvent.metaKey;
        setOverlap(
          candidates.length > 1
            ? {
                options: candidates.map((candidate) => ({
                  layerId: renderedLayerId(String(candidate.layer.id)),
                  index: renderedFeatureIndex(candidate),
                })),
                base: wb.selectedFeatures,
                additive,
              }
            : null,
        );
        if (!hit) {
          if (!additive) wb.setSelectedFeature(null);
          return;
        }
        const layerId = renderedLayerId(String(hit.layer.id));
        const index = renderedFeatureIndex(hit);
        if (index >= 0) {
          const selection = { layerId, index };
          if (additive) {
            const exists = wb.selectedFeatures.some(
              (item) => item.layerId === layerId && item.index === index,
            );
            wb.setSelectedFeatures(
              exists
                ? wb.selectedFeatures.filter(
                    (item) => item.layerId !== layerId || item.index !== index,
                  )
                : [...wb.selectedFeatures, selection],
            );
          } else {
            wb.setSelectedFeature(selection);
          }
          wb.setActiveLayer(layerId);
        }
        return;
      }
      if (mode === "select-box") return;
      const isVertexDraft =
        mode === "polygon" || mode === "line" || mode === "measure-area" || mode === "measure-line";
      if (isVertexDraft && draftVertexMode === "delete") {
        const vertexHit = map.getLayer("draft-vertex")
          ? map.queryRenderedFeatures(e.point, { layers: ["draft-vertex"] })[0]
          : undefined;
        const vertexIndex = Number(vertexHit?.properties?.["vertex"] ?? 0) - 1;
        if (vertexIndex >= 0) {
          updateDraftGeometry((current) => current.filter((_, index) => index !== vertexIndex));
          toast.success("Draft vertex deleted");
        } else toast.info("Click a white draft vertex to delete it");
        return;
      }
      const coord: Position = wb.snapEnabled
        ? (nearestVisibleVertex(map, e.point.x, e.point.y) ?? [e.lngLat.lng, e.lngLat.lat])
        : [e.lngLat.lng, e.lngLat.lat];
      if (mode === "note") {
        setPendingMapNoteLocation({ lng: Number(coord[0]), lat: Number(coord[1]) });
        wb.setDrawMode("none");
        return;
      }
      if (mode === "point") {
        setPendingFeatureSave({
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: coord },
              properties: {
                NAME: "New point",
                LAT: Number(Number(coord[1]).toFixed(6)),
                LON: Number(Number(coord[0]).toFixed(6)),
                SNAPPED: coord[0] !== e.lngLat.lng || coord[1] !== e.lngLat.lat,
              },
            },
          ],
          suggestedLayerName: "Drawn points",
          suggestedFeatureName: "New point",
          defaultGroupId: "sketch",
          source: { kind: "draw" },
        });
        wb.setDrawMode("none");
        return;
      }
      updateDraftGeometry((current) => [...current, coord]);
    };

    const onDblClick = (e: MapMouseEvent) => {
      if (elevationProfileOpenRef.current) return;
      if (
        drawModeRef.current === "none" ||
        drawModeRef.current === "select-multiple" ||
        drawModeRef.current === "select-box"
      )
        return;
      e.preventDefault();
      finishDraft();
    };

    const onContext = (e: MapMouseEvent) => {
      if (elevationProfileOpenRef.current) return;
      e.preventDefault();
      setMenu({ x: e.point.x, y: e.point.y, lng: e.lngLat.lng, lat: e.lngLat.lat });
    };

    const onMouseDown = (e: MapMouseEvent) => {
      if (drawModeRef.current !== "select-box") return;
      e.preventDefault();
      const box = {
        startX: e.point.x,
        startY: e.point.y,
        currentX: e.point.x,
        currentY: e.point.y,
      };
      selectionBoxRef.current = box;
      setSelectionBox(box);
    };

    const onMouseMove = (e: MapMouseEvent) => {
      const box = selectionBoxRef.current;
      if (!box || drawModeRef.current !== "select-box") return;
      const next = { ...box, currentX: e.point.x, currentY: e.point.y };
      selectionBoxRef.current = next;
      setSelectionBox(next);
    };

    const onMouseUp = (e: MapMouseEvent) => {
      const box = selectionBoxRef.current;
      if (!box || drawModeRef.current !== "select-box") return;
      selectionBoxRef.current = null;
      setSelectionBox(null);
      const width = Math.abs(e.point.x - box.startX);
      const height = Math.abs(e.point.y - box.startY);
      if (width < 4 && height < 4) return;
      const ids = wb.displayLayers
        .filter((layer) => layer.visible && !layer.selectionLocked)
        .flatMap((layer) => selectableLayerIds(layer.id))
        .filter((id) => map.getLayer(id));
      const hits = ids.length
        ? map.queryRenderedFeatures(
            [
              [Math.min(box.startX, e.point.x), Math.min(box.startY, e.point.y)],
              [Math.max(box.startX, e.point.x), Math.max(box.startY, e.point.y)],
            ],
            { layers: ids },
          )
        : [];
      const unique = new Map<string, { layerId: string; index: number }>();
      for (const hit of hits) {
        const layerId = renderedLayerId(String(hit.layer.id));
        const index = renderedFeatureIndex(hit);
        if (index >= 0) unique.set(`${layerId}:${index}`, { layerId, index });
      }
      const selections = [...unique.values()];
      wb.setSelectedFeatures(selections);
      if (selections[0]) wb.setActiveLayer(selections[0].layerId);
      boxDidSelectRef.current = true;
      toast.success(
        selections.length
          ? `${selections.length} feature${selections.length === 1 ? "" : "s"} selected`
          : "No features in that box",
      );
    };

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("contextmenu", onContext);
    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.off("contextmenu", onContext);
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
    };
  }, [
    ready,
    wb,
    finishDraft,
    setPendingFeatureSave,
    setPendingMapNoteLocation,
    setPendingSiteObject,
    editEnabled,
    editVertexMode,
    draftVertexMode,
    changeEditableGeometry,
    deleteEditableVertex,
    updateDraftGeometry,
  ]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    map.getCanvas().style.cursor = pendingSiteObject
      ? "crosshair"
      : editEnabled
        ? editVertexMode === "move"
          ? ""
          : "crosshair"
        : wb.drawMode === "none" || wb.drawMode === "select-multiple"
          ? ""
          : "crosshair";
    if (wb.drawMode !== "select-box") boxDidSelectRef.current = false;
    if (wb.drawMode === "select-box" || panLocked) map.dragPan.disable();
    else map.dragPan.enable();
  }, [editEnabled, editVertexMode, wb.drawMode, panLocked, pendingSiteObject]);

  useEffect(() => {
    setDraftVertexMode("add");
  }, [wb.drawMode]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    const zoomHandlers = [map.scrollZoom, map.doubleClickZoom, map.boxZoom, map.touchZoomRotate];
    zoomHandlers.forEach((handler) => (zoomLocked ? handler.disable() : handler.enable()));
    if (zoomLocked || panLocked) map.keyboard.disable();
    else map.keyboard.enable();
  }, [panLocked, zoomLocked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (elevationProfileOpenRef.current) return;
      if (e.key === "Escape") {
        if (pendingSiteObjectRef.current) {
          setPendingSiteObject(null);
          return;
        }
        if (editEnabled) {
          restoreEditableGeometry(true);
          return;
        }
        clearDraftGeometry();
        wb.setDrawMode("none");
        setMenu(null);
      }
      if (e.key === "Enter") {
        if (editEnabled) setEditEnabled(false);
        else finishDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    clearDraftGeometry,
    editEnabled,
    finishDraft,
    restoreEditableGeometry,
    setEditEnabled,
    setPendingSiteObject,
    wb,
  ]);

  /* ---------------- live readout ---------------- */
  const readout = useMemo(() => {
    if (draft.length < 2) return null;
    const areaMode = wb.drawMode === "polygon" || wb.drawMode === "measure-area";
    const line: Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: draft },
    };
    const perimeter = meters(line);
    if (areaMode && draft.length >= 3) {
      const poly: Feature = {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...draft, draft[0] as Position]] },
      };
      const sqm = squareMeters(poly);
      return {
        primary: formatArea(sqm, wb.units.area),
        secondary: `perimeter ${formatLength(perimeter, wb.units.length)}`,
        extra: `${formatArea(sqm, "sqft")} · ${formatArea(sqm, "hectares")} · ${formatArea(sqm, "sqm")}`,
      };
    }
    return {
      primary: formatLength(perimeter, wb.units.length),
      secondary: `${draft.length} points`,
      extra: `${formatLength(perimeter, "feet")} · ${formatLength(perimeter, "meters")}`,
    };
  }, [draft, wb.drawMode, wb.units]);

  const copyCoords = async (lng: number, lat: number) => {
    try {
      await navigator.clipboard.writeText(formatLatLon(lng, lat, 6));
      toast.success("Coordinates copied", { description: formatLatLon(lng, lat, 6) });
    } catch {
      toast.error("Clipboard blocked by the browser");
    }
  };

  const dropPin = (lng: number, lat: number) => {
    setPendingFeatureSave({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            NAME: "Dropped pin",
            LAT: Number(lat.toFixed(6)),
            LON: Number(lng.toFixed(6)),
          },
        },
      ],
      suggestedLayerName: "Map pins",
      suggestedFeatureName: "Dropped pin",
      defaultGroupId: "sketch",
      source: { kind: "draw" },
    });
  };

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !overlap) return;
    const dismiss = () => setOverlap(null);
    map.on("movestart", dismiss);
    return () => {
      map.off("movestart", dismiss);
    };
  }, [overlap]);

  const vertexDrawingActive =
    wb.drawMode === "polygon" ||
    wb.drawMode === "line" ||
    wb.drawMode === "measure-area" ||
    wb.drawMode === "measure-line";
  const editableVertexCount = editableFeature ? editableVertices(editableFeature).length : 0;
  const canAddEditableVertex =
    editableFeature?.geometry.type === "LineString" || editableFeature?.geometry.type === "Polygon";
  const canDeleteEditableVertex =
    (editableFeature?.geometry.type === "LineString" && editableVertexCount > 2) ||
    (editableFeature?.geometry.type === "Polygon" && editableVertexCount > 3);

  return (
    <div className="relative h-full w-full">
      {overlap &&
        typeof document !== "undefined" &&
        createPortal(
          <section
            aria-label="Overlapping features"
            className="panel-surface fixed right-3 top-[max(5rem,calc(env(safe-area-inset-top)+4rem))] z-[85] w-72 max-w-[calc(100vw-1.5rem)] rounded-xl p-2 shadow-float"
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              Choose feature
              <button
                aria-label="Close feature chooser"
                onClick={() => setOverlap(null)}
                className="p-2"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mb-1 text-[10px] text-muted-foreground">
              Top layer selected. Choose another underneath.
            </p>
            <div className="max-h-[30dvh] overflow-auto">
              {overlap.options.map((option, i) => {
                const layer = wb.displayLayers.find((layer) => layer.id === option.layerId);
                if (!layer || !layer.visible || layer.selectionLocked) return null;
                const feature = layer.data.features[option.index];
                const name =
                  feature?.properties?.["NAME"] ??
                  feature?.properties?.["OWNER_NAME"] ??
                  feature?.properties?.["OBJECTID"] ??
                  option.index + 1;
                return (
                  <button
                    key={option.layerId + ":" + option.index}
                    className="mb-1 block w-full rounded-lg bg-secondary px-2 py-2 text-left text-xs hover:bg-accent"
                    onClick={() => {
                      wb.setSelectedFeatures(
                        overlap.additive
                          ? [
                              ...overlap.base.filter(
                                (item) =>
                                  item.layerId !== option.layerId || item.index !== option.index,
                              ),
                              option,
                            ]
                          : [option],
                      );
                      wb.setActiveLayer(option.layerId);
                      setOverlap(null);
                    }}
                  >
                    <strong>
                      {layer.name}
                      {i === 0 ? " · Top" : ""}
                    </strong>
                    <span className="block truncate text-[10px]">{String(name)}</span>
                  </button>
                );
              })}
            </div>
          </section>,
          document.body,
        )}

      <div ref={containerRef} className="h-full w-full" />

      {pendingSiteObject && (
        <div className="float-surface pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 shadow-xl">
          <span className="text-xl" aria-hidden="true">
            {siteObjectDefinition(pendingSiteObject.definitionId).icon}
          </span>
          <div>
            <strong className="block text-xs">
              Click the map to place {pendingSiteObject.name}
            </strong>
            <span className="text-[10px] text-muted-foreground">
              It will be saved in Design overlays. Esc cancels.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPendingSiteObject(null)}
            className="rounded-lg p-1.5 hover:bg-accent"
            aria-label="Cancel site object placement"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="landdraft-map-lock-controls pointer-events-auto absolute bottom-48 right-2 z-20 flex flex-col gap-1">
        <button
          onClick={() => setPanLocked((locked) => !locked)}
          className={cn(
            "float-surface flex size-9 items-center justify-center rounded-xl",
            panLocked && "bg-primary text-primary-foreground",
          )}
          aria-pressed={panLocked}
          aria-label={panLocked ? "Unlock map movement" : "Lock map movement"}
          title={panLocked ? "Unlock map dragging" : "Lock the map in this location"}
        >
          {panLocked ? <Lock className="size-4" /> : <Move className="size-4" />}
        </button>
        <button
          onClick={() => setZoomLocked((locked) => !locked)}
          className={cn(
            "float-surface flex size-9 items-center justify-center rounded-xl",
            zoomLocked && "bg-primary text-primary-foreground",
          )}
          aria-pressed={zoomLocked}
          aria-label={zoomLocked ? "Unlock map zoom" : "Lock map zoom"}
          title={zoomLocked ? "Unlock map zoom" : "Lock the current zoom level"}
        >
          {zoomLocked ? <Lock className="size-4" /> : <ZoomIn className="size-4" />}
        </button>
      </div>

      {selectionBox && (
        <div
          className="pointer-events-none absolute z-30 border-2 border-primary bg-primary/15"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
          }}
        />
      )}

      {editEnabled && editableFeature && (
        <div
          data-tour="vertex-editor"
          className="float-surface pointer-events-auto absolute left-1/2 top-16 z-20 w-[min(94vw,620px)] -translate-x-1/2 rounded-2xl p-2 shadow-float"
        >
          <div className="flex flex-wrap items-center justify-center gap-1">
            <span className="mr-1 px-1 text-[10px] font-semibold">
              Edit{" "}
              {editableFeature.geometry.type === "Polygon"
                ? "shape"
                : editableFeature.geometry.type.toLowerCase()}{" "}
              · {editableVertexCount} {editableVertexCount === 1 ? "vertex" : "vertices"}
            </span>
            <VertexToolButton
              icon={<Move />}
              label="Move"
              title="Move vertices by dragging the white handles"
              active={editVertexMode === "move"}
              onClick={() => setEditVertexMode("move")}
            />
            <VertexToolButton
              icon={<Plus />}
              label="Add"
              title="Add a vertex by clicking a highlighted edge"
              active={editVertexMode === "add"}
              disabled={!canAddEditableVertex}
              onClick={() => setEditVertexMode("add")}
            />
            <VertexToolButton
              icon={<Trash2 />}
              label="Delete"
              title="Delete a vertex by clicking its white handle"
              active={editVertexMode === "delete"}
              disabled={!canDeleteEditableVertex}
              onClick={() => setEditVertexMode("delete")}
            />
            <span className="mx-0.5 h-6 w-px bg-border" />
            <VertexToolButton
              icon={<Undo2 />}
              label="Undo"
              title="Undo the last vertex change"
              disabled={editHistoryRef.current.length === 0}
              onClick={undoEditableGeometry}
            />
            <VertexToolButton
              icon={<Redo2 />}
              label="Redo"
              title="Redo the last undone vertex change"
              disabled={editRedoRef.current.length === 0}
              onClick={redoEditableGeometry}
            />
            <VertexToolButton
              icon={<RotateCcw />}
              label="Reset"
              title="Restore the shape to the start of this editing session"
              onClick={() => restoreEditableGeometry(false)}
            />
            <VertexToolButton
              icon={<X />}
              label="Cancel"
              title="Cancel all changes and leave vertex editing"
              onClick={() => restoreEditableGeometry(true)}
            />
            <VertexToolButton
              icon={<Check />}
              label="Finish"
              title="Keep these changes and finish editing"
              primary
              onClick={() => setEditEnabled(false)}
            />
          </div>
          <p className="mt-1 text-center text-[9px] text-muted-foreground">
            {editVertexMode === "move"
              ? "Drag a white vertex to reshape the feature."
              : editVertexMode === "add"
                ? "Click a highlighted edge to insert a new vertex."
                : "Click a white vertex to remove it."}
          </p>
        </div>
      )}

      {/* drawing helper bar */}
      {(wb.drawMode !== "none" || draft.length > 0) && (
        <div
          className={cn(
            "landdraft-drawing-helper pointer-events-auto absolute left-1/2 top-16 z-20 -translate-x-1/2 md:top-16",
            wb.drawMode === "select-multiple" && "mobile-selection-helper",
          )}
        >
          <div className="float-surface flex max-w-[calc(100vw-1rem)] flex-wrap items-center justify-center gap-1 rounded-2xl px-2 py-2 text-xs">
            <Crosshair className="size-4 text-primary" />
            <span className="font-medium">
              {wb.drawMode === "none"
                ? "Measurement"
                : wb.drawMode === "select-multiple"
                  ? "Click features to add or remove them · New layer saves the selection"
                  : wb.drawMode === "select-box"
                    ? "Drag a box across features to select them"
                    : wb.drawMode === "point"
                      ? "Click the map to drop points"
                      : wb.drawMode === "note"
                        ? "Click the map to place a note marker"
                        : vertexDrawingActive && draftVertexMode === "delete"
                          ? "Click a white draft vertex to delete it"
                          : "Click to add points, double-click or Enter to finish"}
            </span>
            {readout && (
              <span className="num rounded-full bg-accent px-2 py-0.5 text-accent-foreground">
                {readout.primary} · {readout.secondary}
              </span>
            )}
            {vertexDrawingActive && (
              <>
                <VertexToolButton
                  icon={<Plus />}
                  label="Add"
                  title="Add the next vertex by clicking the map"
                  active={draftVertexMode === "add"}
                  onClick={() => setDraftVertexMode("add")}
                />
                <VertexToolButton
                  icon={<Trash2 />}
                  label="Delete"
                  title="Delete a draft vertex by clicking it"
                  active={draftVertexMode === "delete"}
                  disabled={draft.length === 0}
                  onClick={() => setDraftVertexMode("delete")}
                />
              </>
            )}
            {vertexDrawingActive && (
              <>
                <VertexToolButton
                  icon={<Undo2 />}
                  label="Undo"
                  title="Undo the last draft vertex change"
                  disabled={draftHistoryRef.current.length === 0}
                  onClick={undoDraftGeometry}
                />
                <VertexToolButton
                  icon={<Redo2 />}
                  label="Redo"
                  title="Redo the last undone draft vertex change"
                  disabled={draftRedoRef.current.length === 0}
                  onClick={redoDraftGeometry}
                />
              </>
            )}
            {wb.drawMode !== "none" &&
              wb.drawMode !== "point" &&
              wb.drawMode !== "note" &&
              wb.drawMode !== "select-box" && (
                <button
                  onClick={finishDraft}
                  className="flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-primary-foreground"
                >
                  <Check className="size-3.5" /> Finish
                </button>
              )}
            <button
              onClick={() => {
                clearDraftGeometry();
                wb.setDrawMode("none");
              }}
              className="rounded-full p-1 hover:bg-muted"
              aria-label="Cancel"
              title="Cancel the current drawing"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {readout && (
            <div className="num mt-1 rounded-full bg-card/90 px-3 py-1 text-center text-[10px] text-muted-foreground shadow-panel">
              {readout.extra}
            </div>
          )}
        </div>
      )}

      {/* coordinate readout */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 sm:left-24 sm:translate-x-0">
        <div className="num float-surface flex items-center gap-2 rounded-full px-3 py-1 text-[11px]">
          <span className="text-muted-foreground">WGS84</span>
          <span>{cursor ? formatLatLon(cursor.lng, cursor.lat) : "—, —"}</span>
          <span className="hidden text-muted-foreground sm:inline">
            {cursor ? `${toDms(cursor.lat, true)} ${toDms(cursor.lng, false)}` : ""}
          </span>
        </div>
      </div>

      {/* right-click menu */}
      {menu && (
        <>
          <button
            className="absolute inset-0 z-30 cursor-default"
            aria-label="Close menu"
            title="Close map menu"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="float-surface absolute z-40 w-56 overflow-hidden rounded-xl py-1 text-sm"
            style={{
              left: Math.min(menu.x, (containerRef.current?.clientWidth ?? 400) - 230),
              top: Math.min(menu.y, (containerRef.current?.clientHeight ?? 400) - 200),
            }}
          >
            <div className="num px-3 py-1.5 text-[11px] text-muted-foreground">
              {formatLatLon(menu.lng, menu.lat, 6)}
            </div>
            <MenuItem
              icon={<Copy className="size-4" />}
              label="Copy coordinates"
              onClick={() => {
                void copyCoords(menu.lng, menu.lat);
                setMenu(null);
              }}
            />
            {wb.canEditProject && (
              <MenuItem
                icon={<MapPin className="size-4" />}
                label="Drop a pin here"
                onClick={() => {
                  dropPin(menu.lng, menu.lat);
                  setMenu(null);
                }}
              />
            )}
            {wb.canEditProject && (
              <MenuItem
                icon={<StickyNote className="size-4" />}
                label="Add a note marker here"
                onClick={() => {
                  setPendingMapNoteLocation({ lng: menu.lng, lat: menu.lat });
                  setMenu(null);
                }}
              />
            )}
            {wb.canEditProject && (
              <MenuItem
                icon={<Database className="size-4" />}
                label="Find data here"
                onClick={() => {
                  setLastPoint({ lng: menu.lng, lat: menu.lat });
                  setPendingCatalogQuery("");
                  setDrawerOpen(true);
                  setMenu(null);
                }}
              />
            )}
            <MenuItem
              icon={<Crosshair className="size-4" />}
              label="Center map here"
              onClick={() => {
                mapObj.current?.easeTo({ center: [menu.lng, menu.lat] });
                setMenu(null);
              }}
            />
            {draft.length > 0 && (
              <MenuItem
                icon={<Trash2 className="size-4" />}
                label="Clear measurement"
                onClick={() => {
                  clearDraftGeometry();
                  setMenu(null);
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function VertexToolButton({
  icon,
  label,
  title,
  active = false,
  disabled = false,
  primary = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active || undefined}
      title={title}
      className={cn(
        "flex min-h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : active
            ? "bg-primary/15 text-primary ring-1 ring-primary/40"
            : "bg-secondary hover:bg-accent",
      )}
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function nearestVisibleVertex(map: MlMap, x: number, y: number): Position | null {
  const tolerance = 12;
  const appLayerIds = (map.getStyle().layers ?? [])
    .filter(
      (layer) =>
        "source" in layer &&
        typeof layer.source === "string" &&
        layer.source.startsWith("src-") &&
        map.getLayer(layer.id),
    )
    .map((layer) => layer.id);
  const hits = appLayerIds.length
    ? map.queryRenderedFeatures(
        [
          [x - tolerance, y - tolerance],
          [x + tolerance, y + tolerance],
        ],
        { layers: appLayerIds },
      )
    : [];
  let bestCoordinate: Position | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      const point = map.project([value[0], value[1]]);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= tolerance && distance < bestDistance) {
        bestCoordinate = [value[0], value[1]];
        bestDistance = distance;
      }
      return;
    }
    for (const child of value) visit(child);
  };
  for (const hit of hits) {
    if (hit.geometry.type === "GeometryCollection") {
      for (const geometry of hit.geometry.geometries) {
        if ("coordinates" in geometry) visit(geometry.coordinates);
      }
    } else visit(hit.geometry.coordinates);
  }
  return bestCoordinate;
}

function ensureDraftLayers(map: MlMap) {
  if (!map.getSource("draft"))
    map.addSource("draft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!map.getLayer("draft-fill"))
    map.addLayer({
      id: "draft-fill",
      type: "fill",
      source: "draft",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#f2b73d", "fill-opacity": 0.22 },
    });
  if (!map.getLayer("draft-line"))
    map.addLayer({
      id: "draft-line",
      type: "line",
      source: "draft",
      filter: ["match", ["geometry-type"], ["LineString", "Polygon"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f2b73d", "line-width": 3, "line-dasharray": [2, 1] },
    });
  if (!map.getLayer("draft-vertex"))
    map.addLayer({
      id: "draft-vertex",
      type: "circle",
      source: "draft",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#c9832c",
        "circle-stroke-width": 2.5,
      },
    });
}

function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function editFeatureCollection(feature: Feature): FeatureCollection {
  const features: Feature[] = [];
  const vertices = editableVertices(feature);
  const closed = feature.geometry.type === "Polygon";
  vertices.forEach((coordinate, vertexIndex) =>
    features.push({
      type: "Feature",
      properties: { editKind: "vertex", vertexIndex },
      geometry: { type: "Point", coordinates: coordinate },
    }),
  );
  const segmentCount = closed ? vertices.length : Math.max(0, vertices.length - 1);
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const start = vertices[segmentIndex];
    const end = vertices[(segmentIndex + 1) % vertices.length];
    if (!start || !end) continue;
    features.push({
      type: "Feature",
      properties: { editKind: "segment", segmentIndex },
      geometry: { type: "LineString", coordinates: [start, end] },
    });
  }
  return { type: "FeatureCollection", features };
}

function editableVertices(feature: Feature): Position[] {
  if (feature.geometry.type === "Point") return [feature.geometry.coordinates];
  if (feature.geometry.type === "LineString") return feature.geometry.coordinates;
  if (feature.geometry.type === "Polygon")
    return (feature.geometry.coordinates[0] ?? []).slice(0, -1);
  return [];
}

function ensureEditLayers(map: MlMap) {
  if (!map.getSource("feature-edit"))
    map.addSource("feature-edit", { type: "geojson", data: emptyFeatureCollection() });
  if (!map.getLayer("feature-edit-segment"))
    map.addLayer({
      id: "feature-edit-segment",
      type: "line",
      source: "feature-edit",
      filter: ["==", ["get", "editKind"], "segment"],
      paint: { "line-color": "#f2b73d", "line-width": 3, "line-dasharray": [2, 1] },
    });
  if (!map.getLayer("feature-edit-segment-hit"))
    map.addLayer({
      id: "feature-edit-segment-hit",
      type: "line",
      source: "feature-edit",
      filter: ["==", ["get", "editKind"], "segment"],
      paint: { "line-color": "#000000", "line-width": 18, "line-opacity": 0.01 },
    });
  if (!map.getLayer("feature-edit-vertex"))
    map.addLayer({
      id: "feature-edit-vertex",
      type: "circle",
      source: "feature-edit",
      filter: ["==", ["get", "editKind"], "vertex"],
      paint: {
        "circle-radius": 6,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#c9832c",
        "circle-stroke-width": 3,
      },
    });
}
