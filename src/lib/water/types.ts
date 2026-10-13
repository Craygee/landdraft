import type { Feature, MultiPolygon, Point, Polygon } from "geojson";

export type WaterClassification = "OBSERVED" | "DERIVED" | "INTERPOLATED" | "MODELED" | "INFERRED";
export type WaterArea = Feature<Polygon | MultiPolygon>;
export type WaterSourceId =
  | "usgs-sites"
  | "twdb-wells"
  | "twdb-well-reports"
  | "usgs-measurements"
  | "twdb-aquifers"
  | "twdb-minor-aquifers";
export interface WaterSource {
  id: WaterSourceId;
  agency: string;
  title: string;
  url: string;
  endpoint: string;
  terms: string;
  attribution: string;
  coverage: string;
  license: "PUBLIC_OPEN" | "REVIEW_REQUIRED";
  enabled: boolean;
  exportAllowed: boolean;
  cacheSeconds: number;
  reviewedAt: string;
}
export interface WaterRecord {
  id: string;
  sourceId: WaterSourceId;
  sourceRecordId: string;
  name: string;
  kind: string;
  geometry: Point | Polygon | MultiPolygon;
  classification: WaterClassification;
  evidence: "Source reported";
  aquifer: string | null;
  county: string | null;
  state: string | null;
  huc: string | null;
  depth: number | null;
  depthUnit: "ft" | null;
  verticalDatum: string | null;
  locationAccuracy: string | null;
  observationTime: string | null;
  retrievedAt: string;
  sourceUrl: string;
  raw: Record<string, unknown>;
  flags: string[];
  measurement?: {
    parameterCode: string;
    originalValue: string;
    value: number | null;
    unit: string | null;
    approval: string | null;
    qualifier: string | null;
  };
}
export interface WaterSourceResult {
  sourceId: WaterSourceId;
  status: "available" | "degraded" | "unavailable" | "rate-limited" | "outside-coverage";
  retrievedAt: string;
  records: WaterRecord[];
  message: string;
  truncated: boolean;
  requestUrl: string;
  rejectedCount: number;
}
export interface WaterAnalysis {
  id: string;
  version: "water-evidence-1" | "water-analysis-2";
  area: WaterArea;
  createdAt: string;
  results: WaterSourceResult[];
  studies?: HydrogeologyStudies;
}

export type WellColorMode = "depth" | "aquifer" | "type";

export interface AquiferStudySummary {
  name: string;
  extentType: "major" | "minor" | "well-assignment-only";
  mappedAreaAcres: number | null;
  wellCount: number;
  depthSampleCount: number;
  minimumDepthFt: number | null;
  medianDepthFt: number | null;
  maximumDepthFt: number | null;
  depthSurfaceStatus: "AVAILABLE" | "INSUFFICIENT_DATA";
  yieldSampleCount: number;
  minimumYieldGpm: number | null;
  medianYieldGpm: number | null;
  maximumYieldGpm: number | null;
  yieldSurfaceStatus: "AVAILABLE" | "INSUFFICIENT_DATA";
  reportedUses: Record<string, number>;
  earliestCompletionYear: number | null;
  latestCompletionYear: number | null;
  storageVolumeStatus: "UNAVAILABLE";
  storageVolumeReason: string;
}

export interface InterpolationStudySummary {
  id: "depth-to-water" | "groundwater-elevation";
  label: string;
  status: "AVAILABLE" | "INSUFFICIENT_DATA";
  sampleCount: number;
  unit: string | null;
  verticalDatum: string | null;
  minimum: number | null;
  median: number | null;
  maximum: number | null;
  method: string;
  limitation: string;
}

export interface HydrogeologyStudies {
  version: "hydro-screening-1" | "hydro-screening-2";
  generatedAt: string;
  wellCount: number;
  depthSampleCount: number;
  depthBands: Record<string, number>;
  aquifers: AquiferStudySummary[];
  interpolation: InterpolationStudySummary[];
  limitations: string[];
}

export interface WellSiteAquiferProfile {
  name: string;
  extentType: AquiferStudySummary["extentType"];
  depthSampleCount: number;
  estimatedCompletionDepthFt: number | null;
  minimumCompletionDepthFt: number | null;
  maximumCompletionDepthFt: number | null;
  yieldSampleCount: number;
  estimatedYieldGpm: number | null;
  minimumYieldGpm: number | null;
  maximumYieldGpm: number | null;
  nearbyReportedUses: Record<string, number>;
  earliestCompletionYear: number | null;
  latestCompletionYear: number | null;
  nearestWellMiles: number | null;
  confidence: "LOW" | "MODERATE" | "HIGH";
  limitation: string;
}

export interface WellSiteProfile {
  coordinate: [number, number];
  searchRadiusMiles: number;
  generatedAt: string;
  aquifers: WellSiteAquiferProfile[];
  limitation: string;
}
export interface WaterWorkspaceState {
  version: 1;
  enabled: boolean;
  area?: WaterArea;
  analysis?: WaterAnalysis;
}

// Extension contract; optional methods are absent until their adapter is verified.
export interface WaterAdapter {
  metadata(): WaterSource;
  fetchFeatures(area: WaterArea): Promise<WaterSourceResult>;
  healthCheck(): Promise<{ status: string; checkedAt: string }>;
  fetchTimeSeries?: (siteId: string) => Promise<unknown>;
  fetchDocuments?: (area: WaterArea) => Promise<unknown>;
}
export const WATER_DISCLAIMER =
  "LandDraft Water is desktop-level hydrogeologic screening based on available public/user-provided information. Subsurface conditions can vary; aquifer depths, yields, quality, availability and production potential require field verification and appropriate professional evaluation before drilling, acquisition, design or investment decisions.";
