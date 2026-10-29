import type { LayerSource } from "./types.ts";

export type RemoteBbox = [number, number, number, number];
export interface RemoteCoverage {
  bbox: RemoteBbox;
  zoomBucket: number;
  queryKey: string;
  loaded: number;
}

/** A spatial cache entry is valid only while its downloaded features remain in memory. */
export function canReuseRemoteCoverage(
  coverage: RemoteCoverage | undefined,
  queryKey: string,
  zoomBucket: number,
  visible: RemoteBbox,
  source: LayerSource,
  featureCount: number,
) {
  return Boolean(
    coverage &&
    source.kind === "remote" &&
    source.lastRefreshedAt !== undefined &&
    source.loadStatus !== "error" &&
    source.loadStatus !== "loading" &&
    (coverage.loaded === 0 || featureCount > 0) &&
    coverage.queryKey === queryKey &&
    coverage.zoomBucket === zoomBucket &&
    coverage.bbox[0] <= visible[0] &&
    coverage.bbox[1] <= visible[1] &&
    coverage.bbox[2] >= visible[2] &&
    coverage.bbox[3] >= visible[3],
  );
}
