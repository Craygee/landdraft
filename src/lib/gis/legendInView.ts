import type { GisLayer } from "./types.ts";
import { mapBoundsForLayers, type MapBounds } from "./recordNavigation.ts";

export function legendZoomBounds(layer: GisLayer, value?: string): MapBounds | null {
  if (layer.source.kind === "image") {
    const coords = layer.source.coordinates;
    return [
      Math.min(...coords.map((p) => p[0])),
      Math.min(...coords.map((p) => p[1])),
      Math.max(...coords.map((p) => p[0])),
      Math.max(...coords.map((p) => p[1])),
    ];
  }
  const category = layer.style.categorized;
  const features = layer.data.features.filter((feature) => {
    if (feature.properties?.["__hidden"]) return false;
    const actual = String(feature.properties?.[category?.field ?? ""] ?? "");
    if (value !== undefined) return actual === value;
    return (
      !category?.enabled ||
      (category.rules.find((rule) => rule.value === actual)?.visible ?? category.fallbackVisible)
    );
  });
  return mapBoundsForLayers([{ ...layer, data: { type: "FeatureCollection", features } }]);
}

/** Accept only features returned by the map's current viewport query. */
export function legendValuesInView(
  layer: GisLayer,
  features: { properties: Record<string, unknown> | null }[],
): Record<string, string[]> | null {
  if (!layer.visible) return null;
  const category = layer.style.categorized;
  const shown = features.filter((feature) => {
    if (feature.properties?.["__hidden"]) return false;
    if (!category?.enabled) return true;
    const value = String(feature.properties?.[category.field] ?? "");
    return category.rules.find((rule) => rule.value === value)?.visible ?? category.fallbackVisible;
  });
  if (!shown.length) return null;
  return category?.enabled
    ? {
        [category.field]: [
          ...new Set(shown.map((feature) => String(feature.properties?.[category.field] ?? ""))),
        ].sort(),
      }
    : {};
}
