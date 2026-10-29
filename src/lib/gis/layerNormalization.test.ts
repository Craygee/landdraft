import test from "node:test";
import assert from "node:assert/strict";

import {
  featureGeometryType,
  normalizeLayerData,
  normalizeLayerStyle,
} from "./layerNormalization.ts";

test("recovers label template from saved label field selections", () => {
  const style = normalizeLayerStyle({
    labelEnabled: true,
    labelFields: ["OWNER_NAME"],
    labelTemplate: "",
  });
  assert.equal(style.labelTemplate, "{OWNER_NAME}");
  assert.equal(style.labelEnabled, true);
});

test("keeps field attributes while neutralizing an interrupted geometry capture", () => {
  const data = normalizeLayerData({
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: null, properties: { NAME: "Gate 4" } },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-101.9, 33.5] },
        properties: { NAME: "Tank battery" },
      },
      null,
    ],
  });

  assert.equal(data.features.length, 2);
  assert.equal(data.features[0]?.properties?.["NAME"], "Gate 4");
  assert.equal(featureGeometryType(data.features[0]), null);
  assert.equal(featureGeometryType(data.features[1]), "Point");
});

test("repairs legacy field-layer label settings before the group is expanded", () => {
  const style = normalizeLayerStyle({
    fillColor: "#f2b73d",
    labelTemplate: null,
    labelFields: "NAME",
    labelSeparator: null,
  });

  assert.equal(style.fillColor, "#f2b73d");
  assert.equal(style.labelTemplate, "");
  assert.deepEqual(style.labelFields, []);
  assert.equal(style.labelSeparator, " · ");
});
