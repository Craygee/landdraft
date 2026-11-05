import type { CategoryStyleRule } from "./types";

/** One application-wide palette for pipeline commodities. */
export const PIPELINE_COMMODITY_COLORS = {
  naturalGas: "#f59e0b",
  crudeOil: "#374151",
  highlyVolatileLiquid: "#db2777",
  refinedProduct: "#2563eb",
  carbonDioxide: "#16a34a",
  anhydrousAmmonia: "#7c3aed",
  hydrogen: "#0891b2",
  producedWater: "#0f766e",
  otherGas: "#a16207",
  unknown: "#9ca3af",
} as const;

const rule = (value: string, label: string, color: string): CategoryStyleRule => ({
  value,
  label,
  color,
  visible: true,
});

/** Values currently published by the official Texas RRC COMMODITY field. */
export const TEXAS_RRC_COMMODITY_RULES: CategoryStyleRule[] = [
  rule("NATURAL GAS", "Natural gas", PIPELINE_COMMODITY_COLORS.naturalGas),
  rule("NATURAL GAS FWS", "Natural gas full well stream", PIPELINE_COMMODITY_COLORS.naturalGas),
  rule("NATURAL GAS OFFSHORE", "Natural gas offshore", PIPELINE_COMMODITY_COLORS.naturalGas),
  rule("OTHER GAS", "Other gas", PIPELINE_COMMODITY_COLORS.otherGas),
  rule("CRUDE OIL", "Crude oil", PIPELINE_COMMODITY_COLORS.crudeOil),
  rule("CRUDE OIL OFFSHORE", "Crude oil offshore", PIPELINE_COMMODITY_COLORS.crudeOil),
  rule("CRUDE FWS", "Crude full well stream", PIPELINE_COMMODITY_COLORS.crudeOil),
  rule(
    "HIGHLY VOLATILE LIQUID",
    "Highly volatile liquid",
    PIPELINE_COMMODITY_COLORS.highlyVolatileLiquid,
  ),
  rule(
    "HIGHLY VOLATILE LIQUID (HVL)",
    "Highly volatile liquid (HVL)",
    PIPELINE_COMMODITY_COLORS.highlyVolatileLiquid,
  ),
  rule(
    "REFINED LIQUID PRODUCT",
    "Refined liquid product",
    PIPELINE_COMMODITY_COLORS.refinedProduct,
  ),
  rule("CARBON DIOXIDE", "Carbon dioxide", PIPELINE_COMMODITY_COLORS.carbonDioxide),
  rule("ANHYDROUS AMMONIA", "Anhydrous ammonia", PIPELINE_COMMODITY_COLORS.anhydrousAmmonia),
  rule("HYDROGEN", "Hydrogen", PIPELINE_COMMODITY_COLORS.hydrogen),
  rule("PRODUCED WATER", "Produced water", PIPELINE_COMMODITY_COLORS.producedWater),
  rule("0", "Unspecified", PIPELINE_COMMODITY_COLORS.unknown),
];

export function pipelineCommodityColor(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return (
    TEXAS_RRC_COMMODITY_RULES.find((candidate) => candidate.value === normalized)?.color ??
    PIPELINE_COMMODITY_COLORS.unknown
  );
}
