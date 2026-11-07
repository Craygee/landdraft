import { catalog, type CatalogEntry } from "./catalog.ts";
import { defaultStyle, type GisLayer, type LayerStyle } from "./types.ts";
import { PARCEL_DISPLAY_VERSION } from "./parcelDisplay.ts";

export const NO_PUBLIC_DATA_TEMPLATE = "none";

export interface PublicDataTemplate {
  id: string;
  name: string;
  description: string;
  catalogIds: string[];
  states?: string[];
}

/**
 * Shipped, source-controlled layer collections. These contain references to the normal public
 * catalog rather than copies of provider records, so catalog fixes and attribution stay shared.
 */
export const publicDataTemplates: PublicDataTemplate[] = [
  {
    id: "study-area-report-screening",
    name: "Study area report — national screening",
    description:
      "Official land cover, terrain, soils, geology, hydrography, wetlands, flood, protected land, cultural, environmental, transportation, energy and natural-hazard context used by Study Area Report analysis.",
    catalogIds: [
      "usgs-annual-nlcd-land-cover",
      "usgs-topographic-map",
      "nrcs-ssurgo-map-units",
      "usgs-state-geologic-map",
      "usgs-principal-aquifers",
      "nhd-flowlines",
      "usgs-waterbodies",
      "usgs-watersheds-huc12",
      "fws-wetlands",
      "fema-flood-zones",
      "padus-fee-managers",
      "padus-easements",
      "fws-critical-habitat",
      "nps-nrhp-points",
      "nps-nrhp-polygons",
      "epa-echo-facilities",
      "epa-superfund",
      "epa-lust-releases",
      "us-primary-roads-current",
      "bts-rail-network",
      "tx-transmission",
      "tx-pipelines",
      "us-power-plants-eia",
      "epa-water-system-boundaries",
      "usgs-landslide-inventory",
      "usgs-quaternary-faults",
      "fema-national-risk-index",
    ],
  },
  {
    id: "texas-land-study",
    name: "Texas land study",
    description:
      "Texas parcels, roads and rail with aquifers, reported wells, water and sewer CCNs, groundwater and water districts, state cleanup records, oil and gas wells, detailed pipelines and substation archive.",
    catalogIds: [
      "tx-parcels",
      "txdot-roadways",
      "tx-railroads",
      "tx-major-aquifers",
      "tx-minor-aquifers",
      "tx-groundwater-wells",
      "tx-twdb-well-reports",
      "tx-puc-water-ccn",
      "tx-puc-sewer-ccn",
      "tx-tceq-groundwater-districts",
      "tx-tceq-water-districts",
      "tx-tceq-wastewater-outfalls",
      "tx-tceq-lpst",
      "tx-tceq-superfund",
      "tx-tceq-vcp",
      "tx-tceq-ihw-corrective-action",
      "tx-rrc-well-locations",
      "tx-rrc-orphan-wells",
      "tx-rrc-pipelines",
      "tx-substations-archive",
    ],
    states: ["TX"],
  },
  {
    id: "west-virginia-land-study",
    name: "West Virginia land study",
    description:
      "West Virginia parcels and buildings with landslides, geology, mines, remediation, dams, reported water and sewer systems, historic listings, oil and gas wells and natural-gas pipelines.",
    catalogIds: [
      "wv-parcels-statewide",
      "wv-building-footprints",
      "wv-landslide-lidar-points",
      "wv-landslide-incidents",
      "wv-landslide-susceptibility",
      "wv-geology-1968",
      "wv-aml-points",
      "wv-aml-polygons",
      "wv-mining-permits",
      "wv-underground-mining-limits",
      "wv-land-use-covenants",
      "wv-voluntary-remediation",
      "wv-sems-sites",
      "wv-dams",
      "wv-impaired-streams",
      "wv-water-lines",
      "wv-sewer-lines",
      "wv-water-served-areas",
      "wv-sewer-served-areas",
      "wv-shpo-national-register-points",
      "wv-shpo-national-register-polygons",
      "wv-oil-gas-wells",
      "wv-well-pads",
      "wv-natural-gas-pipelines-wvdot",
    ],
    states: ["WV"],
  },
  {
    id: "texas-energy-infrastructure",
    name: "Texas energy & infrastructure",
    description:
      "Power plants, peaker candidates, gas power and processing plants, transmission, pipelines, wind and solar.",
    catalogIds: [
      "us-power-plants-eia",
      "us-peaker-plant-candidates-eia",
      "tx-natural-gas-power-plants-eia",
      "tx-natural-gas-processing-plants-hifld",
      "tx-transmission",
      "tx-rrc-pipelines",
      "us-wind-turbines",
      "us-solar",
    ],
    states: ["TX"],
  },
  {
    id: "texas-site-screening",
    name: "Texas site screening",
    description:
      "Parcels, roads, counties, cities, opportunity zones, wetlands, floodplain and topographic context.",
    catalogIds: [
      "tx-parcels",
      "txdot-roadways",
      "tx-counties",
      "tx-cities",
      "us-opportunity-zones",
      "fws-wetlands",
      "fema-100-year-floodplain",
      "usgs-topographic-map",
    ],
    states: ["TX"],
  },
  {
    id: "west-virginia-energy-infrastructure",
    name: "West Virginia energy & infrastructure",
    description:
      "Official WV parcel, oil/gas and WVDOT natural-gas pipeline context combined with nationwide EIA transmission, power plants, peaker candidates, wind and solar coverage.",
    catalogIds: [
      "wv-parcels-statewide",
      "wv-oil-gas-wells",
      "wv-horizontal-well-laterals",
      "wv-well-pads",
      "wv-gas-pipeline-construction",
      "wv-natural-gas-pipelines-wvdot",
      "us-power-plants-eia",
      "us-peaker-plant-candidates-eia",
      "tx-transmission",
      "us-wind-turbines",
      "us-solar",
    ],
    states: ["WV"],
  },
  {
    id: "west-virginia-site-screening",
    name: "West Virginia site screening",
    description:
      "Statewide parcels plus current roads, counties, municipalities, opportunity zones, wetlands, flood hazards and topographic context.",
    catalogIds: [
      "wv-parcels-statewide",
      "us-primary-roads-current",
      "us-local-roads-current",
      "us-counties-current",
      "us-incorporated-places-current",
      "us-opportunity-zones",
      "fws-wetlands",
      "fema-flood-zones",
      "usgs-topographic-map",
    ],
    states: ["WV"],
  },
  {
    id: "national-energy-development",
    name: "National energy development",
    description:
      "Nationwide power plants, peaker candidates, wind turbines, solar facilities and primary roads.",
    catalogIds: [
      "us-power-plants-eia",
      "us-peaker-plant-candidates-eia",
      "us-wind-turbines",
      "us-solar",
      "us-primary-roads-current",
    ],
  },
  {
    id: "water-terrain-environment",
    name: "Water, terrain & environment",
    description:
      "Streams, waterbodies, watersheds, wetlands, flood zones and a maintained topographic overlay.",
    catalogIds: [
      "nhd-flowlines",
      "usgs-waterbodies",
      "usgs-watersheds-huc12",
      "fws-wetlands",
      "fema-flood-zones",
      "usgs-topographic-map",
    ],
  },
];

