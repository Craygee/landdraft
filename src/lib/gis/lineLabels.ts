import type { Feature, FeatureCollection, Position } from "geojson";
import type { GisLayer } from "./types.ts";
import { isParcelLayer } from "./parcelDisplay.ts";

/**
 * Line labelling helpers.
 *
 * Remote line services (pipelines, flowlines) usually arrive as many short
 * segments. MapLibre can only place a line label on a single piece of line that
 * is longer than the text, so labels on chopped-up lines often never appear.
 * We join segments that share an end point and the same label text into
 * chains, and label the chains instead.
 *
 * The "inline" placement goes further: it picks a straight stretch of each
 * chain, rotates the text to match, and cuts that stretch out of the drawn line
 * so the label sits in the line itself with nothing painted behind it.
 */

export const lineLabelSourceId = (layerId: string) => `src-line-labels-${layerId}`;
export const lineGapSourceId = (layerId: string) => `src-line-gap-${layerId}`;

export type LineLabelMode = "chain" | "inline";

type Geometry = "point" | "line" | "polygon" | "mixed";

export function lineLabelMode(layer: GisLayer, geometry: Geometry): LineLabelMode | null {
  const s = layer.style;
  if (!s.labelEnabled || (!s.labelUseLayerName && !s.labelTemplate.trim())) return null;
  if (geometry !== "line" || isParcelLayer(layer)) return null;
  const placement = s.labelPlacement ?? "auto";
  if (placement === "inline") return "inline";
  if (["auto", "follow-line", "above", "below", "horizontal"].includes(placement)) return "chain";
  return null;
}

/** Web-mercator world coordinates in [0, 1]; one world unit is 512 * 2^zoom pixels. */
export const toWorld = (p: Position): [number, number] => {
  const lat = (Math.max(-85, Math.min(85, p[1]!)) * Math.PI) / 180;
  return [p[0]! / 360 + 0.5, (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2];
};
export const fromWorld = (p: [number, number]): [number, number] => [
  (p[0] - 0.5) * 360,
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * p[1]))) * 180) / Math.PI,
];

interface ChainPiece {
  feature: number;
  part: number;
  reversed: boolean;
  /** Distance along the chain, in world units, where this piece starts and ends. */
  start: number;
  end: number;
}
export interface LineChain {
  label: string;
  world: Array<[number, number]>;
  /** Cumulative distance at each vertex of `world`. */
  dist: number[];
  pieces: ChainPiece[];
  bbox: [number, number, number, number];
}

const lineParts = (feature: Feature): Position[][] => {
  const g = feature.geometry;
  if (g?.type === "LineString") return [g.coordinates];
  if (g?.type === "MultiLineString") return g.coordinates;
  return [];
};
const pointKey = (p: Position) => `${p[0]!.toFixed(6)},${p[1]!.toFixed(6)}`;

/** Joins touching line parts that carry the same `__label` into longer chains. */
export function buildLineChains(fc: FeatureCollection): LineChain[] {
  interface Part {
    feature: number;
    part: number;
    label: string;
    coords: Position[];
    used: boolean;
  }
  const parts: Part[] = [];
  const byEnd = new Map<string, Part[]>();
  fc.features.forEach((feature, index) => {
    const props = feature.properties ?? {};
    if (props["__hidden"] === true) return;
    const label = String(props["__label"] ?? "").trim();
    if (!label) return;
    lineParts(feature).forEach((coords, part) => {
      if (coords.length < 2) return;
      const item: Part = { feature: index, part, label, coords, used: false };
      parts.push(item);
      for (const end of [coords[0]!, coords[coords.length - 1]!]) {
        const key = label + "|" + pointKey(end);
        const list = byEnd.get(key);
        if (list) list.push(item);
        else byEnd.set(key, [item]);
      }
    });
  });

  const chains: LineChain[] = [];
  for (const seed of parts) {
    if (seed.used) continue;
    seed.used = true;
    const sequence: Array<{ part: Part; reversed: boolean }> = [{ part: seed, reversed: false }];
    const extend = (atTail: boolean) => {
      for (let guard = 0; guard < 100_000; guard++) {
        const edge = atTail ? sequence[sequence.length - 1]! : sequence[0]!;
        const coords = edge.part.coords;
        // The open end of the chain on this side.
        const open = atTail === !edge.reversed ? coords[coords.length - 1]! : coords[0]!;
        const next = byEnd.get(edge.part.label + "|" + pointKey(open))?.find((p) => !p.used);
        if (!next) return;
        next.used = true;
        const startsAtOpen = pointKey(next.coords[0]!) === pointKey(open);
        // Appended at the tail, the next part runs away from the joint; prepended, it runs into it.
        const reversed = atTail ? !startsAtOpen : startsAtOpen;
        if (atTail) sequence.push({ part: next, reversed });
        else sequence.unshift({ part: next, reversed });
      }
    };
    extend(true);
    extend(false);

    const world: Array<[number, number]> = [];
    const dist: number[] = [];
    const pieces: ChainPiece[] = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const { part, reversed } of sequence) {
      const coords = reversed ? [...part.coords].reverse() : part.coords;
      const start = dist.length ? dist[dist.length - 1]! : 0;
      coords.forEach((c, i) => {
        const w = toWorld(c);
        if (i === 0 && world.length) return; // shared joint
        const prev = world[world.length - 1];
        dist.push(prev ? dist[dist.length - 1]! + Math.hypot(w[0] - prev[0], w[1] - prev[1]) : 0);
        world.push(w);
        minX = Math.min(minX, w[0]);
        maxX = Math.max(maxX, w[0]);
        minY = Math.min(minY, w[1]);
        maxY = Math.max(maxY, w[1]);
      });
      pieces.push({
        feature: part.feature,
        part: part.part,
        reversed,
        start,
        end: dist[dist.length - 1]!,
      });
    }
    if (world.length >= 2)
      chains.push({ label: seed.label, world, dist, pieces, bbox: [minX, minY, maxX, maxY] });
  }
  return chains;
}

