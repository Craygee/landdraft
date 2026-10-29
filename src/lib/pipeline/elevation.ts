import type { Position } from "geojson";
import { pointAtStation } from "./model.ts";
import { resolveRouteElevations } from "./terrainModel.ts";
import type { ElevationSample, PipelineRoute, PipelineStation } from "./types.ts";

export const USGS_3DEP_PROVIDER_ID = "usgs-3dep";
export const USGS_TERRAIN_TARGET_SPACING_M = 100;
export const USGS_TERRAIN_MAX_SAMPLES = 96;

export interface TerrainSampleRequestPoint {
  stationM: number;
  longitude: number;
  latitude: number;
}

export interface TerrainSampleResponsePoint extends TerrainSampleRequestPoint {
  elevationM: number | null;
  resolutionM?: number;
}

export interface TerrainSampleResponse {
  providerId: typeof USGS_3DEP_PROVIDER_ID;
  source: string;
  verticalDatum: string;
  retrievedAt: number;
  points: TerrainSampleResponsePoint[];
  failedCount: number;
}

export interface ElevationProviderDescriptor {
  id: string;
  name: string;
  authority: string;
  availability: "available" | "configuration-required" | "planned";
  potentialCost: "free-public-service" | "provider-usage-based" | "project-supplied";
  sourceUrl: string;
}

export interface ElevationRequest {
  route: PipelineRoute;
  maximumSpacingM: number;
  preferredResolutionM?: number;
}

export interface ElevationBatch {
  providerId: string;
  routeId: string;
  geometryRevision: number;
  samples: ElevationSample[];
  requestedAt: number;
  completedAt: number;
  warnings: string[];
}

export interface ElevationProvider {
  descriptor: ElevationProviderDescriptor;
  sampleRoute(request: ElevationRequest, signal: AbortSignal): Promise<ElevationBatch>;
}

export const elevationProviderCatalog: ElevationProviderDescriptor[] = [
  {
    id: "manual-survey",
    name: "Manual / surveyed elevations",
    authority: "Project-provided",
    availability: "available",
    potentialCost: "project-supplied",
    sourceUrl: "project://manual-survey",
  },
  {
    id: USGS_3DEP_PROVIDER_ID,
    name: "USGS 3DEP terrain profile",
    authority: "U.S. Geological Survey",
    availability: "available",
    potentialCost: "free-public-service",
    sourceUrl: "https://apps.nationalmap.gov/epqs/",
  },
  {
    id: "esri-elevation",
    name: "Esri Elevation/Profile",
    authority: "Esri hosted service",
    availability: "configuration-required",
    potentialCost: "provider-usage-based",
    sourceUrl: "https://developers.arcgis.com/rest/elevation/index.html",
  },
];

export function terrainStationsForRoute(
  route: PipelineRoute,
  targetSpacingM = USGS_TERRAIN_TARGET_SPACING_M,
  maximumSamples = USGS_TERRAIN_MAX_SAMPLES,
): PipelineStation[] {
  if (route.lengthM <= 0 || route.coordinates.length < 2) return route.stations;
  const boundedMaximum = Math.max(2, Math.floor(maximumSamples));
  const spacingM = Math.max(1, targetSpacingM, route.lengthM / (boundedMaximum - 1));
  const segmentCount = Math.max(1, Math.ceil(route.lengthM / spacingM));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const stationM =
      index === segmentCount ? route.lengthM : (route.lengthM * index) / segmentCount;
    return { stationM, coordinate: pointAtStation(route, stationM) };
  });
}

export async function sampleUsgsTerrain(
  route: PipelineRoute,
  signal?: AbortSignal,
): Promise<PipelineRoute> {
  const stations = terrainStationsForRoute(route);
  const response = await fetch("/api/pipeline/elevation", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    ...(signal ? { signal } : {}),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      points: stations.map((station) => ({
        stationM: station.stationM,
        longitude: Number(station.coordinate[0]),
        latitude: Number(station.coordinate[1]),
      })),
    }),
  });
  if (!response.ok) throw new Error(`USGS terrain request failed (${response.status})`);
  const result = (await response.json()) as TerrainSampleResponse;
  if (!Array.isArray(result.points) || result.points.length !== stations.length)
    throw new Error("USGS terrain response did not match the route profile");

  const now = result.retrievedAt || Date.now();
  const samples: ElevationSample[] = [];
  const sampledStations = stations.map((station, index): PipelineStation => {
    const point = result.points[index];
    if (!point || point.elevationM === null || !Number.isFinite(point.elevationM)) return station;
    const sample: ElevationSample = {
      id: `usgs-3dep-${route.id}-${index}-${now}`,
      stationM: station.stationM,
      coordinate: [...station.coordinate] as Position,
      groundElevationM: point.elevationM,
      source: result.source,
      sourceKind: "dem",
      ...(point.resolutionM === undefined ? {} : { resolutionM: point.resolutionM }),
      verticalDatum: result.verticalDatum,
      capturedAt: now,
      quality: point.resolutionM !== undefined && point.resolutionM <= 10 ? "high" : "medium",
      provenance: "provider",
    };
    samples.push(sample);
    return {
      ...station,
      groundElevationM: sample.groundElevationM,
      // This preliminary model follows grade. Future burial-depth tools may offset the pipeline
      // profile from ground while retaining these terrain elevations.
      pipelineElevationM: sample.groundElevationM,
      elevationSampleId: sample.id,
    };
  });
  if (samples.length < 2) throw new Error("USGS 3DEP returned insufficient terrain coverage");
  return resolveRouteElevations({
    ...route,
    stations: sampledStations,
    elevationSamples: samples,
    updatedAt: Date.now(),
  }).route;
}

export function applyLinearManualElevation(input: {
  route: PipelineRoute;
  startElevationM: number;
  endElevationM: number;
  source: string;
}): PipelineRoute {
  const now = Date.now();
  const samples = input.route.stations.map((station, index) => {
    const ratio = input.route.lengthM <= 0 ? 0 : station.stationM / input.route.lengthM;
    const groundElevationM =
      input.startElevationM + (input.endElevationM - input.startElevationM) * ratio;
    return {
      id: `manual-elevation-${input.route.id}-${index}-${now}`,
      stationM: station.stationM,
      coordinate: [...station.coordinate] as Position,
      groundElevationM,
      source: input.source,
      sourceKind: "manual" as const,
      capturedAt: now,
      quality: "unknown" as const,
      provenance: "user" as const,
    };
  });
  return resolveRouteElevations({
    ...input.route,
    elevationSamples: samples,
    stations: input.route.stations.map((station, index) => ({
      ...station,
      groundElevationM: samples[index]!.groundElevationM,
      pipelineElevationM: samples[index]!.groundElevationM,
      elevationSampleId: samples[index]!.id,
    })),
    updatedAt: now,
  }).route;
}
