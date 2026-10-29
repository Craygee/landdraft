import { resolveExportStyle, kmlFeatureStyle, exportFeatureLabel } from "./exportStyle.ts";
import type { LayerStyle } from "./types";
import type { Feature, FeatureCollection, Position } from "geojson";
const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const coord = (p: Position) => `${p[0]},${p[1]}${p[2] !== undefined ? `,${p[2]}` : ""}`;
const ring = (r: Position[]) => r.map(coord).join(" ");

export function geometryToKml(geom: Feature["geometry"]): string {
  if (!geom) return "";
  switch (geom.type) {
    case "Point":
      return `<Point><coordinates>${coord(geom.coordinates)}</coordinates></Point>`;
    case "MultiPoint":
      return `<MultiGeometry>${geom.coordinates.map((c) => `<Point><coordinates>${coord(c)}</coordinates></Point>`).join("")}</MultiGeometry>`;
    case "LineString":
      return `<LineString><tessellate>1</tessellate><coordinates>${ring(geom.coordinates)}</coordinates></LineString>`;
    case "MultiLineString":
      return `<MultiGeometry>${geom.coordinates.map((l) => `<LineString><coordinates>${ring(l)}</coordinates></LineString>`).join("")}</MultiGeometry>`;
    case "Polygon": {
      const [outer, ...holes] = geom.coordinates;
      return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(outer ?? [])}</coordinates></LinearRing></outerBoundaryIs>${holes
        .map(
          (h) =>
            `<innerBoundaryIs><LinearRing><coordinates>${ring(h)}</coordinates></LinearRing></innerBoundaryIs>`,
        )
        .join("")}</Polygon>`;
    }
    case "MultiPolygon":
      return `<MultiGeometry>${geom.coordinates
        .map((poly) => geometryToKml({ type: "Polygon", coordinates: poly } as Feature["geometry"]))
        .join("")}</MultiGeometry>`;
    case "GeometryCollection":
      return `<MultiGeometry>${geom.geometries.map(geometryToKml).join("")}</MultiGeometry>`;
    default:
      return "";
  }
}

export function toKml(fc: FeatureCollection, layerName: string, style?: LayerStyle): string {
  const placemarks = fc.features
    .map((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const nameKey = Object.keys(props).find((k) => /^(name|title|owner|label)$/i.test(k));
      const data = Object.entries(props)
        .map(
          ([k, v]) =>
            `<Data name="${esc(k)}"><value>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</value></Data>`,
        )
        .join("");
      return `<Placemark><name>${esc(style ? exportFeatureLabel(f, { id: "layer", name: layerName, data: fc, style }) || layerName : nameKey ? props[nameKey] : layerName)}</name>${style ? kmlFeatureStyle(resolveExportStyle(style, props)) : ""}<ExtendedData>${data}</ExtendedData>${geometryToKml(f.geometry)}</Placemark>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(layerName)}</name>
${placemarks}
</Document></kml>`;
}
