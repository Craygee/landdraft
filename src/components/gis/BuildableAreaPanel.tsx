import {
  boundaryLayerOptions,
  boundaryFeatureOptions,
  loadBoundaryPolygons,
} from "@/lib/gis/buildableBoundaryOptions";
import { boundaryPolygonFeatures } from "@/lib/gis/buildableAreaModel";
import {
  optimizeBuildable,
  terrainDefaults,
  AUTO_POLICY_VERSION,
  screeningReferences,
} from "@/lib/gis/buildableAutomation";
import { requestTerrainGrid } from "@/lib/gis/buildableTerrain";
import type { TerrainGrid } from "@/lib/gis/buildableTerrainModel";
import { polygonLayerKey } from "@/lib/gis/buildableAreaModel";
import { buildableSvg } from "@/lib/gis/analysisArtifacts";
import { downloadFile } from "@/lib/gis/export";
import { exportSvgReportPdf } from "@/lib/gis/mapPdf";
import { useEffect, useMemo, useRef, useState } from "react";
import { bbox, booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, FeatureCollection, Position } from "geojson";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { ChevronDown, ChevronUp, Loader2, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import { catalog } from "@/lib/gis/catalog";
import { exportLayer } from "@/lib/gis/export";
import { importFile } from "@/lib/gis/import";
import { combineStudyPolygons, calculateBuildable } from "@/lib/gis/buildableArea";
import {
  BuildableRunGate,
  buildablePresets,
  loadBuildableSources,
  newRule,
  ruleFromCatalog,
  ruleFromLayer,
} from "@/lib/gis/buildableAreaSources";
import {
  buildableExport,
  assertBuildableBudget,
  duplicateBuildableSnapshot,
  boundarySnapshotChanged,
  constraintCategories,
  coverageLabels,
  inputKey,
  SCREENING_NOTE,
  snapshotFromLayer,
} from "@/lib/gis/buildableAreaModel";
import type {
  AreaFeature,
  AreaGeometry,
  BuildableInput,
  BuildableResult,
  BuildableRule,
  BuildableSnapshot,
  ConstraintCategory,
} from "@/lib/gis/buildableAreaModel";

const sourceId = "buildable-screening-source";
const fillId = "buildable-screening-fill";
const lineId = "buildable-screening-outline";
const pointId = "buildable-screening-points";
const hatchId = "buildable-screening-hatches";
const cls = "min-h-11 w-full rounded-xl border border-border bg-card px-3 py-2 text-base";
const btn =
  "min-h-11 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50";
const categoryName = (key: string) => constraintCategories.find((c) => c[0] === key)?.[1] ?? key;
const fmt = (n: number) =>
  n > 0 && n < 0.01 ? "<0.01" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const freshInput = (): BuildableInput => ({
  id: crypto.randomUUID(),
  name: "Buildable Area screening",
  profile: "general",
  boundary: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } },
  sourceReference: { name: "Drawn study" },
  clipToProperty: false,
  propertySetbackM: 0,
  studyMarginM: 0,
  conditionalExcluded: false,
  minimumComponentAcres: 1,
  requested: constraintCategories.filter((c) => c[0] !== "fiber").map((c) => c[0]),
  rules: [],
});
const polygon = (feature?: Feature): feature is AreaFeature =>
  !!feature && ["Polygon", "MultiPolygon"].includes(feature.geometry?.type);

