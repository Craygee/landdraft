import type { GisLayer } from "../gis/types.ts";
import type { StudyReportSectionId } from "./types.ts";

export interface StudySourceProfile {
  sections: StudyReportSectionId[];
  /** Attribute whose values split polygon coverage, e.g. FEMA zones, rather than one total. */
  classFields?: string[];
  /** Fields worth summarizing, in preference to whichever fields happen to be most populated. */
  summaryFields?: string[];
  /** Field that names a feature in location tables. */
  labelField?: string;
  /** Search distance beyond the boundary. 0 reports on-site findings only. */
  nearbyMiles: number;
  /** Polygons that describe the area generally, such as tracts or aquifers. */
  context?: boolean;
  /** Features counted in tables but left off maps, where drawing them would read as a hazard. */
  figureExclude?: { field: string; values: string[]; note: string };
}

const profile = (
  sections: StudyReportSectionId[],
  nearbyMiles: number,
  extra: Omit<StudySourceProfile, "sections" | "nearbyMiles"> = {},
): StudySourceProfile => ({ sections, nearbyMiles, ...extra });

const flood = {
  classFields: ["FLD_ZONE", "ZONE_SUBTY"],
  summaryFields: ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF"],
  figureExclude: {
    field: "ZONE_SUBTY",
    values: ["AREA OF MINIMAL FLOOD HAZARD"],
    note: "Areas of minimal flood hazard are counted here but not drawn on the map.",
  },
};
const remedial = (labelField: string, summaryFields: string[] = []) =>
  profile(["environmental"], 1, { labelField, summaryFields });
const cleanup = remedial("SITE_NAME", ["REM_PROG", "COUNTY"]);
const nrhp = profile(["environmental"], 0.5, {
  labelField: "RESNAME",
  summaryFields: ["ResType", "Is_NHL"],
});
const shpo = profile(["environmental"], 0.5, {
  labelField: "HistName",
  summaryFields: ["ResourceType"],
});
const ccn = profile(["infrastructure"], 0, {
  classFields: ["UTILITY"],
  summaryFields: ["CCN_NO", "STATUS"],
  context: true,
});
const served = profile(["infrastructure"], 0.25, {
  classFields: ["Utility"],
  summaryFields: ["Status", "Quality"],
  context: true,
});
const lines = profile(["infrastructure"], 0.25, {
  labelField: "Utility",
  summaryFields: ["Utility", "Status", "Quality"],
});
const protectedLand = profile(["environmental"], 0.5, {
  classFields: ["Unit_Nm"],
  summaryFields: ["Mang_Name", "Des_Tp", "Pub_Access"],
  labelField: "Unit_Nm",
});

/**
 * Explicit routing for every shipped source. Layer text alone is not reliable: "epa" occurs in
 * "Department" and "geologic" in "U.S. Geological Survey". A regression test requires every shipped
 * connection to appear here.
 */
