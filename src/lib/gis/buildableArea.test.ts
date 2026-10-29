import test from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { calculateBuildable, feetToMeters, combineStudyPolygons } from "./buildableArea.ts";
import {
  ACRES_PER_M2,
  polygonLayerKey,
  duplicateBuildableSnapshot,
  boundarySnapshotChanged,
  buildableExport,
  constraintCategories,
  inputKey,
  snapshotFromLayer,
} from "./buildableAreaModel.ts";
import type { AreaFeature, BuildableInput, BuildableRule } from "./buildableAreaModel.ts";
import {
  newRule,
  retrievalBounds,
  BuildableRunGate,
  loadBuildableSources,
} from "./buildableAreaSources.ts";
import type { GisLayer } from "./types.ts";

const utm = "+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs";
const ll = (p: number[]) => proj4(utm, "EPSG:4326", [500000 + p[0]!, 3500000 + p[1]!]);
const ring = (x: number, y: number, w: number, h: number) =>
  [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ].map(ll);
const rect = (x = 0, y = 0, w = 100, h = 100): AreaFeature => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [ring(x, y, w, h)] },
});
const rule = (
  shape = rect(0, 0, 50, 100),
  classification: BuildableRule["classification"] = "exclusion",
): BuildableRule => ({
  ...newRule("Constraint", "user", { type: "FeatureCollection", features: [shape] }),
  classification,
  coverage: "available",
});
const input = (rules: BuildableRule[] = []): BuildableInput => ({
  id: "test",
  name: "Study",
  profile: "general",
  boundary: rect(),
  sourceReference: { name: "Drawn" },
  clipToProperty: false,
  propertySetbackM: 0,
  studyMarginM: 0,
  conditionalExcluded: false,
  minimumComponentAcres: 0,
  requested: ["user"],
  rules,
});
const sqm = (acres: number) => acres / ACRES_PER_M2;
const near = (actual: number, expected: number, tolerance = 0.2) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const reconcile = (r: ReturnType<typeof calculateBuildable>) =>
  near(sqm(r.excludedAcres + r.conditionalAcres + r.outsideConditionalAcres), sqm(r.studyAcres));

