import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseShp, parseDbf } from "shpjs";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import {
  checkedLayersArchive,
  exportLayerItems,
  shapefileArchive,
  dbfRows,
} from "./selectedLayerExport.ts";
const ring = (x: number, w = 1) => [
  [x, 0],
  [x + w, 0],
  [x + w, 1],
  [x, 1],
  [x, 0],
];
const polygon: Feature<Polygon> = {
  type: "Feature",
  properties: { name: "A & B", owner: "One", long_field_name_a: 5, long_field_name_b: 9 },
  geometry: {
    type: "Polygon",
    coordinates: [
      ring(0),
      [
        [0.2, 0.2],
        [0.4, 0.2],
        [0.4, 0.4],
        [0.2, 0.4],
        [0.2, 0.2],
      ],
    ],
  },
};
const multi: Feature = {
  type: "Feature",
  properties: { name: "Second", owner: "Two" },
  geometry: { type: "MultiPolygon", coordinates: [[ring(2)], [ring(4)]] },
};
const data: FeatureCollection = { type: "FeatureCollection", features: [polygon, multi] };
const layer = { id: "one", name: "Parcels & holes", data };
test("per-layer export creates a multipart item without losing holes or inventing shared attributes", () => {
  const before = JSON.stringify(data);
  const result = exportLayerItems(layer, "layers");
  assert.equal(result.features.length, 1);
  const geometry = result.features[0]!.geometry;
  assert.equal(geometry.type, "MultiPolygon");
  if (geometry.type !== "MultiPolygon") throw Error();
  assert.equal(geometry.coordinates.length, 3);
  assert.equal(geometry.coordinates[0]!.length, 2);
  assert.equal(result.features[0]!.properties!["LD_COUNT"], 2);
  assert.equal(result.features[0]!.properties!["owner"], undefined);
  assert.equal(JSON.stringify(data), before);
  assert.equal(exportLayerItems(layer, "features").features.length, 2);
});
test("KMZ folders distinguish checked layers and preserve one or multiple feature items", async () => {
  const bytes = await checkedLayersArchive([layer, { ...layer, id: "two" }], "kmz", "layers");
  const zip = await JSZip.loadAsync(bytes);
  const kml = await zip.file("doc.kml")!.async("string");
  assert.equal((kml.match(/<Placemark>/g) || []).length, 2);
  assert.equal((kml.match(/<Polygon>/g) || []).length, 6);
  assert.equal((kml.match(/<innerBoundaryIs>/g) || []).length, 2);
  assert.ok(kml.includes("Parcels &amp; holes"));
  assert.equal(Object.keys(zip.files).filter((n) => n.endsWith("original.geojson")).length, 2);
  const original = JSON.parse(
    await zip.file("001_Parcels_holes/original.geojson")!.async("string"),
  );
  assert.equal(original.features[1].properties.owner, "Two");
  const featureZip = await JSZip.loadAsync(await checkedLayersArchive([layer], "kmz", "features"));
  assert.equal(
    ((await featureZip.file("doc.kml")!.async("string")).match(/<Placemark>/g) || []).length,
    2,
  );
});
test("SHP round-trip retains mixed single/multipolygon records and multipart holes", async () => {
  const zip = await JSZip.loadAsync(await shapefileArchive(data));
  const geometry = parseShp(await zip.file("layer/polygon.shp")!.async("arraybuffer"));
  const rows = parseDbf(
    await zip.file("layer/polygon.dbf")!.async("arraybuffer"),
    new ArrayBuffer(0),
  );
  assert.equal(geometry.length, 2);
  assert.equal(rows.length, 2);
  assert.equal(geometry[0]!.type, "Polygon");
  assert.equal((geometry[0] as Polygon).coordinates.length, 2);
  assert.equal(geometry[1]!.type, "MultiPolygon");
  assert.equal(rows[0]!["OWNER"], "One");
  assert.equal(rows[1]!["OWNER"], "Two");
  const combined = await JSZip.loadAsync(await checkedLayersArchive([layer], "shp", "layers"));
  const parts = parseShp(
    await combined.file("001_Parcels_holes/polygon.shp")!.async("arraybuffer"),
  );
  assert.equal(parts.length, 1);
  assert.equal(parts[0]!.type, "MultiPolygon");
  assert.equal((parts[0] as { coordinates: unknown[] }).coordinates.length, 3);
});
test("SHP line records and their attributes are not merged together", async () => {
  const lines: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: 1 },
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
      {
        type: "Feature",
        properties: { id: 2 },
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [2, 2],
              [3, 3],
            ],
            [
              [4, 4],
              [5, 5],
            ],
          ],
        },
      },
    ],
  };
  const zip = await JSZip.loadAsync(await shapefileArchive(lines));
  assert.equal(parseShp(await zip.file("layer/polyline.shp")!.async("arraybuffer")).length, 2);
  const rows = parseDbf(
    await zip.file("layer/polyline.dbf")!.async("arraybuffer"),
    new ArrayBuffer(0),
  );
  assert.deepEqual(
    rows.map((r) => r!["ID"]),
    [1, 2],
  );
});
test("DBF collisions have distinct short names and full attributes remain in sidecars", async () => {
  const { fields } = dbfRows(data.features);
  assert.notEqual(fields["long_field_name_a"], fields["long_field_name_b"]);
  assert.ok(Object.values(fields).every((f) => f.length <= 10));
  const zip = await JSZip.loadAsync(await checkedLayersArchive([layer], "shp", "features"));
  const original = JSON.parse(
    await zip.file("001_Parcels_holes/original.geojson")!.async("string"),
  );
  assert.equal(original.features[0].properties.long_field_name_b, 9);
});
test("empty export fails explicitly and mixed geometry families remain available", async () => {
  await assert.rejects(() => checkedLayersArchive([], "kmz", "layers"), /Check at least/);
  await assert.rejects(
    () => shapefileArchive({ type: "FeatureCollection", features: [] }),
    /No loaded/,
  );
  const mixed = {
    ...layer,
    data: {
      type: "FeatureCollection" as const,
      features: [
        polygon,
        {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: [1, 1] },
        },
      ],
    },
  };
  const zip = await JSZip.loadAsync(await checkedLayersArchive([mixed], "shp", "layers"));
  assert.ok(zip.file("001_Parcels_holes/polygon.shp"));
  assert.ok(zip.file("001_Parcels_holes/point.shp"));
});
