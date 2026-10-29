import type { Feature, FeatureCollection, Position } from "geojson";
import type { GisLayer } from "./types.ts";

export const PARCEL_OVERVIEW_ZOOM = 10;
export function parcelLabelSizeAtZoom(size: number, zoom: number) {
  const small = Math.min(size, 5);
  return small + (size - small) * Math.max(0, Math.min(1, (zoom - 11) / 2));
}
export function parcelLabelSizeExpression(size: number) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    parcelLabelSizeAtZoom(size, 11),
    11,
    parcelLabelSizeAtZoom(size, 11),
    13,
    size,
    24,
    size,
  ];
}
export const parcelLabelSourceId = (id: string) => `src-parcel-labels-${id}`;
export const isParcelLayer = (layer: GisLayer) =>
  layer.source.kind === "remote" &&
  (layer.source.catalogId === "tx-parcels" ||
    /landdraft-public-parcels\..*\/texas\//.test(layer.source.url));
export const mercatorPoint = (p: Position): [number, number] => {
  const lat = (Math.max(-85, Math.min(85, p[1]!)) * Math.PI) / 180;
  return [p[0]! / 360 + 0.5, (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2];
};
const unproject = (p: number[]): [number, number] => [
  (p[0]! - 0.5) * 360,
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * p[1]!))) * 180) / Math.PI,
];
const ringArea = (ring: number[][]) =>
  Math.abs(
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return sum + p[0]! * q[1]! - q[0]! * p[1]!;
    }, 0) / 2,
  );
export function parcelScreenArea(feature: Feature, zoom: number) {
  const geometry = feature.geometry;
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return (
    polygons.reduce(
      (sum, polygon) =>
        sum +
        polygon.reduce(
          (area, ring, i) => area + (i ? -1 : 1) * ringArea(ring.map(mercatorPoint)),
          0,
        ),
      0,
    ) *
    (512 * 2 ** zoom) ** 2
  );
}
function clearance(point: number[], rings: number[][][]) {
  let inside = false;
  let distance = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!,
        b = ring[j]!;
      if (
        a[1]! > point[1]! !== b[1]! > point[1]! &&
        point[0]! < ((b[0]! - a[0]!) * (point[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!
      )
        inside = !inside;
      const dx = b[0]! - a[0]!,
        dy = b[1]! - a[1]!;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0]! - a[0]!) * dx + (point[1]! - a[1]!) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      distance = Math.min(
        distance,
        Math.hypot(point[0]! - a[0]! - t * dx, point[1]! - a[1]! - t * dy),
      );
    }
  }
  return inside ? distance : 0;
}
/** Conservative interior circle: labels must fit wholly inside it, including holes. */
export function parcelInterior(polygon: Position[][]) {
  const rings = polygon.map((ring) => ring.map(mercatorPoint));
  const outer = rings[0];
  if (!outer?.length) return null;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of outer) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  let point = [(minX + maxX) / 2, (minY + maxY) / 2];
  let radius = clearance(point, rings);
  if (radius === 0) {
    for (const fraction of [0.25, 0.5, 0.75]) {
      const y = minY + (maxY - minY) * fraction;
      const crossings: number[] = [];
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i]!,
            b = ring[j]!;
          if (a[1]! > y !== b[1]! > y)
            crossings.push(a[0]! + ((y - a[1]!) * (b[0]! - a[0]!)) / (b[1]! - a[1]!));
        }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const candidate = [(crossings[i]! + crossings[i + 1]!) / 2, y];
        const r = clearance(candidate, rings);
        if (r > radius) {
          radius = r;
          point = candidate;
        }
      }
    }
  }
  return radius > 0 ? { coordinates: unproject(point), radius } : null;
}
export function buildParcelLabels(layer: GisLayer, data: FeatureCollection): FeatureCollection {
  const features: Feature[] = [];
  const size = layer.style.labelSize ?? 12;
  for (const feature of data.features) {
    const text = String(feature.properties?.["__label"] ?? "").trim();
    if (!text) continue;
    const lines: string[] = [];
    for (const word of text.split(/\s+/)) {
      if (lines.length && lines[lines.length - 1]!.length + word.length < 9)
        lines[lines.length - 1] += " " + word;
      else lines.push(word);
    }
    const paddedRadius = (font: number) =>
      Math.hypot(
        Math.max(...lines.map((line) => line.length)) * font * 0.72,
        lines.length * font * (layer.style.labelLineSpacing ?? 1.2),
      ) /
        2 +
      (layer.style.labelHaloWidth ?? 2) +
      4;
    const geometry = feature.geometry;
    const polygons =
      geometry?.type === "Polygon"
        ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    // One label per source feature, using the largest usable interior component.
    const interior = polygons
      .map(parcelInterior)
      .filter((value) => value !== null)
      .sort((a, b) => b.radius - a.radius)[0];
    if (!interior) continue;
    let minimumZoom = Math.max(0, Math.log2(paddedRadius(size) / (interior.radius * 512)));
    if (layer.style.labelScaleWithZoom) {
      // Font and polygon both grow with zoom. Find the first zoom at which the
      // actual interpolated text fits, rather than testing the largest font.
      let low = 0,
        high = 25;
      for (let step = 0; step < 30; step++) {
        const zoom = (low + high) / 2;
        if (interior.radius * 512 * 2 ** zoom >= paddedRadius(parcelLabelSizeAtZoom(size, zoom)))
          high = zoom;
        else low = zoom;
      }
      minimumZoom = high;
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: interior.coordinates },
      properties: {
        ...feature.properties,
        __label: lines.join("\n"),
        __parcelLabelMinZoom: minimumZoom,
        __parcelLabelPriority: -interior.radius,
      },
    });
  }
  return { type: "FeatureCollection", features };
}
