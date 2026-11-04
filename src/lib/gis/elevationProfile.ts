import { along, length, lineString } from "@turf/turf";
import type { Position } from "geojson";
import type {
  TerrainSampleRequestPoint,
  TerrainSampleResponse,
  TerrainSampleResponsePoint,
} from "../pipeline/elevation.ts";

export const PROFILE_MAX_SAMPLES = 384;
export const PROFILE_MAX_LENGTH_M = 100_000;
export const PROFILE_DEFAULT_SPACING_M = 10;

export interface ProfilePoint extends TerrainSampleResponsePoint {
  gradePercent: number | null;
  slopeDegrees: number | null;
  observed: boolean;
  interpolated: boolean;
}
export interface ElevationProfile {
  points: ProfilePoint[];
  distanceM: number;
  minimumM: number | null;
  maximumM: number | null;
  ascentM: number;
  descentM: number;
  steepestGradePercent: number | null;
  missing: number;
  interpolated: number;
  maximumSpacingM: number;
  source: string;
  verticalDatum: string;
  retrievedAt: number;
}

/** Include all drawn corners and endpoints, with bounded geodesic sampling in between. */
export function profileStations(
  coordinates: Position[],
  spacingM = PROFILE_DEFAULT_SPACING_M,
  maxSamples = PROFILE_MAX_SAMPLES,
): TerrainSampleRequestPoint[] {
  if (
    coordinates.length < 2 ||
    coordinates.length > 128 ||
    !Number.isFinite(spacingM) ||
    spacingM < 1
  )
    throw new Error("Draw between 2 and 128 vertices and use a spacing of at least 1 meter.");
  if (
    coordinates.some(
      (p) =>
        p.length < 2 ||
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1]) ||
        Math.abs(p[0]!) > 180 ||
        Math.abs(p[1]!) > 90,
    )
  )
    throw new Error("The path contains an invalid coordinate.");
  const clean = coordinates.filter(
    (p, i) => i === 0 || p[0] !== coordinates[i - 1]![0] || p[1] !== coordinates[i - 1]![1],
  );
  if (clean.length < 2) throw new Error("The path needs two different locations.");
  const line = lineString(clean);
  const total = length(line, { units: "meters" });
  if (total < 1 || total > PROFILE_MAX_LENGTH_M)
    throw new Error("Choose a path between 1 meter and 100 km.");
  const boundedMaximum = Math.max(clean.length, Math.min(PROFILE_MAX_SAMPLES, maxSamples));
  const intervals = Math.min(Math.ceil(total / spacingM), boundedMaximum - clean.length + 1);
  const distances = Array.from({ length: intervals + 1 }, (_, i) =>
    i === intervals ? total : (total * i) / intervals,
  );
  let cumulative = 0;
  const vertices = new Map<number, Position>([
    [0, clean[0]!],
    [total, clean.at(-1)!],
  ]);
  for (let i = 1; i < clean.length - 1; i++) {
    cumulative += length(lineString([clean[i - 1]!, clean[i]!]), { units: "meters" });
    distances.push(cumulative);
    vertices.set(cumulative, clean[i]!);
  }
  return [...new Set(distances)]
    .sort((a, b) => a - b)
    .map((stationM) => {
      const p =
        vertices.get(stationM) ?? along(line, stationM, { units: "meters" }).geometry.coordinates;
      return { stationM, longitude: p[0]!, latitude: p[1]! };
    });
}

function filledElevations(points: TerrainSampleResponsePoint[]): Array<number | null> {
  const result = points.map((point) =>
    typeof point.elevationM === "number" && Number.isFinite(point.elevationM)
      ? point.elevationM
      : null,
  );
  const observed = result.flatMap((value, index) => (value === null ? [] : [index]));
  if (!observed.length) return result;
  for (let index = 0; index < result.length; index++) {
    if (result[index] !== null) continue;
    const left = [...observed].reverse().find((candidate) => candidate < index);
    const right = observed.find((candidate) => candidate > index);
    if (left === undefined) result[index] = result[right!]!;
    else if (right === undefined) result[index] = result[left]!;
    else {
      const start = points[left]!.stationM;
      const end = points[right]!.stationM;
      const ratio = end === start ? 0 : (points[index]!.stationM - start) / (end - start);
      result[index] = result[left]! + (result[right]! - result[left]!) * ratio;
    }
  }
  return result;
}