test("rectangle without constraints preserves gross geometry, missing categories and original input", () => {
  const i = input();
  const before = JSON.stringify(i);
  const r = calculateBuildable(i);
  near(sqm(r.studyAcres), 10000);
  near(sqm(r.candidateAcres), 10000);
  assert.equal(r.excludedAcres, 0);
  assert.equal(r.completeness[0]?.status, "not-evaluated");
  assert.equal(JSON.stringify(i), before);
  reconcile(r);
});
test("single and partly external exclusions are clipped to study", () => {
  near(sqm(calculateBuildable(input([rule()])).excludedAcres), 5000);
  near(sqm(calculateBuildable(input([rule(rect(-50, 0, 100, 100))])).excludedAcres), 5000);
});
test("overlapping exclusions counted only once, independent of rule order", () => {
  const a = rule(rect(0, 0, 60, 100)),
    b = rule(rect(40, 0, 40, 100));
  const r = calculateBuildable(input([a, b]));
  near(sqm(r.excludedAcres), 8000);
  near(sqm(r.breakdown.reduce((s, r) => s + (r.acres ?? 0), 0)), 10000);
  near(r.excludedAcres, calculateBuildable(input([b, a])).excludedAcres, 1e-8);
  reconcile(r);
});
test("outside line buffer reaches study and retrieval bounds include outside features", () => {
  const line = {
    type: "Feature" as const,
    properties: { commodity: "gas" },
    geometry: { type: "LineString" as const, coordinates: [ll([-5, -100]), ll([-5, 200])] },
  };
  const r = {
    ...rule(),
    buffer: 10,
    unit: "meters" as const,
    features: { type: "FeatureCollection" as const, features: [line] },
  };
  near(sqm(calculateBuildable(input([r])).excludedAcres), 500, 0.3);
  const bounds = retrievalBounds(input(), r);
  assert.ok(bounds[0] < ll([-5, 0])[0]!);
});
test("holes and multipolygons preserve true acreage and disconnected components", () => {
  const i = input();
  i.boundary.geometry = {
    type: "Polygon",
    coordinates: [ring(0, 0, 100, 100), ring(25, 25, 50, 50).reverse()],
  };
  near(sqm(calculateBuildable(i).studyAcres), 7500);
  i.boundary.geometry = {
    type: "MultiPolygon",
    coordinates: [[ring(0, 0, 100, 100)], [ring(200, 0, 50, 100)]],
  };
  const r = calculateBuildable(i);
  near(sqm(r.candidateAcres), 15000);
  assert.equal(r.components.length, 2);
  near(sqm(r.largestAcres), 10000);
});
test("conditional policy changes candidates while conditional acreage excludes definite exclusion", () => {
  const i = input([rule(rect(0, 0, 20, 100)), rule(rect(10, 0, 50, 100), "conditional")]);
  const a = calculateBuildable(i);
  near(sqm(a.conditionalAcres), 4000);
  near(sqm(a.candidateAcres), 8000);
  reconcile(a);
  const b = calculateBuildable({ ...i, conditionalExcluded: true });
  near(sqm(b.candidateAcres), 4000);
  near(b.outsideConditionalAcres, b.candidateAcres, 1e-8);
  reconcile(b);
});
test("full exclusion is a valid zero candidate result", () => {
  const r = calculateBuildable(input([rule(rect(-10, -10, 120, 120))]));
  assert.equal(r.candidateAcres, 0);
  assert.equal(r.components.length, 0);
  assert.equal(r.candidate, null);
  reconcile(r);
});
test("property clipping uses actual polygon, does not modify source, and rejects empty overlap", () => {
  const i = { ...input(), clipToProperty: true, property: rect(50, 0, 100, 100) };
  const r = calculateBuildable(i);
  near(sqm(r.drawnAcres), 10000);
  near(sqm(r.studyAcres), 5000);
  assert.throws(
    () => calculateBuildable({ ...i, property: rect(200, 0, 50, 50) }),
    /no usable area/,
  );
  assert.throws(
    () => calculateBuildable({ ...input(), clipToProperty: true }),
    /select a property/,
  );
});
test("property setback follows property shell and holes, not arbitrary study edges", () => {
  const i = {
    ...input(),
    property: rect(-50, -50, 200, 200),
    clipToProperty: true,
    propertySetbackM: 10,
  };
  near(calculateBuildable(i).excludedAcres, 0, 1e-8);
  near(sqm(calculateBuildable({ ...i, studyMarginM: 10 }).excludedAcres), 3600);
  const property = rect();
  property.geometry = {
    type: "Polygon",
    coordinates: [ring(0, 0, 100, 100), ring(40, 40, 20, 20).reverse()],
  };
  assert.ok(sqm(calculateBuildable({ ...i, property }).excludedAcres) > 3600);
});
test("inward buffers can remove all land or split narrow necks without dropping remnants", () => {
  assert.equal(calculateBuildable({ ...input(), studyMarginM: 60 }).candidateAcres, 0);
  const i = input();
  i.boundary.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [40, 0],
        [40, 18],
        [60, 18],
        [60, 0],
        [100, 0],
        [100, 40],
        [60, 40],
        [60, 22],
        [40, 22],
        [40, 40],
        [0, 40],
        [0, 0],
      ].map(ll),
    ],
  };
  const r = calculateBuildable({ ...i, studyMarginM: 3 });
  assert.equal(r.components.length, 2);
  reconcile(r);
});
test("feet and metre buffers match, point and line deductions need explicit widths", () => {
  near(feetToMeters(100), 30.48, 1e-10);
  near(
    calculateBuildable(input([{ ...rule(), buffer: 10, unit: "meters" }])).excludedAcres,
    calculateBuildable(input([{ ...rule(), buffer: 10 / 0.3048, unit: "feet" }])).excludedAcres,
    1e-8,
  );
  const r = rule();
  r.features.features = [
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: ll([50, 50]) } },
  ];
  assert.equal(calculateBuildable(input([r])).breakdown[0]?.coverage, "failed");
});
test("self-intersecting geometry rejected without silently changing acreage", () => {
  const i = input();
  i.boundary.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [100, 100],
        [0, 100],
        [100, 0],
        [0, 0],
      ].map(ll),
    ],
  };
  assert.throws(() => calculateBuildable(i), /invalid or self-intersecting/);
});
test("failed, missing and partial categories remain explicit", () => {
  const a = { ...rule(), coverage: "failed" as const };
  const b = { ...rule(), category: "wetlands" as const, coverage: "partial" as const };
  const r = calculateBuildable({ ...input([a, b]), requested: ["user", "wetlands", "terrain"] });
  assert.deepEqual(
    r.completeness.map((c) => c.status),
    ["failed", "partial", "not-evaluated"],
  );
  assert.equal(r.breakdown[0]?.coverage, "failed");
});
test("known partial coverage is mapped without inventing boundaries for unknown sources", () => {
  const i = input([{ ...rule(), coverageGeometry: rect(0, 0, 50, 100).geometry }]);
  const r = calculateBuildable(i);
  assert.equal(r.completeness[0]?.status, "partial");
  near(sqm(Number(r.unknownCoverage[0]?.properties?.["acres"])), 5000);
  assert.equal(calculateBuildable(input([rule()])).unknownCoverage.length, 0);
});
test("small components stay in totals when flagged for display filtering", () => {
  const r = calculateBuildable({ ...input([rule(rect(5, 0, 5, 100))]), minimumComponentAcres: 1 });
  assert.equal(r.components.length, 2);
  assert.equal(r.components.filter((c) => c.belowMinimum).length, 1);
  near(
    r.components.reduce((s, c) => s + c.acres, 0),
    r.candidateAcres,
    1e-8,
  );
});
test("generation gate rejects stale asynchronous responses after edits or cancellation", () => {
  const gate = new BuildableRunGate();
  const a = gate.next();
  const b = gate.next();
  assert.equal(gate.accepts(a), false);
  assert.equal(gate.accepts(b), true);
  gate.cancel();
  assert.equal(gate.accepts(b), false);
});
test("snapshot round-trip preserves rules, results, source references and export metadata", () => {
  const i = input([rule()]);
  i.requested = constraintCategories.map((c) => c[0]);
  const result = calculateBuildable(i);
  const snapshot = { schemaVersion: 1 as const, input: i, result };
  const layer = {
    source: {
      kind: "derived",
      cacheProvenance: { buildableArea: JSON.parse(JSON.stringify(snapshot)) },
    },
  } as unknown as GisLayer;
  const reopened = snapshotFromLayer(layer)!;
  assert.equal(inputKey(reopened.input), result.inputKey);
  assert.deepEqual(reopened.result, result);
  const exported = buildableExport(reopened);
  assert.ok(exported.features.some((f) => f.properties?.["kind"] === "candidate"));
  assert.ok(exported.features.every((f) => f.properties?.["note"]));
  assert.match(JSON.stringify(exported), /\+proj=utm/);
  assert.ok(exported.features[0]!.geometry.type === "Polygon");
});
test("unsupported study extent is a clear error", () => {
  const i = input();
  i.boundary = rect(0, 0, 100000, 100000);
  assert.throws(() => calculateBuildable(i), /radius|broad/);
});
test("source outage keeps an incomplete study usable and cancellation propagates", async () => {
  const i = input([{ ...rule(), sourceUrl: "https://example.invalid/FeatureServer/0" }]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout, clearTimeout },
    configurable: true,
    writable: true,
  });
  try {
    const loaded = await loadBuildableSources(i, [], [], new AbortController().signal, () => {});
    assert.equal(loaded.rules[0]?.coverage, "failed");
    near(sqm(calculateBuildable(loaded).candidateAcres), 10000);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(() => loadBuildableSources(i, [], [], aborted.signal, () => {}), /abort/i);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }
});

