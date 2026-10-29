import type { GisFeature } from "./types";
import { squareMeters, meters, AREA_UNITS } from "./measure.ts";

/**
 * Composes a label from a template such as `{OWNER} · {ACRES} acres`.
 * Built-in tokens: ACRES, SQFT, SQM, HECTARES, LENGTH_MI, LENGTH_FT, LAT, LON.
 */
export function composeLabel(feature: GisFeature, template: string): string {
  if (!template) return "";
  return template
    .replace(/\{([^}]+)\}/g, (_all, rawKey: string) => {
      const key = rawKey.trim();
      const builtin = builtinToken(feature, key.toUpperCase());
      if (builtin !== null) return builtin;
      const props = feature.properties ?? {};
      const hit = Object.keys(props).find((k) => k.toLowerCase() === key.toLowerCase());
      const value = hit ? props[hit] : undefined;
      return value === undefined || value === null ? "" : String(value);
    })
    .replace(/\s+·\s+·\s+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

export function labelFieldsFromTemplate(template: string): string[] {
  return Array.from(
    new Set(
      Array.from(template.matchAll(/\{([^}]+)\}/g))
        .map((match) => match[1]?.trim() ?? "")
        .filter(Boolean),
    ),
  );
}

export function buildLabelTemplate(fields: string[], separator = " · "): string {
  return fields
    .filter(Boolean)
    .map((field) => `{${field}}`)
    .join(separator);
}

function builtinToken(feature: GisFeature, key: string): string | null {
  const num = (n: number, digits = 2) =>
    n.toLocaleString(undefined, { maximumFractionDigits: digits });
  switch (key) {
    case "ACRES":
      return num(squareMeters(feature) * AREA_UNITS.acres.factor);
    case "SQFT":
      return num(squareMeters(feature) * AREA_UNITS.sqft.factor, 0);
    case "SQM":
      return num(squareMeters(feature), 0);
    case "HECTARES":
      return num(squareMeters(feature) * AREA_UNITS.hectares.factor);
    case "LENGTH_MI":
      return num(meters(feature) / 1609.344);
    case "LENGTH_FT":
      return num(meters(feature) * 3.280839895, 0);
    case "LAT": {
      const c = firstCoord(feature);
      return c ? c[1].toFixed(5) : "";
    }
    case "LON": {
      const c = firstCoord(feature);
      return c ? c[0].toFixed(5) : "";
    }
    default:
      return null;
  }
}

function firstCoord(feature: GisFeature): [number, number] | null {
  const walk = (c: unknown): [number, number] | null => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number")
      return [c[0], c[1]];
    if (Array.isArray(c)) {
      for (const x of c) {
        const r = walk(x);
        if (r) return r;
      }
    }
    return null;
  };
  const geom = feature.geometry as { coordinates?: unknown } | null;
  return geom && "coordinates" in geom ? walk(geom.coordinates) : null;
}

export function propertyKeys(features: GisFeature[]): string[] {
  const keys = new Set<string>();
  for (const f of features.slice(0, 200)) {
    for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  }
  return Array.from(keys);
}

export const LABEL_TOKENS = [
  "ACRES",
  "SQFT",
  "SQM",
  "HECTARES",
  "LENGTH_MI",
  "LENGTH_FT",
  "LAT",
  "LON",
];
