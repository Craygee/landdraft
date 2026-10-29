import test from "node:test";
import assert from "node:assert/strict";
import { legendValuesInView, legendZoomBounds } from "./legendInView.ts";
import { defaultStyle, type GisLayer } from "./types.ts";

const layer: GisLayer = {
  id: "pipes",
  name: "Pipelines",
  groupId: "public",
  visible: true,
  createdAt: 0,
  source: { kind: "draw" },
  data: { type: "FeatureCollection", features: [] },
  style: {
    ...defaultStyle(),
    categorized: {
      enabled: true,
      field: "type",
      fallbackVisible: false,
      fallbackColor: "#000000",
      rules: [
        { value: "gas", label: "Gas", color: "#ff0000", visible: true },
        { value: "oil", label: "Oil", color: "#00ff00", visible: false },
        { value: "water", label: "Water", color: "#0000ff", visible: true },
      ],
    },
  },
};
test("legend omits layers with no viewport items and hidden layers", () => {
  assert.equal(legendValuesInView(layer, []), null);
  assert.equal(
    legendValuesInView({ ...layer, visible: false }, [{ properties: { type: "gas" } }]),
    null,
  );
});
test("legend includes only present, visible categories and deduplicates map tiles", () => {
  assert.deepEqual(
    legendValuesInView(layer, [
      { properties: { type: "gas" } },
      { properties: { type: "gas" } },
      { properties: { type: "oil" } },
      { properties: { type: "unknown" } },
      { properties: { type: "water", __hidden: true } },
    ]),
    { type: ["gas"] },
  );
  assert.equal(legendValuesInView(layer, [{ properties: { type: "oil" } }]), null);
});

test("legend category zoom includes matching items and excludes hidden features", () => {
  const input: GisLayer = {
    ...layer,
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { type: "gas" },
          geometry: { type: "Point", coordinates: [-100, 30] },
        },
        {
          type: "Feature",
          properties: { type: "gas" },
          geometry: { type: "Point", coordinates: [-99, 31] },
        },
        {
          type: "Feature",
          properties: { type: "gas", __hidden: true },
          geometry: { type: "Point", coordinates: [-80, 40] },
        },
        {
          type: "Feature",
          properties: { type: "water" },
          geometry: { type: "Point", coordinates: [-90, 35] },
        },
      ],
    },
  };
  assert.deepEqual(legendZoomBounds(input, "gas"), [-100, 30, -99, 31]);
  assert.deepEqual(legendZoomBounds(input), [-100, 30, -90, 35]);
  assert.equal(legendZoomBounds(input, "absent"), null);
});
