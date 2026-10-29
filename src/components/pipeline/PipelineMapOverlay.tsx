import { useEffect } from "react";
import type { GeoJSONSource, MapLayerMouseEvent, MapTouchEvent, Map as MlMap } from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";
import { useMapRef } from "@/lib/gis/mapRef";
import type {
  PipelineComponent,
  PipelineProfilePoint,
  PipelineRoute,
  PipelineScenario,
  PipelineVisualizationMode,
} from "@/lib/pipeline/types";

const SOURCE_ID = "landdraft-pipeline-result";
const SCRUB_SOURCE_ID = "landdraft-pipeline-scrub";
const COMPONENT_SOURCE_ID = "landdraft-pipeline-components";
const LINE_ID = "landdraft-pipeline-result-line";
const HIT_ID = "landdraft-pipeline-result-hit";
const SCRUB_ID = "landdraft-pipeline-scrub-point";
const COMPONENT_CIRCLE_ID = "landdraft-pipeline-component-circles";
const COMPONENT_LABEL_ID = "landdraft-pipeline-component-labels";

function resultColor(
  point: PipelineProfilePoint,
  scenario: PipelineScenario,
  mode: PipelineVisualizationMode,
  elevationRange: [number, number],
): string {
  if (mode === "velocity") {
    const ratio = point.velocityMS / Math.max(1e-9, scenario.limits.maximumVelocityMS);
    if (ratio > 1) return "#b91c1c";
    if (ratio > 0.9) return "#ea580c";
    if (ratio > 0.75) return "#d6a10d";
    return "#15803d";
  }
  if (mode === "elevation") {
    const elevation = point.pipelineElevationM ?? point.groundElevationM;
    if (elevation === undefined) return "#64748b";
    const ratio =
      (elevation - elevationRange[0]) / Math.max(1e-9, elevationRange[1] - elevationRange[0]);
    if (ratio > 0.75) return "#7c3aed";
    if (ratio > 0.5) return "#2563eb";
    if (ratio > 0.25) return "#0891b2";
    return "#0f766e";
  }
  if (mode === "minimum-pressure-margin") {
    const margin = point.minimumPressureMarginPa;
    const target = Math.max(1, scenario.limits.minimumPressureMarginPa);
    if (margin < 0) return "#b91c1c";
    if (margin < target) return "#ea580c";
    if (margin < target * 2) return "#d6a10d";
    return "#15803d";
  }
  if (mode === "pressure") {
    if (
      point.pressurePa > scenario.limits.maopPa ||
      point.pressurePa < scenario.limits.minimumPressurePa
    )
      return "#b91c1c";
    const highMargin = scenario.limits.maopPa - point.pressurePa;
    const lowMargin = point.pressurePa - scenario.limits.minimumPressurePa;
    const margin = Math.min(highMargin, lowMargin);
    const target = Math.max(1, scenario.limits.minimumPressureMarginPa);
    if (margin < target) return "#ea580c";
    if (margin < target * 2) return "#d6a10d";
    return "#15803d";
  }
  const margin = point.pressureMarginPa;
  const target = Math.max(1, scenario.limits.minimumPressureMarginPa);
  if (margin < 0) return "#b91c1c";
  if (margin < target) return "#ea580c";
  if (margin < target * 2) return "#d6a10d";
  return "#15803d";
}

function buildSegments(
  profile: PipelineProfilePoint[],
  scenario: PipelineScenario,
  mode: PipelineVisualizationMode,
): FeatureCollection<LineString> {
  const elevations = profile
    .map((point) => point.pipelineElevationM ?? point.groundElevationM)
    .filter((value): value is number => value !== undefined);
  const range: [number, number] = elevations.length
    ? [Math.min(...elevations), Math.max(...elevations)]
    : [0, 1];
  return {
    type: "FeatureCollection",
    // A component emits an upstream/downstream pair at one station; that pair has no length to
    // draw. Each drawn segment is colored by its downstream end, i.e. the arriving state.
    features: profile.slice(1).flatMap((point, index) =>
      point.stationM === profile[index]!.stationM
        ? []
        : [
            {
              type: "Feature" as const,
              properties: {
                color: resultColor(point, scenario, mode, range),
                startStationM: profile[index]!.stationM,
                endStationM: point.stationM,
              },
              geometry: {
                type: "LineString" as const,
                coordinates: [profile[index]!.coordinate, point.coordinate],
              },
            },
          ],
    ),
  };
}

