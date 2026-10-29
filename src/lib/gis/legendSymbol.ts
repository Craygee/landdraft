import { layerOpacity } from "./layerOpacity.ts";
import { pointSymbolOpacity } from "./iconOpacity.ts";
import type { Geometry } from "geojson";
import { catalog } from "./catalog.ts";
import type { FillPattern, GisLayer, StrokePattern } from "./types";

export type LegendSymbolKind = "point" | "line" | "pipeline" | "polygon" | "image";

export interface LegendSymbol {
  kind: LegendSymbolKind;
  fillColor: string;
  fillOpacity: number;
  fillPattern: FillPattern;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  strokePattern: StrokePattern;
  markerIcon: string;
  markerColor: string;
  markerSize: number;
  markerOpacity: number;
}

const geometryFamily = (geometry: Geometry | null): "point" | "line" | "polygon" | null => {
  if (!geometry) return null;
  if (geometry.type === "Point" || geometry.type === "MultiPoint") return "point";
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") return "line";
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return "polygon";
  if (geometry.type === "GeometryCollection") {
    const families = geometry.geometries.map(geometryFamily).filter(Boolean);
    return families.includes("polygon")
      ? "polygon"
      : families.includes("line")
        ? "line"
        : families.includes("point")
          ? "point"
          : null;
  }
  return null;
};

const isPipelineLayer = (layer: GisLayer) => {
  const catalogId = "catalogId" in layer.source ? (layer.source.catalogId ?? "") : "";
  return /pipeline/i.test(`${layer.name} ${layer.groupId} ${catalogId}`);
};

const representativeMarker = (layer: GisLayer) => {
  const categorized = layer.style.categorizedIcons;
  if (categorized?.enabled) {
    const visibleRule = categorized.rules.find((rule) => Boolean(rule.icon));
    if (visibleRule?.icon) return visibleRule.icon;
    if (categorized.fallbackIcon) return categorized.fallbackIcon;
  }
  if (layer.style.pointIcon) return layer.style.pointIcon;
  const featureIcon = layer.data.features.find((feature) => feature.properties?.["MARKER_ICON"])
    ?.properties?.["MARKER_ICON"];
  return typeof featureIcon === "string" ? featureIcon : "";
};

export function legendSymbolForLayer(layer: GisLayer): LegendSymbol {
  const counts = { point: 0, line: 0, polygon: 0 };
  for (const feature of layer.data.features) {
    const family = geometryFamily(feature.geometry);
    if (family) counts[family] += 1;
  }
  const catalogId = "catalogId" in layer.source ? layer.source.catalogId : undefined;
  const catalogKind = catalogId
    ? catalog.find((entry) => entry.id === catalogId)?.geometry
    : undefined;
  let kind: LegendSymbolKind =
    layer.source.kind === "image"
      ? "image"
      : catalogKind
        ? catalogKind
        : counts.polygon >= counts.line && counts.polygon >= counts.point && counts.polygon > 0
          ? "polygon"
          : counts.line >= counts.point && counts.line > 0
            ? "line"
            : "point";
  if (isPipelineLayer(layer) && (kind === "line" || layer.data.features.length === 0))
    kind = "pipeline";

  return {
    kind,
    fillColor: layer.style.fillColor,
    fillOpacity: layer.style.fillOpacity * layerOpacity(layer.style),
    fillPattern: layer.style.fillPattern,
    strokeColor: layer.style.strokeColor,
    strokeOpacity: layer.style.strokeOpacity * layerOpacity(layer.style),
    strokeWidth: layer.style.strokeWidth,
    strokePattern: layer.style.strokePattern,
    markerIcon: representativeMarker(layer),
    markerColor: layer.style.pointIconColor ?? layer.style.fillColor ?? layer.style.strokeColor,
    markerSize: layer.style.pointIconSize || layer.style.pointSize,
    markerOpacity: pointSymbolOpacity(layer.style) * layerOpacity(layer.style),
  };
}

export function legendDashArray(pattern: StrokePattern, scale = 1): number[] {
  if (pattern === "dashed") return [7 * scale, 4 * scale];
  if (pattern === "dotted") return [1.5 * scale, 3 * scale];
  return [];
}
