import {
  estimateRockQuantity,
  resolveConstructionIntervals,
  trenchAssumptions,
  trenchDepthM,
} from "./constructability.ts";
import type {
  ConstructionMethod,
  EstimateLine,
  PipeSpecification,
  PipelineComponent,
  PipelineEngineeringState,
  PipelineEstimateSummary,
  PipelineRoute,
  PipelineScenario,
  PriceSnapshot,
  QuantityTakeoffItem,
  QuantityTakeoffSnapshot,
} from "./types.ts";

const uid = () => Math.random().toString(36).slice(2, 10);
const TRENCHED_METHODS: ConstructionMethod[] = ["open-trench", "existing-corridor"];
const SPECIAL_CROSSING_METHODS: ConstructionMethod[] = ["bore", "hdd", "casing"];

export function buildPreliminaryTakeoff(
  route: PipelineRoute,
  scenario: PipelineScenario,
  pipe: PipeSpecification,
  components: PipelineComponent[] = [],
): QuantityTakeoffSnapshot {
  const standardLengthM = pipe.standardLengthM ?? 12.192;
  const trench = trenchAssumptions(route);
  const base = { routeId: route.id, scenarioId: scenario.id };
  const items: QuantityTakeoffItem[] = [
    {
      id: `qto-pipe-${uid()}`,
      key: `pipe:${pipe.id}`,
      category: "pipe",
      description: `${pipe.name} pipe`,
      quantity: route.lengthM,
      unit: "m",
      formulaVersion: "route-length-v1",
      ...base,
      sourceIds: [route.id, pipe.id],
      startStationM: 0,
      endStationM: route.lengthM,
    },
    {
      id: `qto-joints-${uid()}`,
      key: `joints:${pipe.id}`,
      category: "pipe",
      description: "Estimated field joints",
      quantity: Math.max(0, Math.ceil(route.lengthM / standardLengthM) - 1),
      unit: "each",
      formulaVersion: "standard-length-joints-v1",
      ...base,
      sourceIds: [route.id, pipe.id],
      assumption: `Standard pipe length ${standardLengthM.toFixed(3)} m; confirm lay lengths and fittings.`,
    },
  ];

  if (trench.clearingWidthM !== undefined && trench.clearingWidthM > 0)
    items.push({
      id: `qto-clearing-${uid()}`,
      key: "clearing:area",
      category: "clearing-row",
      description: "Clearing / ROW area",
      quantity: route.lengthM * trench.clearingWidthM,
      unit: "m²",
      formulaVersion: "route-length-x-clearing-width-v1",
      ...base,
      sourceIds: [route.id],
      startStationM: 0,
      endStationM: route.lengthM,
      assumption: `Clearing width ${trench.clearingWidthM.toFixed(1)} m over the full route.`,
    });
  else
    items.push({
      id: `qto-clearing-${uid()}`,
      key: "clearing:length",
      category: "clearing-row",
      description: "Route/ROW length",
      quantity: route.lengthM,
      unit: "m",
      formulaVersion: "route-length-v1",
      ...base,
      sourceIds: [route.id],
      assumption: "Clearing width is not defined; this item reports length only.",
    });

  // Earthwork over trenched intervals. Each interval keeps the ranges that set its method.
  const intervals = resolveConstructionIntervals(route).filter((interval) =>
    TRENCHED_METHODS.includes(interval.method),
  );
  const trenchedLengthM = intervals.reduce(
    (sum, interval) => sum + interval.endStationM - interval.startStationM,
    0,
  );
  if (trenchedLengthM > 0) {
    const depthM = trenchDepthM(route, pipe);
    const rangeIds = Array.from(new Set(intervals.flatMap((interval) => interval.rangeIds)));
    const earthworkSources = [route.id, pipe.id, ...rangeIds];
    const excavationM3 = trenchedLengthM * trench.trenchWidthM * depthM;
    const beddingM3 = trenchedLengthM * trench.trenchWidthM * trench.beddingBelowPipeM;
    const pipeDisplacementM3 = (trenchedLengthM * Math.PI * pipe.outsideDiameterM ** 2) / 4;
    const trenchBasis = `Trench ${trench.trenchWidthM.toFixed(2)} m wide × ${depthM.toFixed(2)} m deep (burial ${(route.burialDepthM ?? 0).toFixed(2)} m + ½ OD + ${trench.beddingBelowPipeM.toFixed(2)} m bedding).`;
    items.push(
      {
        id: `qto-trench-${uid()}`,
        key: "earthwork:trench-length",
        category: "earthwork",
        description: "Trench length",
        quantity: trenchedLengthM,
        unit: "m",
        formulaVersion: "trenched-intervals-v1",
        ...base,
        sourceIds: earthworkSources,
        assumption: "Open-trench and existing-corridor intervals only.",
      },
      {
        id: `qto-excavation-${uid()}`,
        key: "earthwork:excavation",
        category: "earthwork",
        description: "Trench excavation (all material)",
        quantity: excavationM3,
        unit: "m³",
        formulaVersion: "rectangular-trench-v1",
        ...base,
        sourceIds: earthworkSources,
        assumption: `${trenchBasis} Vertical walls; no sloping or shoring allowance.`,
      },
      {
        id: `qto-bedding-${uid()}`,
        key: "earthwork:bedding",
        category: "earthwork",
        description: "Bedding below pipe",
        quantity: beddingM3,
        unit: "m³",
        formulaVersion: "bedding-below-pipe-v1",
        ...base,
        sourceIds: earthworkSources,
      },
      {
        id: `qto-backfill-${uid()}`,
        key: "earthwork:backfill",
        category: "earthwork",
        description: "Backfill",
        quantity: Math.max(0, excavationM3 - beddingM3 - pipeDisplacementM3),
        unit: "m³",
        formulaVersion: "excavation-less-bedding-and-pipe-v1",
        ...base,
        sourceIds: earthworkSources,
        assumption: "Excavation less bedding and pipe displacement; no swell or compaction factor.",
      },
    );
  }

  const rock = estimateRockQuantity(route, pipe);
  if (rock.rangedVolumeM3 > 0)
    items.push({
      id: `qto-rock-ranged-${uid()}`,
      key: "earthwork:rock-ranged",
      category: "earthwork",
      description: "Rock excavation — station ranges",
      quantity: rock.rangedVolumeM3,
      unit: "m³",
      formulaVersion: "rock-range-trench-section-v1",
      ...base,
      sourceIds: [route.id, pipe.id, ...rock.rangeIds],
      assumption: `${rock.rangedLengthM.toFixed(0)} m of trench marked rock; strongest evidence: ${rock.strongestEvidence}. ${trench.blastingPermitted ? "Blasting marked as permitted." : "Blasting not permitted; mechanical removal assumed."}`,
    });
  if (rock.allowanceVolumeM3 > 0)
    items.push({
      id: `qto-rock-allowance-${uid()}`,
      key: "earthwork:rock-allowance",
      category: "earthwork",
      description: "Rock excavation — percentage allowance",
      quantity: rock.allowanceVolumeM3,
      unit: "m³",
      formulaVersion: "rock-percent-allowance-v1",
      ...base,
      sourceIds: [route.id, pipe.id],
      assumption: `${rock.allowancePercent}% of ${rock.allowanceBasisLengthM.toFixed(0)} m trenched length outside rock ranges. Estimate only; not geotechnical evidence.`,
    });

  // Facilities and inline components, counted by kind.
  const byKind = new Map<string, PipelineComponent[]>();
  for (const component of components.filter((item) => item.routeId === route.id))
    byKind.set(component.kind, [...(byKind.get(component.kind) ?? []), component]);
  for (const [kind, group] of byKind)
    items.push({
      id: `qto-component-${kind}-${uid()}`,
      key: `component:${kind}`,
      category: "facility",
      description: `${kind.replaceAll("-", " ")}`,
      quantity: group.length,
      unit: "each",
      formulaVersion: "component-count-v1",
      ...base,
      sourceIds: [route.id, ...group.map((component) => component.id)],
    });

  // Crossings: one count per accepted crossing plus special-construction length by method.
  const crossings = route.crossings.filter((crossing) => crossing.confirmation !== "rejected");
  for (const crossing of crossings)
    items.push({
      id: `qto-crossing-${crossing.id}`,
      key: `crossing:${crossing.type}`,
      category: "crossing",
      description: `${crossing.type.replaceAll("-", " ")} crossing`,
      quantity: 1,
      unit: "each",
      formulaVersion: "crossing-count-v2",
      ...base,
      sourceIds: [route.id, crossing.id],
      startStationM: crossing.stationM,
      endStationM: crossing.stationM,
      assumption: `${crossing.confirmation}; ${crossing.confidence} confidence; source: ${crossing.source}`,
    });
  for (const method of SPECIAL_CROSSING_METHODS) {
    const group = crossings.filter(
      (crossing) => crossing.constructionMethod === method && (crossing.crossingLengthM ?? 0) > 0,
    );
    if (!group.length) continue;
    items.push({
      id: `qto-crossing-${method}-${uid()}`,
      key: `crossing-method:${method}`,
      category: "crossing",
      description: `${method.toUpperCase()} length at crossings`,
      quantity: group.reduce((sum, crossing) => sum + (crossing.crossingLengthM ?? 0), 0),
      unit: "m",
      formulaVersion: "crossing-special-length-v1",
      ...base,
      sourceIds: [route.id, ...group.map((crossing) => crossing.id)],
    });
  }

  items.push({
    id: `qto-hydrotest-${uid()}`,
    key: "testing:hydrotest-water",
    category: "testing",
    description: "Hydrotest fill water",
    quantity: (route.lengthM * Math.PI * pipe.insideDiameterM ** 2) / 4,
    unit: "m³",
    formulaVersion: "pipe-internal-volume-v1",
    ...base,
    sourceIds: [route.id, pipe.id],
    assumption: "Internal pipe volume only; excludes fill losses, flushing and disposal.",
  });

  return {
    id: `qto-${uid()}`,
    scenarioId: scenario.id,
    geometryRevision: route.geometryRevision,
    createdAt: Date.now(),
    items,
  };
}

