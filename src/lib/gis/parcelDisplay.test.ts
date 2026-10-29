import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParcelLabels,
  parcelLabelSizeAtZoom,
  parcelInterior,
  parcelScreenArea,
  parcelLabelSourceId,
} from "./parcelDisplay.ts";
import { defaultStyle, type GisLayer } from "./types.ts";
import { buildLayerSpecs } from "./mapStyle.ts";
import type { Map } from "maplibre-gl";
const polygon = [
  [
    [-102, 35],
    [-101.99, 35],
    [-101.99, 35.01],
    [-102, 35.01],
    [-102, 35],
  ],
];
const layer: GisLayer = {
  id: "parcel-test",
  name: "Parcels",
  createdAt: 0,
  groupId: "public",
  visible: true,
  source: {
    kind: "remote",
    url: "https://example.test/parcels",
    catalogId: "tx-parcels",
    minZoom: 9,
  },
  style: {
    ...defaultStyle(),
    labelEnabled: true,
    labelTemplate: "{OWNER_NAME}",
    labelSize: 11,
    labelScaleWithZoom: false,
  },
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "stable-id",
        properties: { __label: "LARGE RANCH OWNER" },
        geometry: { type: "Polygon", coordinates: polygon },
      },
    ],
  },
};
test("parcel overview area responds to zoom without changing source geometry or IDs", () => {
  const before = JSON.stringify(layer.data);
  const feature = layer.data.features[0]!;
  assert.ok(Math.abs(parcelScreenArea(feature, 12) / parcelScreenArea(feature, 11) - 4) < 0.001);
  buildParcelLabels(layer, layer.data);
  assert.equal(JSON.stringify(layer.data), before);
  assert.equal(feature.id, "stable-id");
});
test("parcel label anchor and fit threshold use a safe interior circle and include holes", () => {
  const interior = parcelInterior(polygon)!;
  assert.ok(interior.coordinates[0] > -102 && interior.coordinates[0] < -101.99);
  assert.ok(interior.radius > 0);
  const withHole = parcelInterior([
    ...polygon,
    [
      [-101.997, 35.003],
      [-101.993, 35.003],
      [-101.993, 35.007],
      [-101.997, 35.007],
      [-101.997, 35.003],
    ],
  ])!;
  assert.ok(withHole.radius > 0 && withHole.radius < interior.radius);
  assert.ok(
    !(
      withHole.coordinates[0] > -101.997 &&
      withHole.coordinates[0] < -101.993 &&
      withHole.coordinates[1] > 35.003 &&
      withHole.coordinates[1] < 35.007
    ),
  );
  const labels = buildParcelLabels(layer, layer.data);
  assert.equal(labels.features.length, 1);
  assert.ok(labels.features[0]!.properties!["__parcelLabelMinZoom"] >= 9);
  const longer = structuredClone(layer);
  longer.data.features[0]!.properties!["__label"] =
    "A VERY LONG UNBROKEN_OWNER_NAME_WITH_MANY_CHARACTERS";
  assert.ok(
    buildParcelLabels(longer, longer.data).features[0]!.properties!["__parcelLabelMinZoom"] >
      labels.features[0]!.properties!["__parcelLabelMinZoom"],
  );
});
test("parcel renderer uses an interior point source and respects fit filter without overlap", () => {
  const label = buildLayerSpecs(layer, {} as Map).find((spec) => spec.id === "label-parcel-test");
  assert.ok(label?.type === "symbol");
  assert.equal(label.source, parcelLabelSourceId(layer.id));
  assert.equal(label.layout?.["text-allow-overlap"], false);
  assert.equal(label.layout?.["symbol-placement"], "point");
  assert.match(JSON.stringify(label.filter), /__parcelLabelMinZoom/);
});

test("parcel labels appear at fractional zoom when the padded text fits inside the parcel", () => {
  const label = buildParcelLabels(layer, layer.data).features[0]!;
  const zoom = Number(label.properties!["__parcelLabelMinZoom"]);
  const interior = parcelInterior(polygon)!;
  const lines = String(label.properties!["__label"]).split("\n");
  const width = Math.max(...lines.map((line) => line.length)) * 11 * 0.72;
  const height = lines.length * 11 * (layer.style.labelLineSpacing ?? 1.2);
  const paddedRadius = Math.hypot(width, height) / 2 + (layer.style.labelHaloWidth ?? 2) + 4;
  assert.ok(Math.abs(interior.radius * 512 * 2 ** zoom - paddedRadius) < 0.001);
  assert.notEqual(zoom, Math.ceil(zoom));
  // The old inflated width and whole-zoom rounding unnecessarily hid this label.
  const oldRadius =
    Math.hypot(Math.max(...lines.map((line) => line.length)) * 11 * 1.1, height) / 2 + 6;
  assert.ok(zoom < Math.ceil(Math.log2(oldRadius / (interior.radius * 512))));
});

test("parcel fonts grow from 5px at zoom 11 to their 11px default at zoom 13, then stop", () => {
  assert.equal(parcelLabelSizeAtZoom(11, 10), 5);
  assert.equal(parcelLabelSizeAtZoom(11, 11), 5);
  assert.equal(parcelLabelSizeAtZoom(11, 12), 8);
  assert.equal(parcelLabelSizeAtZoom(11, 13), 11);
  assert.equal(parcelLabelSizeAtZoom(11, 20), 11);
});
test("scaled parcel labels become eligible earlier and still fit at their displayed font size", () => {
  const scaled = structuredClone(layer);
  scaled.style.labelScaleWithZoom = true;
  const label = buildParcelLabels(scaled, scaled.data).features[0]!;
  const zoom = Number(label.properties!["__parcelLabelMinZoom"]);
  const constant = Number(
    buildParcelLabels(layer, layer.data).features[0]!.properties!["__parcelLabelMinZoom"],
  );
  assert.ok(zoom < constant);
  const font = parcelLabelSizeAtZoom(11, zoom);
  const lines = String(label.properties!["__label"]).split("\n");
  const radius =
    Math.hypot(
      Math.max(...lines.map((line) => line.length)) * font * 0.72,
      lines.length * font * (layer.style.labelLineSpacing ?? 1.2),
    ) /
      2 +
    (layer.style.labelHaloWidth ?? 2) +
    4;
  assert.ok(parcelInterior(polygon)!.radius * 512 * 2 ** zoom >= radius - 0.001);
  const spec = buildLayerSpecs(scaled, {} as Map).find((spec) => spec.id === "label-parcel-test");
  assert.ok(spec?.type === "symbol");
  assert.deepEqual(spec.layout?.["text-size"], [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    5,
    11,
    5,
    13,
    11,
    24,
    11,
  ]);
});
