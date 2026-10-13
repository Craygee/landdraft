import {
  area as turfArea,
  bbox,
  booleanPointInPolygon,
  distance,
  featureCollection,
  intersect,
  point,
} from "@turf/turf";
import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";

import { defaultStyle, type LayerStyle } from "../gis/types.ts";
import type {
  AquiferStudySummary,
  HydrogeologyStudies,
  InterpolationStudySummary,
  WaterArea,
  WaterRecord,
  WellSiteProfile,
  WellColorMode,
} from "./types";

export interface HydrologyLayerProduct {
  name: string;
  description: string;
  data: FeatureCollection;
  style: LayerStyle;
}

export interface HydrologyProducts {
  studies: HydrogeologyStudies;
  layers: HydrologyLayerProduct[];
}

const palettes = {
  depth: ["#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8", "#172554"],
  aquifer: [
    "#0f766e",
    "#2563eb",
    "#7c3aed",
    "#c2410c",
    "#15803d",
    "#be123c",
    "#0369a1",
    "#a16207",
    "#6d28d9",
    "#0e7490",
    "#4d7c0f",
    "#b91c1c",
  ],
  surface: ["#eff6ff", "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"],
  density: ["#ecfeff", "#67e8f9", "#06b6d4", "#0e7490"],
  yield: ["#f7fee7", "#bef264", "#65a30d", "#3f6212", "#1a2e05"],
};

export const wellDepthBand = (depth: number | null) => {
  if (depth === null || !Number.isFinite(depth)) return "Unknown";
  if (depth < 100) return "0–99 ft";
  if (depth < 300) return "100–299 ft";
  if (depth < 600) return "300–599 ft";
  if (depth < 1_000) return "600–999 ft";
  return "1,000+ ft";
};

const numeric = (values: Array<number | null | undefined>) =>
  values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const depthStats = (records: WaterRecord[]) => {
  const values = numeric(records.map((record) => record.depth));
  return {
    count: values.length,
    minimum: values.length ? Math.min(...values) : null,
    median: median(values),
    maximum: values.length ? Math.max(...values) : null,
  };
};

const pointRecords = (records: WaterRecord[]) =>
  records.filter(
    (record) =>
      record.geometry.type === "Point" &&
      (record.sourceId === "usgs-sites" ||
        record.sourceId === "twdb-wells" ||
        record.sourceId === "twdb-well-reports"),
  );

const normalizeAquiferName = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const sameAquifer = (left: string | null | undefined, right: string | null | undefined) => {
  const a = normalizeAquiferName(left);
  const b = normalizeAquiferName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
};

const reportedUse = (record: WaterRecord) => {
  const value = record.raw["PrimaryWaterUse"] ?? record.raw["ProposedUse"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const reportedYieldGpm = (record: WaterRecord) => {
  const raw = [
    record.raw["WellYield"],
    record.raw["WELL_YIELD"],
    record.raw["YieldGpm"],
    record.raw["PumpingRateorWellYield"],
  ].find((value) => value !== null && value !== undefined && value !== "");
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0 && value < 100_000 ? value : null;
};

const useCounts = (records: WaterRecord[]) => {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const use = reportedUse(record);
    if (use) counts[use] = (counts[use] ?? 0) + 1;
  }
  return counts;
};

const completionYearRange = (records: WaterRecord[]) => {
  const years = records.flatMap((record) => {
    const parsed = Date.parse(record.observationTime ?? "");
    return Number.isFinite(parsed) ? [new Date(parsed).getUTCFullYear()] : [];
  });
  return {
    earliest: years.length ? Math.min(...years) : null,
    latest: years.length ? Math.max(...years) : null,
  };
};

const displayAquifer = (record: WaterRecord) => record.aquifer?.trim() || "Aquifer unknown";

const depthRules = ["0–99 ft", "100–299 ft", "300–599 ft", "600–999 ft", "1,000+ ft"].map(
  (value, index) => ({
    value,
    label: value,
    color: palettes.depth[index]!,
    visible: true,
  }),
);

const distinctRules = (values: string[], palette = palettes.aquifer) =>
  [...new Set(values)]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, palette.length)
    .map((value, index) => ({
      value,
      label: value,
      color: palette[index % palette.length]!,
      visible: true,
    }));

