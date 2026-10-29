import type { FeatureCollection } from "geojson";
import { fetchTexasParcels, isTexasParcelSource, TEXAS_PARCEL_URL } from "./texasParcels.ts";

/**
 * Remote source adapter. Converts ArcGIS FeatureServer / MapServer layer URLs
 * into GeoJSON query requests, and passes through plain GeoJSON URLs.
 * Kept intentionally standalone so a future PostGIS/cloud adapter can sit
 * alongside it with the same `fetchRemoteGeoJSON` signature.
 */

export type RemoteKind = "arcgis" | "geojson";

const ARCGIS_LAYER_RE = /\/(FeatureServer|MapServer)\/(\d+)\/?$/i;
const ARCGIS_SERVICE_RE = /\/(FeatureServer|MapServer)\/?$/i;

export function classifyUrl(raw: string): RemoteKind {
  return /\/(FeatureServer|MapServer)(\/|$)/i.test(raw) ? "arcgis" : "geojson";
}

export function normalizeArcgisLayerUrl(raw: string): string {
  const url = raw
    .trim()
    .replace(/\?.*$/, "")
    .replace(/\/query$/i, "");
  if (
    /^https:\/\/services1\.arcgis\.com\/1mtXwieMId59thmg\/ArcGIS\/rest\/services\/2019_Texas_Parcels_StratMap\/FeatureServer(?:\/0)?\/?$/i.test(
      url,
    )
  )
    return TEXAS_PARCEL_URL;
  if (ARCGIS_LAYER_RE.test(url)) return url;
  if (ARCGIS_SERVICE_RE.test(url)) return `${url.replace(/\/$/, "")}/0`;
  return url;
}

export interface RemoteQueryOptions {
  /** [west, south, east, north] in WGS84 */
  bbox?: [number, number, number, number] | undefined;
  maxFeatures?: number | undefined;
  maxAllowableOffset?: number | undefined;
  geometryPrecision?: number | undefined;
  cacheHint?: boolean | undefined;
  where?: string | undefined;
  outFields?: string[] | undefined;
  resultOffset?: number | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface RemoteLoadProgress {
  data: FeatureCollection;
  loaded: number;
  total?: number;
  complete: boolean;
  truncated: boolean;
}

export interface PagedRemoteQueryOptions extends RemoteQueryOptions {
  parcelDisplayZoom?: number | undefined;
  pageSize?: number | undefined;
  maxTotalFeatures?: number | undefined;
  onProgress?: ((progress: RemoteLoadProgress) => void) | undefined;
}

const addSpatialParams = (params: URLSearchParams, opts: RemoteQueryOptions) => {
  if (!opts.bbox) return;
  params.set("geometry", opts.bbox.join(","));
  params.set("geometryType", "esriGeometryEnvelope");
  params.set("inSR", "4326");
  params.set("spatialRel", "esriSpatialRelIntersects");
};

export function buildArcgisQueryUrl(layerUrl: string, opts: RemoteQueryOptions = {}): string {
  const base = normalizeArcgisLayerUrl(layerUrl);
  const params = new URLSearchParams({
    where: opts.where && opts.where.length > 0 ? opts.where : "1=1",
    outFields: opts.outFields?.length ? opts.outFields.join(",") : "*",
    outSR: "4326",
    f: "geojson",
    returnGeometry: "true",
    geometryPrecision: String(opts.geometryPrecision ?? 6),
    resultRecordCount: String(opts.maxFeatures ?? 2000),
  });
  if (opts.resultOffset !== undefined) params.set("resultOffset", String(opts.resultOffset));
  if (opts.maxAllowableOffset !== undefined)
    params.set("maxAllowableOffset", String(opts.maxAllowableOffset));
  if (opts.cacheHint) params.set("cacheHint", "true");
  addSpatialParams(params, opts);
  return `${base}/query?${params.toString()}`;
}

export function buildArcgisCountUrl(layerUrl: string, opts: RemoteQueryOptions = {}): string {
  const base = normalizeArcgisLayerUrl(layerUrl);
  const params = new URLSearchParams({
    where: opts.where && opts.where.length > 0 ? opts.where : "1=1",
    returnCountOnly: "true",
    f: "json",
  });
  if (opts.cacheHint) params.set("cacheHint", "true");
  addSpatialParams(params, opts);
  return `${base}/query?${params.toString()}`;
}

export interface ArcgisField {
  name: string;
  alias: string;
  type: string;
}

export async function fetchArcgisFields(
  layerUrl: string,
  signal?: AbortSignal,
): Promise<ArcgisField[]> {
  if (isTexasParcelSource(layerUrl)) return [];
  if (classifyUrl(layerUrl) !== "arcgis") return [];
  const base = normalizeArcgisLayerUrl(layerUrl);
  let response = await fetch(`${base}?f=json`, {
    signal: signal ?? null,
  });
  // Some public ArcGIS publishers disable the Services Directory while leaving queries public.
  // A zero-geometry query still returns the authoritative field schema in that configuration.
  if (!response.ok) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      returnGeometry: "false",
      resultRecordCount: "1",
      f: "json",
    });
    response = await fetch(`${base}/query?${params.toString()}`, { signal: signal ?? null });
  }
  if (!response.ok) throw new Error(`Layer details failed (${response.status})`);
  const json = (await response.json()) as {
    fields?: Array<{ name?: string; alias?: string; type?: string }>;
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? "Service returned an error");
  return (json.fields ?? [])
    .filter((field): field is { name: string; alias?: string; type?: string } =>
      Boolean(field.name),
    )
    .map((field) => ({
      name: field.name,
      alias: field.alias || field.name,
      type: field.type || "",
    }));
}

