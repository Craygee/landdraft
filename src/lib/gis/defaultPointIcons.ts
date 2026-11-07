import { markerIcons } from "./markerIcons.ts";

/** A point-layer "type" the app can recognise from a layer name. The key is a markerIcons id. */
export interface PointIconType {
  /** Matches an entry in markerIcons; also the key for the account-wide override. */
  id: string;
  label: string;
  pattern: RegExp;
}

/** Ordered: the first match wins, so specific types come before general ones. */
export const pointIconTypes: PointIconType[] = [
  { id: "substation", label: "Substations", pattern: /substation/i },
  {
    id: "airport",
    label: "Airports / airstrips",
    pattern: /\b(airport|airstrip|heliport|aerodrome)s?\b/i,
  },
  { id: "solar", label: "Solar facilities", pattern: /\bsolar\b/i },
  { id: "wind", label: "Wind turbines", pattern: /\b(wind\s+(turbine|farm|power)|turbines?)\b/i },
  {
    id: "oil",
    label: "Oil & gas wells",
    pattern:
      /\b(oil|gas|drilling|hydrocarbon|permit)\b.*\b(wells?|permits?|leases?)\b|\bwells?\b.*\b(oil|gas)\b/i,
  },
  {
    id: "well",
    label: "Water wells",
    pattern: /\b(water|ground\s?water|aquifer|public\s+water)\b.*\bwells?\b|\bwells?\b/i,
  },
  { id: "dam", label: "Dams", pattern: /\bdams?\b/i },
  {
    id: "tank",
    label: "Tanks / reservoirs",
    pattern: /\b(tanks?|reservoirs?|storage\s+tanks?)\b/i,
  },
  {
    id: "fuel",
    label: "Fuel / gas stations",
    pattern: /\b(fuel|gas\s+station|gasoline|diesel|processing\s+plants?)\b/i,
  },
  {
    id: "power",
    label: "Power plants",
    pattern: /\b(power\s+plants?|peaker|generat\w+|electric)\b/i,
  },
  { id: "pipeline", label: "Pipeline features", pattern: /\bpipelines?\b/i },
  {
    id: "communications",
    label: "Communications",
    pattern: /\b(towers?|cell|fiber|broadband|telecom\w*|communications?|antenna)\b/i,
  },
  { id: "rail", label: "Railroad", pattern: /\b(rail|railroad|railway|crossings?)\b/i },
  {
    id: "intersection",
    label: "Intersections / traffic",
    pattern: /\b(intersections?|traffic\s+counts?)\b/i,
  },
  { id: "parking", label: "Parking", pattern: /\bparking\b/i },
  { id: "road", label: "Roads", pattern: /\b(roads?|roadways?|highways?|bridges?)\b/i },
  {
    id: "water",
    label: "Water features",
    pattern: /\b(springs?|ponds?|lakes?|streams?|water\s+(intake|source|feature)s?)\b/i,
  },
  {
    id: "park",
    label: "Parks / habitat",
    pattern: /\b(parks?|habitat|wildlife|preserve|trailhead|campground)s?\b/i,
  },
  {
    id: "farm",
    label: "Farms / ranches",
    pattern: /\b(farms?|ranch\w*|barns?|pastures?|agricultur\w*)\b/i,
  },
  {
    id: "home",
    label: "Homes / residences",
    pattern: /\b(homes?|houses?|residen\w+|dwellings?|cabins?)\b/i,
  },
  {
    id: "building",
    label: "Buildings / facilities",
    pattern: /\b(buildings?|facilit(y|ies)|structures?|schools?|hospitals?|churches?)\b/i,
  },
  { id: "parcel", label: "Parcels", pattern: /\b(parcels?|lots?|tracts?|properties|property)\b/i },
  {
    id: "flag",
    label: "Flags / waypoints",
    pattern: /\b(waypoints?|flags?|stakes?|survey\s+(points?|monuments?)|markers?)\b/i,
  },
];

export type PointIconPreferences = Record<string, string>;

export function pointIconTypeForName(name: string): PointIconType | undefined {
  const text = name.replace(/[_—–-]+/g, " ");
  return pointIconTypes.find((type) => type.pattern.test(text));
}

/** Symbol for a type when the user has not overridden it. */
export function builtInPointIcon(typeId: string): string | undefined {
  return markerIcons.find((icon) => icon.id === typeId)?.symbol;
}

/**
 * Icon to use for a newly added point layer, or "" when no existing icon is a clear fit
 * (the layer then keeps the plain circle, as before). A per-type override saved in the
 * account wins over the built-in choice; an empty override means "plain circle".
 */
export function defaultPointIconForLayer(
  name: string,
  preferences: PointIconPreferences = {},
): string {
  const type = pointIconTypeForName(name);
  if (!type) return "";
  if (Object.prototype.hasOwnProperty.call(preferences, type.id)) return preferences[type.id] ?? "";
  return builtInPointIcon(type.id) ?? "";
}

export function normalizePointIconPreferences(value: unknown): PointIconPreferences {
  if (!value || typeof value !== "object") return {};
  const known = new Set(pointIconTypes.map((type) => type.id));
  const result: PointIconPreferences = {};
  for (const [key, icon] of Object.entries(value as Record<string, unknown>))
    if (known.has(key) && typeof icon === "string" && icon.length <= 4) result[key] = icon;
  return result;
}

interface NewLayerInput {
  name: string;
  data: { features: { geometry: { type: string } | null }[] };
  source: { kind: string; catalogId?: string };
  style?: { pointIcon?: string; categorizedIcons?: unknown };
}

const hasPoints = (input: NewLayerInput) =>
  input.data.features.some(
    (feature) => feature.geometry?.type === "Point" || feature.geometry?.type === "MultiPoint",
  );

/**
 * Style fragment to merge under any explicit style when a layer is added. Only layers that
 * contain points (or remote layers still loading) are touched, and only when the caller did
 * not already choose an icon.
 */
export function suggestedPointIconStyle(
  input: NewLayerInput,
  preferences: PointIconPreferences = {},
  catalogGeometry?: "point" | "line" | "polygon",
): { pointIcon?: string } {
  if (
    input.source.kind === "derived" ||
    input.source.kind === "image" ||
    input.source.kind === "raster"
  )
    return {};
  if (input.style?.pointIcon || input.style?.categorizedIcons) return {};
  const pending = input.data.features.length === 0 && input.source.kind === "remote";
  if (!hasPoints(input) && !(pending && catalogGeometry === "point")) return {};
  const pointIcon = defaultPointIconForLayer(input.name, preferences);
  return pointIcon ? { pointIcon } : {};
}
