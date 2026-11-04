import { area, bbox, bboxPolygon, booleanIntersects, featureCollection } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { GisLayer, MapViewState, ProjectRecords } from "../gis/types.ts";
import type {
  StudyReportBoundary,
  StudyReportCapability,
  StudyReportSectionConfig,
  StudyReportSectionId,
  StudyReportSectionResult,
  StudyReportSourceRecommendation,
  StudyReportSourceReference,
  StudyReportWorkspaceState,
} from "./types.ts";

const ACRE_SQUARE_METERS = 4046.8564224;

export const STUDY_REPORT_CAPABILITIES: StudyReportCapability[] = [
  "studyReport.basic",
  "studyReport.advanced",
  "studyReport.publicData",
  "studyReport.export",
];

export const STUDY_REPORT_SECTIONS: Array<{
  id: StudyReportSectionId;
  title: string;
  keywords: string[];
}> = [
  { id: "executive-summary", title: "Executive Summary", keywords: [] },
  { id: "study-area", title: "Study Area & Available Evidence", keywords: [] },
  {
    id: "land-cover",
    title: "Land Cover & Existing Use",
    keywords: ["land cover", "landcover", "nlcd", "crop", "cropland", "parcel", "property"],
  },
  {
    id: "terrain",
    title: "Terrain & Elevation",
    keywords: ["elevation", "terrain", "slope", "topo", "contour", "relief", "3dep"],
  },
  {
    id: "hydrology",
    title: "Hydrology, Wetlands & Flood Context",
    keywords: [
      "hydro",
      "water",
      "stream",
      "river",
      "wetland",
      "flood",
      "watershed",
      "aquifer",
      "well",
      "drainage",
    ],
  },
  {
    id: "soils",
    title: "Soils & Subsurface Context",
    keywords: ["soil", "ssurgo", "statsgo", "bedrock", "geology", "geologic", "karst"],
  },
  {
    id: "site-suitability",
    title: "Site Suitability Screening",
    keywords: ["buildable", "suitability", "constraint", "exclusion", "setback", "candidate"],
  },
  {
    id: "environmental",
    title: "Environmental Records & Constraints",
    keywords: [
      "environment",
      "epa",
      "superfund",
      "brownfield",
      "contamin",
      "hazmat",
      "storage tank",
      "ust",
      "rcra",
      "tri",
      "protected",
      "habitat",
    ],
  },
  {
    id: "infrastructure",
    title: "Transportation & Infrastructure",
    keywords: [
      "road",
      "highway",
      "rail",
      "transmission",
      "substation",
      "pipeline",
      "fiber",
      "data center",
      "utility",
      "electric",
      "infrastructure",
    ],
  },
  {
    id: "energy",
    title: "Energy Opportunity & Context",
    keywords: [
      "solar",
      "wind",
      "turbine",
      "energy",
      "power plant",
      "battery",
      "ev charging",
      "irradiance",
    ],
  },
  {
    id: "hazards",
    title: "Natural Hazards & Climate Context",
    keywords: [
      "hazard",
      "wildfire",
      "earthquake",
      "fault",
      "tornado",
      "hurricane",
      "drought",
      "hail",
      "landslide",
      "climate",
      "weather",
    ],
  },
  { id: "project-records", title: "Project Notes & Records", keywords: [] },
  { id: "data-gaps", title: "Insufficient Data & Follow-up", keywords: [] },
  { id: "sources", title: "Sources & Method", keywords: [] },
];

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

function boundaryFromFeatures(
  name: string,
  source: StudyReportBoundary["source"],
  features: Feature<Polygon | MultiPolygon>[],
  sourceLayerId?: string,
): StudyReportBoundary | null {
  if (!features.length) return null;
  const data = featureCollection(features);
  const bounds = bbox(data) as [number, number, number, number];
  const areaAcres =
    features.reduce((total, feature) => total + area(feature), 0) / ACRE_SQUARE_METERS;
  return {
    id: `${source}-${sourceLayerId ?? uid()}-${uid()}`,
    name,
    source,
    ...(sourceLayerId ? { sourceLayerId } : {}),
    data,
    bounds,
    areaAcres,
    capturedAt: nowIso(),
  };
}

