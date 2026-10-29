import type { Position } from "geojson";

export type EngineeringReadiness =
  "conceptual" | "preliminary-unvalidated" | "engineering-reviewed";

export type ValueProvenance =
  | "measured"
  | "surveyed"
  | "user"
  | "provider"
  | "calculated"
  | "interpolated"
  | "estimated"
  | "allowance";

export type PipelineFluidFamily = "liquid" | "gas" | "advanced";
export type PipelineFluidKind =
  | "freshwater"
  | "potable-water"
  | "wastewater"
  | "brackish-water"
  | "saltwater-brine"
  | "produced-water"
  | "crude-oil"
  | "condensate"
  | "ngl"
  | "refined-product"
  | "natural-gas"
  | "hydrogen"
  | "nitrogen"
  | "co2"
  | "biogas"
  | "ammonia"
  | "dense-phase-co2"
  | "slurry"
  | "custom-liquid"
  | "custom-gas"
  | "custom-fluid";

export interface PipelineFluid {
  id: string;
  name: string;
  family: PipelineFluidFamily;
  kind: PipelineFluidKind;
  densityKgM3?: number;
  dynamicViscosityPaS?: number;
  specificGravity?: number;
  vaporPressurePa?: number;
  compressibility?: number;
  molecularWeight?: number;
  heatCapacityJKgK?: number;
  thermalConductivityWMK?: number;
  composition?: Record<string, number>;
  eos?: "ideal" | "peng-robinson" | "gerg-2008" | "custom";
  source: string;
  projectSpecific?: boolean;
}

export interface ElevationSample {
  id: string;
  stationM: number;
  coordinate: Position;
  groundElevationM: number;
  source: string;
  sourceKind: "dem" | "survey" | "manual";
  resolutionM?: number;
  verticalDatum?: string;
  capturedAt: number;
  quality: "high" | "medium" | "low" | "unknown";
  provenance: ValueProvenance;
}

export interface PipelineStation {
  stationM: number;
  coordinate: Position;
  groundElevationM?: number;
  pipelineElevationM?: number;
  elevationSampleId?: string;
}

export type CrossingType =
  | "paved-road"
  | "highway"
  | "railroad"
  | "stream"
  | "river"
  | "drainage"
  | "utility-corridor"
  | "transmission-corridor"
  | "wetland"
  | "floodplain"
  | "other";

export interface PipelineCrossing {
  id: string;
  routeId: string;
  type: CrossingType;
  stationM: number;
  coordinate: Position;
  source: string;
  sourceFeatureId?: string;
  confidence: "high" | "medium" | "low";
  constructionMethod?: ConstructionMethod;
  estimatedCost?: number;
  currency?: string;
  confirmation: "unreviewed" | "confirmed" | "corrected" | "rejected";
}

export type ConstructionMethod =
  | "open-trench"
  | "plow"
  | "bore"
  | "hdd"
  | "casing"
  | "aerial"
  | "existing-corridor"
  | "aboveground"
  | "other";

export type ConstructionCondition =
  | "normal-soil"
  | "difficult-soil"
  | "shallow-rock-suspected"
  | "rock"
  | "high-groundwater"
  | "steep-terrain"
  | "wetland"
  | "special-crossing";

export interface ConstructionRange {
  id: string;
  routeId: string;
  startStationM: number;
  endStationM: number;
  method: ConstructionMethod;
  conditions: ConstructionCondition[];
  evidence:
    "default" | "model-estimated" | "provider-mapped" | "user-confirmed" | "field-confirmed";
  source?: string;
  notes?: string;
}

export interface PipelineRoute {
  id: string;
  name: string;
  sourceLayerId: string;
  sourceFeatureIndex: number;
  sourceFeatureId?: string;
  geometryHash: string;
  geometryRevision: number;
  coordinates: Position[];
  stations: PipelineStation[];
  elevationSamples: ElevationSample[];
  lengthM: number;
  sourceNodeName: string;
  destinationNodeName: string;
  crossings: PipelineCrossing[];
  constructionRanges: ConstructionRange[];
  createdAt: number;
  updatedAt: number;
}

