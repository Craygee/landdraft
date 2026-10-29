import test from "node:test";
import assert from "node:assert/strict";
import { applyGroupStyle } from "./groupStyle.ts";
import { defaultStyle, type GisLayer } from "./types.ts";
const groups = [
  { id: "root", name: "Top group", collapsed: false },
  { id: "child", name: "Nested", parentId: "root", collapsed: true },
  {
    id: "container",
    name: "Layer sublayers",
    parentId: "child",
    containerLayerId: "two",
    collapsed: true,
  },
  { id: "other", name: "Unrelated", collapsed: false },
];
const layers: GisLayer[] = ["root", "child", "container", "other"].map(
  (groupId, i) =>
    ({
      createdAt: 0,
      id: ["one", "two", "three", "four"][i]!,
      groupId,
      name: `Layer ${i}`,
      visible: i % 2 === 0,
      data: { type: "FeatureCollection", features: [] },
      source: { kind: "draw" },
      style: {
        ...defaultStyle(i),
        labelFields: [`FIELD_${i}`],
        labelTemplate: `{FIELD_${i}}`,
        labelUseLayerName: i === 1,
        labelSize: 10 + i,
      },
    }) satisfies GisLayer,
);
test("shared label style reaches collapsed nested groups and layer containers, preserving unrelated layers", () => {
  const next = applyGroupStyle(layers, groups, "root", {
    labelFont: "Open Sans Bold",
    labelColor: "#123456",
    labelSize: 18,
  });
  next.slice(0, 3).forEach((layer, i) => {
    assert.equal(layer.style.labelFont, "Open Sans Bold");
    assert.equal(layer.style.labelSize, 18);
    assert.equal(layer.style.labelColor, "#123456");
    assert.deepEqual(layer.style.labelFields, layers[i]!.style.labelFields);
    assert.equal(layer.style.labelTemplate, layers[i]!.style.labelTemplate);
    assert.equal(layer.style.labelUseLayerName, layers[i]!.style.labelUseLayerName);
    assert.equal(layer.data, layers[i]!.data);
    assert.equal(layer.source, layers[i]!.source);
    assert.equal(layer.visible, layers[i]!.visible);
    assert.equal(layer.style.fillColor, layers[i]!.style.fillColor);
  });
  assert.equal(next[3], layers[3]);
  assert.equal(layers[0]!.style.labelSize, 10);
});
test("editing a single label control preserves every other style property and round trips through project JSON", () => {
  const next = applyGroupStyle(layers, groups, "root", { labelOpacity: 0.4 });
  next
    .slice(0, 3)
    .forEach((layer, i) =>
      assert.deepEqual(layer.style, { ...layers[i]!.style, labelOpacity: 0.4 }),
    );
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});
test("bulk start/end zoom changes keep a valid range for children with different existing ranges", () => {
  const input = layers.map((layer) => ({
    ...layer,
    style: { ...layer.style, labelMinZoom: 4, labelMaxZoom: 8 },
  }));
  const start = applyGroupStyle(input, groups, "root", { labelMinZoom: 12 });
  assert.equal(start[0]!.style.labelMinZoom, 12);
  assert.equal(start[0]!.style.labelMaxZoom, 13);
  const end = applyGroupStyle(input, groups, "root", { labelMaxZoom: 2 });
  assert.equal(end[0]!.style.labelMinZoom, 1);
  assert.equal(end[0]!.style.labelMaxZoom, 2);
  assert.equal(end[3], input[3]);
});
test("overlap and label visibility change only when explicitly requested", () => {
  const styled = applyGroupStyle(layers, groups, "root", { labelHaloWidth: 2.4 });
  assert.equal(styled[0]!.style.labelAllowOverlap, false);
  assert.equal(styled[0]!.style.labelEnabled, false);
  const enabled = applyGroupStyle(layers, groups, "root", {
    labelEnabled: true,
    labelAllowOverlap: true,
    labelCollisionMode: "always",
  });
  assert.equal(enabled[2]!.style.labelEnabled, true);
  assert.equal(enabled[2]!.style.labelCollisionMode, "always");
});