export function analyzeProfile(
  response: TerrainSampleResponse,
  fillMissing = false,
): ElevationProfile {
  let ascentM = 0,
    descentM = 0,
    maximumSpacingM = 0;
  const originalElevations = response.points.map((point) =>
    typeof point.elevationM === "number" && Number.isFinite(point.elevationM)
      ? point.elevationM
      : null,
  );
  const elevationsForAnalysis = fillMissing
    ? filledElevations(response.points)
    : originalElevations;
  const points: ProfilePoint[] = response.points.map((p, i) => {
    const elevationM = elevationsForAnalysis[i] ?? null;
    const previous = response.points[i - 1];
    const previousElevation = elevationsForAnalysis[i - 1] ?? null;
    const dx = previous ? p.stationM - previous.stationM : 0;
    maximumSpacingM = Math.max(maximumSpacingM, dx);
    const valid = elevationM !== null && previous && previousElevation !== null && dx > 0;
    const dz = valid ? elevationM! - previousElevation! : null;
    if (dz !== null) {
      ascentM += Math.max(0, dz);
      descentM += Math.max(0, -dz);
    }
    const gradePercent = dz === null ? null : (dz / dx) * 100;
    return {
      ...p,
      elevationM,
      observed: originalElevations[i] !== null,
      interpolated: originalElevations[i] === null && elevationM !== null,
      gradePercent,
      slopeDegrees: gradePercent === null ? null : (Math.atan(gradePercent / 100) * 180) / Math.PI,
    };
  });
  const elevations = points.flatMap((p) => (p.elevationM === null ? [] : [p.elevationM]));
  const grades = points.flatMap((p) => (p.gradePercent === null ? [] : [Math.abs(p.gradePercent)]));
  return {
    points,
    distanceM: points.at(-1)?.stationM ?? 0,
    minimumM: elevations.length ? Math.min(...elevations) : null,
    maximumM: elevations.length ? Math.max(...elevations) : null,
    ascentM,
    descentM,
    steepestGradePercent: grades.length ? Math.max(...grades) : null,
    missing: originalElevations.filter((value) => value === null).length,
    interpolated: points.filter((point) => point.interpolated).length,
    maximumSpacingM,
    source: response.source,
    verticalDatum: response.verticalDatum,
    retrievedAt: response.retrievedAt,
  };
}

export async function requestElevationProfile(
  coordinates: Position[],
  spacingM: number,
  signal: AbortSignal,
  progress: (done: number, total: number) => void = () => {},
  options: { maxSamples?: number; fillMissing?: boolean } = {},
): Promise<ElevationProfile> {
  signal.throwIfAborted();
  const stations = profileStations(coordinates, spacingM, options.maxSamples);
  const collected: TerrainSampleResponsePoint[] = [];
  let provenance: TerrainSampleResponse | null = null;
  progress(0, stations.length);
  // Reuse the bounded, cached USGS proxy. Sequential batches avoid multiplying its concurrency.
  for (let offset = 0; offset < stations.length; offset += 96) {
    signal.throwIfAborted();
    const batch = stations.slice(offset, offset + 96);
    // The existing endpoint requires at least two points. A final singleton repeats its neighbor.
    const requested = batch.length === 1 ? [stations[offset - 1]!, batch[0]!] : batch;
    const response = await fetch("/api/pipeline/elevation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ points: requested }),
      signal,
    });
    const payload = (await response.json()) as TerrainSampleResponse & { error?: string };
    signal.throwIfAborted();
    if (!response.ok && !(response.status === 503 && Array.isArray(payload.points)))
      throw new Error(payload.error ?? `Terrain request failed (${response.status}).`);
    if (
      payload.providerId !== "usgs-3dep" ||
      typeof payload.source !== "string" ||
      typeof payload.verticalDatum !== "string" ||
      !Number.isFinite(payload.retrievedAt) ||
      !Array.isArray(payload.points) ||
      payload.points.length !== requested.length ||
      payload.points.some(
        (p, i) =>
          p.stationM !== requested[i]!.stationM ||
          p.longitude !== requested[i]!.longitude ||
          p.latitude !== requested[i]!.latitude,
      )
    )
      throw new Error("The elevation response did not match the drawn path.");
    provenance = payload;
    collected.push(...(batch.length === 1 ? payload.points.slice(1) : payload.points));
    progress(collected.length, stations.length);
  }
  if (!provenance) throw new Error("No terrain samples were returned.");
  return analyzeProfile({ ...provenance, points: collected }, options.fillMissing);
}
