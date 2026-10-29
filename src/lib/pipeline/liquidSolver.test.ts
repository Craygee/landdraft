import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, LineString } from "geojson";
import { createPipelineComponent } from "./components.ts";
import { darcyFrictionFactor, interpolateProfile } from "./liquidSolver.ts";
import { solvePipeline } from "./solver.ts";
import {
  SYSTEM_FLUIDS,
  SYSTEM_PIPE_SPECIFICATIONS,
  createDefaultScenario,
  pipelineUnits,
  routeFromLineFeature,
} from "./model.ts";
import type { PipeSpecification, PipelineFluid, PipelineRoute } from "./types.ts";

const GRAVITY_MS2 = 9.80665;

function line(coordinates: number[][]): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

function routeWithElevations(elevationsM: number[]): PipelineRoute {
  const coordinates = elevationsM.map((_, index) => [-97 + index * 0.005, 32]);
  const route = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line(coordinates),
  });
  return {
    ...route,
    stations: route.stations.map((station, index) => ({
      ...station,
      groundElevationM: elevationsM[index]!,
      pipelineElevationM: elevationsM[index]!,
    })),
  };
}

const water = SYSTEM_FLUIDS.find((fluid) => fluid.id === "fluid-freshwater")!;
const steel12 = SYSTEM_PIPE_SPECIFICATIONS.find((pipe) => pipe.id === "pipe-steel-12")!;

function relativeError(actual: number, expected: number) {
  return Math.abs(actual - expected) / Math.abs(expected);
}

test("laminar friction factor is exactly 64/Re", () => {
  assert.equal(darcyFrictionFactor(1_000, 0.001), 0.064);
  assert.equal(darcyFrictionFactor(2_000, 0), 0.032);
});

test("Colebrook friction factor matches published Moody-chart reference points", () => {
  // Reference values from the implicit Colebrook-White equation, as tabulated in standard
  // fluid-mechanics texts: Re 1e5 at e/D 0.001 -> ~0.0222; Re 1e6 at e/D 0.0001 -> ~0.0134.
  assert.ok(relativeError(darcyFrictionFactor(1e5, 0.001), 0.0222) < 0.01);
  assert.ok(relativeError(darcyFrictionFactor(1e6, 0.0001), 0.0134) < 0.01);
  // Colebrook is satisfied by the returned factor to a tight residual.
  const f = darcyFrictionFactor(2e5, 0.0005);
  const residual = 1 / Math.sqrt(f) + 2 * Math.log10(0.0005 / 3.7 + 2.51 / (2e5 * Math.sqrt(f)));
  assert.ok(Math.abs(residual) < 1e-6);
});

test("laminar pressure drop matches the Hagen-Poiseuille solution", () => {
  const route = routeWithElevations([0, 0, 0]);
  const viscousOil: PipelineFluid = {
    id: "fluid-test-oil",
    name: "Test viscous oil",
    family: "liquid",
    kind: "custom-liquid",
    densityKgM3: 900,
    dynamicViscosityPaS: 0.5,
    source: "test",
  };
  const pipe: PipeSpecification = {
    ...steel12,
    id: "pipe-test-100mm",
    insideDiameterM: 0.1,
    confirmedAt: 1,
  };
  const flowM3S = 0.001;
  const scenario = {
    ...createDefaultScenario(route.id),
    flowM3S,
    limits: { ...createDefaultScenario(route.id).limits, minimumPressurePa: 0 },
  };
  const run = solvePipeline({ route, scenario, fluid: viscousOil, pipe, components: [] });
  const expectedDropPa =
    (128 * viscousOil.dynamicViscosityPaS! * route.lengthM * flowM3S) / (Math.PI * 0.1 ** 4);
  const actualDropPa = run.profile[0]!.pressurePa - run.profile.at(-1)!.pressurePa;
  assert.ok(run.profile[0]!.reynoldsNumber < 2_300);
  assert.ok(relativeError(actualDropPa, expectedDropPa) < 1e-9);
});

test("with no flow, pressure change equals static head only", () => {
  const route = routeWithElevations([0, 40, 100]);
  const scenario = { ...createDefaultScenario(route.id), flowM3S: 0 };
  const run = solvePipeline({ route, scenario, fluid: water, pipe: steel12, components: [] });
  const dropPa = run.profile[0]!.pressurePa - run.profile.at(-1)!.pressurePa;
  assert.ok(relativeError(dropPa, water.densityKgM3! * GRAVITY_MS2 * 100) < 1e-12);
  assert.equal(run.profile.at(-1)!.cumulativeFrictionLossPa, 0);
  // Hydraulic grade is constant along a static column.
  const grades = run.profile.map((point) => point.hydraulicGradeM!);
  assert.ok(Math.max(...grades) - Math.min(...grades) < 1e-9);
});