export function wellStyle(mode: WellColorMode, records: WaterRecord[]): LayerStyle {
  const base = {
    ...defaultStyle(2),
    fillColor: "#2563eb",
    fillOpacity: 0.9,
    strokeColor: "#ffffff",
    strokeWidth: 1,
    pointSize: 6,
  };
  const field = mode === "depth" ? "depthClass" : mode === "aquifer" ? "aquifer" : "wellType";
  const rules =
    mode === "depth"
      ? depthRules
      : distinctRules(
          records.map((record) =>
            mode === "aquifer" ? displayAquifer(record) : record.kind || "Type unknown",
          ),
        );
  return {
    ...base,
    categorized: {
      enabled: true,
      field,
      rules,
      fallbackColor: "#94a3b8",
      fallbackVisible: true,
    },
  };
}

const wellFeatures = (records: WaterRecord[]): Feature<Point>[] =>
  records.map((record) => ({
    type: "Feature",
    geometry: record.geometry as Point,
    properties: {
      waterRecordId: record.id,
      NAME: record.name,
      source: record.sourceId,
      sourceRecordId: record.sourceRecordId,
      sourceUrl: record.sourceUrl,
      aquifer: displayAquifer(record),
      wellType: record.kind || "Type unknown",
      depthFt: record.depth,
      depthClass: wellDepthBand(record.depth),
      classification: "OBSERVED",
      analysisMethod: "Source attributes grouped by LandDraft; values are not inferred",
    },
  }));

const square = (
  west: number,
  south: number,
  east: number,
  north: number,
  properties: Record<string, unknown>,
): Feature<Polygon> => ({
  type: "Feature",
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
  properties,
});

interface GridCell {
  row: number;
  column: number;
  center: [number, number];
  bounds: [number, number, number, number];
  value?: number;
}

const studyGrid = (study: WaterArea, target = 14): GridCell[] => {
  const [west, south, east, north] = bbox(study);
  const width = Math.max(east! - west!, 0.0001);
  const height = Math.max(north! - south!, 0.0001);
  const columns = Math.max(4, Math.min(24, Math.round(target * Math.sqrt(width / height))));
  const rows = Math.max(4, Math.min(24, Math.round(target * Math.sqrt(height / width))));
  const dx = width / columns;
  const dy = height / rows;
  const cells: GridCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = west! + column * dx;
      const y0 = south! + row * dy;
      const x1 = x0 + dx;
      const y1 = y0 + dy;
      const center: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (booleanPointInPolygon(point(center), study))
        cells.push({ row, column, center, bounds: [x0, y0, x1, y1] });
    }
  }
  return cells;
};

const densityProduct = (study: WaterArea, wells: WaterRecord[]): HydrologyLayerProduct | null => {
  if (!wells.length) return null;
  const features = studyGrid(study, 11).flatMap((cell) => {
    const count = wells.filter((record) =>
      booleanPointInPolygon(record.geometry as Point, square(...cell.bounds, {})),
    ).length;
    if (!count) return [];
    const densityClass = count === 1 ? "1" : count <= 4 ? "2–4" : count <= 9 ? "5–9" : "10+";
    return [
      square(...cell.bounds, {
        NAME: `${count} mapped well${count === 1 ? "" : "s"}`,
        wellCount: count,
        densityClass,
        classification: "DERIVED",
        analysisMethod: "Count of retrieved source wells per analysis grid cell",
      }),
    ];
  });
  if (!features.length) return null;
  return {
    name: "Hydrology analysis · Mapped well density",
    description:
      "Retrieved source-well count by analysis grid cell; absence is not proof of no wells.",
    data: featureCollection(features),
    style: {
      ...defaultStyle(5),
      fillOpacity: 0.42,
      strokeWidth: 1,
      categorized: {
        enabled: true,
        field: "densityClass",
        rules: ["1", "2–4", "5–9", "10+"].map((value, index) => ({
          value,
          label: `${value} wells`,
          color: palettes.density[index]!,
          visible: true,
        })),
        fallbackColor: "#cbd5e1",
        fallbackVisible: true,
      },
    },
  };
};

interface MeasurementPoint {
  record: WaterRecord;
  coordinates: [number, number];
  value: number;
}

