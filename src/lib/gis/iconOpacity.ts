/** Independent point-symbol opacity. Missing values preserve existing projects. */
export function pointSymbolOpacity(style: { pointIconOpacity?: number }): number {
  const value = style.pointIconOpacity;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}
