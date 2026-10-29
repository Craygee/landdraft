import { projectOntoRoute } from "./components.ts";
import { pointAtStation } from "./model.ts";
import type {
  ConstructionCondition,
  ConstructionMethod,
  ConstructionRange,
  CrossingType,
  PipeSpecification,
  PipelineCrossing,
  PipelineRoute,
  TrenchAssumptions,
} from "./types.ts";

export type ConstructionEvidence = ConstructionRange["evidence"];

/** Higher wins. Mapped soil or geology never outranks a user or field confirmation. */
export const CONSTRUCTION_EVIDENCE_RANK: Record<ConstructionEvidence, number> = {
  default: 0,
  "model-estimated": 1,
  "provider-mapped": 2,
  "user-confirmed": 3,
  "field-confirmed": 4,
};

export const DEFAULT_TRENCH: TrenchAssumptions = {
  trenchWidthM: 0.9,
  beddingBelowPipeM: 0.15,
  defaultMethod: "open-trench",
  rockAllowancePercent: 0,
  blastingPermitted: false,
};

/** A range moved farther than this by a route edit must be confirmed before reliance. */
export const CONSTRUCTION_RANGE_REVIEW_DISTANCE_M = 1;

export interface ResolvedConstructionInterval {
  startStationM: number;
  endStationM: number;
  method: ConstructionMethod;
  conditions: ConstructionCondition[];
  evidence: ConstructionEvidence;
  /** Ranges that set the method/conditions here; empty when the route default applies. */
  rangeIds: string[];
}

export function trenchAssumptions(route: PipelineRoute): TrenchAssumptions {
  return { ...DEFAULT_TRENCH, ...route.trench };
}

/**
 * Splits the route into intervals with one effective method and set of conditions each. Where
 * ranges overlap, the range with the strongest evidence wins; on equal evidence, the later range
 * wins, so a correction entered after an earlier estimate takes effect.
 */
export function resolveConstructionIntervals(route: PipelineRoute): ResolvedConstructionInterval[] {
  const length = route.lengthM;
  if (length <= 0) return [];
  const trench = trenchAssumptions(route);
  const ranges = route.constructionRanges
    .map((range, order) => ({
      range,
      order,
      start: Math.max(0, Math.min(range.startStationM, range.endStationM)),
      end: Math.min(length, Math.max(range.startStationM, range.endStationM)),
    }))
    .filter((item) => item.end > item.start);
  const breaks = Array.from(
    new Set([0, length, ...ranges.flatMap((item) => [item.start, item.end])]),
  ).sort((a, b) => a - b);

  const intervals: ResolvedConstructionInterval[] = [];
  for (let index = 1; index < breaks.length; index += 1) {
    const start = breaks[index - 1]!;
    const end = breaks[index]!;
    const mid = (start + end) / 2;
    const winner = ranges
      .filter((item) => item.start <= mid && item.end >= mid)
      .sort(
        (a, b) =>
          CONSTRUCTION_EVIDENCE_RANK[b.range.evidence] -
            CONSTRUCTION_EVIDENCE_RANK[a.range.evidence] || b.order - a.order,
      )[0];
    const next: ResolvedConstructionInterval = winner
      ? {
          startStationM: start,
          endStationM: end,
          method: winner.range.method,
          conditions: [...winner.range.conditions],
          evidence: winner.range.evidence,
          rangeIds: [winner.range.id],
        }
      : {
          startStationM: start,
          endStationM: end,
          method: trench.defaultMethod,
          conditions: ["normal-soil"],
          evidence: "default",
          rangeIds: [],
        };
    const previous = intervals.at(-1);
    if (
      previous &&
      previous.method === next.method &&
      previous.evidence === next.evidence &&
      previous.rangeIds.join() === next.rangeIds.join() &&
      previous.conditions.join() === next.conditions.join()
    )
      previous.endStationM = end;
    else intervals.push(next);
  }
  return intervals;
}

/** Trench depth from grade: burial depth to centerline, half the pipe OD, then bedding. */
export function trenchDepthM(route: PipelineRoute, pipe: PipeSpecification): number {
  const trench = trenchAssumptions(route);
  return (
    Math.max(0, route.burialDepthM ?? 0) + pipe.outsideDiameterM / 2 + trench.beddingBelowPipeM
  );
}

const TRENCHED_METHODS: ConstructionMethod[] = ["open-trench", "existing-corridor"];

export interface RockQuantity {
  /** Rock confirmed or mapped by station range. */
  rangedVolumeM3: number;
  rangedLengthM: number;
  rangeIds: string[];
  /** Percentage allowance over trenched length not already covered by a rock range. */
  allowanceVolumeM3: number;
  allowanceBasisLengthM: number;
  allowancePercent: number;
  strongestEvidence: ConstructionEvidence | null;
}

/**
 * Rock volume = affected trench length × trench width × trench depth. Station ranges marked
 * "rock" contribute their full section; the route's rock allowance percentage applies only to the
 * remaining trenched length. "Shallow rock suspected" is not counted as rock by itself.
 */
