import test from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { calculateBuildable } from "./buildableArea.ts";
import { ACRES_PER_M2 } from "./buildableAreaModel.ts";
import type { BuildableInput, BuildableRule } from "./buildableAreaModel.ts";
import { optimizeBuildable, terrainDefaults, holdUnresolvedChecks } from "./buildableAutomation.ts";
import { catalog } from "./catalog.ts";
import {
  maskPolygons,
  planTerrainGrid,
  terrainRules,
  terrainFailure,
  requestTerrainGrid,
} from "./buildableTerrain.ts";
import { decodeElevationBip, validateGridRequest } from "./buildableTerrainModel.ts";
import type { TerrainGrid } from "./buildableTerrainModel.ts";
import { handleBuildableTerrainRequest } from "./buildableTerrain.server.ts";
const ll = (x: number, y: number) =>
  proj4("+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs", "EPSG:4326", [
    500000 + x,
    3500000 + y,
  ]);
const input = (): BuildableInput => ({
  id: "test",
  name: "Slope study",
  profile: "general",
  boundary: {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
          [0, 0],
        ].map((p) => ll(p[0]!, p[1]!)),
      ],
    },
  },
  sourceReference: { name: "test" },
  clipToProperty: false,
  propertySetbackM: 0,
  studyMarginM: 0,
  conditionalExcluded: true,
  minimumComponentAcres: 0,
  requested: ["terrain"],
  rules: [],
  automation: { version: "test", holdUnresolved: true, terrain: terrainDefaults("general") },
});
function grid(i: BuildableInput, f: (x: number, y: number) => number | null): TerrainGrid {
  const plan = planTerrainGrid(i, i.automation!.terrain),
    dx = (plan.bbox[2] - plan.bbox[0]) / plan.width,
    dy = (plan.bbox[3] - plan.bbox[1]) / plan.height;
  return {
    ...plan,
    values: Array.from({ length: plan.width * plan.height }, (_, n) =>
      f(
        plan.bbox[0] + ((n % plan.width) + 0.5) * dx,
        plan.bbox[3] - (Math.floor(n / plan.width) + 0.5) * dy,
      ),
    ),
    source: "USGS test",
    sourceUrl: "https://elevation.nationalmap.gov",
    retrievedAt: new Date(0).toISOString(),
    productDate: null,
    sourceResolutionM: null,
    verticalDatum: "test DEM",
  };
}
const run = (i: BuildableInput, g: TerrainGrid) =>
  calculateBuildable({ ...i, rules: terrainRules(i, g) });
