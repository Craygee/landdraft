import type { FeatureCollection } from "geojson";
import type { GisLayer } from "../gis/types.ts";
import type { PagedRemoteQueryOptions, RemoteLoadProgress } from "../gis/arcgis.ts";
import { expandBounds } from "./geometry.ts";
import { studyNearbyMilesForLayer } from "./sourceProfiles.ts";
import type { StudyReportBoundary, StudyReportLayerStatus } from "./types.ts";

/** Per-source limit. A source that reaches it is reported as incomplete, never as a full count. */
export const STUDY_FEATURE_LIMIT = 5_000;
/** Sources refreshed in one run. Anything beyond this is listed as not refreshed. */
export const STUDY_REFRESH_LAYER_LIMIT = 60;

export interface StudyRefreshDependencies {
  fetchFeatures: (url: string, options: PagedRemoteQueryOptions) => Promise<RemoteLoadProgress>;
  fetchCount?: (url: string, options: PagedRemoteQueryOptions) => Promise<number>;
  onProgress?: (message: string) => void;
  now?: () => Date;
  concurrencyPerHost?: number;
  retryDelayMs?: number;
}

export interface StudyRefreshResult {
  /** Layers to analyze. A failed source has no features, so old data cannot pass as current. */
  layers: GisLayer[];
  /** Successful results that may also update the live map. */
  refreshed: Array<{ id: string; data: FeatureCollection; source: GisLayer["source"] }>;
  statuses: StudyReportLayerStatus[];
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const RETRY_ATTEMPTS = 3;
const hostOf = (layer: GisLayer) => {
  if (layer.source.kind !== "remote") return "";
  try {
    return new URL(layer.source.url).host;
  } catch {
    return layer.source.url;
  }
};
const TRANSIENT =
  /fetch|timed? ?out|abort|50[234]|network|load|temporar|couldn.t access|unavailable|busy/i;
/** Provider errors can quote the whole request. The report keeps the endpoint, not the query. */
const providerMessage = (error: unknown) =>
  (error instanceof Error ? error.message : "The provider request failed.")
    .replace(/(https?:\/\/[^\s?]+)\?\S*/g, "$1")
    .slice(0, 300);

const isRefreshable = (layer: GisLayer) =>
  layer.source.kind === "remote" &&
  Boolean(layer.source.requiresViewport) &&
  /^https?:/i.test(layer.source.url);

function staticStatus(layer: GisLayer): StudyReportLayerStatus {
  if (layer.source.kind === "raster")
    return {
      layerId: layer.id,
      state: "visual-only",
      message: "Map image. Shown for context and not measured.",
    };
  if (layer.source.kind === "remote")
    return {
      layerId: layer.id,
      state: "not-refreshed",
      message: "Analyzed from the features already loaded in the project.",
      loaded: layer.data.features.length,
    };
  return { layerId: layer.id, state: "project-data", loaded: layer.data.features.length };
}

export async function refreshStudyLayers(
  layers: GisLayer[],
  boundary: StudyReportBoundary,
  dependencies: StudyRefreshDependencies,
): Promise<StudyRefreshResult> {
  const { fetchFeatures, fetchCount, onProgress } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const refreshable = layers.filter(isRefreshable);
  const queue = refreshable.slice(0, STUDY_REFRESH_LAYER_LIMIT);
  const queued = new Set(queue.map((layer) => layer.id));
  const results = new Map<string, GisLayer>();
  const statuses = new Map<string, StudyReportLayerStatus>();
  const refreshed: StudyRefreshResult["refreshed"] = [];

  for (const layer of layers)
    if (!queued.has(layer.id)) {
      statuses.set(
        layer.id,
        isRefreshable(layer)
          ? {
              layerId: layer.id,
              state: "not-refreshed",
              message: `Skipped because this run already queried ${STUDY_REFRESH_LAYER_LIMIT} live sources. Turn off layers you do not need and run again.`,
            }
          : staticStatus(layer),
      );
      if (isRefreshable(layer)) results.set(layer.id, { ...layer, data: EMPTY });
    }

  let done = 0;
  const retryDelayMs = dependencies.retryDelayMs ?? 1_200;
  const load = async (layer: GisLayer) => {
    if (layer.source.kind !== "remote") return;
    const nearbyMiles = studyNearbyMilesForLayer(layer);
    const retrievedAt = now().toISOString();
    const options: PagedRemoteQueryOptions = {
      bbox: expandBounds(boundary.bounds, nearbyMiles),
      where: layer.source.where,
      outFields: layer.source.outFields,
      pageSize: 1_000,
      maxTotalFeatures: STUDY_FEATURE_LIMIT,
      // Measured acreage must come from source geometry, not a display simplification.
      geometryPrecision: 6,
      cacheHint: true,
    };
    const attempt = () => fetchFeatures((layer.source as { url: string }).url, options);
    try {
      let result: RemoteLoadProgress | undefined;
      for (let tries = 1; !result; tries++) {
        try {
          result = await attempt();
        } catch (error) {
          if (
            tries >= RETRY_ATTEMPTS ||
            !TRANSIENT.test(error instanceof Error ? error.message : "")
          )
            throw error;
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * tries));
        }
      }
      let expected = result.total;
      if (result.truncated && fetchCount)
        expected = await fetchCount(layer.source.url, options).catch(() => undefined);
      const message = result.truncated
        ? `Stopped at the ${result.loaded.toLocaleString("en-US")}-feature limit${expected ? ` of ${expected.toLocaleString("en-US")}` : ""} in the search area. Counts are minimums and coverage may be understated. Use a smaller boundary or a filtered layer for a complete inventory.`
        : undefined;
      const source: GisLayer["source"] = {
        ...layer.source,
        loading: false,
        loadStatus: result.truncated ? "zoom-in" : "complete",
        loadedFeatures: result.loaded,
        ...(expected !== undefined ? { expectedFeatures: expected } : {}),
        lastRefreshedAt: now().getTime(),
        ...(message ? { loadError: message } : {}),
      };
      if (!message && source.kind === "remote") delete source.loadError;
      results.set(layer.id, { ...layer, data: result.data, source });
      refreshed.push({ id: layer.id, data: result.data, source });
      statuses.set(layer.id, {
        layerId: layer.id,
        state: result.truncated ? "truncated" : "complete",
        retrievedAt,
        loaded: result.loaded,
        nearbyMiles,
        ...(expected !== undefined ? { expected } : {}),
        ...(message ? { message } : {}),
      });
    } catch (error) {
      results.set(layer.id, { ...layer, data: EMPTY });
      statuses.set(layer.id, {
        layerId: layer.id,
        state: "failed",
        retrievedAt,
        nearbyMiles,
        message: providerMessage(error),
      });
    }
  };

  // Some publishers refuse bursts, so each server sees only a few requests at a time.
  const byHost = new Map<string, GisLayer[]>();
  for (const layer of queue) {
    const host = hostOf(layer);
    byHost.set(host, [...(byHost.get(host) ?? []), layer]);
  }
  const perHost = dependencies.concurrencyPerHost ?? 2;
  await Promise.all(
    [...byHost.values()].flatMap((hostLayers) => {
      let next = 0;
      return Array.from({ length: Math.min(perHost, hostLayers.length) }, async () => {
        while (next < hostLayers.length) {
          const layer = hostLayers[next++]!;
          onProgress?.(`${done} of ${queue.length} sources finished. Querying ${layer.name}`);
          await load(layer);
          done += 1;
        }
      });
    }),
  );
  onProgress?.(`${done} of ${queue.length} sources finished`);

  return {
    layers: layers.map((layer) => results.get(layer.id) ?? layer),
    refreshed,
    statuses: layers.map((layer) => statuses.get(layer.id)!),
  };
}
