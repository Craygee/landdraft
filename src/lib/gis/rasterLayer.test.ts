import test from "node:test";
import assert from "node:assert/strict";
import { buildLayerSpecs, rasterId } from "./mapStyle.ts";
import { defaultStyle, type GisLayer } from "./types.ts";

test("public raster tiles render as a reorderable opacity-controlled map layer", () => {
  const layer: GisLayer = {
    id: "topo",
    name: "USGS Topographic Map",
    groupId: "public",
    visible: true,
    createdAt: 0,
    data: { type: "FeatureCollection", features: [] },
    source: {
      kind: "raster",
      tiles: ["https://example.test/topo/{z}/{y}/{x}.png"],
      tileSize: 256,
      minZoom: 0,
      maxZoom: 16,
      catalogId: "usgs-topographic-map",
    },
    style: { ...defaultStyle(0), opacity: 0.5, fillOpacity: 0.8 },
  };
  const specs = buildLayerSpecs(layer, {} as never);
  assert.equal(specs.length, 1);
  assert.equal(specs[0]?.id, rasterId(layer.id));
  assert.equal(specs[0]?.type, "raster");
  assert.equal(specs[0]?.minzoom, 0);
  assert.equal(specs[0]?.maxzoom, 16);
  assert.equal(
    (specs[0] as { paint?: { "raster-opacity"?: number } }).paint?.["raster-opacity"],
    0.4,
  );
});