const near = (a: number, b: number, t = 0.1) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const sqm = (v: number) => v / ACRES_PER_M2;
test("flat numeric DEM retains study while 20% grade is excluded", () => {
  const i = input();
  const flat = run(
    i,
    grid(i, () => 200),
  );
  near(sqm(flat.candidateAcres), 10000);
  assert.equal(flat.excludedAcres, 0);
  const slope = run(
    i,
    grid(i, (x) => 200 + 0.2 * (x - 500000)),
  );
  near(sqm(slope.excludedAcres), 10000);
  assert.equal(slope.candidateAcres, 0);
});
test("diagonal grade uses rise/run; 10% is conditional and policy toggles deduction", () => {
  const i = input();
  i.automation!.terrain.reliefM = 100;
  const g = grid(i, (x, y) => 0.06 * (x + y));
  const rules = terrainRules(i, g);
  near(rules[0]!.terrainSummary!.maxSlopePercent!, Math.hypot(0.06, 0.06) * 100, 1e-6);
  const r = calculateBuildable({ ...i, rules });
  near(sqm(r.conditionalAcres), 10000);
  assert.equal(r.candidateAcres, 0);
  near(sqm(calculateBuildable({ ...i, rules, conditionalExcluded: false }).candidateAcres), 10000);
});
test("local relief flags gently rolling terrain even below slope threshold", () => {
  const i = input();
  i.automation!.terrain.reliefM = 1;
  i.automation!.terrain.conditionalSlopePercent = 20;
  i.automation!.terrain.exclusionSlopePercent = 30;
  const r = run(
    i,
    grid(i, (x) => 0.04 * x),
  );
  near(sqm(r.conditionalAcres), 10000);
  assert.equal(r.excludedAcres, 0);
});
test("abrupt drop is excluded and holes/source geometry remain unchanged", () => {
  const i = input();
  const before = JSON.stringify(i.boundary);
  const r = run(
    i,
    grid(i, (x) => (x < 500050 ? 200 : 210)),
  );
  assert.ok(r.excludedAcres > 0);
  assert.ok(r.candidateAcres > 0);
  assert.equal(JSON.stringify(i.boundary), before);
  near(sqm(r.excludedAcres + r.conditionalAcres + r.outsideConditionalAcres), 10000);
});
test("missing cells are held conditional; missing is never a real zero elevation", () => {
  const i = input();
  const r = run(
    i,
    grid(i, (x) => (x < 500050 ? 0 : null)),
  );
  assert.ok(r.conditionalAcres > 0);
  assert.ok(r.candidateAcres < r.studyAcres);
  assert.ok(r.unknownCoverage.length > 0);
  const zero = run(
    i,
    grid(i, () => 0),
  );
  near(sqm(zero.candidateAcres), 10000);
});
test("terrain settings reject invalid ordering and oversized grids don't silently flatten", () => {
  const i = input();
  i.automation!.terrain.exclusionSlopePercent = 5;
  assert.throws(() => planTerrainGrid(i, i.automation!.terrain), /thresholds/);
  assert.equal(
    validateGridRequest({ bbox: [0, 0, 100, 100], width: 10, height: 10, epsg: 4326 }),
    false,
  );
});
test("mask polygonisation preserves holes, islands and diagonal separation", () => {
  const donut = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
  const p = maskPolygons(donut, 3, 3);
  assert.equal(p.length, 1);
  assert.equal(p[0]!.length, 2);
  assert.equal(maskPolygons(new Uint8Array([1, 0, 0, 1]), 2, 2).length, 2);
});
test("automatic presets are idempotent, preserve overrides, and don't invent legal buffers", () => {
  const i = input();
  i.conditionalExcluded = false;
  const a = optimizeBuildable(i, catalog);
  assert.equal(a.conditionalExcluded, true);
  const wet = a.rules.find((r) => r.sourceId === "fws-wetlands")!;
  assert.equal(wet.classification, "exclusion");
  assert.equal(wet.buffer, 0);
  wet.buffer = 123;
  wet.classification = "reference";
  wet.enabled = false;
  wet.override = true;
  a.conditionalExcluded = false;
  const b = optimizeBuildable(a, catalog);
  assert.equal(b.rules.length, a.rules.length);
  const kept = b.rules.find((r) => r.id === wet.id)!;
  assert.equal(kept.buffer, 123);
  assert.equal(kept.enabled, false);
  assert.equal(b.conditionalExcluded, false);
  assert.ok(
    b.rules
      .filter((r) => r.buffer > 0)
      .every((r) => r.verification === "provisional" && r.basis?.length),
  );
});
test("required source or terrain outage holds land unresolved, and recovery clears the hold", () => {
  const i = input();
  const failed = terrainFailure(i, "outage");
  const held = holdUnresolvedChecks({ ...i, rules: [failed] });
  const r = calculateBuildable(held);
  assert.equal(r.candidateAcres, 0);
  near(sqm(r.conditionalAcres), 10000);
  const recovered = holdUnresolvedChecks({
    ...held,
    rules: terrainRules(
      i,
      grid(i, () => 200),
    ),
  });
  near(sqm(calculateBuildable(recovered).candidateAcres), 10000);
});
test("generated terrain treatments and buffers survive reruns", () => {
  const i = input(),
    g = grid(i, (x) => x * 0.2);
  i.rules = terrainRules(i, g);
  i.rules[0]!.classification = "reference";
  i.rules[0]!.buffer = 4;
  i.rules[0]!.override = true;
  const next = terrainRules(i, g);
  assert.equal(next[0]!.classification, "reference");
  assert.equal(next[0]!.buffer, 4);
  assert.equal(next[0]!.id, i.rules[0]!.id);
});
test("BIP decoder respects the validity mask, NULL and zero", () => {
  const bytes = new Uint8Array(36 + 2),
    v = new DataView(bytes.buffer);
  for (let i = 0; i < 9; i++) v.setFloat32(i * 4, i === 0 ? 0 : 100 + i, true);
  bytes[36] = 0b10111111;
  bytes[37] = 0b10000000;
  const decoded = decodeElevationBip(bytes.buffer, 3, 3);
  assert.equal(decoded[0], 0);
  assert.equal(decoded[1], null);
  assert.equal(decoded[2], 102);
  assert.equal(decoded[8], 108);
  assert.throws(() => decodeElevationBip(new ArrayBuffer(9), 3, 3), /size/);
});
test("terrain API rejects invalid requests without fetching and preserves upstream failures", async () => {
  const prior = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("unavailable", { status: 503 });
  };
  try {
    const bad = await handleBuildableTerrainRequest(
      new Request("https://landdraft.net/api/analysis/buildable-terrain", {
        method: "POST",
        body: JSON.stringify({ url: "https://bad.example" }),
      }),
    );
    assert.equal(bad?.status, 400);
    assert.equal(calls, 0);
    const i = input(),
      plan = planTerrainGrid(i, i.automation!.terrain);
    const failed = await handleBuildableTerrainRequest(
      new Request("https://landdraft.net/api/analysis/buildable-terrain", {
        method: "POST",
        body: JSON.stringify(plan),
      }),
    );
    assert.equal(failed?.status, 503);
  } finally {
    globalThis.fetch = prior;
  }
});
test("client rejects misaligned terrain responses and aborted requests", async () => {
  const prior = globalThis.fetch,
    i = input(),
    g = grid(i, () => 100);
  globalThis.fetch = async () => Response.json({ ...g, bbox: [1, 2, 3, 4] });
  try {
    await assert.rejects(() => requestTerrainGrid(i, new AbortController().signal), /misaligned/);
  } finally {
    globalThis.fetch = prior;
  }
});