test("a pump is a step change: paired points, no interpolation across it", () => {
  const route = routeWithElevations([0, 0, 0, 0, 0]);
  const scenario = createDefaultScenario(route.id);
  const pumpStationM = route.lengthM * 0.6;
  const pump = createPipelineComponent({
    route,
    kind: "centrifugal-pump",
    stationM: pumpStationM,
    sequence: 1,
  });
  const boostPa = 200 * pipelineUnits.psiToPa;
  pump.properties["pressureBoostPa"] = boostPa;
  const run = solvePipeline({ route, scenario, fluid: water, pipe: steel12, components: [pump] });

  const pair = run.profile.filter((point) => Math.abs(point.stationM - pumpStationM) < 1e-6);
  assert.equal(pair.length, 2);
  assert.equal(pair[0]!.discontinuity, "upstream");
  assert.equal(pair[1]!.discontinuity, "downstream");
  assert.deepEqual(pair[1]!.componentIds, [pump.id]);
  assert.ok(Math.abs(pair[1]!.pressurePa - pair[0]!.pressurePa - boostPa) < 1e-6);

  // Just upstream of the pump the scrubbed pressure follows the friction gradient only. The old
  // behaviour blended part of the boost into the pipe upstream of the pump.
  const justBefore = interpolateProfile(run.profile, pumpStationM - 1)!;
  const gradientPaPerM = pair[0]!.pressureLossPaPerM;
  assert.ok(Math.abs(justBefore.pressurePa - (pair[0]!.pressurePa + gradientPaPerM)) < 1e-6);
  assert.equal(justBefore.discontinuity, undefined);
  assert.equal(justBefore.provenance, "interpolated");

  const justAfter = interpolateProfile(run.profile, pumpStationM + 1)!;
  assert.ok(Math.abs(justAfter.pressurePa - (pair[1]!.pressurePa - gradientPaPerM)) < 1e-6);

  const atPump = interpolateProfile(run.profile, pair[1]!.stationM)!;
  assert.equal(atPump.discontinuity, "downstream");
});

test("a valve loss at a vertex station is applied once, as a step", () => {
  const route = routeWithElevations([0, 0, 0]);
  const scenario = createDefaultScenario(route.id);
  const valve = createPipelineComponent({
    route,
    kind: "block-valve",
    stationM: route.stations[1]!.stationM,
    sequence: 1,
  });
  const run = solvePipeline({ route, scenario, fluid: water, pipe: steel12, components: [valve] });
  const pair = run.profile.filter((point) => point.componentIds?.includes(valve.id));
  assert.equal(pair.length, 2);
  const velocity = pair[0]!.velocityMS;
  const expectedLossPa = (0.2 * (water.densityKgM3! * velocity ** 2)) / 2;
  assert.ok(Math.abs(pair[0]!.pressurePa - pair[1]!.pressurePa - expectedLossPa) < 1e-6);
  assert.ok(Math.abs(run.profile.at(-1)!.cumulativeMinorLossPa - expectedLossPa) < 1e-6);
});

test("exceeding MAOP or the delivery minimum reports limit-exceeded, not warning", () => {
  const route = routeWithElevations([0, 0, 0]);
  const base = createDefaultScenario(route.id);
  const overMaop = {
    ...base,
    inletPressurePa: base.limits.maopPa + 50 * pipelineUnits.psiToPa,
  };
  const run = solvePipeline({
    route,
    scenario: overMaop,
    fluid: water,
    pipe: steel12,
    components: [],
  });
  assert.equal(run.status, "limit-exceeded");
  const ids = run.findings.map((finding) => finding.id);
  assert.equal(new Set(ids).size, ids.length);

  const elevationOnly = solvePipeline({
    route,
    scenario: base,
    fluid: water,
    pipe: { ...steel12, confirmedAt: 1 },
    components: [],
  });
  assert.equal(elevationOnly.status, "solved");
});

test("gas is refused rather than routed through the liquid solver", () => {
  const route = routeWithElevations([0, 0]);
  const scenario = { ...createDefaultScenario(route.id), fluidId: "fluid-natural-gas" };
  const gas = SYSTEM_FLUIDS.find((fluid) => fluid.id === "fluid-natural-gas")!;
  const run = solvePipeline({ route, scenario, fluid: gas, pipe: steel12, components: [] });
  assert.equal(run.status, "unsupported");
  assert.equal(run.profile.length, 0);
  assert.equal(run.findings[0]!.code, "ADVANCED_ANALYSIS_REQUIRED");
});
