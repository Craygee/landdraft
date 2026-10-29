import test from "node:test";
import assert from "node:assert/strict";
import jsts from "jsts";
import { maskPolygons } from "./buildableTerrain.ts";
test("pixel polygons preserve area across varied holes and narrow connections", () => {
  let seed = 17;
  for (let n = 0; n < 100; n++) {
    const w = 12,
      h = 12,
      mask = Uint8Array.from({ length: w * h }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        return (seed >>> 0) % 100 < 65 ? 1 : 0;
      });
    const geometry = new jsts.io.GeoJSONReader().read({
      type: "MultiPolygon",
      coordinates: maskPolygons(mask, w, h),
    });
    assert.equal(geometry.isValid(), true, `invalid case ${n}`);
    assert.equal(
      geometry.getArea(),
      mask.reduce((a, b) => a + b, 0),
    );
  }
});
