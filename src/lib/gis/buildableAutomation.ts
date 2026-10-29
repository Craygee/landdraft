import type {
  BuildableInput,
  BuildableRule,
  ConstraintCategory,
  TerrainSettings,
} from "./buildableAreaModel.ts";
import type { CatalogEntry } from "./catalog.ts";
import { ruleFromCatalog, newRule } from "./buildableAreaSources.ts";
import { mapGeometry } from "./buildableArea.ts";
export const AUTO_POLICY_VERSION = "LandDraft screening 1.0";
export const screeningReferences = {
  wetlands: {
    title: "USFWS NWI limitations",
    url: "https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper",
    explanation:
      "Biological inventory; not a jurisdictional delineation. Exclusion is a selected screening policy.",
  },
  water: {
    title: "EPA construction buffer guidance",
    url: "https://www.epa.gov/npdes/construction-general-permit-cgp-frequent-questions",
    explanation:
      "50 ft is one construction sediment-control alternative where EPA CGP applies, not a universal development setback. Mapped centerlines differ from surveyed banks; all screening buffers here are provisional.",
  },
  flood: {
    title: "FEMA floodway analysis",
    url: "https://www.fema.gov/sites/default/files/2020-02/FloodwayAnalysis_and_Mapping_Nov_2019.pdf",
    explanation:
      "Floodways require encroachment review/no-rise compliance where applicable. Excluding floodways and the 1% floodplain is a conservative LandDraft policy; it is not a finding that all such development is prohibited.",
  },
  slope: {
    title: "NRCS slope/site limitations example",
    url: "https://www.nrcs.usda.gov/sites/default/files/2022-11/NH%20Envirothon%20Soil%20Guide%202020.pdf",
    explanation:
      "NRCS educational guidance identifies 8–15% slopes as construction limitations and >15% as severe for a homesite example. General thresholds of 8%/15% are initial screening assumptions, not universal engineering criteria. Data Center 5%/10% and local relief limits are LandDraft planning assumptions.",
  },
  dem: {
    title: "USGS 3DEP products",
    url: "https://www.usgs.gov/3d-elevation-program/about-3dep-products-services",
    explanation:
      "Multi-resolution bare-earth DEM. Raster spacing is not survey accuracy; small cliffs, berms and drainage features can be missed.",
  },
  infrastructure: {
    title: "LandDraft provisional infrastructure screening",
    url: "https://www.landdraft.net",
    explanation:
      "Planning allowance only. These distances do not establish recorded ROW, easement widths, legal setbacks, physical footprints or utility access/capacity. Replace with verified local/recorded geometry.",
  },
};
export const terrainDefaults = (profile: BuildableInput["profile"]): TerrainSettings => ({
  enabled: true,
  conditionalSlopePercent: profile === "data-center" ? 5 : 8,
  exclusionSlopePercent: profile === "data-center" ? 10 : 15,
  reliefM: profile === "data-center" ? 2 : 3,
  windowM: 50,
  cellSizeM: 10,
});
export const automaticPresets: {
  id: string;
  category: ConstraintCategory;
  treatment: BuildableRule["classification"];
  bufferFeet: number;
  basis: keyof typeof screeningReferences;
  required?: boolean;
}[] = [
  {
    id: "fws-wetlands",
    category: "wetlands",
    treatment: "exclusion",
    bufferFeet: 0,
    basis: "wetlands",
    required: true,
  },
  {
    id: "usgs-waterbodies",
    category: "waterbodies",
    treatment: "exclusion",
    bufferFeet: 0,
    basis: "water",
    required: true,
  },
  {
    id: "usgs-water-areas",
    category: "drainage",
    treatment: "exclusion",
    bufferFeet: 0,
    basis: "water",
    required: true,
  },
  {
    id: "nhd-flowlines",
    category: "streams",
    treatment: "conditional",
    bufferFeet: 50,
    basis: "water",
    required: true,
  },
  {
    id: "fema-100-year-floodplain",
    category: "flood",
    treatment: "exclusion",
    bufferFeet: 0,
    basis: "flood",
    required: true,
  },
  {
    id: "fema-regulatory-floodway",
    category: "floodway",
    treatment: "exclusion",
    bufferFeet: 0,
    basis: "flood",
    required: true,
  },
  {
    id: "fema-500-year-floodplain",
    category: "flood",
    treatment: "conditional",
    bufferFeet: 0,
    basis: "flood",
  },
  {
    id: "tx-transmission",
    category: "transmission",
    treatment: "conditional",
    bufferFeet: 50,
    basis: "infrastructure",
  },
  {
    id: "tx-rrc-pipelines",
    category: "pipelines",
    treatment: "conditional",
    bufferFeet: 50,
    basis: "infrastructure",
  },
  {
    id: "txdot-roadways",
    category: "road-row",
    treatment: "conditional",
    bufferFeet: 30,
    basis: "infrastructure",
  },
  {
    id: "tx-railroads",
    category: "rail",
    treatment: "conditional",
    bufferFeet: 50,
    basis: "infrastructure",
  },
  {
    id: "us-wind-turbines",
    category: "wind",
    treatment: "conditional",
    bufferFeet: 300,
    basis: "infrastructure",
  },
];
/** Fill missing presets only. Existing rule treatments/buffers/enabled states always win. */
export function optimizeBuildable(input: BuildableInput, catalog: CatalogEntry[]): BuildableInput {
  const next = structuredClone(input);
  next.automation ??= {
    version: AUTO_POLICY_VERSION,
    terrain: terrainDefaults(input.profile),
    holdUnresolved: true,
  };
  if (!input.automation?.applied) next.conditionalExcluded = true;
  next.automation.applied = true;
  let west = 180,
    east = -180,
    south = 90,
    north = -90;
  mapGeometry(next.boundary.geometry, (p) => {
    west = Math.min(west, p[0]!);
    east = Math.max(east, p[0]!);
    south = Math.min(south, p[1]!);
    north = Math.max(north, p[1]!);
    return p;
  });
  const texasRegion = west >= -107 && east <= -93 && south >= 25 && north <= 37;
  for (const preset of automaticPresets) {
    const entry = catalog.find((e) => e.id === preset.id);
    if (preset.id.startsWith("tx") && !texasRegion) continue;
    const existing = next.rules.find(
      (r) =>
        r.sourceId === preset.id ||
        r.autoKey === preset.id ||
        (entry?.url && r.sourceUrl === entry.url && (r.sourceFilter ?? "") === (entry.where ?? "")),
    );
    if (existing) {
      existing.autoKey ??= preset.id;
      existing.requiredCheck ??= Boolean(preset.required);
      existing.basis ??= [screeningReferences[preset.basis]];
      continue;
    }
    const rule = entry
      ? ruleFromCatalog(entry, preset.category)
      : {
          ...newRule(preset.id, preset.category),
          sourceId: preset.id,
          coverage: "failed" as const,
          explanation: "Requested catalog connection is unavailable.",
        };
    next.rules.push({
      ...rule,
      autoKey: preset.id,
      requiredCheck: Boolean(preset.required),
      classification: preset.treatment,
      originalClassification: preset.treatment,
      buffer: preset.bufferFeet,
      unit: "feet",
      verification: "provisional",
      basis: [screeningReferences[preset.basis]],
      explanation: rule.explanation + " " + screeningReferences[preset.basis].explanation,
    });
  }
  return next;
}
/** Missing critical checks are conditional across the study; never converted to no constraints. */
export function holdUnresolvedChecks(input: BuildableInput): BuildableInput {
  const prior = input.rules.find((r) => r.generated === "unresolved");
  const rules = input.rules.filter((r) => r.generated !== "unresolved");
  const missing = rules.filter(
    (r) =>
      r.enabled &&
      r.requiredCheck &&
      ["failed", "partial", "not-evaluated"].includes(r.coverage) &&
      !(r.generated === "terrain" && r.coverage === "partial"),
  );
  if (input.automation?.holdUnresolved && missing.length) {
    rules.push({
      ...newRule("Unresolved required checks — not cleared", "user", {
        type: "FeatureCollection",
        features: [structuredClone(input.boundary)],
      }),
      id: prior?.id ?? crypto.randomUUID(),
      enabled: prior?.enabled ?? true,
      override: prior?.override ?? false,
      autoKey: "unresolved-checks",
      generated: "unresolved",
      classification: prior?.classification ?? "conditional",
      originalClassification: "conditional",
      coverage: "provisional",
      explanation:
        "Extent of missing coverage is unknown; the study is held conditional for: " +
        missing.map((r) => r.name).join(", ") +
        ". This does not mean the land is physically unsuitable. Disable a failed check explicitly or change the unresolved-data policy to assess available inputs only.",
    });
  }
  return { ...input, rules };
}
