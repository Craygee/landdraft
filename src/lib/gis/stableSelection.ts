import type { Feature, FeatureCollection } from "geojson";

/** Source identifiers survive viewport paging and changes in result order. */
export function selectionIdentity(feature: Feature): string {
  if (feature.id !== undefined) return `id:${feature.id}`;
  for (const key of ["OBJECTID", "ObjectID", "objectid", "FID", "fid", "Prop_ID", "GEO_ID"]) {
    const value = feature.properties?.[key];
    if (value !== undefined && value !== null) return `${key}:${value}`;
  }
  return JSON.stringify([feature.geometry, feature.properties]);
}

export function preserveSelectedFeatures(
  previous: FeatureCollection,
  incoming: FeatureCollection,
  selectedIndexes: number[],
): { data: FeatureCollection; indexes: number[] } {
  const features = [...incoming.features];
  const positions = new Map(features.map((feature, index) => [selectionIdentity(feature), index]));
  const indexes: number[] = [];
  for (const index of selectedIndexes) {
    const selected = previous.features[index];
    if (!selected) continue;
    const key = selectionIdentity(selected);
    let nextIndex = positions.get(key);
    if (nextIndex === undefined) {
      // Keep only explicitly selected offscreen objects, not the entire old viewport.
      nextIndex = features.length;
      features.push(selected);
      positions.set(key, nextIndex);
    }
    indexes.push(nextIndex);
  }
  return { data: { ...incoming, features }, indexes };
}