export const STUDY_SOURCE_PROFILES: Record<string, StudySourceProfile> = {
  // Property and land use
  "tx-parcels": profile(["land-cover"], 0, { labelField: "PROP_ID", summaryFields: ["GIS_AREA"] }),
  "fl-parcels-statewide": profile(["land-cover"], 0),
  "ct-parcels-statewide": profile(["land-cover"], 0),
  "oh-parcels-statewide": profile(["land-cover"], 0),
  "wv-parcels-statewide": profile(["land-cover"], 0, {
    labelField: "CleanParcelID",
    summaryFields: ["COUNTY"],
  }),
  "usgs-annual-nlcd-land-cover": profile(["land-cover"], 0),
  "usgs-imagery": profile(["land-cover"], 0),
  "tx-austin-zoning": profile(["land-cover"], 0, {
    classFields: ["ZONING_ZTYPE"],
    summaryFields: ["ZONING_BASE"],
  }),
  "wv-building-footprints": profile(["land-cover"], 0, { summaryFields: ["Class"] }),
  "glo-psf": profile(["land-cover"], 0),
  "glo-leases": profile(["energy"], 0),
  "us-counties-current": profile(["study-area"], 0, { context: true, classFields: ["NAME"] }),
  "us-incorporated-places-current": profile(["land-cover"], 1, {
    context: true,
    classFields: ["NAME"],
  }),
  "tx-counties": profile(["study-area"], 0, { context: true }),
  "tx-cities": profile(["land-cover"], 1, { context: true }),
  "census-tracts": profile(["study-area"], 0, { context: true }),
  "us-opportunity-zones": profile(["energy"], 0, { context: true }),
  "us-state-boundaries-shp": profile(["study-area"], 0, { context: true }),
  // Terrain and subsurface
  "usgs-topographic-map": profile(["terrain"], 0),
  "usgs-3dep-hillshade": profile(["terrain"], 0),
  "usgs-3dep-slope-map": profile(["terrain"], 0),
  "nrcs-ssurgo-map-units": profile(["soils"], 0, {
    classFields: ["muname"],
    summaryFields: ["muname", "farmlndcl", "nirrcapcl"],
  }),
  "usgs-state-geologic-map": profile(["soils"], 0, {
    classFields: ["generalize"],
    summaryFields: ["unit_name", "major1", "age_min"],
    context: true,
  }),
  "wv-geology-1968": profile(["soils"], 0, {
    classFields: ["FORMATION"],
    summaryFields: ["PERIOD", "COAL"],
    context: true,
  }),
  // Water
  "nhd-flowlines": profile(["hydrology"], 0.25, {
    labelField: "gnis_name",
    summaryFields: ["gnis_name", "ftype"],
  }),
  "usgs-waterbodies": profile(["hydrology"], 0.25, {
    labelField: "gnis_name",
    summaryFields: ["gnis_name", "ftype"],
  }),
  "usgs-water-areas": profile(["hydrology"], 0.25, {
    labelField: "gnis_name",
    summaryFields: ["ftype"],
  }),
  "usgs-hydro-points": profile(["hydrology"], 0.25, {
    labelField: "gnis_name",
    summaryFields: ["ftype"],
  }),
  "usgs-watersheds-huc12": profile(["hydrology"], 0, {
    classFields: ["name"],
    summaryFields: ["huc12"],
    context: true,
  }),
  "usgs-watersheds-huc8": profile(["hydrology"], 0, {
    classFields: ["name"],
    summaryFields: ["huc8"],
    context: true,
  }),
  "fws-wetlands": profile(["hydrology"], 0.25, {
    classFields: ["WETLAND_TYPE"],
    summaryFields: ["WETLAND_TYPE"],
  }),
  "fws-riparian": profile(["hydrology"], 0.25, { summaryFields: ["ATTRIBUTE"] }),
  "fema-flood-zones": profile(["hydrology"], 0, flood),
  "fema-100-year-floodplain": profile(["hydrology"], 0, flood),
  "fema-500-year-floodplain": profile(["hydrology"], 0, flood),
  "fema-regulatory-floodway": profile(["hydrology"], 0, flood),
  "fema-base-flood-elevations": profile(["hydrology"], 0.25),
  "fema-levees": profile(["hydrology"], 0.5),
  "fema-map-revisions": profile(["hydrology"], 0),
  "tx-groundwater-wells": profile(["hydrology"], 0.5, {
    labelField: "StWellID",
    summaryFields: ["Aquifer", "WellUse", "WellDepth"],
  }),
  "tx-public-water-wells": profile(["hydrology"], 0.5),
  "tx-twdb-well-reports": profile(["hydrology"], 0.5, {
    labelField: "WellReportTrackingNumber",
    summaryFields: ["ProposedUse", "BoreholeDepthFt"],
  }),
  "tx-major-aquifers": profile(["hydrology"], 0, { classFields: ["AQ_NAME"], context: true }),
  "tx-minor-aquifers": profile(["hydrology"], 0, { classFields: ["AQ_NAME"], context: true }),
  "usgs-principal-aquifers": profile(["hydrology"], 0, {
    classFields: ["AQ_NAME"],
    summaryFields: ["ROCK_NAME"],
    context: true,
  }),
  "tx-tceq-edwards-aquifer": profile(["hydrology"], 0, { classFields: ["TYPE"] }),
  "tx-tceq-groundwater-districts": profile(["hydrology"], 0, {
    classFields: ["DISTNAME"],
    context: true,
  }),
  "wv-dams": profile(["hydrology", "hazards"], 1, {
    labelField: "dam_name",
    summaryFields: ["downstream_hazard"],
  }),
  "wv-dam-inundation": profile(["hydrology", "hazards"], 0),
  "wv-impaired-streams": profile(["hydrology"], 0.25, {
    labelField: "wv_strname",
    summaryFields: ["wv_strname"],
  }),
  // Environmental records, protected land and cultural resources
  "padus-fee-managers": protectedLand,
  "padus-easements": protectedLand,
  "fws-critical-habitat": profile(["environmental"], 0.5, {
    classFields: ["comname"],
    summaryFields: ["status", "fedreg"],
  }),
  "usgs-protected-lands-reference": profile(["environmental"], 0),
  "tpwd-gis-library": profile(["environmental"], 0),
  "nps-nrhp-points": nrhp,
  "nps-nrhp-polygons": nrhp,
  "wv-shpo-national-register-points": shpo,
  "wv-shpo-national-register-polygons": shpo,
  "usgs-cemeteries": profile(["environmental"], 0.25),
  "usgs-historic-sites": profile(["environmental"], 0.25),
  "epa-echo-facilities": remedial("FAC_NAME", ["FAC_MAJOR_FLAG", "FAC_ACTIVE_FLAG"]),
  "epa-superfund": remedial("PRIMARY_NAME"),
  "epa-toxic-releases": remedial("PRIMARY_NAME"),
  "epa-hazardous-waste": remedial("PRIMARY_NAME"),
  "epa-large-brownfields": remedial("PROPERTY_NAME"),
  "epa-ust-facilities": remedial("Name", ["County"]),
  "epa-lust-releases": remedial("Name", ["County"]),
  "tx-tceq-lpst": cleanup,
  "tx-tceq-pst": remedial("FACILITY_NAME", ["UST_TYPE"]),
  "tx-tceq-superfund": cleanup,
  "tx-tceq-vcp": cleanup,
  "tx-tceq-brownfields": cleanup,
  "tx-tceq-ihw-corrective-action": cleanup,
  "tx-tceq-landfills": remedial("FACILITY_N", ["LANDFILL_T"]),
  "wv-land-use-covenants": remedial("site_name", ["gw_rstrct", "res_rstrct", "exc_rstrct"]),
  "wv-voluntary-remediation": remedial("proj_name", ["proj_status", "contamination"]),
  "wv-sems-sites": remedial("site_name", ["npl_status", "site_statu"]),
  "wv-aml-points": remedial("padname", ["status"]),
  "wv-aml-lines": remedial("padname", ["status"]),
  "wv-aml-polygons": remedial("padname", ["status"]),
  "wv-mining-permits": remedial("facility_name", ["pstatus", "permittee"]),
  "wv-underground-mining-limits": remedial("facility_name", ["permit_seam", "operator"]),
  // Transportation and utilities
  "txdot-roadways": profile(["infrastructure"], 1, {
    labelField: "RTE_NM",
    summaryFields: ["RTE_PRFX", "MAP_LBL"],
  }),
  "txdot-aadt": profile(["infrastructure"], 1),
  "tx-railroads": profile(["infrastructure"], 5),
  "tx-airports": profile(["infrastructure"], 5),
  "us-primary-roads-current": profile(["infrastructure"], 5, {
    labelField: "NAME",
    summaryFields: ["NAME"],
  }),
  "us-local-roads-current": profile(["infrastructure"], 0.25, {
    labelField: "NAME",
    summaryFields: ["NAME"],
  }),
  "usgs-local-access-roads": profile(["infrastructure"], 0.25),
  "usgs-runways": profile(["infrastructure"], 5),
  "usgs-trails": profile(["infrastructure"], 0),
  "usgs-trailheads": profile(["infrastructure"], 0),
  "usgs-hospitals": profile(["infrastructure"], 5),
  "usgs-fire-ems": profile(["infrastructure"], 5),
  "bts-rail-network": profile(["infrastructure"], 5, {
    labelField: "SUBDIV",
    summaryFields: ["RROWNER1", "SUBDIV", "TRACKS"],
  }),
  "epa-water-system-boundaries": profile(["infrastructure"], 0, {
    classFields: ["PWS_Name"],
    summaryFields: ["PWSID", "Model_Method"],
    context: true,
  }),
  "tx-puc-water-ccn": ccn,
  "tx-puc-sewer-ccn": ccn,
  "tx-tceq-water-districts": profile(["infrastructure"], 0, {
    classFields: ["NAME"],
    summaryFields: ["TYPE", "STATUS"],
    context: true,
  }),
  "tx-tceq-wastewater-outfalls": profile(["infrastructure"], 1, {
    labelField: "PERMITTEE",
    summaryFields: ["STATUS"],
  }),
  "wv-water-lines": lines,
  "wv-sewer-lines": lines,
  "wv-water-served-areas": served,
  "wv-sewer-served-areas": served,
  "tx-roundrock-fiber-ring": profile(["infrastructure"], 1),
  "tx-roundrock-fiber-conduit": profile(["infrastructure"], 1),
  // Energy
  "tx-transmission": profile(["infrastructure", "energy"], 5, {
    labelField: "OWNER",
    summaryFields: ["VOLTAGE", "VOLT_CLASS", "OWNER", "STATUS"],
  }),
  "tx-substations-archive": profile(["infrastructure", "energy"], 5, {
    labelField: "NAME",
    summaryFields: ["MAX_VOLT", "STATUS"],
  }),
  "tx-pipelines": profile(["infrastructure", "energy"], 5, {
    labelField: "Operator",
    summaryFields: ["TYPEPIPE", "Operator"],
  }),
  "tx-rrc-pipelines": profile(["infrastructure", "energy"], 2, {
    labelField: "OPERATOR",
    summaryFields: ["COMMODITY", "STATUS", "OPERATOR", "DIAMETER"],
  }),
  "wv-natural-gas-pipelines-wvdot": profile(["infrastructure", "energy"], 2, {
    labelField: "Company",
    summaryFields: ["Company", "Diameter_in"],
  }),
  "wv-gas-pipeline-construction": profile(["energy"], 1),
  "us-power-plants-eia": profile(["energy"], 5, {
    labelField: "Plant_Name",
    summaryFields: ["PrimSource", "Total_MW"],
  }),
  "us-peaker-plant-candidates-eia": profile(["energy"], 5, {
    labelField: "Plant_Name",
    summaryFields: ["PrimSource", "tech_desc"],
  }),
  "tx-natural-gas-power-plants-eia": profile(["energy"], 5, {
    labelField: "Plant_Name",
    summaryFields: ["tech_desc"],
  }),
  "tx-natural-gas-processing-plants-hifld": profile(["energy"], 5, {
    labelField: "NAME",
    summaryFields: ["STATUS"],
  }),
  "us-wind-turbines": profile(["energy"], 2, { labelField: "p_name", summaryFields: ["p_name"] }),
  "us-solar": profile(["energy"], 2, { labelField: "p_name", summaryFields: ["p_name"] }),
  "tx-rrc-well-locations": profile(["energy", "environmental"], 0.5, {
    labelField: "API",
    summaryFields: ["GIS_SYMBOL_DESCRIPTION"],
  }),
  "tx-rrc-orphan-wells": profile(["energy", "environmental"], 0.5, { labelField: "API" }),
  "wv-oil-gas-wells": profile(["energy", "environmental"], 0.5, {
    labelField: "api",
    summaryFields: ["welltype", "wellstatus"],
  }),
  "wv-horizontal-well-laterals": profile(["energy"], 0.5),
  "wv-well-pads": profile(["energy", "environmental"], 0.5),
  // Hazards
  "fema-national-risk-index": profile(["hazards"], 0, {
    classFields: ["RISK_RATNG"],
    summaryFields: ["RISK_RATNG", "EAL_RATNG", "SOVI_RATNG"],
    context: true,
  }),
  "usgs-earthquakes-month": profile(["hazards"], 25),
  "usgs-quaternary-faults": profile(["hazards"], 25, {
    labelField: "fault_name",
    summaryFields: ["age", "slip_rate"],
  }),
  "usgs-landslide-inventory": profile(["hazards"], 0.5, {
    summaryFields: ["LS_Type", "Inventory", "Confidence"],
  }),
  "wv-landslide-lidar-points": profile(["hazards"], 0.5, {
    summaryFields: ["TypeOfMovement", "Field_Verified"],
  }),
  "wv-landslide-incidents": profile(["hazards"], 0.5, {
    summaryFields: ["Location_confidence_0_3"],
  }),
  "wv-landslide-susceptibility": profile(["hazards"], 0),
};