function buildVisibleRoute(
  route: PipelineRoute | undefined,
  profile: PipelineProfilePoint[],
  scenario: PipelineScenario | undefined,
  mode: PipelineVisualizationMode,
): FeatureCollection<LineString> {
  if (scenario && profile.length >= 2) return buildSegments(profile, scenario, mode);
  if (!route || route.coordinates.length < 2) return { type: "FeatureCollection", features: [] };
  const elevations = route.stations
    .map((station) => station.pipelineElevationM ?? station.groundElevationM)
    .filter((value): value is number => value !== undefined);
  const range: [number, number] = elevations.length
    ? [Math.min(...elevations), Math.max(...elevations)]
    : [0, 1];
  const fallbackScenario = scenario ?? {
    limits: {
      maximumVelocityMS: 1,
      minimumPressureMarginPa: 1,
      maopPa: 1,
      minimumPressurePa: 0,
    },
  };
  return {
    type: "FeatureCollection",
    features: route.stations.slice(1).map((station, index) => {
      const start = route.stations[index]!;
      const elevation = station.pipelineElevationM ?? station.groundElevationM;
      const color =
        mode === "elevation" && elevation !== undefined
          ? resultColor(
              {
                stationM: station.stationM,
                coordinate: station.coordinate,
                groundElevationM: elevation,
                pipelineElevationM: elevation,
                pressurePa: 0,
                cumulativeElevationPressureChangePa: 0,
                cumulativeFrictionLossPa: 0,
                cumulativeMinorLossPa: 0,
                cumulativePressureBoostPa: 0,
                pressureMarginPa: 0,
                minimumPressureMarginPa: 0,
                flowM3S: 0,
                velocityMS: 0,
                temperatureK: 0,
                reynoldsNumber: 0,
                frictionFactor: 0,
                pressureLossPaPerM: 0,
                provenance: "provider",
              },
              fallbackScenario as PipelineScenario,
              mode,
              range,
            )
          : "#177542";
      return {
        type: "Feature",
        properties: { color, startStationM: start.stationM, endStationM: station.stationM },
        geometry: { type: "LineString", coordinates: [start.coordinate, station.coordinate] },
      };
    }),
  };
}

function emptyPoint(): FeatureCollection<Point> {
  return { type: "FeatureCollection", features: [] };
}

function componentColor(kind: PipelineComponent["kind"]): string {
  if (kind === "source") return "#15803d";
  if (kind === "destination") return "#b91c1c";
  if (kind === "centrifugal-pump" || kind === "booster-station") return "#2563eb";
  if (kind === "block-valve") return "#d97706";
  if (kind === "flow-meter") return "#7c3aed";
  return "#475569";
}

function componentFeatures(components: PipelineComponent[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: components.map((component) => ({
      type: "Feature",
      id: component.id,
      properties: {
        id: component.id,
        label: component.name,
        color: componentColor(component.kind),
        stationM: component.stationM,
      },
      geometry: { type: "Point", coordinates: component.coordinate },
    })),
  };
}

