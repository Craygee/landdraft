import { bbox, featureCollection, union } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { localProjection } from "../gis/buildableArea.ts";
import { gradePercentAt, planTerrainGrid } from "../gis/buildableTerrain.ts";
import type { BuildableInput, TerrainSettings } from "../gis/buildableAreaModel.ts";
import type { TerrainGrid, TerrainGridRequest } from "../gis/buildableTerrainModel.ts";
import { createStudyFrame, isInsideStudy } from "./geometry.ts";
import type { StudyReportBoundary, StudyReportMeasurement } from "./types.ts";

const FEET_PER_METER = 3.28084;

/** Descriptive bands only. They are not thresholds for what can be built. */
const SLOPE_BANDS = [
  { label: "0–5% grade", max: 5 },
  { label: "5–8% grade", max: 8 },
  { label: "8–15% grade", max: 15 },
  { label: "15–30% grade", max: 30 },
  { label: "Over 30% grade", max: Infinity },
];

function boundaryGeometry(boundary: StudyReportBoundary): Polygon | MultiPolygon {
  const features = boundary.data.features as Feature<Polygon | MultiPolygon>[];
  if (features.length === 1) return features[0]!.geometry;
  const merged = union(featureCollection(features));
  if (!merged) throw new Error("The study boundary could not be combined.");
  return merged.geometry as Polygon | MultiPolygon;
}

/** Same defaults as Buildable Area, so a report and a saved analysis read the same grid. */
const TERRAIN_SETTINGS: TerrainSettings = {
  enabled: true,
  conditionalSlopePercent: 8,
  exclusionSlopePercent: 15,
  reliefM: 3,
  windowM: 50,
  cellSizeM: 10,
};

export function planStudyTerrain(boundary: StudyReportBoundary): TerrainGridRequest {
  return planTerrainGrid(
    {
      boundary: { type: "Feature", properties: {}, geometry: boundaryGeometry(boundary) },
    } as unknown as BuildableInput,
    TERRAIN_SETTINGS,
  );
}

/**
 * Elevation and slope statistics inside the actual polygon, reusing the numeric 3DEP grid and grade
 * calculation that Buildable Area uses. Only cells whose center falls inside the boundary count.
 */
export function measureTerrainFromGrid(
  boundary: StudyReportBoundary,
  grid: TerrainGrid,
): StudyReportMeasurement {
  const geometry = boundaryGeometry(boundary);
  const frame = createStudyFrame(boundary.data.features as Feature<Polygon | MultiPolygon>[]);
  const projection = localProjection(geometry);
  const { width: w, height: h, values: z } = grid;
  const dx = (grid.bbox[2] - grid.bbox[0]) / w;
  const dy = (grid.bbox[3] - grid.bbox[1]) / h;
  let cells = 0;
  let noData = 0;
  let noSlope = 0;
  let low = Infinity;
  let high = -Infinity;
  let sum = 0;
  let maxGrade = 0;
  const bands = SLOPE_BANDS.map(() => 0);
  let graded = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const center = projection.inverse([
        grid.bbox[0] + (x + 0.5) * dx,
        grid.bbox[3] - (y + 0.5) * dy,
      ]);
      if (!isInsideStudy(frame, center)) continue;
      cells += 1;
      const value = z[y * w + x];
      if (value === null || value === undefined) {
        noData += 1;
        continue;
      }
      low = Math.min(low, value);
      high = Math.max(high, value);
      sum += value;
      const grade = gradePercentAt(z, w, h, x, y, dx, dy);
      if (grade === null) {
        noSlope += 1;
        continue;
      }
      graded += 1;
      maxGrade = Math.max(maxGrade, grade);
      bands[SLOPE_BANDS.findIndex((band) => grade < band.max)]! += 1;
    }
  if (!cells || cells === noData)
    throw new Error(
      "USGS returned no elevation inside this boundary. The boundary may be too small for the grid or outside coverage.",
    );
  const valid = cells - noData;
  const feet = (meters: number) =>
    `${Math.round(meters * FEET_PER_METER).toLocaleString("en-US")} ft`;
  const percent = (count: number, of: number) => `${((count / of) * 100).toFixed(1)}%`;
  return {
    id: "terrain-grid",
    title: "Measured elevation and slope",
    method: `USGS 3DEP numeric grid sampled at ${Math.round(dx)} m spacing. Statistics use the ${valid.toLocaleString("en-US")} cells whose centers fall inside the boundary, holes excluded. Slope is the steepest of the Horn 3×3 gradient and the eight-neighbour drop, the same calculation Buildable Area uses.`,
    sourceName: grid.source,
    sourceUrl: grid.sourceUrl,
    retrievedAt: grid.retrievedAt,
    rows: [
      {
        label: "Elevation range",
        value: `${feet(low)} to ${feet(high)}`,
        note: `Relief ${feet(high - low)}`,
      },
      { label: "Mean elevation", value: feet(sum / valid) },
      ...(graded
        ? [
            ...SLOPE_BANDS.map((band, index) => ({
              label: band.label,
              value: percent(bands[index]!, graded),
              note: `of ${graded.toLocaleString("en-US")} graded cells`,
            })),
            {
              label: "Steepest cell",
              value: `${maxGrade.toFixed(0)}% grade`,
              note: "Over one grid cell. Not a surveyed break",
            },
          ]
        : []),
      ...(noData
        ? [{ label: "No elevation data", value: percent(noData, cells), note: "of study cells" }]
        : []),
      ...(noSlope
        ? [
            {
              label: "Slope not calculated",
              value: percent(noSlope, valid),
              note: "A neighboring cell had no data",
            },
          ]
        : []),
    ],
    limitation:
      "Derived estimate from a screening grid, not a survey. Grid spacing is not accuracy, and features narrower than a cell can be missed. Slope bands describe the surface and do not establish buildability. Vertical datum varies by source.",
  };
}

