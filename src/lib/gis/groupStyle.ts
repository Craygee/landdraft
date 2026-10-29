import type { GisLayer, LayerGroup, LayerStyle } from "./types";

/** Patch only edited properties while preserving each child's label content and source. */
export function applyGroupStyle(
  layers: GisLayer[],
  groups: LayerGroup[],
  groupId: string,
  patch: Partial<LayerStyle>,
): GisLayer[] {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (!ids.has(group.id) && group.parentId && ids.has(group.parentId)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return layers.map((layer) => {
    if (!ids.has(layer.groupId)) return layer;
    const style = { ...layer.style, ...patch };
    // Keep a valid per-layer zoom interval when only one end is edited in bulk.
    if (patch.labelMinZoom !== undefined && style.labelMaxZoom <= style.labelMinZoom)
      style.labelMaxZoom = Math.min(24, style.labelMinZoom + 1);
    if (patch.labelMaxZoom !== undefined && style.labelMinZoom >= style.labelMaxZoom)
      style.labelMinZoom = Math.max(0, style.labelMaxZoom - 1);
    return { ...layer, style };
  });
}