test("terrain clips to holes and property boundaries with reconciled acreage", () => {
  const i = input();
  i.boundary.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
        [0, 0],
      ].map((p) => ll(p[0]!, p[1]!)),
      [
        [20, 20],
        [20, 40],
        [40, 40],
        [40, 20],
        [20, 20],
      ].map((p) => ll(p[0]!, p[1]!)),
    ],
  };
  i.property = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [50, 0],
          [50, 100],
          [0, 100],
          [0, 0],
        ].map((p) => ll(p[0]!, p[1]!)),
      ],
    },
  };
  i.clipToProperty = true;
  const r = run(
    i,
    grid(i, () => 100),
  );
  near(sqm(r.studyAcres), 4600);
  near(sqm(r.candidateAcres), 4600);
});
test("large grids disclose automatic coarsening instead of exceeding budgets", () => {
  const i = input();
  i.boundary.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [5000, 0],
        [5000, 5000],
        [0, 5000],
        [0, 0],
      ].map((p) => ll(p[0]!, p[1]!)),
    ],
  };
  const plan = planTerrainGrid(i, i.automation!.terrain);
  assert.ok(plan.width <= 256 && plan.height <= 256);
  assert.ok((plan.bbox[2] - plan.bbox[0]) / plan.width > 10);
});
test("failed required constraint geometry is held conditional after processing failure", () => {
  const i = input();
  const r: BuildableRule = {
    ...terrainFailure(i, "bad"),
    coverage: "available",
    classification: "exclusion",
    features: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [100, 100],
                [0, 100],
                [100, 0],
                [0, 0],
              ].map((p) => ll(p[0]!, p[1]!)),
            ],
          },
        },
      ],
    },
  };
  const result = calculateBuildable({ ...i, rules: [r] });
  assert.equal(result.candidateAcres, 0);
  assert.equal(result.breakdown[0]?.coverage, "failed");
  assert.ok(result.warnings.some((w) => w.includes("held conditional")));
});

test("Optimize recognizes existing project service rules and adds required-check metadata without resetting edits", () => {
  const i = input();
  const entry = catalog.find((e) => e.id === "fws-wetlands")!;
  i.rules = [
    {
      ...terrainFailure(i, "manual"),
      generated: undefined,
      sourceId: "project-layer",
      sourceUrl: entry.url,
      sourceFilter: entry.where,
      classification: "reference",
      buffer: 10,
      coverage: "failed",
      requiredCheck: undefined,
    } as unknown as BuildableRule,
  ];
  const optimized = optimizeBuildable(i, catalog);
  const matching = optimized.rules.filter((r) => r.sourceUrl === entry.url);
  assert.equal(matching.length, 1);
  assert.equal(matching[0]!.classification, "reference");
  assert.equal(matching[0]!.buffer, 10);
  assert.equal(matching[0]!.requiredCheck, true);
});
