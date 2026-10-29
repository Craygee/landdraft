import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, LineString, Polygon } from "geojson";
import { createPipelineComponent } from "./components.ts";
import {
  createConstructionRange,
  createManualCrossing,
  estimateRockQuantity,
  reprojectConstructionRanges,
  reprojectCrossings,
  resolveConstructionIntervals,
  trenchDepthM,
} from "./constructability.ts";
import {
  buildPreliminaryTakeoff,
  calculatePreliminaryEstimate,
  currentRate,
  recalculateScenarioEstimate,
} from "./estimating.ts";
import {
  SYSTEM_PIPE_SPECIFICATIONS,
  createDefaultScenario,
  emptyPipelineEngineeringState,
  routeFromLineFeature,
} from "./model.ts";
import {
  facilitySitingFindings,
  geometryFingerprint,
  resolveLandPermissionGeometry,
} from "./siting.ts";
import type { LandFacilityPermission, PipelineRoute, PriceSnapshot } from "./types.ts";

function line(coordinates: number[][]): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

function route(): PipelineRoute {
  return {
    ...routeFromLineFeature({
      layerId: "routes",
      layerName: "Routes",
      featureIndex: 0,
      feature: line([
        [-97, 32],
        [-96.98, 32],
      ]),
    }),
    burialDepthM: 1.2,
    trench: { trenchWidthM: 1, beddingBelowPipeM: 0.15 },
  };
}

const pipe = SYSTEM_PIPE_SPECIFICATIONS.find((item) => item.id === "pipe-steel-12")!;

test("construction evidence precedence: field > user > mapped > estimated > default", () => {
  const base = route();
  const mapped = createConstructionRange({
    route: base,
    startStationM: 0,
    endStationM: 1_000,
    method: "open-trench",
    conditions: ["rock"],
    evidence: "provider-mapped",
  });
  const userSaysSoil = createConstructionRange({
    route: base,
    startStationM: 200,
    endStationM: 400,
    method: "open-trench",
    conditions: ["normal-soil"],
    evidence: "user-confirmed",
  });
  // An estimate entered later must not override the stronger user confirmation.
  const laterEstimate = createConstructionRange({
    route: base,
    startStationM: 300,
    endStationM: 600,
    method: "open-trench",
    conditions: ["rock"],
    evidence: "model-estimated",
  });
  const intervals = resolveConstructionIntervals({
    ...base,
    constructionRanges: [mapped, userSaysSoil, laterEstimate],
  });
  const at = (stationM: number) =>
    intervals.find((item) => item.startStationM <= stationM && item.endStationM > stationM)!;
  assert.equal(at(100).evidence, "provider-mapped");
  assert.deepEqual(at(350).conditions, ["normal-soil"]);
  assert.equal(at(350).evidence, "user-confirmed");
  assert.equal(at(500).evidence, "provider-mapped");
  assert.equal(at(1_500).evidence, "default");
  assert.equal(intervals[0]!.startStationM, 0);
  assert.equal(intervals.at(-1)!.endStationM, base.lengthM);
});

test("rock volume = affected length × trench width × trench depth, plus a separate allowance", () => {
  const base = route();
  const rockRange = createConstructionRange({
    route: base,
    startStationM: 100,
    endStationM: 400,
    method: "open-trench",
    conditions: ["rock"],
    evidence: "field-confirmed",
  });
  const withRock = {
    ...base,
    constructionRanges: [rockRange],
    trench: { ...base.trench, rockAllowancePercent: 10 },
  };
  const depth = trenchDepthM(withRock, pipe);
  assert.ok(Math.abs(depth - (1.2 + pipe.outsideDiameterM / 2 + 0.15)) < 1e-12);
  const rock = estimateRockQuantity(withRock, pipe);
  assert.ok(Math.abs(rock.rangedVolumeM3 - 300 * 1 * depth) < 1e-9);
  assert.equal(rock.strongestEvidence, "field-confirmed");
  assert.ok(
    Math.abs(rock.allowanceVolumeM3 - ((base.lengthM - 300) * 1 * depth * 10) / 100) < 1e-6,
  );
});

test("HDD and bore intervals are excluded from trench and rock quantities", () => {
  const base = route();
  const hdd = createConstructionRange({
    route: base,
    startStationM: 0,
    endStationM: 500,
    method: "hdd",
    conditions: ["rock"],
    evidence: "user-confirmed",
  });
  const rock = estimateRockQuantity({ ...base, constructionRanges: [hdd] }, pipe);
  assert.equal(rock.rangedVolumeM3, 0);
  const takeoff = buildPreliminaryTakeoff(
    { ...base, constructionRanges: [hdd] },
    createDefaultScenario(base.id),
    pipe,
  );
  const trench = takeoff.items.find((item) => item.key === "earthwork:trench-length")!;
  assert.ok(Math.abs(trench.quantity - (base.lengthM - 500)) < 1e-6);
  assert.ok(trench.sourceIds.includes(base.id));
});

