import type { FeatureCollection, Position } from "geojson";
import type { ElevationProfile } from "./elevationProfile.ts";
import type { GisLayer, PrintComposition } from "./types";
import { snapshotFromLayer, SCREENING_NOTE } from "./buildableAreaModel.ts";
import type { BuildableSnapshot } from "./buildableAreaModel.ts";

export interface SavedElevationProfile {
  schemaVersion: 1;
  name: string;
  coordinates: Position[];
  profile: ElevationProfile;
}
export function elevationFromLayer(layer: GisLayer): SavedElevationProfile | null {
  if (layer.source.kind !== "derived") return null;
  const saved = layer.source.cacheProvenance?.["elevationProfile"] as
    SavedElevationProfile | undefined;
  return saved?.schemaVersion === 1 &&
    Array.isArray(saved.profile?.points) &&
    saved.coordinates?.length >= 2
    ? saved
    : null;
}
export const analysisKind = (layer: GisLayer) =>
  snapshotFromLayer(layer) ? "buildable" : elevationFromLayer(layer) ? "elevation" : null;
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
const number = (value: number | null) =>
  value === null ? "No data" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const lines = (text: string, length: number) => {
  const words = text.split(/\s+/),
    result: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).length > length && line) {
      result.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) result.push(line);
  return result;
};
const text = (value: string, x: number, y: number, size = 18, color = "#23372b") =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${esc(value)}</text>`;
const start = (height: number, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}" role="img" aria-label="${esc(title)}"><rect width="1000" height="${height}" fill="white"/><g font-family="Arial, sans-serif">`;
export function elevationCsv(saved: SavedElevationProfile): string {
  return [
    "distance_m,longitude,latitude,elevation_m,grade_percent,slope_degrees,resolution_m",
    ...saved.profile.points.map((p) =>
      [
        p.stationM,
        p.longitude,
        p.latitude,
        p.elevationM ?? "",
        p.gradePercent ?? "",
        p.slopeDegrees ?? "",
        p.resolutionM ?? "",
      ].join(","),
    ),
  ].join("\n");
}
export function elevationGeoJSON(saved: SavedElevationProfile): FeatureCollection {
  const provenance = {
    ANALYSIS: "Elevation profile",
    name: saved.name,
    source: saved.profile.source,
    verticalDatum: saved.profile.verticalDatum,
    retrievedAt: new Date(saved.profile.retrievedAt).toISOString(),
    distanceM: saved.profile.distanceM,
    missingSamples: saved.profile.missing,
    note: "Sampled bare-earth terrain; not a survey. Missing elevations remain NULL; no slope is bridged across gaps.",
  };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { ...provenance, kind: "path" },
        geometry: { type: "LineString", coordinates: saved.coordinates },
      },
      ...saved.profile.points.map((p) => ({
        type: "Feature" as const,
        properties: {
          ...provenance,
          kind: "sample",
          stationM: p.stationM,
          elevationM: p.elevationM,
          gradePercent: p.gradePercent,
          slopeDegrees: p.slopeDegrees,
          resolutionM: p.resolutionM ?? null,
        },
        geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
      })),
    ],
  };
}
export function elevationSvg(saved: SavedElevationProfile, compact = false): string {
  const p = saved.profile,
    height = compact ? 330 : 520;
  let svg =
    start(height, saved.name) +
    text(saved.name, 24, 30, 24) +
    text(
      `Distance ${number(p.distanceM / 1000)} km · Elevation ${number(p.minimumM)}–${number(p.maximumM)} m · Gain ${number(p.ascentM)} m · Loss ${number(p.descentM)} m`,
      24,
      59,
      17,
    );
  const top = 80,
    bottom = compact ? 235 : 350,
    left = 80,
    right = 975;
  const low = p.minimumM ?? 0,
    high = p.maximumM ?? low,
    span = Math.max(1, high - low);
  const x = (s: number) => left + (s / Math.max(1, p.distanceM)) * (right - left);
  const y = (e: number) => bottom - ((e - low) / span) * (bottom - top);
  for (let i = 0; i <= 4; i++) {
    const yy = bottom - ((bottom - top) * i) / 4;
    svg +=
      `<path d="M ${left} ${yy} H ${right}" stroke="#dce4dd"/>` +
      text(number(low + (span * i) / 4), 8, yy + 5, 15) +
      text(
        `${number((p.distanceM * i) / 4 / 1000)} km`,
        x((p.distanceM * i) / 4) - 20,
        bottom + 23,
        15,
      );
  }
  let path = "",
    open = false;
  for (const point of p.points) {
    if (point.elevationM === null) {
      open = false;
      continue;
    }
    path += `${open ? "L" : "M"}${x(point.stationM).toFixed(2)},${y(point.elevationM).toFixed(2)} `;
    open = true;
  }
  svg += `<path d="${path}" fill="none" stroke="#237447" stroke-width="3"/>`;
  for (const point of p.points)
    if (point.elevationM !== null)
      svg += `<circle cx="${x(point.stationM)}" cy="${y(point.elevationM)}" r="2" fill="#237447"/>`;
  svg += text(
    `Steepest sampled grade ${number(p.steepestGradePercent)}% · Missing samples: ${p.missing} · Maximum sample gap ${number(p.maximumSpacingM)} m`,
    24,
    bottom + 51,
    16,
  );
  const foot = compact ? 300 : 415;
  svg += text(`Source: ${p.source} · ${p.verticalDatum}`.slice(0, 120), 24, foot, 15);
  svg += text(
    `Retrieved ${new Date(p.retrievedAt).toISOString()} · Metres horizontally and vertically. Gaps are not interpolated.`,
    24,
    foot + 20,
    14,
  );
  if (!compact)
    svg += text(
      "Terrain samples are not a pad-level survey; sample spacing is not source resolution or accuracy.",
      24,
      foot + 47,
      16,
    );
  return svg + "</g></svg>";
}
export function buildableSvg(snapshot: BuildableSnapshot, compact = false): string {
  const { input, result: r } = snapshot,
    height = compact ? 330 : 650;
  let svg =
    start(height, input.name) +
    text(input.name, 24, 32, 24) +
    text(`Buildable Area screening · ${new Date(r.calculatedAt).toISOString()}`, 24, 59, 16);
  const metrics = [
    ["Study", r.studyAcres],
    ["Excluded (union)", r.excludedAcres],
    ["Conditional", r.conditionalAcres],
    ["Candidate", r.candidateAcres],
    ["Outside conditional", r.outsideConditionalAcres],
    ["Largest component", r.largestAcres],
  ] as const;
  metrics.forEach(([label, acres], i) => {
    const col = i % 3,
      row = Math.floor(i / 3),
      xx = 24 + col * 325,
      yy = 84 + row * 65;
    svg +=
      `<rect x="${xx}" y="${yy}" width="310" height="57" rx="7" fill="#f0f2e9"/>` +
      text(label, xx + 10, yy + 20, 16) +
      text(`${number(acres)} acres`, xx + 10, yy + 44, 22);
  });
  const unresolved = r.completeness.filter((c) => c.status !== "available").length;
  svg += text(
    `${r.components.length} components · ${number(r.candidatePercent)}% candidate · ${unresolved}/${r.completeness.length} categories unresolved/provisional`,
    24,
    235,
    17,
  );
  svg += text(
    `Conditional land ${input.conditionalExcluded ? "deducted" : "retained"}. Candidate land is not certified buildable or cleared.`,
    24,
    260,
    16,
    "#925811",
  );
  lines(SCREENING_NOTE, 125).forEach((line, i) => (svg += text(line, 24, 289 + i * 19, 14)));
  if (!compact) {
    svg += text("Rules, source coverage and assumptions", 24, 355, 21);
    const rows = [
      `Property clipping: ${input.clipToProperty ? "enabled" : "not enabled"}; property setback ${input.propertySetbackM} m; study margin ${input.studyMarginM} m.`,
      ...(input.rules.find((r) => r.terrainSummary)
        ? [
            `Terrain: ${input.rules.find((r) => r.terrainSummary)!.terrainSummary!.cellSizeM} m grid; grade thresholds ${input.automation?.terrain.conditionalSlopePercent}% / ${input.automation?.terrain.exclusionSlopePercent}%; local relief ${input.automation?.terrain.reliefM} m. Not a grading design.`,
          ]
        : []),
      ...r.completeness
        .filter((c) => c.status !== "available")
        .map((c) => `${c.category}: ${c.status}`),
      ...input.rules.map(
        (rule) =>
          `${rule.name}: ${rule.enabled ? rule.classification : "disabled"}, buffer ${rule.buffer} ${rule.unit}; ${rule.coverage}`,
      ),
    ];
    rows.slice(0, 9).forEach((row, i) => (svg += text(row.slice(0, 125), 24, 385 + i * 22, 16)));
    svg += text(
      "Full rule/source details and geometry are available in the separate summary and GeoJSON exports.",
      24,
      618,
      15,
    );
  }
  return svg + "</g></svg>";
}
export function printAnalysisPanels(
  composition: Pick<PrintComposition, "analysisLayerIds">,
  layers: GisLayer[],
): { id: string; title: string; svg: string }[] {
  return (composition.analysisLayerIds ?? [])
    .flatMap((id) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer) return [];
      const buildable = snapshotFromLayer(layer);
      if (buildable)
        return [
          {
            id,
            title: layer.name,
            svg: buildableSvg(
              { ...buildable, input: { ...buildable.input, name: layer.name } },
              true,
            ),
          },
        ];
      const elevation = elevationFromLayer(layer);
      return elevation
        ? [{ id, title: layer.name, svg: elevationSvg({ ...elevation, name: layer.name }, true) }]
        : [];
    })
    .slice(0, 2);
}
export function addAnalysisToComposition(
  composition: PrintComposition,
  id: string,
  layers: GisLayer[],
): PrintComposition {
  const layer = layers.find((l) => l.id === id),
    kind = layer ? analysisKind(layer) : null;
  if (!layer || !kind) return composition;
  const analysisLayerIds = [
    ...(composition.analysisLayerIds ?? []).filter((key) => {
      const other = layers.find((l) => l.id === key);
      return other && analysisKind(other) !== kind;
    }),
    id,
  ];
  return {
    ...composition,
    analysisLayerIds,
    includedLayerIds: [...new Set([...composition.includedLayerIds, id])],
    legendItems: {
      ...composition.legendItems,
      [id]: composition.legendItems[id] ?? { visible: true, name: layer.name },
    },
    frame: analysisPrintFrame(composition.frame, true),
  };
}
export const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function analysisPrintFrame(
  frame: PrintComposition["frame"],
  hasPanels: boolean,
): PrintComposition["frame"] {
  if (!hasPanels) return frame;
  const y = Math.max(0, Math.min(55, frame.y));
  return { ...frame, y, height: Math.max(15, Math.min(frame.height, 70 - y)) };
}
