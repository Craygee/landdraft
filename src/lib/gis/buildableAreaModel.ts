import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type { GisLayer } from "./types";

export type AreaGeometry = Polygon | MultiPolygon;
export type AreaFeature = Feature<AreaGeometry>;
export type ConstraintClass = "exclusion" | "conditional" | "reference";
export type CoverageStatus =
  "available" | "provisional" | "partial" | "not-evaluated" | "failed" | "user-unknown";
export const SCREENING_NOTE =
  "Preliminary screening based on selected rules and available data. Survey, title, environmental, and engineering review may change these results.";
export const BUILDABLE_VERSION = "1.1.0";
export const ACRES_PER_M2 = 1 / 4046.8564224;
export function assertBuildableBudget(data: FeatureCollection, maximum = 100_000): number {
  let count = 0;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      if (++count > maximum)
        throw new Error(
          `Analysis geometry exceeds ${maximum.toLocaleString()} coordinates. Filter or clip the source.`,
        );
    } else for (const child of value) visit(child);
  };
  const geometry = (g: Feature["geometry"]): void => {
    if (g.type === "GeometryCollection") for (const child of g.geometries) geometry(child);
    else visit(g.coordinates);
  };
  for (const feature of data.features) if (feature.geometry) geometry(feature.geometry);
  return count;
}
export const constraintCategories = [
  [
    "wetlands",
    "Mapped wetlands",
    "Screening only; mapped absence does not establish absence or jurisdiction.",
  ],
  [
    "streams",
    "Rivers / streams",
    "Centerlines do not establish channel width or riparian setbacks.",
  ],
  ["waterbodies", "Lakes / ponds / water bodies", "Mapped surface water coverage and dates vary."],
  [
    "drainage",
    "Drainage channels / corridors",
    "Include documented drainage easements or supplied geometry.",
  ],
  [
    "flood",
    "Flood-hazard classifications",
    "Preserve source zone codes; outside mapped floodplain does not mean flood-free.",
  ],
  ["floodway", "Regulatory floodways", "Separate from other flood-hazard classifications."],
  ["protected", "Protected areas", "Use documented protected-area geometry."],
  [
    "conservation",
    "Conservation easements",
    "Recorded restrictions require title and document review.",
  ],
  ["environment", "Other environmental restrictions", "User-supplied documented restrictions."],
  [
    "terrain",
    "Terrain / slope",
    "Terrain analysis not evaluated: line elevation samples are not a site terrain model.",
  ],
  [
    "transmission",
    "Transmission centerlines",
    "Voltage does not establish easement width or available capacity.",
  ],
  ["towers", "Towers / poles", "Separate locations from physical footprints and setbacks."],
  [
    "electric-easements",
    "Recorded electric rights-of-way",
    "Prefer recorded polygons; no extra buffer by default.",
  ],
  [
    "distribution",
    "Distribution / collection infrastructure",
    "Proximity does not establish service or permission to connect.",
  ],
  [
    "substations",
    "Substation locations / footprints",
    "Points are not facility footprints or available capacity.",
  ],
  [
    "switchyards",
    "Switchyard footprints",
    "Use actual facility geometry; location alone does not establish an occupied footprint.",
  ],
  [
    "storage",
    "Battery energy-storage facilities",
    "Require mapped facility footprints and documented restrictions; no capacity is inferred.",
  ],
  [
    "wind",
    "Wind turbine points / physical footprints",
    "Any user buffer is provisional unless independently verified.",
  ],
  [
    "energy-roads",
    "Energy access roads / easements",
    "Keep access and collection restrictions distinct from lease areas.",
  ],
  [
    "solar",
    "Solar occupied arrays / facilities",
    "Occupied footprint differs from project or lease boundary.",
  ],
  [
    "energy-leases",
    "Energy project / lease boundaries",
    "Do not automatically exclude an entire project; review contractual restrictions.",
  ],
  [
    "generation",
    "Power-generation facilities",
    "Mapped facility proximity does not establish utility capacity.",
  ],
  [
    "pipelines",
    "Pipeline centerlines",
    "Retain commodity and status; proximity does not establish tap rights or gas supply.",
  ],
  [
    "pipeline-easements",
    "Recorded pipeline easements",
    "Prefer recorded polygons to assumed corridor widths.",
  ],
  [
    "wells",
    "Wells / associated facilities",
    "Mapped points do not establish environmental clearance.",
  ],
  [
    "road-row",
    "Public road rights-of-way",
    "Centerlines, pavement, legal ROW and setbacks are distinct.",
  ],
  [
    "private-access",
    "Private roads / recorded access / entrances",
    "Touching a road does not establish verified access.",
  ],
  [
    "internal-access",
    "Reserved internal corridors",
    "Deduct only if explicitly enabled and classified as exclusion.",
  ],
  [
    "rail",
    "Railroads / recorded railroad ROW",
    "Centerline does not establish right-of-way width.",
  ],
  [
    "buildings",
    "Buildings / occupied facilities",
    "Prefer actual footprints over location points.",
  ],
  [
    "fiber",
    "Fiber / communications",
    "Route proximity does not establish available service or capacity.",
  ],
  ["user", "User-defined restrictions", "Keep geometry basis and assumptions visible."],
] as const;
export type ConstraintCategory = (typeof constraintCategories)[number][0];
export const coverageLabels: Record<CoverageStatus, string> = {
  available: "Evaluated with available data",
  provisional: "Evaluated with provisional assumptions",
  partial: "Partially evaluated",
  "not-evaluated": "Not evaluated",
  failed: "Source failed to load",
  "user-unknown": "User-supplied data; coverage unknown",
};
export interface TerrainSettings {
  enabled: boolean;
  conditionalSlopePercent: number;
  exclusionSlopePercent: number;
  reliefM: number;
  windowM: number;
  cellSizeM: number;
}
export interface TerrainSummary {
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  productDate: string | null;
  cellSizeM: number;
  requestedCellSizeM: number;
  sourceResolutionM: number | null;
  horizontalUnits: "metres";
  verticalUnits: "metres";
  verticalDatum: string;
  windowM: number;
  requestedWindowM: number;
  validCells: number;
  unknownCells: number;
  maxSlopePercent: number | null;
  maxReliefM: number | null;
  method: string;
}
export interface BuildableRule {
  autoKey?: string;
  requiredCheck?: boolean;
  generated?: "terrain" | "unresolved";
  basis?: { title: string; url: string; explanation: string }[];
  terrainSummary?: TerrainSummary;
  id: string;
  name: string;
  category: ConstraintCategory;
  sourceId: string;
  sourceUrl?: string;
  sourceDate?: string;
  retrievedAt?: string;
  layerId?: string | undefined;
  originalClassification: ConstraintClass;
  classification: ConstraintClass;
  enabled: boolean;
  buffer: number;
  unit: "meters" | "feet";
  verification: "recorded" | "verified" | "user-assumption" | "provisional";
  override: boolean;
  coverage: CoverageStatus;
  explanation: string;
  geometryBasis: string;
  features: FeatureCollection;
  coverageGeometry?: AreaGeometry | undefined;
  sourceFilter?: string | undefined;
}
export interface BuildableInput {
  automation?: {
    applied?: boolean;
    version: string;
    terrain: TerrainSettings;
    holdUnresolved: boolean;
  };
  id: string;
  name: string;
  profile: "general" | "data-center";
  boundary: AreaFeature;
  sourceReference: {
    layerId?: string;
    featureId?: string;
    name: string;
    wholeLayer?: boolean;
    geometryKey?: string;
  };
  property?: AreaFeature | undefined;
  propertyReference?: string | undefined;
  clipToProperty: boolean;
  propertySetbackM: number;
  studyMarginM: number;
  conditionalExcluded: boolean;
  minimumComponentAcres: number;
  requested: ConstraintCategory[];
  rules: BuildableRule[];
}
export interface BuildableComponent {
  id: string;
  label: string;
  geometry: AreaGeometry;
  acres: number;
  conditionalAcres: number;
  belowMinimum: boolean;
  access: string;
}
export interface BuildableResult {
  version: string;
  calculatedAt: string;
  crs: string;
  inputKey: string;
  drawnAcres: number;
  studyAcres: number;
  excludedAcres: number;
  conditionalAcres: number;
  candidateAcres: number;
  outsideConditionalAcres: number;
  candidatePercent: number;
  largestAcres: number;
  study: AreaGeometry;
  excluded: AreaGeometry | null;
  conditional: AreaGeometry | null;
  candidate: AreaGeometry | null;
  components: BuildableComponent[];
  prepared: Feature<AreaGeometry>[];
  boundaryRules: { id: string; name: string; meters: number; acres: number; source: string }[];
  breakdown: { ruleId: string; acres: number | null; coverage: CoverageStatus; message?: string }[];
  completeness: { category: ConstraintCategory; status: CoverageStatus; explanation: string }[];
  unknownCoverage: Feature<AreaGeometry>[];
  warnings: string[];
  toleranceM2: number;
}
export interface BuildableSnapshot {
  schemaVersion: 1;
  input: BuildableInput;
  result: BuildableResult;
}
export const inputKey = (input: BuildableInput) => {
  const { id: _id, name: _name, ...calculation } = input;
  return JSON.stringify(calculation);
};
export function boundarySnapshotChanged(input: BuildableInput, layers: GisLayer[]): boolean {
  const layer = layers.find((layer) => layer.id === input.sourceReference.layerId);
  if (!layer) return false; // A preserved boundary snapshot still exists even if its source is unavailable.
  if (input.sourceReference.wholeLayer)
    return layer.source.kind === "remote"
      ? false
      : polygonLayerKey(boundaryPolygonFeatures(layer)) !== input.sourceReference.geometryKey;
  if (layer.source.kind === "remote") {
    // Panning can evict a remote feature; absence from a viewport is not an input change.
    const current = layer.data.features.find(
      (f) => f.id !== undefined && String(f.id) === input.sourceReference.featureId,
    );
    return (
      !!current &&
      JSON.stringify(polygonBoundaryFeature(current)?.geometry) !==
        JSON.stringify(input.boundary.geometry)
    );
  }
  return !layer.data.features.some(
    (f) =>
      JSON.stringify(polygonBoundaryFeature(f)?.geometry) ===
      JSON.stringify(input.boundary.geometry),
  );
}
export function polygonLayerKey(features: Feature[]): string {
  return JSON.stringify(
    [
      ...new Set(
        features
          .filter((f) => ["Polygon", "MultiPolygon"].includes(f.geometry?.type))
          .map((f) => JSON.stringify(f.geometry)),
      ),
    ].sort(),
  );
}
export function duplicateBuildableSnapshot(snapshot: BuildableSnapshot): BuildableSnapshot {
  const copy = structuredClone(snapshot);
  copy.input.id = crypto.randomUUID();
  copy.input.name += " copy";
  copy.result.components = copy.result.components.map((component, index) => ({
    ...component,
    id: `${copy.input.id}:component:${index + 1}`,
  }));
  copy.result.inputKey = inputKey(copy.input);
  return copy;
}
export function snapshotFromLayer(layer: GisLayer): BuildableSnapshot | null {
  if (layer.source.kind !== "derived") return null;
  const snapshot = layer.source.cacheProvenance?.["buildableArea"] as BuildableSnapshot | undefined;
  return snapshot?.schemaVersion === 1 && snapshot.input?.boundary && snapshot.result?.version
    ? snapshot
    : null;
}
export function buildableExport(snapshot: BuildableSnapshot): FeatureCollection {
  const { input, result } = snapshot;
  const base = {
    ANALYSIS: "Buildable Area",
    analysisId: input.id,
    name: input.name,
    version: result.version,
    calculatedAt: result.calculatedAt,
    calculationCRS: result.crs,
    note: SCREENING_NOTE,
    conditionalExcluded: input.conditionalExcluded,
    incomplete: result.completeness.some((c) => c.status !== "available"),
    automation: input.automation,
    terrain: input.rules.find((r) => r.terrainSummary)?.terrainSummary,
    sources: input.rules.map((r) => ({
      id: r.sourceId,
      url: r.sourceUrl,
      date: r.sourceDate,
      retrievedAt: r.retrievedAt,
    })),
  };
  const features: Feature[] = [
    {
      type: "Feature",
      properties: { ...base, kind: "study", acres: result.studyAcres },
      geometry: result.study,
    },
  ];
  for (const kind of ["excluded", "conditional"] as const) {
    if (result[kind])
      features.push({
        type: "Feature",
        properties: { ...base, kind, acres: result[`${kind}Acres`] },
        geometry: result[kind],
      });
  }
  for (const c of result.components)
    features.push({
      type: "Feature",
      id: c.id,
      properties: {
        ...base,
        kind: "candidate",
        component: c.label,
        acres: c.acres,
        conditionalAcres: c.conditionalAcres,
        belowMinimum: c.belowMinimum,
        access: c.access,
      },
      geometry: c.geometry,
    });
  for (const feature of result.unknownCoverage)
    features.push({ ...feature, properties: { ...base, ...feature.properties, kind: "unknown" } });
  const order: Record<string, number> = {
    study: 0,
    candidate: 1,
    excluded: 2,
    conditional: 3,
    unknown: 4,
  };
  features.sort(
    (a, b) =>
      (order[String(a.properties?.["kind"])] ?? 0) - (order[String(b.properties?.["kind"])] ?? 0),
  );
  return { type: "FeatureCollection", features };
}

/** Preserve the actual polygon parts of mixed imported geometry without using its envelope. */
export function polygonBoundaryFeature(feature: Feature): AreaFeature | null {
  const parts: Polygon["coordinates"][] = [];
  const visit = (g: Feature["geometry"]) => {
    if (!g) return;
    if (g.type === "Polygon") parts.push(g.coordinates);
    else if (g.type === "MultiPolygon") parts.push(...g.coordinates);
    else if (g.type === "GeometryCollection") g.geometries.forEach(visit);
  };
  visit(feature.geometry);
  if (!parts.length) return null;
  return {
    ...feature,
    geometry:
      parts.length === 1
        ? { type: "Polygon", coordinates: parts[0]! }
        : { type: "MultiPolygon", coordinates: parts },
  };
}
/** A saved analysis can be reused as candidate land, never its gross study/exclusion features. */
export function boundaryPolygonFeatures(layer: GisLayer): AreaFeature[] {
  const candidateOnly = Boolean(snapshotFromLayer(layer));
  return layer.data.features.flatMap((f) => {
    if (candidateOnly && f.properties?.["kind"] !== "candidate") return [];
    const polygon = polygonBoundaryFeature(f);
    return polygon ? [polygon] : [];
  });
}
