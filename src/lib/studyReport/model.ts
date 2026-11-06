import {
  area,
  bbox,
  bboxPolygon,
  booleanIntersects,
  featureCollection,
  intersect,
  union,
} from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { catalog, retiredCatalog, type CatalogEntry } from "../gis/catalog.ts";
import type { GisLayer, MapViewState, ProjectRecords } from "../gis/types.ts";
import {
  bboxesOverlap,
  compassFromCenter,
  createStudyFrame,
  distanceToStudy,
  expandBounds,
  geometryPaths,
  lengthInsideStudyMeters,
  METERS_PER_MILE,
  type StudyFrame,
} from "./geometry.ts";
import { STUDY_SECTION_GUIDANCE } from "./guidance.ts";
import {
  DEFAULT_NEARBY_MILES,
  studyProfileForLayer,
  studySectionsForLayer,
} from "./sourceProfiles.ts";
import type {
  StudyReportBoundary,
  StudyReportCapability,
  StudyReportFigureSnapshot,
  StudyReportLayerAnalysis,
  StudyReportLayerStatus,
  StudyReportMeasurement,
  StudyReportMeasurementFailure,
  StudyReportQueryState,
  StudyReportSectionAnalysis,
  StudyReportSectionConfig,
  StudyReportSectionId,
  StudyReportSectionResult,
  StudyReportSourceRecommendation,
  StudyReportSourceReference,
  StudyReportWorkspaceState,
} from "./types.ts";

const ACRE_SQUARE_METERS = 4046.8564224;
/** Clipped polygons per source. Beyond this no coverage figure is claimed. */
const COVERAGE_POLYGON_LIMIT = 350;
const COVERAGE_CLASS_LIMIT = 8;
/** A figure draws at most 650 features, so saving more per layer would only grow the project. */
const FIGURE_FEATURES_PER_LAYER = 150;
const FIGURE_COORDINATE_BUDGET = 30_000;

export const STUDY_REPORT_CAPABILITIES: StudyReportCapability[] = [
  "studyReport.basic",
  "studyReport.advanced",
  "studyReport.publicData",
  "studyReport.export",
];

export const STUDY_REPORT_SECTIONS: Array<{ id: StudyReportSectionId; title: string }> = [
  { id: "executive-summary", title: "Executive Summary" },
  { id: "study-area", title: "Study Area & Available Evidence" },
  { id: "land-cover", title: "Land Cover & Existing Use" },
  { id: "terrain", title: "Terrain & Elevation" },
  { id: "hydrology", title: "Hydrology, Wetlands & Flood Context" },
  { id: "soils", title: "Soils & Subsurface Context" },
  { id: "site-suitability", title: "Site Suitability Screening" },
  { id: "environmental", title: "Environmental Records & Constraints" },
  { id: "infrastructure", title: "Transportation & Infrastructure" },
  { id: "energy", title: "Energy Opportunity & Context" },
  { id: "hazards", title: "Natural Hazards & Climate Context" },
  { id: "project-records", title: "Project Notes & Records" },
  { id: "data-gaps", title: "Insufficient Data & Follow-up" },
  { id: "sources", title: "Sources & Method" },
];

const LAYER_SECTION_IDS = new Set<StudyReportSectionId>([
  "land-cover",
  "terrain",
  "hydrology",
  "soils",
  "site-suitability",
  "environmental",
  "infrastructure",
  "energy",
  "hazards",
]);

const RECOMMENDED_SOURCES: Partial<
  Record<StudyReportSectionId, StudyReportSourceRecommendation[]>
> = {
  "land-cover": [
    {
      name: "Annual National Land Cover Database (MRLC)",
      url: "https://www.mrlc.gov/data-services-page",
      note: "Official national land-cover and impervious-surface map services.",
    },
  ],
  terrain: [
    {
      name: "USGS 3D Elevation Program",
      url: "https://www.usgs.gov/3d-elevation-program",
      note: "National elevation and terrain services; not a site survey.",
    },
  ],
  hydrology: [
    {
      name: "USGS National Hydrography products",
      url: "https://www.usgs.gov/national-hydrography/access-national-hydrography-products",
      note: "Streams, waterbodies, watersheds and hydrography services.",
    },
    {
      name: "U.S. Fish & Wildlife Service National Wetlands Inventory",
      url: "https://www.fws.gov/program/national-wetlands-inventory/data-download",
      note: "Wetland inventory context; not a jurisdictional determination.",
    },
    {
      name: "FEMA National Flood Hazard Layer",
      url: "https://msc.fema.gov/",
      note: "Official effective flood-hazard mapping where available.",
    },
  ],
  soils: [
    {
      name: "USDA-NRCS Web Soil Survey / SSURGO",
      url: "https://www.nrcs.usda.gov/resources/data-and-reports/web-soil-survey",
      note: "Official current soil survey information for planning-scale interpretation.",
    },
  ],
  environmental: [
    {
      name: "EPA Facility Registry Service",
      url: "https://www.epa.gov/frs/frs-data-download-options",
      note: "Public environmental facility and program-interest records.",
    },
  ],
  infrastructure: [
    {
      name: "U.S. Census Bureau TIGERweb / TIGER-Line",
      url: "https://www.census.gov/programs-surveys/geography/guidance/tiger-data-products-guide.html",
      note: "Official boundaries, roads and selected physical features.",
    },
    {
      name: "U.S. Energy Information Administration Energy Atlas",
      url: "https://atlas.eia.gov/",
      note: "Public U.S. energy infrastructure and resource context.",
    },
  ],
  energy: [
    {
      name: "U.S. Energy Information Administration Energy Atlas",
      url: "https://atlas.eia.gov/",
      note: "Public energy infrastructure and energy-system context.",
    },
    {
      name: "NREL Solar Resource Maps and Data",
      url: "https://www.nrel.gov/gis/solar-resource-maps",
      note: "Regional solar-resource context; not a project production guarantee.",
    },
  ],
  hazards: [
    {
      name: "FEMA National Risk Index and hazard products",
      url: "https://hazards.fema.gov/nri/",
      note: "Planning-scale hazard context; inspect currency and methodology by product.",
    },
    {
      name: "NOAA/NCEI Climate Data Online",
      url: "https://www.ncei.noaa.gov/cdo-web/webservices",
      note: "Official climate observations and normals; not a site-specific forecast.",
    },
  ],
};

