import { useMemo, type ReactNode } from "react";
import type { Geometry, Position } from "geojson";
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

export function StudyAreaMapFigure({
  title,
  boundary,
  layers,
}: {
  title: string;
  boundary: StudyReportBoundary;
  layers: GisLayer[];
}) {
  const project = useMemo(() => projector(boundary.bounds), [boundary.bounds]);
  const visible = layers.slice(0, 12);
  const geometry = visible.flatMap((layer) =>
    layer.data.features
      .slice(0, 800)
      .flatMap((feature, featureIndex) =>
        feature.geometry
          ? geometryElements(feature.geometry, project, layer.style, `${layer.id}-${featureIndex}`)
          : [],
      ),
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
          <clipPath id="study-map-clip">
            <rect x={PAD} y={PAD} width={WIDTH - PAD * 2} height={HEIGHT - PAD * 2} rx="4" />
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
        <g clipPath="url(#study-map-clip)">
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
        Showing up to 12 vector layers and 800 features per layer for report legibility. This
        schematic figure does not replace source-specific maps or field verification.
      </figcaption>
      {visible.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-3 text-[10px] text-[#526157]">
          {visible.slice(0, 6).map((layer) => (
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
