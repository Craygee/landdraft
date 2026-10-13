import test from "node:test";
import assert from "node:assert/strict";
import { bboxPolygon } from "@turf/turf";
import {
  measurementAge,
  normalizeWaterRecord,
  recordsInside,
  validateWaterArea,
  waterCsv,
} from "./model.ts";
import { WATER_SOURCES } from "./registry.ts";
import { fetchWaterSource } from "./gateway.server.ts";
import { consumeWaterRequest, requireWaterAccess } from "./access.server.ts";

test("server access rejects missing authentication and bounds requests per user", async () => {
  await assert.rejects(() => requireWaterAccess(""), /Sign in/);
  for (let i = 0; i < 12; i++) assert.equal(consumeWaterRequest("water-test-user", 1000), true);
  assert.equal(consumeWaterRequest("water-test-user", 1000), false);
  assert.equal(consumeWaterRequest("other-water-user", 1000), true);
  assert.equal(consumeWaterRequest("water-test-user", 61_000), true);
});

const at = "2026-09-13T12:00:00Z";
test("latest readings retain historical age, units and provisional qualifiers", () => {
  const r = normalizeWaterRecord(
    "usgs-measurements",
    {
      id: "reading-1",
      geometry: { type: "Point", coordinates: [-98.5, 29.2] },
      properties: {
        monitoring_location_id: "USGS-123",
        parameter_code: "00060",
        time: "2015-01-01T00:00:00Z",
        value: "10.60",
        unit_of_measure: "ft^3/s",
        approval_status: "Provisional",
        qualifier: "Estimated",
      },
    },
    at,
  )!;
  assert.equal(r.measurement?.originalValue, "10.60");
  assert.equal(r.measurement?.unit, "ft^3/s");
  assert.equal(r.observationTime, "2015-01-01T00:00:00Z");
  assert.equal(measurementAge(r.observationTime, Date.parse(at)), "Historical sensor reading");
  assert.ok(r.flags.some((f) => f.includes("Provisional")));
  assert.equal(r.aquifer, null);
  assert.equal(measurementAge(null), "Unknown");
  assert.equal(measurementAge("2030-01-01", Date.parse(at)), "Invalid future timestamp");
});
const area = bboxPolygon([-99, 29, -98, 29.5]);
test("published aquifer extents remain interpretations and intersect the study boundary", () => {
  const polygon = bboxPolygon([-99.1, 29.1, -98.8, 29.4]);
  polygon.properties = { OBJECTID: 1, AQ_NAME: "TEST UNIT" };
  const r = normalizeWaterRecord("twdb-aquifers", polygon, at)!;
  assert.equal(r.classification, "INFERRED");
  assert.equal(r.depth, null);
  assert.equal(r.aquifer, "TEST UNIT");
  assert.equal(recordsInside([r], area).length, 1);
  assert.equal(recordsInside([r], bboxPolygon([-112, 33, -111.9, 33.1])).length, 0);
});
test("major and minor TWDB aquifer schemas retain their distinct published name fields", () => {
  const major = bboxPolygon([-99.1, 29.1, -98.8, 29.4]);
  major.properties = { OBJECTID: 1, AQ_NAME: "MAJOR UNIT" };
  const minor = bboxPolygon([-99.1, 29.1, -98.8, 29.4]);
  minor.properties = { OBJECTID: 2, AQU_NAME: "MINOR UNIT" };
  assert.equal(normalizeWaterRecord("twdb-aquifers", major, at)?.aquifer, "MAJOR UNIT");
  assert.equal(normalizeWaterRecord("twdb-minor-aquifers", minor, at)?.aquifer, "MINOR UNIT");
});
function usgs(depth: unknown = 100) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-98.5, 29.2] },
    properties: {
      id: "USGS-123",
      agency_code: "USGS",
      site_type: "Well",
      well_constructed_depth: depth,
      aquifer_code: "LOCAL-A",
    },
  };
}
test("only reviewed, allowlisted sources are enabled", () => {
  for (const s of WATER_SOURCES) {
    assert.equal(s.license, "PUBLIC_OPEN");
    assert.ok(s.terms.startsWith("https://"));
    assert.ok(s.attribution);
  }
});
test("USGS depth is not water level and missing depth is not zero", () => {
  const r = normalizeWaterRecord("usgs-sites", usgs(null), at)!;
  assert.equal(r.depth, null);
  assert.equal(r.observationTime, null);
  assert.equal(r.verticalDatum, null);
  assert.equal(normalizeWaterRecord("usgs-sites", usgs(0), at)!.depth, 0);
  assert.equal(normalizeWaterRecord("usgs-sites", usgs(-1), at)!.depth, null);
  assert.equal(normalizeWaterRecord("usgs-sites", usgs("100"), at)!.depth, null);
});
test("original data, aquifer term and source identity survive normalization", () => {
  const raw = usgs();
  const r = normalizeWaterRecord("usgs-sites", raw, at)!;
  assert.deepEqual(r.raw, raw.properties);
  assert.equal(r.aquifer, "LOCAL-A");
  assert.equal(r.depthUnit, "ft");
  assert.equal(r.classification, "OBSERVED");
  assert.equal(r.evidence, "Source reported");
  assert.match(r.sourceUrl, /USGS-123/);
});
test("TWDB well depth retains the provider's documented feet unit without inventing chemistry", () => {
  const r = normalizeWaterRecord(
    "twdb-wells",
    {
      geometry: { x: -98.5, y: 29.2 },
      attributes: { StateWellNumber: "ABC", WellDepth: 300, WaterQualityAvailable: "Y" },
    },
    at,
  )!;
  assert.equal(r.depth, 300);
  assert.equal(r.depthUnit, "ft");
  assert.equal(r.raw["WellDepth"], 300);
  assert.ok(r.flags.some((f) => f.includes("chemistry not retrieved")));
});