/** Whole-word phrases, tested only against what the user named a layer they added themselves. */
const USER_LAYER_KEYWORDS: Array<[StudyReportSectionId, string[]]> = [
  [
    "land-cover",
    [
      "land cover",
      "landcover",
      "nlcd",
      "crop",
      "cropland",
      "parcel",
      "parcels",
      "property",
      "zoning",
      "land use",
    ],
  ],
  [
    "terrain",
    [
      "elevation",
      "terrain",
      "slope",
      "topo",
      "topographic",
      "contour",
      "contours",
      "relief",
      "3dep",
      "dem",
      "hillshade",
    ],
  ],
  [
    "hydrology",
    [
      "hydro",
      "hydrology",
      "water",
      "stream",
      "streams",
      "river",
      "rivers",
      "wetland",
      "wetlands",
      "flood",
      "floodplain",
      "watershed",
      "aquifer",
      "well",
      "wells",
      "drainage",
    ],
  ],
  ["soils", ["soil", "soils", "ssurgo", "statsgo", "bedrock", "geology", "geologic", "karst"]],
  [
    "site-suitability",
    ["buildable", "suitability", "constraint", "constraints", "exclusion", "setback", "candidate"],
  ],
  [
    "environmental",
    [
      "environment",
      "environmental",
      "epa",
      "superfund",
      "brownfield",
      "contamination",
      "hazmat",
      "storage tank",
      "ust",
      "rcra",
      "tri",
      "protected",
      "habitat",
      "historic",
      "cemetery",
      "easement",
      "mine",
      "mines",
    ],
  ],
  [
    "infrastructure",
    [
      "road",
      "roads",
      "highway",
      "rail",
      "railroad",
      "transmission",
      "substation",
      "substations",
      "pipeline",
      "pipelines",
      "fiber",
      "broadband",
      "data center",
      "utility",
      "utilities",
      "electric",
      "infrastructure",
      "sewer",
    ],
  ],
  [
    "energy",
    [
      "solar",
      "wind",
      "turbine",
      "energy",
      "power plant",
      "battery",
      "ev charging",
      "irradiance",
      "oil",
      "gas",
    ],
  ],
  [
    "hazards",
    [
      "hazard",
      "hazards",
      "wildfire",
      "earthquake",
      "fault",
      "faults",
      "tornado",
      "hurricane",
      "drought",
      "hail",
      "landslide",
      "climate",
      "weather",
      "risk",
    ],
  ],
];

