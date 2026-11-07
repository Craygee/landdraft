import test from "node:test";
import assert from "node:assert/strict";
import type { Feature, FeatureCollection, MultiLineString } from "geojson";
import type { Map, SymbolLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import {
  buildLineChains,
  cutLine,
  lineGapSourceId,
  lineLabelSourceId,
  placeInlineLabels,
  toWorld,
} from "./lineLabels.ts";
import { buildLayerSpecs } from "./mapStyle.ts";
import { defaultStyle, type GisLayer } from "./types.ts";

const line = (coords: number[][], label: string, extra: Record<string, unknown> = {}): Feature => ({
  type: "Feature",
  properties: { __label: label, ...extra },
  geometry: { type: "LineString", coordinates: coords },
});

// Three short east-west segments of one pipeline, out of order and one reversed.
const pipeline: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    line(
      [
        [-99.98, 31],
        [-99.96, 31],
      ],
      "Permian Express",
    ),
    line(
      [
        [-100, 31],
        [-99.98, 31],
      ],
      "Permian Express",
    ),
    line(
      [
        [-99.94, 31],
        [-99.96, 31],
      ],
      "Permian Express",
    ),
    line(
      [
        [-99.94, 31.2],
        [-99.9, 31.2],
      ],
      "Other line",
    ),
  ],
};

const view = (zoom: number, bearing = 0) => {
  const nw = toWorld([-100.2, 31.4]);
  const se = toWorld([-99.7, 30.8]);
  return {
    zoom,
    bearing,
    bounds: [nw[0], nw[1], se[0], se[1]] as [number, number, number, number],
  };
};

test("touching segments with the same label join into one chain", () => {
  const chains = buildLineChains(pipeline);
  assert.equal(chains.length, 2);
  const main = chains.find((c) => c.label === "Permian Express")!;
  assert.equal(main.pieces.length, 3);
  assert.equal(main.world.length, 4);
  // Chain length equals the three pieces end to end.
  const total = main.dist[main.dist.length - 1]!;
  assert.ok(Math.abs(main.pieces[2]!.end - total) < 1e-12);
});

test("hidden features are not labelled", () => {
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      line(
        [
          [0, 0],
          [1, 0],
        ],
        "A",
        { __hidden: true },
      ),
    ],
  };
  assert.equal(buildLineChains(fc).length, 0);
});

test("inline labels sit on the line, rotate with it and cut a gap of the label's width", () => {
  const chains = buildLineChains(pipeline);
  const result = placeInlineLabels(pipeline, chains, view(13), {
    size: 12,
    minZoom: 4,
    maxZoom: 24,
    measure: (text, size) => text.length * size * 0.6,
  });
  const labels = result.labels.features.filter(
    (f) => f.properties?.["__label"] === "Permian Express",
  );
  assert.ok(labels.length >= 1);
  const first = labels[0]!;
  assert.equal(Math.round(Number(first.properties?.["__angle"])), 0);
  const [, lat] = (first.geometry as { coordinates: number[] }).coordinates;
  assert.ok(Math.abs(lat! - 31) < 1e-9, "label is centered on the line");

  // Total drawn length shrinks by roughly one label gap per label.
  const drawnPx = (fc: FeatureCollection) => {
    let sum = 0;
    for (const f of fc.features) {
      const g = f.geometry;
      const parts =
        g.type === "LineString"
          ? [g.coordinates]
          : g.type === "MultiLineString"
            ? g.coordinates
            : [];
      for (const p of parts)
        for (let i = 1; i < p.length; i++) {
          const a = toWorld(p[i - 1]!),
            b = toWorld(p[i]!);
          sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
    }
    return sum * 512 * 2 ** 13;
  };
  const removed = drawnPx(pipeline) - drawnPx(result.lines);
  const expected = result.labels.features.reduce(
    (sum, f) =>
      sum + String(f.properties?.["__label"]).length * 12 * 0.6 + 2 * Math.max(3, 12 * 0.4),
    0,
  );
  assert.ok(Math.abs(removed - expected) < 1, `removed ${removed}px, expected ${expected}px`);
  // Every feature keeps its index so clicks still select the original feature.
  result.lines.features.forEach((f, i) => assert.equal(f.properties?.["__idx"], i));
});

test("labels and gaps disappear outside the label zoom range", () => {
  const chains = buildLineChains(pipeline);
  const result = placeInlineLabels(pipeline, chains, view(8), {
    size: 12,
    minZoom: 10,
    maxZoom: 24,
  });
  assert.equal(result.labels.features.length, 0);
  assert.ok(result.lines.features.every((f) => f.geometry.type === "LineString"));
});

test("a line too short for its label is drawn whole and left unlabelled", () => {
  const short: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      line(
        [
          [-100, 31],
          [-99.9999, 31],
        ],
        "A very long pipeline operator name",
      ),
    ],
  };
  const result = placeInlineLabels(short, buildLineChains(short), view(12), {
    size: 12,
    minZoom: 4,
    maxZoom: 24,
  });
  assert.equal(result.labels.features.length, 0);
  assert.equal(result.lines.features[0]!.geometry.type, "LineString");
});

