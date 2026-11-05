import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

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

export interface StudyReportMetric {
  id: string;
  label: string;
  value: string;
  note?: string;
}

export interface StudyReportSourceReference {
  id: string;
  name: string;
  attribution?: string;
  url?: string;
  retrievedAt?: string;
  evidence: "user" | "public" | "derived" | "project-record";
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
}

export interface StudyReportRun {
  id: string;
  analyzedAt: string;
  boundaryId: string;
  evidenceSignature: string;
  sections: StudyReportSectionResult[];
  warnings: string[];
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