const comparableMeasurements = (records: WaterRecord[], parameterCode: string) => {
  const bySite = new Map<string, MeasurementPoint>();
  for (const record of records) {
    const measurement = record.measurement;
    if (
      record.geometry.type !== "Point" ||
      measurement?.parameterCode !== parameterCode ||
      measurement.value === null ||
      !Number.isFinite(measurement.value) ||
      !measurement.unit?.toLowerCase().includes("ft")
    )
      continue;
    const site = String(record.raw["monitoring_location_id"] ?? record.sourceRecordId);
    const existing = bySite.get(site);
    if (
      !existing ||
      Date.parse(record.observationTime ?? "") > Date.parse(existing.record.observationTime ?? "")
    )
      bySite.set(site, {
        record,
        coordinates: record.geometry.coordinates as [number, number],
        value: measurement.value,
      });
  }
  return [...bySite.values()];
};

const surfaceSummary = (
  id: InterpolationStudySummary["id"],
  label: string,
  samples: MeasurementPoint[],
): InterpolationStudySummary => {
  const values = samples.map((sample) => sample.value);
  const available = samples.length >= 3;
  return {
    id,
    label,
    status: available ? "AVAILABLE" : "INSUFFICIENT_DATA",
    sampleCount: samples.length,
    unit: samples[0]?.record.measurement?.unit ?? null,
    verticalDatum: id === "groundwater-elevation" ? "NGVD29 (USGS parameter 62610)" : null,
    minimum: values.length ? Math.min(...values) : null,
    median: median(values),
    maximum: values.length ? Math.max(...values) : null,
    method: available
      ? "Inverse-distance weighting (power 2) over a bounded LandDraft screening grid"
      : "Interpolation withheld until at least three comparable source measurements are available",
    limitation:
      id === "groundwater-elevation"
        ? "A screening potentiometric surface; sparse or clustered wells, pumping and aquifer mixing can distort gradients."
        : "Depth below land surface is not hydraulic head and does not establish groundwater-flow direction.",
  };
};

const valueBreaks = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => sorted[Math.round((sorted.length - 1) * ratio)]!);
};

const idwValue = (coordinate: [number, number], samples: MeasurementPoint[]) => {
  let weighted = 0;
  let weights = 0;
  for (const sample of samples) {
    const km = distance(point(coordinate), point(sample.coordinates), { units: "kilometers" });
    if (km < 0.001) return sample.value;
    const weight = 1 / km ** 2;
    weighted += sample.value * weight;
    weights += weight;
  }
  return weights ? weighted / weights : Number.NaN;
};

const surfaceProducts = (
  study: WaterArea,
  samples: MeasurementPoint[],
  id: InterpolationStudySummary["id"],
): HydrologyLayerProduct[] => {
  if (samples.length < 3) return [];
  const grid = studyGrid(study, 14).map((cell) => ({
    ...cell,
    value: idwValue(cell.center, samples),
  }));
  const values = grid.map((cell) => cell.value).filter(Number.isFinite) as number[];
  if (!values.length) return [];
  const breaks = valueBreaks(values);
  const bandFor = (value: number) => {
    const index = Math.max(
      0,
      Math.min(
        4,
        breaks.findIndex((limit) => value <= limit),
      ),
    );
    return `Q${index + 1}`;
  };
  const label = id === "groundwater-elevation" ? "Groundwater elevation" : "Depth to water";
  const cells = grid.map((cell) =>
    square(...cell.bounds, {
      NAME: `${label}: ${cell.value!.toFixed(1)} ft`,
      value: Number(cell.value!.toFixed(2)),
      unit: "ft",
      valueBand: bandFor(cell.value!),
      sampleCount: samples.length,
      classification: "INTERPOLATED",
      analysisMethod: "LandDraft IDW power 2 screening grid",
      sourceParameter: id === "groundwater-elevation" ? "USGS 62610" : "USGS 72019",
    }),
  );
  const products: HydrologyLayerProduct[] = [
    {
      name: `Hydrology analysis · ${label} screening surface`,
      description: `${label} interpolation from comparable USGS measurements; inspect source age and limitations.`,
      data: featureCollection(cells),
      style: {
        ...defaultStyle(2),
        fillOpacity: 0.48,
        strokeOpacity: 0.35,
        strokeWidth: 0.6,
        categorized: {
          enabled: true,
          field: "valueBand",
          rules: ["Q1", "Q2", "Q3", "Q4", "Q5"].map((value, index) => ({
            value,
            label: `${breaks[index]!.toFixed(1)} ft`,
            color: palettes.surface[index]!,
            visible: true,
          })),
          fallbackColor: "#94a3b8",
          fallbackVisible: true,
        },
      },
    },
  ];
  if (id === "groundwater-elevation") {
    const byPosition = new Map(grid.map((cell) => [`${cell.row}:${cell.column}`, cell]));
    const vectors: Feature<LineString>[] = [];
    for (const cell of grid.filter((item) => item.row % 2 === 0 && item.column % 2 === 0)) {
      const neighbors = [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ]
        .map(([dr, dc]) => byPosition.get(`${cell.row + dr!}:${cell.column + dc!}`))
        .filter((item): item is GridCell & { value: number } => Boolean(item?.value !== undefined));
      const lower = neighbors.sort((left, right) => left.value - right.value)[0];
      if (!lower || cell.value! - lower.value < 0.1) continue;
      vectors.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [cell.center, lower.center] },
        properties: {
          NAME: `Potential gradient ${cell.value!.toFixed(1)} → ${lower.value.toFixed(1)} ft`,
          headDropFt: Number((cell.value! - lower.value).toFixed(2)),
          classification: "DERIVED",
          analysisMethod: "Down-gradient connection between adjacent IDW screening cells",
        },
      });
    }
    if (vectors.length)
      products.push({
        name: "Hydrology analysis · Potential groundwater gradient",
        description:
          "Down-gradient screening vectors from the interpolated groundwater-elevation surface; not surveyed flow paths.",
        data: featureCollection(vectors),
        style: {
          ...defaultStyle(4),
          fillColor: "#7c3aed",
          strokeColor: "#7c3aed",
          strokeWidth: 2,
          strokePattern: "dashed",
          fillOpacity: 0,
        },
      });
  }
  return products;
};

