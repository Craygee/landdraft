import type { FeatureCollection } from "geojson";
export const OFFLINE_AREA_FEATURE = {
  key: "offline_areas",
  phase: "preview",
  maxPacks: 8,
  maxBytes: 25 * 1024 * 1024,
  maxCoordinates: 300000,
} as const;
export function validateOfflineBounds(bounds: number[]) {
  if (
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0]! >= bounds[2]! ||
    bounds[1]! >= bounds[3]! ||
    bounds[0]! < -180 ||
    bounds[2]! > 180 ||
    bounds[1]! < -85 ||
    bounds[3]! > 85
  )
    throw new Error("Choose a valid map extent");
  const area =
    (bounds[2]! - bounds[0]!) *
    (bounds[3]! - bounds[1]!) *
    12364 *
    Math.cos((((bounds[1]! + bounds[3]!) / 2) * Math.PI) / 180);
  if (area > 600 || bounds[2]! - bounds[0]! > 0.4 || bounds[3]! - bounds[1]! > 0.4)
    throw new Error("Zoom in: choose an offline area smaller than 600 km² and 0.4° across");
  return area;
}
export function validateOfflineComplexity(collections: FeatureCollection[]) {
  let count = 0;
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      if (++count > OFFLINE_AREA_FEATURE.maxCoordinates)
        throw new Error(
          "This area has too much geometry for smooth offline use. Choose a smaller extent.",
        );
    } else value.forEach(walk);
  };
  for (const collection of collections)
    for (const feature of collection.features) {
      if (feature.geometry && "coordinates" in feature.geometry) walk(feature.geometry.coordinates);
    }
  return count;
}
