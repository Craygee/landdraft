import { bbox, booleanPointInPolygon } from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from "geojson";

export const METERS_PER_MILE = 1609.344;

/** Keeps distance work bounded on very detailed boundaries. Distances are reported to 0.1 mile. */
const MAX_BOUNDARY_SEGMENTS = 4_000;

type Segment = [number, number, number, number];

export interface StudyFrame {
  polygons: Feature<Polygon | MultiPolygon>[];
  bounds: [number, number, number, number];
  center: [number, number];
  metersPerLon: number;
  metersPerLat: number;
  segments: Segment[];
}

const rings = (geometry: Polygon | MultiPolygon): Position[][] =>
  geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();

export function createStudyFrame(polygons: Feature<Polygon | MultiPolygon>[]): StudyFrame {
  const bounds = bbox({ type: "FeatureCollection", features: polygons }) as [
    number,
    number,
    number,
    number,
  ];
  const center: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const metersPerLat = 110_574;
  const metersPerLon = 111_320 * Math.cos((center[1] * Math.PI) / 180);
  const toXY = (p: Position): [number, number] => [
    (p[0]! - center[0]) * metersPerLon,
    (p[1]! - center[1]) * metersPerLat,
  ];
  let segments: Segment[] = [];
  for (const polygon of polygons)
    for (const ring of rings(polygon.geometry))
      for (let i = 0; i + 1 < ring.length; i++) {
        const [ax, ay] = toXY(ring[i]!);
        const [bx, by] = toXY(ring[i + 1]!);
        segments.push([ax, ay, bx, by]);
      }
  if (segments.length > MAX_BOUNDARY_SEGMENTS) {
    const step = segments.length / MAX_BOUNDARY_SEGMENTS;
    segments = Array.from(
      { length: MAX_BOUNDARY_SEGMENTS },
      (_, i) => segments[Math.floor(i * step)]!,
    );
  }
  return { polygons, bounds, center, metersPerLon, metersPerLat, segments };
}

export const isInsideStudy = (frame: StudyFrame, position: Position) =>
  frame.polygons.some((polygon) => booleanPointInPolygon(position as [number, number], polygon));

const pointSegment = (px: number, py: number, s: Segment) => {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / lengthSquared))
    : 0;
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
};

/** Coordinate paths in a geometry. A point becomes a single-position path. */
export function geometryPaths(geometry: Geometry): Position[][] {
  switch (geometry.type) {
    case "Point":
      return [[geometry.coordinates]];
    case "MultiPoint":
      return geometry.coordinates.map((position) => [position]);
    case "LineString":
      return [geometry.coordinates];
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates;
    case "MultiPolygon":
      return geometry.coordinates.flat();
    case "GeometryCollection":
      return geometry.geometries.flatMap(geometryPaths);
  }
}

export interface NearestResult {
  meters: number;
  position: Position;
}

/**
 * Approximate shortest distance to the study boundary in a local flat projection, which is
 * suitable for the screening distances reported here. Very detailed features are sampled.
 */
export function distanceToStudy(frame: StudyFrame, geometry: Geometry): NearestResult | null {
  let best: NearestResult | null = null;
  for (const path of geometryPaths(geometry)) {
    const step = Math.max(1, Math.ceil(path.length / 600));
    for (let i = 0; i < path.length; i += step) {
      const position = path[i]!;
      const x = (position[0]! - frame.center[0]) * frame.metersPerLon;
      const y = (position[1]! - frame.center[1]) * frame.metersPerLat;
      for (const segment of frame.segments) {
        const meters = pointSegment(x, y, segment);
        if (!best || meters < best.meters) best = { meters, position };
      }
    }
  }
  return best;
}

/** Length of line geometry inside the study polygon, honoring holes and multiple parts. */
export function lengthInsideStudyMeters(frame: StudyFrame, geometry: Geometry): number {
  if (geometry.type !== "LineString" && geometry.type !== "MultiLineString") return 0;
  const paths = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  const toLonLat = (x: number, y: number): Position => [
    x / frame.metersPerLon + frame.center[0],
    y / frame.metersPerLat + frame.center[1],
  ];
  let total = 0;
  for (const path of paths)
    for (let i = 0; i + 1 < path.length; i++) {
      const ax = (path[i]![0]! - frame.center[0]) * frame.metersPerLon;
      const ay = (path[i]![1]! - frame.center[1]) * frame.metersPerLat;
      const bx = (path[i + 1]![0]! - frame.center[0]) * frame.metersPerLon;
      const by = (path[i + 1]![1]! - frame.center[1]) * frame.metersPerLat;
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const cuts = [0, 1];
      for (const s of frame.segments) {
        if (
          Math.max(ax, bx) < Math.min(s[0], s[2]) ||
          Math.min(ax, bx) > Math.max(s[0], s[2]) ||
          Math.max(ay, by) < Math.min(s[1], s[3]) ||
          Math.min(ay, by) > Math.max(s[1], s[3])
        )
          continue;
        const ex = s[2] - s[0];
        const ey = s[3] - s[1];
        const denominator = dx * ey - dy * ex;
        if (!denominator) continue;
        const t = ((s[0] - ax) * ey - (s[1] - ay) * ex) / denominator;
        const u = ((s[0] - ax) * dy - (s[1] - ay) * dx) / denominator;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      }
      cuts.sort((a, b) => a - b);
      for (let c = 0; c + 1 < cuts.length; c++) {
        const middle = (cuts[c]! + cuts[c + 1]!) / 2;
        if (isInsideStudy(frame, toLonLat(ax + dx * middle, ay + dy * middle)))
          total += (cuts[c + 1]! - cuts[c]!) * length;
      }
    }
  return total;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compassFromCenter(frame: StudyFrame, position: Position): string {
  const x = (position[0]! - frame.center[0]) * frame.metersPerLon;
  const y = (position[1]! - frame.center[1]) * frame.metersPerLat;
  const degrees = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8]!;
}

/** Quick rejection before running an exact intersection on a provider feature. */
export function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function expandBounds(
  bounds: [number, number, number, number],
  miles: number,
): [number, number, number, number] {
  const latitude = (bounds[1] + bounds[3]) / 2;
  const meters = miles * METERS_PER_MILE;
  const lat = meters / 110_574;
  const lon = meters / (111_320 * Math.max(0.05, Math.cos((latitude * Math.PI) / 180)));
  return [
    Math.max(-180, bounds[0] - lon),
    Math.max(-90, bounds[1] - lat),
    Math.min(180, bounds[2] + lon),
    Math.min(90, bounds[3] + lat),
  ];
}
