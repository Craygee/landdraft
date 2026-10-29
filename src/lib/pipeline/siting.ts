import type { Feature, Geometry, Position } from "geojson";
import type {
  FacilityTag,
  LandFacilityPermission,
  PipelineComponent,
  PipelineComponentKind,
  SolverFinding,
} from "./types.ts";

export const FACILITY_TAG_LABELS: Record<FacilityTag, string> = {
  pump: "Pump allowed",
  compressor: "Compressor allowed",
  "pig-station": "Pig station allowed",
  meter: "Meter allowed",
  aboveground: "Aboveground facility allowed",
};

export function geometryFingerprint(geometry: Geometry): string {
  const source =
    geometry.type === "GeometryCollection"
      ? JSON.stringify([geometry.type, geometry.geometries])
      : JSON.stringify([geometry.type, geometry.coordinates]);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1)
    hash = (Math.imul(hash, 31) + source.charCodeAt(index)) | 0;
  return `${geometry.type}-${(hash >>> 0).toString(36)}`;
}

/** Resolves a saved land rule without trusting a mutable array index. */
export function resolveLandPermissionGeometry(
  permission: LandFacilityPermission,
  features: Feature[],
): Geometry | undefined {
  if (permission.featureId !== undefined) {
    const byId = features.find(
      (feature) => feature.id !== undefined && String(feature.id) === permission.featureId,
    );
    if (byId?.geometry) return byId.geometry;
  }
  if (permission.geometryHash !== undefined) {
    const indexed = features[permission.featureIndex];
    if (indexed?.geometry && geometryFingerprint(indexed.geometry) === permission.geometryHash)
      return indexed.geometry;
    return features.find(
      (feature) =>
        feature.geometry && geometryFingerprint(feature.geometry) === permission.geometryHash,
    )?.geometry;
  }
  // Index-only legacy records cannot be proven safe after feature edits; force reconnection.
  return undefined;
}

/**
 * The siting class of a component. Buried inline items (valves, sensors, CP test stations) carry
 * no siting rule and return null.
 */
export function facilityTagForComponent(kind: PipelineComponentKind): FacilityTag | null {
  switch (kind) {
    case "centrifugal-pump":
    case "positive-displacement-pump":
    case "booster":
    case "booster-station":
      return "pump";
    case "compressor":
    case "compressor-station":
      return "compressor";
    case "pig-launcher":
    case "pig-receiver":
    case "scraper-trap":
      return "pig-station";
    case "meter":
    case "flow-meter":
      return "meter";
    case "tank":
    case "reservoir":
    case "surge-vessel":
    case "pressure-reduction-station":
    case "regulator-station":
    case "separator-scrubber":
    case "heater":
    case "cooler":
    case "blowdown":
    case "linepack-storage":
    case "cathodic-protection-station":
      return "aboveground";
    default:
      return null;
  }
}

function pointInRing(point: Position, ring: Position[]): boolean {
  const [x, y] = [Number(point[0]), Number(point[1])];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = [Number(ring[i]![0]), Number(ring[i]![1])];
    const [xj, yj] = [Number(ring[j]![0]), Number(ring[j]![1])];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(point: Position, rings: Position[][]): boolean {
  if (!rings.length || !pointInRing(point, rings[0]!)) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInGeometry(point: Position, geometry: Geometry | null | undefined): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygonRings(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.some((rings) => pointInPolygonRings(point, rings));
  return false;
}

/**
 * Hard siting constraints from tagged land. A tagged polygon lists what it permits; untagged
 * land imposes nothing. A component inside a polygon that does not permit its class, or that is
 * marked "no facilities", produces a blocker. Optimization reuses the same rule.
 */
export function facilitySitingFindings(
  components: PipelineComponent[],
  permissions: LandFacilityPermission[],
  geometryFor: (permission: LandFacilityPermission) => Geometry | null | undefined,
): SolverFinding[] {
  const findings: SolverFinding[] = [];
  const resolvedPermissions = permissions.flatMap((permission) => {
    const geometry = geometryFor(permission);
    if (geometry) return [{ permission, geometry }];
    findings.push({
      id: `SITING_REFERENCE_${permission.id}`,
      severity: "blocker",
      code: "FACILITY_SITING_REFERENCE_MISSING",
      title: `Land rule cannot resolve ${permission.label}`,
      detail:
        "The referenced polygon was removed or changed. Reconnect this rule before relying on facility siting.",
    });
    return [];
  });
  for (const component of components) {
    const tag = facilityTagForComponent(component.kind);
    if (!tag) continue;
    for (const { permission, geometry } of resolvedPermissions) {
      if (!pointInGeometry(component.coordinate, geometry)) continue;
      // Each class needs its own tag: "aboveground" does not imply pumps or compressors.
      if (!permission.noFacilities && permission.allowed.includes(tag)) continue;
      findings.push({
        id: `SITING_${component.id}_${permission.id}`,
        severity: "blocker",
        code: "FACILITY_NOT_PERMITTED",
        title: `${component.name} is not permitted on ${permission.label}`,
        detail: permission.noFacilities
          ? `${permission.label} is tagged "No facilities".`
          : `${permission.label} permits: ${
              permission.allowed.map((item) => FACILITY_TAG_LABELS[item]).join(", ") || "nothing"
            }. Move the component or change the land tag.`,
        stationM: component.stationM,
      });
    }
  }
  return findings;
}
