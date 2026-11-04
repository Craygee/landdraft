import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatLike,
} from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection } from "geojson";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  Image as ImageIcon,
  Loader2,
  Mountain,
  Rotate3D,
} from "lucide-react";
import { toast } from "sonner";

import { LandDraftMark } from "@/components/brand/LandDraftMark";
import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { fetchRemoteGeoJSONPaged } from "@/lib/gis/arcgis";
import { requestTerrainGrid } from "@/lib/gis/buildableTerrain";
import {
  TERRAIN_3D_DEFAULT_ZOOM,
  TERRAIN_3D_LIMITS_KM2,
  TERRAIN_3D_SOURCES,
  normalizeTerrainBounds,
  summarizeTerrainGrid,
  summarizeTerrainMesh,
  terrainAnalysisInput,
  terrainBoundary,
  terrainBoundsAreaKm2,
  terrainReferenceStyle,
  validateTerrainSelection,
  type TerrainAnalysisMode,
  type TerrainBounds,
  type TerrainGridSummary,
  type TerrainSurface,
} from "@/lib/gis/terrain3d";

setWorkerUrl(mapLibreWorkerUrl);

type WetlandStatus = "idle" | "loading" | "loaded" | "empty" | "error";
type SummarySource = "usgs-3dep" | "display-mesh-estimate";
type MapStatus = "loading" | "ready" | "degraded" | "error";

const emptyCollection = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

function studyFeatureCollection(bounds: TerrainBounds | null): FeatureCollection {
  return bounds
    ? { type: "FeatureCollection", features: [terrainBoundary(bounds)] }
    : emptyCollection();
}

function ensureTerrainLayers(map: MlMap, exaggeration: number, surface: TerrainSurface) {
  const terrainSource = {
    type: "raster-dem" as const,
    tiles: [TERRAIN_3D_SOURCES.terrainTiles],
    tileSize: 256,
    maxzoom: 15,
    encoding: "terrarium" as const,
    attribution: "Terrain: Mapzen/Terrain Tiles on AWS Open Data; source-specific credits",
  };
  if (!map.getSource("terrain")) map.addSource("terrain", terrainSource);
  // MapLibre recommends separate source instances for 3D terrain and
  // hillshade. They share the same immutable tile URL and browser cache.
  if (!map.getSource("terrain-hillshade-dem")) {
    map.addSource("terrain-hillshade-dem", {
      ...terrainSource,
    });
  }
  if (!map.getLayer("terrain-hillshade")) {
    map.addLayer({
      id: "terrain-hillshade",
      type: "hillshade",
      source: "terrain-hillshade-dem",
      paint: {
        "hillshade-exaggeration": surface === "imagery" ? 0.25 : 0.4,
        "hillshade-shadow-color": "#263226",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#56634c",
      },
    });
  }
  map.setTerrain({ source: "terrain", exaggeration });
}

