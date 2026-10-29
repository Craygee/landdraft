import { useWorkbench } from "@/lib/gis/store";
import { downloadFile, exportLayer } from "@/lib/gis/export";
import {
  elevationCsv,
  elevationGeoJSON,
  elevationSvg,
  elevationFromLayer,
  type SavedElevationProfile,
} from "@/lib/gis/analysisArtifacts";
import { exportSvgReportPdf } from "@/lib/gis/mapPdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Position } from "geojson";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { ChevronDown, ChevronUp, Download, Loader2, Mountain, RotateCcw, X } from "lucide-react";
import { useMapRef } from "@/lib/gis/mapRef";
import {
  profileStations,
  requestElevationProfile,
  type ElevationProfile,
} from "@/lib/gis/elevationProfile";

const sourceId = "profile-route-source";
const lineId = "profile-route-line";
const verticesId = "profile-route-vertices";
const cursorSource = "profile-cursor-source";
const cursorId = "profile-cursor-marker";
const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

export function ElevationProfilePanel() {
  const wb = useWorkbench();
  const { map, setElevationProfileOpen, setPrintOpen, setPendingPrintAnalysisId } = useMapRef();
  const [name, setName] = useState("Elevation profile");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<Position[]>([]);
  const [drawing, setDrawing] = useState(true);
  const [profile, setProfile] = useState<ElevationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [metric, setMetric] = useState(false);
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [windowM, setWindowM] = useState<[number, number] | null>(null);
  const [spacing, setSpacing] = useState(10);
  const [chartWidth, setChartWidth] = useState(1000);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const stateRef = useRef({ coordinates, drawing, loading });
  stateRef.current = { coordinates, drawing, loading };
  const finishRef = useRef<() => void>(() => {});
  const requestId = useRef(0);
  const stations = useMemo(() => {
    try {
      return profileStations(coordinates, spacing);
    } catch {
      return [];
    }
  }, [coordinates, spacing]);
  const distanceM = profile?.distanceM ?? stations.at(-1)?.stationM ?? 0;
  const selected = profile?.points[active];
  const distanceUnit = metric ? "km" : "mi";
  const elevationUnit = metric ? "m" : "ft";
  const distanceValue = (m: number) => m / (metric ? 1000 : 1609.344);
  const elevationValue = (m: number) => m * (metric ? 1 : 1 / 0.3048);
  const fmtElevation = (m: number | null | undefined) =>
    m === null || m === undefined ? "No data" : `${elevationValue(m).toFixed(1)} ${elevationUnit}`;

  const generate = useCallback(async () => {
    const current = stateRef.current;
    if (current.loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++requestId.current;
    setError("");
    setLoading(true);
    setDrawing(false);
    setProfile(null);
    setWindowM(null);
    try {
      const result = await requestElevationProfile(
        current.coordinates,
        spacing,
        controller.signal,
        (done, total) => setProgress(`${done}/${total} samples`),
      );
      if (controller.signal.aborted || generation !== requestId.current) return;
      if (result.points.every((p) => p.elevationM === null))
        throw new Error(
          "USGS returned no terrain coverage for this path. Try another area or retry.",
        );
      setProfile(result);
      setActive(0);
    } catch (e) {
      if (!controller.signal.aborted && generation === requestId.current)
        setError(e instanceof Error ? e.message : "The elevation profile could not be loaded.");
    } finally {
      if (generation === requestId.current) setLoading(false);
    }
  }, [spacing]);
  finishRef.current = () => void generate();

  useEffect(
    () => () => {
      requestId.current++;
      abortRef.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!map) return;
    const doubleClickWasEnabled = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    const onClick = (event: MapMouseEvent) => {
      if (!stateRef.current.drawing || stateRef.current.loading || event.originalEvent.detail > 1)
        return;
      setCoordinates((current) =>
        current.length >= 128 ? current : [...current, [event.lngLat.lng, event.lngLat.lat]],
      );
    };
    const onDoubleClick = (event: MapMouseEvent) => {
      if (stateRef.current.drawing && stateRef.current.coordinates.length >= 2) {
        event.preventDefault();
        finishRef.current();
      }
    };
    map.on("click", onClick);
    map.on("dblclick", onDoubleClick);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDoubleClick);
      if (doubleClickWasEnabled) map.doubleClickZoom.enable();
    };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas(),
      previous = canvas.style.cursor;
    if (drawing) canvas.style.cursor = "crosshair";
    return () => {
      canvas.style.cursor = previous;
    };
  }, [map, drawing]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (event.key === "Escape") setElevationProfileOpen(false);
      if (
        event.key === "Enter" &&
        stateRef.current.drawing &&
        stateRef.current.coordinates.length >= 2
      ) {
        event.preventDefault();
        finishRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [setElevationProfileOpen]);
  useEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    const previous = document.body.style.getPropertyValue("--landdraft-profile-height");
    const update = () =>
      document.body.style.setProperty(
        "--landdraft-profile-height",
        `${element.getBoundingClientRect().height}px`,
      );
    const resize = () => {
      update();
      setChartWidth(Math.max(240, Math.round(element.clientWidth - 24)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      observer.disconnect();
      if (previous) document.body.style.setProperty("--landdraft-profile-height", previous);
      else document.body.style.removeProperty("--landdraft-profile-height");
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    const route: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        ...(coordinates.length >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates },
              },
            ]
          : []),
        ...coordinates.map((p) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: p },
        })),
      ],
    };
    const cursor: FeatureCollection = selected
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [selected.longitude, selected.latitude] },
            },
          ],
        }
      : empty;
    const sync = () => {
      if (!map.getStyle()) return;
      if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", data: route });
      else (map.getSource(sourceId) as GeoJSONSource).setData(route);
      if (!map.getLayer(lineId))
        map.addLayer({
          id: lineId,
          type: "line",
          source: sourceId,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#d97706", "line-width": 4 },
        });
      if (!map.getLayer(verticesId))
        map.addLayer({
          id: verticesId,
          type: "circle",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 4,
            "circle-color": "#fff",
            "circle-stroke-color": "#b45309",
            "circle-stroke-width": 2,
          },
        });
      if (!map.getSource(cursorSource))
        map.addSource(cursorSource, { type: "geojson", data: cursor });
      else (map.getSource(cursorSource) as GeoJSONSource).setData(cursor);
      if (!map.getLayer(cursorId))
        map.addLayer({
          id: cursorId,
          type: "circle",
          source: cursorSource,
          paint: {
            "circle-radius": 7,
            "circle-color": "#dc2626",
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 2,
          },
        });
      for (const id of [lineId, verticesId, cursorId]) map.moveLayer(id);
    };
    const lift = () => {
      if (map.getLayer(cursorId) && map.getStyle().layers?.at(-1)?.id !== cursorId) {
        for (const id of [lineId, verticesId, cursorId]) if (map.getLayer(id)) map.moveLayer(id);
      }
    };
    sync();
    map.on("idle", lift);
    map.on("style.load", sync);
    return () => {
      map.off("style.load", sync);
      map.off("idle", lift);
    };
  }, [map, coordinates, selected]);
  useEffect(
    () => () => {
      if (!map) return;
      for (const id of [cursorId, verticesId, lineId]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [cursorSource, sourceId]) if (map.getSource(id)) map.removeSource(id);
    },
    [map],
  );

  const range = windowM ?? [0, distanceM];
  const visible =
    profile?.points.filter((p) => p.stationM >= range[0] && p.stationM <= range[1]) ?? [];
  const heights = visible.flatMap((p) => (p.elevationM === null ? [] : [p.elevationM]));
  const bottom = heights.length ? Math.min(...heights) : 0;
  const top = heights.length ? Math.max(...heights) : 1;
  const heightRange = Math.max(1, top - bottom);
  const x = (m: number) =>
    64 + ((m - range[0]) / Math.max(1, range[1] - range[0])) * (chartWidth - 76);
  const y = (m: number) => 18 + ((top - m) / heightRange) * 112;
  const paths: string[] = [];
  let current = "";
  for (const p of visible) {
    if (p.elevationM === null) {
      if (current) paths.push(current);
      current = "";
    } else current += `${current ? "L" : "M"}${x(p.stationM)},${y(p.elevationM)} `;
  }
  if (current) paths.push(current);
  const selectFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!profile) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const target =
      range[0] +
      Math.max(
        0,
        Math.min(
          1,
          (((event.clientX - rect.left) / rect.width) * chartWidth - 64) / (chartWidth - 76),
        ),
      ) *
        (range[1] - range[0]);
    let index = 0;
    for (let i = 1; i < profile.points.length; i++)
      if (
        Math.abs(profile.points[i]!.stationM - target) <
        Math.abs(profile.points[index]!.stationM - target)
      )
        index = i;
    setActive(index);
  };
  const zoomChart = (factor: number) => {
    const span = Math.min(distanceM, Math.max(10, (range[1] - range[0]) * factor));
    const center = selected?.stationM ?? (range[0] + range[1]) / 2;
    const start = Math.max(0, Math.min(distanceM - span, center - span / 2));
    setWindowM([start, start + span]);
  };
  const clear = () => {
    setSavedId(null);
    requestId.current++;
    abortRef.current?.abort();
    setLoading(false);
    setProfile(null);
    setCoordinates([]);
    setWindowM(null);
    setError("");
    setDrawing(true);
    setCollapsed(false);
  };
  const snapshot = (): SavedElevationProfile => ({
    schemaVersion: 1,
    name,
    coordinates: structuredClone(coordinates),
    profile: structuredClone(profile!),
  });
  const saveProfile = () => {
    if (!profile || drawing || loading || !wb.canEditProject) return null;
    const saved = snapshot(),
      data = elevationGeoJSON(saved);
    data.features = data.features.filter((f) => f.properties?.["kind"] === "path");
    const source = {
      kind: "derived" as const,
      sourceLayerId: "elevation-profile",
      query: "Elevation profile",
      cachedAt: new Date(profile.retrievedAt).toISOString(),
      cacheProvenance: { elevationProfile: saved },
    };
    if (savedId && wb.layers.some((l) => l.id === savedId)) {
      wb.updateLayer(savedId, { name, data, source });
      return savedId;
    }
    const id = wb.addLayer({
      name,
      data,
      source,
      groupId: wb.derivedLayerGroupId,
      style: { strokeColor: "#bf6d13", strokeWidth: 3, labelEnabled: false },
    }).id;
    setSavedId(id);
    return id;
  };
  const download = () => {
    if (profile)
      downloadFile(
        new Blob([elevationCsv(snapshot())], { type: "text/csv" }),
        "elevation-profile.csv",
      );
  };

  return (
    <section
      ref={panelRef}
      aria-label="Elevation profile"
      data-collapsed={collapsed}
      className="elevation-profile-panel panel-surface absolute inset-x-2 bottom-2 z-[65] max-h-[48dvh] overflow-y-auto rounded-2xl p-3 shadow-float"
    >
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-card">
        <Mountain className="size-5 text-primary" />
        <h2 className="mr-auto text-sm font-bold">Elevation profile</h2>
        <button
          onClick={() => setMetric(!metric)}
          className="min-h-11 rounded-xl border px-3 text-xs"
        >
          {metric ? "Metric" : "Imperial"}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand elevation profile" : "Collapse elevation profile"}
          className="size-11 rounded-xl border"
        >
          {collapsed ? (
            <ChevronUp className="mx-auto size-4" />
          ) : (
            <ChevronDown className="mx-auto size-4" />
          )}
        </button>
        <button
          onClick={() => setElevationProfileOpen(false)}
          aria-label="Close elevation profile"
          className="size-11 rounded-xl border"
        >
          <X className="mx-auto size-4" />
        </button>
      </header>
      <details className="my-2 rounded-xl border p-2">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Saved profiles, print &amp; export
        </summary>
        <div className="flex flex-wrap gap-2 pb-2">
          <input
            aria-label="Profile name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 rounded-xl border px-3"
          />
          <select
            aria-label="Open saved elevation profile"
            className="min-h-11 rounded-xl border px-3"
            value=""
            onChange={(e) => {
              const layer = wb.layers.find((l) => l.id === e.target.value);
              const saved = layer && elevationFromLayer(layer);
              if (!saved || !layer) return;
              abortRef.current?.abort();
              requestId.current++;
              setName(layer.name);
              setCoordinates(structuredClone(saved.coordinates));
              setProfile(structuredClone(saved.profile));
              setDrawing(false);
              setLoading(false);
              setSavedId(layer.id);
              setWindowM(null);
              setActive(0);
            }}
          >
            <option value="">Open saved profile…</option>
            {wb.layers
              .filter((l) => elevationFromLayer(l))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
          {profile && !drawing && !loading && (
            <>
              <button
                className="min-h-11 rounded-xl border px-3"
                disabled={!wb.canEditProject}
                onClick={saveProfile}
              >
                Save profile
              </button>
              <button
                className="min-h-11 rounded-xl border px-3"
                disabled={!wb.canEditProject}
                onClick={() => {
                  const id = saveProfile();
                  if (id) {
                    setPendingPrintAnalysisId(id);
                    setElevationProfileOpen(false);
                    setPrintOpen(true);
                  }
                }}
              >
                Add to Print Map
              </button>
              <button
                className="min-h-11 rounded-xl border px-3"
                onClick={() => void exportLayer(elevationGeoJSON(snapshot()), name, "geojson")}
              >
                Export GeoJSON
              </button>
              <button
                className="min-h-11 rounded-xl border px-3"
                onClick={() =>
                  downloadFile(
                    new Blob([elevationSvg(snapshot())], { type: "image/svg+xml" }),
                    "elevation-profile.svg",
                  )
                }
              >
                Export graph SVG
              </button>
              <button
                className="min-h-11 rounded-xl border px-3"
                onClick={() =>
                  void exportSvgReportPdf(elevationSvg(snapshot()), name).catch((e) =>
                    setError(String(e)),
                  )
                }
              >
                Export profile PDF
              </button>
            </>
          )}
        </div>
      </details>

      {!collapsed && (
        <>
          <details open={!profile} className="text-xs">
            <summary className="cursor-pointer py-1 font-semibold">
              {profile ? "Path settings" : "Draw elevation path"}
            </summary>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <p className="mr-auto">
                {drawing
                  ? "Click / tap the map to draw a path. Pan normally."
                  : loading
                    ? `Querying USGS · ${progress}`
                    : "Hover, touch, or use the cursor slider to inspect the path."}{" "}
                · {coordinates.length} vertices
              </p>
              <button onClick={() => map?.zoomIn()} className="min-h-11 rounded-xl border px-3">
                Map zoom +
              </button>
              <button onClick={() => map?.zoomOut()} className="min-h-11 rounded-xl border px-3">
                Map zoom −
              </button>
              {drawing && (
                <button
                  disabled={!coordinates.length}
                  onClick={() => setCoordinates((p) => p.slice(0, -1))}
                  className="min-h-11 rounded-xl border px-3 disabled:opacity-40"
                >
                  Undo point
                </button>
              )}
              {!drawing && (
                <button
                  disabled={loading}
                  onClick={() => {
                    setProfile(null);
                    setDrawing(true);
                    setWindowM(null);
                  }}
                  className="min-h-11 rounded-xl border px-3 disabled:opacity-40"
                >
                  Edit path
                </button>
              )}
              <label className="flex items-center gap-1">
                Target spacing{" "}
                <select
                  value={spacing}
                  disabled={loading}
                  onChange={(e) => setSpacing(Number(e.target.value))}
                  className="min-h-11 rounded-xl border bg-card px-2 text-base sm:text-xs"
                >
                  <option value={10}>10 m</option>
                  <option value={25}>25 m</option>
                  <option value={50}>50 m</option>
                  <option value={100}>100 m</option>
                </select>
              </label>
              <button
                disabled={coordinates.length < 2 || loading}
                onClick={() => void generate()}
                className="flex min-h-11 items-center gap-1 rounded-xl bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-40"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                {profile ? "Recalculate" : "Generate profile"}
              </button>
              <button
                onClick={clear}
                aria-label="Draw a new elevation path"
                className="min-h-11 rounded-xl border px-3"
              >
                <RotateCcw className="inline size-3.5" /> New path
              </button>
              {loading && (
                <button
                  onClick={() => {
                    requestId.current++;
                    abortRef.current?.abort();
                    setLoading(false);
                    setError("Request cancelled. Retry to load this path.");
                  }}
                  className="min-h-11 rounded-xl border px-3"
                >
                  Cancel request
                </button>
              )}
            </div>
          </details>
          {error && (
            <p
              role="alert"
              className="my-2 rounded-xl bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-live="polite">
            <span>
              Total map distance{" "}
              <strong>
                {distanceValue(distanceM).toFixed(3)} {distanceUnit}
              </strong>
            </span>
            {profile && profile.maximumSpacingM > spacing * 1.5 && (
              <p role="status" className="my-1 text-xs text-amber-800">
                Long route: the 384-sample limit increased spacing to{" "}
                {profile.maximumSpacingM.toFixed(1)} m. Shorten the path for closer sampling.
              </p>
            )}
            {profile?.missing ? (
              <p role="status" className="my-1 text-xs text-amber-800">
                {profile.missing} of {profile.points.length} elevations are missing. Gaps are shown;
                gain/loss totals are partial.
              </p>
            ) : null}
            {profile && (
              <>
                <span>
                  Min / max{" "}
                  <strong>
                    {fmtElevation(profile.minimumM)} / {fmtElevation(profile.maximumM)}
                  </strong>
                </span>
                <span>
                  {profile.missing ? "Partial sampled" : "Sampled"} gain / loss{" "}
                  <strong>
                    +{fmtElevation(profile.ascentM)} / −{fmtElevation(profile.descentM)}
                  </strong>
                </span>
                <span>
                  Steepest sampled grade{" "}
                  <strong>
                    {profile.steepestGradePercent === null
                      ? "No data"
                      : `${profile.steepestGradePercent.toFixed(1)}%`}
                  </strong>
                </span>
              </>
            )}
          </div>
          {profile && (
            <>
              <svg
                viewBox={`0 0 ${chartWidth} 160`}
                className="mt-2 h-40 w-full touch-none"
                role="img"
                aria-label="Terrain elevation versus distance along the drawn path. Gaps indicate missing elevations."
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  selectFromPointer(event);
                }}
                onPointerMove={selectFromPointer}
              >
                {[0, 0.5, 1].map((r) => (
                  <g key={r}>
                    <line
                      x1="64"
                      x2={chartWidth - 12}
                      y1={18 + r * 112}
                      y2={18 + r * 112}
                      stroke="currentColor"
                      opacity=".15"
                    />
                    <text
                      x="58"
                      y={22 + r * 112}
                      textAnchor="end"
                      fontSize="11"
                      fill="currentColor"
                    >
                      {elevationValue(top - r * heightRange).toFixed(0)}
                    </text>
                  </g>
                ))}
                {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                  <text
                    key={r}
                    x={64 + r * (chartWidth - 76)}
                    y="150"
                    textAnchor={r === 0 ? "start" : r === 1 ? "end" : "middle"}
                    fontSize="11"
                    fill="currentColor"
                  >
                    {distanceValue(range[0] + r * (range[1] - range[0])).toFixed(2)}
                  </text>
                ))}
                {paths.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke="#1e6f43"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {selected && selected.stationM >= range[0] && selected.stationM <= range[1] && (
                  <>
                    <line
                      x1={x(selected.stationM)}
                      x2={x(selected.stationM)}
                      y1="15"
                      y2="132"
                      stroke="#dc2626"
                      strokeDasharray="4 3"
                    />
                    {selected.elevationM !== null && (
                      <circle
                        cx={x(selected.stationM)}
                        cy={y(selected.elevationM)}
                        r="4"
                        fill="#dc2626"
                      />
                    )}
                  </>
                )}
                <text x="10" y="10" fontSize="10" fill="currentColor">
                  {elevationUnit}
                </text>
                <text
                  x={chartWidth - 12}
                  y="160"
                  textAnchor="end"
                  fontSize="10"
                  fill="currentColor"
                >
                  {distanceUnit}
                </text>
              </svg>
              <label className="flex items-center gap-2 text-xs">
                Profile cursor
                <input
                  type="range"
                  min={0}
                  max={profile.points.length - 1}
                  value={active}
                  onChange={(e) => setActive(Number(e.target.value))}
                  className="min-h-8 min-w-0 flex-1 accent-primary"
                />
              </label>
              <p className="text-xs" aria-live="polite">
                At {distanceValue(selected?.stationM ?? 0).toFixed(3)} {distanceUnit} · Elevation{" "}
                <strong>{fmtElevation(selected?.elevationM)}</strong> · Incoming segment grade{" "}
                <strong>{selected?.gradePercent?.toFixed(1) ?? "—"}%</strong> (
                {selected?.slopeDegrees?.toFixed(1) ?? "—"}°)
              </p>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer py-1 font-semibold">
                  Graph zoom, map cursor & export
                </summary>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => zoomChart(0.5)}
                    className="min-h-11 rounded-xl border px-3"
                  >
                    Zoom graph +
                  </button>
                  <button onClick={() => zoomChart(2)} className="min-h-11 rounded-xl border px-3">
                    −
                  </button>
                  <button
                    onClick={() => setWindowM(null)}
                    className="min-h-11 rounded-xl border px-3"
                  >
                    Full route
                  </button>
                  <button
                    onClick={() =>
                      selected && map?.easeTo({ center: [selected.longitude, selected.latitude] })
                    }
                    className="min-h-11 rounded-xl border px-3"
                  >
                    Center on cursor
                  </button>
                  <button onClick={download} className="min-h-11 rounded-xl border px-3">
                    <Download className="inline size-3.5" /> CSV
                  </button>
                </div>
              </details>
              <details className="mt-2 text-[11px] text-muted-foreground">
                <summary className="cursor-pointer">
                  Source, sampling and accuracy{" "}
                  {profile.missing > 0 ? `· ${profile.missing} missing samples` : ""}
                </summary>
                <p>
                  {profile.source} · retrieved {new Date(profile.retrievedAt).toLocaleString()} ·{" "}
                  {profile.points.length} samples · maximum spacing{" "}
                  {profile.maximumSpacingM.toFixed(1)} m. {profile.verticalDatum}.
                </p>
                <p>
                  Resolution reported by provider:{" "}
                  {[
                    ...new Set(
                      profile.points.flatMap((p) =>
                        p.resolutionM === undefined ? [] : [p.resolutionM],
                      ),
                    ),
                  ].join(", ") || "not supplied"}{" "}
                  m. Sampling spacing is not source resolution or vertical accuracy. Elevations are
                  interpolated bare-earth terrain, not a survey; grade is rise/run between adjacent
                  samples. Gain/loss and steepest grade are sampled estimates; small terrain
                  features may be missed. Missing samples remain gaps.
                </p>
                <a
                  href="https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  USGS elevation accuracy guidance
                </a>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
