import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, LineString } from "geojson";
import { terrainStationsForRoute } from "./elevation.ts";
import { solveSteadyLiquid } from "./liquidSolver.ts";
import {
  SYSTEM_FLUIDS,
  SYSTEM_PIPE_SPECIFICATIONS,
  createDefaultScenario,
  routeFromLineFeature,
} from "./model.ts";
import { handlePipelineElevationRequest } from "./terrain.server.ts";

function line(coordinates: number[][]): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

test("terrain stations follow the full route and stay within the provider request limit", () => {
  const route = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32],
      [-96.95, 32.03],
      [-96.9, 32],
    ]),
  });
  const stations = terrainStationsForRoute(route, 100, 20);
  assert.equal(stations.length, 20);
  assert.deepEqual(stations[0]?.coordinate, route.coordinates[0]);
  assert.deepEqual(stations.at(-1)?.coordinate, route.coordinates.at(-1));
  assert.equal(stations.at(-1)?.stationM, route.lengthM);
  assert.ok(
    stations.every(
      (station, index) => index === 0 || station.stationM > stations[index - 1]!.stationM,
    ),
  );
});

test("editing route geometry clears old terrain samples while unchanged geometry preserves them", () => {
  const feature = line([
    [-97, 32],
    [-96.99, 32],
  ]);
  const base = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature,
  });
  const sampled = {
    ...base,
    stations: base.stations.map((station, index) => ({
      ...station,
      groundElevationM: index * 10,
      pipelineElevationM: index * 10,
      elevationSampleId: `sample-${index}`,
    })),
    elevationSamples: base.stations.map((station, index) => ({
      id: `sample-${index}`,
      stationM: station.stationM,
      coordinate: station.coordinate,
      groundElevationM: index * 10,
      source: "USGS 3DEP",
      sourceKind: "dem" as const,
      capturedAt: 1,
      quality: "medium" as const,
      provenance: "provider" as const,
    })),
  };
  const unchanged = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature,
    previous: sampled,
  });
  assert.equal(unchanged.elevationSamples.length, 2);
  assert.equal(unchanged.geometryRevision, sampled.geometryRevision);

  const edited = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32],
      [-96.985, 32.004],
    ]),
    previous: sampled,
  });
  assert.equal(edited.elevationSamples.length, 0);
  assert.ok(edited.stations.every((station) => station.groundElevationM === undefined));
  assert.equal(edited.geometryRevision, sampled.geometryRevision + 1);
});

test("the liquid solver applies terrain elevation to static head", () => {
  const base = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32],
      [-96.99, 32],
    ]),
  });
  const uphill = {
    ...base,
    stations: base.stations.map((station, index) => ({
      ...station,
      groundElevationM: index * 100,
      pipelineElevationM: index * 100,
    })),
  };
  const scenario = { ...createDefaultScenario(uphill.id), flowM3S: 0 };
  const run = solveSteadyLiquid({
    route: uphill,
    scenario,
    fluid: SYSTEM_FLUIDS.find((fluid) => fluid.id === scenario.fluidId)!,
    pipe: SYSTEM_PIPE_SPECIFICATIONS.find((pipe) => pipe.id === scenario.pipeSpecificationId)!,
  });
  const pressureDrop = run.profile[0]!.pressurePa - run.profile.at(-1)!.pressurePa;
  assert.ok(Math.abs(pressureDrop - 998.2 * 9.80665 * 100) < 1);
  assert.ok(Math.abs(run.profile.at(-1)!.cumulativeElevationPressureChangePa + pressureDrop) < 1);
  assert.equal(run.profile.at(-1)!.cumulativeFrictionLossPa, 0);
});

test("the pressure profile falls on an uphill segment and recovers on the descent", () => {
  const base = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32],
      [-96.995, 32],
      [-96.99, 32],
    ]),
  });
  const hill = {
    ...base,
    stations: base.stations.map((station, index) => ({
      ...station,
      groundElevationM: index === 1 ? 120 : 20,
      pipelineElevationM: index === 1 ? 120 : 20,
    })),
  };
  const scenario = { ...createDefaultScenario(hill.id), flowM3S: 0 };
  const run = solveSteadyLiquid({
    route: hill,
    scenario,
    fluid: SYSTEM_FLUIDS.find((fluid) => fluid.id === scenario.fluidId)!,
    pipe: SYSTEM_PIPE_SPECIFICATIONS.find((pipe) => pipe.id === scenario.pipeSpecificationId)!,
  });
  assert.ok(run.profile[1]!.pressurePa < run.profile[0]!.pressurePa);
  assert.ok(Math.abs(run.profile.at(-1)!.pressurePa - run.profile[0]!.pressurePa) < 1);
  assert.ok(run.profile[1]!.cumulativeElevationPressureChangePa < 0);
  assert.ok(Math.abs(run.profile.at(-1)!.cumulativeElevationPressureChangePa) < 1);
});

test("the terrain API normalizes the official USGS EPQS response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ value: "211.42", resolution: "10" });
  try {
    const response = await handlePipelineElevationRequest(
      new Request("https://landdraft.test/api/pipeline/elevation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          points: [
            { stationM: 0, longitude: -97, latitude: 32 },
            { stationM: 100, longitude: -96.999, latitude: 32 },
          ],
        }),
      }),
    );
    assert.equal(response?.status, 200);
    const payload = (await response?.json()) as {
      points: Array<{ elevationM: number; resolutionM: number }>;
      failedCount: number;
    };
    assert.equal(payload.failedCount, 0);
    assert.deepEqual(
      payload.points.map((point) => [point.elevationM, point.resolutionM]),
      [
        [211.42, 10],
        [211.42, 10],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EPQS null, blank and boolean values remain missing while real zero stays valid", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [index, value] of [null, "", true, 0, -12.5, -1000000].entries()) {
      globalThis.fetch = async () => Response.json({ value, resolution: null });
      const longitude = -109 + index * 0.01;
      const result = await handlePipelineElevationRequest(
        new Request("https://landdraft.test/api/pipeline/elevation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            points: [
              { stationM: 0, longitude, latitude: 38 },
              { stationM: 10, longitude: longitude + 0.0001, latitude: 38 },
            ],
          }),
        }),
      );
      const payload = await result!.json();
      assert.equal(payload.points[0].elevationM, index === 3 ? 0 : index === 4 ? -12.5 : null);
      assert.equal(payload.points[0].resolutionM, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
