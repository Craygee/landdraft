import test from "node:test";
import assert from "node:assert/strict";
import type { Geometry } from "geojson";

import { legendDashArray, legendSymbolForLayer } from "./legendSymbol.ts";
import { defaultStyle, type GisLayer } from "./types.ts";

const layer = (geometry: Geometry, patch: Partial<GisLayer> = {}): GisLayer => ({
  id: "layer-1",
  name: "Layer",
  groupId: "group-1",
  visible: true,
  data: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry }] },
  style: defaultStyle(),
  source: { kind: "draw" },
  createdAt: 1,
  ...patch,
});

test("legend preserves polygon hatch patterns", () => {
  const polygon = layer(
    {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    { style: { ...defaultStyle(), fillPattern: "diagonal", strokePattern: "dashed" } },
  );

  const symbol = legendSymbolForLayer(polygon);
  assert.equal(symbol.kind, "polygon");
  assert.equal(symbol.fillPattern, "diagonal");
  assert.deepEqual(legendDashArray(symbol.strokePattern), [7, 4]);
});

test("legend uses configured and feature marker symbols", () => {
  const configured = layer(
    { type: "Point", coordinates: [-97, 31] },
    { style: { ...defaultStyle(), pointIcon: "★" } },
  );
  assert.equal(legendSymbolForLayer(configured).markerIcon, "★");

  const featureMarker = layer({ type: "Point", coordinates: [-97, 31] });
  featureMarker.data.features[0]!.properties = { MARKER_ICON: "📍" };
  assert.equal(legendSymbolForLayer(featureMarker).markerIcon, "📍");
});

test("pipeline lines receive a distinct pipe symbol", () => {
  const pipeline = layer(
    {
      type: "LineString",
      coordinates: [
        [-97, 31],
        [-96, 32],
      ],
    },
    {
      name: "Texas gathering pipelines",
      source: { kind: "remote", url: "https://example.test", catalogId: "tx-rrc-pipelines" },
    },
  );
  const genericLine = layer({
    type: "LineString",
    coordinates: [
      [-97, 31],
      [-96, 32],
    ],
  });

  assert.equal(legendSymbolForLayer(pipeline).kind, "pipeline");
  assert.equal(legendSymbolForLayer(genericLine).kind, "line");
});