test("analysis duplication has a distinct identity and renaming doesn't invalidate geometry", () => {
  const i = input([rule()]);
  const r = calculateBuildable(i);
  const copied = duplicateBuildableSnapshot({ schemaVersion: 1, input: i, result: r });
  assert.notEqual(copied.input.id, i.id);
  assert.notEqual(copied.result.components[0]?.id, r.components[0]?.id);
  assert.equal(inputKey({ ...i, name: "Renamed" }), inputKey(i));
  assert.equal(copied.result.inputKey, inputKey(copied.input));
});
test("failed rule acreage stays NULL, while a successful empty source is a real zero", () => {
  const failed = { ...rule(), coverage: "failed" as const };
  const empty = { ...rule(), features: { type: "FeatureCollection" as const, features: [] } };
  const r = calculateBuildable(input([failed, empty]));
  assert.equal(r.breakdown[0]?.acres, null);
  assert.equal(r.breakdown[1]?.acres, 0);
});
test("partial source responses retain original filters and report incomplete data", async () => {
  const i = input([
    {
      ...rule(),
      sourceUrl: "https://example.test/FeatureServer/0",
      sourceFilter: "STATUS = 'ACTIVE'",
    },
  ]);
  const priorFetch = globalThis.fetch,
    priorWindow = globalThis.window;
  const urls: string[] = [];
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout, clearTimeout },
    configurable: true,
    writable: true,
  });
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const count = String(url).includes("returnCountOnly");
    return new Response(
      JSON.stringify(count ? { count: 2 } : { type: "FeatureCollection", features: [rect()] }),
      { status: 200 },
    );
  };
  try {
    const loaded = await loadBuildableSources(i, [], [], new AbortController().signal, () => {});
    assert.equal(loaded.rules[0]?.coverage, "partial");
    assert.ok(urls.every((url) => new URL(url).searchParams.get("where") === "STATUS = 'ACTIVE'"));
  } finally {
    globalThis.fetch = priorFetch;
    Object.defineProperty(globalThis, "window", {
      value: priorWindow,
      configurable: true,
      writable: true,
    });
  }
});