function sanitize(fc: FeatureCollection): FeatureCollection {
  const features = (fc.features ?? []).filter((f) => f && f.geometry);
  return { type: "FeatureCollection", features };
}

const fetchWithTimeout = async (url: string, signal?: AbortSignal, timeoutMs = 35_000) => {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error("The public data service timed out. Zoom in and try again.");
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
};

export async function fetchRemoteGeoJSON(
  url: string,
  opts: RemoteQueryOptions = {},
): Promise<FeatureCollection> {
  if (isTexasParcelSource(url)) return (await fetchTexasParcels(opts)).data;
  const kind = classifyUrl(url);
  const requestUrl = kind === "arcgis" ? buildArcgisQueryUrl(url, opts) : url;
  const res = await fetchWithTimeout(requestUrl, opts.signal, opts.timeoutMs);
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${requestUrl}`);
  const json = (await res.json()) as FeatureCollection & { error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "Service returned an error");
  if (!json.features) throw new Error("Response did not contain GeoJSON features");
  return sanitize(json);
}

export async function fetchArcgisFeatureCount(
  url: string,
  opts: RemoteQueryOptions = {},
): Promise<number> {
  if (classifyUrl(url) !== "arcgis") throw new Error("Feature counts require an ArcGIS layer");
  const response = await fetchWithTimeout(
    buildArcgisCountUrl(url, opts),
    opts.signal,
    opts.timeoutMs,
  );
  if (!response.ok) throw new Error(`Feature count failed (${response.status})`);
  const json = (await response.json()) as {
    count?: number;
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? "Service returned an error");
  if (!Number.isFinite(json.count)) throw new Error("Service did not return a feature count");
  return Number(json.count);
}

const featureIdentity = (feature: FeatureCollection["features"][number]) => {
  if (feature.id !== undefined) return `id:${String(feature.id)}`;
  const properties = feature.properties ?? {};
  for (const key of ["OBJECTID", "ObjectID", "objectid", "FID", "fid"]) {
    if (properties[key] !== undefined && properties[key] !== null)
      return `${key}:${String(properties[key])}`;
  }
  return null;
};

/**
 * Streams an ArcGIS viewport page-by-page. The first geometries render before
 * any expensive full-count query, which is materially faster for dense parcel
 * services and avoids a count request becoming a loading bottleneck.
 */
export async function fetchRemoteGeoJSONPaged(
  url: string,
  opts: PagedRemoteQueryOptions = {},
): Promise<RemoteLoadProgress> {
  if (isTexasParcelSource(url)) return fetchTexasParcels(opts);
  if (classifyUrl(url) !== "arcgis") {
    const data = await fetchRemoteGeoJSON(url, opts);
    const result = {
      data,
      loaded: data.features.length,
      total: data.features.length,
      complete: true,
      truncated: false,
    };
    opts.onProgress?.(result);
    return result;
  }

  const maxTotal = Math.max(1, opts.maxTotalFeatures ?? 20_000);
  const pageSize = Math.max(1, Math.min(2_000, opts.pageSize ?? 2_000));
  const features: FeatureCollection["features"] = [];
  const identities = new Set<string>();
  let offset = 0;
  let complete = false;
  let stalled = false;

  while (features.length < maxTotal && !complete && !stalled) {
    const requested = Math.min(pageSize, maxTotal - features.length);
    const page = await fetchRemoteGeoJSON(url, {
      ...opts,
      maxFeatures: requested,
      resultOffset: offset,
    });
    if (page.features.length === 0) {
      complete = true;
      break;
    }
    const countBefore = features.length;
    for (const feature of page.features) {
      const identity = featureIdentity(feature);
      if (identity && identities.has(identity)) continue;
      if (identity) identities.add(identity);
      features.push(feature);
    }
    stalled = features.length === countBefore;
    offset += page.features.length;
    complete = page.features.length < requested;
    const truncated = stalled || (!complete && features.length >= maxTotal);
    opts.onProgress?.({
      data: { type: "FeatureCollection", features: [...features] },
      loaded: features.length,
      ...(complete ? { total: features.length } : {}),
      complete,
      truncated,
    });
  }

  const truncated = stalled || !complete;
  return {
    data: { type: "FeatureCollection", features },
    loaded: features.length,
    ...(complete ? { total: features.length } : {}),
    complete,
    truncated,
  };
}
