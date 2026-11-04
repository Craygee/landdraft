import type { Feature, Polygon } from "geojson";
import type { BuildableInput } from "./buildableAreaModel.ts";
import type { TerrainGrid } from "./buildableTerrainModel.ts";

export type TerrainAnalysisMode = "quick" | "detailed";
export type TerrainBounds = [west: number, south: number, east: number, north: number];

export const TERRAIN_3D_VERSION = "0.1.0";
export const TERRAIN_3D_DEFAULT_ZOOM = 11;
export const TERRAIN_3D_LIMITS_KM2: Record<TerrainAnalysisMode, number> = {
  quick: 100,
  detailed: 4,
};

export const TERRAIN_3D_SOURCES = {
  analysis: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
  terrainTiles: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  baseMap: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  topographic:
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
  imagery:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  wetlands:
    "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0",
} as const;

export function normalizeTerrainBounds(bounds: TerrainBounds): TerrainBounds {
  const west = Math.min(bounds[0], bounds[2]);
  const east = Math.max(bounds[0], bounds[2]);
  const south = Math.min(bounds[1], bounds[3]);
  const north = Math.max(bounds[1], bounds[3]);
  if (![west, south, east, north].every(Number.isFinite))
    throw new Error("Select a valid geographic area.");
  if (west < -180 || east > 180 || south < -85 || north > 85 || east <= west || north <= south)
    throw new Error("Select a non-empty area within supported Web Mercator latitudes.");
  return [west, south, east, north];
}

/** Spherical rectangle area; sufficient for enforcing a conservative request budget. */
export function terrainBoundsAreaKm2(raw: TerrainBounds): number {
  const [west, south, east, north] = normalizeTerrainBounds(raw);
  const radians = Math.PI / 180;
  const earthRadiusKm = 6371.0088;
  return (
    earthRadiusKm ** 2 *
    Math.abs(Math.sin(north * radians) - Math.sin(south * radians)) *
    Math.abs((east - west) * radians)
  );
}

export function validateTerrainSelection(
  raw: TerrainBounds,
  mode: TerrainAnalysisMode,
): { bounds: TerrainBounds; areaKm2: number } {
  const bounds = normalizeTerrainBounds(raw);
  const areaKm2 = terrainBoundsAreaKm2(bounds);
  const limit = TERRAIN_3D_LIMITS_KM2[mode];
  if (areaKm2 > limit)
    throw new Error(
      `${mode === "detailed" ? "Detailed" : "Quick"} analysis is limited to ${limit.toLocaleString()} km². Zoom in or draw a smaller area.`,
    );
  return { bounds, areaKm2 };
}

export function terrainBoundary(bounds: TerrainBounds): Feature<Polygon> {
  const [west, south, east, north] = normalizeTerrainBounds(bounds);
  return {
    type: "Feature",
    properties: { source: "LandDraft terrain 3D selection" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
}

export function terrainAnalysisInput(
  bounds: TerrainBounds,
  mode: TerrainAnalysisMode,
): BuildableInput {
  const boundary = terrainBoundary(bounds);
  return {
    id: `terrain-3d-${mode}`,
    name: `Terrain 3D ${mode} analysis`,
    profile: "general",
    boundary,
    sourceReference: { name: "Selected 3D study area" },
    clipToProperty: false,
    propertySetbackM: 0,
    studyMarginM: 0,
    conditionalExcluded: false,
    minimumComponentAcres: 0,
    requested: ["terrain"],
    rules: [],
    automation: {
      version: TERRAIN_3D_VERSION,
      holdUnresolved: true,
      terrain: {
        enabled: true,
        cellSizeM: mode === "detailed" ? 10 : 40,
        conditionalSlopePercent: 8,
        exclusionSlopePercent: 15,
        reliefM: 3,
        windowM: 50,
      },
    },
  };
}

export interface TerrainGridSummary {
  validCells: number;
  missingCells: number;
  coveragePercent: number;
  minimumM: number | null;
  maximumM: number | null;
  meanM: number | null;
  reliefM: number | null;
  spacingM: number;
}

export function summarizeTerrainMesh(
  rawBounds: TerrainBounds,
  samplesPerSide: number,
  readElevation: (longitude: number, latitude: number) => number | null,
): TerrainGridSummary | null {
  const bounds = normalizeTerrainBounds(rawBounds);
  if (!Number.isInteger(samplesPerSide) || samplesPerSide < 3 || samplesPerSide > 25)
    throw new Error("Use 3–25 display-mesh samples per side.");
  const values: number[] = [];
  const sampleCount = samplesPerSide * samplesPerSide;
  for (let row = 0; row < samplesPerSide; row++) {
    const latitude = bounds[1] + ((bounds[3] - bounds[1]) * row) / (samplesPerSide - 1);
    for (let column = 0; column < samplesPerSide; column++) {
      const longitude = bounds[0] + ((bounds[2] - bounds[0]) * column) / (samplesPerSide - 1);
      const value = readElevation(longitude, latitude);
      if (value !== null && Number.isFinite(value)) values.push(value);
    }
  }
  if (!values.length) return null;
  const minimumM = Math.min(...values);
  const maximumM = Math.max(...values);
  const meanLatitude = ((bounds[1] + bounds[3]) / 2) * (Math.PI / 180);
  const widthM = (bounds[2] - bounds[0]) * 111_320 * Math.cos(meanLatitude);
  const heightM = (bounds[3] - bounds[1]) * 111_320;
  return {
    validCells: values.length,
    missingCells: sampleCount - values.length,
    coveragePercent: (values.length / sampleCount) * 100,
    minimumM,
    maximumM,
    meanM: values.reduce((sum, value) => sum + value, 0) / values.length,
    reliefM: maximumM - minimumM,
    spacingM: (widthM + heightM) / (2 * (samplesPerSide - 1)),
  };
}

export function summarizeTerrainGrid(grid: TerrainGrid): TerrainGridSummary {
  const values = grid.values.filter((value): value is number => value !== null);
  const minimumM = values.length ? Math.min(...values) : null;
  const maximumM = values.length ? Math.max(...values) : null;
  return {
    validCells: values.length,
    missingCells: grid.values.length - values.length,
    coveragePercent: grid.values.length ? (values.length / grid.values.length) * 100 : 0,
    minimumM,
    maximumM,
    meanM: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    reliefM: minimumM === null || maximumM === null ? null : maximumM - minimumM,
    spacingM:
      ((grid.bbox[2] - grid.bbox[0]) / grid.width + (grid.bbox[3] - grid.bbox[1]) / grid.height) /
      2,
  };
}
