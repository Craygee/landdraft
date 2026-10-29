import test from "node:test";
import assert from "node:assert/strict";
import {
  boundaryLayerOptions,
  boundaryFeatureOptions,
  loadBoundaryPolygons,
} from "./buildableBoundaryOptions.ts";
import {
  boundaryPolygonFeatures,
  boundarySnapshotChanged,
  polygonLayerKey,
} from "./buildableAreaModel.ts";
import type { GisLayer } from "./types.ts";
import { defaultStyle } from "./types.ts";
import type { BuildableInput } from "./buildableAreaModel.ts";
const polygon = (id = 0) => ({
  type: "Feature" as const,
  id,
  properties: { NAME: `Parcel ${id}` },
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-101, 35],
        [-100.999, 35],
        [-100.999, 35.001],
        [-101, 35.001],
        [-101, 35],
      ],
    ],
  },
});
const layer = (id: string, count = 1): GisLayer => ({
  id,
  name: id,
  createdAt: 1,
  groupId: "g",
  visible: true,
  style: defaultStyle(),
  source: { kind: "draw" },
  data: {
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, i) => polygon(i)),
  },
});
test("new layers appear despite a large earlier layer and selections beyond preview limits", () => {
  const big = layer("earlier", 1000),
    added = { ...layer("new"), createdAt: 2 };
  const choices = boundaryFeatureOptions([big, added], []);
  assert.ok(choices.some((c) => c.layer.id === "new"));
  assert.equal(choices[0]!.layer.id, "new");
  assert.equal(boundaryLayerOptions([big, added]).length, 2);
  assert.ok(
    boundaryFeatureOptions([big, added], [{ layerId: "earlier", index: 999 }]).some(
      (c) => c.index === 999,
    ),
  );
});
test("empty remote connections and newly loaded polygons retain the same layer option", () => {
  const remote = {
    ...layer("remote", 0),
    source: {
      kind: "remote" as const,
      url: "https://example.test/FeatureServer/0",
      loadStatus: "zoom-in" as const,
    },
  };
  const before = boundaryLayerOptions([remote])[0]!;
  assert.equal(before.canLoad, true);
  assert.equal(before.polygons.length, 0);
  assert.match(before.status, /Zoom in/);
  const after = boundaryLayerOptions([
    { ...remote, data: { type: "FeatureCollection", features: [polygon()] } },
  ])[0]!;
  assert.equal(after.layer.id, before.layer.id);
  assert.equal(after.polygons.length, 1);
});
test("display-layer inventory includes overlay layers; nonpolygons have visible explanations", () => {
  const overlay = layer("subproject"),
    line = layer("pipeline", 0);
  line.data.features = [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [-101, 35],
          [-100, 35],
        ],
      },
    },
  ];
  const entries = boundaryLayerOptions([overlay, line]);
  assert.equal(entries.length, 2);
  assert.ok(boundaryFeatureOptions([overlay, line], []).some((c) => c.layer.id === "subproject"));
  assert.match(entries.find((e) => e.layer.id === "pipeline")!.status, /No polygon geometry/);
});
test("mixed imported geometry preserves actual polygon parts and source geometry", () => {
  const mixed = layer("mixed", 0);
  mixed.data.features = [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "GeometryCollection",
        geometries: [polygon().geometry, { type: "Point", coordinates: [-80, 20] }],
      },
    },
  ];
  const original = JSON.stringify(mixed);
  const choice = boundaryFeatureOptions([mixed], [])[0]!;
  assert.equal(choice.feature.geometry.type, "Polygon");
  assert.equal(JSON.stringify(mixed), original);
  const input = {
    boundary: choice.feature,
    sourceReference: {
      name: "mixed",
      layerId: mixed.id,
      wholeLayer: true,
      geometryKey: polygonLayerKey(boundaryPolygonFeatures(mixed)),
    },
  } as BuildableInput;
  assert.equal(boundarySnapshotChanged(input, [mixed]), false);
});
test("saved analyses offer only candidate polygons as boundaries", () => {
  const analysis = layer("analysis");
  analysis.source = {
    kind: "derived",
    sourceLayerId: "study",
    cacheProvenance: {
      buildableArea: {
        schemaVersion: 1,
        input: { boundary: polygon() },
        result: { version: "1.1.0" },
      },
    },
  };
  analysis.data.features = [
    { ...polygon(1), properties: { kind: "study" } },
    { ...polygon(2), properties: { kind: "excluded" } },
    { ...polygon(3), properties: { kind: "candidate" } },
  ];
  assert.equal(boundaryPolygonFeatures(analysis).length, 1);
  assert.equal(boundaryFeatureOptions([analysis], [])[0]!.feature.id, 3);
});
test("remote chooser loading is bounded, preserves filters, and never changes map data", async () => {
  const remote = {
    ...layer("remote", 0),
    source: {
      kind: "remote" as const,
      url: "https://example.test/FeatureServer/0",
      where: "COUNTY = 'Potter'",
    },
  };
  const prior = globalThis.fetch,
    priorWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout, clearTimeout },
    configurable: true,
    writable: true,
  });
  let count = 1;
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json(
      String(url).includes("returnCountOnly")
        ? { count }
        : { type: "FeatureCollection", features: [polygon()] },
    );
  };
  try {
    const data = await loadBoundaryPolygons(
      remote,
      [-101, 35, -100, 36],
      new AbortController().signal,
    );
    assert.equal(data.features.length, 1);
    assert.equal(remote.data.features.length, 0);
    assert.ok(urls.every((u) => new URL(u).searchParams.get("where") === "COUNTY = 'Potter'"));
    count = 4001;
    await assert.rejects(
      () => loadBoundaryPolygons(remote, [-101, 35, -100, 36], new AbortController().signal),
      /Zoom in/,
    );
    count = 2;
    await assert.rejects(
      () => loadBoundaryPolygons(remote, [-101, 35, -100, 36], new AbortController().signal),
      /incomplete/,
    );
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      () => loadBoundaryPolygons(remote, [-101, 35, -100, 36], aborted.signal),
      /abort/i,
    );
  } finally {
    globalThis.fetch = prior;
    Object.defineProperty(globalThis, "window", {
      value: priorWindow,
      configurable: true,
      writable: true,
    });
  }
});