export interface PipeSpecification {
  id: string;
  name: string;
  serviceFamilies: PipelineFluidFamily[];
  nominalSizeIn: number;
  outsideDiameterM: number;
  wallThicknessM: number;
  insideDiameterM: number;
  schedule?: string;
  sizingSystem?: "IPS" | "DIPS" | "CTS" | "metric";
  dimensionRatio?: number;
  material: "carbon-steel" | "ductile-iron" | "hdpe" | "pvc" | "other";
  grade?: string;
  manufacturingSpecification?: string;
  roughnessM: number;
  coating?: string;
  lining?: string;
  corrosionAllowanceM: number;
  jointType: string;
  joiningMethod: string;
  temperatureMinK?: number;
  temperatureMaxK?: number;
  weightKgM?: number;
  standardLengthM?: number;
  source: string;
  confirmedAt?: number;
  confirmationNotes?: string;
}

export type PipelineComponentKind =
  | "source"
  | "destination"
  | "junction"
  | "branch"
  | "tie-in"
  | "block-valve"
  | "check-valve"
  | "control-valve"
  | "regulator"
  | "relief"
  | "meter"
  | "flow-meter"
  | "pressure-sensor"
  | "temperature-sensor"
  | "filter"
  | "strainer"
  | "heater"
  | "cooler"
  | "centrifugal-pump"
  | "positive-displacement-pump"
  | "booster"
  | "booster-station"
  | "tank"
  | "reservoir"
  | "surge-vessel"
  | "pressure-reduction-station"
  | "compressor"
  | "compressor-station"
  | "regulator-station"
  | "separator-scrubber"
  | "blowdown"
  | "linepack-storage"
  | "pig-launcher"
  | "pig-receiver"
  | "scraper-trap"
  | "mainline-valve"
  | "vent"
  | "drain"
  | "cathodic-protection-station"
  | "cp-test-station";

export interface PipelineComponent {
  id: string;
  routeId: string;
  kind: PipelineComponentKind;
  name: string;
  stationM: number;
  coordinate: Position;
  elevationM?: number;
  properties: Record<string, number | string | boolean | null>;
  source: "user" | "library" | "import";
  createdAt: number;
  updatedAt: number;
}

export interface DesignLimits {
  minimumPressurePa: number;
  maopPa: number;
  minimumPressureMarginPa: number;
  maximumVelocityMS: number;
  maximumMach?: number;
  minimumNpshMarginM?: number;
}

export interface EstimateAssumptions {
  currency: string;
  pipeMaterialPerM?: number;
  installationPerM?: number;
  contingencyPercent: number;
  markupPercent: number;
  evidenceClass: PriceEvidenceClass;
  effectiveDate?: string;
  region?: string;
}

export interface PipelineScenario {
  id: string;
  name: string;
  routeId: string;
  fluidId: string;
  pipeSpecificationId: string;
  solverId: string;
  inletPressurePa: number;
  flowM3S: number;
  temperatureK: number;
  totalMinorLossK: number;
  liveSolve: boolean;
  limits: DesignLimits;
  estimateAssumptions: EstimateAssumptions;
  createdAt: number;
  updatedAt: number;
}

export type SolverRunStatus =
  "solved" | "warning" | "limit-exceeded" | "failed" | "unsupported" | "stale";

export interface SolverFinding {
  id: string;
  severity: "info" | "warning" | "error" | "blocker";
  code: string;
  title: string;
  detail: string;
  stationM?: number;
}

export interface PipelineProfilePoint {
  stationM: number;
  coordinate: Position;
  groundElevationM?: number;
  pipelineElevationM?: number;
  pressurePa: number;
  hydraulicGradeM?: number;
  cumulativeElevationPressureChangePa: number;
  cumulativeFrictionLossPa: number;
  cumulativeMinorLossPa: number;
  cumulativePressureBoostPa: number;
  pressureMarginPa: number;
  minimumPressureMarginPa: number;
  flowM3S: number;
  velocityMS: number;
  temperatureK: number;
  reynoldsNumber: number;
  machNumber?: number;
  frictionFactor: number;
  pressureLossPaPerM: number;
  provenance: ValueProvenance;
  /**
   * Set on the two points a solver emits at a component station where state changes in place
   * (pump boost, valve or meter loss). Values must never be interpolated between such a pair.
   */
  discontinuity?: "upstream" | "downstream";
  componentIds?: string[];
}

