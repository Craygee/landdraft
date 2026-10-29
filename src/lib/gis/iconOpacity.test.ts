import test from "node:test";
import assert from "node:assert/strict";
import { pointSymbolOpacity } from "./iconOpacity.ts";
import { defaultStyle, type GisLayer } from "./types.ts";
import { buildLayerSpecs } from "./mapStyle.ts";
import { legendSymbolForLayer } from "./legendSymbol.ts";
import { normalizeLayerStyle } from "./layerNormalization.ts";
import type { Map } from "maplibre-gl";
const layer = (opacity: number): GisLayer => ({
  id: "opacity",
  name: "Icons",
  groupId: "g",
  visible: true,
  createdAt: 0,
  source: { kind: "draw" },
  data: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
    ],
  },
  style: { ...defaultStyle(), pointIcon: "★", pointIconOpacity: opacity },
});
test("independent icon opacity supports fully hidden, partial and opaque symbols", () => {
  for (const value of [0, 0.35, 1]) {
    const input = layer(value);
    const specs = buildLayerSpecs(input, {} as Map);
    const marker = specs.find((s) => s.id === "marker-opacity");
    assert.ok(marker?.type === "symbol");
    assert.equal(marker.paint?.["text-opacity"], value);
    const circle = specs.find((s) => s.id === "point-opacity");
    assert.ok(circle?.type === "circle");
    assert.equal(circle.paint?.["circle-stroke-opacity"], value);
    assert.equal(legendSymbolForLayer(input).markerOpacity, value);
    assert.equal(input.style.labelOpacity, 1);
  }
});
test("legacy styles remain opaque and malformed opacity is safely clamped", () => {
  assert.equal(pointSymbolOpacity({}), 1);
  assert.equal(pointSymbolOpacity({ pointIconOpacity: NaN }), 1);
  assert.equal(pointSymbolOpacity({ pointIconOpacity: -1 }), 0);
  assert.equal(pointSymbolOpacity({ pointIconOpacity: 2 }), 1);
  assert.equal(normalizeLayerStyle({ pointIconOpacity: 0.2 }).pointIconOpacity, 0.2);
  assert.equal(normalizeLayerStyle({ pointIconOpacity: null }).pointIconOpacity, 1);
});
