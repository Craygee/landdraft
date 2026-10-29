import {
  resolveExportStyle,
  exportFeatureLabel,
  kmlFeatureStyle,
  iconKey,
  STYLE_EXPORT_NOTES,
  type StyledExportLayer,
  type ResolvedExportStyle,
} from "./exportStyle.ts";
import { exportSld } from "./exportSld.ts";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import JSZip from "jszip";
import { rewind } from "@turf/turf";
import { analyzeImportComplexity } from "./importBudget.ts";
import { geometryToKml } from "./exportGeometry.ts";
export type ExportItemMode = "features" | "layers";
export type ExportSelectionLayer = StyledExportLayer;
const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const visit = (
  geometry: Geometry,
  fn: (g: Exclude<Geometry, { type: "GeometryCollection" }>) => void,
) => {
  if (geometry.type === "GeometryCollection") geometry.geometries.forEach((g) => visit(g, fn));
  else fn(geometry);
};
export function exportLayerItems(
  layer: ExportSelectionLayer,
  mode: ExportItemMode,
): FeatureCollection {
  const data = structuredClone(layer.data);
  if (mode === "features") return data;
  const polygons: Position[][][] = [],
    lines: Position[][] = [],
    points: Position[] = [];
  for (const f of data.features) {
    if (!f.geometry)
      throw new Error(
        `${layer.name} contains an item without geometry. Use original feature items or repair it.`,
      );
    visit(f.geometry, (g) => {
      if (g.type === "Polygon") polygons.push(g.coordinates);
      if (g.type === "MultiPolygon") polygons.push(...g.coordinates);
      if (g.type === "LineString") lines.push(g.coordinates);
      if (g.type === "MultiLineString") lines.push(...g.coordinates);
      if (g.type === "Point") points.push(g.coordinates);
      if (g.type === "MultiPoint") points.push(...g.coordinates);
    });
  }
  const geometries: Geometry[] = [];
  if (polygons.length) geometries.push({ type: "MultiPolygon", coordinates: polygons });
  if (lines.length) geometries.push({ type: "MultiLineString", coordinates: lines });
  if (points.length) geometries.push({ type: "MultiPoint", coordinates: points });
  if (!geometries.length) return { type: "FeatureCollection", features: [] };
  // Only shared attributes can truthfully describe a whole layer. Preserve all member attributes in the archive sidecar.
  const shared = { ...data.features[0]?.properties };
  for (const key of Object.keys(shared))
    if (
      !data.features.every(
        (f) => JSON.stringify(f.properties?.[key]) === JSON.stringify(shared[key]),
      )
    )
      delete shared[key];
  let key = "LD_LAYER";
  while (key in shared) key += "_";
  shared[key] = layer.name;
  let count = "LD_COUNT";
  while (count in shared) count += "_";
  shared[count] = data.features.length;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: layer.id,
        properties: shared,
        geometry:
          geometries.length === 1 ? geometries[0]! : { type: "GeometryCollection", geometries },
      },
    ],
  };
}
export function shapefileGroups(data: FeatureCollection) {
  const groups: Record<"POLYGON" | "POLYLINE" | "POINT", Feature[]> = {
    POLYGON: [],
    POLYLINE: [],
    POINT: [],
  };
  for (const feature of data.features) {
    if (!feature.geometry)
      throw new Error("An exported item has no geometry. Repair or remove it before SHP export.");
    visit(feature.geometry, (g) => {
      const copy = (geometry: Geometry): Feature => ({ ...feature, geometry });
      if (g.type === "Polygon" || g.type === "MultiPolygon")
        groups.POLYGON.push(
          rewind(
            copy(g.type === "Polygon" ? { type: "MultiPolygon", coordinates: [g.coordinates] } : g),
            { reverse: true },
          ) as Feature,
        );
      if (g.type === "LineString" || g.type === "MultiLineString")
        groups.POLYLINE.push(
          copy(
            g.type === "LineString" ? { type: "MultiLineString", coordinates: [g.coordinates] } : g,
          ),
        );
      if (g.type === "Point") groups.POINT.push(copy(g));
      if (g.type === "MultiPoint")
        g.coordinates.forEach((p) => groups.POINT.push(copy({ type: "Point", coordinates: p })));
    });
  }
  return groups;
}
export function dbfRows(features: Feature[]) {
  const fields: Record<string, string> = Object.create(null),
    used = new Set<string>();
  for (const f of features)
    for (const key of Object.keys(f.properties ?? {}))
      if (!(key in fields)) {
        const base =
          key
            .replace(/[^a-z0-9_]/gi, "_")
            .toUpperCase()
            .slice(0, 10) || "FIELD";
        let name = base,
          suffix = 1;
        while (used.has(name)) {
          const s = String(suffix++);
          name = base.slice(0, 10 - s.length) + s;
        }
        fields[key] = name;
        used.add(name);
      }
  const rows = features.map((f) =>
    Object.fromEntries(
      Object.entries(fields).map(([key, name]) => {
        const value = f.properties?.[key];
        return [
          name,
          value === null || value === undefined
            ? ""
            : typeof value === "number" || typeof value === "boolean"
              ? value
              : (typeof value === "object" ? JSON.stringify(value) : String(value)).slice(0, 254),
        ];
      }),
    ),
  );
  return { fields, rows };
}
export function styledExportItems(layer: ExportSelectionLayer, mode: ExportItemMode) {
  if (!layer.style)
    return {
      data: exportLayerItems(layer, mode),
      rules: [] as { id: string; style: ResolvedExportStyle; iconHref?: string }[],
      styleField: "",
      labelField: "",
    };
  const propertyNames = new Set(
    layer.data.features.flatMap((f) => Object.keys(f.properties ?? {})).map((k) => k.toUpperCase()),
  );
  const field = (base: string) => {
    let candidate = base,
      n = 0;
    while (propertyNames.has(candidate.toUpperCase())) candidate = base.slice(0, 7) + String(++n);
    propertyNames.add(candidate.toUpperCase());
    return candidate;
  };
  const styleField = field("LD_STYLE"),
    labelField = field("LD_LABEL");
  const buckets = new Map<
    string,
    { id: string; style: ResolvedExportStyle; features: Feature[] }
  >();
  for (const feature of layer.data.features) {
    const style = resolveExportStyle(layer.style, feature.properties),
      key = JSON.stringify(style);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { id: `s${buckets.size}`, style, features: [] };
      buckets.set(key, bucket);
    }
    bucket.features.push(feature);
  }
  const rules = Array.from(buckets.values()).map(({ id, style }) => ({
    id,
    style,
    iconHref: layer.exportIcons?.[iconKey(style)] ? `icons/${id}.png` : undefined,
  }));
  const features = Array.from(buckets.values()).flatMap((bucket) => {
    const data = exportLayerItems(
      { ...layer, data: { type: "FeatureCollection", features: bucket.features } },
      mode,
    );
    return data.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        [styleField]: bucket.id,
        [labelField]: mode === "layers" ? layer.name : exportFeatureLabel(feature, layer),
      },
    }));
  });
  return {
    data: { type: "FeatureCollection", features } as FeatureCollection,
    rules,
    styleField,
    labelField,
  };
}