export function studyBoundaryFromLayer(layer: GisLayer): StudyReportBoundary | null {
  const features = polygonFeatures(layer);
  if (
    features.length > 500 ||
    features.reduce((total, feature) => total + coordinateCount(feature.geometry.coordinates), 0) >
      50_000
  )
    return null;
  return boundaryFromFeatures(layer.name, "layer", features, layer.id);
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

function sourceText(layer: GisLayer): string {
  const source = layer.source;
  return [
    layer.name,
    source.kind,
    "catalogId" in source ? source.catalogId : "",
    "attribution" in source ? source.attribution : "",
    "sourceUrl" in source ? source.sourceUrl : "",
    "url" in source ? source.url : "",
    source.kind === "derived" ? source.query : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchingLayers(layers: GisLayer[], keywords: string[]): GisLayer[] {
  return layers.filter((layer) => keywords.some((keyword) => sourceText(layer).includes(keyword)));
}

function layerSource(layer: GisLayer): StudyReportSourceReference {
  const source = layer.source;
  const url =
    source.kind === "remote" ? source.url : source.kind === "import" ? source.sourceUrl : undefined;
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
  return {
    id: layer.id,
    name: layer.name,
    ...(attribution ? { attribution } : {}),
    ...(url ? { url } : {}),
    ...(source.kind === "derived" && source.cachedAt ? { retrievedAt: source.cachedAt } : {}),
    evidence:
      source.kind === "draw" || source.kind === "import"
        ? "user"
        : source.kind === "derived"
          ? "derived"
          : "public",
  };
}

function intersectsBoundary(feature: Feature, boundary: StudyReportBoundary): boolean {
  if (!feature.geometry) return false;
  try {
    return boundary.data.features.some((polygon) => booleanIntersects(feature, polygon));
  } catch {
    return false;
  }
}

function layerEvidence(
  layers: GisLayer[],
  boundary: StudyReportBoundary,
): { features: number; layersWithFeatures: number; nonVectorLayers: number } {
  let features = 0;
  let layersWithFeatures = 0;
  let nonVectorLayers = 0;
  for (const layer of layers) {
    const count = layer.data.features.filter((feature) =>
      intersectsBoundary(feature, boundary),
    ).length;
    features += count;
    if (count) layersWithFeatures += 1;
    if (!layer.data.features.length && ["raster", "remote"].includes(layer.source.kind))
      nonVectorLayers += 1;
  }
  return { features, layersWithFeatures, nonVectorLayers };
}

const number = (value: number, maximumFractionDigits = 0) =>
  value.toLocaleString("en-US", { maximumFractionDigits });

function resultForLayerSection(
  id: StudyReportSectionId,
  title: string,
  candidates: GisLayer[],
  boundary: StudyReportBoundary,
  analyzedAt: string,
): StudyReportSectionResult {
  const evidence = layerEvidence(candidates, boundary);
  const status = !candidates.length ? "insufficient" : evidence.features > 0 ? "ready" : "partial";
  const generatedNarrative =
    status === "ready"
      ? `LandDraft found ${number(evidence.features)} mapped feature${evidence.features === 1 ? "" : "s"} from ${number(candidates.length)} relevant loaded layer${candidates.length === 1 ? "" : "s"} within or crossing the study area. Review the mapped evidence, source dates and attributes before relying on it for site decisions.`
      : status === "partial"
        ? `${number(candidates.length)} potentially relevant layer${candidates.length === 1 ? " is" : "s are"} available, but no locally loaded vector feature was confirmed inside the study boundary. Raster or viewport-dependent context may still be visually useful; provider coverage and query status require review.`
        : `No relevant loaded project layer was available for this section. LandDraft did not infer a favorable or unfavorable condition from the absence of evidence.`;
  return {
    id,
    title,
    status,
    generatedNarrative,
    metrics: [
      { id: "layers", label: "Relevant layers", value: number(candidates.length) },
      { id: "features", label: "Mapped features", value: number(evidence.features) },
      {
        id: "vector-layers",
        label: "Layers with intersecting evidence",
        value: number(evidence.layersWithFeatures),
      },
      ...(evidence.nonVectorLayers
        ? [
            {
              id: "context-layers",
              label: "Raster/remote context layers",
              value: number(evidence.nonVectorLayers),
            },
          ]
        : []),
    ],
    layerIds: candidates.map((layer) => layer.id),
    sources: candidates.map(layerSource),
    ...(status !== "ready" && RECOMMENDED_SOURCES[id]
      ? { recommendations: RECOMMENDED_SOURCES[id] }
      : {}),
    ...(status !== "ready"
      ? {
          gapMessage:
            status === "partial"
              ? "Verify provider coverage, load the needed feature detail, or add a source-specific study before finalizing this section."
              : "Add an appropriate public or user layer, document a manual finding, or leave this limitation visible in the final report.",
        }
      : {}),
    analyzedAt,
  };
}

export function studyEvidenceSignature(layers: GisLayer[], records: ProjectRecords): string {
  const parts = layers.map((layer) =>
    [
      layer.id,
      layer.data.features.length,
      layer.createdAt,
      layer.source.kind === "remote" ? (layer.source.lastRefreshedAt ?? 0) : 0,
      layer.source.kind === "derived" ? (layer.source.cachedAt ?? "") : "",
    ].join(":"),
  );
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

export function analyzeStudyReport(input: {
  workspace: StudyReportWorkspaceState;
  layers: GisLayer[];
  records: ProjectRecords;
  analyzedAt?: string;
}): StudyReportWorkspaceState {
  const { workspace, layers, records } = input;
  if (!workspace.boundary) throw new Error("Choose a study boundary before running analysis.");
  const analyzedAt = input.analyzedAt ?? nowIso();
  const availableLayers = layers;
  const sectionResults = new Map<StudyReportSectionId, StudyReportSectionResult>();
  for (const definition of STUDY_REPORT_SECTIONS) {
    if (
      ["executive-summary", "study-area", "project-records", "data-gaps", "sources"].includes(
        definition.id,
      )
    )
      continue;
    sectionResults.set(
      definition.id,
      resultForLayerSection(
        definition.id,
        definition.title,
        matchingLayers(availableLayers, definition.keywords),
        workspace.boundary,
        analyzedAt,
      ),
    );
  }

  const overviewEvidence = layerEvidence(availableLayers, workspace.boundary);
  const studyAreaResult: StudyReportSectionResult = {
    id: "study-area",
    title: "Study Area & Available Evidence",
    status: availableLayers.length ? "ready" : "insufficient",
    generatedNarrative: availableLayers.length
      ? `The selected study area contains ${number(workspace.boundary.areaAcres, 1)} acres by geodesic calculation. This run evaluated ${number(availableLayers.length)} loaded project layer${availableLayers.length === 1 ? "" : "s"} and found ${number(overviewEvidence.features)} loaded features within or crossing the boundary.`
      : `The selected study area contains ${number(workspace.boundary.areaAcres, 1)} acres, but no project layers were available for evidence review.`,
    metrics: [
      {
        id: "area",
        label: "Study area",
        value: `${number(workspace.boundary.areaAcres, 1)} acres`,
      },
      { id: "layers", label: "Project layers reviewed", value: number(availableLayers.length) },
      { id: "features", label: "Intersecting features", value: number(overviewEvidence.features) },
    ],
    layerIds: availableLayers.map((layer) => layer.id),
    sources: availableLayers.map(layerSource),
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
  sectionResults.set("executive-summary", {
    id: "executive-summary",
    title: "Executive Summary",
    status: ready ? (insufficient ? "partial" : "ready") : "insufficient",
    generatedNarrative: `LandDraft completed a screening review of the selected ${number(workspace.boundary.areaAcres, 1)}-acre study area using loaded project and public-data layers. ${ready} analytical section${ready === 1 ? " has" : "s have"} mapped evidence, ${partial} require${partial === 1 ? "s" : ""} provider or coverage review, and ${insufficient} currently lack${insufficient === 1 ? "s" : ""} vital supporting data. Findings are planning context, not survey, engineering, legal, environmental or regulatory determinations.`,
    metrics: [
      { id: "ready", label: "Sections with evidence", value: number(ready) },
      { id: "partial", label: "Sections needing review", value: number(partial) },
      { id: "insufficient", label: "Insufficient-data sections", value: number(insufficient) },
      { id: "layers", label: "Project layers reviewed", value: number(availableLayers.length) },
    ],
    layerIds: availableLayers.map((layer) => layer.id),
    sources: availableLayers.map(layerSource),
    ...(insufficient
      ? { gapMessage: "See Insufficient Data & Follow-up for unresolved evidence categories." }
      : {}),
    analyzedAt,
  });

  const gapSections = [...sectionResults.values()].filter(
    (section) => section.status !== "ready" && section.id !== "study-area",
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

  const allSources = [
    ...new Map(availableLayers.map((layer) => [layer.id, layerSource(layer)])).values(),
  ];
  sectionResults.set("sources", {
    id: "sources",
    title: "Sources & Method",
    status: allSources.length ? "ready" : "insufficient",
    generatedNarrative: `This report was generated from the selected boundary and the loaded LandDraft layers available at ${analyzedAt}. Vector features were tested for spatial intersection with the boundary. Raster and viewport-dependent layers are identified as context but are not sampled by this foundation analyzer. Re-running updates generated evidence; user-authored narrative remains separate.`,
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
  return {
    ...workspace,
    currentRun: {
      id: `study-run-${Date.now()}-${uid()}`,
      analyzedAt,
      boundaryId: workspace.boundary.id,
      evidenceSignature: studyEvidenceSignature(layers, records),
      sections: orderedResults,
      warnings: [
        "Screening analysis only; not a survey, title opinion, engineering design, environmental site assessment or regulatory determination.",
        "Only locally available project evidence was analyzed in this run.",
      ],
    },
    updatedAt: analyzedAt,
  };
}
