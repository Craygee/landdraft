import jsts from "jsts";
import type { Position } from "geojson";
import type {
  BuildableInput,
  BuildableRule,
  AreaGeometry,
  TerrainSettings,
  TerrainSummary,
} from "./buildableAreaModel.ts";
import type { TerrainGrid, TerrainGridRequest } from "./buildableTerrainModel.ts";
import { validateGridRequest, BUILDABLE_DEM_URL } from "./buildableTerrainModel.ts";
import { localProjection, mapGeometry } from "./buildableArea.ts";
import { newRule } from "./buildableAreaSources.ts";
import { screeningReferences } from "./buildableAutomation.ts";
export function validateTerrainSettings(s: TerrainSettings): void {
  if (
    ![s.conditionalSlopePercent, s.exclusionSlopePercent, s.reliefM, s.windowM, s.cellSizeM].every(
      Number.isFinite,
    ) ||
    s.conditionalSlopePercent <= 0 ||
    s.exclusionSlopePercent < s.conditionalSlopePercent ||
    s.exclusionSlopePercent > 200 ||
    s.reliefM <= 0 ||
    s.reliefM > 100 ||
    s.windowM < 20 ||
    s.windowM > 300 ||
    s.cellSizeM < 10 ||
    s.cellSizeM > 60
  )
    throw new Error(
      "Use slope thresholds >0 and ≤200%, exclusion ≥ conditional, relief >0–100 m, window 20–300 m, and DEM cells 10–60 m.",
    );
}
export function planTerrainGrid(
  input: BuildableInput,
  settings: TerrainSettings,
): TerrainGridRequest {
  validateTerrainSettings(settings);
  const p = localProjection(input.boundary.geometry);
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  mapGeometry(input.boundary.geometry, (c) => {
    const xy = p.forward(c);
    xmin = Math.min(xmin, xy[0]!);
    xmax = Math.max(xmax, xy[0]!);
    ymin = Math.min(ymin, xy[1]!);
    ymax = Math.max(ymax, xy[1]!);
    return c;
  });
  for (let size = settings.cellSizeM; size <= 60; size += 5) {
    const halo = Math.ceil(settings.windowM / 2 / size) + 1;
    const box: [number, number, number, number] = [
      (Math.floor(xmin / size) - halo) * size,
      (Math.floor(ymin / size) - halo) * size,
      (Math.ceil(xmax / size) + halo) * size,
      (Math.ceil(ymax / size) + halo) * size,
    ];
    const zone = Number(/\+zone=(\d+)/.exec(p.crs)?.[1]),
      epsg = (p.crs.includes("+south") ? 32700 : 32600) + zone;
    const plan = {
      bbox: box,
      width: Math.round((box[2] - box[0]) / size),
      height: Math.round((box[3] - box[1]) / size),
      epsg,
    };
    if (validateGridRequest(plan)) return plan;
  }
  throw new Error(
    "Study exceeds the 256×256 terrain grid budget at 60 m cells. Split into smaller studies; no terrain was assumed flat.",
  );
}
export async function requestTerrainGrid(
  input: BuildableInput,
  signal: AbortSignal,
): Promise<TerrainGrid | undefined> {
  signal.throwIfAborted();
  const settings = input.automation?.terrain;
  if (!settings?.enabled) return undefined;
  const plan = planTerrainGrid(input, settings);
  const response = await fetch("/api/analysis/buildable-terrain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  signal.throwIfAborted();
  const value = (await response.json()) as TerrainGrid & { error?: string };
  if (!response.ok || value.error)
    throw new Error(value.error ?? `Terrain service HTTP ${response.status}`);
  if (
    !validateGridRequest(value) ||
    value.width !== plan.width ||
    value.height !== plan.height ||
    value.epsg !== plan.epsg ||
    JSON.stringify(value.bbox) !== JSON.stringify(plan.bbox) ||
    !Array.isArray(value.values) ||
    value.values.length !== plan.width * plan.height ||
    !value.values.every((v) => v === null || Number.isFinite(v))
  )
    throw new Error("Terrain grid was incomplete or misaligned. Not evaluated.");
  return value;
}
const area = (ring: number[][]) =>
  ring
    .slice(0, -1)
    .reduce((a, p, i) => a + p[0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * p[1]!, 0) / 2;
function contains(ring: number[][], point: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (
      a[1]! > point[1]! !== b[1]! > point[1]! &&
      point[0]! < ((b[0]! - a[0]!) * (point[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    )
      inside = !inside;
  }
  return inside;
}
/** Exact pixel-edge polygonisation; 4-connected components; collinear edges only are simplified. */
export function maskPolygons(mask: Uint8Array, width: number, height: number): number[][][][] {
  const visited = new Uint8Array(mask.length),
    polygons: number[][][][] = [];
  let total = 0;
  type Edge = { a: number; b: number; direction: number; used: boolean };
  const node = (x: number, y: number) => y * (width + 1) + x,
    coord = (n: number) => [n % (width + 1), Math.floor(n / (width + 1))];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const cells = [start];
    visited[start] = 1;
    for (let q = 0; q < cells.length; q++) {
      const i = cells[q]!,
        x = i % width,
        y = Math.floor(i / width);
      for (const [xx, yy] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (xx! < 0 || xx! >= width || yy! < 0 || yy! >= height) continue;
        const j = yy! * width + xx!;
        if (mask[j] && !visited[j]) {
          visited[j] = 1;
          cells.push(j);
        }
      }
    }
    const edges: Edge[] = [],
      out = new Map<number, Edge[]>();
    const add = (x: number, y: number, xx: number, yy: number, direction: number) => {
      const e = { a: node(x, y), b: node(xx, yy), direction, used: false };
      edges.push(e);
      const list = out.get(e.a) ?? [];
      list.push(e);
      out.set(e.a, list);
    };
    for (const i of cells) {
      const x = i % width,
        y = Math.floor(i / width);
      if (y === 0 || !mask[i - width]) add(x, y, x + 1, y, 0);
      if (x === width - 1 || !mask[i + 1]) add(x + 1, y, x + 1, y + 1, 1);
      if (y === height - 1 || !mask[i + width]) add(x + 1, y + 1, x, y + 1, 2);
      if (x === 0 || !mask[i - 1]) add(x, y + 1, x, y, 3);
    }
    const shells: number[][][] = [],
      holes: number[][][] = [];
    for (const first of edges) {
      if (first.used) continue;
      let current = first;
      const nodes = [coord(first.a)];
      for (let guard = 0; guard <= edges.length; guard++) {
        current.used = true;
        nodes.push(coord(current.b));
        if (current.b === first.a) break;
        const choices = (out.get(current.b) ?? []).filter((e) => !e.used);
        const score = (e: Edge) => [1, 0, 3, 2].indexOf((e.direction - current.direction + 4) % 4);
        choices.sort((a, b) => score(a) - score(b));
        if (!choices.length) throw new Error("Terrain boundary tracing failed.");
        current = choices[0]!;
      }
      if (nodes.at(-1)![0] !== nodes[0]![0] || nodes.at(-1)![1] !== nodes[0]![1])
        throw new Error("Terrain ring did not close.");
      const open = nodes.slice(0, -1),
        corners = open.filter((p, i) => {
          const a = open[(i + open.length - 1) % open.length]!,
            b = open[(i + 1) % open.length]!;
          return (p[0]! - a[0]!) * (b[1]! - p[1]!) !== (p[1]! - a[1]!) * (b[0]! - p[0]!);
        });
      corners.push(corners[0]!);
      total += corners.length;
      if (total > 60000)
        throw new Error(
          "Terrain constraints exceed 60,000 boundary coordinates. Choose coarser cells or a smaller study.",
        );
      (area(corners) > 0 ? shells : holes).push(corners);
    }
    const parts = shells.map((shell) => [shell]);
    for (const hole of holes) {
      const owner = parts.find((p) => contains(p[0]!, hole[0]!));
      if (!owner) throw new Error("Terrain hole could not be assigned safely.");
      owner.push(hole);
    }
    polygons.push(...parts);
  }
  if (!polygons.length) return polygons;
  let g = new jsts.io.GeoJSONReader().read({ type: "MultiPolygon", coordinates: polygons });
  if (!g.isValid()) g = g.buffer(0);
  const expected = mask.reduce((a, b) => a + (b ? 1 : 0), 0);
  if (!g.isValid() || Math.abs(g.getArea() - expected) > 1e-7)
    throw new Error("Terrain polygonisation did not preserve pixel area.");
  const result = new jsts.io.GeoJSONWriter().write(g) as {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
  return result.type === "Polygon"
    ? [result.coordinates as number[][][]]
    : (result.coordinates as number[][][][]);
}
export function terrainRules(input: BuildableInput, grid: TerrainGrid): BuildableRule[] {
  const s = input.automation!.terrain;
  validateTerrainSettings(s);
  if (!validateGridRequest(grid) || grid.values.length !== grid.width * grid.height)
    throw new Error("Invalid numeric terrain grid");
  const plan = planTerrainGrid(input, s);
  if (
    plan.epsg !== grid.epsg ||
    JSON.stringify(plan.bbox) !== JSON.stringify(grid.bbox) ||
    plan.width !== grid.width ||
    plan.height !== grid.height
  )
    throw new Error("Terrain grid does not match this study and settings.");
  const { width: w, height: h, values: z } = grid,
    dx = (grid.bbox[2] - grid.bbox[0]) / w,
    dy = (grid.bbox[3] - grid.bbox[1]) / h,
    radius = Math.max(1, Math.ceil(s.windowM / 2 / dx));
  const steep = new Uint8Array(w * h),
    moderate = new Uint8Array(w * h),
    unknown = new Uint8Array(w * h),
    known = new Uint8Array(w * h);
  let valid = 0,
    missing = 0,
    maxSlope: number | null = null,
    maxRelief: number | null = null;
  for (let y = radius; y < h - radius; y++)
    for (let x = radius; x < w - radius; x++) {
      const i = y * w + x;
      let low = Infinity,
        high = -Infinity,
        complete = true;
      for (let yy = y - radius; yy <= y + radius; yy++)
        for (let xx = x - radius; xx <= x + radius; xx++) {
          const value = z[yy * w + xx];
          if (value === null || value === undefined || !Number.isFinite(value)) {
            complete = false;
            continue;
          }
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
      if (!complete) {
        unknown[i] = 1;
        missing++;
        continue;
      }
      const at = (xx: number, yy: number) => z[(y + yy) * w + x + xx]!;
      const dzdx =
          (at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1)) / (8 * dx),
        dzdy =
          (at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1)) / (8 * dy);
      let slope = Math.hypot(dzdx, dzdy) * 100;
      for (let yy = -1; yy <= 1; yy++)
        for (let xx = -1; xx <= 1; xx++)
          if (xx || yy)
            slope = Math.max(
              slope,
              (Math.abs(at(xx, yy) - at(0, 0)) / Math.hypot(xx * dx, yy * dy)) * 100,
            );
      const relief = high - low;
      valid++;
      known[i] = 1;
      maxSlope = Math.max(maxSlope ?? 0, slope);
      maxRelief = Math.max(maxRelief ?? 0, relief);
      if (slope >= s.exclusionSlopePercent) steep[i] = 1;
      else if (slope >= s.conditionalSlopePercent || relief > s.reliefM) moderate[i] = 1;
    }
  const p = localProjection(input.boundary.geometry);
  const geometry = (mask: Uint8Array): AreaGeometry | undefined => {
    const coordinates = maskPolygons(mask, w, h);
    return coordinates.length
      ? {
          type: "MultiPolygon",
          coordinates: coordinates.map((poly) =>
            poly.map((ring) =>
              ring.map(
                (c) =>
                  p.inverse([grid.bbox[0] + c[0]! * dx, grid.bbox[3] - c[1]! * dy]) as Position,
              ),
            ),
          ),
        }
      : undefined;
  };
  const coverageGeometry = geometry(known);
  const summary: TerrainSummary = {
    source: grid.source,
    sourceUrl: grid.sourceUrl,
    retrievedAt: grid.retrievedAt,
    productDate: grid.productDate,
    sourceResolutionM: grid.sourceResolutionM,
    cellSizeM: dx,
    requestedCellSizeM: s.cellSizeM,
    horizontalUnits: "metres",
    verticalUnits: "metres",
    verticalDatum: grid.verticalDatum,
    windowM: 2 * radius * dx,
    requestedWindowM: s.windowM,
    validCells: valid,
    unknownCells: missing,
    maxSlopePercent: maxSlope,
    maxReliefM: maxRelief,
    method:
      "UTM grid; max(Horn 3×3 grade, eight-neighbour drop grade); local min/max relief; all neighbours required; exact pixel-edge polygons; zero-distance topology normalization validated against pixel area; clipped to study. Statistics cover the study bounding grid, not only the polygon interior.",
  };
  const masks = [
    {
      key: "steep",
      name: `Steep terrain ≥${s.exclusionSlopePercent}%`,
      mask: steep,
      treatment: "exclusion" as const,
    },
    {
      key: "moderate",
      name: `Terrain ≥${s.conditionalSlopePercent}% grade or >${s.reliefM} m relief`,
      mask: moderate,
      treatment: "conditional" as const,
    },
    {
      key: "unknown",
      name: "Terrain coverage unknown — not cleared",
      mask: unknown,
      treatment: "conditional" as const,
    },
  ];
  return masks.map((item) => {
    const g = geometry(item.mask),
      previous = input.rules.find((r) => r.autoKey === `terrain:${item.key}`);
    return {
      ...newRule(item.name, "terrain", {
        type: "FeatureCollection",
        features: g
          ? [{ type: "Feature", properties: { terrainClass: item.key }, geometry: g }]
          : [],
      }),
      id: previous?.id ?? crypto.randomUUID(),
      autoKey: `terrain:${item.key}`,
      generated: "terrain",
      requiredCheck: true,
      classification: previous?.classification ?? item.treatment,
      originalClassification: item.treatment,
      enabled: previous?.enabled ?? true,
      buffer: previous?.buffer ?? 0,
      unit: previous?.unit ?? "meters",
      override: previous?.override ?? false,
      sourceId: grid.source,
      ...(grid.productDate ? { sourceDate: grid.productDate } : {}),
      retrievedAt: grid.retrievedAt,
      verification: "provisional",
      coverage: missing ? "partial" : "provisional",
      coverageGeometry: item.key !== "unknown" ? coverageGeometry : undefined,
      terrainSummary: summary,
      basis: [screeningReferences.slope, screeningReferences.dem],
      explanation: `LandDraft-derived terrain screening. ${dx} m output cells; source resolution/accuracy varies. Local relief window ${summary.windowM} m (requested ${s.windowM} m). Slope is percent rise/run, not degrees. Unknown cells are conditional; no interpolation across missing data. Features smaller than grid spacing can be missed. This does not evaluate grading, foundation or pad feasibility.`,
    };
  });
}
export function terrainFailure(input: BuildableInput, error: string): BuildableRule {
  return {
    ...newRule("Terrain not evaluated", "terrain"),
    autoKey: "terrain:failed",
    generated: "terrain",
    requiredCheck: true,
    coverage: "failed",
    sourceId: BUILDABLE_DEM_URL,
    explanation: error,
  };
}
