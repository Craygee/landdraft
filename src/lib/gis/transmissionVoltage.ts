import type { CategoryStyleRule } from "./types.ts";

/**
 * One nationwide transmission-voltage palette shared by shipped defaults.
 * Exact source values are retained for MapLibre's attribute matcher while
 * colors are assigned from stable engineering voltage bands.
 */
export const TRANSMISSION_VOLTAGE_COLORS = {
  unknown: "#6b7280",
  under100: "#38bdf8",
  from100To161: "#0284c7",
  from162To287: "#7c3aed",
  from288To449: "#f59e0b",
  from450To734: "#dc2626",
  from735: "#7f1d1d",
} as const;

/** Values currently published by the official EIA transmission service. */
export const EIA_TRANSMISSION_VOLTAGES_KV = [
  -999999, 3, 7.5, 13.8, 23, 24.9, 25, 33, 34, 34.5, 35, 38, 40, 41.6, 41.8, 43.8, 45, 46, 49, 50,
  53, 55, 57, 57.1, 60, 66, 69, 70, 72, 88, 89, 92, 100, 110, 114, 115, 120, 128, 130, 132, 134,
  135, 138, 161, 167, 169, 200, 218, 220, 230, 232, 236, 238, 240, 245, 250, 273, 275, 287, 345,
  348, 400, 450, 500, 765, 1000,
] as const;

export function transmissionVoltageColor(voltage: number | string | null | undefined): string {
  if (voltage === null || voltage === undefined || voltage === "") {
    return TRANSMISSION_VOLTAGE_COLORS.unknown;
  }
  const numeric = typeof voltage === "number" ? voltage : Number(voltage);
  if (!Number.isFinite(numeric) || numeric < 0) return TRANSMISSION_VOLTAGE_COLORS.unknown;
  if (numeric < 100) return TRANSMISSION_VOLTAGE_COLORS.under100;
  if (numeric <= 161) return TRANSMISSION_VOLTAGE_COLORS.from100To161;
  if (numeric <= 287) return TRANSMISSION_VOLTAGE_COLORS.from162To287;
  if (numeric <= 449) return TRANSMISSION_VOLTAGE_COLORS.from288To449;
  if (numeric <= 734) return TRANSMISSION_VOLTAGE_COLORS.from450To734;
  return TRANSMISSION_VOLTAGE_COLORS.from735;
}

export const EIA_TRANSMISSION_VOLTAGE_RULES: CategoryStyleRule[] = EIA_TRANSMISSION_VOLTAGES_KV.map(
  (voltage) => ({
    value: String(voltage),
    label: voltage < 0 ? "Voltage unavailable" : `${voltage} kV`,
    color: transmissionVoltageColor(voltage),
    visible: true,
  }),
);
