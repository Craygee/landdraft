import type { StyleSpecification } from "maplibre-gl";

export interface Basemap {
  id: string;
  label: string;
  blurb: string;
  style: StyleSpecification | string;
  /** Small request used by the sign-in connection check. */
  healthUrl: string;
  /** Editable style or tile URL shown in connection settings. */
  connectionUrl: string;
  /** Equivalent keyless style used only when the preferred provider is unavailable. */
  fallbackStyle?: StyleSpecification | string;
  fallbackHealthUrl?: string;
}

export const DEFAULT_BASEMAP_ID = "osm";

const raster = (
  tiles: string[],
  attribution: string,
  maxzoom = 19,
  background = "#e8e4d9",
): StyleSpecification => ({
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    basemap: { type: "raster", tiles, tileSize: 256, attribution, maxzoom },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": background } },
    { id: "basemap", type: "raster", source: "basemap" },
  ],
});

export const basemaps: Basemap[] = [
  {
    id: "street",
    label: "Street",
    blurb: "Clean roads & places",
    style: "https://tiles.openfreemap.org/styles/liberty",
    connectionUrl: "https://tiles.openfreemap.org/styles/liberty",
    healthUrl: "https://tiles.openfreemap.org/styles/liberty",
    fallbackStyle: raster(
      ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      "© OpenStreetMap contributors",
      19,
    ),
    fallbackHealthUrl: "https://tile.openstreetmap.org/0/0/0.png",
  },
  {
    id: "satellite",
    label: "Satellite",
    blurb: "Global satellite imagery",
    style: raster(
      [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      "Imagery © Esri, Maxar, Earthstar Geographics",
      19,
      "#0b1a12",
    ),
    healthUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0",
    connectionUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "topo",
    label: "Topo",
    blurb: "USGS terrain & contours",
    style: raster(
      ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"],
      "USGS The National Map and contributors",
      16,
    ),
    healthUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/0/0/0",
    connectionUrl:
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    fallbackStyle: raster(
      ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      "© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors",
      17,
    ),
    fallbackHealthUrl: "https://tile.opentopomap.org/0/0/0.png",
  },
  {
    id: "dark",
    label: "Dark",
    blurb: "Night mode canvas",
    style: "https://tiles.openfreemap.org/styles/dark",
    connectionUrl: "https://tiles.openfreemap.org/styles/dark",
    healthUrl: "https://tiles.openfreemap.org/styles/dark",
    fallbackStyle: "https://tiles.openfreemap.org/styles/fiord",
    fallbackHealthUrl: "https://tiles.openfreemap.org/styles/fiord",
  },
  {
    id: "osm",
    label: "OSM",
    blurb: "Standard OpenStreetMap",
    style: raster(
      ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      "© OpenStreetMap contributors",
      19,
    ),
    healthUrl: "https://tile.openstreetmap.org/0/0/0.png",
    connectionUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
];

export const getBasemap = (id: string): Basemap =>
  basemaps.find((b) => b.id === id) ??
  basemaps.find((b) => b.id === DEFAULT_BASEMAP_ID) ??
  basemaps[0]!;

const BASEMAP_FALLBACKS_KEY = "landdraft.basemap-fallbacks.v1";
const BASEMAP_OVERRIDES_KEY = "landdraft.basemap-url-overrides.v1";

function readBasemapOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(BASEMAP_OVERRIDES_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function basemapProbeUrl(raw: string): string {
  const url = raw.trim();
  if (/\/MapServer\/?$/i.test(url)) return `${url.replace(/\/$/, "")}/tile/0/0/0`;
  return url.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0");
}

const basemapAttribution = (url: string) => {
  if (/World_Imagery/i.test(url)) return "Imagery © Esri, Maxar, Earthstar Geographics";
  if (/USGSTopo/i.test(url)) return "USGS The National Map and contributors";
  if (/World_Topo_Map/i.test(url)) return "Map data © Esri and contributors";
  if (/opentopomap/i.test(url)) return "© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors";
  if (/openfreemap|openstreetmap/i.test(url)) return "© OpenStreetMap contributors";
  return "Basemap © source publisher";
};

function basemapStyleFromUrl(raw: string): StyleSpecification | string {
  let url = raw.trim();
  if (/\/MapServer\/?$/i.test(url)) url = `${url.replace(/\/$/, "")}/tile/{z}/{y}/{x}`;
  if (url.includes("{z}") && url.includes("{x}") && url.includes("{y}"))
    return raster(
      [url],
      basemapAttribution(url),
      /USGSTopo/i.test(url) ? 16 : /opentopomap/i.test(url) ? 17 : 19,
    );
  return url;
}

export function saveBasemapUrlOverride(id: string, url: string): void {
  if (typeof window === "undefined") return;
  const overrides = readBasemapOverrides();
  overrides[id] = url.trim();
  window.localStorage.setItem(BASEMAP_OVERRIDES_KEY, JSON.stringify(overrides));
  setBasemapFallback(id, false);
  window.dispatchEvent(
    new CustomEvent("landdraft:basemap-health", { detail: { id, enabled: false } }),
  );
}

function fallbackIds(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(BASEMAP_FALLBACKS_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function setBasemapFallback(id: string, enabled: boolean): void {
  if (typeof window === "undefined") return;
  const ids = new Set(fallbackIds());
  const wasEnabled = ids.has(id);
  if (wasEnabled === enabled) return;
  if (enabled) ids.add(id);
  else ids.delete(id);
  window.localStorage.setItem(BASEMAP_FALLBACKS_KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new CustomEvent("landdraft:basemap-health", { detail: { id, enabled } }));
}

export function getBasemapStyle(id: string): StyleSpecification | string {
  const basemap = getBasemap(id);
  const override = typeof window !== "undefined" ? readBasemapOverrides()[id]?.trim() : "";
  if (override) return basemapStyleFromUrl(override);
  if (
    typeof window !== "undefined" &&
    basemap.fallbackStyle &&
    fallbackIds().includes(basemap.id)
  ) {
    return basemap.fallbackStyle;
  }
  return basemap.style;
}