function ensureLayers(map: MlMap) {
  if (!map.getSource(SOURCE_ID))
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  if (!map.getLayer(LINE_ID))
    map.addLayer({
      id: LINE_ID,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#177542"],
        "line-width": 6,
        "line-opacity": 0.95,
      },
    });
  if (!map.getLayer(HIT_ID))
    map.addLayer({
      id: HIT_ID,
      type: "line",
      source: SOURCE_ID,
      paint: { "line-color": "#000000", "line-width": 24, "line-opacity": 0.01 },
    });
  if (!map.getSource(SCRUB_SOURCE_ID))
    map.addSource(SCRUB_SOURCE_ID, { type: "geojson", data: emptyPoint() });
  if (!map.getLayer(SCRUB_ID))
    map.addLayer({
      id: SCRUB_ID,
      type: "circle",
      source: SCRUB_SOURCE_ID,
      paint: {
        "circle-radius": 7,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#17221a",
        "circle-stroke-width": 3,
      },
    });
  if (!map.getSource(COMPONENT_SOURCE_ID))
    map.addSource(COMPONENT_SOURCE_ID, { type: "geojson", data: emptyPoint() });
  if (!map.getLayer(COMPONENT_CIRCLE_ID))
    map.addLayer({
      id: COMPONENT_CIRCLE_ID,
      type: "circle",
      source: COMPONENT_SOURCE_ID,
      paint: {
        "circle-radius": 7,
        "circle-color": ["coalesce", ["get", "color"], "#475569"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  if (!map.getLayer(COMPONENT_LABEL_ID))
    map.addLayer({
      id: COMPONENT_LABEL_ID,
      type: "symbol",
      source: COMPONENT_SOURCE_ID,
      layout: {
        "text-field": ["coalesce", ["get", "label"], "Component"],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#17221a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
}

function nearestStationFromPoint(
  map: MlMap,
  point: { x: number; y: number },
  route: PipelineRoute,
): { stationM: number; distancePx: number } {
  let best = { distance: Number.POSITIVE_INFINITY, stationM: 0 };
  for (let index = 1; index < route.stations.length; index += 1) {
    const start = route.stations[index - 1]!;
    const end = route.stations[index]!;
    const a = map.project([Number(start.coordinate[0]), Number(start.coordinate[1])]);
    const b = map.project([Number(end.coordinate[0]), Number(end.coordinate[1])]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denominator = dx * dx + dy * dy;
    const fraction =
      denominator === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator));
    const x = a.x + dx * fraction;
    const y = a.y + dy * fraction;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < best.distance)
      best = {
        distance,
        stationM: start.stationM + (end.stationM - start.stationM) * fraction,
      };
  }
  return { stationM: best.stationM, distancePx: best.distance };
}

export function PipelineMapOverlay({
  route,
  profile,
  scenario,
  components,
  mode,
  scrubPoint,
  onScrub,
  placementActive,
  onPlaceComponent,
}: {
  route: PipelineRoute | undefined;
  profile: PipelineProfilePoint[];
  scenario: PipelineScenario | undefined;
  components: PipelineComponent[];
  mode: PipelineVisualizationMode;
  scrubPoint: PipelineProfilePoint | undefined;
  onScrub: (stationM: number | null) => void;
  placementActive: boolean;
  onPlaceComponent: (stationM: number) => void;
}) {
  const { map } = useMapRef();

  useEffect(() => {
    if (!map) return;
    const update = () => {
      if (!map.isStyleLoaded()) return;
      ensureLayers(map);
      const data = buildVisibleRoute(route, profile, scenario, mode);
      (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(data as FeatureCollection);
      (map.getSource(COMPONENT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
        componentFeatures(components),
      );
      if (map.getLayer(LINE_ID)) map.moveLayer(LINE_ID);
      if (map.getLayer(HIT_ID)) map.moveLayer(HIT_ID);
      if (map.getLayer(SCRUB_ID)) map.moveLayer(SCRUB_ID);
      if (map.getLayer(COMPONENT_CIRCLE_ID)) map.moveLayer(COMPONENT_CIRCLE_ID);
      if (map.getLayer(COMPONENT_LABEL_ID)) map.moveLayer(COMPONENT_LABEL_ID);
    };
    update();
    map.on("style.load", update);
    return () => {
      map.off("style.load", update);
    };
  }, [components, map, mode, profile, route, scenario]);

  useEffect(() => {
    if (!map || !map.isStyleLoaded() || !map.getSource(SCRUB_SOURCE_ID)) return;
    const data: FeatureCollection<Point> = scrubPoint
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: scrubPoint.coordinate },
            },
          ],
        }
      : emptyPoint();
    (map.getSource(SCRUB_SOURCE_ID) as GeoJSONSource).setData(data);
  }, [map, scrubPoint]);

  useEffect(() => {
    if (!map || !route) return;
    const handleMouse = (event: MapLayerMouseEvent) => {
      const nearest = nearestStationFromPoint(map, event.point, route);
      if (nearest.distancePx <= 20) onScrub(nearest.stationM);
    };
    const handleLeave = () => onScrub(null);
    const handleClick = (event: MapLayerMouseEvent) => {
      if (!placementActive) return;
      const nearest = nearestStationFromPoint(map, event.point, route);
      if (nearest.distancePx <= 28) onPlaceComponent(nearest.stationM);
    };
    const handleTouch = (event: MapTouchEvent) => {
      const point = event.points[0];
      if (!point) return;
      const nearest = nearestStationFromPoint(map, point, route);
      if (nearest.distancePx <= 28) onScrub(nearest.stationM);
    };
    let attached = false;
    const attach = () => {
      if (attached || !map.getLayer(HIT_ID)) return;
      attached = true;
      map.on("mousemove", HIT_ID, handleMouse);
      map.on("mouseleave", HIT_ID, handleLeave);
      map.on("click", HIT_ID, handleClick);
      map.on("touchmove", handleTouch);
    };
    attach();
    map.on("style.load", attach);
    return () => {
      map.off("style.load", attach);
      if (attached) {
        map.off("mousemove", HIT_ID, handleMouse);
        map.off("mouseleave", HIT_ID, handleLeave);
        map.off("click", HIT_ID, handleClick);
        map.off("touchmove", handleTouch);
      }
    };
  }, [map, onPlaceComponent, onScrub, placementActive, route]);

  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    const previous = canvas.style.cursor;
    if (placementActive) canvas.style.cursor = "crosshair";
    return () => {
      canvas.style.cursor = previous;
    };
  }, [map, placementActive]);

  return null;
}
