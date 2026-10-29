import type { GisLayer } from "./types.ts";
import type { AreaFeature } from "./buildableAreaModel.ts";
import { polygonBoundaryFeature, snapshotFromLayer } from "./buildableAreaModel.ts";
import { fetchArcgisFeatureCount, fetchRemoteGeoJSONPaged, classifyUrl } from "./arcgis.ts";
import { assertBuildableBudget } from "./buildableAreaModel.ts";
export function boundaryLayerOptions(layers: GisLayer[]) {
  const unique = [...new Map(layers.map((l) => [l.id, l])).values()];
  return unique
    .map((layer) => {
      const candidateOnly = Boolean(snapshotFromLayer(layer));
      const polygons = layer.data.features.flatMap((raw, index) => {
        if (candidateOnly && raw.properties?.["kind"] !== "candidate") return [];
        const feature = polygonBoundaryFeature(raw);
        return feature ? [{ feature, index }] : [];
      });
      let status = polygons.length
        ? `${polygons.length.toLocaleString()} polygon feature${polygons.length === 1 ? "" : "s"}${candidateOnly ? " · candidate areas" : ""}`
        : layer.source.kind === "remote"
          ? layer.source.loading || layer.source.loadStatus === "loading"
            ? "Loading map features…"
            : layer.source.loadStatus === "error"
              ? "Connection failed — load current view to retry"
              : layer.source.loadStatus === "zoom-in"
                ? "Zoom in or load polygons from current view"
                : "No polygons loaded — load current view"
          : layer.source.kind === "image"
            ? "Image overlay — not a polygon boundary"
            : layer.data.features.length
              ? "No polygon geometry — use as a constraint"
              : "Empty layer — add or import polygons";
      if (layer.source.kind === "remote" && polygons.length) status += " · loaded snapshot only";
      return { layer, polygons, status, canLoad: layer.source.kind === "remote" };
    })
    .sort(
      (a, b) => b.layer.createdAt - a.layer.createdAt || a.layer.name.localeCompare(b.layer.name),
    );
}
export function boundaryFeatureOptions(
  layers: GisLayer[],
  selected: { layerId: string; index: number }[],
  maximum = 800,
  perLayer = 25,
) {
  const entries = boundaryLayerOptions(layers),
    choices: {
      key: string;
      layer: GisLayer;
      feature: AreaFeature;
      index: number;
      label: string;
    }[] = [],
    seen = new Set<string>();
  const add = (entry: (typeof entries)[number], item: (typeof entry.polygons)[number]) => {
    const key = `${entry.layer.id}:${item.index}`;
    if (seen.has(key) || choices.length >= maximum) return;
    seen.add(key);
    choices.push({
      key,
      layer: entry.layer,
      feature: item.feature,
      index: item.index,
      label:
        entry.layer.name +
        " · " +
        String(
          item.feature.properties?.["NAME"] ??
            item.feature.properties?.["OWNER_NAME"] ??
            item.feature.id ??
            "polygon " + (item.index + 1),
        ),
    });
  };
  for (const s of selected) {
    const e = entries.find((e) => e.layer.id === s.layerId),
      item = e?.polygons.find((p) => p.index === s.index);
    if (e && item) add(e, item);
  }
  for (let row = 0; row < perLayer && choices.length < maximum; row++)
    for (const entry of entries) {
      const item = entry.polygons[row];
      if (item) add(entry, item);
    }
  return choices;
}
export async function loadBoundaryPolygons(
  layer: GisLayer,
  bbox: [number, number, number, number],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (layer.source.kind !== "remote") throw new Error("This layer is not a remote connection.");
  if (!bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3])
    throw new Error("Move the map to a valid study area first.");
  const options = {
    bbox,
    where: layer.source.where,
    outFields: layer.source.outFields,
    signal,
    timeoutMs: 25000,
    geometryPrecision: 8,
  };
  const count =
    classifyUrl(layer.source.url) === "arcgis"
      ? await fetchArcgisFeatureCount(layer.source.url, options)
      : null;
  if (count !== null && count > 4000)
    throw new Error(
      `${count.toLocaleString()} features in this view. Zoom in or create a smaller selection layer before using it as a study boundary.`,
    );
  const fetched = await fetchRemoteGeoJSONPaged(layer.source.url, {
    ...options,
    maxTotalFeatures: 4001,
    pageSize: 1000,
  });
  signal.throwIfAborted();
  if (
    !fetched.complete ||
    fetched.truncated ||
    fetched.loaded > 4000 ||
    (count !== null && fetched.loaded !== count)
  )
    throw new Error(
      "Only part of this view loaded. Zoom in and retry; an incomplete study boundary was not used.",
    );
  assertBuildableBudget(fetched.data, 20000);
  return fetched.data;
}