const clippedAquiferArea = (
  extent: WaterRecord | undefined,
  study: WaterArea,
): WaterArea | null => {
  if (!extent || extent.geometry.type === "Point") return null;
  try {
    return (intersect(
      featureCollection([{ type: "Feature", properties: {}, geometry: extent.geometry }, study]),
    ) ?? null) as WaterArea | null;
  } catch {
    return null;
  }
};

const wellsForAquifer = (wells: WaterRecord[], name: string, extent: WaterRecord | undefined) =>
  wells.filter((record) => {
    if (sameAquifer(record.aquifer, name)) return true;
    const geometry = extent?.geometry;
    if (!geometry || geometry.type === "Point" || record.geometry.type !== "Point") return false;
    return booleanPointInPolygon(record.geometry, {
      type: "Feature",
      properties: {},
      geometry,
    });
  });

const samplePoints = (
  records: WaterRecord[],
  valueFor: (record: WaterRecord) => number | null,
): MeasurementPoint[] =>
  records.flatMap((record) => {
    const value = valueFor(record);
    return record.geometry.type === "Point" && value !== null
      ? [{ record, coordinates: record.geometry.coordinates as [number, number], value }]
      : [];
  });

const quantileBand = (value: number, breaks: number[]) => {
  const found = breaks.findIndex((limit) => value <= limit);
  return `Q${Math.max(1, Math.min(5, (found < 0 ? 4 : found) + 1))}`;
};

