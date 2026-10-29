import { useEffect, useRef } from "react";
import { fetchRemoteGeoJSONPaged } from "@/lib/gis/arcgis";
import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { isTexasParcelSource } from "@/lib/gis/texasParcels";
import { canReuseRemoteCoverage, type RemoteCoverage } from "@/lib/gis/remoteCoverage";

type Bbox = [number, number, number, number];

const padBbox = (bbox: Bbox, fraction = 0.06): Bbox => {
  const x = (bbox[2] - bbox[0]) * fraction;
  const y = (bbox[3] - bbox[1]) * fraction;
  return [bbox[0] - x, bbox[1] - y, bbox[2] + x, bbox[3] + y];
};

const queryTuning = (zoom: number, latitude: number) => {
  const metersPerPixel =
    (156_543.03392 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180))) / 2 ** zoom;
  return {
    maxAllowableOffset: (metersPerPixel * 0.35) / 111_320,
    geometryPrecision: zoom >= 16 ? 7 : zoom >= 12 ? 6 : 5,
  };
};

const viewportFeatureBudget = (zoom: number) => {
  if (zoom < 9) return 8_000;
  if (zoom < 11) return 12_000;
  if (zoom < 13) return 16_000;
  if (zoom < 14) return 24_000;
  return 40_000;
};