export const NLCD_CLASSES: Record<number, string> = {
  11: "Open water",
  12: "Perennial ice/snow",
  21: "Developed, open space",
  22: "Developed, low intensity",
  23: "Developed, medium intensity",
  24: "Developed, high intensity",
  31: "Barren land",
  41: "Deciduous forest",
  42: "Evergreen forest",
  43: "Mixed forest",
  51: "Dwarf scrub",
  52: "Shrub/scrub",
  71: "Grassland/herbaceous",
  72: "Sedge/herbaceous",
  73: "Lichens",
  74: "Moss",
  81: "Pasture/hay",
  82: "Cultivated crops",
  90: "Woody wetlands",
  95: "Emergent herbaceous wetlands",
};

const NLCD_WMS = "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms";
const NLCD_LAYER = "Land-Cover-Native_conus_year_data";
const NLCD_YEAR = 2025;
export const NLCD_SAMPLE_TARGET = 49;
const NLCD_ATTEMPTS = 4;
const NLCD_PIXEL_TIMEOUT_MS = 6_000;
/** A slow service ends the sample rather than holding up the whole report. */
const NLCD_BUDGET_MS = 45_000;
/** Below this share of readable samples, percentages would not describe the boundary. */
const NLCD_MIN_READABLE = 0.9;

function toWebMercator(lon: number, lat: number): [number, number] {
  return [
    (lon * 20037508.342789244) / 180,
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.342789244) / Math.PI,
  ];
}

export function nlcdPixelUrl(lon: number, lat: number): string {
  const [x, y] = toWebMercator(lon, lat);
  const half = 45;
  const params = new URLSearchParams({
    service: "WMS",
    request: "GetFeatureInfo",
    version: "1.1.1",
    layers: NLCD_LAYER,
    query_layers: NLCD_LAYER,
    styles: "",
    srs: "EPSG:3857",
    bbox: `${x - half},${y - half},${x + half},${y + half}`,
    width: "3",
    height: "3",
    x: "1",
    y: "1",
    info_format: "application/json",
    time: `${NLCD_YEAR}-01-01T00:00:00.000Z`,
  });
  return `${NLCD_WMS}?${params.toString()}`;
}

