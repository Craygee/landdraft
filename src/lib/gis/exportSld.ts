import { xml, type ResolvedExportStyle } from "./exportStyle.ts";
export function exportSld(
  name: string,
  geometry: "POLYGON" | "POLYLINE" | "POINT",
  rules: { id: string; style: ResolvedExportStyle; iconHref?: string | undefined }[],
  styleField: string,
  labelField: string,
): string {
  const css = (name: string, value: unknown) =>
    `<CssParameter name="${name}">${xml(value)}</CssParameter>`;
  const body = rules
    .map(({ id, style: s, iconHref }) => {
      const stroke = `<Stroke>${css("stroke", s.strokeColor)}${css("stroke-opacity", s.strokeOpacity)}${css("stroke-width", s.strokeWidth)}${s.strokePattern === "solid" ? "" : css("stroke-dasharray", s.strokePattern === "dashed" ? "6 4" : "1 3")}</Stroke>`;
      const hatch: Record<string, string> = {
        diagonal: "shape://slash",
        crosshatch: "shape://times",
        horizontal: "shape://horline",
        vertical: "shape://vertline",
        dotted: "circle",
      };
      const fill =
        s.fillPattern === "solid"
          ? `<Fill>${css("fill", s.fillColor)}${css("fill-opacity", s.fillOpacity)}</Fill>`
          : `<Fill><GraphicFill><Graphic><Mark><WellKnownName>${hatch[s.fillPattern] ?? "shape://slash"}</WellKnownName><Fill>${css("fill", s.fillColor)}${css("fill-opacity", s.fillOpacity)}</Fill><Stroke>${css("stroke", s.fillColor)}${css("stroke-opacity", s.fillOpacity)}${css("stroke-width", 1)}</Stroke></Mark><Size>8</Size></Graphic></GraphicFill></Fill>`;
      const symbol =
        geometry === "POLYGON"
          ? `<PolygonSymbolizer>${fill}${stroke}</PolygonSymbolizer>`
          : geometry === "POLYLINE"
            ? `<LineSymbolizer>${stroke}</LineSymbolizer>`
            : `<PointSymbolizer><Graphic>${iconHref ? `<ExternalGraphic><OnlineResource xlink:type="simple" xlink:href="${xml(iconHref)}"/><Format>image/png</Format></ExternalGraphic><Opacity>${s.iconOpacity}</Opacity>` : `<Mark><WellKnownName>circle</WellKnownName><Fill>${css("fill", s.iconColor)}${css("fill-opacity", s.iconOpacity)}</Fill>${stroke}</Mark>`}<Size>${s.icon ? s.iconSize : s.pointSize * 2}</Size></Graphic></PointSymbolizer>`;
      const label = s.labelEnabled
        ? `<TextSymbolizer><Label><ogc:PropertyName>${xml(labelField)}</ogc:PropertyName></Label><Font>${css("font-family", "sans-serif")}${css("font-size", s.labelSize)}</Font><Fill>${css("fill", s.labelColor)}${css("fill-opacity", s.labelOpacity)}</Fill></TextSymbolizer>`
        : "";
      return `<Rule><Name>${xml(id)}</Name><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>${xml(styleField)}</ogc:PropertyName><ogc:Literal>${xml(id)}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>${symbol}${label}</Rule>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink"><NamedLayer><Name>${xml(name)}</Name><UserStyle><Title>${xml(name)}</Title><FeatureTypeStyle>${body}</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
}