function ensureContextLayers(
  map: MlMap,
  bounds: TerrainBounds | null,
  wetlands: FeatureCollection,
  projectFeatures: FeatureCollection,
) {
  const sources: Array<[string, FeatureCollection]> = [
    ["terrain-study", studyFeatureCollection(bounds)],
    ["terrain-wetlands", wetlands],
    ["terrain-project-context", projectFeatures],
  ];
  for (const [id, data] of sources) {
    const source = map.getSource(id) as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else map.addSource(id, { type: "geojson", data });
  }
  const layers = [
    {
      id: "terrain-project-fill",
      type: "fill" as const,
      source: "terrain-project-context",
      filter: ["==", ["geometry-type"], "Polygon"] as never,
      paint: {
        "fill-color": ["coalesce", ["get", "__terrain_fill"], "#7253a5"],
        "fill-opacity": 0.24,
      },
    },
    {
      id: "terrain-project-line",
      type: "line" as const,
      source: "terrain-project-context",
      filter: ["match", ["geometry-type"], ["Polygon", "LineString"], true, false] as never,
      paint: {
        "line-color": ["coalesce", ["get", "__terrain_stroke"], "#5b3c88"],
        "line-width": 2,
        "line-opacity": 0.9,
      },
    },
    {
      id: "terrain-project-point",
      type: "circle" as const,
      source: "terrain-project-context",
      filter: ["==", ["geometry-type"], "Point"] as never,
      paint: {
        "circle-radius": 5,
        "circle-color": ["coalesce", ["get", "__terrain_fill"], "#7253a5"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "terrain-wetlands-fill",
      type: "fill" as const,
      source: "terrain-wetlands",
      paint: { "fill-color": "#2a9d8f", "fill-opacity": 0.48 },
    },
    {
      id: "terrain-wetlands-line",
      type: "line" as const,
      source: "terrain-wetlands",
      paint: { "line-color": "#087f70", "line-width": 1.5, "line-opacity": 0.9 },
    },
    {
      id: "terrain-study-fill",
      type: "fill" as const,
      source: "terrain-study",
      paint: { "fill-color": "#f4b942", "fill-opacity": 0.08 },
    },
    {
      id: "terrain-study-line",
      type: "line" as const,
      source: "terrain-study",
      paint: { "line-color": "#f59e0b", "line-width": 3, "line-dasharray": [2, 1.5] },
    },
  ];
  for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer as never);
}

const feet = (metres: number | null) =>
  metres === null ? "Unavailable" : `${(metres * 3.28084).toFixed(0)} ft`;

async function waitForTerrainTiles(map: MlMap, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (map.areTilesLoaded()) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(done, 8_000);
    function cleanUp() {
      window.clearTimeout(timeout);
      map.off("idle", done);
      signal.removeEventListener("abort", abort);
    }
    function done() {
      cleanUp();
      resolve();
    }
    function abort() {
      cleanUp();
      reject(new DOMException("Terrain sampling cancelled", "AbortError"));
    }
    map.once("idle", done);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function Terrain3DWorkspace() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const exaggerationRef = useRef(1.35);
  const surfaceRef = useRef<TerrainSurface>("topographic");
  const selectingRef = useRef(false);
  const firstCornerRef = useRef<[number, number] | null>(null);
  const boundsRef = useRef<TerrainBounds | null>(null);
  const contextRef = useRef({ wetlands: emptyCollection(), project: emptyCollection() });
  const { setMap } = useMapRef();
  const wb = useWorkbench();

  const [surface, setSurface] = useState<TerrainSurface>("topographic");
  const [mode, setMode] = useState<TerrainAnalysisMode>("quick");
  const [bounds, setBounds] = useState<TerrainBounds | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [projectContextEnabled, setProjectContextEnabled] = useState(true);
  const [wetlandsEnabled, setWetlandsEnabled] = useState(true);
  const [wetlands, setWetlands] = useState<FeatureCollection>(emptyCollection);
  const [wetlandStatus, setWetlandStatus] = useState<WetlandStatus>("idle");
  const [summary, setSummary] = useState<TerrainGridSummary | null>(null);
  const [summarySource, setSummarySource] = useState<SummarySource | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exaggeration, setExaggeration] = useState(1.35);
  const [pointerElevation, setPointerElevation] = useState<number | null>(null);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");

  boundsRef.current = bounds;
  selectingRef.current = selecting;
  exaggerationRef.current = exaggeration;
  surfaceRef.current = surface;

  const projectFeatures = useMemo<FeatureCollection>(() => {
    if (!projectContextEnabled) return emptyCollection();
    const features: Feature[] = [];
    for (const layer of wb.displayLayers) {
      if (!layer.visible || layer.source.kind === "image" || layer.source.kind === "raster")
        continue;
      for (const feature of layer.data.features) {
        if (features.length >= 15_000) break;
        features.push({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            __terrain_layer: layer.name,
            __terrain_fill: layer.style.fillColor,
            __terrain_stroke: layer.style.strokeColor,
          },
        });
      }
      if (features.length >= 15_000) break;
    }
    return { type: "FeatureCollection", features };
  }, [projectContextEnabled, wb.displayLayers]);

  contextRef.current = {
    wetlands: wetlandsEnabled ? wetlands : emptyCollection(),
    project: projectFeatures,
  };

  const restoreContext = useCallback((map: MlMap) => {
    ensureContextLayers(
      map,
      boundsRef.current,
      contextRef.current.wetlands,
      contextRef.current.project,
    );
    try {
      ensureTerrainLayers(map, exaggerationRef.current, surfaceRef.current);
    } catch (error) {
      console.warn("Terrain 3D enhancement could not be enabled", error);
      setMapStatus("degraded");
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: MlMap;
    try {
      map = new MlMap({
        container: containerRef.current,
        style: terrainReferenceStyle(surface),
        center: (wb.mapView.center ?? [-98.5, 31.3]) as LngLatLike,
        zoom: TERRAIN_3D_DEFAULT_ZOOM,
        bearing: -24,
        pitch: 55,
        attributionControl: { compact: true },
      });
    } catch (error) {
      console.error("Terrain 3D map initialization failed", error);
      setMapStatus("error");
      return;
    }
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-right");
    mapRef.current = map;
    setMap(map);
    const container = containerRef.current;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);
    const resizeFrame = requestAnimationFrame(() => map.resize());
    const onLoad = () => {
      map.resize();
      setMapStatus((status) => (status === "degraded" ? status : "ready"));
    };
    const onError = () => setMapStatus((status) => (status === "error" ? status : "degraded"));
    const onStyle = () => restoreContext(map);
    map.on("load", onLoad);
    map.on("error", onError);
    map.on("style.load", onStyle);
    map.on("mousemove", (event) => {
      const elevation = map.queryTerrainElevation(event.lngLat);
      setPointerElevation(elevation === null ? null : elevation / exaggerationRef.current);
      if (!selectingRef.current || !firstCornerRef.current) return;
      try {
        const preview = normalizeTerrainBounds([
          firstCornerRef.current[0],
          firstCornerRef.current[1],
          event.lngLat.lng,
          event.lngLat.lat,
        ]);
        const source = map.getSource("terrain-study") as GeoJSONSource | undefined;
        source?.setData(studyFeatureCollection(preview));
      } catch {
        // The pointer may temporarily align with the first corner.
      }
    });
    map.on("click", (event) => {
      if (!selectingRef.current) return;
      if (!firstCornerRef.current) {
        firstCornerRef.current = [event.lngLat.lng, event.lngLat.lat];
        toast.info("First corner set", { description: "Tap or click the opposite corner." });
        return;
      }
      try {
        const next = normalizeTerrainBounds([
          firstCornerRef.current[0],
          firstCornerRef.current[1],
          event.lngLat.lng,
          event.lngLat.lat,
        ]);
        setBounds(next);
        boundsRef.current = next;
        setSummary(null);
        setSummarySource(null);
        setAnalysisMessage(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The study area is invalid.");
      } finally {
        firstCornerRef.current = null;
        selectingRef.current = false;
        setSelecting(false);
        map.getCanvas().style.cursor = "";
      }
    });
    return () => {
      analysisAbortRef.current?.abort();
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      map.off("load", onLoad);
      map.off("error", onError);
      map.off("style.load", onStyle);
      map.remove();
      mapRef.current = null;
      setMap(null);
    };
    // The module owns one long-lived map; state changes are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    map.setPaintProperty(
      "surface-topographic",
      "raster-opacity",
      surface === "topographic" ? 1 : 0,
    );
    map.setPaintProperty("surface-imagery", "raster-opacity", surface === "imagery" ? 1 : 0);
    if (map.getLayer("terrain-hillshade"))
      map.setPaintProperty(
        "terrain-hillshade",
        "hillshade-exaggeration",
        surface === "imagery" ? 0.25 : 0.4,
      );
  }, [surface]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    ensureContextLayers(
      map,
      bounds,
      wetlandsEnabled ? wetlands : emptyCollection(),
      projectFeatures,
    );
  }, [bounds, projectFeatures, wetlands, wetlandsEnabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getSource("terrain")) return;
    try {
      map.setTerrain({ source: "terrain", exaggeration });
    } catch (error) {
      console.warn("Terrain exaggeration could not be updated", error);
      setMapStatus("degraded");
    }
  }, [exaggeration]);

  const useCurrentView = () => {
    const map = mapRef.current;
    if (!map) return;
    const view = map.getBounds();
    const next: TerrainBounds = [view.getWest(), view.getSouth(), view.getEast(), view.getNorth()];
    setBounds(next);
    setSummary(null);
    setSummarySource(null);
    setAnalysisMessage(null);
  };

  const startDrawing = () => {
    firstCornerRef.current = null;
    selectingRef.current = true;
    setSelecting(true);
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = "crosshair";
    toast.info("Draw a small study area", {
      description: "Tap or click one corner, then the opposite corner.",
    });
  };

  const resetZoom = () => {
    mapRef.current?.easeTo({
      zoom: TERRAIN_3D_DEFAULT_ZOOM,
      pitch: 55,
      bearing: -24,
      duration: 650,
    });
  };

  const runAnalysis = async () => {
    const map = mapRef.current;
    if (!map || !bounds) {
      toast.error("Select an area first.");
      return;
    }
    let selection: ReturnType<typeof validateTerrainSelection>;
    try {
      selection = validateTerrainSelection(bounds, mode);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The selected area is too large.");
      return;
    }
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setLoading(true);
    setSummary(null);
    setSummarySource(null);
    setAnalysisMessage(null);
    setWetlandStatus(wetlandsEnabled ? "loading" : "idle");
    map.fitBounds(
      [
        [selection.bounds[0], selection.bounds[1]],
        [selection.bounds[2], selection.bounds[3]],
      ],
      {
        padding:
          panelOpen && innerWidth >= 768 ? { left: 360, right: 40, top: 40, bottom: 40 } : 50,
        pitch: 62,
        bearing: -28,
        duration: 900,
      },
    );
    try {
      const terrainPromise = requestTerrainGrid(
        terrainAnalysisInput(selection.bounds, mode),
        controller.signal,
      );
      const wetlandsPromise = wetlandsEnabled
        ? fetchRemoteGeoJSONPaged(TERRAIN_3D_SOURCES.wetlands, {
            bbox: selection.bounds,
            pageSize: 2_000,
            maxTotalFeatures: 8_000,
            geometryPrecision: mode === "detailed" ? 6 : 5,
            maxAllowableOffset: mode === "detailed" ? 0.00001 : 0.00004,
            signal: controller.signal,
          })
        : Promise.resolve(null);
      const [terrainResult, wetlandResult] = await Promise.allSettled([
        terrainPromise,
        wetlandsPromise,
      ]);
      controller.signal.throwIfAborted();
      if (terrainResult.status === "fulfilled" && terrainResult.value) {
        setSummary(summarizeTerrainGrid(terrainResult.value));
        setSummarySource("usgs-3dep");
        setAnalysisMessage(
          `${mode === "detailed" ? "Detailed" : "Quick"} numeric grid retrieved ${new Date(terrainResult.value.retrievedAt).toLocaleString()}.`,
        );
      } else {
        const reason = terrainResult.status === "rejected" ? terrainResult.reason : null;
        let meshEstimate: TerrainGridSummary | null = null;
        if (mode === "quick") {
          await waitForTerrainTiles(map, controller.signal);
          meshEstimate = summarizeTerrainMesh(selection.bounds, 9, (longitude, latitude) => {
            const elevation = map.queryTerrainElevation([longitude, latitude] as LngLatLike);
            return elevation === null ? null : elevation / exaggerationRef.current;
          });
        }
        if (meshEstimate) {
          setSummary(meshEstimate);
          setSummarySource("display-mesh-estimate");
          setAnalysisMessage(
            `USGS numeric analysis is temporarily unavailable (${reason instanceof Error ? reason.message : "no grid returned"}). Showing a clearly labeled quick estimate sampled from the display mesh instead.`,
          );
        } else {
          setAnalysisMessage(
            `The interactive terrain is available, but numeric USGS analysis failed: ${reason instanceof Error ? reason.message : "no grid returned"}.`,
          );
        }
      }
      if (wetlandResult.status === "fulfilled" && wetlandResult.value) {
        setWetlands(wetlandResult.value.data);
        setWetlandStatus(wetlandResult.value.data.features.length ? "loaded" : "empty");
      } else if (wetlandsEnabled) {
        setWetlands(emptyCollection());
        setWetlandStatus("error");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setAnalysisMessage(error instanceof Error ? error.message : "Terrain analysis failed.");
        toast.error("Terrain analysis could not finish");
      }
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setLoading(false);
    }
  };

  const areaKm2 = bounds ? terrainBoundsAreaKm2(bounds) : null;

  return (
    <div className="app-viewport flex flex-col overflow-hidden bg-background">
      <header className="z-30 flex min-h-16 items-center gap-3 border-b border-border bg-card px-3 sm:px-5">
        <a
          href="/"
          className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-accent"
          aria-label="Back to map"
        >
          <ArrowLeft className="size-5" />
        </a>
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <LandDraftMark className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold sm:text-lg">Terrain & Site Context 3D</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {wb.projectName} · preliminary topographic and public-data visualization
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((value) => !value)}
          className="flex min-h-10 items-center gap-1 rounded-xl bg-secondary px-3 text-xs font-semibold"
        >
          {panelOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          {panelOpen ? "Hide" : "Controls"}
        </button>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="absolute inset-0 min-h-[240px] bg-[#dfe8d8]"
          aria-label="Interactive 3D terrain map"
        />

        {mapStatus === "error" && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/95 p-6 text-center">
            <div className="max-w-sm rounded-2xl border border-destructive/30 bg-card p-5 shadow-xl">
              <Mountain className="mx-auto size-8 text-destructive" />
              <h2 className="mt-2 font-bold">The 3D map could not start</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Reload this page. If the problem continues, check that WebGL is enabled in the
                browser.
              </p>
            </div>
          </div>
        )}

        <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-1">
          <div className="rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur">
            <Rotate3D className="mr-1 inline size-3.5" /> Drag to pan · right-drag/two fingers to
            orbit
          </div>
          <button
            type="button"
            onClick={resetZoom}
            className="rounded-full border border-border bg-card/95 px-3 py-1 text-[10px] font-bold shadow-md backdrop-blur hover:bg-accent"
          >
            Zoom {TERRAIN_3D_DEFAULT_ZOOM}
          </button>
          {mapStatus === "degraded" && (
            <div className="max-w-[260px] rounded-full bg-amber-100 px-3 py-1 text-center text-[10px] font-semibold text-amber-950 shadow-md">
              A terrain layer is unavailable; the base map remains visible.
            </div>
          )}
          {pointerElevation !== null && (
            <div className="rounded-full bg-foreground/80 px-3 py-1 text-[10px] text-background">
              Display mesh ≈ {feet(pointerElevation)}
            </div>
          )}
        </div>

        {panelOpen && (
          <aside className="absolute inset-x-2 bottom-2 z-20 max-h-[48dvh] overflow-y-auto rounded-2xl border border-border bg-card/97 p-3 shadow-2xl backdrop-blur md:inset-y-3 md:left-3 md:right-auto md:max-h-none md:w-[338px]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <Mountain className="size-4 text-primary" /> Build a 3D study
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Select a bounded area, then analyze and orbit the result.
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold text-primary">
                OPTIONAL MODULE
              </span>
            </div>

            <section className="space-y-2 rounded-xl border border-border p-2.5">
              <div className="grid grid-cols-2 gap-2">
                {(["quick", "detailed"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setMode(value);
                      setSummary(null);
                      setSummarySource(null);
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-xs ${mode === value ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <strong className="block capitalize">{value}</strong>
                    <span className="text-[10px] text-muted-foreground">
                      ≤ {TERRAIN_3D_LIMITS_KM2[value]} km² ·{" "}
                      {value === "quick" ? "40 m target" : "10 m target"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={useCurrentView}
                  className="flex min-h-10 items-center justify-center gap-1 rounded-xl bg-secondary px-2 text-xs font-semibold"
                >
                  <Eye className="size-4" /> Current view
                </button>
                <button
                  type="button"
                  onClick={startDrawing}
                  className={`flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold ${selecting ? "bg-amber-100 text-amber-950" : "bg-secondary"}`}
                >
                  <Crosshair className="size-4" /> {selecting ? "Pick corners" : "Draw area"}
                </button>
              </div>
              <div className="rounded-lg bg-secondary/60 px-2.5 py-2 text-[10px]">
                {bounds ? (
                  <>
                    <strong>{areaKm2?.toFixed(2)} km² selected</strong>
                    <br />
                    {bounds.map((value) => value.toFixed(5)).join(", ")}
                  </>
                ) : (
                  "No study area selected."
                )}
              </div>
            </section>

            <section className="mt-3 space-y-2 rounded-xl border border-border p-2.5">
              <label className="block text-[11px] font-semibold">Surface coloring</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSurface("topographic")}
                  className={`flex min-h-10 items-center justify-center gap-1 rounded-xl text-xs ${surface === "topographic" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                >
                  <Mountain className="size-4" /> USGS topo
                </button>
                <button
                  type="button"
                  onClick={() => setSurface("imagery")}
                  className={`flex min-h-10 items-center justify-center gap-1 rounded-xl text-xs ${surface === "imagery" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                >
                  <ImageIcon className="size-4" /> Imagery
                </button>
              </div>
              <label className="flex items-center justify-between gap-3 text-[11px]">
                <span>Vertical exaggeration</span>
                <strong>{exaggeration.toFixed(2)}×</strong>
              </label>
              <input
                aria-label="Vertical exaggeration"
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={exaggeration}
                onChange={(event) => setExaggeration(Number(event.target.value))}
                className="w-full accent-primary"
              />
              <label className="flex min-h-9 items-center justify-between gap-3 text-[11px]">
                <span>Mapped wetlands</span>
                <input
                  type="checkbox"
                  checked={wetlandsEnabled}
                  onChange={(event) => setWetlandsEnabled(event.target.checked)}
                  className="size-4 accent-primary"
                />
              </label>
              <label className="flex min-h-9 items-center justify-between gap-3 text-[11px]">
                <span>Visible project/public layers</span>
                <input
                  type="checkbox"
                  checked={projectContextEnabled}
                  onChange={(event) => setProjectContextEnabled(event.target.checked)}
                  className="size-4 accent-primary"
                />
              </label>
            </section>

            <button
              type="button"
              disabled={!bounds || loading}
              onClick={() => void runAnalysis()}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Box className="size-4" />}
              {loading ? "Analyzing sources…" : "Analyze & render in 3D"}
            </button>

            {(summary || analysisMessage) && (
              <section className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-[11px]">
                <h3 className="font-bold">Terrain analysis</h3>
                {summarySource && (
                  <span className="mt-1 inline-flex rounded-full bg-background px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-foreground">
                    {summarySource === "usgs-3dep"
                      ? "USGS 3DEP numeric grid"
                      : "Approximate display-mesh sample"}
                  </span>
                )}
                {analysisMessage && <p className="mt-1 text-muted-foreground">{analysisMessage}</p>}
                {summary && (
                  <dl className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-muted-foreground">Elevation</dt>
                      <dd className="font-semibold">
                        {feet(summary.minimumM)} – {feet(summary.maximumM)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Relief</dt>
                      <dd className="font-semibold">{feet(summary.reliefM)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Actual grid</dt>
                      <dd className="font-semibold">{summary.spacingM.toFixed(1)} m</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Coverage</dt>
                      <dd className="font-semibold">{summary.coveragePercent.toFixed(1)}%</dd>
                    </div>
                  </dl>
                )}
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Missing cells: {summary?.missingCells ?? "—"}. Values are DEM estimates, not
                  surveyed elevations
                  {summarySource === "display-mesh-estimate"
                    ? "; the quick fallback is for general visualization only"
                    : ""}
                  .
                </p>
              </section>
            )}

            <section className="mt-3 rounded-xl bg-secondary/60 p-3 text-[10px] text-muted-foreground">
              <strong className="text-foreground">Context status</strong>
              <p className="mt-1">
                Wetlands:{" "}
                {wetlandStatus === "loaded"
                  ? `${wetlands.features.length.toLocaleString()} mapped features`
                  : wetlandStatus === "empty"
                    ? "none returned for this request — not proof of absence"
                    : wetlandStatus === "error"
                      ? "source unavailable"
                      : wetlandStatus === "loading"
                        ? "loading…"
                        : "not requested"}
                .
              </p>
              <p>
                Project context: {projectFeatures.features.length.toLocaleString()} visible features
                {projectFeatures.features.length >= 15_000 ? " (display budget reached)" : ""}.
              </p>
              <p className="mt-2">
                3D mesh: open Terrarium tiles. Numeric analysis: USGS 3DEP. Surface:{" "}
                {surface === "imagery" ? "Esri World Imagery" : "USGS The National Map"}. Sources
                differ and may not align perfectly.
              </p>
              <a
                href="https://www.usgs.gov/3d-elevation-program/about-3dep-products-services"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block font-semibold text-primary underline"
              >
                USGS 3DEP source information
              </a>
            </section>
          </aside>
        )}
      </main>
    </div>
  );
}
