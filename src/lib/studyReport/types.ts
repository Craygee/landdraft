import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

export type StudyReportCapability =
  | "studyReport.basic"
  | "studyReport.advanced"
  | "studyReport.publicData"
  | "studyReport.export"
  | "studyReport.enterprise";

export type StudyReportSectionId =
  | "executive-summary"
  | "study-area"
  | "land-cover"
  | "terrain"
  | "hydrology"
  | "soils"
  | "site-suitability"
  | "environmental"
  | "infrastructure"
  | "energy"
  | "hazards"
  | "project-records"
  | "data-gaps"
  | "sources";

export type StudyReportEvidenceStatus = "ready" | "partial" | "insufficient";

export interface StudyReportCover {
  title: string;
  subtitle: string;
  company: string;
  logoDataUrl?: string;
}

export interface StudyReportBoundary {
  id: string;
  name: string;
  source: "layer" | "project-area" | "current-view";
  sourceLayerId?: string;
  /** Whether the whole layer or only the chosen polygons form the boundary. */
  sourceFeatures?: "all" | "selected";
  data: FeatureCollection<Polygon | MultiPolygon>;
  bounds: [number, number, number, number];
  areaAcres: number;
  capturedAt: string;
}

export interface StudyReportSectionConfig {
  id: StudyReportSectionId;
  title: string;
  enabled: boolean;
  order: number;
  userNarrative: string;
  narrativeMode: "append" | "replace";
}

/**
 * What a figure is: a mapped record from a publisher, a LandDraft calculation over those records,
 * or an assumption chosen for screening. Professional determinations are never generated.
 */
export type StudyReportBasis = "mapped" | "derived" | "assumption";

export interface StudyReportMetric {
  id: string;
  label: string;
  value: string;
  note?: string;
  basis?: StudyReportBasis;
}

/**
 * How one source behaved in this run. "No features" is only a finding when the query completed;
 * a failed or truncated query says nothing about what is on the ground.
 */
export type StudyReportQueryState =
  "complete" | "truncated" | "failed" | "not-refreshed" | "visual-only" | "project-data";

export interface StudyReportLayerStatus {
  layerId: string;
  state: StudyReportQueryState;
  message?: string;
  retrievedAt?: string;
  loaded?: number;
  /** Publisher-reported total for the query area, when it reported one. */
  expected?: number;
  /** Distance beyond the boundary that this query covered. */
  nearbyMiles?: number;
}

export interface StudyReportSourceReference {
  id: string;
  name: string;
  attribution?: string;
  url?: string;
  retrievedAt?: string;
  evidence: "user" | "public" | "derived" | "project-record";
  /** Publisher documentation page, separate from the query endpoint. */
  sourcePage?: string;
  updateCadence?: string;
  license?: string;
  limitations?: string;
  /** States a state-scoped source covers. An empty result outside them means nothing. */
  coverage?: string;
  queryState?: StudyReportQueryState;
  queryMessage?: string;
}

export interface StudyReportSourceRecommendation {
  name: string;
  url: string;
  note: string;
}

export interface StudyReportAttributeSummary {
  field: string;
  values: Array<{ value: string; count: number }>;
}

export interface StudyReportCoverageClass {
  /** Attribute value, such as a FEMA zone or soil map unit. */
  value: string;
  acres: number;
  percent: number;
}

export interface StudyReportNearbySummary {
  /** Distance searched beyond the boundary, always shown with the count. */
  searchMiles: number;
  count: number;
  nearestMiles?: number;
  /** Compass direction from the study area toward the nearest feature. */
  nearestDirection?: string;
  nearestLabel?: string;
}

export interface StudyReportLayerAnalysis {
  layerId: string;
  name: string;
  featureCount: number;
  pointCount: number;
  lineCount: number;
  polygonCount: number;
  mappedCoverageAcres?: number;
  mappedCoveragePercent?: number;
  attributes: StudyReportAttributeSummary[];
  note?: string;
  /** Sum of on-site line lengths. Parallel records are not deduplicated. */
  onSiteLineMiles?: number;
  classField?: string;
  coverageClasses?: StudyReportCoverageClass[];
  nearby?: StudyReportNearbySummary;
  /** Polygons that describe the area generally, such as a watershed or census tract. */
  context?: boolean;
  /** Features excluded from area and length because their geometry could not be processed. */
  invalidFeatures?: number;
}

export interface StudyReportSectionGuidance {
  whyItMatters: string;
  notEvaluated: string[];
  nextSteps: string[];
}

export interface StudyReportMeasurement {
  id: string;
  title: string;
  method: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
  rows: Array<{ label: string; value: string; note?: string }>;
  limitation: string;
}

export interface StudyReportMeasurementFailure {
  id: string;
  title: string;
  message: string;
}

export interface StudyReportSectionAnalysis {
  method: string;
  intersectingFeatures: number;
  pointCount: number;
  lineCount: number;
  polygonCount: number;
  mappedCoverageAcres?: number;
  mappedCoveragePercent?: number;
  layers: StudyReportLayerAnalysis[];
}

export interface StudyReportSectionResult {
  id: StudyReportSectionId;
  title: string;
  status: StudyReportEvidenceStatus;
  generatedNarrative: string;
  metrics: StudyReportMetric[];
  layerIds: string[];
  /** Layers with evidence that should actually appear on this section's report map. */
  mapLayerIds?: string[];
  analysis?: StudyReportSectionAnalysis;
  sources: StudyReportSourceReference[];
  recommendations?: StudyReportSourceRecommendation[];
  gapMessage?: string;
  analyzedAt: string;
  guidance?: StudyReportSectionGuidance;
  /** Mapped findings worth reading first. These restate records and draw no conclusions. */
  highlights?: string[];
  measurements?: StudyReportMeasurement[];
  measurementFailures?: StudyReportMeasurementFailure[];
}

/** Bounded copy of what each figure drew, because viewport layers are not stored with a project. */
export interface StudyReportFigureSnapshot {
  features: Record<string, Feature[]>;
  truncated: boolean;
}

export interface StudyReportRun {
  id: string;
  analyzedAt: string;
  boundaryId: string;
  evidenceSignature: string;
  sections: StudyReportSectionResult[];
  warnings: string[];
  layerStatuses?: StudyReportLayerStatus[];
  figureSnapshot?: StudyReportFigureSnapshot;
}

export interface StudyReportWorkspaceState {
  schemaVersion: 1;
  capabilities: StudyReportCapability[];
  cover: StudyReportCover;
  boundary?: StudyReportBoundary;
  sections: StudyReportSectionConfig[];
  currentRun?: StudyReportRun;
  updatedAt: string;
}