const uid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();

export function defaultStudyReportSections(): StudyReportSectionConfig[] {
  return STUDY_REPORT_SECTIONS.map((section, order) => ({
    id: section.id,
    title: section.title,
    enabled: true,
    order,
    userNarrative: "",
    narrativeMode: "append",
  }));
}

export function createStudyReportWorkspace(projectName: string): StudyReportWorkspaceState {
  return {
    schemaVersion: 1,
    capabilities: [...STUDY_REPORT_CAPABILITIES],
    cover: {
      title: `${projectName || "Untitled project"} — Study Area Report`,
      subtitle: "Land, environmental and infrastructure screening",
      company: "",
    },
    sections: defaultStudyReportSections(),
    updatedAt: nowIso(),
  };
}

export function normalizeStudyReportWorkspace(
  value: StudyReportWorkspaceState | undefined,
  projectName: string,
): StudyReportWorkspaceState {
  const defaults = createStudyReportWorkspace(projectName);
  if (!value || value.schemaVersion !== 1) return defaults;
  const byId = new Map(value.sections?.map((section) => [section.id, section]));
  const sections = defaultStudyReportSections().map((section) => {
    const stored = byId.get(section.id);
    return stored
      ? {
          ...section,
          ...stored,
          title: String(stored.title || section.title).slice(0, 120),
          userNarrative: String(stored.userNarrative || "").slice(0, 20_000),
          narrativeMode:
            stored.narrativeMode === "replace" ? ("replace" as const) : ("append" as const),
        }
      : section;
  });
  return {
    ...defaults,
    ...value,
    capabilities: [...new Set([...(value.capabilities ?? []), ...STUDY_REPORT_CAPABILITIES])],
    cover: {
      ...defaults.cover,
      ...(value.cover ?? {}),
      title: String(value.cover?.title || defaults.cover.title).slice(0, 180),
      subtitle: String(value.cover?.subtitle || defaults.cover.subtitle).slice(0, 240),
      company: String(value.cover?.company || "").slice(0, 180),
    },
    sections,
    updatedAt: value.updatedAt || nowIso(),
  };
}

function polygonFeatures(layer: GisLayer): Feature<Polygon | MultiPolygon>[] {
  return layer.data.features.flatMap((feature) =>
    feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon"
      ? [feature as Feature<Polygon | MultiPolygon>]
      : [],
  );
}

function coordinateCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  if (value.length >= 2 && value.every((item) => typeof item === "number")) return 1;
  return value.reduce((total, item) => total + coordinateCount(item), 0);
}

/** Overlapping parts of a boundary count once, so every percentage has the true denominator. */
function dissolved(
  features: Feature<Polygon | MultiPolygon>[],
): Feature<Polygon | MultiPolygon> | null {
  if (features.length === 1) return features[0]!;
  try {
    return union(featureCollection(features)) as Feature<Polygon | MultiPolygon> | null;
  } catch {
    return null;
  }
}

function boundaryFromFeatures(
  name: string,
  source: StudyReportBoundary["source"],
  features: Feature<Polygon | MultiPolygon>[],
  sourceLayerId?: string,
  sourceFeatures?: "all" | "selected",
): StudyReportBoundary | null {
  if (!features.length) return null;
  const data = featureCollection(features);
  const bounds = bbox(data) as [number, number, number, number];
  const whole = dissolved(features);
  if (!whole) return null;
  return {
    id: `${source}-${sourceLayerId ?? uid()}-${uid()}`,
    name,
    source,
    ...(sourceLayerId ? { sourceLayerId } : {}),
    ...(sourceFeatures ? { sourceFeatures } : {}),
    data,
    bounds,
    areaAcres: area(whole) / ACRE_SQUARE_METERS,
    capturedAt: nowIso(),
  };
}

const boundaryWithinBudget = (features: Feature<Polygon | MultiPolygon>[]) =>
  features.length <= 500 &&
  features.reduce((total, feature) => total + coordinateCount(feature.geometry.coordinates), 0) <=
    50_000;

export function studyBoundaryFromLayer(layer: GisLayer): StudyReportBoundary | null {
  const features = polygonFeatures(layer);
  if (!boundaryWithinBudget(features)) return null;
  return boundaryFromFeatures(layer.name, "layer", features, layer.id, "all");
}

/** Uses only the chosen polygons, so one parcel can be studied without the rest of its layer. */
export function studyBoundaryFromSelection(
  layer: GisLayer,
  indexes: number[],
): StudyReportBoundary | null {
  const features = indexes.flatMap((index) => {
    const feature = layer.data.features[index];
    return feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon"
      ? [structuredClone(feature) as Feature<Polygon | MultiPolygon>]
      : [];
  });
  if (!boundaryWithinBudget(features)) return null;
  return boundaryFromFeatures(
    `${layer.name}: ${features.length} selected`,
    "layer",
    features,
    layer.id,
    "selected",
  );
}

export function studyBoundaryFromBounds(
  name: string,
  source: "project-area" | "current-view",
  bounds: [number, number, number, number],
): StudyReportBoundary {
  return boundaryFromFeatures(name, source, [bboxPolygon(bounds)])!;
}

export function approximateBoundsFromMapView(view: MapViewState): [number, number, number, number] {
  if (view.bounds) return view.bounds;
  const longitudeSpan = Math.min(40, Math.max(0.002, (360 / 2 ** view.zoom) * 1.3));
  const latitudeSpan = Math.min(20, longitudeSpan * 0.62);
  return [
    Math.max(-180, view.center[0] - longitudeSpan / 2),
    Math.max(-90, view.center[1] - latitudeSpan / 2),
    Math.min(180, view.center[0] + longitudeSpan / 2),
    Math.min(90, view.center[1] + latitudeSpan / 2),
  ];
}

const catalogById = new Map<string, CatalogEntry>(
  [...catalog, ...retiredCatalog].map((entry) => [entry.id, entry]),
);