test("labels stay upright when the map is rotated", () => {
  const chains = buildLineChains(pipeline);
  const result = placeInlineLabels(pipeline, chains, view(13, 180), {
    size: 12,
    minZoom: 4,
    maxZoom: 24,
  });
  for (const f of result.labels.features)
    assert.equal(Math.round(Number(f.properties?.["__angle"])) % 360, 180);
});

test("cutLine removes the requested stretch and keeps both ends", () => {
  const coords = [
    [0, 0],
    [1, 0],
  ];
  const a = toWorld([0, 0]),
    b = toWorld([1, 0]);
  const total = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pieces = cutLine(coords, [[total * 0.4, total * 0.6]]);
  assert.equal(pieces.length, 2);
  assert.ok(Math.abs(pieces[0]![1]![0]! - 0.4) < 1e-9);
  assert.ok(Math.abs(pieces[1]![0]![0]! - 0.6) < 1e-9);
});

const layer = (placement: GisLayer["style"]["labelPlacement"]): GisLayer => ({
  id: "pipes",
  name: "Pipelines",
  groupId: "public",
  visible: true,
  createdAt: 0,
  data: pipeline,
  source: { kind: "remote", url: "https://example.com/MapServer/0" },
  style: {
    ...defaultStyle(),
    labelEnabled: true,
    labelTemplate: "{NAME}",
    labelPlacement: placement,
  },
});

test("inline placement draws the line from the cut copy and labels from rotated points", () => {
  const specs = buildLayerSpecs(layer("inline"), {} as Map);
  const lineSpec = specs.find((s) => s.id === "line-pipes") as LineLayerSpecification;
  assert.equal(lineSpec.source, lineGapSourceId("pipes"));
  // Clicks still hit the original data.
  assert.equal(
    (specs.find((s) => s.id === "line-hit-pipes") as LineLayerSpecification).source,
    "src-pipes",
  );
  const label = specs.find((s) => s.id === "label-pipes") as SymbolLayerSpecification;
  assert.equal(label.source, lineLabelSourceId("pipes"));
  assert.equal(label.layout?.["symbol-placement"], "point");
  assert.deepEqual(label.layout?.["text-rotate"], ["get", "__angle"]);
  assert.equal(label.layout?.["text-allow-overlap"], true);
});

test("follow-line labels use joined chains instead of raw segments", () => {
  const specs = buildLayerSpecs(layer("follow-line"), {} as Map);
  const label = specs.find((s) => s.id === "label-pipes") as SymbolLayerSpecification;
  assert.equal(label.source, lineLabelSourceId("pipes"));
  assert.equal(label.layout?.["symbol-placement"], "line");
  const lineSpec = specs.find((s) => s.id === "line-pipes") as LineLayerSpecification;
  assert.equal(lineSpec.source, "src-pipes");
});

// Keep the type import used under strip-types.
export type _Unused = MultiLineString;