test("submitted well reports retain completion date, proposed use, and borehole depth", () => {
  const r = normalizeWaterRecord(
    "twdb-well-reports",
    {
      attributes: {
        WellReportTrackingNumber: "123456",
        WellType: "Withdrawal",
        ProposedUse: "Domestic",
        County: "Travis",
        DateOfWellCompletion: Date.parse("2020-04-03T00:00:00Z"),
        BoreholeDepthFt: 340,
      },
      geometry: { x: -97.7, y: 30.2 },
    },
    at,
  )!;
  assert.equal(r.depth, 340);
  assert.equal(r.observationTime, "2020-04-03T00:00:00.000Z");
  assert.equal(r.aquifer, null);
  assert.equal(r.raw["ProposedUse"], "Domestic");
});
test("invalid locations, missing identities and non-USGS records are rejected", () => {
  assert.equal(
    normalizeWaterRecord(
      "usgs-sites",
      { ...usgs(), geometry: { type: "Point", coordinates: [200, 29] } },
      at,
    ),
    null,
  );
  assert.equal(
    normalizeWaterRecord(
      "usgs-sites",
      { ...usgs(), properties: { id: "X", agency_code: "OTHER" } },
      at,
    ),
    null,
  );
  assert.equal(normalizeWaterRecord("usgs-sites", {}, at), null);
});
test("boundary limits and self intersection guard expensive or invalid studies", () => {
  assert.equal(validateWaterArea(area).geometry.type, "Polygon");
  assert.throws(() => validateWaterArea(bboxPolygon([-125, 25, -65, 50])));
  assert.throws(() =>
    validateWaterArea({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] } }),
  );
  const bad = structuredClone(area);
  bad.geometry.coordinates[0]![1] = [NaN, 29];
  assert.throws(() => validateWaterArea(bad));
});
test("polygon holes and repeated IDs do not inflate area evidence", () => {
  const r = normalizeWaterRecord("usgs-sites", usgs(), at)!;
  assert.equal(recordsInside([r, r], area).length, 1);
  const hole = structuredClone(area);
  hole.geometry.coordinates.push(bboxPolygon([-98.6, 29.1, -98.4, 29.3]).geometry.coordinates[0]!);
  assert.equal(recordsInside([r], hole).length, 0);
});
test("CSV carries provenance and neutralizes spreadsheet formula cells", () => {
  const r = normalizeWaterRecord("usgs-sites", usgs(), at)!;
  r.name = '=HYPERLINK("bad")';
  const csv = waterCsv([r]);
  assert.ok(csv.includes("retrievedAt"));
  assert.ok(csv.includes("sourceUrl"));
  assert.ok(csv.includes("\"'=HYPERLINK"));
});
test("provider failure and transfer limits are explicit", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("{}", { status: 429 });
    assert.equal((await fetchWaterSource("usgs-sites", area)).status, "rate-limited");
    globalThis.fetch = async () =>
      Response.json({ type: "FeatureCollection", features: [usgs()], links: [{ rel: "next" }] });
    const partial = await fetchWaterSource("usgs-sites", area);
    assert.equal(partial.truncated, true);
    assert.equal(partial.status, "degraded");
    assert.equal(partial.records.length, 1);
    globalThis.fetch = async () => Response.json({ error: "schema changed" });
    assert.equal((await fetchWaterSource("usgs-sites", area)).status, "unavailable");
  } finally {
    globalThis.fetch = original;
  }
});
test("empty area results do not conclude that water is absent; Texas coverage is bounded", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ features: [] });
    const empty = await fetchWaterSource("usgs-sites", area);
    assert.match(empty.message, /does not establish absence/);
    assert.equal(
      (await fetchWaterSource("twdb-wells", bboxPolygon([-112, 33, -111.9, 33.1]))).status,
      "outside-coverage",
    );
  } finally {
    globalThis.fetch = original;
  }
});