export const publicDataTemplateById = (id: string | null | undefined) =>
  publicDataTemplates.find((template) => template.id === id);

export const isSourceOnlyCatalogEntry = (entry: CatalogEntry) => !entry.url && !entry.downloadUrl;

export const catalogLayerStyle = (entry: CatalogEntry): Partial<LayerStyle> => {
  const published = entry.defaultStyle ?? {};
  if (entry.id === "tx-parcels")
    return {
      fillOpacity: 0,
      strokeWidth: 1,
      labelEnabled: true,
      labelTemplate: "{OWNER_NAME}",
      labelFields: ["OWNER_NAME"],
      labelMinZoom: 10,
      labelSize: 11,
      labelScaleWithZoom: true,
      ...published,
    };
  if (entry.id === "us-state-boundaries-shp")
    return {
      fillOpacity: 0.08,
      strokeWidth: 2,
      strokeColor: "#3b6ea5",
      fillColor: "#3b6ea5",
      labelEnabled: true,
      labelTemplate: "{NAME}",
      labelFields: ["NAME"],
      labelSize: 12,
      ...published,
    };
  if (entry.id === "us-opportunity-zones")
    return {
      fillOpacity: 0.22,
      strokeWidth: 1.5,
      strokeColor: "#6b3fa0",
      fillColor: "#8a5bb8",
      labelEnabled: false,
      ...published,
    };
  if (entry.geometry === "line") return { fillOpacity: 0, strokeWidth: 2.5, ...published };
  return published;
};

