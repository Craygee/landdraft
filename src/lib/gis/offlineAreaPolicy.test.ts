import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFLINE_AREA_FEATURE,
  validateOfflineBounds,
  validateOfflineComplexity,
} from "./offlineAreaPolicy.ts";
test("offline requests reject invalid and oversized extents before downloads", () => {
  assert.ok(validateOfflineBounds([-102, 35, -101.95, 35.05]) > 0);
  for (const bounds of [
    [-106, 25, -93, 37],
    [0, 0, 0, 1],
    [0, 0, NaN, 1],
    [179, 10, -179, 11],
  ])
    assert.throws(() => validateOfflineBounds(bounds));
  assert.equal(OFFLINE_AREA_FEATURE.phase, "preview");
});
test("offline geometry budget rejects expensive packs before label preparation and storage", () => {
  assert.equal(
    validateOfflineComplexity([
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        ],
      },
    ]),
    2,
  );
  assert.throws(
    () =>
      validateOfflineComplexity([
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: Array.from({ length: OFFLINE_AREA_FEATURE.maxCoordinates + 1 }, () => [
                  0, 0,
                ]),
              },
            },
          ],
        },
      ]),
    /smaller extent/,
  );
});