export function BuildableAreaPanel() {
  const wb = useWorkbench();
  const { map, setBuildableAreaOpen, setPrintOpen, setPendingPrintAnalysisId } = useMapRef();
  const [input, setInput] = useState<BuildableInput>(freshInput);
  const [hasBoundary, setHasBoundary] = useState(false);
  const [result, setResult] = useState<BuildableResult | null>(null);
  const [savedLayerId, setSavedLayerId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<"rectangle" | "restriction" | null>(null);
  const [vertices, setVertices] = useState<Position[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [inspected, setInspected] = useState<string[]>([]);
  const [inspectedComponent, setInspectedComponent] = useState("");
  const [category, setCategory] = useState<ConstraintCategory>("wetlands");
  const [layerChoice, setLayerChoice] = useState("");
  const [publicChoice, setPublicChoice] = useState("");
  const [sourceChoice, setSourceChoice] = useState("");
  const [boundarySearch, setBoundarySearch] = useState("");
  const [boundaryLoading, setBoundaryLoading] = useState(false);
  const [boundaryLoadMessage, setBoundaryLoadMessage] = useState("");
  const [boundarySnapshots, setBoundarySnapshots] = useState<
    Record<string, { data: FeatureCollection; url: string; where: string }>
  >({});
  const boundaryAbort = useRef<AbortController | null>(null);
  useEffect(() => () => boundaryAbort.current?.abort(), []);
  const [hideSmall, setHideSmall] = useState(false);
  const [visibility, setVisibility] = useState({
    study: true,
    candidate: true,
    excluded: true,
    conditional: true,
    reference: true,
    unknown: true,
  });
  const [geometryText, setGeometryText] = useState("");
  const gate = useRef(new BuildableRunGate());
  const abort = useRef<AbortController | null>(null);
  const worker = useRef<Worker | null>(null);
  const workerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedProject = useRef(wb.projectId);
  const resultsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const state = useRef({ input, result, drawing, vertices, hasBoundary });
  state.current = { input, result, drawing, vertices, hasBoundary };
  useEffect(() => {
    const body = bodyRef.current,
      target = resultsRef.current;
    if (body && target)
      body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top;
  }, [result?.calculatedAt]);
  const cancel = () => {
    gate.current.cancel();
    abort.current?.abort();
    worker.current?.terminate();
    worker.current = null;
    if (workerTimer.current) clearTimeout(workerTimer.current);
    setBusy(false);
    setProgress("");
  };
  const edit = (change: Partial<BuildableInput>) => {
    cancel();
    setInput((previous) => ({ ...previous, ...change }));
    setError("");
  };
  const editRule = (id: string, patch: Partial<BuildableRule>) =>
    edit({ rules: input.rules.map((r) => (r.id === id ? { ...r, ...patch, override: true } : r)) });
  useEffect(
    () => () => {
      gate.current.cancel();
      abort.current?.abort();
      worker.current?.terminate();
      if (workerTimer.current) clearTimeout(workerTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (wb.projectId !== mountedProject.current) setBuildableAreaOpen(false);
  }, [wb.projectId, setBuildableAreaOpen]);
  const saved = wb.layers.flatMap((layer) => {
    const snapshot = snapshotFromLayer(layer);
    return snapshot ? [{ layer, snapshot }] : [];
  });
  const { displayLayers, selectedFeatures } = wb;
  const projectLayers = useMemo(
    () =>
      displayLayers.map((layer) => {
        const snapshot = boundarySnapshots[layer.id];
        return snapshot &&
          layer.source.kind === "remote" &&
          snapshot.url === layer.source.url &&
          snapshot.where === (layer.source.where ?? "")
          ? { ...layer, data: snapshot.data }
          : layer;
      }),
    [displayLayers, boundarySnapshots],
  );
  const layerOptions = useMemo(() => boundaryLayerOptions(projectLayers), [projectLayers]);
  const polygonChoices = useMemo(
    () => boundaryFeatureOptions(projectLayers, selectedFeatures),
    [projectLayers, selectedFeatures],
  );
  const selectedBoundaryLayer = sourceChoice.startsWith("whole:")
    ? layerOptions.find((e) => e.layer.id === sourceChoice.slice(6))
    : undefined;
  const changeBoundaryChoice = (value: string) => {
    boundaryAbort.current?.abort();
    setBoundaryLoading(false);
    setBoundaryLoadMessage("");
    setSourceChoice(value);
  };
  const loadBoundaryView = async () => {
    const layer = selectedBoundaryLayer?.layer;
    if (!map || !layer) return;
    boundaryAbort.current?.abort();
    const controller = new AbortController();
    boundaryAbort.current = controller;
    setBoundaryLoading(true);
    setBoundaryLoadMessage("Loading polygon geometry from the current map view…");
    try {
      const bounds = map.getBounds(),
        data = await loadBoundaryPolygons(
          layer,
          [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          controller.signal,
        );
      if (controller.signal.aborted) return;
      const source = layer.source;
      if (source.kind !== "remote") return;
      setBoundarySnapshots((previous) => ({
        ...previous,
        [layer.id]: { data, url: source.url, where: source.where ?? "" },
      }));
      const polygons = boundaryPolygonFeatures({ ...layer, data });
      setBoundaryLoadMessage(
        polygons.length
          ? `${polygons.length.toLocaleString()} polygon features loaded for the chooser. This is a snapshot of the requested view, not the entire source dataset.`
          : "This view contains no polygon boundaries from this source. Move to another area, or add point/line data as constraints instead.",
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setBoundaryLoadMessage(e instanceof Error ? e.message : "Polygon geometry could not load.");
    } finally {
      if (!controller.signal.aborted) setBoundaryLoading(false);
    }
  };
  const polygonOption = (key: string) => polygonChoices.find((c) => c.key === key);
  const gross = useMemo(() => {
    if (!hasBoundary) return null;
    try {
      return calculateBuildable({
        ...freshInput(),
        boundary: input.boundary,
        clipToProperty: false,
        property: undefined,
        propertySetbackM: 0,
        studyMarginM: 0,
        rules: [],
        requested: [],
      }).drawnAcres;
    } catch {
      return null;
    }
  }, [hasBoundary, input.boundary]); // Only boundary geometry affects gross acreage.
  const changedLayers = input.rules
    .filter((r) => r.layerId && !r.sourceUrl)
    .some((r) => {
      const layer = projectLayers.find((l) => l.id === r.layerId);
      return !layer || JSON.stringify(layer.data) !== JSON.stringify(r.features);
    });
  const boundaryChanged = boundarySnapshotChanged(input, projectLayers);
  const stale =
    !!result && (result.inputKey !== inputKey(input) || changedLayers || boundaryChanged);
  const setBoundary = (feature: AreaFeature, reference: BuildableInput["sourceReference"]) => {
    try {
      assertBuildableBudget({ type: "FeatureCollection", features: [feature] }, 20_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Boundary is too complex.");
      return;
    }
    edit({ boundary: structuredClone(feature), sourceReference: reference });
    setHasBoundary(true);
    setDrawing(null);
    setVertices([]);
    setCollapsed(false);
    setGeometryText(JSON.stringify(feature.geometry));
  };
  const fit = (geometry: AreaGeometry) => {
    const b = bbox({ type: "Feature", properties: {}, geometry });
    map?.fitBounds(
      [
        [b[0]!, b[1]!],
        [b[2]!, b[3]!],
      ],
      {
        padding: {
          top: 80,
          bottom:
            window.innerWidth < 768
              ? Math.min(window.innerHeight * 0.55, window.innerHeight - 200) + 110
              : 70,
          left: 40,
          right: window.innerWidth < 768 ? 40 : Math.min(window.innerWidth - 200, 470),
        },
        maxZoom: 17,
      },
    );
  };
  const finishRestriction = () => {
    if (vertices.length < 3) {
      setError("Add at least three polygon vertices.");
      return;
    }
    const feature: AreaFeature = {
      type: "Feature",
      properties: { origin: "Manual restriction" },
      geometry: { type: "Polygon", coordinates: [[...vertices, vertices[0]!]] },
    };
    edit({
      rules: [
        ...input.rules,
        newRule(`Manual restriction ${input.rules.length + 1}`, category, {
          type: "FeatureCollection",
          features: [feature],
        }),
      ],
    });
    setDrawing(null);
    setVertices([]);
    setCollapsed(false);
  };
  const actions = useRef({ setBoundary, finishRestriction });
  actions.current = { setBoundary, finishRestriction };
  useEffect(() => {
    if (!map) return;
    const wasDoubleClick = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    const click = (event: MapMouseEvent) => {
      if (
        event.originalEvent?.target instanceof Element &&
        event.originalEvent.target.closest("[data-buildable-panel]")
      )
        return;
      const current = state.current;
      if (current.drawing) {
        const coordinate = [event.lngLat.lng, event.lngLat.lat];
        if (current.vertices.length >= 127) {
          setError("Use at most 128 vertices for manual restrictions.");
          return;
        }
        const next = [...current.vertices, coordinate];
        if (current.drawing === "rectangle" && next.length === 2) {
          const a = next[0]!,
            b = next[1]!;
          const shape: AreaFeature = {
            type: "Feature",
            properties: { origin: "Drawn rectangle" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [a[0]!, a[1]!],
                  [b[0]!, a[1]!],
                  [b[0]!, b[1]!],
                  [a[0]!, b[1]!],
                  [a[0]!, a[1]!],
                ],
              ],
            },
          };
          actions.current.setBoundary(shape, { name: "Drawn study rectangle" });
        } else setVertices(next);
        return;
      }
      const selected = point([event.lngLat.lng, event.lngLat.lat]);
      const r = current.result;
      const referenceHits = map
        .queryRenderedFeatures(
          [
            [event.point.x - 6, event.point.y - 6],
            [event.point.x + 6, event.point.y + 6],
          ],
          { layers: [fillId, lineId, pointId].filter((id) => !!map.getLayer(id)) },
        )
        .map((f) => String(f.properties?.["ruleId"] ?? ""))
        .filter(Boolean);
      setInspected([
        ...new Set([
          ...(r?.prepared
            .filter((f) => booleanPointInPolygon(selected, f))
            .map((f) => String(f.properties?.["ruleId"])) ?? []),
          ...referenceHits,
        ]),
      ]);
      setInspectedComponent(
        r?.components.find((c) => booleanPointInPolygon(selected, c.geometry))?.id ?? "",
      );
    };
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input,select,textarea")) return;
      if (event.key === "Escape") {
        setDrawing(null);
        setVertices([]);
        setCollapsed(false);
      }
      if (event.key === "Enter" && state.current.drawing === "restriction")
        actions.current.finishRestriction();
    };
    map.on("click", click);
    window.addEventListener("keydown", key);
    return () => {
      map.off("click", click);
      window.removeEventListener("keydown", key);
      if (wasDoubleClick) map.doubleClickZoom.enable();
    };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    map.getCanvas().style.cursor = drawing ? "crosshair" : "";
    return () => {
      map.getCanvas().style.cursor = "";
    };
  }, [drawing, map]);
  const display = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    const add = (
      geometry: AreaGeometry | null,
      kind: string,
      properties: Record<string, unknown> = {},
    ) => {
      if (geometry && visibility[kind as keyof typeof visibility])
        features.push({ type: "Feature", properties: { kind, ...properties }, geometry });
    };
    if (result) {
      for (const c of result.components)
        if (!hideSmall || !c.belowMinimum)
          add(c.geometry, "candidate", { label: c.label, id: c.id });
      add(result.excluded, "excluded");
      add(result.conditional, "conditional");
      for (const feature of result.unknownCoverage) add(feature.geometry, "unknown");
      add(result.study, "study");
    }
    if (hasBoundary) add(input.boundary.geometry, "study", { label: "Input study" });
    for (const rule of input.rules.filter((r) => r.enabled && r.classification === "reference"))
      if (visibility.reference)
        features.push(
          ...rule.features.features.map((f) => ({
            ...f,
            properties: { kind: "reference", ruleId: rule.id },
          })),
        );
    if (vertices.length)
      features.push({
        type: "Feature",
        properties: { kind: "drawing" },
        geometry:
          vertices.length > 1
            ? { type: "LineString", coordinates: vertices }
            : { type: "Point", coordinates: vertices[0]! },
      });
    return { type: "FeatureCollection", features };
  }, [input.boundary, input.rules, result, visibility, hasBoundary, hideSmall, vertices]);
  const displayRef = useRef(display);
  displayRef.current = display;
  useEffect(() => {
    if (!map) return;
    const sync = () => {
      if (!map.isStyleLoaded()) return;
      if (!map.getSource(sourceId))
        map.addSource(sourceId, { type: "geojson", data: displayRef.current });
      if (!map.getLayer(fillId))
        map.addLayer({
          id: fillId,
          type: "fill",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": [
              "match",
              ["get", "kind"],
              "candidate",
              "#25844d",
              "excluded",
              "#bf3434",
              "conditional",
              "#d99518",
              "unknown",
              "#7660aa",
              "#64748b",
            ],
            "fill-opacity": ["case", ["==", ["get", "kind"], "study"], 0, 0.35],
          },
        });
      if (!map.getLayer(lineId))
        map.addLayer({
          id: lineId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": [
              "match",
              ["get", "kind"],
              "study",
              "#173e9c",
              "candidate",
              "#176937",
              "excluded",
              "#ac2020",
              "conditional",
              "#a86c00",
              "unknown",
              "#6d4b9e",
              "#64748b",
            ],
            "line-width": ["case", ["==", ["get", "kind"], "study"], 3, 2],
            "line-dasharray": [2, 1],
          },
        });
      if (!map.getLayer(pointId))
        map.addLayer({
          id: pointId,
          type: "circle",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 5,
            "circle-color": "#64748b",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      for (const kind of ["excluded", "conditional", "unknown"]) {
        const imageId = `buildable-pattern-${kind}`;
        if (!map.hasImage(imageId)) {
          const data = new Uint8Array(8 * 8 * 4);
          const color =
            kind === "excluded"
              ? [172, 32, 32]
              : kind === "conditional"
                ? [168, 108, 0]
                : [109, 75, 158];
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
              const marked =
                kind === "unknown"
                  ? x < 2 && y < 2
                  : (x + y) % 8 < 2 || (kind === "conditional" && (x - y + 8) % 8 < 2);
              if (marked) {
                const index = (y * 8 + x) * 4;
                data.set([...color, 175], index);
              }
            }
          map.addImage(imageId, { width: 8, height: 8, data });
        }
      }
      if (!map.getLayer(hatchId))
        map.addLayer({
          id: hatchId,
          type: "fill",
          source: sourceId,
          filter: ["in", ["get", "kind"], ["literal", ["excluded", "conditional", "unknown"]]],
          paint: {
            "fill-pattern": ["concat", "buildable-pattern-", ["get", "kind"]],
            "fill-opacity": 0.8,
          },
        });
      (map.getSource(sourceId) as GeoJSONSource).setData(displayRef.current);
    };
    sync();
    map.on("style.load", sync);
    map.on("load", sync);
    const raise = () => {
      if (!map.getLayer(hatchId)) {
        sync();
        return;
      }
      if (map.getStyle().layers?.at(-1)?.id !== pointId)
        for (const id of [fillId, hatchId, lineId, pointId])
          if (map.getLayer(id)) map.moveLayer(id);
    };
    map.on("idle", raise);
    return () => {
      map.off("style.load", sync);
      map.off("load", sync);
      map.off("idle", raise);
      for (const id of [pointId, lineId, hatchId, fillId])
        if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      for (const kind of ["excluded", "conditional", "unknown"])
        if (map.hasImage(`buildable-pattern-${kind}`)) map.removeImage(`buildable-pattern-${kind}`);
    };
  }, [map]);
  useEffect(() => {
    const source = map?.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(display);
  }, [map, display]);
  const run = async (optimize = false) => {
    cancel();
    setError("");
    setBusy(true);
    setProgress("Preparing source queries…");
    const token = gate.current.next();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const prepared = optimize ? optimizeBuildable(input, catalog) : structuredClone(input);
      if (optimize) setInput(prepared);
      const loaded = await loadBuildableSources(
        prepared,
        catalog,
        projectLayers,
        controller.signal,
        (message) => {
          if (gate.current.accepts(token)) setProgress(message);
        },
      );
      if (!gate.current.accepts(token)) return;
      let terrain: TerrainGrid | { error: string } | undefined;
      if (loaded.automation?.terrain.enabled) {
        setProgress("Loading USGS numeric elevation grid for grade and local relief…");
        try {
          terrain = await requestTerrainGrid(loaded, controller.signal);
        } catch (e) {
          controller.signal.throwIfAborted();
          terrain = { error: e instanceof Error ? e.message : "Terrain failed" };
        }
      }
      if (!gate.current.accepts(token)) return;
      setProgress("Calculating constraints, terrain and candidate areas in background…");
      const task = new Worker(new URL("../../lib/gis/buildableArea.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = task;
      workerTimer.current = setTimeout(() => {
        if (gate.current.accepts(token)) {
          cancel();
          setError("Calculation exceeded 45 seconds. Reduce study size or source detail.");
        }
      }, 45000);
      task.onmessage = (
        event: MessageEvent<{
          ok: boolean;
          input?: BuildableInput;
          result?: BuildableResult;
          error?: string;
        }>,
      ) => {
        if (!gate.current.accepts(token)) return;
        if (workerTimer.current) clearTimeout(workerTimer.current);
        task.terminate();
        worker.current = null;
        setBusy(false);
        setProgress("");
        if (!event.data.ok || !event.data.result) {
          setError(event.data.error ?? "Calculation failed.");
          return;
        }
        setInput(event.data.input ?? loaded);
        setResult(event.data.result);
        setInspected([]);
        setInspectedComponent("");
      };
      task.onerror = () => {
        if (gate.current.accepts(token)) {
          cancel();
          setError(
            "The geometry worker failed to load or calculate. Retry or reduce source detail.",
          );
        }
      };
      task.postMessage({ input: loaded, terrain });
    } catch (e) {
      if (gate.current.accepts(token)) {
        setBusy(false);
        setProgress("");
        setError(e instanceof Error ? e.message : "Analysis could not run.");
      }
    }
  };
  const save = () => {
    if (!result || stale) return;
    const snapshot: BuildableSnapshot = {
      schemaVersion: 1,
      input: structuredClone(input),
      result: structuredClone(result),
    };
    if (JSON.stringify(snapshot).length > 12_000_000) {
      setError("Analysis snapshot exceeds 12 MB. Reduce source detail before saving.");
      return;
    }
    const source = {
      kind: "derived" as const,
      sourceLayerId: input.sourceReference.layerId ?? "buildable-study",
      query: "Buildable Area",
      cachedAt: result.calculatedAt,
      cacheProvenance: { buildableArea: snapshot },
    };
    const data = buildableExport(snapshot);
    const style = {
      fillOpacity: 0.3,
      strokeWidth: 2,
      labelEnabled: false,
      categorized: {
        enabled: true,
        field: "kind",
        rules: [
          { value: "study", label: "Study boundary", color: "rgba(0,0,0,0)", visible: true },
          { value: "candidate", label: "Candidate (not cleared)", color: "#25844d", visible: true },
          { value: "excluded", label: "Excluded", color: "#bf3434", visible: true },
          { value: "conditional", label: "Conditional", color: "#d99518", visible: true },
          { value: "unknown", label: "Unknown coverage", color: "#7660aa", visible: true },
        ],
        fallbackColor: "#64748b",
        fallbackVisible: true,
      },
      categorizedIcons: {
        enabled: true,
        field: "kind",
        rules: [
          { value: "excluded", label: "Excluded", icon: "", fillPattern: "diagonal" as const },
          {
            value: "conditional",
            label: "Conditional",
            icon: "",
            fillPattern: "crosshatch" as const,
          },
          { value: "unknown", label: "Unknown", icon: "", fillPattern: "dotted" as const },
        ],
        fallbackIcon: "",
      },
    };
    let id = savedLayerId;
    if (id && wb.layers.some((l) => l.id === id))
      wb.updateLayer(id, { name: input.name, data, source });
    else {
      id = wb.addLayer({
        name: input.name,
        data,
        source,
        style,
        groupId: wb.derivedLayerGroupId,
      }).id;
      setSavedLayerId(id);
    }
    toast.success("Analysis saved in project layers; use Save project to sync your project.");
    return id;
  };
  const reopen = (layerId: string) => {
    const entry = saved.find((s) => s.layer.id === layerId);
    if (!entry) return;
    cancel();
    setInput({ ...structuredClone(entry.snapshot.input), name: entry.layer.name });
    setResult(structuredClone(entry.snapshot.result));
    setHasBoundary(true);
    setSavedLayerId(layerId);
    setDrawing(null);
    setVertices([]);
    setError("");
    setGeometryText(JSON.stringify(entry.snapshot.input.boundary.geometry));
    fit(entry.snapshot.result.study);
  };
  const addPublic = () => {
    const preset = buildablePresets.find((p) => p.id === publicChoice);
    const entry = catalog.find((c) => c.id === publicChoice);
    if (preset && entry)
      try {
        edit({ rules: [...input.rules, ruleFromCatalog(entry, preset.category)] });
      } catch (e) {
        setError(String(e));
      }
  };
  const snapshot = result ? { schemaVersion: 1 as const, input, result } : null;
  const inspectedRules = input.rules.filter((r) => inspected.includes(r.id));
  return (
    <section
      data-buildable-panel
      className={`buildable-area-panel float-surface fixed z-[75] flex flex-col overflow-hidden rounded-3xl ${collapsed ? "buildable-collapsed" : ""}`}
      aria-label="Buildable Area screening"
    >
      <header className="flex items-center gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Buildable Area</h2>
          <p className="text-xs text-muted-foreground">Preliminary land-development screening</p>
        </div>
        <button className={btn} aria-label="Buildable map zoom in" onClick={() => map?.zoomIn()}>
          <Plus className="size-4" />
        </button>
        <button className={btn} aria-label="Buildable map zoom out" onClick={() => map?.zoomOut()}>
          <Minus className="size-4" />
        </button>
        <button
          className={btn}
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand Buildable Area" : "Collapse Buildable Area"}
        >
          {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
        <button
          className={btn}
          onClick={() => {
            cancel();
            setBuildableAreaOpen(false);
          }}
          aria-label="Close Buildable Area"
        >
          <X className="size-4" />
        </button>
      </header>
      {(drawing || collapsed) && (
        <div className="space-y-2 p-3 text-xs">
          <p>
            {drawing === "rectangle"
              ? "Tap two opposite corners on the map. This replaces only the analysis boundary."
              : drawing === "restriction"
                ? `Tap polygon vertices (${vertices.length}); then Finish. Escape cancels.`
                : result
                  ? `${fmt(result.candidateAcres)} candidate acres · ${result.completeness.filter((c) => c.status !== "available").length} categories unresolved`
                  : "Choose a study boundary to begin."}
          </p>
          {drawing && (
            <div className="flex gap-2">
              {drawing === "restriction" && (
                <button className={btn} onClick={finishRestriction}>
                  Finish polygon
                </button>
              )}
              <button className={btn} onClick={() => setVertices((v) => v.slice(0, -1))}>
                Undo vertex
              </button>
              <button
                className={btn}
                onClick={() => {
                  setDrawing(null);
                  setVertices([]);
                  setCollapsed(false);
                }}
              >
                Cancel drawing
              </button>
            </div>
          )}
        </div>
      )}
      {!collapsed && (
        <div ref={bodyRef} className="min-h-0 space-y-4 overflow-auto p-3 text-xs">
          <p className="rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-amber-950">
            {SCREENING_NOTE}
          </p>
          <details>
            <summary className="cursor-pointer font-semibold">
              Saved analyses ({saved.length})
            </summary>
            <div className="mt-2 space-y-2">
              {saved.map(({ layer, snapshot }) => (
                <div key={layer.id} className="rounded-xl border p-2">
                  <p className="break-words font-semibold">{layer.name}</p>
                  <p>{new Date(snapshot.result.calculatedAt).toLocaleString()}</p>
                  <div className="flex flex-wrap gap-2">
                    <button className={btn} onClick={() => reopen(layer.id)}>
                      Open
                    </button>
                    <button
                      className={btn}
                      disabled={!wb.canEditProject}
                      onClick={() => {
                        const copied = duplicateBuildableSnapshot(snapshot);
                        copied.input.name = layer.name + " copy";
                        wb.addLayer({
                          name: copied.input.name,
                          groupId: layer.groupId,
                          data: buildableExport(copied),
                          style: layer.style,
                          source: {
                            kind: "derived",
                            sourceLayerId:
                              copied.input.sourceReference.layerId ?? "buildable-study",
                            query: "Buildable Area",
                            cachedAt: copied.result.calculatedAt,
                            cacheProvenance: { buildableArea: copied },
                          },
                        });
                        toast.success("Analysis duplicated in project layers");
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      className={btn}
                      disabled={!wb.canEditProject}
                      onClick={() => {
                        if (window.confirm(`Delete saved analysis “${layer.name}”?`)) {
                          wb.removeLayers([layer.id]);
                          if (savedLayerId === layer.id) setSavedLayerId(null);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
          <label className="block font-semibold">
            Analysis name
            <input
              className={cls}
              value={input.name}
              onChange={(e) => edit({ name: e.target.value })}
            />
          </label>
          <label className="block font-semibold">
            Development profile
            <select
              className={cls}
              value={input.profile}
              onChange={(e) => {
                const profile = e.target.value as BuildableInput["profile"];
                edit({
                  profile,
                  requested: constraintCategories
                    .filter((c) => profile === "data-center" || c[0] !== "fiber")
                    .map((c) => c[0]),
                });
              }}
            >
              <option value="general">General Development</option>
              <option value="data-center">Data Center (no capacity inference)</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className={btn}
              onClick={() => {
                cancel();
                setDrawing("rectangle");
                setVertices([]);
                setCollapsed(true);
              }}
            >
              Draw rectangle
            </button>
            <button
              className={btn}
              onClick={() => {
                cancel();
                setInput(freshInput());
                setHasBoundary(false);
                setResult(null);
                setSavedLayerId(null);
                setDrawing(null);
                setVertices([]);
                setGeometryText("");
                setError("");
              }}
            >
              Reset / new analysis
            </button>
          </div>
          <input
            className={`${cls} mb-2`}
            type="search"
            aria-label="Find polygon or layer"
            placeholder="Find a polygon or layer…"
            value={boundarySearch}
            onChange={(e) => {
              setBoundarySearch(e.target.value);
              changeBoundaryChoice("");
            }}
          />
          <label className="block font-semibold">
            Or select an existing polygon (actual geometry)
            <select
              className={cls}
              value={sourceChoice}
              onChange={(e) => changeBoundaryChoice(e.target.value)}
            >
              <option value="">Choose a project polygon or whole layer</option>
              <optgroup label="Layers — polygon boundaries and connection status">
                {layerOptions
                  .filter((e) => e.layer.name.toLowerCase().includes(boundarySearch.toLowerCase()))
                  .map((e) => (
                    <option
                      key={e.layer.id}
                      value={`whole:${e.layer.id}`}
                      disabled={!e.polygons.length && !e.canLoad}
                    >
                      {e.layer.name} — {e.status}
                    </option>
                  ))}
              </optgroup>
              {polygonChoices
                .filter((c) => c.label.toLowerCase().includes(boundarySearch.toLowerCase()))
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
            </select>
          </label>
          <button
            className={btn}
            disabled={
              !sourceChoice ||
              boundaryLoading ||
              (sourceChoice.startsWith("whole:")
                ? !selectedBoundaryLayer?.polygons.length
                : !polygonOption(sourceChoice))
            }
            onClick={() => {
              if (sourceChoice.startsWith("whole:")) {
                const layer = projectLayers.find((l) => l.id === sourceChoice.slice(6));
                if (layer)
                  try {
                    setBoundary(combineStudyPolygons(boundaryPolygonFeatures(layer)), {
                      layerId: layer.id,
                      name: layer.name,
                      wholeLayer: true,
                      geometryKey: polygonLayerKey(boundaryPolygonFeatures(layer)),
                    });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not combine polygons");
                  }
                return;
              }
              const c = polygonOption(sourceChoice);
              if (c)
                setBoundary(c.feature, {
                  layerId: c.layer.id,
                  featureId: String(c.feature.id ?? c.index),
                  name: c.label,
                });
            }}
          >
            Use polygon / whole-layer snapshot
          </button>
          {selectedBoundaryLayer && (
            <p className="text-xs">
              {selectedBoundaryLayer.layer.name}: {selectedBoundaryLayer.status}.{" "}
              {selectedBoundaryLayer.layer.source.kind === "remote" &&
              !selectedBoundaryLayer.polygons.length
                ? selectedBoundaryLayer.layer.source.loadError
                : ""}
            </p>
          )}
          {selectedBoundaryLayer?.canLoad && (
            <button
              className={btn}
              disabled={boundaryLoading || !map}
              onClick={() => void loadBoundaryView()}
            >
              {boundaryLoading
                ? "Loading polygons…"
                : "Load / refresh polygons in current map view"}
            </button>
          )}
          {boundaryLoadMessage && (
            <p role="status" className="rounded-xl border p-2 text-xs">
              {boundaryLoadMessage}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            New and subproject layers appear automatically. Whole-layer options are not limited by
            the individual-polygon preview; select features on the map to prioritize them here.
            Point, line and image layers are not study boundaries, but point/line layers can be
            constraints.
          </p>

          <p className="text-xs text-muted-foreground">
            Whole-layer selection combines all loaded polygon features, including separate areas,
            with overlaps counted once. Remote layers use only their currently loaded features.
          </p>
          {hasBoundary && (
            <>
              <p className="rounded-xl bg-secondary p-3">
                <strong>
                  Drawn / selected gross area:{" "}
                  {gross === null ? "Invalid boundary — review geometry" : `${fmt(gross)} acres`}
                </strong>
                <br />
                Source: {input.sourceReference.name}. Original project geometry is preserved.
              </p>
              <button className={btn} onClick={() => fit(input.boundary.geometry)}>
                Fit to analysis
              </button>
              <details>
                <summary className="font-semibold">Edit analysis boundary geometry</summary>
                <p>
                  Edits apply only to this analysis snapshot. WGS84 Polygon / MultiPolygon GeoJSON
                  geometry.
                </p>
                <textarea
                  className={`${cls} mt-2 h-28`}
                  value={geometryText}
                  onChange={(e) => setGeometryText(e.target.value)}
                />
                <button
                  className={btn}
                  onClick={() => {
                    try {
                      const g = JSON.parse(geometryText) as AreaGeometry;
                      const f: AreaFeature = { type: "Feature", properties: {}, geometry: g };
                      calculateBuildable({ ...freshInput(), boundary: f });
                      setBoundary(f, { name: "Edited analysis snapshot" });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Invalid geometry");
                    }
                  }}
                >
                  Apply boundary edits
                </button>
              </details>
              <details>
                <summary className="font-semibold">
                  Property clipping, margins and component assumptions
                </summary>
                <div className="mt-2 space-y-2">
                  <label className="block">
                    Explicit property polygon
                    <select
                      className={cls}
                      value={input.propertyReference ?? ""}
                      onChange={(e) => {
                        const c = polygonOption(e.target.value);
                        edit({
                          property: c ? structuredClone(c.feature) : undefined,
                          propertyReference: c?.key,
                          clipToProperty: c ? input.clipToProperty : false,
                        });
                      }}
                    >
                      <option value="">No property selected</option>
                      {polygonChoices.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={input.clipToProperty}
                      disabled={!input.property}
                      onChange={(e) => edit({ clipToProperty: e.target.checked })}
                    />
                    Clip to selected property boundary
                  </label>
                  {!input.property && (
                    <p>
                      Ownership boundaries have not been checked. A rectangle is not proof of
                      ownership.
                    </p>
                  )}
                  <label className="block">
                    Property inward setback (metres)
                    <input
                      className={cls}
                      type="number"
                      min="0"
                      max="5000"
                      disabled={!input.property}
                      value={input.propertySetbackM}
                      onChange={(e) => edit({ propertySetbackM: Number(e.target.value) })}
                    />
                  </label>
                  <label className="block">
                    Separate study-boundary inward margin (metres)
                    <input
                      className={cls}
                      type="number"
                      min="0"
                      max="5000"
                      value={input.studyMarginM}
                      onChange={(e) => edit({ studyMarginM: Number(e.target.value) })}
                    />
                  </label>
                  <p>
                    Editable screening assumptions, not legal setbacks. Property setbacks follow the
                    selected property shell and every hole; study margins follow study edges. No
                    setback is inferred at arbitrary property-clipping edges.
                  </p>
                  <label className="block">
                    Minimum component size (acres; flag / display filter only)
                    <input
                      className={cls}
                      type="number"
                      min="0"
                      value={input.minimumComponentAcres}
                      onChange={(e) => edit({ minimumComponentAcres: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </details>
              <section className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
                <h3 className="font-bold">Automatic development screening</h3>
                <p>
                  Select your boundary, then let LandDraft request relevant catalog layers and
                  analyse a USGS terrain grid. Existing rule edits are preserved. This screens
                  candidate ground; it does not certify buildability or design a grading surface.
                </p>
                <button
                  className={`${btn} bg-primary text-primary-foreground`}
                  disabled={busy}
                  onClick={() => void run(true)}
                >
                  {busy && <Loader2 className="mr-2 inline size-4 animate-spin" />} Optimize &amp;
                  Run
                </button>
                {busy && (
                  <>
                    <button className={btn} onClick={cancel}>
                      Cancel automatic run
                    </button>
                    <p aria-live="polite" className="text-xs">
                      {progress}
                    </p>
                  </>
                )}
                <p className="text-xs">
                  First run deducts conditional areas too. Wetlands / mapped water / 1% floodplain /
                  floodways are excluded by policy. Streams and mapped infrastructure use
                  provisional buffers. Unresolved required checks hold land conditional.
                </p>
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                    Parameters, grade &amp; sources — edit and rerun
                  </summary>
                  <p className="my-2 text-xs">
                    Screening assumptions, not legal setbacks. Infrastructure centerlines do not
                    establish easement or ROW widths. Full source treatments / buffers are editable
                    in Constraint sources and rules below. Optimize adds missing presets; it never
                    resets your existing edits.
                  </p>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={input.automation?.terrain.enabled ?? true}
                      onChange={(e) =>
                        edit({
                          automation: {
                            ...input.automation,
                            version: AUTO_POLICY_VERSION,
                            holdUnresolved: input.automation?.holdUnresolved ?? true,
                            terrain: {
                              ...(input.automation?.terrain ?? terrainDefaults(input.profile)),
                              enabled: e.target.checked,
                            },
                          },
                        })
                      }
                    />
                    Evaluate terrain grade and local relief
                  </label>
                  {(
                    [
                      ["conditionalSlopePercent", "Conditional grade ≥ (%)", 0.1, 200],
                      ["exclusionSlopePercent", "Exclude grade ≥ (%)", 0.1, 200],
                      ["reliefM", "Conditional elevation range > (metres)", 0.1, 100],
                      ["windowM", "Local relief window (metres)", 20, 300],
                      ["cellSizeM", "Requested DEM grid spacing (metres)", 10, 60],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <label key={key} className="my-2 block">
                      {label}
                      <input
                        type="number"
                        className={cls}
                        min={min}
                        max={max}
                        step="any"
                        value={(input.automation?.terrain ?? terrainDefaults(input.profile))[key]}
                        onChange={(e) =>
                          edit({
                            automation: {
                              ...input.automation,
                              version: AUTO_POLICY_VERSION,
                              holdUnresolved: input.automation?.holdUnresolved ?? true,
                              terrain: {
                                ...(input.automation?.terrain ?? terrainDefaults(input.profile)),
                                [key]: Number(e.target.value),
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                  <p className="text-xs">
                    Grade is percent rise/run: 10% = 10 metres rise over 100 metres, not 10°. Relief
                    is the elevation range within the local window. Output spacing automatically
                    increases up to 60 m for large studies and is reported; smaller drop-offs may be
                    missed. No cut/fill or pad feasibility is calculated.
                  </p>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={input.automation?.holdUnresolved ?? true}
                      onChange={(e) =>
                        edit({
                          automation: {
                            ...input.automation,
                            version: AUTO_POLICY_VERSION,
                            terrain: input.automation?.terrain ?? terrainDefaults(input.profile),
                            holdUnresolved: e.target.checked,
                          },
                        })
                      }
                    />
                    Hold areas conditional when required data fail or are partial
                  </label>
                  <button
                    className={btn}
                    onClick={() =>
                      edit({
                        automation: {
                          ...input.automation,
                          version: AUTO_POLICY_VERSION,
                          holdUnresolved: input.automation?.holdUnresolved ?? true,
                          terrain: terrainDefaults(input.profile),
                        },
                      })
                    }
                  >
                    Reset terrain parameters to selected profile defaults
                  </button>
                  {Object.values(screeningReferences).map((source) => (
                    <p key={source.url} className="my-2 text-xs">
                      <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                        {source.title}
                      </a>
                      : {source.explanation}
                    </p>
                  ))}
                </details>
              </section>
              <details open={!result}>
                <summary className="font-semibold">
                  Constraint sources and rules ({input.rules.length})
                </summary>
                <div className="mt-2 space-y-2 rounded-xl border p-2">
                  <label className="block">
                    New project / manual constraint category
                    <select
                      className={cls}
                      value={category}
                      onChange={(e) => setCategory(e.target.value as ConstraintCategory)}
                    >
                      {constraintCategories.map((c) => (
                        <option key={c[0]} value={c[0]}>
                          {c[1]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <select
                    className={cls}
                    value={layerChoice}
                    onChange={(e) => setLayerChoice(e.target.value)}
                    aria-label="Constraint project layer"
                  >
                    <option value="">Choose existing map / imported layer</option>
                    {projectLayers
                      .filter((l) => !snapshotFromLayer(l))
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.data.features.length})
                        </option>
                      ))}
                  </select>
                  <button
                    className={btn}
                    disabled={!layerChoice}
                    onClick={() => {
                      const l = projectLayers.find((l) => l.id === layerChoice);
                      try {
                        if (l) edit({ rules: [...input.rules, ruleFromLayer(l, category)] });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Could not add layer.");
                      }
                    }}
                  >
                    Add layer as constraint
                  </button>
                  <select
                    className={cls}
                    value={publicChoice}
                    onChange={(e) => setPublicChoice(e.target.value)}
                    aria-label="Public constraint service"
                  >
                    <option value="">Choose verified catalog connection</option>
                    {buildablePresets.map((p) => {
                      const c = catalog.find((c) => c.id === p.id);
                      return c?.url ? (
                        <option key={p.id} value={p.id}>
                          {c.name}
                        </option>
                      ) : null;
                    })}
                  </select>
                  <button className={btn} disabled={!publicChoice} onClick={addPublic}>
                    Request public source
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={btn}
                      onClick={() => {
                        cancel();
                        setDrawing("restriction");
                        setVertices([]);
                        setCollapsed(true);
                      }}
                    >
                      Draw restriction polygon
                    </button>
                    <label className={`${btn} cursor-pointer`}>
                      Import constraint file
                      <input
                        className="sr-only"
                        type="file"
                        accept=".geojson,.json,.zip,.kml,.kmz,.gpx,.csv"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const imported = await importFile(file);
                            const r = newRule(imported.name, category, imported.data);
                            r.sourceId = file.name;
                            r.retrievedAt = new Date().toISOString();
                            edit({ rules: [...state.current.input.rules, r] });
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Import failed.");
                          }
                        }}
                      />
                    </label>
                  </div>
                  <p>
                    No universal buffers are supplied. Line and point deductions need an explicit
                    distance or a footprint polygon. Recorded easements receive no extra buffer
                    unless you enter one.
                  </p>
                </div>
                {input.rules.map((rule) => (
                  <details key={rule.id} className="mt-2 rounded-xl border p-2">
                    <summary className="cursor-pointer">
                      <strong>{rule.name}</strong> · {rule.classification} ·{" "}
                      {rule.enabled ? coverageLabels[rule.coverage] : "Disabled"}
                      {rule.override ? " · User override" : ""}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => editRule(rule.id, { enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                      <label className="block">
                        Category
                        <select
                          className={cls}
                          value={rule.category}
                          onChange={(e) =>
                            editRule(rule.id, { category: e.target.value as ConstraintCategory })
                          }
                        >
                          {constraintCategories.map((c) => (
                            <option key={c[0]} value={c[0]}>
                              {c[1]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        Treatment
                        <select
                          className={cls}
                          value={rule.classification}
                          onChange={(e) =>
                            editRule(rule.id, {
                              classification: e.target.value as BuildableRule["classification"],
                            })
                          }
                        >
                          <option value="exclusion">Exclusion</option>
                          <option value="conditional">Conditional</option>
                          <option value="reference">Reference only</option>
                        </select>
                      </label>
                      <p>
                        Original screening classification: {rule.originalClassification}. Provider
                        attributes are preserved separately; this is not a regulatory
                        reclassification.
                      </p>
                      <label className="block">
                        Buffer / polygon expansion
                        <input
                          className={cls}
                          type="number"
                          min="0"
                          value={rule.buffer}
                          onChange={(e) => editRule(rule.id, { buffer: Number(e.target.value) })}
                        />
                      </label>
                      <select
                        className={cls}
                        aria-label={`${rule.name} buffer units`}
                        value={rule.unit}
                        onChange={(e) =>
                          editRule(rule.id, { unit: e.target.value as BuildableRule["unit"] })
                        }
                      >
                        <option value="feet">Feet</option>
                        <option value="meters">Metres</option>
                      </select>
                      <label className="block">
                        Basis / verification
                        <select
                          className={cls}
                          value={rule.verification}
                          onChange={(e) =>
                            editRule(rule.id, {
                              verification: e.target.value as BuildableRule["verification"],
                            })
                          }
                        >
                          <option value="user-assumption">User assumption</option>
                          <option value="provisional">Provisional screening buffer</option>
                          <option value="recorded">Recorded geometry (user attested)</option>
                          <option value="verified">Verified setback (user attested)</option>
                        </select>
                      </label>
                      <label className="block">
                        Geometry basis
                        <input
                          className={cls}
                          value={rule.geometryBasis}
                          onChange={(e) => editRule(rule.id, { geometryBasis: e.target.value })}
                        />
                      </label>
                      <label className="block">
                        Source identifier / document
                        <input
                          className={cls}
                          value={rule.sourceId}
                          onChange={(e) => editRule(rule.id, { sourceId: e.target.value })}
                        />
                      </label>
                      <label className="block">
                        Source date / edition (if known)
                        <input
                          className={cls}
                          value={rule.sourceDate ?? ""}
                          onChange={(e) => editRule(rule.id, { sourceDate: e.target.value })}
                        />
                      </label>
                      <label className="block">
                        Optional documented coverage polygon
                        <select
                          className={cls}
                          value=""
                          onChange={(e) => {
                            const c = polygonOption(e.target.value);
                            if (c)
                              editRule(rule.id, {
                                coverageGeometry: structuredClone(c.feature.geometry),
                              });
                          }}
                        >
                          <option value="">
                            {rule.coverageGeometry
                              ? "Coverage snapshot set — choose to replace"
                              : "No coverage geometry; bounds unknown"}
                          </option>
                          {polygonChoices.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {rule.coverageGeometry && (
                        <button
                          className={btn}
                          onClick={() => editRule(rule.id, { coverageGeometry: undefined })}
                        >
                          Clear coverage geometry
                        </button>
                      )}
                      <label className="block">
                        Explanation / assumption
                        <textarea
                          className={cls}
                          value={rule.explanation}
                          onChange={(e) => editRule(rule.id, { explanation: e.target.value })}
                        />
                      </label>
                      <p className="break-words">
                        Source: {rule.sourceUrl ?? rule.sourceId}
                        <br />
                        Retrieved: {rule.retrievedAt ?? "Not retrieved"}
                        <br />
                        Wetlands and flood maps are screening data; absence does not establish
                        absence of wetland or flood risk.
                      </p>
                      {rule.basis?.map((b) => (
                        <p key={b.url} className="text-xs">
                          <a href={b.url} target="_blank" rel="noreferrer" className="underline">
                            {b.title}
                          </a>
                          : {b.explanation}
                        </p>
                      ))}
                      {rule.layerId && !rule.sourceUrl && (
                        <button
                          className={btn}
                          onClick={() =>
                            editRule(rule.id, {
                              layerId: undefined,
                              coverage: "user-unknown",
                              explanation:
                                rule.explanation +
                                " Using the explicitly retained source snapshot; detached from future project-layer edits.",
                            })
                          }
                        >
                          Use retained snapshot instead of current layer
                        </button>
                      )}
                      <button
                        className={btn}
                        onClick={() => edit({ rules: input.rules.filter((r) => r.id !== rule.id) })}
                      >
                        Remove rule
                      </button>
                    </div>
                  </details>
                ))}
              </details>
              <label className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-50 p-2 text-amber-950">
                <input
                  type="checkbox"
                  checked={input.conditionalExcluded}
                  onChange={(e) => edit({ conditionalExcluded: e.target.checked })}
                />
                Treat conditional areas as excluded (rerun to apply)
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`${btn} bg-primary text-primary-foreground`}
                  disabled={busy}
                  onClick={() => void run()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Run / rerun screening"}
                </button>
                {busy && (
                  <button className={btn} onClick={cancel}>
                    Cancel calculation
                  </button>
                )}
              </div>
            </>
          )}
          {busy && <p role="status">{progress}</p>}
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">
              {error}
            </p>
          )}
          {result && (
            <div ref={resultsRef} className="space-y-3 border-t pt-3">
              <h3 className="text-sm font-bold">Candidate land after mapped rules</h3>
              <p
                role="status"
                className="rounded-xl border border-amber-500 bg-amber-50 p-3 text-amber-950"
              >
                {stale
                  ? "Results outdated — inputs or source layers changed. Rerun before saving / exporting."
                  : "Calculation complete for available inputs."}
                <br />
                {result.completeness.filter((c) => c.status !== "available").length} of{" "}
                {result.completeness.length} requested categories unresolved / provisional. Green
                areas are not comprehensively cleared.
                <br />
                Calculated {new Date(result.calculatedAt).toLocaleString()}; live sources may
                change.
              </p>
              {result.candidateAcres === 0 &&
                input.rules.some((r) => r.generated === "unresolved" && r.enabled) && (
                  <p className="rounded-xl border border-amber-600 bg-amber-50 p-3 font-semibold">
                    No candidate area cleared because required checks are unavailable. This is
                    unresolved data, not a determination that all land is physically unsuitable.
                    Review failed sources below, retry, supply your own data, or explicitly change
                    the unresolved-data policy.
                  </p>
                )}
              {input.rules.some((r) => r.terrainSummary) && (
                <details className="rounded-xl border p-3">
                  <summary className="min-h-11 cursor-pointer font-semibold">
                    Terrain grade / flatness result and provenance
                  </summary>
                  {(() => {
                    const t = input.rules.find((r) => r.terrainSummary)!.terrainSummary!;
                    return (
                      <div className="space-y-2">
                        <p>
                          {t.cellSizeM} m output grid (requested {t.requestedCellSizeM} m); source
                          DEM resolution varies / is not verified. Local relief window {t.windowM} m
                          (requested {t.requestedWindowM} m).
                        </p>
                        <p>
                          Maximum sampled grid grade{" "}
                          {t.maxSlopePercent === null ? "Unknown" : fmt(t.maxSlopePercent) + "%"};
                          maximum local relief{" "}
                          {t.maxReliefM === null ? "Unknown" : fmt(t.maxReliefM) + " m"}.{" "}
                          {t.validCells} usable grid cells; {t.unknownCells} unknown neighbourhoods.
                          These statistics cover the bounding grid; acreage below is clipped to your
                          actual polygon.
                        </p>
                        <p>{t.method}</p>
                        <p>
                          {t.source} · retrieved {t.retrievedAt}. Publisher metadata:{" "}
                          {t.productDate ?? "Not available"}. {t.verticalDatum}. Both horizontal and
                          vertical units are metres.
                        </p>
                        <p>
                          Terrain constraints are listed separately in the acreage breakdown. These
                          are screening grids, not a grading plan or pad-level survey.
                        </p>
                      </div>
                    );
                  })()}
                </details>
              )}
              <dl className="grid grid-cols-2 gap-2">
                {[
                  ["Effective study", result.studyAcres],
                  ["Excluded (union)", result.excludedAcres],
                  [
                    "Remaining after mapped exclusions",
                    Math.max(0, result.studyAcres - result.excludedAcres),
                  ],
                  ["Conditional outside exclusions", result.conditionalAcres],
                  ["Candidate usable", result.candidateAcres],
                  ["Candidate outside conditional", result.outsideConditionalAcres],
                  ["Largest contiguous candidate", result.largestAcres],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-secondary p-2">
                    <dt>{label}</dt>
                    <dd className="font-bold">{fmt(Number(value))} ac</dd>
                  </div>
                ))}
              </dl>
              <p>
                {fmt(result.candidatePercent)}% candidate · {result.components.length} components.
                Conditional policy:{" "}
                {input.conditionalExcluded
                  ? "deduct conditional land"
                  : "retain conditional land in candidates"}
                . {fmt(result.outsideConditionalAcres)} ac would remain outside conditional areas.
              </p>
              <details>
                <summary className="font-semibold">Requested category completeness</summary>
                {result.completeness.map((c) => (
                  <div key={c.category} className="my-2 rounded-xl border p-2">
                    <strong>
                      {categoryName(c.category)}: {coverageLabels[c.status]}
                    </strong>
                    <p>{c.explanation}</p>
                  </div>
                ))}
                <p>
                  Successful queries establish mapped-feature results only. Unknown dataset coverage
                  is not proof of real-world absence. Terrain analysis and access are not evaluated
                  without suitable supplied data.
                </p>
              </details>
              <details>
                <summary className="font-semibold">Constraint acreage / source breakdown</summary>
                <p>
                  Rows may overlap. Excluded total is a union, not a sum. No order-dependent
                  attribution is claimed.
                </p>
                {(result.boundaryRules ?? []).map((rule) => (
                  <div key={rule.id} className="my-2 rounded-xl border p-2">
                    <strong>{rule.name}</strong>
                    <p>
                      Enabled · exclusion · {rule.meters} metres inward · {fmt(rule.acres)}{" "}
                      intersecting ac
                    </p>
                    <p>
                      User assumption; not a legal setback. Source: {rule.source}. May overlap other
                      deductions.
                    </p>
                  </div>
                ))}
                {result.breakdown.map((b) => {
                  const r = input.rules.find((r) => r.id === b.ruleId);
                  return (
                    <div key={b.ruleId} className="my-2 rounded-xl border p-2">
                      <strong>{r?.name}</strong>
                      <p>
                        {r?.enabled ? "Enabled" : "Disabled"} · {r?.classification} · {r?.buffer}{" "}
                        {r?.unit} ·{" "}
                        {b.acres === null
                          ? "Intersecting acreage not calculated"
                          : `${fmt(b.acres)} intersecting ac`}
                      </p>
                      <p>
                        {coverageLabels[b.coverage]} · {r?.verification} ·{" "}
                        {r?.override ? "User override" : "Original treatment"}
                      </p>
                      <p className="break-words">
                        {r?.sourceUrl ?? r?.sourceId} · Source date:{" "}
                        {r?.sourceDate ?? "Not supplied; inspect source attributes"} · Retrieved:{" "}
                        {r?.retrievedAt ?? "Unknown"}
                      </p>
                      {b.message && <p>{b.message}</p>}
                    </div>
                  );
                })}
              </details>
              <details open>
                <summary className="font-semibold">Contiguous candidate areas</summary>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hideSmall}
                    onChange={(e) => setHideSmall(e.target.checked)}
                  />
                  Hide components below {input.minimumComponentAcres} ac (totals unchanged)
                </label>
                {result.components
                  .filter((c) => !hideSmall || !c.belowMinimum)
                  .map((c) => (
                    <button
                      key={c.id}
                      className={`${btn} mb-2 w-full text-left ${inspectedComponent === c.id ? "border-primary bg-primary/10" : ""}`}
                      onClick={() => {
                        setInspectedComponent(c.id);
                        fit(c.geometry);
                      }}
                    >
                      {c.label}: {fmt(c.acres)} ac · {fmt(c.conditionalAcres)} conditional ac
                      {c.belowMinimum ? " · Below minimum" : ""}
                      <span className="block font-normal">{c.access}</span>
                    </button>
                  ))}
                <p>
                  Narrow or point-touching connections may not support construction or equipment
                  movement. Point-touching polygons are separate components.
                </p>
              </details>
              <details open>
                <summary className="font-semibold">Legend / visible analysis data</summary>
                {Object.entries(visibility).map(([key, visible]) => (
                  <label key={key} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => setVisibility((v) => ({ ...v, [key]: e.target.checked }))}
                    />
                    <span className={`buildable-key buildable-${key}`} />
                    {key === "candidate"
                      ? "Candidate (not cleared)"
                      : key === "study"
                        ? "Study outline"
                        : key === "unknown"
                          ? "Unknown coverage where mappable"
                          : key}
                  </label>
                ))}
                <p>
                  Click the map to inspect every intersecting prepared constraint. Patterned
                  boundaries and named categories supplement color. Saved layers use hatch /
                  crosshatch / dots in the existing map and print legend.
                </p>
              </details>
              {(inspectedRules.length > 0 || inspectedComponent) && (
                <details open>
                  <summary className="font-semibold">Map inspection</summary>
                  {inspectedComponent && (
                    <p>
                      {result.components.find((c) => c.id === inspectedComponent)?.label} selected.
                    </p>
                  )}
                  {inspectedRules.map((r) => (
                    <div className="my-2 rounded-xl border p-2" key={r.id}>
                      <strong>
                        {r.name} · {r.classification}
                      </strong>
                      <p>
                        {r.geometryBasis} · {r.buffer} {r.unit} · {r.verification}
                      </p>
                      <p>{r.explanation}</p>
                      <p className="break-words">
                        {r.sourceUrl ?? r.sourceId} · Source date {r.sourceDate ?? "unknown"} ·
                        Retrieved {r.retrievedAt ?? "unknown"}
                      </p>
                      <details>
                        <summary>
                          Original source attributes ({r.features.features.length} features)
                        </summary>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                          {JSON.stringify(
                            r.features.features.map((f) => ({
                              id: f.id,
                              attributes: f.properties,
                            })),
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </div>
                  ))}
                </details>
              )}
              <details>
                <summary className="font-semibold">Limitations / calculation basis</summary>
                {result.warnings.map((w, i) => (
                  <p className="my-2" key={i}>
                    {w}
                  </p>
                ))}
                <p>
                  UTM WGS84 in metres; area ÷ 4,046.8564224 gives acres. 1 mm coordinate grid; no
                  area simplification. {result.crs}. Algorithm {result.version}. Buffers are
                  screening assumptions unless documented. Infrastructure proximity is not scored;
                  legal access and capacity are not evaluated. Footprint fitting and grading are not
                  evaluated.
                </p>
              </details>
              <div className="flex flex-wrap gap-2">
                <button className={btn} disabled={stale || !wb.canEditProject} onClick={save}>
                  {savedLayerId ? "Update saved analysis" : "Save analysis to project"}
                </button>
                <button
                  className={btn}
                  disabled={stale || !snapshot}
                  onClick={() =>
                    snapshot && void exportLayer(buildableExport(snapshot), input.name, "geojson")
                  }
                >
                  Export geometry GeoJSON
                </button>
                <button
                  className={btn}
                  disabled={stale || !snapshot}
                  onClick={() =>
                    snapshot &&
                    void exportLayer(
                      {
                        type: "FeatureCollection",
                        features: [
                          {
                            type: "Feature",
                            geometry: result.study,
                            properties: {
                              name: input.name,
                              note: SCREENING_NOTE,
                              summary: {
                                ...result,
                                prepared: undefined,
                                components: result.components.map((c) => ({
                                  ...c,
                                  geometry: undefined,
                                })),
                                study: undefined,
                                excluded: undefined,
                                conditional: undefined,
                                candidate: undefined,
                                unknownCoverage: undefined,
                              },
                              rules: input.rules.map((r) => ({
                                ...r,
                                features: { featureCount: r.features.features.length },
                                coverageGeometry: undefined,
                              })),
                              assumptions: {
                                clipToProperty: input.clipToProperty,
                                propertySetbackM: input.propertySetbackM,
                                studyMarginM: input.studyMarginM,
                                conditionalExcluded: input.conditionalExcluded,
                                profile: input.profile,
                                automation: input.automation,
                              },
                            },
                          },
                        ],
                      },
                      `${input.name}-summary`,
                      "geojson",
                    )
                  }
                >
                  Export summary + rules
                </button>
                <button
                  className={btn}
                  disabled={stale || !wb.canEditProject}
                  onClick={() => {
                    const id = save();
                    if (!id) return;
                    setPendingPrintAnalysisId(id);
                    setBuildableAreaOpen(false);
                    setPrintOpen(true);
                  }}
                >
                  Add to Print Map
                </button>
                <button
                  className={btn}
                  disabled={stale}
                  onClick={() =>
                    downloadFile(
                      new Blob([buildableSvg({ schemaVersion: 1, input, result })], {
                        type: "image/svg+xml",
                      }),
                      "buildable-area.svg",
                    )
                  }
                >
                  Export report SVG
                </button>
                <button
                  className={btn}
                  disabled={stale}
                  onClick={() =>
                    void exportSvgReportPdf(
                      buildableSvg({ schemaVersion: 1, input, result }),
                      input.name,
                    ).catch((e) => setError(String(e)))
                  }
                >
                  Export report PDF
                </button>
              </div>
              <p>
                Save first for normal layer visibility, attribute inspection, map legend and print
                composition. Project Save syncs the snapshots; reopening does not automatically
                fetch changed live data.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
