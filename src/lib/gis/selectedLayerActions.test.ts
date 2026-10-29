import test from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import type { Feature } from "geojson";
import {
  combineSelectedLayers,
  measureSelectedLayers,
  selectionCollection,
} from "./selectedLayerActions.ts";
const crs = "+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs";
const ring = (x: number, width: number) =>
  [
    [x, 0],
    [x + width, 0],
    [x + width, 100],
    [x, 100],
    [x, 0],
  ].map(([a, b]) => proj4(crs, "EPSG:4326", [500000 + a!, 3500000 + b!]));
const rect = (x = 0, width = 100): Feature => ({
  type: "Feature",
  id: 1,
  properties: { name: "Original", voltage: 138, __landdraftSource: "keep" },
  geometry: { type: "Polygon", coordinates: [ring(x, width)] },
});
const layer = (id: string, features: Feature[]) => ({
  id,
  name: id,
  data: { type: "FeatureCollection" as const, features },
});
test("combined layers retain all attributes, unique IDs and provenance without mutating sources", () => {
  const input = [layer("a", [rect()]), layer("b", [rect(50)])];
  const before = JSON.stringify(input);
  const result = combineSelectedLayers(input);
  assert.equal(result.features.length, 2);
  assert.notEqual(result.features[0]!.id, result.features[1]!.id);
  assert.equal(result.features[0]!.properties!["voltage"], 138);
  assert.equal(result.features[0]!.properties!["__landdraftSource"], "keep");
  assert.deepEqual(result.features[1]!.properties!["__landdraftSource_"], {
    layerId: "b",
    layerName: "b",
    featureId: 1,
  });
  result.features[0]!.properties!["name"] = "Changed";
  assert.equal(JSON.stringify(input), before);
});
test("acreage unions overlapping polygons instead of summing and ignores line/point features", () => {
  const point: Feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [-99, 32] },
  };
  const result = measureSelectedLayers([layer("a", [rect(), point]), layer("b", [rect(50)])]);
  assert.ok(Math.abs(result.acres - 15000 / 4046.8564224) < 0.00001);
  assert.equal(result.polygonFeatures, 2);
  assert.equal(result.ignoredFeatures, 1);
});
test("holes and multipolygons are retained in measured acreage", () => {
  const feature = rect();
  if (feature.geometry.type !== "Polygon") throw Error();
  const outer = feature.geometry.coordinates[0]!;
  const inner = [
    [20, 20],
    [40, 20],
    [40, 40],
    [20, 40],
    [20, 20],
  ].map(([a, b]) => proj4(crs, "EPSG:4326", [500000 + a!, 3500000 + b!]));
  feature.geometry = { type: "MultiPolygon", coordinates: [[outer, inner]] };
  const result = measureSelectedLayers([layer("holes", [feature])]);
  assert.ok(Math.abs(result.acres - 9600 / 4046.8564224) < 0.00001);
});
test("no area and invalid geometry produce errors rather than zero acres", () => {
  assert.throws(() => measureSelectedLayers([layer("empty", [])]), /no loaded/);
  assert.throws(
    () =>
      measureSelectedLayers([
        layer("points", [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-99, 32] } },
        ]),
      ]),
    /No polygon/,
  );
  const invalid = rect();
  if (invalid.geometry.type !== "Polygon") throw Error();
  const r = invalid.geometry.coordinates[0]!;
  invalid.geometry.coordinates = [[r[0]!, r[2]!, r[1]!, r[3]!, r[0]!]];
  assert.throws(
    () => measureSelectedLayers([layer("invalid", [invalid])]),
    /invalid|self-intersecting/,
  );
});
test("mixed geometry combinations preserve points and lines and reject oversized snapshots", () => {
  const result = combineSelectedLayers([
    layer("points", [
      {
        type: "Feature",
        properties: { a: 0 },
        geometry: { type: "Point", coordinates: [-99, 32] },
      },
    ]),
  ]);
  assert.equal(result.features[0]!.geometry.type, "Point");
  assert.equal(result.features[0]!.properties!["a"], 0);
  assert.throws(
    () => combineSelectedLayers([layer("large", Array(100001).fill(rect()))]),
    /browser-safe/,
  );
});

test("empty configured layers can be copied without inventing measured acreage", () => {
  assert.equal(selectionCollection([layer("empty", [])], true).features.length, 0);
  assert.throws(() => measureSelectedLayers([layer("empty", [])]), /no loaded/);
});