export interface PipelineSolverRun {
  id: string;
  scenarioId: string;
  routeId: string;
  solverId: string;
  solverVersion: string;
  readiness: EngineeringReadiness;
  status: SolverRunStatus;
  inputHash: string;
  geometryRevision: number;
  startedAt: number;
  completedAt: number;
  profile: PipelineProfilePoint[];
  findings: SolverFinding[];
}

export type QuantityCategory =
  | "pipe"
  | "earthwork"
  | "crossing"
  | "facility"
  | "clearing-row"
  | "restoration"
  | "testing"
  | "mobilization";

export interface QuantityTakeoffItem {
  id: string;
  category: QuantityCategory;
  description: string;
  quantity: number;
  unit: string;
  formulaVersion: string;
  routeId: string;
  scenarioId: string;
  sourceIds: string[];
  startStationM?: number;
  endStationM?: number;
  assumption?: string;
}

export interface QuantityTakeoffSnapshot {
  id: string;
  scenarioId: string;
  geometryRevision: number;
  createdAt: number;
  items: QuantityTakeoffItem[];
}

export type PriceEvidenceClass =
  | "vendor-quote"
  | "published-current-price"
  | "recent-historical-price"
  | "market-estimate"
  | "budget-allowance";

export interface VendorContact {
  id: string;
  company: string;
  category: string;
  products: string[];
  relationship: "manufacturer" | "distributor" | "contractor" | "other";
  locations: string[];
  serviceArea?: string;
  website?: string;
  mainPhone?: string;
  mainEmail?: string;
  primaryContact?: string;
  salesperson?: string;
  salespersonPhone?: string;
  salespersonEmail?: string;
  preferredLocation?: string;
  notes?: string;
  lastContactAt?: number;
  preferred: boolean;
  approved: boolean;
}

export interface PriceSnapshot {
  id: string;
  productKey: string;
  productDescription: string;
  vendorId?: string;
  manufacturer?: string;
  location?: string;
  unitPrice: number;
  unit: string;
  currency: string;
  availability?: string;
  leadTimeDays?: number;
  freightAmount?: number;
  quoteDate?: string;
  retrievedAt: number;
  source: string;
  evidenceClass: PriceEvidenceClass;
  confidence: "high" | "medium" | "low";
}

export interface PipelineEstimateSummary {
  scenarioId: string;
  currency: string;
  materialCost: number | null;
  installationCost: number | null;
  subtotal: number | null;
  contingency: number | null;
  markup: number | null;
  recommendedBid: number | null;
  evidenceClass: PriceEvidenceClass;
  warnings: string[];
  calculatedAt: number;
}

export type PipelineVisualizationMode =
  | "pressure"
  | "pressure-margin"
  | "minimum-pressure-margin"
  | "velocity"
  | "flow"
  | "pressure-loss-distance"
  | "hydraulic-grade"
  | "elevation"
  | "temperature"
  | "reynolds-number"
  | "mach-number"
  | "npsh-margin"
  | "construction-cost-foot"
  | "installed-cost-segment"
  | "constructability";

export interface PipelineWorkspacePreferences {
  profileOpen: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  visualizationMode: PipelineVisualizationMode;
  selectedRightPanel: "engineering" | "materials" | "quantities" | "costs" | "warnings";
}

export interface PipelineEngineeringState {
  schemaVersion: 1;
  enabled: boolean;
  readiness: EngineeringReadiness;
  activeRouteId?: string;
  activeScenarioId?: string;
  routes: PipelineRoute[];
  fluids: PipelineFluid[];
  pipeSpecifications: PipeSpecification[];
  components: PipelineComponent[];
  scenarios: PipelineScenario[];
  solverRuns: PipelineSolverRun[];
  quantitySnapshots: QuantityTakeoffSnapshot[];
  vendorLibrary: VendorContact[];
  priceSnapshots: PriceSnapshot[];
  latestEstimate?: PipelineEstimateSummary;
  preferences: PipelineWorkspacePreferences;
  createdAt: number;
  updatedAt: number;
}
