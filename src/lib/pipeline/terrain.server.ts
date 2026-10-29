import {
  USGS_3DEP_PROVIDER_ID,
  USGS_TERRAIN_MAX_SAMPLES,
  type TerrainSampleRequestPoint,
  type TerrainSampleResponse,
  type TerrainSampleResponsePoint,
} from "./elevation.ts";

const EPQS_URL = "https://epqs.nationalmap.gov/v1/json";
const cache = new Map<string, { elevationM: number; resolutionM?: number; expiresAt: number }>();

function validPoint(value: unknown): value is TerrainSampleRequestPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<TerrainSampleRequestPoint>;
  return (
    Number.isFinite(point.stationM) &&
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.latitude) &&
    point.stationM! >= 0 &&
    point.longitude! >= -180 &&
    point.longitude! <= 180 &&
    point.latitude! >= -90 &&
    point.latitude! <= 90
  );
}

function numericValue(value: unknown): number | undefined {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && !value.trim())
  )
    return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > -100_000 ? parsed : undefined;
}

async function queryPoint(point: TerrainSampleRequestPoint): Promise<TerrainSampleResponsePoint> {
  const key = `${point.longitude.toFixed(7)},${point.latitude.toFixed(7)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now())
    return {
      ...point,
      elevationM: cached.elevationM,
      ...(cached.resolutionM === undefined ? {} : { resolutionM: cached.resolutionM }),
    };

  const url = new URL(EPQS_URL);
  url.search = new URLSearchParams({
    x: point.longitude.toFixed(7),
    y: point.latitude.toFixed(7),
    wkid: "4326",
    units: "Meters",
    includeDate: "false",
  }).toString();
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "LandDraft/terrain-profile" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ...point, elevationM: null };
    const payload = (await response.json()) as Record<string, unknown>;
    const elevationM = numericValue(payload["value"]);
    if (elevationM === undefined) return { ...point, elevationM: null };
    const rawResolution = numericValue(payload["resolution"]);
    const resolutionM =
      rawResolution !== undefined && rawResolution > 0 ? rawResolution : undefined;
    cache.set(key, {
      elevationM,
      ...(resolutionM === undefined ? {} : { resolutionM }),
      expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
    });
    return { ...point, elevationM, ...(resolutionM === undefined ? {} : { resolutionM }) };
  } catch {
    return { ...point, elevationM: null };
  }
}

async function queryWithConcurrency(points: TerrainSampleRequestPoint[]) {
  const output = new Array<TerrainSampleResponsePoint>(points.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, points.length) }, async () => {
      while (nextIndex < points.length) {
        const index = nextIndex++;
        output[index] = await queryPoint(points[index]!);
      }
    }),
  );
  return output;
}

export async function handlePipelineElevationRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/pipeline/elevation") return null;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const body = (await request.json()) as { points?: unknown };
    if (
      !Array.isArray(body.points) ||
      body.points.length < 2 ||
      body.points.length > USGS_TERRAIN_MAX_SAMPLES ||
      !body.points.every(validPoint)
    )
      return Response.json({ error: "A valid route profile is required" }, { status: 400 });
    const points = await queryWithConcurrency(body.points);
    const failedCount = points.filter((point) => point.elevationM === null).length;
    const result: TerrainSampleResponse = {
      providerId: USGS_3DEP_PROVIDER_ID,
      source: "USGS 3DEP Elevation Point Query Service",
      verticalDatum: "Source DEM vertical datum; verify for engineering use",
      retrievedAt: Date.now(),
      points,
      failedCount,
    };
    return Response.json(result, {
      status: failedCount === points.length ? 503 : 200,
      headers: { "cache-control": "private, max-age=3600" },
    });
  } catch {
    return Response.json(
      { error: "Terrain profile request could not be processed" },
      { status: 400 },
    );
  }
}
