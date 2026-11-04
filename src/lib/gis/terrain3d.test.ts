import test from "node:test";
import assert from "node:assert/strict";
import {
  TERRAIN_3D_DEFAULT_ZOOM,
  normalizeTerrainBounds,
  summarizeTerrainGrid,
  summarizeTerrainMesh,
  terrainAnalysisInput,
  terrainBoundsAreaKm2,
  terrainBoundary,
  validateTerrainSelection,
} from "./terrain3d.ts";

test("opens the terrain workspace at the requested zoom level", () => {
  assert.equal(TERRAIN_3D_DEFAULT_ZOOM, 11);
});

test("normalizes a two-corner selection and closes its polygon", () => {
  const bounds = normalizeTerrainBounds([-100, 35, -101, 34]);
  assert.deepEqual(bounds, [-101, 34, -100, 35]);
  const polygon = terrainBoundary(bounds);
  assert.deepEqual(polygon.geometry.coordinates[0]![0], polygon.geometry.coordinates[0]!.at(-1));
  assert.ok(terrainBoundsAreaKm2(bounds) > 9_000);
});

test("enforces separate quick and detailed area budgets", () => {
  const small: [-101, number, number, number] = [-101, 34, -100.99, 34.01];
  assert.doesNotThrow(() => validateTerrainSelection(small, "detailed"));
  const medium: [-101, number, number, number] = [-101, 34, -100.94, 34.06];
  assert.doesNotThrow(() => validateTerrainSelection(medium, "quick"));
  assert.throws(() => validateTerrainSelection(medium, "detailed"), /limited to 4 km²/);
});

test("quick and detailed analysis request different target grid spacing", () => {
  const bounds: [-101, number, number, number] = [-101, 34, -100.995, 34.005];
  assert.equal(terrainAnalysisInput(bounds, "quick").automation!.terrain.cellSizeM, 40);
  assert.equal(terrainAnalysisInput(bounds, "detailed").automation!.terrain.cellSizeM, 10);
});

test("summarizes valid terrain cells without inventing missing values", () => {
  const summary = summarizeTerrainGrid({
    bbox: [400000, 3700000, 400040, 3700040],
    width: 4,
    height: 4,
    epsg: 32614,
    values: [100, 102, null, 104, ...Array<number | null>(12).fill(null)],
    source: "test",
    sourceUrl: "https://example.test/dem",
    retrievedAt: "2026-11-04T00:00:00.000Z",
    productDate: null,
    sourceResolutionM: null,
    verticalDatum: "test",
  });
  assert.equal(summary.validCells, 3);
  assert.equal(summary.missingCells, 13);
  assert.equal(summary.minimumM, 100);
  assert.equal(summary.maximumM, 104);
  assert.equal(summary.reliefM, 4);
  assert.equal(summary.spacingM, 10);
});

test("quick display-mesh fallback keeps missing samples explicit", () => {
  const summary = summarizeTerrainMesh([-100, 32, -99.99, 32.01], 3, (longitude, latitude) =>
    longitude === -100 && latitude === 32 ? null : 100 + longitude + latitude,
  );
  assert.ok(summary);
  assert.equal(summary.validCells, 8);
  assert.equal(summary.missingCells, 1);
  assert.ok(summary.coveragePercent < 100);
  assert.ok(summary.reliefM !== null && summary.reliefM > 0);
  assert.ok(summary.spacingM > 0);
});