const aquiferSurfaceProducts = (
  area: WaterArea | null,
  name: string,
  aquiferWells: WaterRecord[],
): HydrologyLayerProduct[] => {
  if (!area) return [];
  const products: HydrologyLayerProduct[] = [];
  const depthSamples = samplePoints(aquiferWells, (record) => record.depth);
  const yieldSamples = samplePoints(aquiferWells, reportedYieldGpm);

  const createSurface = (
    samples: MeasurementPoint[],
    measure: "completion depth" | "reported yield",
    palette: string[],
    unit: "ft" | "gpm",
  ) => {
    if (samples.length < 3) return null;
    const grid = studyGrid(area, 12).map((cell) => ({
      ...cell,
      value: idwValue(cell.center, samples),
    }));
    const values = grid.map((cell) => cell.value).filter(Number.isFinite) as number[];
    if (!values.length) return null;
    const breaks = valueBreaks(values);
    const cells = grid.map((cell) =>
      square(...cell.bounds, {
        NAME: `${name} estimated ${measure}: ${cell.value!.toFixed(1)} ${unit}`,
        aquifer: name,
        value: Number(cell.value!.toFixed(2)),
        unit,
        valueBand: quantileBand(cell.value!, breaks),
        sampleCount: samples.length,
        classification: "INTERPOLATED",
        analysisMethod: "LandDraft IDW power 2 aquifer-screening grid",
        limitation:
          measure === "completion depth"
            ? "Nearby completed-well depths are not aquifer-top or aquifer-bottom elevations."
            : "Source-reported well yield is not sustainable aquifer yield or a drilling guarantee.",
      }),
    );
    return {
      grid,
      breaks,
      product: {
        name: `Hydrology analysis · ${name} · Estimated ${measure}`,
        description:
          measure === "completion depth"
            ? `LandDraft screening surface from ${samples.length} nearby source-reported completed-well depths spatially associated with ${name}.`
            : `LandDraft screening surface from ${samples.length} source-reported well-yield observations associated with ${name}.`,
        data: featureCollection(cells),
        style: {
          ...defaultStyle(2),
          fillOpacity: 0.52,
          strokeOpacity: 0.3,
          strokeWidth: 0.5,
          categorized: {
            enabled: true,
            field: "valueBand",
            rules: ["Q1", "Q2", "Q3", "Q4", "Q5"].map((value, index) => ({
              value,
              label: `${breaks[index]!.toFixed(0)} ${unit}`,
              color: palette[index]!,
              visible: true,
            })),
            fallbackColor: "#94a3b8",
            fallbackVisible: true,
          },
        },
      } satisfies HydrologyLayerProduct,
    };
  };

  const depth = createSurface(depthSamples, "completion depth", palettes.surface, "ft");
  if (depth) products.push(depth.product);
  const yieldSurface = createSurface(yieldSamples, "reported yield", palettes.yield, "gpm");
  if (yieldSurface) {
    products.push(yieldSurface.product);
    const threshold = [...yieldSurface.grid]
      .map((cell) => cell.value!)
      .sort((left, right) => left - right)[Math.floor(yieldSurface.grid.length * 0.8)]!;
    const highest = yieldSurface.grid
      .filter((cell) => cell.value! >= threshold)
      .map((cell) =>
        square(...cell.bounds, {
          NAME: `${name} higher reported-yield evidence: ${cell.value!.toFixed(1)} gpm`,
          aquifer: name,
          estimatedYieldGpm: Number(cell.value!.toFixed(2)),
          classification: "INTERPOLATED",
          analysisMethod: "Upper fifth of LandDraft IDW reported-yield screening surface",
          limitation:
            "Relative evidence area; not a guarantee of yield, quality or sustainability.",
        }),
      );
    products.push({
      name: `Hydrology analysis · ${name} · Higher anticipated yield evidence`,
      description:
        "Upper fifth of the reported-yield screening surface. Field testing and hydrogeologic review remain required.",
      data: featureCollection(highest),
      style: {
        ...defaultStyle(4),
        fillColor: "#84cc16",
        fillOpacity: 0.22,
        strokeColor: "#365314",
        strokeWidth: 2,
        strokePattern: "dashed",
      },
    });
  }
  return products;
};

