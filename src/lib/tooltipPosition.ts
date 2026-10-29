export function tooltipPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number },
) {
  const edge = 12;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, Math.max(min, max)));
  const below = anchor.bottom + 10;
  const above = anchor.top - 10 - size.height;
  return {
    x: clamp(
      (anchor.left + anchor.right - size.width) / 2,
      viewport.left + edge,
      viewport.left + viewport.width - size.width - edge,
    ),
    y: clamp(
      below + size.height <= viewport.top + viewport.height - edge ? below : above,
      viewport.top + edge,
      viewport.top + viewport.height - size.height - edge,
    ),
  };
}
