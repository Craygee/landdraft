import { layerOpacity } from "./layerOpacity.ts";
import { pointSymbolOpacity } from "./iconOpacity.ts";
import type { Map as MlMap, LayerSpecification } from "maplibre-gl";
import type { GisLayer, FillPattern } from "./types";
import { isParcelLayer, parcelLabelSourceId, parcelLabelSizeExpression } from "./parcelDisplay.ts";

export const sourceId = (layerId: string) => `src-${layerId}`;
export const fillId = (layerId: string) => `fill-${layerId}`;
export const lineId = (layerId: string) => `line-${layerId}`;
export const lineHitId = (layerId: string) => `line-hit-${layerId}`;
export const pointId = (layerId: string) => `point-${layerId}`;
export const markerIconId = (layerId: string) => `marker-${layerId}`;
export const imageId = (layerId: string) => `image-${layerId}`;
export const extrusionId = (layerId: string) => `extrusion-${layerId}`;
export const labelId = (layerId: string) => `label-${layerId}`;
export const highlightId = (layerId: string) => `hl-${layerId}`;
export const highlightPointId = (layerId: string) => `hl-point-${layerId}`;

export const patternImageId = (pattern: FillPattern, color: string) =>
  `pat-${pattern}-${color.replace("#", "")}`;

type LabelGeometry = "point" | "line" | "polygon" | "mixed";

