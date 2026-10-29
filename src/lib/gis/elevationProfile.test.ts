import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeProfile,
  profileStations,
  requestElevationProfile,
  PROFILE_MAX_SAMPLES,
} from "./elevationProfile.ts";
import type { TerrainSampleResponse } from "../pipeline/elevation.ts";

const response = (values: Array<number | null>): TerrainSampleResponse => ({
  providerId: "usgs-3dep",
  source: "USGS 3DEP",
  verticalDatum: "Source DEM",
  retrievedAt: 123,
  points: values.map((elevationM, i) => ({
    stationM: i * 100,
    longitude: -105 + i * 0.001,
    latitude: 39,
    elevationM,
  })),
  failedCount: values.filter((v) => v === null).length,
});
test("geodesic sampling retains endpoints, bends and exact station order within the sample budget", () => {
  const coordinates = [
    [-105, 39],
    [-104.999, 39],
    [-104.999, 39.003],
  ];
  const samples = profileStations(coordinates, 10);
  assert.equal(samples[0]!.stationM, 0);
  assert.equal(samples.at(-1)!.longitude, coordinates.at(-1)![0]);
  assert.equal(samples.at(-1)!.latitude, coordinates.at(-1)![1]);
  assert.ok(
    samples.some((p) => p.longitude === coordinates[1]![0] && p.latitude === coordinates[1]![1]),
  );
  assert.ok(samples.every((p, i) => i === 0 || p.stationM > samples[i - 1]!.stationM));
  assert.ok(samples.at(-1)!.stationM > 400 && samples.at(-1)!.stationM < 450);
  assert.ok(
    profileStations(
      [
        [-105, 39],
        [-104.5, 39],
      ],
      1,
    ).length <= PROFILE_MAX_SAMPLES,
  );
  assert.throws(
    () =>
      profileStations([
        [-105, 39],
        [-105, 39],
      ]),
    /different/,
  );
  assert.throws(
    () =>
      profileStations([
        [-105, 39],
        [-100, 39],
      ]),
    /100 km/,
  );
});
test("slope uses horizontal station distance and preserves real sea-level and below-sea elevations", () => {
  const p = analyzeProfile(response([0, 10, -10]));
  assert.equal(p.points[1]!.gradePercent, 10);
  assert.ok(Math.abs(p.points[1]!.slopeDegrees! - 5.710593) < 0.00001);
  assert.equal(p.points[2]!.gradePercent, -20);
  assert.equal(p.ascentM, 10);
  assert.equal(p.descentM, 20);
  assert.equal(p.minimumM, -10);
  assert.equal(p.maximumM, 10);
  assert.equal(p.missing, 0);
  assert.equal(p.distanceM, 200);
  assert.equal(p.maximumSpacingM, 100);
});
test("missing elevations never become zero or create a slope across a coverage gap", () => {
  const p = analyzeProfile(response([100, null, 200, 210]));
  assert.equal(p.points[1]!.elevationM, null);
  assert.equal(p.points[1]!.gradePercent, null);
  assert.equal(p.points[2]!.gradePercent, null);
  assert.equal(p.ascentM, 10);
  assert.equal(p.missing, 1);
  assert.equal(analyzeProfile(response([null, null])).minimumM, null);
});
test("profile batches stay bounded, maintain ordering and reject mismatched coordinates", async (t) => {
  const sizes: number[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    sizes.push(body.points.length);
    return Response.json({
      ...response([]),
      points: body.points.map((p: object) => ({ ...p, elevationM: 100 })),
      failedCount: 0,
    });
  });
  const p = await requestElevationProfile(
    [
      [-105, 39],
      [-104.97, 39],
    ],
    10,
    new AbortController().signal,
  );
  assert.ok(sizes.length > 1);
  assert.ok(sizes.every((n) => n >= 2 && n <= 96));
  assert.ok(p.points.every((p, i, all) => i === 0 || p.stationM > all[i - 1]!.stationM));
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...response([10, 20]) }));
  await assert.rejects(
    requestElevationProfile(
      [
        [-105, 39],
        [-104.999, 39],
      ],
      1000,
      new AbortController().signal,
    ),
    /match/,
  );
});

test("final single-sample batch is padded for the provider without duplicating the chart station", async (t) => {
  const sizes: number[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    sizes.push(body.points.length);
    return Response.json({
      ...response([]),
      points: body.points.map((p: object) => ({ ...p, elevationM: 100 })),
      failedCount: 0,
    });
  });
  const coordinates = [
    [-105, 39],
    [-104.97, 39],
  ];
  const total = profileStations(coordinates, 100000).at(-1)!.stationM;
  const p = await requestElevationProfile(coordinates, total / 192, new AbortController().signal);
  assert.equal(p.points.length, 193);
  assert.deepEqual(sizes, [96, 96, 2]);
  assert.equal(new Set(p.points.map((p) => p.stationM)).size, 193);
});
test("an already cancelled request does not contact the elevation provider", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(response([]));
  });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    requestElevationProfile(
      [
        [-105, 39],
        [-104.999, 39],
      ],
      10,
      abort.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
});
