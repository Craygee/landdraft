import assert from "node:assert/strict";
import test from "node:test";

import { dedupePublicDataLayers } from "./displayLayers.ts";
import { defaultStyle, type GisLayer, type LayerSource } from "./types.ts";

const layer = (id: string, source: LayerSource, visible = true): GisLayer => ({
  id,
  name: id,
  groupId: "public",
  visible,
  createdAt: 0,
  data: { type: "FeatureCollection", features: [] },
  source,
  style: defaultStyle(0),
});

test("parent and subproject copies of one catalog source draw only once", () => {
  const parent = layer("parent", {
    kind: "remote",
    url: "https://example.test/FeatureServer/0",
    catalogId: "national-pipelines",
  });
  const child = layer("subproject:child:copy", {
    kind: "import",
    fileName: "snapshot.geojson",
    catalogId: "national-pipelines",
  });

  assert.deepEqual(
    dedupePublicDataLayers([parent, child]).map((item) => item.id),
    ["parent"],
  );
});

test("a visible subproject copy is retained when the parent copy is hidden", () => {
  const source: LayerSource = {
    kind: "remote",
    url: "https://example.test/FeatureServer/0?token=secret&f=geojson",
  };
  const normalizedCopy: LayerSource = {
    kind: "remote",
    url: "https://example.test/FeatureServer/0/?f=geojson&token=different",
  };

  assert.deepEqual(
    dedupePublicDataLayers([
      layer("hidden-parent", source, false),
      layer("visible-child", normalizedCopy),
    ]).map((item) => item.id),
    ["visible-child"],
  );
});

test("different source filters and private project layers remain independent", () => {
  const publicSource = (where: string): LayerSource => ({
    kind: "remote",
    url: "https://example.test/FeatureServer/0",
    catalogId: "flood-hazards",
    where,
  });
  const localImport = (fileName: string): LayerSource => ({ kind: "import", fileName });
  const layers = [
    layer("floodway", publicSource("ZONE = 'FLOODWAY'")),
    layer("one-percent", publicSource("ZONE = '1 PCT'")),
    layer("parcel-a", localImport("parcels.geojson")),
    layer("parcel-b", localImport("parcels.geojson")),
    layer("drawing-a", { kind: "draw" }),
    layer("drawing-b", { kind: "draw" }),
  ];

  assert.deepEqual(
    dedupePublicDataLayers(layers).map((item) => item.id),
    layers.map((item) => item.id),
  );
});

test("an unfiltered source and its explicit one-equals-one copy are duplicates", () => {
  const url = "https://example.test/FeatureServer/0";
  assert.deepEqual(
    dedupePublicDataLayers([
      layer("parent", { kind: "remote", url }),
      layer("child", { kind: "remote", url: `${url}/`, where: " 1=1 " }),
    ]).map((item) => item.id),
    ["parent"],
  );
});

test("parent and subproject copies of a raster public layer draw only once", () => {
  const first = layer("parent", {
    kind: "raster",
    tiles: ["https://example.test/topo/{z}/{y}/{x}.png"],
    tileSize: 256,
    catalogId: "public-topo",
  });
  const second = layer("child", {
    kind: "raster",
    tiles: ["https://example.test/topo/{z}/{y}/{x}.png"],
    tileSize: 256,
    catalogId: "public-topo",
  });
  assert.deepEqual(
    dedupePublicDataLayers([first, second]).map((item) => item.id),
    ["parent"],
  );
});