async function addShapefiles(
  zip: JSZip,
  data: FeatureCollection,
  prefix: string,
  styling?: ReturnType<typeof styledExportItems>,
) {
  const mod = await import("@mapbox/shp-write");
  const writer =
    (mod as unknown as { write?: typeof mod.write; default?: { write: typeof mod.write } }).write ??
    (mod as unknown as { default?: { write: typeof mod.write } }).default?.write;
  if (!writer) throw new Error("Shapefile writer unavailable");
  const groups = shapefileGroups(data);
  for (const type of ["POLYGON", "POLYLINE", "POINT"] as const) {
    const features = groups[type];
    if (!features.length) continue;
    const { fields, rows } = dbfRows(features);
    const result = await new Promise<{ shp: DataView; shx: DataView; dbf: DataView; prj: string }>(
      (resolve, reject) =>
        writer(
          rows,
          type,
          features.map(
            (f) => (f.geometry as Exclude<Geometry, { type: "GeometryCollection" }>).coordinates,
          ) as object[],
          (error, files) =>
            error
              ? reject(error)
              : resolve(
                  files as unknown as { shp: DataView; shx: DataView; dbf: DataView; prj: string },
                ),
        ),
    );
    const name = `${prefix}/${type.toLowerCase()}`;
    for (const ext of ["shp", "shx", "dbf"] as const) {
      const view = result[ext];
      zip.file(`${name}.${ext}`, new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }
    zip.file(`${name}.prj`, result.prj);
    zip.file(`${name}_fields.json`, JSON.stringify(fields, null, 2));
    if (styling?.rules.length)
      zip.file(
        `${name}.sld`,
        exportSld(
          type.toLowerCase(),
          type,
          styling.rules,
          fields[styling.styleField]!,
          fields[styling.labelField]!,
        ),
      );
  }
}
const readme =
  "WGS84 longitude/latitude. Multipart polygon rings and holes are preserved; overlapping parts are not dissolved. SHP separates geometry families; MultiPoint items become point records with the same attributes. DBF names are limited to 10 characters and text to 254 characters; *_fields.json maps field names. Full original geometry and attributes are retained in original.geojson. A multipart layer item retains shared attributes; differing member attributes remain in the original sidecar. Exports contain currently loaded features only, not an entire connected service.";
export async function shapefileArchive(data: FeatureCollection): Promise<Uint8Array> {
  analyzeImportComplexity("SHP export", data);
  if (!data.features.length) throw new Error("No loaded features to export.");
  const zip = new JSZip();
  await addShapefiles(zip, data, "layer");
  zip.file("original.geojson", JSON.stringify(data));
  zip.file("README.txt", readme + "\n\n" + STYLE_EXPORT_NOTES);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
export async function checkedLayersArchive(
  layers: ExportSelectionLayer[],
  format: "kmz" | "shp",
  mode: ExportItemMode,
): Promise<Uint8Array> {
  if (!layers.length) throw new Error("Check at least one layer.");
  const all: FeatureCollection = {
    type: "FeatureCollection",
    features: layers.flatMap((l) => l.data.features),
  };
  analyzeImportComplexity("Checked layer export", all);
  if (!all.features.length) throw new Error("No loaded features to export.");
  const zip = new JSZip();
  const folders: string[] = [];
  for (const [i, layer] of layers.entries()) {
    const prefix = `${String(i + 1).padStart(3, "0")}_${layer.name.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 55) || "layer"}`;
    const styling = styledExportItems(layer, mode);
    const data = styling.data;
    zip.file(`${prefix}/original.geojson`, JSON.stringify(layer.data));
    zip.file(`${prefix}/items.geojson`, JSON.stringify(data));
    if (layer.style)
      zip.file(
        `${prefix}/styles.json`,
        JSON.stringify(
          {
            version: 1,
            style: layer.style,
            styleField: styling.styleField,
            labelField: styling.labelField,
            rules: styling.rules,
          },
          null,
          2,
        ),
      );
    for (const rule of styling.rules)
      if (rule.iconHref) {
        const image = layer.exportIcons?.[iconKey(rule.style)];
        if (image) zip.file(`${prefix}/${rule.iconHref}`, image.split(",")[1]!, { base64: true });
      }
    if (format === "shp") await addShapefiles(zip, data, prefix, styling);
    else
      folders.push(
        `<Folder><name>${esc(layer.name)}</name>${data.features
          .map(
            (f, index) =>
              `<Placemark><name>${esc(layer.style ? f.properties?.[styling.labelField] || layer.name : mode === "layers" ? layer.name : (f.properties?.["name"] ?? f.properties?.["NAME"] ?? `${layer.name} ${index + 1}`))}</name>${(() => {
                const rule = styling.rules.find((r) => r.id === f.properties?.[styling.styleField]);
                return rule
                  ? `<visibility>${rule.style.visible ? 1 : 0}</visibility>${kmlFeatureStyle(rule.style, rule.iconHref ? `${prefix}/${rule.iconHref}` : undefined)}`
                  : "";
              })()}<ExtendedData>${Object.entries(f.properties ?? {})
                .map(
                  ([key, value]) =>
                    `<Data name="${esc(key)}"><value>${esc(typeof value === "object" ? JSON.stringify(value) : value)}</value></Data>`,
                )
                .join("")}</ExtendedData>${geometryToKml(f.geometry)}</Placemark>`,
          )
          .join("")}</Folder>`,
      );
  }
  if (format === "kmz")
    zip.file(
      "doc.kml",
      `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>LandDraft checked layers</name>${folders.join("")}</Document></kml>`,
    );
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        mode,
        scope: "loaded-features",
        layers: layers.map((l) => ({
          id: l.id,
          name: l.name,
          featureCount: l.data.features.length,
        })),
      },
      null,
      2,
    ),
  );
  zip.file("README.txt", readme + "\n\n" + STYLE_EXPORT_NOTES);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