test("crossings stay with their location through edits and lose confirmation when off-route", () => {
  const base = route();
  const crossing = createManualCrossing({
    route: base,
    type: "railroad",
    stationM: 1_000,
    crossingLengthM: 30,
  });
  assert.equal(crossing.constructionMethod, "casing");
  assert.equal(crossing.confirmation, "confirmed");
  const extended = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97.01, 32],
      [-96.98, 32],
    ]),
    previous: { ...base, crossings: [crossing] },
  });
  const kept = reprojectCrossings(extended).crossings[0]!;
  assert.ok(Math.abs(kept.stationM - (crossing.stationM + 944.6)) < 2);
  assert.equal(kept.confirmation, "confirmed");

  const rerouted = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32.01],
      [-96.98, 32.01],
    ]),
    previous: { ...base, crossings: [crossing] },
  });
  assert.equal(reprojectCrossings(rerouted).crossings[0]!.confirmation, "unreviewed");
});

test("construction ranges retain geographic anchors and require review when rerouted", () => {
  const base = route();
  const range = createConstructionRange({
    route: base,
    startStationM: 400,
    endStationM: 800,
    method: "open-trench",
    conditions: ["rock"],
    evidence: "field-confirmed",
  });
  const extended = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97.01, 32],
      [-96.98, 32],
    ]),
    previous: { ...base, constructionRanges: [range] },
  });
  const kept = reprojectConstructionRanges(base, extended).constructionRanges[0]!;
  assert.ok(kept.startStationM > range.startStationM + 900);
  assert.ok(kept.endStationM > range.endStationM + 900);
  assert.equal(kept.placementReview, undefined);

  const rerouted = routeFromLineFeature({
    layerId: "routes",
    layerName: "Routes",
    featureIndex: 0,
    feature: line([
      [-97, 32.01],
      [-96.98, 32.01],
    ]),
    previous: { ...base, constructionRanges: [range] },
  });
  const moved = reprojectConstructionRanges(base, rerouted).constructionRanges[0]!;
  assert.ok((moved.placementReview?.movedM ?? 0) > 1_000);
  const movedRoute = { ...rerouted, constructionRanges: [moved] };
  const scenario = createDefaultScenario(movedRoute.id);
  const estimate = calculatePreliminaryEstimate(
    movedRoute,
    scenario,
    buildPreliminaryTakeoff(movedRoute, scenario, pipe),
  );
  assert.ok(estimate.warnings.some((warning) => warning.includes("requires confirmation")));
});

test("every takeoff item traces to the route and the snapshot to its geometry revision", () => {
  const base = route();
  const pump = createPipelineComponent({
    route: base,
    kind: "centrifugal-pump",
    stationM: 500,
    sequence: 1,
  });
  const crossing = createManualCrossing({
    route: base,
    type: "highway",
    stationM: 800,
    crossingLengthM: 60,
  });
  const takeoff = buildPreliminaryTakeoff(
    { ...base, crossings: [crossing] },
    createDefaultScenario(base.id),
    pipe,
    [pump],
  );
  assert.equal(takeoff.geometryRevision, base.geometryRevision);
  assert.ok(takeoff.items.every((item) => item.sourceIds.includes(base.id) && item.key));
  assert.ok(
    takeoff.items
      .find((item) => item.key === "component:centrifugal-pump")!
      .sourceIds.includes(pump.id),
  );
  const bore = takeoff.items.find((item) => item.key === "crossing-method:bore")!;
  assert.equal(bore.quantity, 60);
  assert.ok(bore.sourceIds.includes(crossing.id));
});

test("the estimate is a ledger: unpriced items stay null and corrections add snapshots", () => {
  const base = route();
  const scenario = createDefaultScenario(base.id);
  const takeoff = buildPreliminaryTakeoff(base, scenario, pipe);
  const pipeItem = takeoff.items.find((item) => item.key === `pipe:${pipe.id}`)!;
  const first: PriceSnapshot = {
    id: "price-1",
    productKey: pipeItem.key!,
    productDescription: pipe.name,
    unitPrice: 100,
    unit: "m",
    currency: "USD",
    retrievedAt: 1,
    source: "Budget allowance entered by estimator",
    evidenceClass: "budget-allowance",
    confidence: "low",
  };
  const correction: PriceSnapshot = { ...first, id: "price-2", unitPrice: 120, retrievedAt: 2 };
  assert.equal(currentRate([first, correction], first.productKey, "m")!.id, "price-2");

  const estimate = calculatePreliminaryEstimate(base, scenario, takeoff, [first, correction]);
  const pipeLine = estimate.lines!.find((line) => line.quantityItemId === pipeItem.id)!;
  assert.equal(pipeLine.priceSnapshotId, "price-2");
  assert.ok(Math.abs(pipeLine.amount! - pipeItem.quantity * 120) < 1e-6);
  const unpriced = estimate.lines!.filter(
    (line) => line.kind === "quantity" && line.amount === null,
  );
  assert.equal(estimate.unpricedCount, unpriced.length);
  assert.ok(unpriced.length > 0);
  const expectedSubtotal = pipeItem.quantity * 120;
  assert.ok(Math.abs(estimate.subtotal! - expectedSubtotal) < 1e-6);
  assert.ok(
    Math.abs(
      estimate.recommendedBid! -
        expectedSubtotal *
          (1 + scenario.estimateAssumptions.contingencyPercent / 100) *
          (1 + scenario.estimateAssumptions.markupPercent / 100),
    ) < 1e-6,
  );
  // Re-running against the same takeoff and snapshots reproduces the total exactly.
  const again = calculatePreliminaryEstimate(base, scenario, takeoff, [correction, first]);
  assert.equal(again.recommendedBid, estimate.recommendedBid);
});