const catalogIdOf = (layer: GisLayer) =>
  "catalogId" in layer.source ? layer.source.catalogId : undefined;

export function studyProfileForLayer(layer: GisLayer): StudySourceProfile | undefined {
  const catalogId = catalogIdOf(layer);
  return catalogId ? STUDY_SOURCE_PROFILES[catalogId] : undefined;
}

export function studySectionsForLayer(layer: GisLayer): StudyReportSectionId[] {
  const known = studyProfileForLayer(layer);
  if (known) return known.sections;
  if (layer.source.kind === "derived" && layer.source.cacheProvenance?.["buildableArea"])
    return ["site-suitability"];
  const text = [layer.name, layer.source.kind === "derived" ? layer.source.query : ""]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return USER_LAYER_KEYWORDS.filter(([, words]) =>
    words.some((word) =>
      new RegExp(`(^|[^a-z0-9])${word.replace(/ /g, "\\s+")}($|[^a-z0-9])`).test(text),
    ),
  ).map(([section]) => section);
}

/** Largest search distance a layer needs, used to expand its study query. */
export function studyNearbyMilesForLayer(layer: GisLayer): number {
  return studyProfileForLayer(layer)?.nearbyMiles ?? DEFAULT_NEARBY_MILES;
}

export const DEFAULT_NEARBY_MILES = 0.25;