/** The newest snapshot for a rate key and unit. Older snapshots are never edited or removed. */
export function currentRate(
  snapshots: PriceSnapshot[],
  key: string,
  unit: string,
): PriceSnapshot | undefined {
  return snapshots
    .filter((snapshot) => snapshot.productKey === key && snapshot.unit === unit)
    .sort((a, b) => b.retrievedAt - a.retrievedAt)[0];
}

/** Reprices the current scenario immediately when estimate-only assumptions change. */
export function recalculateScenarioEstimate(
  state: PipelineEngineeringState,
  scenario: PipelineScenario,
): PipelineEstimateSummary | undefined {
  const route = state.routes.find((item) => item.id === scenario.routeId);
  if (!route) return undefined;
  const takeoff = state.quantitySnapshots.find(
    (item) => item.scenarioId === scenario.id && item.geometryRevision === route.geometryRevision,
  );
  return calculatePreliminaryEstimate(route, scenario, takeoff, state.priceSnapshots);
}

/**
 * The estimate is a ledger: one line per takeoff quantity × its current rate snapshot, followed by
 * contingency and markup rows. A quantity without a rate stays unpriced (never $0). The scenario's
 * legacy per-metre allowances still price pipe and installation when no snapshot exists for them.
 */
export function calculatePreliminaryEstimate(
  route: PipelineRoute,
  scenario: PipelineScenario,
  takeoff?: QuantityTakeoffSnapshot,
  priceSnapshots: PriceSnapshot[] = [],
): PipelineEstimateSummary {
  const assumptions = scenario.estimateAssumptions;
  const lines: EstimateLine[] = [];
  for (const item of takeoff?.items ?? []) {
    const key = item.key ?? item.id;
    const rate = currentRate(priceSnapshots, key, item.unit);
    const legacy =
      !rate && item.category === "pipe" && item.unit === "m" && key.startsWith("pipe:")
        ? assumptions.pipeMaterialPerM
        : undefined;
    lines.push({
      id: `line-${item.id}`,
      kind: "quantity",
      description: item.description,
      quantityItemId: item.id,
      rateKey: key,
      quantity: item.quantity,
      unit: item.unit,
      unitRate: rate?.unitPrice ?? legacy ?? null,
      amount:
        rate !== undefined
          ? item.quantity * rate.unitPrice
          : legacy !== undefined
            ? item.quantity * legacy
            : null,
      ...(rate ? { priceSnapshotId: rate.id } : {}),
      evidenceClass:
        rate?.evidenceClass ?? (legacy !== undefined ? assumptions.evidenceClass : null),
    });
  }
  if (assumptions.installationPerM !== undefined)
    lines.push({
      id: "line-installation-allowance",
      kind: "allowance",
      description: "Installation allowance (per route length)",
      quantity: route.lengthM,
      unit: "m",
      unitRate: assumptions.installationPerM,
      amount: route.lengthM * assumptions.installationPerM,
      evidenceClass: assumptions.evidenceClass,
    });

  const priced = lines.filter((line) => line.amount !== null);
  const unpricedCount = lines.length - priced.length;
  const subtotal = priced.length ? priced.reduce((sum, line) => sum + line.amount!, 0) : null;
  const contingency = subtotal === null ? null : (subtotal * assumptions.contingencyPercent) / 100;
  const beforeMarkup = subtotal === null || contingency === null ? null : subtotal + contingency;
  const markup = beforeMarkup === null ? null : (beforeMarkup * assumptions.markupPercent) / 100;
  const indicatedTotal = beforeMarkup === null || markup === null ? null : beforeMarkup + markup;
  if (contingency !== null)
    lines.push({
      id: "line-contingency",
      kind: "contingency",
      description: `Contingency ${assumptions.contingencyPercent}% of priced subtotal`,
      quantity: null,
      unit: "%",
      unitRate: assumptions.contingencyPercent,
      amount: contingency,
      evidenceClass: null,
    });
  if (markup !== null)
    lines.push({
      id: "line-markup",
      kind: "markup",
      description: `Markup ${assumptions.markupPercent}% after contingency`,
      quantity: null,
      unit: "%",
      unitRate: assumptions.markupPercent,
      amount: markup,
      evidenceClass: null,
    });

  const materialLine = lines.find((line) => line.rateKey?.startsWith("pipe:"));
  const warnings: string[] = [];
  const rangesNeedingReview = route.constructionRanges.filter(
    (range) => range.placementReview,
  ).length;
  if (rangesNeedingReview)
    warnings.push(
      `${rangesNeedingReview} construction range${rangesNeedingReview === 1 ? " requires" : "s require"} confirmation after a route edit. Quantities remain preliminary until reviewed.`,
    );
  if (unpricedCount)
    warnings.push(
      `${unpricedCount} quantit${unpricedCount === 1 ? "y has" : "ies have"} no rate and are excluded from the total.`,
    );
  if (!takeoff) warnings.push("Run the model to create a quantity takeoff.");
  warnings.push(
    "Labor productivity, freight, indirects, escalation, tax, bond and insurance are not modeled yet.",
  );
  return {
    scenarioId: scenario.id,
    currency: assumptions.currency,
    materialCost: materialLine?.amount ?? null,
    installationCost:
      lines.find((line) => line.id === "line-installation-allowance")?.amount ?? null,
    subtotal,
    contingency,
    markup,
    recommendedBid: indicatedTotal,
    evidenceClass: assumptions.evidenceClass,
    warnings,
    calculatedAt: Date.now(),
    ...(takeoff ? { takeoffSnapshotId: takeoff.id } : {}),
    lines,
    unpricedCount,
  };
}
