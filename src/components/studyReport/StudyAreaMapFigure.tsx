import { booleanIntersects } from "@turf/turf";
import { useId, useMemo, type ReactNode } from "react";
import type { Feature, Geometry, Position } from "geojson";
import type { GisLayer } from "@/lib/gis/types";
import type { StudyReportBoundary } from "@/lib/studyReport/types";

const WIDTH = 760;
const HEIGHT = 420;
const PAD = 26;

function projector(bounds: [number, number, number, number]) {
  const [west, south, east, north] = bounds;
  const spanX = Math.max(1e-9, east - west);
  const spanY = Math.max(1e-9, north - south);
  return (position: Position): [number, number] => [
    PAD + ((Number(position[0]) - west) / spanX) * (WIDTH - PAD * 2),
    HEIGHT - PAD - ((Number(position[1]) - south) / spanY) * (HEIGHT - PAD * 2),
  ];
}

function linePath(coordinates: Position[], project: (position: Position) => [number, number]) {
  return coordinates
    .map((coordinate, index) => {
      const [x, y] = project(coordinate);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function polygonPath(coordinates: Position[][], project: (position: Position) => [number, number]) {
  return coordinates.map((ring) => `${linePath(ring, project)} Z`).join(" ");
}

function geometryElements(
  geometry: Geometry,
  project: (position: Position) => [number, number],
  style: GisLayer["style"],
  key: string,
): ReactNode[] {
  const stroke = style.strokeColor || "#245f3b";
  const fill = style.fillColor || stroke;
  const opacity = style.opacity ?? 1;
  const strokeOpacity = Math.max(0.18, style.strokeOpacity * opacity);
  const fillOpacity = Math.min(0.5, style.fillOpacity * opacity);
  if (geometry.type === "Point") {
    const [cx, cy] = project(geometry.coordinates);
    return [
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={Math.max(2.5, Math.min(7, style.pointSize / 2))}
        fill={style.pointIconColor || fill}
        fillOpacity={opacity}
        stroke="#fff"
        strokeWidth="1"
      />,
    ];
  }
  if (geometry.type === "MultiPoint")
    return geometry.coordinates.flatMap((coordinates, index) =>
      geometryElements({ type: "Point", coordinates }, project, style, `${key}-${index}`),
    );
  if (geometry.type === "LineString")
    return [
      <path
        key={key}
        d={linePath(geometry.coordinates, project)}
        fill="none"
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={Math.max(1.2, Math.min(4, style.strokeWidth))}
        strokeDasharray={
          style.strokePattern === "dashed"
            ? "8 5"
            : style.strokePattern === "dotted"
              ? "2 4"
              : undefined
        }
      />,
    ];
  if (geometry.type === "MultiLineString")
    return geometry.coordinates.map((coordinates, index) => (
      <path
        key={`${key}-${index}`}
        d={linePath(coordinates, project)}
        fill="none"
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={Math.max(1.2, Math.min(4, style.strokeWidth))}
      />
    ));
  if (geometry.type === "Polygon")
    return [
      <path
        key={key}
        d={polygonPath(geometry.coordinates, project)}
        fill={fill}
        fillOpacity={fillOpacity}
        fillRule="evenodd"
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={Math.max(1, Math.min(3, style.strokeWidth))}
      />,
    ];
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.map((coordinates, index) => (
      <path
        key={`${key}-${index}`}
        d={polygonPath(coordinates, project)}
        fill={fill}
        fillOpacity={fillOpacity}
        fillRule="evenodd"
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={Math.max(1, Math.min(3, style.strokeWidth))}
      />
    ));
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap((item, index) =>
      geometryElements(item, project, style, `${key}-${index}`),
    );
  return [];
}

function intersectsStudyArea(feature: Feature, boundary: StudyReportBoundary) {
  if (!feature.geometry) return false;
  try {
    return boundary.data.features.some((polygon) => booleanIntersects(feature, polygon));
  } catch {
    return false;
  }
}

function geometryOrder(geometry: Geometry) {
  if (geometry.type.includes("Polygon")) return 0;
  if (geometry.type.includes("LineString")) return 1;
  if (geometry.type.includes("Point")) return 2;
  return 3;
}

function toWebMercator([longitude, latitude]: [number, number]): [number, number] {
  const limitedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = (longitude * 20037508.342789244) / 180;
  const y =
    (Math.log(Math.tan(((90 + limitedLatitude) * Math.PI) / 360)) / (Math.PI / 180)) *
    (20037508.342789244 / 180);
  return [x, y];
}

function rasterImageUrl(layer: GisLayer, bounds: StudyReportBoundary["bounds"]) {
  if (layer.source.kind !== "raster") return null;
  const template = layer.source.tiles[0];
  if (!template?.includes("{bbox-epsg-3857}")) return null;
  const [west, south, east, north] = bounds;
  const [minX, minY] = toWebMercator([west, south]);
  const [maxX, maxY] = toWebMercator([east, north]);
  return template
    .replace("{bbox-epsg-3857}", `${minX},${minY},${maxX},${maxY}`)
    .replace(/([?&])width=256(?=&|$)/i, `$1width=${WIDTH}`)
    .replace(/([?&])height=256(?=&|$)/i, `$1height=${HEIGHT}`);
}

export function StudyAreaMapFigure({
  title,
  boundary,
  layers,
}: {
  title: string;
  boundary: StudyReportBoundary;
  layers: GisLayer[];
}) {
  const clipId = `study-boundary-${useId().replace(/:/g, "")}`;
  const project = useMemo(() => projector(boundary.bounds), [boundary.bounds]);
  const visible = layers.slice(0, 8);
  const rasterImages = visible.flatMap((layer) => {
    const url = rasterImageUrl(layer, boundary.bounds);
    return url ? [{ layer, url }] : [];
  });
  const intersecting = visible
    .flatMap((layer) =>
      layer.data.features
        .filter((feature) => intersectsStudyArea(feature, boundary))
        .map((feature, index) => ({ layer, feature, index })),
    )
    .sort((a, b) =>
      a.feature.geometry && b.feature.geometry
        ? geometryOrder(a.feature.geometry) - geometryOrder(b.feature.geometry)
        : 0,
    )
    .slice(0, 650);
  const geometry = intersecting.flatMap(({ layer, feature, index }) =>
    feature.geometry
      ? geometryElements(feature.geometry, project, layer.style, `${layer.id}-${index}`)
      : [],
  );
  const boundaryPaths = boundary.data.features.map((feature) =>
    feature.geometry.type === "Polygon"
      ? polygonPath(feature.geometry.coordinates, project)
      : feature.geometry.coordinates.map((polygon) => polygonPath(polygon, project)).join(" "),
  );
  return (
    <figure className="m-0 overflow-hidden rounded-xl border border-[#cfd7cc] bg-white">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${title} map for ${boundary.name}`}
        className="block aspect-[19/10.5] w-full bg-[#f4f1e8]"
      >
        <defs>
          <pattern id="study-grid" width="38" height="38" patternUnits="userSpaceOnUse">
            <path d="M 38 0 L 0 0 0 38" fill="none" stroke="#dfe4da" strokeWidth="1" />
          </pattern>
          <clipPath id={clipId}>
            {boundaryPaths.map((path, index) => (
              <path key={`clip-${index}`} d={path} fillRule="evenodd" />
            ))}
          </clipPath>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="#f8f6ef" />
        <rect
          x={PAD}
          y={PAD}
          width={WIDTH - PAD * 2}
          height={HEIGHT - PAD * 2}
          fill="url(#study-grid)"
        />
        <g clipPath={`url(#${clipId})`}>
          {boundaryPaths.map((path, index) => (
            <path
              key={`boundary-${index}`}
              d={path}
              fill="#d9ead8"
              fillOpacity="0.28"
              fillRule="evenodd"
              stroke="#176d3e"
              strokeWidth="3"
            />
          ))}
          {rasterImages.map(({ layer, url }) => (
            <image
              key={`raster-${layer.id}`}
              href={url}
              x={PAD}
              y={PAD}
              width={WIDTH - PAD * 2}
              height={HEIGHT - PAD * 2}
              preserveAspectRatio="none"
              opacity={Math.min(0.9, Math.max(0.15, layer.style.opacity ?? 0.8))}
            />
          ))}
          {geometry}
          {boundaryPaths.map((path, index) => (
            <path
              key={`boundary-outline-${index}`}
              d={path}
              fill="none"
              stroke="#0c5a31"
              strokeWidth="3"
            />
          ))}
        </g>
        <g transform={`translate(${WIDTH - 48} 42)`}>
          <path d="M 0 20 L 10 0 L 20 20" fill="#163b26" />
          <text x="10" y="35" textAnchor="middle" fontSize="14" fontWeight="700" fill="#163b26">
            N
          </text>
        </g>
        <g transform={`translate(${PAD + 8} ${HEIGHT - PAD - 18})`}>
          <rect width="92" height="8" fill="#fff" stroke="#24332a" />
          <rect width="46" height="8" fill="#24332a" />
        </g>
        <text x={PAD + 8} y={HEIGHT - PAD - 24} fontSize="11" fill="#26382c">
          Relative scale
        </text>
      </svg>
      <figcaption className="border-t border-[#d9dfd6] px-3 py-2 text-[11px] leading-4 text-[#526157]">
        <strong className="text-[#1e3426]">{title}.</strong> Study boundary: {boundary.name}.
        Showing only section-specific evidence intersecting the study area (up to 8 layers and 650
        vector features), clipped to the selected boundary. This screening figure does not replace
        source-specific maps or field verification.
      </figcaption>
      {visible.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-3 text-[10px] text-[#526157]">
          {visible.map((layer) => (
            <span key={layer.id} className="inline-flex items-center gap-1">
              <i
                className="inline-block size-2 rounded-full border"
                style={{
                  backgroundColor: layer.style.fillColor,
                  borderColor: layer.style.strokeColor,
                }}
              />
              {layer.name}
            </span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}
