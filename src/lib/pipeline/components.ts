import type { Position } from "geojson";
import { coordinateDistanceM, pointAtStation } from "./model.ts";
import type { PipelineComponent, PipelineComponentKind, PipelineRoute } from "./types.ts";

export interface PipelineComponentTemplate {
  kind: PipelineComponentKind;
  label: string;
  defaultProperties: Record<string, number | string | boolean | null>;
}

export const PIPELINE_COMPONENT_TEMPLATES: PipelineComponentTemplate[] = [
  { kind: "source", label: "Source", defaultProperties: {} },
  { kind: "destination", label: "Destination", defaultProperties: {} },
  {
    kind: "block-valve",
    label: "Valve",
    defaultProperties: { minorLossK: 0.2, normallyOpen: true, basis: "screening-default" },
  },
  {
    kind: "centrifugal-pump",
    label: "Pump",
    defaultProperties: { pressureBoostPa: 0, basis: "user-input-required" },
  },
  {
    kind: "flow-meter",
    label: "Meter",
    defaultProperties: { minorLossK: 2, basis: "screening-default" },
  },
  {
    kind: "booster-station",
    label: "Booster",
    defaultProperties: { pressureBoostPa: 0, basis: "user-input-required" },
  },
];

export function componentTemplate(kind: PipelineComponentKind): PipelineComponentTemplate {
  return (
    PIPELINE_COMPONENT_TEMPLATES.find((template) => template.kind === kind) ?? {
      kind,
      label: kind.replaceAll("-", " "),
      defaultProperties: {},
    }
  );
}

export function createPipelineComponent(input: {
  route: PipelineRoute;
  kind: PipelineComponentKind;
  stationM: number;
  sequence: number;
}): PipelineComponent {
  const template = componentTemplate(input.kind);
  const now = Date.now();
  const stationM = Math.max(0, Math.min(input.route.lengthM, input.stationM));
  return {
    id: `component-${input.kind}-${now}-${input.sequence}`,
    routeId: input.route.id,
    kind: input.kind,
    name: `${template.label} ${input.sequence}`,
    stationM,
    coordinate: pointAtStation(input.route, stationM),
    properties: { ...template.defaultProperties },
    source: "user",
    createdAt: now,
    updatedAt: now,
  };
}

/** A route edit that moves a component farther than this flags it for user review. */
export const COMPONENT_REVIEW_DISTANCE_M = 1;
const ENDPOINT_TOLERANCE_M = 0.5;
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Nearest point on the route centerline to a coordinate. Each segment is projected onto a local
 * equirectangular plane, which is accurate to well under a metre at route-vertex spacing.
 */
export function projectOntoRoute(
  route: PipelineRoute,
  coordinate: Position,
): { stationM: number; offsetM: number } {
  const stations = route.stations;
  if (stations.length < 2) return { stationM: 0, offsetM: Number.POSITIVE_INFINITY };
  let best = { stationM: 0, offsetM: Number.POSITIVE_INFINITY };
  for (let index = 1; index < stations.length; index += 1) {
    const start = stations[index - 1]!;
    const end = stations[index]!;
    const metresPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_M;
    const metresPerDegreeLon =
      metresPerDegreeLat * Math.cos((Number(start.coordinate[1]) * Math.PI) / 180);
    const toLocal = (point: Position): [number, number] => [
      (Number(point[0]) - Number(start.coordinate[0])) * metresPerDegreeLon,
      (Number(point[1]) - Number(start.coordinate[1])) * metresPerDegreeLat,
    ];
    const [ex, ey] = toLocal(end.coordinate);
    const [px, py] = toLocal(coordinate);
    const lengthSquared = ex * ex + ey * ey;
    const t =
      lengthSquared <= 0 ? 0 : Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
    const offsetM = Math.hypot(px - t * ex, py - t * ey);
    if (offsetM < best.offsetM)
      best = { stationM: start.stationM + t * (end.stationM - start.stationM), offsetM };
  }
  return best;
}

/**
 * Keeps components where the user put them when the route geometry changes: each one moves to the
 * nearest point on the edited centerline. Sources and destinations placed at a route end stay on
 * that end. Anything that moves more than COMPONENT_REVIEW_DISTANCE_M is flagged for review rather
 * than silently relocated.
 */
export function reprojectRouteComponents(
  components: PipelineComponent[],
  previousRoute: PipelineRoute,
  nextRoute: PipelineRoute,
): PipelineComponent[] {
  const now = Date.now();
  return components.map((component) => {
    if (component.routeId !== previousRoute.id) return component;
    let stationM: number;
    if (component.kind === "source" && component.stationM <= ENDPOINT_TOLERANCE_M) stationM = 0;
    else if (
      component.kind === "destination" &&
      component.stationM >= previousRoute.lengthM - ENDPOINT_TOLERANCE_M
    )
      stationM = nextRoute.lengthM;
    else stationM = projectOntoRoute(nextRoute, component.coordinate).stationM;
    stationM = Math.max(0, Math.min(nextRoute.lengthM, stationM));
    const coordinate = pointAtStation(nextRoute, stationM);
    const movedM = coordinateDistanceM(component.coordinate, coordinate);
    const anchoredToEnd =
      (component.kind === "source" && stationM === 0) ||
      (component.kind === "destination" && stationM === nextRoute.lengthM);
    const placementReview =
      movedM > COMPONENT_REVIEW_DISTANCE_M && !anchoredToEnd
        ? {
            previousStationM: component.placementReview?.previousStationM ?? component.stationM,
            movedM: (component.placementReview?.movedM ?? 0) + movedM,
            detectedAt: now,
          }
        : component.placementReview;
    return {
      ...component,
      stationM,
      coordinate,
      ...(placementReview ? { placementReview } : {}),
      updatedAt: now,
    };
  });
}

/** Moves a component to a user-entered station and records that its placement is confirmed. */
export function moveComponentToStation(
  component: PipelineComponent,
  route: PipelineRoute,
  requestedStationM: number,
): PipelineComponent {
  const stationM = Math.max(0, Math.min(route.lengthM, requestedStationM));
  const { placementReview: _placementReview, ...confirmed } = component;
  return {
    ...confirmed,
    stationM,
    coordinate: pointAtStation(route, stationM),
    updatedAt: Date.now(),
  };
}

export function numericComponentProperty(
  component: PipelineComponent,
  property: "minorLossK" | "pressureBoostPa",
): number {
  const value = component.properties[property];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
