import type { CatalogEntry } from "./catalog";

/**
 * The zoom a catalog layer actually starts drawing at. Feature layers fall back to
 * zoom 7 for points and 5 for lines and areas; map-image layers draw from zoom 0
 * unless the entry sets its own cutoff. DataDrawer uses this both for the layer
 * it adds and for the tag it shows, so the two cannot drift apart.
 */
export function catalogMinZoom(entry: CatalogEntry): number {
  if (entry.rendering === "raster-tiles") return entry.minZoom ?? 0;
  return entry.minZoom ?? (entry.geometry === "point" ? 7 : 5);
}

export type CatalogTagKind =
  | "category"
  | "geometry"
  | "coverage"
  | "access"
  | "connection"
  | "cadence"
  | "zoom"
  | "license";

export interface CatalogTag {
  kind: CatalogTagKind;
  label: string;
}

const isSourceOnly = (entry: CatalogEntry) => !entry.url && !entry.downloadUrl;

/** The tags shown on a card in "Add public data", derived from what the layer really loads. */
export function catalogEntryTags(entry: CatalogEntry): CatalogTag[] {
  const raster = entry.rendering === "raster-tiles";
  const sourceOnly = isSourceOnly(entry);
  const tags: CatalogTag[] = [
    { kind: "category", label: entry.category },
    // Map-image layers are pictures, not polygons, so they cannot be queried or styled as shapes.
    { kind: "geometry", label: raster ? "map image" : entry.geometry },
    { kind: "coverage", label: entry.states === "US" ? "Nationwide" : entry.states.join(", ") },
  ];
  if (entry.downloadUrl) tags.push({ kind: "access", label: "official shapefile" });
  else if (raster) tags.push({ kind: "access", label: "streamed map tiles" });
  else if (entry.url) tags.push({ kind: "access", label: "loads current view" });
  // Source-only entries open the publisher's page; nothing is downloaded into the map.
  tags.push({ kind: "connection", label: sourceOnly ? "source page only" : entry.connection });
  tags.push({ kind: "cadence", label: entry.updateCadence });
  if (entry.url) {
    if (entry.id === "tx-parcels") {
      tags.push({ kind: "zoom", label: "Borders 10+ · large-parcel labels 11+" });
    } else {
      const zoom = catalogMinZoom(entry);
      if (zoom > 0) tags.push({ kind: "zoom", label: `zoom ${zoom}+` });
    }
  }
  tags.push({ kind: "license", label: entry.license });
  return tags;
}
