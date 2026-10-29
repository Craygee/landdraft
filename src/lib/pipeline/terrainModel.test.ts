import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, LineString } from "geojson";
import { routeFromLineFeature } from "./model.ts";
import { createControlPoint, resolveRouteElevations } from "./terrainModel.ts";
import type { ElevationSample, PipelineRoute } from "./types.ts";

function line(coordinates: number[][]): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

/** A straight ~1.9 km route with DEM samples every vertex at a constant 100 m. */
function demRoute(): PipelineRoute {
  const coordinates = Array.from({ length: 21 }, (_, index) => [-97 + index * 0.001, 32]);
  const route = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line(coordinates),
  });
  const samples: ElevationSample[] = route.stations.map((station, index) => ({
    id: `dem-${index}`,
    stationM: station.stationM,
    coordinate: station.coordinate,
    groundElevationM: 100,
    source: "test DEM",
    sourceKind: "dem",
    capturedAt: 0,
    quality: "medium",
    provenance: "provider",
  }));
  return { ...route, elevationSamples: samples };
}

function groundAt(route: PipelineRoute, stationM: number) {
  return route.stations.find((station) => Math.abs(station.stationM - stationM) < 1e-6)
    ?.groundElevationM;
}

test("without control points the profile is the DEM, labelled provider", () => {
  const { route } = resolveRouteElevations(demRoute());
  assert.ok(route.stations.every((station) => station.groundElevationM === 100));
  assert.ok(route.stations.every((station) => station.elevationProvenance === "provider"));
});

test("a survey point overrides DEM only within its influence range, tapering to zero", () => {
  const base = demRoute();
  const surveyStationM = base.stations[10]!.stationM;
  const control = createControlPoint({
    route: base,
    stationM: surveyStationM,
    groundElevationM: 104,
    influenceRangeM: 200,
    sourceKind: "survey",
    source: "Test survey",
  });
  const { route, appliedControlIds } = resolveRouteElevations({
    ...base,
    controlPoints: [control],
  });
  assert.deepEqual(appliedControlIds, [control.id]);
  const atControl = route.stations.find((station) => station.controlPointId === control.id)!;
  assert.equal(atControl.groundElevationM, 104);
  assert.equal(atControl.elevationProvenance, "surveyed");
  // Neighbouring vertex ~94 m away gets roughly half of the +4 m correction.
  const neighbour = base.stations[11]!;
  const weight = 1 - (neighbour.stationM - surveyStationM) / 200;
  assert.ok(Math.abs(groundAt(route, neighbour.stationM)! - (100 + 4 * weight)) < 1e-9);
  // Stations beyond the range keep the DEM value and provenance.
  const far = route.stations.find((station) => station.stationM > surveyStationM + 200)!;
  assert.equal(far.groundElevationM, 100);
  assert.equal(far.elevationProvenance, "provider");
});

test("duplicate controls at one station resolve to one newest authoritative station", () => {
  const base = demRoute();
  const stationM = base.stations[10]!.stationM;
  const older = {
    ...createControlPoint({
      route: base,
      stationM,
      groundElevationM: 104,
      influenceRangeM: 20,
      sourceKind: "survey",
      source: "Older survey",
    }),
    capturedAt: 1,
  };
  const correction = {
    ...createControlPoint({
      route: base,
      stationM,
      groundElevationM: 106,
      influenceRangeM: 20,
      sourceKind: "survey",
      source: "Corrected survey",
    }),
    capturedAt: 2,
  };
  const resolved = resolveRouteElevations({
    ...base,
    controlPoints: [older, correction],
  });
  assert.deepEqual(resolved.appliedControlIds, [correction.id]);
  assert.deepEqual(resolved.supersededControlIds, [older.id]);
  const atStation = resolved.route.stations.filter(
    (station) => Math.abs(station.stationM - stationM) < 1e-6,
  );
  assert.equal(atStation.length, 1);
  assert.equal(atStation[0]!.groundElevationM, 106);
});

test("control points survive a geometry edit and are dropped from use only when off-route", () => {
  const base = demRoute();
  const control = createControlPoint({
    route: base,
    stationM: base.lengthM / 2,
    groundElevationM: 90,
    influenceRangeM: 50,
    sourceKind: "survey",
    source: "Test survey",
  });
  const withControl = { ...base, controlPoints: [control] };
  const extended = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32],
      [-96.97, 32],
    ]),
    previous: withControl,
  });
  assert.equal(extended.controlPoints?.length, 1);
  assert.equal(resolveRouteElevations(extended).appliedControlIds.length, 1);

  const moved = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32.01],
      [-96.98, 32.01],
    ]),
    previous: withControl,
  });
  const resolved = resolveRouteElevations(moved);
  assert.deepEqual(resolved.offRouteControlIds, [control.id]);
  assert.ok(resolved.route.stations.every((station) => !station.controlPointId));
});

test("without DEM, stations between manual controls are interpolated and labelled", () => {
  const base = { ...demRoute(), elevationSamples: [] };
  const start = createControlPoint({
    route: base,
    stationM: 0,
    groundElevationM: 50,
    influenceRangeM: 0,
    sourceKind: "manual",
    source: "Field notes",
  });
  const end = createControlPoint({
    route: base,
    stationM: base.lengthM,
    groundElevationM: 150,
    influenceRangeM: 0,
    sourceKind: "manual",
    source: "Field notes",
  });
  const { route } = resolveRouteElevations({ ...base, controlPoints: [start, end] });
  const middle = route.stations.find(
    (station) => !station.controlPointId && station.stationM > base.lengthM * 0.4,
  )!;
  assert.equal(middle.elevationProvenance, "interpolated");
  assert.ok(
    Math.abs(middle.groundElevationM! - (50 + (100 * middle.stationM) / base.lengthM)) < 0.5,
  );
  assert.equal(route.stations[0]!.elevationProvenance, "user");
});

test("burial depth lowers the pipe centerline but not the ground", () => {
  const { route } = resolveRouteElevations({ ...demRoute(), burialDepthM: 1.5 });
  assert.ok(
    route.stations.every(
      (station) => station.groundElevationM === 100 && station.pipelineElevationM === 98.5,
    ),
  );
});