function layerSource(
  layer: GisLayer,
  status: StudyReportLayerStatus | undefined,
): StudyReportSourceReference {
  const source = layer.source;
  const entry =
    "catalogId" in source && source.catalogId ? catalogById.get(source.catalogId) : undefined;
  const url =
    source.kind === "remote"
      ? source.url
      : source.kind === "import"
        ? source.sourceUrl
        : source.kind === "raster"
          ? source.tiles[0]
          : undefined;
  const attribution =
    "attribution" in source && source.attribution
      ? source.attribution
      : source.kind === "import"
        ? `User import: ${source.fileName}`
        : source.kind === "draw"
          ? "User-created LandDraft layer"
          : source.kind === "derived"
            ? "LandDraft-derived project layer"
            : undefined;
  const retrievedAt =
    status?.retrievedAt ??
    (source.kind === "derived" && source.cachedAt
      ? source.cachedAt
      : source.kind === "remote" && source.lastRefreshedAt
        ? new Date(source.lastRefreshedAt).toISOString()
        : undefined);
  return {
    id: layer.id,
    name: layer.name,
    ...(attribution ? { attribution } : {}),
    ...(url ? { url } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
    evidence:
      source.kind === "draw" || source.kind === "import"
        ? entry
          ? "public"
          : "user"
        : source.kind === "derived"
          ? "derived"
          : "public",
    ...(entry?.sourcePage ? { sourcePage: entry.sourcePage } : {}),
    ...(entry?.updateCadence ? { updateCadence: entry.updateCadence } : {}),
    ...(entry?.license ? { license: entry.license } : {}),
    ...(entry?.description ? { limitations: entry.description } : {}),
    ...(entry && entry.states !== "US" ? { coverage: entry.states.join(", ") } : {}),
    ...(status ? { queryState: status.state } : {}),
    ...(status?.message ? { queryMessage: status.message } : {}),
  };
}

/** Sections name their sources; only Sources & Method repeats terms and limits for each one. */
const sectionSource = ({
  sourcePage: _sourcePage,
  updateCadence: _updateCadence,
  license: _license,
  limitations: _limitations,
  url: _url,
  ...reference
}: StudyReportSourceReference): StudyReportSourceReference => reference;

const geometryFamily = (geometry: Geometry | null | undefined) => {
  const type = geometry?.type ?? "";
  if (type.includes("Point")) return "point" as const;
  if (type.includes("LineString")) return "line" as const;
  if (type.includes("Polygon")) return "polygon" as const;
  return "other" as const;
};

const usableValue = (raw: unknown) => {
  if (raw === null || raw === undefined || typeof raw === "object") return null;
  const value = String(raw).trim();
  if (!value || value.length > 80 || /^(null|none|n\/a|-999999)$/i.test(value)) return null;
  return value;
};

/** Publishers vary the case of a field between layers of one service, such as NHD's GNIS_NAME. */
function propertyValue(feature: Feature, field: string): unknown {
  const properties = feature.properties ?? {};
  if (field in properties) return properties[field];
  const lower = field.toLowerCase();
  const match = Object.keys(properties).find((key) => key.toLowerCase() === lower);
  return match ? properties[match] : undefined;
}

const IGNORED_FIELDS =
  /^(objectid|fid|shape|shape__area|shape__length|shape_length|shape_area|globalid|gfid|st_area|st_length|tnmid)/i;

function attributeSummaries(intersecting: Feature[], preferred: string[] | undefined) {
  const wanted = preferred?.map((field) => field.toLowerCase());
  const fields = new Map<string, Map<string, number>>();
  for (const feature of intersecting.slice(0, 2_000))
    for (const [field, raw] of Object.entries(feature.properties ?? {})) {
      if (IGNORED_FIELDS.test(field) || (wanted && !wanted.includes(field.toLowerCase()))) continue;
      const value = usableValue(raw);
      if (!value) continue;
      const counts = fields.get(field) ?? new Map<string, number>();
      counts.set(value, (counts.get(value) ?? 0) + 1);
      fields.set(field, counts);
    }
  return [...fields.entries()]
    .map(([field, counts]) => ({
      field,
      values: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([value, count]) => ({ value, count })),
    }))
    .sort((a, b) => {
      const order =
        (wanted?.indexOf(a.field.toLowerCase()) ?? 0) -
        (wanted?.indexOf(b.field.toLowerCase()) ?? 0);
      if (order) return order;
      const aCount = a.values.reduce((total, item) => total + item.count, 0);
      const bCount = b.values.reduce((total, item) => total + item.count, 0);
      return bCount - aCount || a.field.localeCompare(b.field);
    })
    .slice(0, 3);
}

interface LayerResult {
  analysis: StudyReportLayerAnalysis | null;
  figure: Feature[];
  state: StudyReportQueryState | undefined;
}

const percentOf = (acres: number, boundary: StudyReportBoundary) =>
  Math.min(100, (acres / Math.max(boundary.areaAcres, 0.0001)) * 100);

function unionArea(polygons: Feature<Polygon | MultiPolygon>[]): number | undefined {
  try {
    const combined =
      polygons.length === 1
        ? polygons[0]!
        : (union(featureCollection(polygons)) as Feature<Polygon | MultiPolygon> | null);
    return combined ? area(combined) / ACRE_SQUARE_METERS : undefined;
  } catch {
    return undefined;
  }
}