/** Keeps dense remote layers bounded to the visible map and refreshes them in place. */
export function RemoteLayerManager() {
  const { map } = useMapRef();
  const wb = useWorkbench();
  const layersRef = useRef(wb.displayLayers);
  const updateRef = useRef(wb.updateDisplayLayer);
  const activeRequests = useRef(new Map<string, AbortController>());
  const coverage = useRef(new Map<string, RemoteCoverage>());
  const refreshRef = useRef<(() => void) | null>(null);
  layersRef.current = wb.displayLayers;
  updateRef.current = wb.updateDisplayLayer;
  const remoteSignature = wb.displayLayers
    .filter((layer) => layer.source.kind === "remote")
    .map((layer) =>
      layer.source.kind === "remote"
        ? [
            layer.id,
            layer.visible,
            layer.source.url,
            layer.source.where ?? "",
            layer.source.outFields?.join(",") ?? "*",
            layer.source.minZoom ?? 0,
            layer.source.refreshToken ?? 0,
          ].join(":")
        : "",
    )
    .join("|");

  useEffect(() => {
    if (!map) return;
    const requests = activeRequests.current;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async (scheduledOnly = false) => {
      const bounds = map.getBounds();
      const visibleBbox: Bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
      const queryBbox = padBbox(visibleBbox);
      const mapZoom = map.getZoom();
      const zoomBucket = Math.floor(mapZoom);
      const latitude = (visibleBbox[1] + visibleBbox[3]) / 2;
      const tuning = queryTuning(mapZoom, latitude);
      const now = Date.now();
      const pending: Promise<void>[] = [];
      for (const layer of layersRef.current) {
        if (!layer.visible || layer.source.kind !== "remote") continue;
        const source = layer.source;
        if (!source.requiresViewport) continue;
        if ((source.minZoom ?? 0) > map.getZoom()) {
          coverage.current.delete(layer.id);
          if (layer.data.features.length || source.loadStatus !== "idle") {
            const nextSource = { ...source, loading: false, loadStatus: "idle" as const };
            delete nextSource.loadedFeatures;
            delete nextSource.expectedFeatures;
            delete nextSource.loadError;
            updateRef.current(layer.id, {
              data: { type: "FeatureCollection", features: [] },
              source: nextSource,
            });
          }
          continue;
        }
        if (scheduledOnly) {
          if (!source.refreshMinutes) continue;
          if (now - (source.lastRefreshedAt ?? 0) < source.refreshMinutes * 60_000) continue;
        }
        const queryKey = `${wb.projectId}|${source.url}|${source.where ?? ""}|${source.outFields?.join(",") ?? "*"}|${source.refreshToken ?? 0}`;
        const previousCoverage = coverage.current.get(layer.id);
        if (
          !scheduledOnly &&
          canReuseRemoteCoverage(
            previousCoverage,
            queryKey,
            zoomBucket,
            visibleBbox,
            source,
            layer.data.features.length,
          )
        )
          continue;
        requests.get(layer.id)?.abort();
        const controller = new AbortController();
        requests.set(layer.id, controller);
        const loadingSource = {
          ...source,
          loading: true,
          loadStatus: "loading" as const,
          loadedFeatures: 0,
        };
        delete loadingSource.expectedFeatures;
        delete loadingSource.loadError;
        updateRef.current(layer.id, { source: loadingSource });
        pending.push(
          (async () => {
            try {
              const result = await fetchRemoteGeoJSONPaged(source.url, {
                bbox: queryBbox,
                where: source.where,
                outFields: source.outFields,
                pageSize: source.catalogId === "usgs-contours" ? 200 : 2_000,
                maxTotalFeatures:
                  isTexasParcelSource(source.url) && mapZoom < 12
                    ? 4000
                    : viewportFeatureBudget(mapZoom),
                parcelDisplayZoom: mapZoom,
                maxAllowableOffset: tuning.maxAllowableOffset,
                geometryPrecision: tuning.geometryPrecision,
                cacheHint: true,
                signal: controller.signal,
                onProgress: (progress) => {
                  if (requests.get(layer.id) !== controller) return;
                  const progressSource = {
                    ...source,
                    loading: !progress.complete && !progress.truncated,
                    loadStatus: progress.truncated
                      ? ("zoom-in" as const)
                      : progress.complete
                        ? ("complete" as const)
                        : ("loading" as const),
                    loadedFeatures: progress.loaded,
                    ...(progress.total !== undefined ? { expectedFeatures: progress.total } : {}),
                  };
                  delete progressSource.loadError;
                  updateRef.current(layer.id, {
                    data: progress.data,
                    source: progressSource,
                  });
                },
              });
              if (requests.get(layer.id) !== controller || controller.signal.aborted) return;
              coverage.current.set(layer.id, {
                bbox: queryBbox,
                zoomBucket,
                queryKey,
                loaded: result.loaded,
              });
              const finalSource = {
                ...source,
                ...(isTexasParcelSource(source.url)
                  ? { displayDetail: mapZoom < 12 ? ("overview" as const) : ("full" as const) }
                  : {}),
                loading: false,
                loadStatus: result.truncated ? ("zoom-in" as const) : ("complete" as const),
                loadedFeatures: result.loaded,
                ...(result.total !== undefined ? { expectedFeatures: result.total } : {}),
                lastRefreshedAt: Date.now(),
                ...(result.truncated && result.loaded > 0
                  ? {
                      loadError: `Showing ${result.loaded.toLocaleString()} nearby features. Zoom in for the complete area.`,
                    }
                  : {}),
              };
              if (!result.truncated) delete finalSource.loadError;
              updateRef.current(layer.id, { data: result.data, source: finalSource });
            } catch (error) {
              if (
                requests.get(layer.id) === controller &&
                !controller.signal.aborted &&
                !(error instanceof DOMException && error.name === "AbortError")
              ) {
                updateRef.current(layer.id, {
                  source: {
                    ...source,
                    loading: false,
                    loadStatus: "error",
                    loadError:
                      error instanceof Error ? error.message : "Visible area failed to load",
                  },
                });
                console.warn(`[data] refresh failed for ${layer.name}`, error);
              }
            } finally {
              if (requests.get(layer.id) === controller) requests.delete(layer.id);
            }
          })(),
        );
      }
      await Promise.all(pending);
    };

    refreshRef.current = () => void refresh(false);
    void refresh(false);
    const onMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(false), 450);
    };
    map.on("moveend", onMoveEnd);
    const interval = window.setInterval(() => void refresh(true), 60_000);
    return () => {
      refreshRef.current = null;
      if (timer) clearTimeout(timer);
      window.clearInterval(interval);
      map.off("moveend", onMoveEnd);
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, [map, remoteSignature, wb.projectId]);

  useEffect(() => {
    // Project restore strips remote geometry while retaining layer IDs and settings.
    // Rehydrate immediately even when neither the query nor map extent changed.
    if (
      wb.displayLayers.some(
        (layer) =>
          layer.visible &&
          layer.source.kind === "remote" &&
          layer.source.requiresViewport &&
          layer.source.lastRefreshedAt === undefined &&
          layer.source.loadStatus === undefined &&
          !activeRequests.current.has(layer.id),
      )
    )
      refreshRef.current?.();
  }, [wb.displayLayers]);

  return null;
}
