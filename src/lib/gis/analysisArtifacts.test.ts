import { defaultStyle } from "./types.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeProfile } from "./elevationProfile.ts";
import {
  addAnalysisToComposition,
  analysisPrintFrame,
  elevationCsv,
  elevationGeoJSON,
  elevationSvg,
  elevationFromLayer,
  printAnalysisPanels,
} from "./analysisArtifacts.ts";
import type { SavedElevationProfile } from "./analysisArtifacts.ts";
import type { GisLayer, PrintComposition } from "./types.ts";
const profile = analyzeProfile({
  providerId: "usgs-3dep",
  source: "USGS 3DEP",
  verticalDatum: "Source DEM",
  retrievedAt: 123,
  failedCount: 1,
  points: [0, null, 20].map((elevationM, i) => ({
    stationM: i * 100,
    longitude: -100 + i * 0.001,
    latitude: 32,
    elevationM,
  })),
});
const saved: SavedElevationProfile = {
  schemaVersion: 1,
  name: 'A < B & "test"',
  coordinates: [
    [-100, 32],
    [-99.998, 32],
  ],
  profile,
};
const layer = (id: string): GisLayer =>
  ({
    id,
    name: id,
    groupId: "analyses",
    visible: true,
    data: { type: "FeatureCollection", features: [] },
    style: defaultStyle(),
    createdAt: 123,
    source: {
      kind: "derived",
      sourceLayerId: "elevation-profile",
      cacheProvenance: { elevationProfile: saved },
    },
  }) as GisLayer;
test("elevation data exports distinguish real zero and NULL and retain source metadata", () => {
  const csv = elevationCsv(saved).split("\n");
  assert.equal(csv[1]?.split(",")[3], "0");
  assert.equal(csv[2]?.split(",")[3], "");
  const data = elevationGeoJSON(saved);
  assert.equal(data.features[2]?.properties?.["elevationM"], null);
  assert.equal(data.features[0]?.properties?.["source"], "USGS 3DEP");
  assert.equal(data.features[0]?.geometry.type, "LineString");
});
test("SVG graph escapes text and does not connect elevations across missing data", () => {
  const svg = elevationSvg(saved);
  assert.ok(svg.includes("A &lt; B &amp; &quot;test&quot;"));
  const path = /<path d="([^"]+)" fill="none"/.exec(svg)?.[1] ?? "";
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal(path.includes("L"), false);
  assert.ok(svg.includes("Missing samples: 1"));
});
test("saved elevation profiles reopen and print selection persists without duplicates", () => {
  const one = layer("one"),
    two = layer("two");
  assert.deepEqual(elevationFromLayer(JSON.parse(JSON.stringify(one))), saved);
  const initial = {
    analysisLayerIds: [],
    includedLayerIds: [],
    legendItems: {},
    frame: { x: 4, y: 12, width: 92, height: 82 },
  } as unknown as PrintComposition;
  const added = addAnalysisToComposition(initial, "one", [one, two]);
  assert.equal(added.frame.y + added.frame.height, 70);
  assert.deepEqual(added.includedLayerIds, ["one"]);
  const replaced = addAnalysisToComposition(added, "two", [one, two]);
  assert.deepEqual(replaced.analysisLayerIds, ["two"]);
  assert.equal(printAnalysisPanels(JSON.parse(JSON.stringify(replaced)), [one, two]).length, 1);
  assert.equal(printAnalysisPanels(replaced, []).length, 0);
  assert.equal(addAnalysisToComposition(initial, "missing", []), initial);
});

test("paper/orientation resets and manual frames leave room for analysis cards", () => {
  const reset = { x: 4, y: 12, width: 92, height: 82 };
  assert.equal(analysisPrintFrame(reset, true).height, 58);
  const moved = analysisPrintFrame({ ...reset, y: 95 }, true);
  assert.equal(moved.y + moved.height, 70);
  assert.equal(analysisPrintFrame(reset, false), reset);
});
