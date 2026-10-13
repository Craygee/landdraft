import test from "node:test";
import assert from "node:assert/strict";
import { bboxPolygon } from "@turf/turf";
import type { MultiPolygon, Point, Polygon } from "geojson";

import {
  buildHydrologyProducts,
  buildWellSiteProfile,
  wellDepthBand,
  wellStyle,
} from "./analysis.ts";
import type { WaterRecord, WaterSourceId } from "./types.ts";

const retrievedAt = "2026-09-29T12:00:00Z";
const study = bboxPolygon([-98.8, 29.0, -98.0, 29.8]);

function record(
  id: string,
  sourceId: WaterSourceId,
  geometry: Point | Polygon | MultiPolygon,
  overrides: Partial<WaterRecord> = {},
): WaterRecord {
  return {
    id,
    sourceId,
    sourceRecordId: id,
    name: id,
    kind: sourceId.includes("aquifers") ? "Aquifer extent" : "Well",
    geometry,
    classification: sourceId.includes("aquifers") ? "INFERRED" : "OBSERVED",
    evidence: "Source reported",
    aquifer: null,
    county: null,
    state: "TX",
    huc: null,
    depth: null,
    depthUnit: null,
    verticalDatum: null,
    locationAccuracy: null,
    observationTime: null,
    retrievedAt,
    sourceUrl: "https://example.test/source",
    raw: {},
    flags: [],
    ...overrides,
  };
}

function measurement(
  id: string,
  coordinates: [number, number],
  parameterCode: "62610" | "72019",
  value: number,
): WaterRecord {
  return record(
    id,
    "usgs-measurements",
    { type: "Point", coordinates },
    {
      observationTime: "2026-09-28T12:00:00Z",
      verticalDatum: parameterCode === "62610" ? "NGVD29" : null,
      raw: { monitoring_location_id: id },
      measurement: {
        parameterCode,
        originalValue: String(value),
        value,
        unit: "ft",
        approval: "Approved",
        qualifier: null,
      },
    },
  );
}

test("hydrology studies create attribute, density, groundwater surface, and gradient layers", () => {
  const aquifer = bboxPolygon([-98.7, 29.1, -98.1, 29.7]);
  const records = [
    record(
      "well-shallow",
      "twdb-wells",
      { type: "Point", coordinates: [-98.6, 29.2] },
      {
        aquifer: "Test Aquifer",
        depth: 80,
        depthUnit: "ft",
      },
    ),
    record(
      "well-deep",
      "usgs-sites",
      { type: "Point", coordinates: [-98.2, 29.6] },
      {
        aquifer: "Test Aquifer",
        depth: 420,
        depthUnit: "ft",
      },
    ),
    record("major-aquifer", "twdb-aquifers", aquifer.geometry, {
      name: "Test Aquifer",
      aquifer: "Test Aquifer",
    }),
    measurement("head-a", [-98.62, 29.22], "62610", 710),
    measurement("head-b", [-98.42, 29.48], "62610", 680),
    measurement("head-c", [-98.18, 29.64], "62610", 640),
    measurement("depth-a", [-98.61, 29.24], "72019", 45),
    measurement("depth-b", [-98.4, 29.5], "72019", 55),
  ];

  const result = buildHydrologyProducts(records, study, "depth");
  assert.equal(result.studies.wellCount, 2);
  assert.equal(result.studies.depthSampleCount, 2);
  assert.equal(result.studies.depthBands["0–99 ft"], 1);
  assert.equal(result.studies.depthBands["300–599 ft"], 1);
  assert.equal(
    result.studies.interpolation.find((item) => item.id === "groundwater-elevation")?.status,
    "AVAILABLE",
  );
  assert.equal(
    result.studies.interpolation.find((item) => item.id === "depth-to-water")?.status,
    "INSUFFICIENT_DATA",
  );
  assert.ok(result.layers.some((layer) => layer.name.endsWith("Wells by attributes")));
  assert.ok(result.layers.some((layer) => layer.name.endsWith("Mapped well density")));
  assert.ok(
    result.layers.some((layer) => layer.name.includes("Groundwater elevation screening surface")),
  );
  assert.ok(result.layers.some((layer) => layer.name.endsWith("Potential groundwater gradient")));

  const summary = result.studies.aquifers.find((item) => item.name === "Test Aquifer");
  assert.ok(summary);
  assert.equal(summary.wellCount, 2);
  assert.ok((summary.mappedAreaAcres ?? 0) > 0);
  assert.equal(summary.storageVolumeStatus, "UNAVAILABLE");
});