export function chainLabelCollection(chains: LineChain[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: chains.map((chain) => ({
      type: "Feature",
      properties: { __label: chain.label },
      geometry: { type: "LineString", coordinates: chain.world.map(fromWorld) },
    })),
  };
}

const pointAt = (chain: LineChain, d: number): [number, number] => {
  const { dist, world } = chain;
  let lo = 0,
    hi = dist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const a = world[lo]!,
    b = world[hi]!;
  const span = dist[hi]! - dist[lo]!;
  const t = span > 0 ? Math.max(0, Math.min(1, (d - dist[lo]!) / span)) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

const segmentDistance = (
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
) => {
  const pointSeg = (p: [number, number], s: [number, number], e: [number, number]) => {
    const dx = e[0] - s[0],
      dy = e[1] - s[1];
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / (dx * dx + dy * dy || 1)),
    );
    return Math.hypot(p[0] - s[0] - t * dx, p[1] - s[1] - t * dy);
  };
  const cross = (o: [number, number], p: [number, number], q: [number, number]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
};

export interface InlineView {
  zoom: number;
  bearing: number;
  /** Visible area in world units: [minX, minY, maxX, maxY]. */
  bounds: [number, number, number, number];
}
export type MeasureText = (text: string, size: number) => number;
export const estimateTextWidth: MeasureText = (text, size) => text.length * size * 0.58;

export interface InlineResult {
  labels: FeatureCollection;
  lines: FeatureCollection;
}

/**
 * Places straight labels inside each chain and returns the label points plus
 * a copy of the line data with the stretch under every label removed.
 */
