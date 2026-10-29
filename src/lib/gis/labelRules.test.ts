import test from "node:test";
import assert from "node:assert/strict";
import { buildLayerSpecs, primaryLabelGeometry, allLayerIds } from "./mapStyle.ts";
import { defaultStyle, type GisLayer } from "./types.ts";
import type { Map, SymbolLayerSpecification } from "maplibre-gl";

const layer = (): GisLayer => ({
  id: "rules",
  name: "Pipelines",
  groupId: "public",
  visible: true,
  createdAt: 0,
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { NAME: "Line" },
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
  source: { kind: "remote", url: "https://example.com/MapServer/0", minZoom: 8 },
  style: {
    ...defaultStyle(),
    labelEnabled: true,
    labelTemplate: "{NAME}",
    labelMinZoom: 14,
    labelMaxZoom: 18,
    labelPlacement: "horizontal",
    labelScaleWithZoom: false,
    labelSize: 20,
    labelAllowOverlap: false,
  },
});

test("remote source zoom cannot override advanced label start zoom", () => {
  const label = buildLayerSpecs(layer(), {} as Map).find((spec) => spec.id === "label-rules");
  assert.equal(label?.minzoom, 14);
  assert.equal(label?.maxzoom, 18);
});
test("advanced label placement, size and overlap settings reach the renderer", () => {
  const label = buildLayerSpecs(layer(), {} as Map).find((spec) => spec.id === "label-rules");
  assert.ok(label?.type === "symbol");
  assert.equal(label.layout?.["symbol-placement"], "line-center");
  assert.equal(label.layout?.["text-size"], 20);
  assert.equal(label.layout?.["text-allow-overlap"], false);
});

test("layer name labeling creates labels without an attribute template", () => {
  const input = layer();
  input.data.features.push({
    type: "Feature",
    properties: { DIFFERENT_FIELD: "Another feature" },
    geometry: { type: "Point", coordinates: [2, 2] },
  });
  input.style = { ...input.style, labelUseLayerName: true, labelTemplate: "" };
  const label = buildLayerSpecs(input, {} as Map).find((spec) => spec.id === "label-rules");
  assert.ok(label?.type === "symbol");
  assert.deepEqual(label.layout?.["text-field"], ["literal", "Pipelines"]);
});

test("auto line labels follow lines after initially empty remote data loads", () => {
  const input = layer();
  input.style.labelPlacement = "auto";
  const populated = primaryLabelGeometry(input);
  const original = input.data.features;
  input.data.features = [];
  assert.notEqual(primaryLabelGeometry(input), populated);
  input.data.features = original;
  const label = buildLayerSpecs(input, {} as Map).find((spec) => spec.id === "label-rules");
  assert.ok(label?.type === "symbol");
  assert.equal(label.layout?.["symbol-placement"], "line");
  assert.equal(label.layout?.["text-rotation-alignment"], "map");
});

test("mixed layer auto labels keep lines following geometry and points horizontal", () => {
  const input = layer();
  input.style.labelPlacement = "auto";
  input.style.labelUseLayerName = true;
  input.data.features.push({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [2, 2] },
  });
  const labels = buildLayerSpecs(input, {} as Map).filter(
    (spec): spec is SymbolLayerSpecification =>
      spec.type === "symbol" && spec.id.startsWith("label-"),
  );
  assert.equal(labels.length, 2);
  assert.ok(labels.some((spec) => spec.layout?.["symbol-placement"] === "line"));
  assert.ok(labels.some((spec) => spec.layout?.["symbol-placement"] === "point"));
  for (const label of labels) {
    assert.deepEqual(label.layout?.["text-field"], ["literal", input.name]);
    assert.equal(label.layout?.["text-allow-overlap"], false);
    assert.ok(allLayerIds(input.id).includes(label.id));
  }
});