test("missing measurements remain unavailable and are never replaced with zero", () => {
  const records = [
    record("unknown-depth", "twdb-wells", { type: "Point", coordinates: [-98.5, 29.4] }),
    measurement("single-head", [-98.4, 29.5], "62610", 0),
  ];
  const result = buildHydrologyProducts(records, study);
  const elevation = result.studies.interpolation.find(
    (item) => item.id === "groundwater-elevation",
  );
  assert.equal(elevation?.status, "INSUFFICIENT_DATA");
  assert.equal(elevation?.minimum, 0);
  assert.equal(result.studies.depthSampleCount, 0);
  assert.equal(result.studies.depthBands["Unknown"], 1);
  assert.equal(
    result.layers.some((layer) => layer.name.includes("Groundwater elevation screening surface")),
    false,
  );
});

test("well symbols expose explicit category rules for depth, aquifer, and type", () => {
  assert.equal(wellDepthBand(null), "Unknown");
  assert.equal(wellDepthBand(0), "0–99 ft");
  assert.equal(wellDepthBand(1_000), "1,000+ ft");
  const records = [
    record(
      "a",
      "usgs-sites",
      { type: "Point", coordinates: [-98.4, 29.3] },
      {
        aquifer: "A",
        depth: 100,
        depthUnit: "ft",
      },
    ),
  ];
  assert.equal(wellStyle("depth", records).categorized?.field, "depthClass");
  assert.equal(wellStyle("aquifer", records).categorized?.field, "aquifer");
  assert.equal(wellStyle("type", records).categorized?.field, "wellType");
});

test("each mapped aquifer gets separate depth and real reported-yield screening products", () => {
  const aquifer = bboxPolygon([-98.7, 29.1, -98.1, 29.7]);
  const wells = [
    [-98.6, 29.2, 120, 80],
    [-98.4, 29.4, 180, 140],
    [-98.2, 29.6, 260, 220],
  ].map(([lng, lat, depth, yieldGpm], index) =>
    record(
      `yield-${index}`,
      "twdb-wells",
      { type: "Point", coordinates: [lng!, lat!] },
      {
        aquifer: "Test Aquifer",
        depth: depth!,
        depthUnit: "ft",
        raw: { WellYield: yieldGpm, PrimaryWaterUse: index ? "Irrigation" : "Domestic" },
      },
    ),
  );
  const result = buildHydrologyProducts(
    [
      ...wells,
      record("extent", "twdb-aquifers", aquifer.geometry, {
        name: "Test Aquifer",
        aquifer: "Test Aquifer",
      }),
    ],
    study,
  );
  const summary = result.studies.aquifers.find((item) => item.name === "Test Aquifer")!;
  assert.equal(summary.depthSurfaceStatus, "AVAILABLE");
  assert.equal(summary.yieldSurfaceStatus, "AVAILABLE");
  assert.equal(summary.yieldSampleCount, 3);
  assert.ok(
    result.layers.some((layer) => layer.name.includes("Test Aquifer · Estimated completion depth")),
  );
  assert.ok(
    result.layers.some((layer) => layer.name.includes("Test Aquifer · Estimated reported yield")),
  );
  assert.ok(
    result.layers.some((layer) => layer.name.includes("Higher anticipated yield evidence")),
  );
});

test("well profile never converts absent yield to zero", () => {
  const aquifer = bboxPolygon([-98.7, 29.1, -98.1, 29.7]);
  const records = [
    record("extent", "twdb-aquifers", aquifer.geometry, {
      name: "Test Aquifer",
      aquifer: "Test Aquifer",
    }),
    ...[100, 150, 220].map((depth, index) =>
      record(
        `well-${index}`,
        "twdb-wells",
        { type: "Point", coordinates: [-98.5 + index * 0.05, 29.35 + index * 0.05] },
        { aquifer: "Test Aquifer", depth, depthUnit: "ft", raw: { PrimaryWaterUse: "Domestic" } },
      ),
    ),
  ];
  const profile = buildWellSiteProfile(records, [-98.45, 29.4]);
  assert.equal(profile.aquifers[0]?.estimatedCompletionDepthFt !== null, true);
  assert.equal(profile.aquifers[0]?.estimatedYieldGpm, null);
  assert.equal(profile.aquifers[0]?.yieldSampleCount, 0);
});
