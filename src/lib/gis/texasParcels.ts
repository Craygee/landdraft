import type { FeatureCollection } from "geojson";
import type { PagedRemoteQueryOptions, RemoteLoadProgress } from "./arcgis";
import { parcelScreenArea } from "./parcelDisplay.ts";

export const TEXAS_PARCEL_URL =
  "https://landdraft-public-parcels.tight-sky-0ae1.workers.dev/texas/current.json";
export const isTexasParcelSource = (url: string) =>
  url === TEXAS_PARCEL_URL ||
  /^https:\/\/services1\.arcgis\.com\/1mtXwieMId59thmg\/ArcGIS\/rest\/services\/2019_Texas_Parcels_StratMap\/FeatureServer(?:\/0)?\/?(?:\?.*)?$/i.test(
    url,
  );
export interface ParcelManifest {
  weeklyUpdates?: boolean;
  status: string;
  version: string;
  license: string;
  features: number;
  unmappedFeatures: number;
  countyCount: number;
  missingCountyFips: string[];
  sourceDate: string;
  retrievedAt: string;
  publishedAt: string;
  sourceUrl: string;
  parts: Array<{ file: string; bounds: [number, number, number, number]; features: number }>;
  /** Large-parcel files for zoomed-out views, built by tools/texas-parcels-overview.py. */
  overview?: { schemaVersion: number; tiers: ParcelOverviewTier[] };
}
export interface ParcelOverviewTier {
  file: string;
  minAcres: number;
  /** Zooms this tier serves: minZoom <= zoom < maxZoom. */
  minZoom: number;
  maxZoom: number;
  features: number;
  bounds: [number, number, number, number];
}
/** Lowest zoom at which Texas parcels load when the hosted version has overview tiers. */
export const PARCEL_OVERVIEW_MIN_ZOOM = 8;
/** Below this zoom the full parts are too dense to read; only an overview tier can serve it. */
export const PARCEL_PARTS_MIN_ZOOM = 10;
export function parcelOverviewTier(
  manifest: Pick<ParcelManifest, "overview">,
  zoom: number,
): ParcelOverviewTier | null {
  if (manifest.overview?.schemaVersion !== 1 || !Array.isArray(manifest.overview.tiers))
    return null;
  return (
    manifest.overview.tiers.find(
      (tier) =>
        /^overview-\d{4}\.fgb$/.test(tier.file) &&
        Number.isFinite(tier.minZoom) &&
        Number.isFinite(tier.maxZoom) &&
        tier.minZoom <= zoom &&
        zoom < tier.maxZoom,
    ) ?? null
  );
}
export async function getParcelManifest(signal?: AbortSignal): Promise<ParcelManifest> {
  const response = await fetch(TEXAS_PARCEL_URL, { signal: signal ?? null });
  if (!response.ok)
    throw new Error(
      `Texas parcel index unavailable (${response.status}). Existing data has not been replaced.`,
    );
  const m = (await response.json()) as ParcelManifest;
  if (
    m.status !== "ready" ||
    m.license !== "CC0-1.0" ||
    !/^[a-f0-9]{16}$/.test(m.version) ||
    !Array.isArray(m.parts) ||
    !m.parts.length
  )
    throw new Error("Texas parcel index is not ready or its license requires review.");
  if (
    m.parts.some(
      (p) =>
        !/^part-\d{4}\.fgb$/.test(p.file) ||
        p.bounds?.length !== 4 ||
        !p.bounds.every(Number.isFinite),
    )
  )
    throw new Error("Texas parcel index contains invalid spatial metadata.");
  return m;
}
export const intersectsParcelBounds = (
  a: [number, number, number, number],
  b: [number, number, number, number],
) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export async function fetchTexasParcels(
  opts: PagedRemoteQueryOptions,
): Promise<RemoteLoadProgress> {
  const b = opts.bbox;
  if (!b || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3])
    throw new Error("Zoom to a valid map area to load Texas parcels.");
  const overview = opts.parcelDisplayZoom !== undefined && opts.parcelDisplayZoom < 12;
  const zoomedOut = opts.parcelDisplayZoom !== undefined && opts.parcelDisplayZoom < 10;
  if ((b[2] - b[0]) * (b[3] - b[1]) > (zoomedOut ? 120 : overview ? 32 : 2))
    throw new Error(
      "All available Texas parcels are stored centrally. Zoom in to display parcel boundaries.",
    );
  const where = opts.where?.trim();
  const county =
    where && where !== "1=1" ? /^(?:county|CNTY_NM)\s*=\s*'([^']+)'$/i.exec(where)?.[1] : undefined;
  if (where && where !== "1=1" && !county)
    throw new Error(
      "The statewide parcel index supports county filters. Clear the previous service query to continue.",
    );
  const manifest = await getParcelManifest(opts.signal);
  const tier = overview ? parcelOverviewTier(manifest, opts.parcelDisplayZoom!) : null;
  if (
    !tier &&
    opts.parcelDisplayZoom !== undefined &&
    opts.parcelDisplayZoom < PARCEL_PARTS_MIN_ZOOM
  )
    throw new Error("Zoom in to zoom 10 to display Texas parcel boundaries.");
  const { deserialize } = await import("flatgeobuf/lib/mjs/geojson.js");
  const features: FeatureCollection["features"] = [];
  const max = Math.max(1, Math.min(opts.maxTotalFeatures ?? opts.maxFeatures ?? 20000, 40000));
  let truncated = false;
  // An overview tier holds only large parcels, so it can be read in full for the view.
  const scanLimit = tier ? 120000 : overview ? 12000 : Infinity;
  let scanned = 0;
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  };
  const parts = tier
    ? intersectsParcelBounds(tier.bounds, b)
      ? [{ file: tier.file, bounds: tier.bounds, features: tier.features }]
      : []
    : manifest.parts.filter((p) => intersectsParcelBounds(p.bounds, b));
  let nextPart = 0;
  const readParts = async () => {
    while (nextPart < parts.length && !truncated) {
      const part = parts[nextPart++];
      if (!part) return;
      checkAbort();
      const url = `${new URL(TEXAS_PARCEL_URL).origin}/texas/versions/${manifest.version}/${part.file}`;
      // FlatGeobuf reads the spatial index and matching byte ranges, never the statewide file.
      // The library does not yet accept AbortSignal: stop iteration immediately after an in-flight range returns.
      for await (const feature of deserialize(url, {
        minX: b[0],
        minY: b[1],
        maxX: b[2],
        maxY: b[3],
      })) {
        checkAbort();
        if (truncated) break;
        if (++scanned > scanLimit) {
          truncated = true;
          break;
        }
        const properties = feature.properties ?? {};
        if (
          county &&
          String(
            properties["COUNTY"] ?? properties["county"] ?? properties["CNTY_NM"] ?? "",
          ).toLowerCase() !== county.toLowerCase()
        )
          continue;
        if (
          overview &&
          parcelScreenArea(feature, opts.parcelDisplayZoom!) <
            (opts.parcelDisplayZoom! < 11 ? 8 : 4)
        )
          continue;
        // Overview tiers keep every match and trim to the largest parcels after reading.
        if (!tier && features.length >= max) {
          truncated = true;
          break;
        }
        feature.id = String(
          properties["OBJECTID"] ??
            properties["objectid"] ??
            properties["fid"] ??
            `${part.file}:${feature.id}`,
        );
        features.push({
          ...feature,
          properties: {
            ...properties,
            LD_SOURCE: "TxGIO / contributing appraisal districts",
            LD_EDITION: manifest.sourceDate,
            LD_RETRIEVED: manifest.retrievedAt,
            LD_LICENSE: manifest.license,
          },
        });
      }
    }
  };
  // Bound concurrency so scattered source batches do not serialize dozens of round trips.
  await Promise.all(Array.from({ length: Math.min(4, parts.length) }, readParts));
  checkAbort();
  if (overview)
    features.sort(
      (a, b) =>
        parcelScreenArea(b, opts.parcelDisplayZoom!) - parcelScreenArea(a, opts.parcelDisplayZoom!),
    );
  if (tier && features.length > max) {
    features.length = max;
    truncated = true;
  }
  const result = {
    data: { type: "FeatureCollection" as const, features },
    loaded: features.length,
    complete: !truncated,
    truncated,
  };
  opts.onProgress?.(result);
  return result;
}
