import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { GisLayer } from "./types.ts";
import {
  chainLabelCollection,
  lineGapSourceId,
  lineLabelSourceId,
  placeInlineLabels,
  toWorld,
  type InlineView,
  type LineChain,
  type LineLabelMode,
  type MeasureText,
} from "./lineLabels.ts";

let measureContext: CanvasRenderingContext2D | null | undefined;
const fontCss = (font: string, size: number) => {
  const weight = /bold/i.test(font) ? "bold " : "";
  const style = /italic/i.test(font) ? "italic " : "";
  const family = font.replace(/\s+(Regular|Bold|Italic|Semibold|Light)\b/gi, "").trim();
  return `${style}${weight}${size}px "${family}", "Open Sans", sans-serif`;
};
export const canvasMeasure =
  (font: string): MeasureText =>
  (text, size) => {
    if (measureContext === undefined)
      measureContext =
        typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (!measureContext) return text.length * size * 0.58;
    measureContext.font = fontCss(font, size);
    // MapLibre's glyph advances run a little wider than the browser's.
    return measureContext.measureText(text).width * 1.05;
  };

export function inlineViewOf(map: MlMap): InlineView {
  const bounds = map.getBounds();
  const nw = toWorld([bounds.getWest(), bounds.getNorth()]);
  const se = toWorld([bounds.getEast(), bounds.getSouth()]);
  return {
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    bounds: [
      Math.min(nw[0], se[0]),
      Math.min(nw[1], se[1]),
      Math.max(nw[0], se[0]),
      Math.max(nw[1], se[1]),
    ],
  };
}

/** Matches the zoom-scaled text size in `buildLayerSpecs`. */
export const inlineLabelSize = (size: number, scaleWithZoom: boolean, zoom: number) => {
  if (!scaleWithZoom) return size;
  const low = Math.max(8, size - 4),
    high = Math.min(44, size + 4);
  return zoom <= 16
    ? low + ((size - low) * Math.max(0, zoom)) / 16
    : size + ((high - size) * Math.min(8, zoom - 16)) / 8;
};

const setOrAdd = (map: MlMap, id: string, data: FeatureCollection) => {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(id, { type: "geojson", data, tolerance: 0.375, buffer: 128 });
};

/**
 * Creates or refreshes the label (and, for inline labels, the cut line) sources
 * that `buildLayerSpecs` points at. `layerSourceKey` is the id used for the map
 * layers (print copies prefix it).
 */
export function syncLineLabelSources(
  map: MlMap,
  layerSourceKey: string,
  layer: GisLayer,
  fc: FeatureCollection,
  chains: LineChain[],
  mode: LineLabelMode,
  chainCollection?: FeatureCollection,
) {
  if (mode === "chain") {
    setOrAdd(
      map,
      lineLabelSourceId(layerSourceKey),
      chainCollection ?? chainLabelCollection(chains),
    );
    return;
  }
  const s = layer.style;
  const labelMinZoom = Math.max(0, Math.min(23, s.labelMinZoom ?? 4));
  const view = inlineViewOf(map);
  const result = placeInlineLabels(fc, chains, view, {
    size: inlineLabelSize(s.labelSize ?? 14, Boolean(s.labelScaleWithZoom), view.zoom),
    minZoom: labelMinZoom,
    maxZoom: Math.max(labelMinZoom + 0.5, Math.min(24, s.labelMaxZoom ?? 24)),
    measure: canvasMeasure(s.labelFont || "Open Sans Regular"),
  });
  setOrAdd(map, lineLabelSourceId(layerSourceKey), result.labels);
  setOrAdd(map, lineGapSourceId(layerSourceKey), result.lines);
}