test("viewport eviction doesn't invalidate a boundary snapshot, but known geometry edits do", () => {
  const i = input();
  i.sourceReference = { name: "Remote parcel", layerId: "parcels", featureId: "123" };
  const layer = {
    id: "parcels",
    source: { kind: "remote" },
    data: { type: "FeatureCollection", features: [] },
  } as unknown as GisLayer;
  assert.equal(boundarySnapshotChanged(i, [layer]), false);
  layer.data.features = [{ ...rect(0, 0, 90, 100), id: "123" }];
  assert.equal(boundarySnapshotChanged(i, [layer]), true);
  assert.equal(boundarySnapshotChanged(i, []), false);
});

test("whole-layer boundary unions overlapping features once and preserves source geometry", () => {
  const features = [rect(), rect(50, 0, 100, 100), rect(300, 0, 10, 10)];
  const original = JSON.stringify(features);
  const boundary = combineStudyPolygons(features);
  const r = calculateBuildable({ ...input(), boundary });
  near(sqm(r.studyAcres), 15100);
  assert.equal(r.components.length, 2);
  assert.equal(JSON.stringify(features), original);
});
test("whole-layer selection preserves polygon holes and multipolygons", () => {
  const holed = rect();
  holed.geometry = {
    type: "Polygon",
    coordinates: [ring(0, 0, 100, 100), ring(20, 20, 20, 20).reverse()],
  };
  const multi: AreaFeature = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPolygon",
      coordinates: [[ring(200, 0, 10, 10)], [ring(250, 0, 10, 10)]],
    },
  };
  const boundary = combineStudyPolygons([holed, multi]);
  const r = calculateBuildable({ ...input(), boundary });
  near(sqm(r.studyAcres), 9800);
  assert.equal(r.components.length, 3);
  assert.throws(() => combineStudyPolygons([]), /no polygon/);
});
test("whole-layer boundary edit detection ignores feature order and duplicate geometries", () => {
  const features = [rect(), rect(200, 0, 10, 10)],
    i = input();
  i.sourceReference = {
    name: "Layer",
    layerId: "layer",
    wholeLayer: true,
    geometryKey: polygonLayerKey(features),
  };
  const layer = {
    id: "layer",
    source: { kind: "file" },
    data: { type: "FeatureCollection", features: [features[1]!, features[0]!, features[0]!] },
  } as unknown as GisLayer;
  assert.equal(boundarySnapshotChanged(i, [layer]), false);
  layer.data.features = [rect(0, 0, 80, 80)];
  assert.equal(boundarySnapshotChanged(i, [layer]), true);
});
