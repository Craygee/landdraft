export function layerOpacity(style: { opacity?: number }): number {
  return typeof style.opacity === "number" && Number.isFinite(style.opacity)
    ? Math.max(0, Math.min(1, style.opacity))
    : 1;
}
