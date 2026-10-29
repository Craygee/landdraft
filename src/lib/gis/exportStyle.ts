import type { Feature, FeatureCollection } from "geojson";
import type { LayerStyle } from "./types";
import { layerOpacity } from "./layerOpacity.ts";
import { pointSymbolOpacity } from "./iconOpacity.ts";
import { composeLabel, buildLabelTemplate } from "./labels.ts";

export const xml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export type StyledExportLayer = {
  id: string;
  name: string;
  data: FeatureCollection;
  style?: LayerStyle;
  exportIcons?: Record<string, string>;
};
export function resolveExportStyle(style: LayerStyle, properties: Feature["properties"]) {
  const category = style.categorized?.enabled ? style.categorized : undefined;
  const rule = category?.rules.find(
    (item) => item.value === String(properties?.[category.field] ?? ""),
  );
  const visible =
    !properties?.["__hidden"] && (!category || (rule?.visible ?? category.fallbackVisible));
  const iconCategory = style.categorizedIcons?.enabled ? style.categorizedIcons : undefined;
  const iconRule = iconCategory?.rules.find(
    (item) => item.value === String(properties?.[iconCategory.field] ?? ""),
  );
  const color = rule?.color ?? category?.fallbackColor;
  const opacity = visible ? layerOpacity(style) : 0;
  const usesLayerIcon = Boolean(iconCategory || style.pointIcon);
  const markerSize =
    !usesLayerIcon &&
    typeof properties?.["MARKER_SIZE"] === "number" &&
    Number.isFinite(properties["MARKER_SIZE"])
      ? properties["MARKER_SIZE"]
      : (style.pointIconSize ?? 18);
  const icon = iconCategory
    ? (iconRule?.icon ?? iconCategory.fallbackIcon)
    : style.pointIcon || String(properties?.["MARKER_ICON"] ?? "");
  return {
    fillColor: color ?? style.fillColor,
    strokeColor: color ?? style.strokeColor,
    fillOpacity: opacity * style.fillOpacity,
    strokeOpacity: opacity * style.strokeOpacity,
    strokeWidth: style.strokeWidth,
    strokePattern: iconRule?.strokePattern ?? style.strokePattern,
    fillPattern: iconRule?.fillPattern ?? style.fillPattern,
    icon,
    iconColor:
      !usesLayerIcon && typeof properties?.["MARKER_COLOR"] === "string"
        ? properties["MARKER_COLOR"]
        : (style.pointIconColor ?? color ?? style.fillColor),
    iconOpacity: opacity * pointSymbolOpacity(style),
    iconSize: markerSize,
    pointSize: style.pointSize,
    labelColor: style.labelColor,
    labelOpacity: opacity * style.labelOpacity,
    labelSize: style.labelSize,
    labelEnabled: style.labelEnabled,
    visible,
  };
}
export type ResolvedExportStyle = ReturnType<typeof resolveExportStyle>;
export const iconKey = (style: ResolvedExportStyle) =>
  JSON.stringify([style.icon, style.iconColor]);
export function exportFeatureLabel(feature: Feature, layer: StyledExportLayer): string {
  if (!layer.style)
    return String(feature.properties?.["name"] ?? feature.properties?.["NAME"] ?? layer.name);
  const s = layer.style;
  const label = s.labelUseLayerName
    ? layer.name
    : composeLabel(
        { ...feature, properties: feature.properties ?? {} },
        s.labelTemplate || buildLabelTemplate(s.labelFields ?? [], s.labelSeparator),
      );
  return (
    label || String(feature.properties?.["name"] ?? feature.properties?.["NAME"] ?? layer.name)
  );
}
export function kmlColor(color: string, opacity: number): string {
  let rgb = color.replace(/^#/, "");
  if (rgb.length === 3)
    rgb = rgb
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[a-f0-9]{6}$/i.test(rgb)) rgb = "808080";
  return (
    Math.round(Math.max(0, Math.min(1, opacity)) * 255)
      .toString(16)
      .padStart(2, "0") +
    rgb.slice(4, 6) +
    rgb.slice(2, 4) +
    rgb.slice(0, 2)
  );
}
export function kmlFeatureStyle(style: ResolvedExportStyle, iconHref?: string): string {
  return `<Style><IconStyle><color>${kmlColor(iconHref ? "#ffffff" : style.iconColor, style.iconOpacity)}</color><scale>${style.iconSize / 32}</scale><Icon><href>${xml(iconHref ?? "https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png")}</href></Icon></IconStyle><LabelStyle><color>${kmlColor(style.labelColor, style.labelEnabled ? style.labelOpacity : 0)}</color><scale>${style.labelSize / 14}</scale></LabelStyle><LineStyle><color>${kmlColor(style.strokeColor, style.strokeOpacity)}</color><width>${style.strokeWidth}</width></LineStyle><PolyStyle><color>${kmlColor(style.fillColor, style.fillOpacity)}</color><fill>${style.fillOpacity > 0 ? 1 : 0}</fill><outline>${style.strokeOpacity > 0 ? 1 : 0}</outline></PolyStyle></Style>`;
}

export const STYLE_EXPORT_NOTES =
  "KMZ preserves per-feature/category colors, fill/line/icon opacity, line widths, label text/color/size, and bundled marker images. KML does not standardize hatch fills, dashed lines, font families, label halos, collision rules or zoom-scaled text; Google Earth uses solid equivalents and its own label placement. SHP has no embedded styling: load the matching .sld through Layer Properties > Symbology > Style > Load Style in QGIS or another SLD-compatible application. SLD includes attribute colors, alpha, dash and hatch patterns and marker images; importer support varies. styles.json retains full LandDraft settings. Multipart export splits a layer into style-compatible items when necessary, preserving its colors. Exports include currently loaded features only.";
