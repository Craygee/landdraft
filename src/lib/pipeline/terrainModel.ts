import type { Position } from "geojson";
import { projectOntoRoute } from "./components.ts";
import { pointAtStation } from "./model.ts";
import type { ElevationSample, PipelineRoute, PipelineStation } from "./types.ts";

/** A control point farther than this from the edited centerline is kept but not applied. */
export const SURVEY_MAX_OFFSET_M = 10;
export const DEFAULT_SURVEY_INFLUENCE_M = 30;

export interface ElevationResolution {
  route: PipelineRoute;
  appliedControlIds: string[];
  /** Control points stored on the route that no longer lie on it after a geometry edit. */
  offRouteControlIds: string[];
}

export function createControlPoint(input: {
  route: PipelineRoute;
  stationM: number;
  groundElevationM: number;
  influenceRangeM: number;
  sourceKind: "survey" | "manual";
  source: string;
}): ElevationSample {
  const stationM = Math.max(0, Math.min(input.route.lengthM, input.stationM));
  const now = Date.now();
  return {
    id: `control-${input.sourceKind}-${now}-${Math.random().toString(36).slice(2, 7)}`,
    stationM,
    coordinate: pointAtStation(input.route, stationM),
    groundElevationM: input.groundElevationM,
    source: input.source,
    sourceKind: input.sourceKind,
    capturedAt: now,
    quality: input.sourceKind === "survey" ? "high" : "unknown",
    provenance: input.sourceKind === "survey" ? "surveyed" : "user",
    influenceRangeM: Math.max(0, input.influenceRangeM),
  };
}

function demElevationAt(samples: ElevationSample[], stationM: number): number | undefined {
  if (!samples.length) return undefined;
  if (stationM < samples[0]!.stationM || stationM > samples.at(-1)!.stationM) return undefined;
  for (let index = 0; index < samples.length; index += 1) {
    const end = samples[index]!;
    if (end.stationM < stationM) continue;
    if (end.stationM === stationM || index === 0) return end.groundElevationM;
    const start = samples[index - 1]!;
    const ratio = (stationM - start.stationM) / Math.max(1e-9, end.stationM - start.stationM);
    return start.groundElevationM + (end.groundElevationM - start.groundElevationM) * ratio;
  }
  return undefined;
}

/**
 * Builds the route's elevation profile from three layers, in precedence order:
 *
 * 1. Survey/manual control points are exact at their own station.
 * 2. Within a control point's influence range, the provider (DEM) profile is corrected by the
 *    control's offset from DEM, tapering linearly to no correction at the range edge. The nearest
 *    control wins where ranges overlap. Outside every range, DEM values are used unchanged.
 * 3. Where there is no DEM coverage, stations between two control points are linearly
 *    interpolated and labelled as such; anything else stays missing.
 *
 * The pipeline centerline is the resolved ground elevation less the route's burial depth. Control
 * points are re-projected onto the current geometry by coordinate; one that has moved off the
 * route is kept on the route record but not applied.
 */
export function resolveRouteElevations(route: PipelineRoute): ElevationResolution {
  const demSamples = route.elevationSamples
    .filter((sample) => sample.sourceKind === "dem" || sample.sourceKind === "manual")
    .sort((a, b) => a.stationM - b.stationM);
  const appliedControlIds: string[] = [];
  const offRouteControlIds: string[] = [];
  const controls = (route.controlPoints ?? [])
    .map((control) => {
      const projected = projectOntoRoute(route, control.coordinate);
      if (projected.offsetM > SURVEY_MAX_OFFSET_M) {
        offRouteControlIds.push(control.id);
        return undefined;
      }
      appliedControlIds.push(control.id);
      return { ...control, stationM: projected.stationM };
    })
    .filter((control): control is ElevationSample => control !== undefined)
    .sort((a, b) => a.stationM - b.stationM);

  const burialDepthM = Math.max(0, route.burialDepthM ?? 0);
  const baseStations = route.stations.filter((station) => !station.controlPointId);

  const resolveBase = (station: PipelineStation): PipelineStation => {
    const {
      groundElevationM: _ground,
      pipelineElevationM: _pipeline,
      elevationProvenance: _provenance,
      ...position
    } = station;
    const dem = demElevationAt(demSamples, station.stationM);
    let nearest: ElevationSample | undefined;
    for (const control of controls) {
      const distance = Math.abs(control.stationM - station.stationM);
      if (distance > (control.influenceRangeM ?? 0)) continue;
      if (!nearest || distance < Math.abs(nearest.stationM - station.stationM)) nearest = control;
    }
    let ground: number | undefined;
    let provenance: PipelineStation["elevationProvenance"];
    if (dem !== undefined && nearest) {
      const demAtControl = demElevationAt(demSamples, nearest.stationM);
      if (demAtControl === undefined) {
        ground = dem;
        provenance = "provider";
      } else {
        const range = Math.max(1e-9, nearest.influenceRangeM ?? 0);
        const weight = 1 - Math.abs(nearest.stationM - station.stationM) / range;
        ground = dem + weight * (nearest.groundElevationM - demAtControl);
        provenance = weight > 0 ? "estimated" : "provider";
      }
    } else if (dem !== undefined) {
      ground = dem;
      provenance = demSamples.some((sample) => sample.sourceKind === "dem") ? "provider" : "user";
    } else {
      const before = controls.filter((control) => control.stationM <= station.stationM).at(-1);
      const after = controls.find((control) => control.stationM >= station.stationM);
      if (before && after) {
        const ratio =
          (station.stationM - before.stationM) / Math.max(1e-9, after.stationM - before.stationM);
        ground =
          before.groundElevationM + (after.groundElevationM - before.groundElevationM) * ratio;
        provenance = "interpolated";
      }
    }
    return ground === undefined
      ? position
      : {
          ...position,
          groundElevationM: ground,
          pipelineElevationM: ground - burialDepthM,
          ...(provenance ? { elevationProvenance: provenance } : {}),
        };
  };

  const controlStations: PipelineStation[] = controls.map((control) => ({
    stationM: control.stationM,
    coordinate: pointAtStation(route, control.stationM) as Position,
    groundElevationM: control.groundElevationM,
    pipelineElevationM: control.groundElevationM - burialDepthM,
    elevationSampleId: control.id,
    controlPointId: control.id,
    elevationProvenance: control.provenance,
  }));

  const stations = [...baseStations.map(resolveBase), ...controlStations]
    .sort((a, b) => a.stationM - b.stationM)
    // A control point exactly on a base station replaces it.
    .filter(
      (station, _index, all) =>
        Boolean(station.controlPointId) ||
        !all.some(
          (other) =>
            other.controlPointId !== undefined &&
            Math.abs(other.stationM - station.stationM) < 1e-6,
        ),
    );

  return {
    route: { ...route, stations },
    appliedControlIds,
    offRouteControlIds,
  };
}