test("estimate-only scenario changes recalculate the current total immediately", () => {
  const base = route();
  const scenario = createDefaultScenario(base.id);
  const takeoff = buildPreliminaryTakeoff(base, scenario, pipe);
  const state = {
    ...emptyPipelineEngineeringState(),
    routes: [base],
    scenarios: [scenario],
    quantitySnapshots: [takeoff],
  };
  const original = recalculateScenarioEstimate(state, scenario)!;
  const changedScenario = {
    ...scenario,
    estimateAssumptions: {
      ...scenario.estimateAssumptions,
      installationPerM: 50,
      contingencyPercent: 25,
      markupPercent: 0,
    },
  };
  const changed = recalculateScenarioEstimate(state, changedScenario)!;
  assert.notEqual(changed.recommendedBid, original.recommendedBid);
  assert.equal(
    changed.installationCost,
    base.lengthM * changedScenario.estimateAssumptions.installationPerM,
  );
  assert.equal(changed.markup, 0);
});

test("facility siting: tagged land is a hard constraint, untagged land imposes nothing", () => {
  const base = route();
  const pump = createPipelineComponent({
    route: base,
    kind: "centrifugal-pump",
    stationM: 500,
    sequence: 1,
  });
  const valve = createPipelineComponent({
    route: base,
    kind: "block-valve",
    stationM: 500,
    sequence: 1,
  });
  const parcel: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [-97.0, 31.99],
        [-96.99, 31.99],
        [-96.99, 32.01],
        [-97.0, 32.01],
        [-97.0, 31.99],
      ],
    ],
  };
  const meterOnly: LandFacilityPermission = {
    id: "perm-1",
    layerId: "parcels",
    featureIndex: 0,
    label: "Parcel 12",
    noFacilities: false,
    allowed: ["meter", "aboveground"],
    updatedAt: 0,
  };
  const findings = facilitySitingFindings([pump, valve], [meterOnly], () => parcel);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "blocker");
  assert.equal(findings[0]!.code, "FACILITY_NOT_PERMITTED");
  assert.equal(
    facilitySitingFindings([pump], [{ ...meterOnly, allowed: ["pump"] }], () => parcel).length,
    0,
  );
  assert.equal(
    facilitySitingFindings(
      [pump],
      [{ ...meterOnly, allowed: ["pump"], noFacilities: true }],
      () => parcel,
    ).length,
    1,
  );
  const unresolved = facilitySitingFindings([pump], [meterOnly], () => undefined);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0]!.code, "FACILITY_SITING_REFERENCE_MISSING");
});

test("land siting rules follow stable feature identity instead of mutable array order", () => {
  const first: Feature<Polygon> = {
    type: "Feature",
    id: "parcel-a",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-97, 32],
          [-96.99, 32],
          [-96.99, 32.01],
          [-97, 32.01],
          [-97, 32],
        ],
      ],
    },
  };
  const second: Feature<Polygon> = {
    ...first,
    id: "parcel-b",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-98, 33],
          [-97.99, 33],
          [-97.99, 33.01],
          [-98, 33.01],
          [-98, 33],
        ],
      ],
    },
  };
  const permission: LandFacilityPermission = {
    id: "stable-permission",
    layerId: "parcels",
    featureId: "parcel-a",
    geometryHash: geometryFingerprint(first.geometry),
    featureIndex: 0,
    label: "Parcel A",
    noFacilities: true,
    allowed: [],
    updatedAt: 0,
  };
  assert.deepEqual(resolveLandPermissionGeometry(permission, [second, first]), first.geometry);
  assert.equal(resolveLandPermissionGeometry(permission, [second]), undefined);
  const { featureId: _featureId, geometryHash: _geometryHash, ...legacy } = permission;
  assert.equal(resolveLandPermissionGeometry(legacy, [first]), undefined);
});
