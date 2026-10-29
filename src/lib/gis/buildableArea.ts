import jsts from "jsts";
import type { JGeometry } from "jsts";
import proj4 from "proj4";
import type { Geometry, Position, Feature } from "geojson";
import {
  ACRES_PER_M2,
  BUILDABLE_VERSION,
  constraintCategories,
  inputKey,
} from "./buildableAreaModel.ts";
import type {
  AreaGeometry,
  BuildableInput,
  BuildableResult,
  CoverageStatus,
} from "./buildableAreaModel.ts";

const reader = new jsts.io.GeoJSONReader();
const writer = new jsts.io.GeoJSONWriter();
export const METRE_GRID = 0.001;
export const feetToMeters = (feet: number) => feet * 0.3048;
/** Merge actual polygon features in projected metres; overlapping inputs are counted once. */
export function combineStudyPolygons(features: Feature[]): Feature<AreaGeometry> {
  const polygons = features.filter((f): f is Feature<AreaGeometry> =>
    ["Polygon", "MultiPolygon"].includes(f.geometry?.type),
  );
  if (!polygons.length) throw new Error("This layer has no polygon features.");
  const combined: AreaGeometry = {
    type: "MultiPolygon",
    coordinates: polygons.flatMap((f) =>
      f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
    ),
  };
  const projection = localProjection(combined);
  let merged: JGeometry | null = null;
  for (const feature of polygons) {
    const geometry = reader.read(mapGeometry(feature.geometry, projection.forward));
    if (!geometry.isValid())
      throw new Error(
        "A selected polygon is invalid or self-intersecting. Repair it before combining.",
      );
    merged = merged ? merged.union(geometry) : geometry;
  }
  return {
    type: "Feature",
    properties: {
      combinedPolygonFeatures: polygons.length,
      ignoredNonPolygonFeatures: features.length - polygons.length,
    },
    geometry: mapGeometry(writer.write(merged!), projection.inverse) as AreaGeometry,
  };
}
export function mapGeometry(geometry: Geometry, transform: (p: Position) => Position): Geometry {
  if (geometry.type === "GeometryCollection")
    return { ...geometry, geometries: geometry.geometries.map((g) => mapGeometry(g, transform)) };
  const walk = (coords: unknown): unknown => {
    if (!Array.isArray(coords)) throw new Error("Invalid geometry coordinates");
    return typeof coords[0] === "number" ? transform(coords as Position) : coords.map(walk);
  };
  return { ...geometry, coordinates: walk(geometry.coordinates) } as Geometry;
}
export function localProjection(geometry: AreaGeometry) {
  const points: Position[] = [];
  mapGeometry(geometry, (p) => {
    points.push(p);
    return p;
  });
  if (!points.length || points.length > 20_000)
    throw new Error("Study boundary must contain 1–20,000 coordinates.");
  for (const p of points)
    if (
      p.length < 2 ||
      !p.every(Number.isFinite) ||
      p[0]! < -180 ||
      p[0]! > 180 ||
      p[1]! < -80 ||
      p[1]! > 84
    )
      throw new Error("Use valid WGS84 coordinates between 80°S and 84°N.");
  const west = Math.min(...points.map((p) => p[0]!)),
    east = Math.max(...points.map((p) => p[0]!));
  const south = Math.min(...points.map((p) => p[1]!)),
    north = Math.max(...points.map((p) => p[1]!));
  const lon = (west + east) / 2,
    lat = (south + north) / 2;
  if (east - west > 2 || north - south > 1)
    throw new Error(
      "Study is too broad for local screening. Split it into smaller areas (maximum 50 km span).",
    );
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const crs = `+proj=utm +zone=${zone} ${lat < 0 ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
  const projection = proj4("EPSG:4326", crs);
  const center = projection.forward([lon, lat]);
  const forward = (p: Position) => {
    if (p.length < 2 || !p.every(Number.isFinite) || Math.abs(p[0]!) > 180 || Math.abs(p[1]!) > 85)
      throw new Error("Invalid WGS84 source coordinate.");
    const xy = projection.forward([p[0]!, p[1]!]);
    if (
      !xy.every(Number.isFinite) ||
      Math.hypot(xy[0]! - center[0]!, xy[1]! - center[1]!) > 1_000_000
    )
      throw new Error(
        "Source geometry exceeds the supported local projection. Supply a clipped dataset.",
      );
    return xy.map((v) => Math.round(v / METRE_GRID) * METRE_GRID);
  };
  for (const p of points) {
    const xy = forward(p);
    if (Math.hypot(xy[0]! - center[0]!, xy[1]! - center[1]!) > 25_000)
      throw new Error("Study exceeds 25 km radius. Split into smaller studies.");
  }
  return { crs, forward, inverse: (p: Position) => projection.inverse([p[0]!, p[1]!]) };
}
function areaOnly(g: JGeometry): JGeometry {
  if (g.getGeometryType() === "Polygon" || g.getGeometryType() === "MultiPolygon") return g;
  let result = reader.read({ type: "MultiPolygon", coordinates: [] });
  for (let i = 0; i < g.getNumGeometries(); i++) {
    const child = g.getGeometryN(i);
    if (child.getGeometryType() === "Polygon" || child.getGeometryType() === "MultiPolygon")
      result = result.union(child);
  }
  return result;
}
export function calculateBuildable(input: BuildableInput): BuildableResult {
  if (!["Polygon", "MultiPolygon"].includes(input.boundary.geometry.type))
    throw new Error("Choose a polygon or multipolygon.");
  const projection = localProjection(input.boundary.geometry);
  const warnings: string[] = [];
  let coordinateCount = 0;
  const read = (geometry: Geometry, context: string) => {
    const projected = mapGeometry(geometry, (p) => {
      if (++coordinateCount > 100_000)
        throw new Error("Analysis exceeds 100,000 coordinates. Reduce study/source detail.");
      return projection.forward(p);
    });
    const g = reader.read(projected);
    if (!g.isValid())
      throw new Error(
        `${context}: invalid or self-intersecting geometry. Repair the source before screening; no automatic area-changing repair applied.`,
      );
    return g;
  };
  const empty = () => reader.read({ type: "MultiPolygon", coordinates: [] });
  const output = (g: JGeometry): AreaGeometry | null =>
    g.isEmpty() || g.getArea() === 0
      ? null
      : (mapGeometry(writer.write(areaOnly(g)), projection.inverse) as AreaGeometry);
  const drawn = read(input.boundary.geometry, "Study boundary");
  if (drawn.getArea() < 1) throw new Error("Study must contain at least 1 square metre.");
  if (
    ![input.propertySetbackM, input.studyMarginM, input.minimumComponentAcres].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    Math.max(input.propertySetbackM, input.studyMarginM) > 5000
  )
    throw new Error("Margins must be 0–5,000 metres; minimum component area must be non-negative.");
  let property: JGeometry | null = null;
  if (input.clipToProperty || input.propertySetbackM > 0) {
    if (!input.property)
      throw new Error("Explicitly select a property polygon for clipping or a property setback.");
    property = read(input.property.geometry, "Property boundary");
  }
  const study = areaOnly(input.clipToProperty && property ? drawn.intersection(property) : drawn);
  if (study.isEmpty() || study.getArea() < 1)
    throw new Error("Study and selected property have no usable area of intersection.");
  let excluded = empty();
  const boundaryRules: BuildableResult["boundaryRules"] = [];
  if (input.studyMarginM > 0) {
    const margin = study.difference(study.buffer(-input.studyMarginM, 16));
    excluded = excluded.union(margin);
    boundaryRules.push({
      id: "study-margin",
      name: "Study-boundary inward margin",
      meters: input.studyMarginM,
      acres: margin.getArea() * ACRES_PER_M2,
      source: input.sourceReference.name,
    });
  }
  // A property setback follows ALL selected property shell/hole boundaries, never clipping edges.
  if (property && input.propertySetbackM > 0) {
    const setback = study.intersection(
      property.difference(property.buffer(-input.propertySetbackM, 16)),
    );
    excluded = excluded.union(setback);
    boundaryRules.push({
      id: "property-setback",
      name: "Selected-property inward setback",
      meters: input.propertySetbackM,
      acres: setback.getArea() * ACRES_PER_M2,
      source: input.propertyReference ?? "Explicit selected property snapshot",
    });
  }
  let conditional = empty();
  const breakdown: BuildableResult["breakdown"] = [];
  const prepared: Feature<AreaGeometry>[] = [];
  const statusByRule = new Map<string, CoverageStatus>();
  if (input.rules.length > 60) throw new Error("Use at most 60 rules per study.");
  for (const rule of input.rules) {
    if (!rule.enabled) {
      breakdown.push({
        ruleId: rule.id,
        acres: null,
        coverage: "not-evaluated",
        message: "Rule disabled",
      });
      continue;
    }
    if (rule.coverage === "failed" || rule.coverage === "not-evaluated") {
      statusByRule.set(rule.id, rule.coverage);
      breakdown.push({
        ruleId: rule.id,
        acres: null,
        coverage: rule.coverage,
        message: rule.explanation,
      });
      continue;
    }
    try {
      const meters = rule.unit === "feet" ? feetToMeters(rule.buffer) : rule.buffer;
      if (!Number.isFinite(meters) || meters < 0 || meters > 5000)
        throw new Error("Buffer must be 0–5,000 metres.");
      if (rule.features.features.length > 4000)
        throw new Error("Rule exceeds 4,000 features. Clip or filter source data.");
      let shape = empty();
      for (const feature of rule.features.features) {
        if (!feature.geometry) throw new Error("Source has missing geometry.");
        let g = read(feature.geometry, rule.name);
        const isArea = ["Polygon", "MultiPolygon"].includes(feature.geometry.type);
        if (!isArea && meters === 0 && rule.classification !== "reference")
          throw new Error(
            "Point/line acreage deductions require an explicit buffer or actual footprint polygon.",
          );
        if (meters > 0) g = g.buffer(meters, 16);
        g = areaOnly(g.intersection(study));
        shape = shape.union(g);
      }
      shape = areaOnly(shape);
      const status =
        meters > 0 && rule.verification !== "verified"
          ? rule.coverage === "partial"
            ? "partial"
            : "provisional"
          : rule.coverage;
      const geometry = output(shape);
      if (rule.classification === "exclusion") excluded = excluded.union(shape);
      if (rule.classification === "conditional") conditional = conditional.union(shape);
      if (geometry)
        prepared.push({
          type: "Feature",
          properties: {
            ruleId: rule.id,
            name: rule.name,
            classification: rule.classification,
            source: rule.sourceId,
            coverage: status,
          },
          geometry,
        });
      statusByRule.set(rule.id, status);
      breakdown.push({ ruleId: rule.id, acres: shape.getArea() * ACRES_PER_M2, coverage: status });
    } catch (error) {
      statusByRule.set(rule.id, "failed");
      const message = error instanceof Error ? error.message : "Constraint processing failed";
      breakdown.push({ ruleId: rule.id, acres: null, coverage: "failed", message });
      warnings.push(`${rule.name}: ${message}. Not deducted; analysis incomplete.`);
      if (input.automation?.holdUnresolved && rule.requiredCheck) {
        conditional = conditional.union(study);
        warnings.push(
          `${rule.name}: required geometry check failed; the study is held conditional, not cleared.`,
        );
        prepared.push({
          type: "Feature",
          properties: {
            ruleId: rule.id,
            name: `Unresolved ${rule.name}`,
            classification: "conditional",
            source: rule.sourceId,
            coverage: "failed",
          },
          geometry: output(study)!,
        });
      }
    }
  }
  excluded = areaOnly(excluded.intersection(study));
  const remaining = areaOnly(study.difference(excluded));
  conditional = areaOnly(conditional.intersection(remaining));
  const clear = areaOnly(remaining.difference(conditional));
  const candidate = input.conditionalExcluded ? clear : remaining;
  const parts: JGeometry[] = [];
  if (!candidate.isEmpty()) {
    if (candidate.getGeometryType() === "Polygon") parts.push(candidate);
    else
      for (let i = 0; i < candidate.getNumGeometries(); i++) parts.push(candidate.getGeometryN(i));
  }
  parts.sort(
    (a, b) =>
      b.getArea() - a.getArea() ||
      a.getEnvelopeInternal().getMinX() - b.getEnvelopeInternal().getMinX() ||
      a.getEnvelopeInternal().getMinY() - b.getEnvelopeInternal().getMinY(),
  );
  const components = parts
    .filter((g) => g.getArea() > 0)
    .map((g, i) => ({
      id: `${input.id}:component:${i + 1}`,
      label: `Area ${i + 1}`,
      geometry: output(g)!,
      acres: g.getArea() * ACRES_PER_M2,
      conditionalAcres: g.intersection(conditional).getArea() * ACRES_PER_M2,
      belowMinimum: g.getArea() * ACRES_PER_M2 < input.minimumComponentAcres,
      access: "Access not evaluated; geometric connectivity does not establish practical access.",
    }));
  const unknownCoverage: BuildableResult["unknownCoverage"] = [];
  const requested = [
    ...new Set([
      ...input.requested,
      ...input.rules.filter((rule) => rule.enabled).map((rule) => rule.category),
    ]),
  ];
  const completeness = requested.map((category) => {
    const rules = input.rules.filter((r) => r.enabled && r.category === category);
    if (!rules.length)
      return {
        category,
        status: "not-evaluated" as CoverageStatus,
        explanation:
          constraintCategories.find((c) => c[0] === category)?.[2] ?? "No source configured.",
      };
    const statuses = rules.map((r) => statusByRule.get(r.id) ?? "not-evaluated");
    let status: CoverageStatus = statuses.every((s) => s === "available")
      ? "available"
      : statuses.includes("failed")
        ? "failed"
        : statuses.includes("not-evaluated") || statuses.includes("partial")
          ? "partial"
          : statuses.includes("user-unknown")
            ? "user-unknown"
            : "provisional";
    const known = rules.filter((r) => r.coverageGeometry && statusByRule.get(r.id) !== "failed");
    if (known.length) {
      try {
        let covered = empty();
        for (const r of known)
          covered = covered.union(read(r.coverageGeometry!, `${r.name} coverage`));
        const unknown = areaOnly(study.difference(covered));
        const geometry = output(unknown);
        if (geometry) {
          status = "partial";
          unknownCoverage.push({
            type: "Feature",
            properties: { category, acres: unknown.getArea() * ACRES_PER_M2 },
            geometry,
          });
        }
      } catch {
        status = "partial";
        warnings.push(`${category}: coverage geometry could not be processed.`);
      }
    }
    return {
      category,
      status,
      explanation: known.length
        ? "Coverage supplied by user/source; uncovered geometry displayed where present."
        : "Dataset evaluated only to stated availability; geographic completeness is unknown. No coverage boundary was invented.",
    };
  });
  const toleranceM2 = Math.max(0.05, study.getArea() * 1e-7);
  if (
    Math.abs(study.getArea() - excluded.getArea() - clear.getArea() - conditional.getArea()) >
    toleranceM2
  )
    throw new Error("Area accounting did not reconcile. Review source geometry.");
  if (!input.property)
    warnings.push(
      "Ownership boundaries have not been checked. A study rectangle is not proof of ownership.",
    );
  else if (!input.clipToProperty)
    warnings.push(
      "Study is not clipped to the selected property. Land outside that property may remain in the study; no neighboring ownership is established.",
    );
  warnings.push(
    "No verified access, utility capacity, interconnection, gas supply, fiber service or development approval is established.",
  );
  return {
    version: BUILDABLE_VERSION,
    calculatedAt: new Date().toISOString(),
    crs: projection.crs,
    inputKey: inputKey(input),
    drawnAcres: drawn.getArea() * ACRES_PER_M2,
    studyAcres: study.getArea() * ACRES_PER_M2,
    excludedAcres: excluded.getArea() * ACRES_PER_M2,
    conditionalAcres: conditional.getArea() * ACRES_PER_M2,
    candidateAcres: candidate.getArea() * ACRES_PER_M2,
    outsideConditionalAcres: clear.getArea() * ACRES_PER_M2,
    candidatePercent: (100 * candidate.getArea()) / study.getArea(),
    largestAcres: components[0]?.acres ?? 0,
    study: output(study)!,
    excluded: output(excluded),
    conditional: output(conditional),
    candidate: output(candidate),
    components,
    prepared,
    breakdown,
    boundaryRules,
    completeness,
    unknownCoverage,
    warnings,
    toleranceM2,
  };
}
