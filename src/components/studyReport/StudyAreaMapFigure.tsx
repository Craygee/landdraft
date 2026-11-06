import { booleanIntersects } from "@turf/turf";
import { useId, useMemo, type ReactNode } from "react";
import type { Feature, Geometry, Position } from "geojson";
import type { GisLayer } from "@/lib/gis/types";
import { figureFrame, rasterImageUrl, scaleBar } from "@/lib/studyReport/figure";
import { studyProfileForLayer } from "@/lib/studyReport/sourceProfiles";
import type { StudyReportBoundary, StudyReportFigureSnapshot } from "@/lib/studyReport/types";

const WIDTH = 760;
const HEIGHT = 420;
const PAD = 26;
const FEATURE_BUDGET = 650;

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

export function StudyAreaMapFigure({
  title,
  boundary,
  layers,
  snapshot,
}: {
  title: string;
  boundary: StudyReportBoundary;
  layers: GisLayer[];
  /** Features saved with the run. Older reports fall back to whatever the layer has loaded. */
  snapshot?: StudyReportFigureSnapshot | undefined;
}) {
  const clipId = `study-boundary-${useId().replace(/:/g, "")}`;
  const frame = useMemo(
    () =>
      figureFrame(boundary.bounds, {
        x: PAD,
        y: PAD,
        width: WIDTH - PAD * 2,
        height: HEIGHT - PAD * 2,
      }),
    [boundary.bounds],
  );
  const { project } = frame;
  const visible = layers.slice(0, 8);
  const rasterImages = visible.flatMap((layer) => {
    if (layer.source.kind !== "raster") return [];
    const url = rasterImageUrl(layer.source.tiles[0], boundary.bounds, frame.width, frame.height);
    return url ? [{ layer, url }] : [];
  });
  const vectorLayers = visible.filter((layer) => layer.source.kind !== "raster");
  // Every layer gets a share, so a dense polygon source cannot crowd points and lines off the map.
  const perLayer = Math.floor(FEATURE_BUDGET / Math.max(1, vectorLayers.length));
  let omitted = 0;
  const intersecting = vectorLayers
    .flatMap((layer) => {
      const saved = snapshot?.features[layer.id];
      const features = saved ?? layer.data.features.filter((f) => intersectsStudyArea(f, boundary));
      omitted += Math.max(0, features.length - perLayer);
      if (saved && saved.length >= 150) omitted += 1;
      return features.slice(0, perLayer).map((feature, index) => ({ layer, feature, index }));
    })
    .sort((a, b) =>
      a.feature.geometry && b.feature.geometry
        ? geometryOrder(a.feature.geometry) - geometryOrder(b.feature.geometry)
        : 0,
    );
  const geometry = intersecting.flatMap(({ layer, feature, index }) =>
    feature.geometry
      ? geometryElements(
          feature.geometry,
          project,
          // An aquifer or census tract covering the site is not a constraint, so it is outlined.
          studyProfileForLayer(layer)?.context ? { ...layer.style, fillOpacity: 0 } : layer.style,
          `${layer.id}-${index}`,
        )
      : [],
  );
  const boundaryPaths = boundary.data.features.map((feature) =>
    feature.geometry.type === "Polygon"
      ? polygonPath(feature.geometry.coordinates, project)
      : feature.geometry.coordinates.map((polygon) => polygonPath(polygon, project)).join(" "),
  );
  const scale = scaleBar(frame.metersPerUnit, 180);
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
              <path key={`clip-${index}`} d={path} fillRule="evenodd" clipRule="evenodd" />
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
              stroke="none"
            />
          ))}
          {rasterImages.map(({ layer, url }) => (
            <image
              key={`raster-${layer.id}`}
              href={url}
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              preserveAspectRatio="none"
              opacity={Math.min(0.9, Math.max(0.15, layer.style.opacity ?? 0.8))}
            />
          ))}
          {geometry}
        </g>
        {boundaryPaths.map((path, index) => (
          <path
            key={`boundary-outline-${index}`}
            d={path}
            fill="none"
            stroke="#0c5a31"
            strokeWidth="2.5"
          />
        ))}
        <g transform={`translate(${WIDTH - 48} 42)`}>
          <path d="M 0 20 L 10 0 L 20 20" fill="#163b26" />
          <text x="10" y="35" textAnchor="middle" fontSize="14" fontWeight="700" fill="#163b26">
            N
          </text>
        </g>
        <g transform={`translate(${PAD + 8} ${HEIGHT - PAD - 18})`}>
          <rect
            x="-5"
            y="-20"
            width={scale.width + 10}
            height="33"
            fill="#fff"
            fillOpacity="0.82"
          />
          <rect width={scale.width} height="8" fill="#fff" stroke="#24332a" />
          <rect width={scale.width / 2} height="8" fill="#24332a" />
          <text y="-6" fontSize="11" fill="#26382c">
            {scale.label}
          </text>
        </g>
      </svg>
      <figcaption className="border-t border-[#d9dfd6] px-3 py-2 text-[11px] leading-4 text-[#526157]">
        <strong className="text-[#1e3426]">{title}.</strong> Study boundary: {boundary.name}.
        Section-specific features inside the study area only, clipped to the boundary. Nearby
        features appear in the table, not on this map. Map images are context and are not measured.
        {omitted
          ? " Some features are omitted to keep this figure readable; the tables include them."
          : ""}{" "}
        This screening figure does not replace source-specific maps or field verification.
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
