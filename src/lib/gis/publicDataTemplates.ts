import { catalog, type CatalogEntry } from "./catalog.ts";
import { defaultStyle, type GisLayer, type LayerStyle } from "./types.ts";

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
      "Official land cover, terrain, soils, hydrography, wetlands, flood, environmental, transportation, energy and natural-hazard context used by Study Area Report analysis.",
    catalogIds: [
      "usgs-annual-nlcd-land-cover",
      "usgs-topographic-map",
      "nrcs-ssurgo-map-units",
      "nhd-flowlines",
      "usgs-waterbodies",
      "usgs-watersheds-huc12",
      "fws-wetlands",
      "fema-flood-zones",
      "epa-echo-facilities",
      "us-primary-roads-current",
      "tx-transmission",
      "us-power-plants-eia",
      "fema-national-risk-index",
    ],
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
      "Official WV parcel and oil/gas context combined with nationwide EIA transmission, natural-gas pipelines, power plants, peaker candidates, wind and solar coverage.",
    catalogIds: [
      "wv-parcels-statewide",
      "wv-oil-gas-wells",
      "wv-horizontal-well-laterals",
      "wv-well-pads",
      "wv-gas-pipeline-construction",
      "us-power-plants-eia",
      "us-peaker-plant-candidates-eia",
      "tx-transmission",
      "tx-pipelines",
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
      labelMinZoom: 11,
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
          requiresViewport: true,
          minZoom:
            entry.minZoom ?? (entry.geometry === "point" ? 7 : entry.geometry === "line" ? 5 : 5),
          ...(entry.id === "tx-parcels" ? { parcelDisplayVersion: 2 } : {}),
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
