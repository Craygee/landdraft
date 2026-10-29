import type { GisLayer, LayerGroup } from "./types";

type Layer = Pick<GisLayer, "id" | "groupId">;
/** Include nested containers and groups, regardless of visibility or collapse state. */
export function layerTreeIds(id: string, layers: Layer[], groups: LayerGroup[]): string[] {
  if (!layers.some((layer) => layer.id === id)) return [];
  const layerIds = new Set([id]);
  const groupIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (
        !groupIds.has(group.id) &&
        ((group.containerLayerId && layerIds.has(group.containerLayerId)) ||
          (group.parentId && groupIds.has(group.parentId)))
      ) {
        groupIds.add(group.id);
        changed = true;
      }
    }
    for (const layer of layers) {
      if (!layerIds.has(layer.id) && groupIds.has(layer.groupId)) {
        layerIds.add(layer.id);
        changed = true;
      }
    }
  }
  return [
    id,
    ...layers.filter((layer) => layer.id !== id && layerIds.has(layer.id)).map((layer) => layer.id),
  ];
}

export function toggleLayerTreeSelection(
  id: string,
  additive: boolean,
  selected: string[],
  layers: Layer[],
  groups: LayerGroup[],
): string[] {
  const ids = layerTreeIds(id, layers, groups);
  if (!ids.length) return selected;
  if (!additive) return ids;
  const set = new Set(selected);
  if (ids.every((item) => set.has(item))) ids.forEach((item) => set.delete(item));
  else ids.forEach((item) => set.add(item));
  return [...set];
}