export function placeInlineLabels(
  fc: FeatureCollection,
  chains: LineChain[],
  view: InlineView,
  options: {
    size: number;
    minZoom: number;
    maxZoom: number;
    measure?: MeasureText;
    maxLabels?: number;
  },
): InlineResult {
  const measure = options.measure ?? estimateTextWidth;
  const scale = 512 * 2 ** view.zoom;
  const size = options.size;
  const gaps = new Map<string, Array<[number, number]>>();
  const labels: Feature[] = [];
  const placed: Array<[[number, number], [number, number]]> = [];
  const active = view.zoom >= options.minZoom && view.zoom < options.maxZoom;
  const [bx0, by0, bx1, by1] = view.bounds;
  const marginX = (bx1 - bx0) * 0.25,
    marginY = (by1 - by0) * 0.25;
  const maxLabels = options.maxLabels ?? 1500;
  const widths = new Map<string, number>();

  if (active)
    for (const chain of chains) {
      if (labels.length >= maxLabels) break;
      const [cx0, cy0, cx1, cy1] = chain.bbox;
      if (cx1 < bx0 - marginX || cx0 > bx1 + marginX || cy1 < by0 - marginY || cy0 > by1 + marginY)
        continue;
      let textPx = widths.get(chain.label);
      if (textPx === undefined) {
        textPx = measure(chain.label, size);
        widths.set(chain.label, textPx);
      }
      const padPx = Math.max(3, size * 0.4);
      const gap = (textPx + padPx * 2) / scale;
      const total = chain.dist[chain.dist.length - 1]!;
      if (total < gap + (size * 2) / scale) continue;
      const spacing = Math.max(gap * 3, 420 / scale);
      const count = Math.max(1, Math.floor(total / spacing));
      const step = total / count;
      for (let k = 0; k < count && labels.length < maxLabels; k++) {
        const base = (k + 0.5) * step;
        let chosen: { from: number; to: number; center: number } | null = null;
        for (const shift of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45]) {
          const center = base + shift * step;
          const from = center - gap / 2,
            to = center + gap / 2;
          if (from < 0 || to > total) continue;
          const a = pointAt(chain, from),
            b = pointAt(chain, to);
          const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (chord < gap * 0.97) continue;
          // Every vertex inside the stretch must stay close to the straight label.
          let straight = true;
          const tolerance = (size * 0.3) / scale;
          for (let i = 0; i < chain.dist.length; i++) {
            const d = chain.dist[i]!;
            if (d <= from || d >= to) continue;
            const p = chain.world[i]!;
            const off =
              Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) /
              (chord || 1);
            if (off > tolerance) {
              straight = false;
              break;
            }
          }
          if (!straight) continue;
          const mid = pointAt(chain, center);
          if (mid[0] < bx0 - marginX || mid[0] > bx1 + marginX) continue;
          if (mid[1] < by0 - marginY || mid[1] > by1 + marginY) continue;
          const minClear = (size * 1.1) / scale;
          if (placed.some(([p, q]) => segmentDistance(a, b, p, q) < minClear)) continue;
          chosen = { from, to, center };
          placed.push([a, b]);
          break;
        }
        if (!chosen) continue;
        const a = pointAt(chain, chosen.from),
          b = pointAt(chain, chosen.to);
        let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        const onScreen = ((((angle - view.bearing) % 360) + 540) % 360) - 180;
        if (onScreen > 90 || onScreen < -90) {
          angle += 180;
        }
        labels.push({
          type: "Feature",
          properties: { __label: chain.label, __angle: angle },
          geometry: { type: "Point", coordinates: fromWorld(pointAt(chain, chosen.center)) },
        });
        for (const piece of chain.pieces) {
          if (piece.end <= chosen.from || piece.start >= chosen.to) continue;
          const lo = Math.max(chosen.from, piece.start) - piece.start;
          const hi = Math.min(chosen.to, piece.end) - piece.start;
          const length = piece.end - piece.start;
          const local: [number, number] = piece.reversed ? [length - hi, length - lo] : [lo, hi];
          const key = piece.feature + ":" + piece.part;
          const list = gaps.get(key);
          if (list) list.push(local);
          else gaps.set(key, [local]);
        }
      }
    }

  const lines: Feature[] = fc.features.map((feature, index) => {
    const parts = lineParts(feature);
    const base = {
      type: "Feature" as const,
      properties: { ...(feature.properties ?? {}), __idx: index },
    };
    if (!parts.length || !parts.some((_, part) => gaps.has(index + ":" + part)))
      return { ...base, geometry: feature.geometry };
    const pieces: Position[][] = [];
    parts.forEach((coords, part) => {
      const cut = gaps.get(index + ":" + part);
      if (!cut) {
        pieces.push(coords);
        return;
      }
      pieces.push(...cutLine(coords, cut));
    });
    return { ...base, geometry: { type: "MultiLineString", coordinates: pieces } };
  });
  return {
    labels: { type: "FeatureCollection", features: labels },
    lines: { type: "FeatureCollection", features: lines },
  };
}

/** Removes the given distance intervals (world units from the line start) from a line. */
export function cutLine(coords: Position[], intervals: Array<[number, number]>): Position[][] {
  const world = coords.map(toWorld);
  const dist = [0];
  for (let i = 1; i < world.length; i++)
    dist.push(
      dist[i - 1]! + Math.hypot(world[i]![0] - world[i - 1]![0], world[i]![1] - world[i - 1]![1]),
    );
  const total = dist[dist.length - 1]!;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const keep: Array<[number, number]> = [];
  let cursor = 0;
  for (const [from, to] of sorted) {
    if (from > cursor) keep.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < total) keep.push([cursor, total]);
  const at = (d: number): Position => {
    let i = 1;
    while (i < dist.length - 1 && dist[i]! < d) i++;
    const span = dist[i]! - dist[i - 1]!;
    const t = span > 0 ? Math.max(0, Math.min(1, (d - dist[i - 1]!) / span)) : 0;
    const a = world[i - 1]!,
      b = world[i]!;
    return fromWorld([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  };
  const out: Position[][] = [];
  for (const [from, to] of keep) {
    if (to - from <= 0) continue;
    const piece: Position[] = [at(from)];
    for (let i = 0; i < coords.length; i++)
      if (dist[i]! > from && dist[i]! < to) piece.push(coords[i]!);
    piece.push(at(to));
    out.push(piece);
  }
  return out;
}