export const publicDataTemplateEntries = (templateId: string): CatalogEntry[] => {
  const template = publicDataTemplateById(templateId);
  if (!template) return [];
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  return template.catalogIds.flatMap((id) => {
    const entry = byId.get(id);
    return entry?.url ? [entry] : [];
  });
};

const templateLayer = (
  templateId: string,
  entry: CatalogEntry,
  index: number,
  createdAt: number,
): GisLayer => {
  const source =
    entry.rendering === "raster-tiles"
      ? {
          kind: "raster" as const,
          tiles: [entry.url!],
          tileSize: entry.tileSize ?? (256 as const),
          catalogId: entry.id,
          attribution: entry.agency,
          ...(entry.minZoom !== undefined ? { minZoom: entry.minZoom } : {}),
          ...(entry.maxZoom !== undefined ? { maxZoom: entry.maxZoom } : {}),
        }
      : {
          kind: "remote" as const,
          url: entry.url!,
          catalogId: entry.id,
          attribution: entry.agency,
          ...(entry.where ? { where: entry.where } : {}),
          ...(entry.outFields ? { outFields: entry.outFields } : {}),
          requiresViewport: true,
          minZoom:
            entry.minZoom ?? (entry.geometry === "point" ? 7 : entry.geometry === "line" ? 5 : 5),
          ...(entry.id === "tx-parcels" ? { parcelDisplayVersion: PARCEL_DISPLAY_VERSION } : {}),
        };
  return {
    id: `public-template-${templateId}-${entry.id}-${Math.random().toString(36).slice(2, 9)}`,
    name: entry.name,
    groupId: "public",
    visible: true,
    data: { type: "FeatureCollection", features: [] },
    source,
    style: { ...defaultStyle(index), ...catalogLayerStyle(entry) },
    createdAt,
  };
};

export interface AppliedPublicDataTemplate {
  layers: GisLayer[];
  added: number;
  shown: number;
}

export function applyPublicDataTemplateLayers(
  layers: GisLayer[],
  templateId: string,
  now = Date.now(),
): AppliedPublicDataTemplate {
  const entries = publicDataTemplateEntries(templateId);
  if (!entries.length) return { layers, added: 0, shown: 0 };

  let shown = 0;
  const existingCatalogIds = new Set(
    layers.flatMap((layer) =>
      "catalogId" in layer.source && layer.source.catalogId ? [layer.source.catalogId] : [],
    ),
  );
  const templateIds = new Set(entries.map((entry) => entry.id));
  const visibleLayers = layers.map((layer) => {
    const catalogId = "catalogId" in layer.source ? layer.source.catalogId : undefined;
    if (catalogId && templateIds.has(catalogId) && !layer.visible) {
      shown += 1;
      return { ...layer, visible: true };
    }
    return layer;
  });
  const additions = entries
    .filter((entry) => !existingCatalogIds.has(entry.id))
    .map((entry, index) => templateLayer(templateId, entry, index, now + index));

  return { layers: [...additions, ...visibleLayers], added: additions.length, shown };
}