function analyzeLayer(
  layer: GisLayer,
  boundary: StudyReportBoundary,
  frame: StudyFrame,
  status: StudyReportLayerStatus | undefined,
): LayerResult {
  const profile = studyProfileForLayer(layer);
  const searchMiles = status?.nearbyMiles ?? profile?.nearbyMiles ?? DEFAULT_NEARBY_MILES;
  const searchBounds = expandBounds(frame.bounds, searchMiles);
  const counts = { point: 0, line: 0, polygon: 0 };
  const onSite: Feature[] = [];
  const clipped: Array<{ polygon: Feature<Polygon | MultiPolygon>; key: string | null }> = [];
  const figure: Feature[] = [];
  const onSitePolygons: Feature<Polygon | MultiPolygon>[] = [];
  let invalid = 0;
  let lineMeters = 0;
  let nearbyCount = 0;
  let nearest: ReturnType<typeof distanceToStudy> = null;
  let nearestFeature: Feature | null = null;
  const classField = profile?.classFields?.find((field) =>
    layer.data.features.some((feature) => usableValue(propertyValue(feature, field))),
  );

  for (const feature of layer.data.features) {
    if (!feature.geometry) continue;
    let inside = false;
    try {
      const box = bbox(feature) as [number, number, number, number];
      if (!bboxesOverlap(box, searchBounds)) continue;
      inside =
        bboxesOverlap(box, frame.bounds) &&
        frame.polygons.some((polygon) => booleanIntersects(feature, polygon));
    } catch {
      invalid += 1;
      continue;
    }
    if (!inside) {
      if (searchMiles > 0) {
        try {
          const distance = distanceToStudy(frame, feature.geometry);
          if (distance && distance.meters <= searchMiles * METERS_PER_MILE) {
            nearbyCount += 1;
            if (!nearest || distance.meters < nearest.meters) {
              nearest = distance;
              nearestFeature = feature;
            }
          }
        } catch {
          invalid += 1;
        }
      }
      continue;
    }
    onSite.push(feature);
    const family = geometryFamily(feature.geometry);
    if (family !== "other") counts[family] += 1;
    if (family === "line") {
      try {
        lineMeters += lengthInsideStudyMeters(frame, feature.geometry);
      } catch {
        invalid += 1;
      }
      figure.push(feature);
    } else if (family === "point") figure.push(feature);
    else if (family === "polygon") onSitePolygons.push(feature as Feature<Polygon | MultiPolygon>);
  }

  const state = status?.state;
  if (!onSite.length && !nearbyCount) return { analysis: null, figure: [], state };

  const notes: string[] = [];
  let mappedCoverageAcres: number | undefined;
  const coverageClasses: StudyReportLayerAnalysis["coverageClasses"] = [];
  const clipAllowed = onSitePolygons.length <= COVERAGE_POLYGON_LIMIT;
  if (clipAllowed) {
    for (const feature of onSitePolygons) {
      const key = classField ? usableValue(propertyValue(feature, classField)) : null;
      let anyPart = false;
      for (const polygon of frame.polygons) {
        try {
          const part = intersect(featureCollection([feature, polygon]));
          if (part) {
            anyPart = true;
            clipped.push({ polygon: part as Feature<Polygon | MultiPolygon>, key });
            figure.push({ ...part, properties: feature.properties });
          }
        } catch {
          invalid += 1;
        }
      }
      if (!anyPart) figure.push(feature);
    }
  } else figure.push(...onSitePolygons);
  if (!clipAllowed)
    notes.push(
      `Area was not calculated because ${onSitePolygons.length.toLocaleString("en-US")} polygons exceed the ${COVERAGE_POLYGON_LIMIT}-polygon report limit. Use a smaller boundary.`,
    );
  else if (clipped.length) {
    mappedCoverageAcres = unionArea(clipped.map((item) => item.polygon));
    if (mappedCoverageAcres === undefined)
      notes.push("Area was not calculated because the source polygons could not be combined.");
    else if (classField) {
      const groups = new Map<string, Feature<Polygon | MultiPolygon>[]>();
      for (const item of clipped) {
        const key = item.key ?? "Not specified";
        groups.set(key, [...(groups.get(key) ?? []), item.polygon]);
      }
      for (const [value, polygons] of groups) {
        const acres = unionArea(polygons);
        if (acres !== undefined)
          coverageClasses.push({ value, acres, percent: percentOf(acres, boundary) });
      }
      coverageClasses.sort((a, b) => b.acres - a.acres);
    }
  }
  if (invalid)
    notes.push(
      `${invalid} feature${invalid === 1 ? " was" : "s were"} left out of area and length because the geometry could not be processed.`,
    );
  if (state === "truncated") notes.push("Reached the source limit, so these are minimum values.");
  const exclude = profile?.figureExclude;
  const drawn = exclude
    ? figure.filter(
        (feature) =>
          !exclude.values.includes(String(propertyValue(feature, exclude.field) ?? "").trim()),
      )
    : figure;
  if (drawn.length < figure.length && exclude) notes.push(exclude.note);
  if (coverageClasses.length > COVERAGE_CLASS_LIMIT) {
    const extra = coverageClasses.length - COVERAGE_CLASS_LIMIT;
    notes.push(`${extra} smaller class${extra === 1 ? "" : "es"} not listed.`);
  }

  const near = nearest as { meters: number; position: number[] } | null;
  const label = (feature: Feature | null) => {
    if (!feature || !profile?.labelField) return undefined;
    return usableValue(propertyValue(feature, profile.labelField)) ?? undefined;
  };
  const nearestLabel = label(nearestFeature);
  const analysis: StudyReportLayerAnalysis = {
    layerId: layer.id,
    name: layer.name,
    featureCount: onSite.length,
    pointCount: counts.point,
    lineCount: counts.line,
    polygonCount: counts.polygon,
    ...(mappedCoverageAcres !== undefined
      ? {
          mappedCoverageAcres,
          mappedCoveragePercent: percentOf(mappedCoverageAcres, boundary),
        }
      : {}),
    ...(lineMeters ? { onSiteLineMiles: lineMeters / METERS_PER_MILE } : {}),
    ...(classField && coverageClasses.length
      ? { classField, coverageClasses: coverageClasses.slice(0, COVERAGE_CLASS_LIMIT) }
      : {}),
    ...(searchMiles > 0
      ? {
          nearby: {
            searchMiles,
            count: nearbyCount,
            ...(near
              ? {
                  nearestMiles: near.meters / METERS_PER_MILE,
                  nearestDirection: compassFromCenter(frame, near.position),
                }
              : {}),
            ...(nearestLabel ? { nearestLabel } : {}),
          },
        }
      : {}),
    ...(profile?.context ? { context: true } : {}),
    ...(invalid ? { invalidFeatures: invalid } : {}),
    attributes: attributeSummaries(onSite.length ? onSite : [], profile?.summaryFields),
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
  return { analysis, figure: drawn, state };
}

const number = (value: number, maximumFractionDigits = 0) =>
  value.toLocaleString("en-US", { maximumFractionDigits });
const miles = (value: number) =>
  value < 0.1 ? "under 0.1 mi" : `${number(value, value < 10 ? 1 : 0)} mi`;

const QUERY_STATE_LABELS: Record<StudyReportQueryState, string> = {
  complete: "Queried",
  truncated: "Incomplete, reached limit",
  failed: "Failed",
  "not-refreshed": "Not refreshed",
  "visual-only": "Map image, not measured",
  "project-data": "Project data",
};
export const studyQueryStateLabel = (state: StudyReportQueryState) => QUERY_STATE_LABELS[state];

/** Small values read as small rather than rounding to a false zero. */
export const studyAcres = (value: number) =>
  value > 0 && value < 0.1 ? "under 0.1" : number(value, 1);
export const studyPercent = (value: number) =>
  value > 0 && value < 0.1 ? "under 0.1" : number(value, 1);

function describeLayer(layer: StudyReportLayerAnalysis): string {
  const parts: string[] = [];
  if (layer.featureCount) {
    const area =
      layer.mappedCoverageAcres !== undefined
        ? `, covering ${studyAcres(layer.mappedCoverageAcres)} acres (${studyPercent(layer.mappedCoveragePercent ?? 0)}% of the study area)`
        : "";
    const length = layer.onSiteLineMiles
      ? `, ${number(layer.onSiteLineMiles, 2)} mi inside the boundary`
      : "";
    parts.push(`${number(layer.featureCount)} on site${area}${length}`);
    const classes = layer.coverageClasses
      ?.slice(0, 3)
      .map((item) => `${item.value} ${studyPercent(item.percent)}%`);
    if (classes?.length) parts.push(`by ${layer.classField}: ${classes.join(", ")}`);
  } else parts.push("none on site");
  if (layer.nearby?.count)
    parts.push(
      `${number(layer.nearby.count)} more within ${number(layer.nearby.searchMiles, 2)} mi of the boundary, nearest about ${miles(layer.nearby.nearestMiles ?? 0)} ${layer.nearby.nearestDirection ?? ""}`.trim(),
    );
  return `${layer.name}: ${parts.join("; ")}.`;
}

interface SectionInput {
  id: StudyReportSectionId;
  title: string;
  candidates: GisLayer[];
  results: Map<string, LayerResult>;
  statuses: Map<string, StudyReportLayerStatus>;
  measurements: StudyReportMeasurement[];
  failures: StudyReportMeasurementFailure[];
  analyzedAt: string;
}

function resultForLayerSection(input: SectionInput): StudyReportSectionResult {
  const { id, title, candidates, results, statuses, measurements, failures, analyzedAt } = input;
  const layers = candidates.flatMap((layer) => {
    const analysis = results.get(layer.id)?.analysis;
    return analysis ? [analysis] : [];
  });
  const onSite = layers.filter((layer) => layer.featureCount > 0);
  const states = candidates.map((layer) => statuses.get(layer.id)?.state);
  const incomplete = candidates.filter((layer) =>
    ["failed", "truncated", "not-refreshed"].includes(statuses.get(layer.id)?.state ?? ""),
  );
  const queriedEmpty = candidates.filter(
    (layer) =>
      statuses.get(layer.id)?.state === "complete" &&
      !results.get(layer.id)?.analysis?.featureCount,
  );
  const visualOnly = candidates.filter((layer) => statuses.get(layer.id)?.state === "visual-only");
  const hasEvidence = onSite.length > 0 || queriedEmpty.length > 0 || measurements.length > 0;
  const status =
    !candidates.length && !measurements.length && !failures.length
      ? "insufficient"
      : hasEvidence && !incomplete.length && !failures.length
        ? "ready"
        : "partial";

  const pointCount = onSite.reduce((total, layer) => total + layer.pointCount, 0);
  const lineCount = onSite.reduce((total, layer) => total + layer.lineCount, 0);
  const polygonCount = onSite.reduce((total, layer) => total + layer.polygonCount, 0);
  const features = onSite.reduce((total, layer) => total + layer.featureCount, 0);
  const polygonLayers = onSite.filter((layer) => layer.mappedCoverageAcres !== undefined);
  // Adding unrelated sources into one figure says nothing, so coverage stays per source.
  const single = polygonLayers.length === 1 ? polygonLayers[0] : undefined;

  const sentences: string[] = [];
  if (status === "insufficient")
    sentences.push(
      "No relevant source was active for this section. LandDraft did not infer a favorable or unfavorable condition from the absence of evidence.",
    );
  else {
    for (const measurement of measurements)
      sentences.push(
        `${measurement.title}: ${measurement.rows
          .slice(0, 3)
          .map((row) => `${row.label} ${row.value}`)
          .join("; ")}. This is a derived estimate.`,
      );
    for (const layer of layers.slice(0, 6)) sentences.push(describeLayer(layer));
    if (layers.length > 6) sentences.push(`${layers.length - 6} more sources are listed below.`);
    if (queriedEmpty.length)
      sentences.push(
        `No mapped features were returned for ${
          queriedEmpty
            .filter((layer) => !results.get(layer.id)?.analysis)
            .slice(0, 5)
            .map((layer) => layer.name)
            .join(", ") || "the remaining sources"
        } in the searched area. That is the query result, not proof the condition is absent.`,
      );
    if (incomplete.length)
      sentences.push(
        `Incomplete: ${incomplete
          .map((layer) => layer.name)
          .slice(0, 6)
          .join(", ")}. Treat this section as unfinished until those sources are reviewed.`,
      );
    if (visualOnly.length)
      sentences.push(
        `Map image only, not measured: ${visualOnly.map((layer) => layer.name).join(", ")}.`,
      );
    if (!layers.length && !queriedEmpty.length && !incomplete.length && !visualOnly.length)
      sentences.push(
        `${number(candidates.length)} potentially relevant layer${candidates.length === 1 ? " is" : "s are"} available, but no loaded feature was confirmed inside the study boundary. Provider coverage and query status require review.`,
      );
    for (const failure of failures)
      sentences.push(`${failure.title} could not be calculated: ${failure.message}`);
  }

  const figureLayers = [
    ...candidates.filter((layer) => layer.source.kind === "raster").slice(0, 2),
    ...candidates.filter((layer) => (results.get(layer.id)?.figure.length ?? 0) > 0),
  ].slice(0, 8);

  return {
    id,
    title,
    status,
    generatedNarrative: sentences.join(" "),
    metrics: [
      { id: "layers", label: "Relevant layers", value: number(candidates.length) },
      {
        id: "features",
        label: "Features on site",
        value: number(features),
        basis: "mapped",
        ...(states.includes("truncated") ? { note: "Minimum; a source reached its limit" } : {}),
      },
      {
        id: "vector-layers",
        label: "Layers with on-site evidence",
        value: number(onSite.length),
      },
      ...(incomplete.length
        ? [{ id: "incomplete", label: "Incomplete sources", value: number(incomplete.length) }]
        : []),
      ...(visualOnly.length
        ? [
            {
              id: "context-layers",
              label: "Map images, not measured",
              value: number(visualOnly.length),
            },
          ]
        : []),
      ...(single
        ? [
            {
              id: "coverage",
              label: "Mapped polygon coverage",
              value: `${number(single.mappedCoverageAcres!, 1)} acres`,
              note: `${number(single.mappedCoveragePercent ?? 0, 1)}% of the study area; overlapping polygons counted once`,
              basis: "derived" as const,
            },
          ]
        : []),
    ],
    layerIds: candidates.map((layer) => layer.id),
    mapLayerIds: figureLayers.map((layer) => layer.id),
    analysis: {
      method:
        "Vector features were intersected with the selected polygon, including holes. Polygon coverage was clipped and unioned, so overlaps count once. Nearby counts use the listed search distance beyond the boundary, and distances are approximate.",
      intersectingFeatures: features,
      pointCount,
      lineCount,
      polygonCount,
      ...(single
        ? {
            mappedCoverageAcres: single.mappedCoverageAcres!,
            mappedCoveragePercent: single.mappedCoveragePercent ?? 0,
          }
        : {}),
      layers,
    } satisfies StudyReportSectionAnalysis,
    sources: candidates.map((layer) => sectionSource(layerSource(layer, statuses.get(layer.id)))),
    ...(status !== "ready" && RECOMMENDED_SOURCES[id]
      ? { recommendations: RECOMMENDED_SOURCES[id] }
      : {}),
    ...(status !== "ready"
      ? {
          gapMessage: incomplete.length
            ? "One or more sources failed or stopped at a limit. Re-run, narrow the boundary or add a source-specific study before finalizing this section."
            : status === "partial"
              ? "Verify provider coverage, load the needed feature detail, or add a source-specific study before finalizing this section."
              : "Add an appropriate public or user layer, document a manual finding, or leave this limitation visible in the final report.",
        }
      : {}),
    ...(STUDY_SECTION_GUIDANCE[id] ? { guidance: STUDY_SECTION_GUIDANCE[id] } : {}),
    ...(measurements.length ? { measurements } : {}),
    ...(failures.length ? { measurementFailures: failures } : {}),
    analyzedAt,
  };
}

export function studyEvidenceSignature(layers: GisLayer[], records: ProjectRecords): string {
  const parts = layers.map((layer) => {
    const source = layer.source;
    // Viewport layers change on every pan and are not saved, so their loaded data is not evidence
    // of a change. Their identity and filter are.
    if (source.kind === "remote" && source.requiresViewport)
      return [layer.id, source.url, source.where ?? "", layer.createdAt].join(":");
    return [
      layer.id,
      layer.data.features.length,
      layer.createdAt,
      source.kind === "remote" ? (source.lastRefreshedAt ?? 0) : 0,
      source.kind === "derived" ? (source.cachedAt ?? "") : "",
    ].join(":");
  });
  parts.push(
    `records:${records.notes.length}:${records.layerNotes.length}:${records.documents.length}:${records.events.length}`,
  );
  let hash = 2166136261;
  for (const character of parts.sort().join("|")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function roundCoordinates(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (typeof value[0] === "number")
    return value.slice(0, 2).map((item) => Math.round(Number(item) * 1e6) / 1e6);
  return value.map(roundCoordinates);
}

/** Keeps what the figures drew with the report, without storing whole provider responses. */
function buildFigureSnapshot(results: Map<string, LayerResult>): StudyReportFigureSnapshot {
  const features: Record<string, Feature[]> = {};
  let coordinates = 0;
  let truncated = false;
  for (const [layerId, result] of results) {
    if (!result.figure.length) continue;
    if (result.figure.length > FIGURE_FEATURES_PER_LAYER) truncated = true;
    // Lines and points first: a dense polygon layer must not crowd them out of the budget.
    const ordered = [...result.figure]
      .sort((a, b) => geometryRank(a.geometry) - geometryRank(b.geometry))
      .slice(0, FIGURE_FEATURES_PER_LAYER);
    const kept: Feature[] = [];
    for (const feature of ordered) {
      const count = geometryPaths(feature.geometry).reduce((total, path) => total + path.length, 0);
      if (coordinates + count > FIGURE_COORDINATE_BUDGET) {
        truncated = true;
        continue;
      }
      coordinates += count;
      kept.push({
        type: "Feature",
        properties: {},
        geometry: {
          ...feature.geometry,
          ...("coordinates" in feature.geometry
            ? { coordinates: roundCoordinates(feature.geometry.coordinates) }
            : {}),
        } as Geometry,
      });
    }
    if (kept.length) features[layerId] = kept;
  }
  return { features, truncated };
}

const geometryRank = (geometry: Geometry | null) => {
  const family = geometryFamily(geometry);
  return family === "point" ? 0 : family === "line" ? 1 : 2;
};

export interface StudyMeasurementResult {
  section: StudyReportSectionId;
  measurement?: StudyReportMeasurement;
  failure?: StudyReportMeasurementFailure;
}

export function analyzeStudyReport(input: {
  workspace: StudyReportWorkspaceState;
  layers: GisLayer[];
  records: ProjectRecords;
  analyzedAt?: string;
  layerStatuses?: StudyReportLayerStatus[];
  measurements?: StudyMeasurementResult[];
}): StudyReportWorkspaceState {
  const { workspace, layers, records } = input;
  const boundary = workspace.boundary;
  if (!boundary) throw new Error("Choose a study boundary before running analysis.");
  const analyzedAt = input.analyzedAt ?? nowIso();
  const statuses = new Map((input.layerStatuses ?? []).map((status) => [status.layerId, status]));
  // A layer used whole as the boundary would otherwise report itself as 100% coverage.
  const availableLayers =
    boundary.source === "layer" && boundary.sourceFeatures !== "selected"
      ? layers.filter((layer) => layer.id !== boundary.sourceLayerId)
      : layers;
  const polygons = boundary.data.features as Feature<Polygon | MultiPolygon>[];
  const frame = createStudyFrame(
    polygons.length > 1 ? [dissolved(polygons) ?? polygons[0]!] : polygons,
  );

  const results = new Map<string, LayerResult>();
  for (const layer of availableLayers)
    results.set(layer.id, analyzeLayer(layer, boundary, frame, statuses.get(layer.id)));

  const sectionLayers = new Map<StudyReportSectionId, GisLayer[]>();
  for (const layer of availableLayers)
    for (const section of studySectionsForLayer(layer))
      sectionLayers.set(section, [...(sectionLayers.get(section) ?? []), layer]);

  const sectionResults = new Map<StudyReportSectionId, StudyReportSectionResult>();
  for (const definition of STUDY_REPORT_SECTIONS) {
    if (!LAYER_SECTION_IDS.has(definition.id)) continue;
    const measured = (input.measurements ?? []).filter((item) => item.section === definition.id);
    sectionResults.set(
      definition.id,
      resultForLayerSection({
        id: definition.id,
        title: definition.title,
        candidates: sectionLayers.get(definition.id) ?? [],
        results,
        statuses,
        measurements: measured.flatMap((item) => (item.measurement ? [item.measurement] : [])),
        failures: measured.flatMap((item) => (item.failure ? [item.failure] : [])),
        analyzedAt,
      }),
    );
  }

  const allAnalyses = availableLayers.flatMap((layer) => {
    const analysis = results.get(layer.id)?.analysis;
    return analysis ? [analysis] : [];
  });
  const onSiteTotal = allAnalyses.reduce((total, layer) => total + layer.featureCount, 0);
  const failed = availableLayers.filter((layer) => statuses.get(layer.id)?.state === "failed");
  const truncated = availableLayers.filter(
    (layer) => statuses.get(layer.id)?.state === "truncated",
  );
  const notRefreshed = availableLayers.filter(
    (layer) => statuses.get(layer.id)?.state === "not-refreshed" && layer.source.kind === "remote",
  );
  const measurementFailures = (input.measurements ?? []).flatMap((item) =>
    item.failure ? [item.failure] : [],
  );
  const rectangular = boundary.source !== "layer";

  const studyAreaResult: StudyReportSectionResult = {
    id: "study-area",
    title: "Study Area & Available Evidence",
    status: availableLayers.length ? "ready" : "insufficient",
    generatedNarrative: `${availableLayers.length ? `The selected study area contains ${number(boundary.areaAcres, 1)} acres by geodesic calculation, with overlapping boundary parts counted once. All percentages in this report use that figure as the denominator. This run evaluated ${number(availableLayers.length)} active source${availableLayers.length === 1 ? "" : "s"} and found ${number(onSiteTotal)} features within or crossing the boundary.` : `The selected study area contains ${number(boundary.areaAcres, 1)} acres, but no project layers were available for evidence review.`}${rectangular ? " This boundary is a rectangle drawn from a map extent, not a parcel or property line." : ""}`,
    metrics: [
      {
        id: "area",
        label: "Study area",
        value: `${number(boundary.areaAcres, 1)} acres`,
        basis: "derived",
      },
      { id: "layers", label: "Project layers reviewed", value: number(availableLayers.length) },
      { id: "features", label: "Intersecting features", value: number(onSiteTotal) },
    ],
    layerIds: availableLayers.map((layer) => layer.id),
    mapLayerIds: [
      ...availableLayers.filter((layer) => layer.source.kind === "raster").slice(0, 1),
      ...availableLayers.filter((layer) => (results.get(layer.id)?.figure.length ?? 0) > 0),
    ]
      .map((layer) => layer.id)
      .slice(0, 6),
    sources: availableLayers.map((layer) =>
      sectionSource(layerSource(layer, statuses.get(layer.id))),
    ),
    ...(!availableLayers.length
      ? { gapMessage: "Turn on or add project/public-data layers and re-run the analysis." }
      : {}),
    analyzedAt,
  };
  sectionResults.set("study-area", studyAreaResult);

  const recordsCount = records.notes.length + records.layerNotes.length + records.documents.length;
  sectionResults.set("project-records", {
    id: "project-records",
    title: "Project Notes & Records",
    status: recordsCount ? "ready" : "insufficient",
    generatedNarrative: recordsCount
      ? `The project repository contains ${number(records.notes.length)} project note${records.notes.length === 1 ? "" : "s"}, ${number(records.layerNotes.length)} layer note${records.layerNotes.length === 1 ? "" : "s"}, and ${number(records.documents.length)} document${records.documents.length === 1 ? "" : "s"}. Review confidentiality and relevance before including their contents in a distributed report.`
      : "No project notes, layer notes or repository documents were available for this run.",
    metrics: [
      { id: "notes", label: "Project notes", value: number(records.notes.length) },
      { id: "layer-notes", label: "Layer notes", value: number(records.layerNotes.length) },
      { id: "documents", label: "Repository documents", value: number(records.documents.length) },
    ],
    layerIds: [],
    sources: recordsCount
      ? [
          {
            id: "project-records",
            name: "LandDraft project records",
            evidence: "project-record",
          },
        ]
      : [],
    ...(!recordsCount
      ? { gapMessage: "Add project records or leave this limitation visible in the final report." }
      : {}),
    analyzedAt,
  });

  const analyticalResults = [...sectionResults.values()].filter(
    (section) => !["study-area", "project-records"].includes(section.id),
  );
  const ready = analyticalResults.filter((section) => section.status === "ready").length;
  const partial = analyticalResults.filter((section) => section.status === "partial").length;
  const insufficient = analyticalResults.filter(
    (section) => section.status === "insufficient",
  ).length;
  const problemCount = failed.length + truncated.length;
  sectionResults.set("executive-summary", {
    id: "executive-summary",
    title: "Executive Summary",
    status: ready ? (insufficient || partial ? "partial" : "ready") : "insufficient",
    generatedNarrative: `LandDraft completed a screening review of the selected ${number(boundary.areaAcres, 1)}-acre study area using active project and public-data sources. ${ready} analytical section${ready === 1 ? " has" : "s have"} complete source results, ${partial} require${partial === 1 ? "s" : ""} review because a source failed, stopped at a limit or could not be measured, and ${insufficient} ${insufficient === 1 ? "has" : "have"} no connected source.${problemCount ? ` ${problemCount} source${problemCount === 1 ? "" : "s"} did not return complete data; see the warnings below.` : ""} Findings are planning context, not survey, engineering, legal, environmental or regulatory determinations. Nothing here establishes buildability, legal access, easement widths, environmental clearance, water rights, well yield, utility capacity or connection rights.`,
    metrics: [
      { id: "ready", label: "Sections with complete results", value: number(ready) },
      { id: "partial", label: "Sections needing review", value: number(partial) },
      { id: "insufficient", label: "Sections with no source", value: number(insufficient) },
      { id: "layers", label: "Project layers reviewed", value: number(availableLayers.length) },
    ],
    layerIds: availableLayers.map((layer) => layer.id),
    mapLayerIds: [],
    sources: [],
    highlights: analyticalResults.flatMap((section) =>
      (section.analysis?.layers ?? [])
        .filter((layer) => layer.featureCount > 0 && !layer.context)
        .slice(0, 3)
        .map((layer) => `${section.title}. ${describeLayer(layer)}`),
    ),
    ...(insufficient || partial
      ? { gapMessage: "See Insufficient Data & Follow-up for unresolved evidence categories." }
      : {}),
    analyzedAt,
  });

  const gapSections = [...sectionResults.values()].filter(
    (section) =>
      section.status !== "ready" && !["study-area", "executive-summary"].includes(section.id),
  );
  const gapRecommendations = [
    ...new Map(
      gapSections
        .flatMap((section) => section.recommendations ?? [])
        .map((recommendation) => [recommendation.url, recommendation]),
    ).values(),
  ];
  sectionResults.set("data-gaps", {
    id: "data-gaps",
    title: "Insufficient Data & Follow-up",
    status: gapSections.length ? "partial" : "ready",
    generatedNarrative: gapSections.length
      ? `The following sections require additional evidence or review: ${gapSections.map((section) => section.title).join(", ")}. Absence of mapped evidence must not be interpreted as absence of a condition. Add or refresh appropriate sources, record a qualified manual finding, and re-run the report.`
      : "No section-level data gap was detected in the loaded evidence. This does not eliminate source limitations or the need for professional review.",
    metrics: [
      { id: "gaps", label: "Sections requiring follow-up", value: number(gapSections.length) },
    ],
    layerIds: [],
    sources: [],
    ...(gapRecommendations.length ? { recommendations: gapRecommendations } : {}),
    analyzedAt,
  });

  const allSources = availableLayers.map((layer) => layerSource(layer, statuses.get(layer.id)));
  sectionResults.set("sources", {
    id: "sources",
    title: "Sources & Method",
    status: allSources.length ? "ready" : "insufficient",
    generatedNarrative: `This report was generated from the selected boundary and the active LandDraft sources at ${analyzedAt}. Live services were queried for the boundary extent plus each source's listed search distance, using unsimplified geometry. Features were tested against the polygon, including holes. Polygon coverage was clipped and unioned per source, so overlaps count once, and sources are never added together. Map-image layers are shown as context and are not measured. Terrain is measured from a numeric USGS grid and land cover from a labeled point sample. Re-running updates generated evidence; user-authored narrative remains separate.`,
    metrics: [{ id: "sources", label: "Documented sources", value: number(allSources.length) }],
    layerIds: availableLayers.map((layer) => layer.id),
    sources: allSources,
    ...(!allSources.length
      ? { gapMessage: "No attributed source was available for this run." }
      : {}),
    analyzedAt,
  });

  const orderedResults = STUDY_REPORT_SECTIONS.map((definition) =>
    sectionResults.get(definition.id)!,
  ).filter(Boolean);
  const figureSnapshot = buildFigureSnapshot(results);
  return {
    ...workspace,
    currentRun: {
      id: `study-run-${Date.now()}-${uid()}`,
      analyzedAt,
      boundaryId: boundary.id,
      evidenceSignature: studyEvidenceSignature(layers, records),
      sections: orderedResults,
      warnings: [
        "Screening analysis only; not a survey, title opinion, engineering design, environmental site assessment or regulatory determination.",
        ...(rectangular
          ? [
              `The study boundary "${boundary.name}" is a rectangular extent, not a property line. Choose a polygon layer or selected parcels for a parcel-specific study.`,
            ]
          : []),
        ...failed.map(
          (layer) =>
            `${layer.name} failed and was treated as not evaluated, not as no findings: ${statuses.get(layer.id)?.message ?? "provider request failed"}`,
        ),
        ...truncated.map(
          (layer) =>
            `${layer.name}: ${statuses.get(layer.id)?.message ?? "reached the source limit"}`,
        ),
        ...notRefreshed.map(
          (layer) =>
            `${layer.name} was not queried for this boundary: ${statuses.get(layer.id)?.message ?? "not refreshed"}`,
        ),
        ...measurementFailures.map((failure) => `${failure.title}: ${failure.message}`),
        ...(figureSnapshot.truncated
          ? [
              "Some report maps omit features to stay within the saved-figure limit. Tables are not affected.",
            ]
          : []),
      ],
      ...(input.layerStatuses ? { layerStatuses: input.layerStatuses } : {}),
      figureSnapshot,
    },
    updatedAt: analyzedAt,
  };
}
