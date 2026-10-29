import type { GisLayer, LayerGroup } from "./types";

export type PrintLegendRow = { name: string; layerIndex: number | null; id: string };
/** Group only included legend entries; retain layer order within each group. */
export function printLegendRows(
  layers: Pick<GisLayer, "id" | "groupId" | "name">[],
  names: string[],
  groups: LayerGroup[],
  grouped: boolean,
): PrintLegendRow[] {
  const layerRow = (index: number): PrintLegendRow => ({
    id: layers[index]!.id,
    name: names[index] ?? layers[index]!.name,
    layerIndex: index,
  });
  if (!grouped) return layers.map((_, index) => layerRow(index));
  const buckets = new Map<string, number[]>();
  layers.forEach((layer, index) => {
    const bucket = buckets.get(layer.groupId) ?? [];
    bucket.push(index);
    buckets.set(layer.groupId, bucket);
  });
  const path = (id: string) => {
    const labels: string[] = [],
      seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const group = groups.find((item) => item.id === id);
      if (!group) break;
      labels.unshift(group.name);
      id = group.parentId ?? "";
    }
    return labels.join(" / ") || "Ungrouped layers";
  };
  return Array.from(buckets, ([id, indices]) => [
    { id: `group:${id}`, name: path(id), layerIndex: null },
    ...indices.map(layerRow),
  ]).flat();
}
