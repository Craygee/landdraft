import assert from "node:assert/strict";
import test from "node:test";
import { canReuseRemoteCoverage, type RemoteCoverage } from "./remoteCoverage.ts";
import type { LayerSource } from "./types.ts";
const bbox: [number, number, number, number] = [-103, 34, -102, 35];
const coverage: RemoteCoverage = {
  bbox,
  queryKey: "project-a|parcels",
  zoomBucket: 12,
  loaded: 600,
};
const source: LayerSource = {
  kind: "remote",
  url: "https://example.test/parcels",
  lastRefreshedAt: 100,
  loadStatus: "complete",
};
test("loaded viewport is reused, but reopening a project with empty features reloads it", () => {
  assert.equal(canReuseRemoteCoverage(coverage, coverage.queryKey, 12, bbox, source, 600), true);
  assert.equal(
    canReuseRemoteCoverage(
      coverage,
      coverage.queryKey,
      12,
      bbox,
      { kind: "remote", url: source.url },
      0,
    ),
    false,
  );
  assert.equal(canReuseRemoteCoverage(coverage, coverage.queryKey, 12, bbox, source, 0), false);
});
test("another project, new zoom, failed load or uncovered extent cannot reuse coverage", () => {
  assert.equal(canReuseRemoteCoverage(coverage, "project-b|parcels", 12, bbox, source, 600), false);
  assert.equal(canReuseRemoteCoverage(coverage, coverage.queryKey, 11, bbox, source, 600), false);
  assert.equal(
    canReuseRemoteCoverage(
      coverage,
      coverage.queryKey,
      12,
      bbox,
      { ...source, loadStatus: "error" },
      600,
    ),
    false,
  );
  assert.equal(
    canReuseRemoteCoverage(coverage, coverage.queryKey, 12, [-104, 34, -102, 35], source, 600),
    false,
  );
});
test("a successfully queried empty area remains cacheable", () => {
  assert.equal(
    canReuseRemoteCoverage({ ...coverage, loaded: 0 }, coverage.queryKey, 12, bbox, source, 0),
    true,
  );
});
