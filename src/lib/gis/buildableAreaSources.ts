import type { FeatureCollection } from "geojson";
import { fetchArcgisFeatureCount, fetchRemoteGeoJSONPaged, classifyUrl } from "./arcgis.ts";
import { mapGeometry, localProjection } from "./buildableArea.ts";
import type { BuildableInput, BuildableRule, ConstraintCategory } from "./buildableAreaModel.ts";
import type { CatalogEntry } from "./catalog.ts";
import type { GisLayer } from "./types";
import { assertBuildableBudget } from "./buildableAreaModel.ts";

export const buildablePresets: { id: string; category: ConstraintCategory }[] = [
  { id: "fws-wetlands", category: "wetlands" },
  { id: "nhd-flowlines", category: "streams" },
  { id: "usgs-waterbodies", category: "waterbodies" },
  { id: "usgs-water-areas", category: "drainage" },
  { id: "fema-100-year-floodplain", category: "flood" },
  { id: "fema-500-year-floodplain", category: "flood" },
  { id: "fema-regulatory-floodway", category: "floodway" },
  { id: "tx-transmission", category: "transmission" },
  { id: "tx-substations-archive", category: "substations" },
  { id: "us-wind-turbines", category: "wind" },
  { id: "us-solar", category: "solar" },
  { id: "tx-groundwater-wells", category: "wells" },
  { id: "tx-public-water-wells", category: "wells" },
  { id: "tx-rrc-pipelines", category: "pipelines" },
  { id: "txdot-roadways", category: "road-row" },
  { id: "epa-superfund", category: "environment" },
  { id: "epa-hazardous-waste", category: "environment" },
  { id: "usgs-local-access-roads", category: "private-access" },
  { id: "tx-railroads", category: "rail" },
  { id: "tx-roundrock-fiber-ring", category: "fiber" },
  { id: "tx-roundrock-fiber-conduit", category: "fiber" },
];
const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });
export function newRule(
  name: string,
  category: ConstraintCategory,
  features = empty(),
): BuildableRule {
  return {
    id: crypto.randomUUID(),
    name,
    category,
    sourceId: "User supplied",
    originalClassification: "conditional",
    classification: "conditional",
    enabled: true,
    buffer: 0,
    unit: "feet",
    verification: "user-assumption",
    override: false,
    coverage: "user-unknown",
    explanation: "User-supplied data; completeness and rights not independently verified.",
    geometryBasis: "User-supplied geometry; identify footprint, centerline, location or easement",
    features,
  };
}
export function ruleFromCatalog(entry: CatalogEntry, category: ConstraintCategory): BuildableRule {
  if (!entry.url || classifyUrl(entry.url) !== "arcgis")
    throw new Error("This catalog source is not a supported live feature query.");
  return {
    ...newRule(entry.name, category),
    sourceId: entry.id,
    sourceUrl: entry.url,
    sourceFilter: entry.where,
    coverage: "not-evaluated",
    explanation: entry.description,
    geometryBasis:
      entry.id === "us-solar"
        ? "Mapped photovoltaic facility polygon; verify actual occupied arrays/buildings versus project or lease boundary before applying exclusions."
        : `${entry.geometry} — ${entry.description}`,
    features: empty(),
  };
}
export function ruleFromLayer(layer: GisLayer, category: ConstraintCategory): BuildableRule {
  if (layer.data.features.length > 4000 && layer.source.kind !== "remote")
    throw new Error("Select or filter fewer than 4,000 features before adding this constraint.");
  if (layer.source.kind !== "remote") assertBuildableBudget(layer.data);
  return {
    ...newRule(
      layer.name,
      category,
      layer.source.kind === "remote" ? empty() : structuredClone(layer.data),
    ),
    sourceId: layer.id,
    layerId: layer.id,
    ...(layer.source.kind === "remote"
      ? {
          sourceUrl: layer.source.url,
          sourceFilter: layer.source.where,
          coverage: "not-evaluated" as const,
        }
      : {}),
    retrievedAt: new Date().toISOString(),
    explanation:
      "Snapshot of project layer. Imported/drawn coverage is unknown; remote sources will be re-queried over the expanded study bounds.",
  };
}
export function retrievalBounds(
  input: BuildableInput,
  rule: BuildableRule,
): [number, number, number, number] {
  const p = localProjection(input.boundary.geometry);
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  mapGeometry(input.boundary.geometry, (coordinate) => {
    const xy = p.forward(coordinate);
    west = Math.min(west, xy[0]!);
    east = Math.max(east, xy[0]!);
    south = Math.min(south, xy[1]!);
    north = Math.max(north, xy[1]!);
    return coordinate;
  });
  const meters = rule.buffer * (rule.unit === "feet" ? 0.3048 : 1);
  if (!Number.isFinite(meters) || meters < 0 || meters > 5000)
    throw new Error("Buffers must be 0–5,000 metres.");
  const margin = meters + 2;
  // Densify the expanded projected box edge so inverse projection extrema aren't limited to corners.
  const coords: number[][] = [];
  for (let t = 0; t <= 1; t += 0.125) {
    const x = west - margin + (east - west + 2 * margin) * t,
      y = south - margin + (north - south + 2 * margin) * t;
    coords.push(
      p.inverse([x, south - margin]),
      p.inverse([x, north + margin]),
      p.inverse([west - margin, y]),
      p.inverse([east + margin, y]),
    );
  }
  return [
    Math.min(...coords.map((c) => c[0]!)),
    Math.min(...coords.map((c) => c[1]!)),
    Math.max(...coords.map((c) => c[0]!)),
    Math.max(...coords.map((c) => c[1]!)),
  ];
}
async function retrySource<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
  retry: () => void,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    signal.throwIfAborted();
    if (
      !/fetch|timeout|abort|50[234]|network|load|temporar/i.test(
        error instanceof Error ? error.message : "",
      )
    )
      throw error;
    retry();
    return await task();
  }
}
export async function loadBuildableSources(
  input: BuildableInput,
  catalog: CatalogEntry[],
  layers: GisLayer[],
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<BuildableInput> {
  const loadRule = async (original: BuildableRule): Promise<BuildableRule> => {
    signal.throwIfAborted();
    let rule = structuredClone(original);
    if (!rule.enabled || rule.generated) return rule;
    const layer = layers.find((l) => l.id === rule.layerId);
    if (layer && !rule.sourceUrl) rule.features = structuredClone(layer.data);
    if (rule.sourceUrl) {
      progress(`Loading ${rule.name}`);
      try {
        if (classifyUrl(rule.sourceUrl) !== "arcgis")
          throw new Error(
            "Use an imported snapshot for non-ArcGIS sources; remote geographic coverage cannot be verified.",
          );
        const entry = catalog.find((e) => e.id === rule.sourceId);
        const where =
          layer?.source.kind === "remote"
            ? layer.source.where
            : (rule.sourceFilter ?? entry?.where);
        const options = {
          bbox: retrievalBounds(input, rule),
          where,
          signal,
          timeoutMs: 25_000,
          geometryPrecision: 8,
        };
        const count = await retrySource(
          () => fetchArcgisFeatureCount(rule.sourceUrl!, options),
          signal,
          () => progress(`Retrying ${rule.name} after a connection failure`),
        );
        if (count > 4000)
          throw new Error(
            `${count.toLocaleString()} source features exceed the 4,000-feature limit. Reduce study area or use a filtered imported layer.`,
          );
        const fetched = await retrySource(
          () =>
            fetchRemoteGeoJSONPaged(rule.sourceUrl!, {
              ...options,
              maxTotalFeatures: 4001,
              pageSize: 1000,
            }),
          signal,
          () => progress(`Retrying ${rule.name} data query`),
        );
        rule = {
          ...rule,
          features: fetched.data,
          retrievedAt: new Date().toISOString(),
          coverage:
            fetched.complete && !fetched.truncated && fetched.loaded === count
              ? "available"
              : "partial",
        };
        if (rule.coverage === "partial")
          rule.explanation +=
            " Query returned partial or changing data; not all mapped features were evaluated.";
        if (count === 0 && fetched.complete)
          rule.explanation +=
            " Successful expanded-bounds query found no mapped features; dataset coverage/real-world absence is not established.";
      } catch (error) {
        signal.throwIfAborted();
        rule = {
          ...rule,
          features: empty(),
          coverage: "failed",
          retrievedAt: new Date().toISOString(),
          explanation: error instanceof Error ? error.message : "Source failed to load",
        };
      }
    }
    if (rule.features.features.length > 4000)
      throw new Error(`${rule.name}: reduce to fewer than 4,000 features.`);
    assertBuildableBudget(rule.features);
    return rule;
  };
  const rules: BuildableRule[] = new Array(input.rules.length);
  let next = 0,
    done = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, input.rules.length) }, async () => {
      while (next < input.rules.length) {
        const index = next++;
        rules[index] = await loadRule(input.rules[index]!);
        progress(`Loaded ${++done}/${input.rules.length}: ${rules[index]!.name}`);
      }
    }),
  );
  signal.throwIfAborted();
  assertBuildableBudget({
    type: "FeatureCollection",
    features: [
      input.boundary,
      ...rules.filter((r) => !r.generated).flatMap((r) => r.features.features),
    ],
  });
  return { ...input, rules };
}

/** Generation tokens are invalidated on edits, project changes and cancellation. */
export class BuildableRunGate {
  private generation = 0;
  next() {
    return ++this.generation;
  }
  cancel() {
    this.generation++;
  }
  accepts(token: number) {
    return token === this.generation;
  }
}
