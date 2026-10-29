import { pipelineUnits } from "@/lib/pipeline/model";

/** Engineering station notation in feet, e.g. 1,234 ft -> "12+34". */
export function formatStation(distanceM: number) {
  const feet = Math.round(Math.max(0, distanceM * pipelineUnits.mToFt));
  return `${Math.floor(feet / 100)}+${(feet % 100).toString().padStart(2, "0")}`;
}

export function money(value: number | null, currency = "USD") {
  if (value === null) return "Not calculated";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