/** Evenly spaced points inside the polygon, honoring holes and multiple parts. */
export function studySamplePoints(
  boundary: StudyReportBoundary,
  target = NLCD_SAMPLE_TARGET,
): Array<[number, number]> {
  const features = boundary.data.features as Feature<Polygon | MultiPolygon>[];
  const frame = createStudyFrame(features);
  const [west, south, east, north] = bbox(boundary.data);
  const widthM = (east - west) * frame.metersPerLon;
  const heightM = (north - south) * frame.metersPerLat;
  const areaM = boundary.areaAcres * 4046.8564224;
  // The polygon occupies some share of its box. Start from the ideal spacing and widen as needed.
  let spacing = Math.max(30, Math.sqrt(areaM / target));
  for (let attempt = 0; attempt < 8; attempt++) {
    const points: Array<[number, number]> = [];
    for (let y = spacing / 2; y < heightM; y += spacing)
      for (let x = spacing / 2; x < widthM; x += spacing) {
        const point: [number, number] = [
          west + x / frame.metersPerLon,
          south + y / frame.metersPerLat,
        ];
        if (isInsideStudy(frame, point)) points.push(point);
      }
    if (points.length <= target * 1.25) return points;
    spacing *= 1.15;
  }
  return [];
}

export type NlcdPixelReader = (lon: number, lat: number) => Promise<number | null>;

export async function readNlcdPixel(
  lon: number,
  lat: number,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const response = await fetcher(nlcdPixelUrl(lon, lat), {
    signal: AbortSignal.timeout(NLCD_PIXEL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`USGS land cover returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    features?: Array<{ properties?: { PALETTE_INDEX?: number } }>;
  };
  const value = body.features?.[0]?.properties?.PALETTE_INDEX;
  return typeof value === "number" && NLCD_CLASSES[value] ? value : null;
}

/**
 * Land cover as a labeled point sample of source pixels. The service answers point queries, not
 * area statistics, so this reports shares of a sample rather than measured acreage.
 */
export async function measureLandCover(
  boundary: StudyReportBoundary,
  readPixel: NlcdPixelReader,
  retrievedAt: string,
  options: { concurrency?: number; retryDelayMs?: number } = {},
): Promise<StudyReportMeasurement> {
  const points = studySamplePoints(boundary);
  if (!points.length) throw new Error("The boundary is too small to sample 30 m land cover.");
  const retryDelayMs = options.retryDelayMs ?? 500;
  const counts = new Map<number, number>();
  let unreadable = 0;
  let next = 0;
  // The USGS service resets connections under bursts, so requests are gentle and retried. A point
  // outside coverage answers normally with no class and is not retried.
  const read = async (lon: number, lat: number) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await readPixel(lon, lat);
      } catch (error) {
        if (attempt >= NLCD_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  };
  const deadline = Date.now() + NLCD_BUDGET_MS;
  await Promise.all(
    Array.from({ length: options.concurrency ?? 1 }, async () => {
      while (next < points.length) {
        const point = points[next++]!;
        if (Date.now() > deadline) {
          unreadable += 1;
          continue;
        }
        try {
          const value = await read(point[0], point[1]);
          if (value === null) unreadable += 1;
          else counts.set(value, (counts.get(value) ?? 0) + 1);
        } catch {
          unreadable += 1;
        }
      }
    }),
  );
  const readable = points.length - unreadable;
  if (readable / points.length < NLCD_MIN_READABLE)
    throw new Error(
      `Only ${readable} of ${points.length} land-cover samples returned a class, so no percentages are reported. The area may be outside the conterminous U.S. coverage, or the service may be slow or unavailable.`,
    );
  const margin = Math.round(100 * 1.96 * Math.sqrt(0.25 / readable));
  return {
    id: "nlcd-sample",
    title: `Sampled land cover (NLCD ${NLCD_YEAR})`,
    method: `Point sample of ${readable} evenly spaced locations inside the boundary, holes excluded. Each reads the published 30 m Annual NLCD class at that point.`,
    sourceName: "USGS/MRLC Annual NLCD Land Cover",
    sourceUrl: NLCD_WMS,
    retrievedAt,
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({
        label: NLCD_CLASSES[value]!,
        value: `${((count / readable) * 100).toFixed(0)}%`,
        note: `${count} of ${readable} samples`,
      })),
    limitation: `Derived estimate from a point sample, so shares are approximate (up to about ±${margin} percentage points) and acreage is not reported. Small classes can be missed. 30 m classified land cover is not ground verification.`,
  };
}
