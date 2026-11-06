import type { Position } from "geojson";

const EARTH = 20037508.342789244;

export function toWebMercator(position: Position): [number, number] {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, Number(position[1])));
  return [
    (Number(position[0]) * EARTH) / 180,
    (Math.log(Math.tan(((90 + latitude) * Math.PI) / 360)) * EARTH) / Math.PI,
  ];
}

export interface FigureFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Ground meters across one figure unit, at the middle latitude of the study. */
  metersPerUnit: number;
  project: (position: Position) => [number, number];
}

/**
 * Fits the bounds into the figure without stretching them. Web Mercator matches the map images
 * placed behind the vectors, so rasters and features stay registered.
 */
export function figureFrame(
  bounds: [number, number, number, number],
  plot: { x: number; y: number; width: number; height: number },
): FigureFrame {
  const [minX, minY] = toWebMercator([bounds[0], bounds[1]]);
  const [maxX, maxY] = toWebMercator([bounds[2], bounds[3]]);
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  const scale = Math.min(plot.width / spanX, plot.height / spanY);
  const width = spanX * scale;
  const height = spanY * scale;
  const x = plot.x + (plot.width - width) / 2;
  const y = plot.y + (plot.height - height) / 2;
  const latitude = (((bounds[1] + bounds[3]) / 2) * Math.PI) / 180;
  return {
    x,
    y,
    width,
    height,
    metersPerUnit: Math.cos(latitude) / scale,
    project: (position) => {
      const [mx, my] = toWebMercator(position);
      return [x + (mx - minX) * scale, y + height - (my - minY) * scale];
    },
  };
}

const NICE_FEET = [100, 200, 500, 1000, 2000];
const NICE_MILES = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** A round ground distance for the scale bar, no wider than the given figure width. */
export function scaleBar(metersPerUnit: number, maxWidth: number) {
  const options = [
    ...NICE_FEET.map((feet) => ({
      label: `${feet.toLocaleString("en-US")} ft`,
      meters: feet * 0.3048,
    })),
    ...NICE_MILES.map((miles) => ({ label: `${miles} mi`, meters: miles * 1609.344 })),
  ];
  const fitting = options.filter((option) => option.meters / metersPerUnit <= maxWidth);
  const pick = fitting.at(-1) ?? options[0]!;
  return { label: pick.label, width: pick.meters / metersPerUnit };
}

/**
 * URL for a map image of exactly these bounds, or null when the source cannot produce one.
 * Cached ArcGIS tile URLs use the same service's export endpoint so they can appear in figures.
 */
export function rasterImageUrl(
  template: string | undefined,
  bounds: [number, number, number, number],
  width: number,
  height: number,
): string | null {
  if (!template) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const [minX, minY] = toWebMercator([bounds[0], bounds[1]]);
  const [maxX, maxY] = toWebMercator([bounds[2], bounds[3]]);
  const box = `${minX},${minY},${maxX},${maxY}`;
  if (template.includes("{bbox-epsg-3857}"))
    return template
      .replace("{bbox-epsg-3857}", box)
      .replace(/([?&])width=256(?=&|$)/i, `$1width=${w}`)
      .replace(/([?&])height=256(?=&|$)/i, `$1height=${h}`)
      .replace(/([?&])size=256,256(?=&|$)/i, `$1size=${w},${h}`);
  const tile = /^(.*\/MapServer)\/tile\/\{z\}\/\{y\}\/\{x\}$/i.exec(template);
  if (tile)
    return `${tile[1]}/export?bbox=${box}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=png32&transparent=true&f=image`;
  return null;
}