const aquiferSummaries = (
  records: WaterRecord[],
  wells: WaterRecord[],
  study: WaterArea,
): AquiferStudySummary[] => {
  const names = new Set([
    ...records.flatMap((record) => (record.aquifer ? [record.aquifer] : [])),
    ...records
      .filter(
        (record) =>
          record.sourceId === "twdb-aquifers" || record.sourceId === "twdb-minor-aquifers",
      )
      .map((record) => record.name),
  ]);
  return [...names]
    .map((name) => {
      const extent = records.find(
        (record) =>
          (record.sourceId === "twdb-aquifers" || record.sourceId === "twdb-minor-aquifers") &&
          (sameAquifer(record.aquifer, name) || sameAquifer(record.name, name)),
      );
      const assigned = wellsForAquifer(wells, name, extent);
      const stats = depthStats(assigned);
      const yields = numeric(assigned.map(reportedYieldGpm));
      const completionYears = completionYearRange(assigned);
      let mappedAreaAcres: number | null = null;
      if (extent && extent.geometry.type !== "Point") {
        try {
          const clipped = intersect(
            featureCollection([
              { type: "Feature", properties: {}, geometry: extent.geometry },
              study,
            ]),
          );
          if (clipped) mappedAreaAcres = turfArea(clipped) / 4046.8564224;
        } catch {
          mappedAreaAcres = null;
        }
      }
      return {
        name,
        extentType:
          extent?.sourceId === "twdb-aquifers"
            ? "major"
            : extent?.sourceId === "twdb-minor-aquifers"
              ? "minor"
              : "well-assignment-only",
        mappedAreaAcres,
        wellCount: assigned.length,
        depthSampleCount: stats.count,
        minimumDepthFt: stats.minimum,
        medianDepthFt: stats.median,
        maximumDepthFt: stats.maximum,
        depthSurfaceStatus:
          clippedAquiferArea(extent, study) && stats.count >= 3 ? "AVAILABLE" : "INSUFFICIENT_DATA",
        yieldSampleCount: yields.length,
        minimumYieldGpm: yields.length ? Math.min(...yields) : null,
        medianYieldGpm: median(yields),
        maximumYieldGpm: yields.length ? Math.max(...yields) : null,
        yieldSurfaceStatus:
          clippedAquiferArea(extent, study) && yields.length >= 3
            ? "AVAILABLE"
            : "INSUFFICIENT_DATA",
        reportedUses: useCounts(assigned),
        earliestCompletionYear: completionYears.earliest,
        latestCompletionYear: completionYears.latest,
        storageVolumeStatus: "UNAVAILABLE",
        storageVolumeReason:
          "Mapped footprint and well depths do not provide saturated thickness, porosity/specific yield, confinement or recoverable storage.",
      } satisfies AquiferStudySummary;
    })
    .sort((left, right) => right.wellCount - left.wellCount || left.name.localeCompare(right.name));
};

export function buildHydrologyProducts(
  records: WaterRecord[],
  study: WaterArea,
  wellColorMode: WellColorMode = "depth",
): HydrologyProducts {
  const wells = pointRecords(records);
  const depth = depthStats(wells);
  const depthToWater = comparableMeasurements(records, "72019");
  const groundwaterElevation = comparableMeasurements(records, "62610");
  const layers: HydrologyLayerProduct[] = [];
  if (wells.length)
    layers.push({
      name: "Hydrology analysis · Wells by attributes",
      description: "Retrieved well records colored by the selected source attribute.",
      data: featureCollection(wellFeatures(wells)),
      style: wellStyle(wellColorMode, wells),
    });
  const density = densityProduct(study, wells);
  if (density) layers.push(density);
  layers.push(...surfaceProducts(study, depthToWater, "depth-to-water"));
  layers.push(...surfaceProducts(study, groundwaterElevation, "groundwater-elevation"));
  const aquifers = aquiferSummaries(records, wells, study);
  for (const aquifer of aquifers) {
    const extent = records.find(
      (record) =>
        (record.sourceId === "twdb-aquifers" || record.sourceId === "twdb-minor-aquifers") &&
        (sameAquifer(record.name, aquifer.name) || sameAquifer(record.aquifer, aquifer.name)),
    );
    layers.push(
      ...aquiferSurfaceProducts(
        clippedAquiferArea(extent, study),
        aquifer.name,
        wellsForAquifer(wells, aquifer.name, extent),
      ),
    );
  }
  const depthBands = Object.fromEntries(
    ["0–99 ft", "100–299 ft", "300–599 ft", "600–999 ft", "1,000+ ft", "Unknown"].map((band) => [
      band,
      wells.filter((record) => wellDepthBand(record.depth) === band).length,
    ]),
  );
  return {
    layers,
    studies: {
      version: "hydro-screening-2",
      generatedAt: new Date().toISOString(),
      wellCount: wells.length,
      depthSampleCount: depth.count,
      depthBands,
      aquifers,
      interpolation: [
        surfaceSummary("depth-to-water", "Depth to water below land surface", depthToWater),
        surfaceSummary(
          "groundwater-elevation",
          "Groundwater elevation above NGVD29",
          groundwaterElevation,
        ),
      ],
      limitations: [
        "Well records show sampled locations and source attributes, not continuous aquifer conditions.",
        "Interpolated surfaces are withheld below three comparable measurements and remain screening products when available.",
        "Stale measurements remain historical evidence; they are not presented as current conditions.",
        "Aquifer storage volume is unavailable without validated saturated thickness and storage properties.",
        "Per-aquifer depth surfaces represent completed-well depth evidence, not mapped aquifer tops or bottoms.",
        "Yield surfaces are created only when at least three real source-reported yield values exist; missing yield is never estimated from depth alone.",
      ],
    },
  };
}