export function estimateRockQuantity(route: PipelineRoute, pipe: PipeSpecification): RockQuantity {
  const trench = trenchAssumptions(route);
  const sectionM2 = trench.trenchWidthM * trenchDepthM(route, pipe);
  let rangedLengthM = 0;
  let allowanceBasisLengthM = 0;
  const rangeIds = new Set<string>();
  let strongest: ConstructionEvidence | null = null;
  for (const interval of resolveConstructionIntervals(route)) {
    if (!TRENCHED_METHODS.includes(interval.method)) continue;
    const lengthM = interval.endStationM - interval.startStationM;
    if (interval.conditions.includes("rock")) {
      rangedLengthM += lengthM;
      interval.rangeIds.forEach((id) => rangeIds.add(id));
      if (
        strongest === null ||
        CONSTRUCTION_EVIDENCE_RANK[interval.evidence] > CONSTRUCTION_EVIDENCE_RANK[strongest]
      )
        strongest = interval.evidence;
    } else allowanceBasisLengthM += lengthM;
  }
  const allowancePercent = Math.max(0, Math.min(100, trench.rockAllowancePercent));
  return {
    rangedVolumeM3: rangedLengthM * sectionM2,
    rangedLengthM,
    rangeIds: [...rangeIds],
    allowanceVolumeM3: (allowanceBasisLengthM * sectionM2 * allowancePercent) / 100,
    allowanceBasisLengthM,
    allowancePercent,
    strongestEvidence: strongest,
  };
}

export function createConstructionRange(input: {
  route: PipelineRoute;
  startStationM: number;
  endStationM: number;
  method: ConstructionMethod;
  conditions: ConstructionCondition[];
  evidence: ConstructionEvidence;
  source?: string;
  notes?: string;
}): ConstructionRange {
  const clamp = (value: number) => Math.max(0, Math.min(input.route.lengthM, value));
  const startStationM = clamp(Math.min(input.startStationM, input.endStationM));
  const endStationM = clamp(Math.max(input.startStationM, input.endStationM));
  return {
    id: `range-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    routeId: input.route.id,
    startStationM,
    endStationM,
    startCoordinate: pointAtStation(input.route, startStationM),
    endCoordinate: pointAtStation(input.route, endStationM),
    method: input.method,
    conditions: input.conditions,
    evidence: input.evidence,
    ...(input.source ? { source: input.source } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

/**
 * Keeps construction assumptions attached to their geographic location when the route changes.
 * Legacy ranges without anchors are anchored from their previous stations on first edit. A moved
 * range is retained but visibly requires confirmation instead of silently changing the estimate.
 */
export function reprojectConstructionRanges(
  previousRoute: PipelineRoute,
  nextRoute: PipelineRoute,
  maximumOffsetM = CONSTRUCTION_RANGE_REVIEW_DISTANCE_M,
): PipelineRoute {
  const detectedAt = Date.now();
  return {
    ...nextRoute,
    constructionRanges: nextRoute.constructionRanges.map((range) => {
      const startAnchor =
        range.startCoordinate ?? pointAtStation(previousRoute, range.startStationM);
      const endAnchor = range.endCoordinate ?? pointAtStation(previousRoute, range.endStationM);
      const projected = [
        projectOntoRoute(nextRoute, startAnchor),
        projectOntoRoute(nextRoute, endAnchor),
      ].sort((a, b) => a.stationM - b.stationM);
      const start = projected[0]!;
      const end = projected[1]!;
      const movedM = Math.max(start.offsetM, end.offsetM);
      const placementReview =
        movedM > maximumOffsetM
          ? {
              previousStartStationM:
                range.placementReview?.previousStartStationM ?? range.startStationM,
              previousEndStationM: range.placementReview?.previousEndStationM ?? range.endStationM,
              movedM: Math.max(range.placementReview?.movedM ?? 0, movedM),
              detectedAt,
            }
          : range.placementReview;
      return {
        ...range,
        startStationM: start.stationM,
        endStationM: end.stationM,
        startCoordinate: pointAtStation(nextRoute, start.stationM),
        endCoordinate: pointAtStation(nextRoute, end.stationM),
        ...(placementReview ? { placementReview } : {}),
      };
    }),
  };
}

/**
 * After a geometry edit, crossings move to the nearest point on the new centerline. A crossing
 * that is now more than `maximumOffsetM` away no longer intersects the route as drawn, so it is
 * marked unreviewed rather than silently kept as confirmed.
 */
export function reprojectCrossings(route: PipelineRoute, maximumOffsetM = 10): PipelineRoute {
  return {
    ...route,
    crossings: route.crossings.map((crossing) => {
      const projected = projectOntoRoute(route, crossing.coordinate);
      const offRoute = projected.offsetM > maximumOffsetM;
      return {
        ...crossing,
        stationM: projected.stationM,
        ...(offRoute && crossing.confirmation !== "rejected"
          ? { confirmation: "unreviewed" as const }
          : {}),
      };
    }),
  };
}

/** Typical construction method by crossing type, used only as an unconfirmed starting point. */
export const DEFAULT_CROSSING_METHOD: Record<CrossingType, ConstructionMethod> = {
  "paved-road": "bore",
  highway: "bore",
  railroad: "casing",
  stream: "open-trench",
  river: "hdd",
  drainage: "open-trench",
  "utility-corridor": "open-trench",
  "transmission-corridor": "open-trench",
  wetland: "hdd",
  floodplain: "open-trench",
  other: "other",
};

export function createManualCrossing(input: {
  route: PipelineRoute;
  type: CrossingType;
  stationM: number;
  crossingLengthM?: number;
  constructionMethod?: ConstructionMethod;
  notes?: string;
}): PipelineCrossing {
  const stationM = Math.max(0, Math.min(input.route.lengthM, input.stationM));
  return {
    id: `crossing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    routeId: input.route.id,
    type: input.type,
    stationM,
    coordinate: pointAtStation(input.route, stationM),
    source: "User-entered crossing",
    confidence: "high",
    constructionMethod: input.constructionMethod ?? DEFAULT_CROSSING_METHOD[input.type],
    ...(input.crossingLengthM === undefined
      ? {}
      : { crossingLengthM: Math.max(0, input.crossingLengthM) }),
    ...(input.notes ? { notes: input.notes } : {}),
    // The user placed it, so it starts confirmed. Detector output always starts "unreviewed".
    confirmation: "confirmed",
  };
}