export const primaryLabelGeometry = (layer: GisLayer): LabelGeometry => {
  const counts: Record<Exclude<LabelGeometry, "mixed">, number> = {
    point: 0,
    line: 0,
    polygon: 0,
  };
  for (const feature of layer.data.features) {
    if (!feature.geometry) continue;
    if (/Point$/i.test(feature.geometry.type)) counts.point += 1;
    else if (/LineString$/i.test(feature.geometry.type)) counts.line += 1;
    else if (/Polygon$/i.test(feature.geometry.type)) counts.polygon += 1;
  }
  const populated = (Object.entries(counts) as Array<[Exclude<LabelGeometry, "mixed">, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (populated.length !== 1) return "mixed";
  return populated[0]?.[0] ?? "mixed";
};

/** Draws hatch/dot fill patterns into a canvas and registers them with MapLibre. */
export function ensurePatternImage(map: MlMap, pattern: FillPattern, color: string): string | null {
  const id = patternImageId(pattern, color);
  if (map.hasImage(id)) return id;
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  if (pattern === "solid") ctx.fillRect(0, 0, size, size);

  if (pattern === "diagonal" || pattern === "crosshatch") {
    ctx.beginPath();
    ctx.moveTo(-4, size + 4);
    ctx.lineTo(size + 4, -4);
    ctx.moveTo(-4, size / 2 + 4);
    ctx.lineTo(size / 2 + 4, -4);
    ctx.moveTo(size / 2 - 4, size + 4);
    ctx.lineTo(size + 4, size / 2 - 4);
    ctx.stroke();
  }
  if (pattern === "horizontal" || pattern === "vertical") {
    ctx.beginPath();
    for (let offset = 4; offset < size; offset += 8) {
      if (pattern === "horizontal") {
        ctx.moveTo(0, offset);
        ctx.lineTo(size, offset);
      } else {
        ctx.moveTo(offset, 0);
        ctx.lineTo(offset, size);
      }
    }
    ctx.stroke();
  }
  if (pattern === "crosshatch") {
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(size + 4, size + 4);
    ctx.moveTo(size / 2 - 4, -4);
    ctx.lineTo(size + 4, size / 2 + 4);
    ctx.moveTo(-4, size / 2 - 4);
    ctx.lineTo(size / 2 + 4, size + 4);
    ctx.stroke();
  }
  if (pattern === "dotted") {
    for (const [x, y] of [
      [4, 4],
      [12, 12],
      [12, 4],
      [4, 12],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const data = ctx.getImageData(0, 0, size, size);
  map.addImage(id, { width: size, height: size, data: new Uint8Array(data.data) });
  return id;
}

export function buildLayerSpecs(layer: GisLayer, map: MlMap): LayerSpecification[] {
  const src = sourceId(layer.id);
  const s = layer.style;
  if (layer.source.kind === "image")
    return [
      {
        id: imageId(layer.id),
        type: "raster",
        source: src,
        paint: { "raster-opacity": Math.max(0, Math.min(1, s.fillOpacity)) * layerOpacity(s) },
      },
    ];
  const labelMinZoom = Math.max(0, Math.min(23, s.labelMinZoom ?? 4));
  const labelMaxZoom = Math.max(labelMinZoom + 0.5, Math.min(24, s.labelMaxZoom ?? 24));
  const categorized = s.categorized?.enabled && s.categorized.field ? s.categorized : undefined;
  const categorizedIcons =
    s.categorizedIcons?.enabled && s.categorizedIcons.field ? s.categorizedIcons : undefined;
  const patternId =
    categorized || s.fillPattern === "solid"
      ? null
      : ensurePatternImage(map, s.fillPattern, s.fillColor);
  const zoomRange =
    layer.source.kind === "remote" && layer.source.minZoom !== undefined
      ? { minzoom: layer.source.minZoom }
      : {};
  const lineDash =
    s.strokePattern === "dashed" ? [3, 2] : s.strokePattern === "dotted" ? [0.2, 1.6] : undefined;

  const categoryValue = categorized
    ? ["to-string", ["coalesce", ["get", categorized.field], ""]]
    : undefined;
  const categoryMatch = (fallback: string) =>
    categorized && categoryValue
      ? [
          "match",
          categoryValue,
          ...categorized.rules.flatMap((rule) => [rule.value, rule.color]),
          fallback,
        ]
      : fallback;
  const categoryOpacity = (value: number) => {
    const opacity = value * layerOpacity(s);
    return categorized && categoryValue
      ? [
          "match",
          categoryValue,
          ...categorized.rules.flatMap((rule) => [rule.value, rule.visible ? opacity : 0]),
          categorized.fallbackVisible ? opacity : 0,
        ]
      : opacity;
  };
  const iconValue = categorizedIcons
    ? ["to-string", ["coalesce", ["get", categorizedIcons.field], ""]]
    : undefined;
  const categoryIcon =
    categorizedIcons && iconValue
      ? [
          "match",
          iconValue,
          ...categorizedIcons.rules.flatMap((rule) => [rule.value, rule.icon]),
          categorizedIcons.fallbackIcon,
        ]
      : (s.pointIcon ?? "");
  // An explicitly selected layer icon (or icon-by-attribute rule) is the active
  // symbology and must take precedence over legacy/default MARKER_ICON values
  // stored on individual features. Feature-level icons remain available when
  // the layer is set to "Circle only".
  const usesLayerIcon = Boolean(categorizedIcons || s.pointIcon);
  const markerText = usesLayerIcon
    ? typeof categoryIcon === "string"
      ? ["literal", categoryIcon]
      : categoryIcon
    : ["coalesce", ["get", "MARKER_ICON"], ""];
  const shownFilter = ["!", ["boolean", ["get", "__hidden"], false]];
  const geometryFilter = (filter: unknown[]) => ["all", filter, shownFilter];
  const fillPaint: Record<string, unknown> = patternId
    ? { "fill-pattern": patternId, "fill-opacity": s.fillOpacity * layerOpacity(s) }
    : {
        "fill-color": categoryMatch(categorized?.fallbackColor ?? s.fillColor),
        "fill-opacity": categoryOpacity(s.fillOpacity),
      };

  const dashFor = (pattern: string) =>
    pattern === "dashed" ? [3, 2] : pattern === "dotted" ? [0.2, 1.6] : [1, 0];
  const attributeDash =
    categorizedIcons && iconValue && categorizedIcons.rules.some((r) => r.strokePattern)
      ? [
          "match",
          iconValue,
          ...categorizedIcons.rules.flatMap((r) => [
            r.value,
            ["literal", dashFor(r.strokePattern ?? s.strokePattern)],
          ]),
          ["literal", dashFor(s.strokePattern)],
        ]
      : undefined;
  if (categorized || categorizedIcons?.rules.some((r) => r.fillPattern)) {
    const colorRules = categorized?.rules ?? [];
    const patternRules = categorizedIcons?.rules ?? [];
    const imageFor = (pattern: typeof s.fillPattern, color: string) =>
      ensurePatternImage(map, pattern, color);
    const baseImage = imageFor(s.fillPattern, categorized?.fallbackColor ?? s.fillColor);
    const colorExpression = (pattern: typeof s.fillPattern) =>
      categorized && categoryValue
        ? [
            "match",
            categoryValue,
            ...colorRules.flatMap((r) => [r.value, imageFor(pattern, r.color)]),
            imageFor(pattern, categorized.fallbackColor),
          ]
        : imageFor(pattern, s.fillColor);
    fillPaint["fill-pattern"] =
      categorizedIcons && iconValue && patternRules.some((r) => r.fillPattern)
        ? [
            "match",
            iconValue,
            ...patternRules.flatMap((r) => [
              r.value,
              colorExpression(r.fillPattern ?? s.fillPattern),
            ]),
            colorExpression(s.fillPattern),
          ]
        : categorized && categoryValue
          ? colorExpression(s.fillPattern)
          : baseImage;
  }
  const specs: LayerSpecification[] = [
    {
      id: fillId(layer.id),
      type: "fill",
      source: src,
      filter: geometryFilter(["==", ["geometry-type"], "Polygon"]) as never,
      paint: fillPaint as never,
      ...zoomRange,
    },
    {
      id: extrusionId(layer.id),
      type: "fill-extrusion",
      source: src,
      filter: geometryFilter([
        "all",
        ["==", ["geometry-type"], "Polygon"],
        [">", ["to-number", ["coalesce", ["get", "HEIGHT_FT"], 0]], 0],
      ]) as never,
      paint: {
        "fill-extrusion-color": categoryMatch(categorized?.fallbackColor ?? s.fillColor) as never,
        "fill-extrusion-height": [
          "*",
          ["to-number", ["coalesce", ["get", "HEIGHT_FT"], 0]],
          0.3048,
        ] as never,
        "fill-extrusion-base": [
          "*",
          ["to-number", ["coalesce", ["get", "BASE_HEIGHT_FT"], 0]],
          0.3048,
        ] as never,
        "fill-extrusion-opacity": Math.max(0, Math.min(1, s.fillOpacity)) * layerOpacity(s),
      },
      ...zoomRange,
    },
    {
      id: lineId(layer.id),
      type: "line",
      source: src,
      filter: geometryFilter([
        "match",
        ["geometry-type"],
        ["LineString", "Polygon"],
        true,
        false,
      ]) as never,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": categoryMatch(categorized?.fallbackColor ?? s.strokeColor) as never,
        "line-width": s.strokeWidth,
        "line-opacity": categoryOpacity(s.strokeOpacity) as never,
        ...(attributeDash || lineDash
          ? { "line-dasharray": (attributeDash ?? lineDash) as never }
          : {}),
      },
      ...zoomRange,
    },
    {
      id: lineHitId(layer.id),
      type: "line",
      source: src,
      filter: geometryFilter(["==", ["geometry-type"], "LineString"]) as never,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#000000",
        "line-width": Math.max(12, s.strokeWidth + 8),
        "line-opacity": 0.01,
      },
      ...zoomRange,
    },
    {
      id: pointId(layer.id),
      type: "circle",
      source: src,
      // The circle is the fallback point symbol. When a layer-level,
      // attribute-driven, or feature-level icon is active, drawing this layer
      // as well leaves the old circle visibly stacked behind the icon.
      filter: geometryFilter([
        "all",
        ["==", ["geometry-type"], "Point"],
        ["==", markerText, ""],
      ]) as never,
      paint: {
        "circle-radius": s.pointSize,
        "circle-color": categoryMatch(categorized?.fallbackColor ?? s.fillColor) as never,
        "circle-opacity": categoryOpacity(
          Math.max(0, Math.min(1, s.fillOpacity)) * pointSymbolOpacity(s),
        ) as never,
        "circle-stroke-color": categoryMatch(categorized?.fallbackColor ?? s.strokeColor) as never,
        "circle-stroke-width": Math.min(3, s.strokeWidth),
        "circle-stroke-opacity": categoryOpacity(pointSymbolOpacity(s)) as never,
      },
      ...zoomRange,
    },
    {
      id: markerIconId(layer.id),
      type: "symbol",
      source: src,
      filter: geometryFilter([
        "all",
        ["==", ["geometry-type"], "Point"],
        ["!=", markerText, ""],
      ]) as never,
      layout: {
        "text-field": markerText as never,
        "text-size": usesLayerIcon
          ? (s.pointIconSize ?? 18)
          : [
              "to-number",
              ["coalesce", ["get", "MARKER_SIZE"], s.pointIconSize ?? 18],
              s.pointIconSize ?? 18,
            ],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": (usesLayerIcon
          ? (s.pointIconColor ?? categoryMatch(categorized?.fallbackColor ?? s.fillColor))
          : [
              "coalesce",
              ["get", "MARKER_COLOR"],
              s.pointIconColor ?? categoryMatch(categorized?.fallbackColor ?? s.fillColor),
            ]) as never,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.6,
        "text-opacity": categoryOpacity(pointSymbolOpacity(s)) as never,
      },
      ...zoomRange,
    },
    {
      id: highlightId(layer.id),
      type: "line",
      source: src,
      filter: geometryFilter([
        "match",
        ["geometry-type"],
        ["LineString", "Polygon"],
        true,
        false,
      ]) as never,
      paint: {
        "line-color": "#f2b73d",
        "line-width": s.strokeWidth + 3,
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.95, 0],
      },
      ...zoomRange,
    },
    {
      id: highlightPointId(layer.id),
      type: "circle",
      source: src,
      filter: geometryFilter(["==", ["geometry-type"], "Point"]) as never,
      paint: {
        "circle-radius": s.pointSize + 5,
        "circle-color": "#f2b73d",
        "circle-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.3, 0],
        "circle-stroke-color": "#f2b73d",
        "circle-stroke-width": 3,
        "circle-stroke-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0],
      },
      ...zoomRange,
    },
  ];

  if (s.labelEnabled && (s.labelUseLayerName || s.labelTemplate.trim().length > 0)) {
    const geometry = primaryLabelGeometry(layer);
    const requestedPlacement = s.labelPlacement ?? "auto";
    const placement =
      requestedPlacement === "auto"
        ? geometry === "line"
          ? "follow-line"
          : "center"
        : requestedPlacement;
    const followsLine =
      geometry === "line" &&
      (placement === "follow-line" || placement === "above" || placement === "below");
    const isHorizontalLine = geometry === "line" && placement === "horizontal";
    const textAnchor =
      placement === "above"
        ? "bottom"
        : placement === "below"
          ? "top"
          : placement === "left"
            ? "right"
            : placement === "right"
              ? "left"
              : "center";
    const textOffset =
      placement === "above"
        ? [0, -0.55]
        : placement === "below"
          ? [0, 0.55]
          : placement === "left"
            ? [-0.65, 0]
            : placement === "right"
              ? [0.65, 0]
              : geometry === "point" && requestedPlacement === "auto"
                ? ([
                    "case",
                    ["!=", markerText, ""],
                    ["literal", [0, 1.65]],
                    ["literal", [0, 0]],
                  ] as never)
                : [0, 0];
    const labelSize = s.labelSize ?? 14;
    const textSize =
      isParcelLayer(layer) && s.labelScaleWithZoom
        ? parcelLabelSizeExpression(labelSize)
        : s.labelScaleWithZoom
          ? [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              Math.max(8, labelSize - 4),
              16,
              labelSize,
              24,
              Math.min(44, labelSize + 4),
            ]
          : labelSize;
    const labelSpec: LayerSpecification = {
      id: labelId(layer.id),
      type: "symbol",
      source: src,
      filter: shownFilter as never,
      layout: {
        "text-field": s.labelUseLayerName
          ? ["literal", layer.name]
          : ["coalesce", ["get", "__label"], ""],
        // The raster basemap glyph host serves individual font stacks only.
        // The former combined stack returns HTML (HTTP 200), not glyph data.
        "text-font": [s.labelFont || "Open Sans Regular"],
        "text-size": textSize as never,
        "text-anchor": textAnchor,
        "text-offset": textOffset as never,
        "text-allow-overlap": s.labelAllowOverlap ?? false,
        "text-ignore-placement": s.labelAllowOverlap ?? false,
        "text-max-width": s.labelMaxWidth ?? 12,
        "text-line-height": s.labelLineSpacing ?? 1.2,
        "text-padding": 2,
        "text-keep-upright": true,
        "text-rotation-alignment": followsLine ? "map" : "viewport",
        "symbol-placement": followsLine ? "line" : isHorizontalLine ? "line-center" : "point",
      } as never,
      minzoom: Math.max(labelMinZoom, zoomRange.minzoom ?? 0),
      maxzoom: labelMaxZoom,
      paint: {
        "text-color": s.labelColor ?? "#1d2a20",
        "text-opacity": (s.labelOpacity ?? 1) * layerOpacity(s),
        "text-halo-color": s.labelHaloColor ?? "#fdfbf3",
        "text-halo-width": s.labelHaloWidth ?? 1.6,
      },
    };
    if (isParcelLayer(layer)) {
      specs.push({
        ...labelSpec,
        source: parcelLabelSourceId(layer.id),
        filter: ["all", shownFilter, ["<=", ["get", "__parcelLabelMinZoom"], ["zoom"]]] as never,
        layout: {
          ...labelSpec.layout,
          "text-field": ["get", "__label"],
          "symbol-placement": "point",
          "text-anchor": "center",
          "text-offset": [0, 0],
          "text-max-width": 1000,
          "text-pitch-alignment": "map",
          "symbol-sort-key": ["get", "__parcelLabelPriority"],
        },
      });
    } else if (geometry === "mixed" && requestedPlacement === "auto") {
      specs.push({
        ...labelSpec,
        filter: ["all", shownFilter, ["!=", ["geometry-type"], "LineString"]] as never,
      });
      specs.push({
        ...labelSpec,
        id: labelId(layer.id) + "-lines",
        filter: ["all", shownFilter, ["==", ["geometry-type"], "LineString"]] as never,
        layout: {
          ...labelSpec.layout,
          "symbol-placement": "line",
          "text-rotation-alignment": "map",
        },
      });
    } else specs.push(labelSpec);
  }
  return specs;
}

export const allLayerIds = (layerId: string) => [
  labelId(layerId) + "-lines",
  labelId(layerId),
  highlightPointId(layerId),
  highlightId(layerId),
  markerIconId(layerId),
  pointId(layerId),
  extrusionId(layerId),
  lineHitId(layerId),
  lineId(layerId),
  imageId(layerId),
  fillId(layerId),
];