export function buildWellSiteProfile(
  records: WaterRecord[],
  coordinate: [number, number],
  searchRadiusMiles = 35,
): WellSiteProfile {
  const location = point(coordinate);
  const wells = pointRecords(records).map((record) => ({
    record,
    miles: distance(location, point(record.geometry.coordinates as [number, number]), {
      units: "miles",
    }),
  }));
  const extents = records.filter(
    (record) =>
      (record.sourceId === "twdb-aquifers" || record.sourceId === "twdb-minor-aquifers") &&
      record.geometry.type !== "Point" &&
      booleanPointInPolygon(location, {
        type: "Feature",
        properties: {},
        geometry: record.geometry,
      }),
  );
  const nearbyNamed = wells
    .filter(({ record, miles }) => miles <= searchRadiusMiles && Boolean(record.aquifer))
    .map(({ record }) => record.aquifer!);
  const names = [
    ...new Map(
      [...extents.map((extent) => extent.name), ...nearbyNamed].map((name) => [
        normalizeAquiferName(name),
        name,
      ]),
    ).values(),
  ];
  const aquifers = names.map((name) => {
    const extent = extents.find(
      (record) => sameAquifer(record.name, name) || sameAquifer(record.aquifer, name),
    );
    const candidates = wells
      .filter(({ record, miles }) => {
        if (miles > searchRadiusMiles) return false;
        if (sameAquifer(record.aquifer, name)) return true;
        return Boolean(extent && record.sourceId === "twdb-well-reports");
      })
      .sort((left, right) => left.miles - right.miles);
    const depthSamples = samplePoints(
      candidates.map(({ record }) => record),
      (record) => record.depth,
    );
    const yieldSamples = samplePoints(
      candidates.map(({ record }) => record),
      reportedYieldGpm,
    );
    const depthValues = depthSamples.map((sample) => sample.value);
    const yieldValues = yieldSamples.map((sample) => sample.value);
    const nearest = candidates[0]?.miles ?? null;
    const completionYears = completionYearRange(candidates.map(({ record }) => record));
    const confidence =
      depthSamples.length >= 8 && (nearest ?? Infinity) <= 10
        ? "HIGH"
        : depthSamples.length >= 3 && (nearest ?? Infinity) <= 25
          ? "MODERATE"
          : "LOW";
    return {
      name,
      extentType:
        extent?.sourceId === "twdb-aquifers"
          ? "major"
          : extent?.sourceId === "twdb-minor-aquifers"
            ? "minor"
            : "well-assignment-only",
      depthSampleCount: depthSamples.length,
      estimatedCompletionDepthFt:
        depthSamples.length >= 3 ? idwValue(coordinate, depthSamples) : null,
      minimumCompletionDepthFt: depthValues.length ? Math.min(...depthValues) : null,
      maximumCompletionDepthFt: depthValues.length ? Math.max(...depthValues) : null,
      yieldSampleCount: yieldSamples.length,
      estimatedYieldGpm: yieldSamples.length >= 3 ? idwValue(coordinate, yieldSamples) : null,
      minimumYieldGpm: yieldValues.length ? Math.min(...yieldValues) : null,
      maximumYieldGpm: yieldValues.length ? Math.max(...yieldValues) : null,
      nearbyReportedUses: useCounts(candidates.map(({ record }) => record)),
      earliestCompletionYear: completionYears.earliest,
      latestCompletionYear: completionYears.latest,
      nearestWellMiles: nearest,
      confidence,
      limitation:
        "Depth is an interpolation of nearby completed-well depths, not a geologic aquifer top/bottom. Yield appears only from real reported pumping-rate evidence and is not sustainable yield.",
    } as const;
  });
  return {
    coordinate,
    searchRadiusMiles,
    generatedAt: new Date().toISOString(),
    aquifers: aquifers.sort(
      (left, right) =>
        right.depthSampleCount - left.depthSampleCount || left.name.localeCompare(right.name),
    ),
    limitation:
      "LandDraft screening profile. Exact aquifer intervals, water quality, drawdown and sustainable production require logs, testing and professional review.",
  };
}
