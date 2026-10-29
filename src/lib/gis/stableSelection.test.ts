import test from "node:test";
import assert from "node:assert/strict";
import type { Feature, FeatureCollection } from "geojson";
import { preserveSelectedFeatures } from "./stableSelection.ts";

const feature = (id: number): Feature => ({
  type: "Feature",
  id,
  properties: { parcel: id },
  geometry: { type: "Point", coordinates: [id, 0] },
});
const collection = (...ids: number[]): FeatureCollection => ({
  type: "FeatureCollection",
  features: ids.map(feature),
});

test("selection follows source ID when viewport rows reorder", () => {
  const result = preserveSelectedFeatures(collection(1, 2, 3), collection(3, 1, 2), [0, 2]);
  assert.deepEqual(result.indexes, [1, 0]);
  assert.deepEqual(
    result.indexes.map((index) => result.data.features[index]?.id),
    [1, 3],
  );
});
test("offscreen selected parcels remain selected without retaining unrelated old rows", () => {
  const result = preserveSelectedFeatures(collection(1, 2, 3), collection(4, 5), [1]);
  assert.deepEqual(
    result.data.features.map((item) => item.id),
    [4, 5, 2],
  );
  assert.deepEqual(result.indexes, [2]);
});
test("partial pages and zoom clears preserve selection without duplicating parcels", () => {
  const cleared = preserveSelectedFeatures(collection(1, 2), collection(), [0]);
  const loaded = preserveSelectedFeatures(cleared.data, collection(2, 1), cleared.indexes);
  assert.equal(loaded.data.features.length, 2);
  assert.equal(loaded.data.features[loaded.indexes[0]!]?.id, 1);
});
