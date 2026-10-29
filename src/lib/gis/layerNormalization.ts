import { pointSymbolOpacity } from "./iconOpacity.ts";
import type { Feature, FeatureCollection } from "geojson";

import { defaultStyle, type LayerStyle } from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Older projects and interrupted mobile captures can contain partial GeoJSON.
 * Keep recoverable feature attributes, but represent an unusable geometry as
 * null so layer controls can open without taking down the entire workbench.
 */
export function normalizeLayerData(value: unknown): FeatureCollection {
  if (!isRecord(value)) return { type: "FeatureCollection", features: [] };
  const sourceFeatures = Array.isArray(value["features"]) ? value["features"] : [];
  const features = sourceFeatures.flatMap((candidate) => {
    if (!isRecord(candidate) || candidate["type"] !== "Feature") return [];
    const geometry = candidate["geometry"];
    const usableGeometry =
      isRecord(geometry) && typeof geometry["type"] === "string" ? geometry : null;
    const properties = isRecord(candidate["properties"]) ? candidate["properties"] : {};
    return [
      {
        ...candidate,
        type: "Feature" as const,
        geometry: usableGeometry,
        properties,
      } as unknown as Feature,
    ];
  });
  return { ...value, type: "FeatureCollection", features } as FeatureCollection;
}

export function normalizeLayerStyle(value: unknown, seed = 0): LayerStyle {
  const fallback = defaultStyle(seed);
  const candidate = isRecord(value) ? value : {};
  const merged = { ...fallback, ...candidate } as LayerStyle;
  return {
    ...merged,
    pointIconOpacity: pointSymbolOpacity(merged),
    fillColor: typeof merged.fillColor === "string" ? merged.fillColor : fallback.fillColor,
    strokeColor: typeof merged.strokeColor === "string" ? merged.strokeColor : fallback.strokeColor,
    labelTemplate:
      typeof merged.labelTemplate === "string" && merged.labelTemplate.trim()
        ? merged.labelTemplate
        : Array.isArray(merged.labelFields)
          ? merged.labelFields
              .filter(
                (field): field is string => typeof field === "string" && Boolean(field.trim()),
              )
              .map((field) => "{" + field + "}")
              .join(merged.labelSeparator || " · ")
          : fallback.labelTemplate,
    labelFields: Array.isArray(merged.labelFields)
      ? merged.labelFields.filter((field): field is string => typeof field === "string")
      : [],
    labelSeparator:
      typeof merged.labelSeparator === "string" && merged.labelSeparator.length > 0
        ? merged.labelSeparator
        : fallback.labelSeparator,
  };
}

export function featureGeometryType(feature: unknown): string | null {
  if (!isRecord(feature)) return null;
  const geometry = feature["geometry"];
  return isRecord(geometry) && typeof geometry["type"] === "string" ? geometry["type"] : null;
}
