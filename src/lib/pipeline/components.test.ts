import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, LineString } from "geojson";
import {
  COMPONENT_REVIEW_DISTANCE_M,
  createPipelineComponent,
  moveComponentToStation,
  projectOntoRoute,
  reprojectRouteComponents,
} from "./components.ts";
import { solvePipeline } from "./solver.ts";
import {
  SYSTEM_FLUIDS,
  SYSTEM_PIPE_SPECIFICATIONS,
  createDefaultScenario,
  pipelineUnits,
  routeFromLineFeature,
} from "./model.ts";

function line(coordinates: number[][]): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

function flatRoute() {
  const route = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32],
      [-96.99, 32],
    ]),
  });
  return {
    ...route,
    stations: route.stations.map((station) => ({
      ...station,
      groundElevationM: 100,
      pipelineElevationM: 100,
    })),
  };
}

test("pipeline components are created on the route at the selected station", () => {
  const route = flatRoute();
  const component = createPipelineComponent({
    route,
    kind: "block-valve",
    stationM: route.lengthM / 2,
    sequence: 1,
  });
  assert.equal(component.routeId, route.id);
  assert.equal(component.kind, "block-valve");
  assert.equal(component.properties["minorLossK"], 0.2);
  assert.ok(Math.abs(component.stationM - route.lengthM / 2) < 0.001);
});

function editRoute(route: ReturnType<typeof flatRoute>, coordinates: number[][]) {
  return routeFromLineFeature({
    layerId: route.sourceLayerId,
    layerName: "Routes",
    featureIndex: route.sourceFeatureIndex,
    feature: line(coordinates),
    previous: route,
  });
}

test("extending a route keeps components at their placed location", () => {
  const route = flatRoute();
  const meter = createPipelineComponent({
    route,
    kind: "flow-meter",
    stationM: route.lengthM * 0.25,
    sequence: 1,
  });
  const destination = createPipelineComponent({
    route,
    kind: "destination",
    stationM: route.lengthM,
    sequence: 1,
  });
  const edited = editRoute(route, [
    [-97, 32],
    [-96.98, 32],
  ]);
  const [movedMeter, movedDestination] = reprojectRouteComponents(
    [meter, destination],
    route,
    edited,
  );
  // The old fraction-based logic slid the meter to 25% of the new, doubled length.
  assert.ok(Math.abs(movedMeter!.stationM - meter.stationM) < 0.5);
  assert.equal(movedMeter!.placementReview, undefined);
  // A destination at the route end follows the end.
  assert.equal(movedDestination!.stationM, edited.lengthM);
  assert.equal(movedDestination!.placementReview, undefined);
});

test("a route edit that moves a component away from its location flags it for review", () => {
  const route = flatRoute();
  const valve = createPipelineComponent({
    route,
    kind: "block-valve",
    stationM: route.lengthM / 2,
    sequence: 1,
  });
  // Reroute the line about 220 m north of the valve.
  const edited = editRoute(route, [
    [-97, 32.002],
    [-96.99, 32.002],
  ]);
  const [moved] = reprojectRouteComponents([valve], route, edited);
  assert.ok(moved!.placementReview);
  assert.ok(moved!.placementReview!.movedM > COMPONENT_REVIEW_DISTANCE_M);
  assert.equal(moved!.placementReview!.previousStationM, valve.stationM);

  const run = solvePipeline({
    route: edited,
    scenario: createDefaultScenario(edited.id),
    fluid: SYSTEM_FLUIDS[0]!,
    pipe: SYSTEM_PIPE_SPECIFICATIONS[0]!,
    components: [moved!],
  });
  assert.ok(run.findings.some((finding) => finding.code.startsWith("COMPONENT_PLACEMENT_REVIEW")));

  const confirmed = moveComponentToStation(moved!, edited, edited.lengthM / 3);
  assert.equal(confirmed.placementReview, undefined);
  assert.ok(Math.abs(confirmed.stationM - edited.lengthM / 3) < 1e-9);
});

test("projection onto the route returns station and perpendicular offset", () => {
  const route = flatRoute();
  const { stationM, offsetM } = projectOntoRoute(route, [-96.995, 32.001]);
  assert.ok(Math.abs(stationM - route.lengthM / 2) < 1);
  assert.ok(Math.abs(offsetM - 111.2) < 1);
});

test("a configured pump is inserted into the profile and increases downstream pressure", () => {
  const route = flatRoute();
  const scenario = { ...createDefaultScenario(route.id), flowM3S: 0 };
  const pump = createPipelineComponent({
    route,
    kind: "centrifugal-pump",
    stationM: route.lengthM / 2,
    sequence: 1,
  });
  pump.properties["pressureBoostPa"] = 100 * pipelineUnits.psiToPa;
  const run = solvePipeline({
    route,
    scenario,
    fluid: SYSTEM_FLUIDS.find((fluid) => fluid.id === scenario.fluidId)!,
    pipe: SYSTEM_PIPE_SPECIFICATIONS.find((pipe) => pipe.id === scenario.pipeSpecificationId)!,
    components: [pump],
  });
  assert.notEqual(run.status, "unsupported");
  assert.ok(run.profile.some((point) => Math.abs(point.stationM - pump.stationM) < 0.001));
  const pressureGainPsi =
    (run.profile.at(-1)!.pressurePa - run.profile[0]!.pressurePa) * pipelineUnits.paToPsi;
  assert.ok(Math.abs(pressureGainPsi - 100) < 0.001);
});
