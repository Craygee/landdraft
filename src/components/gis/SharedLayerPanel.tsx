import { useState, type ReactNode } from "react";
import { bbox as turfBbox } from "@turf/turf";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, LocateFixed, Table2 } from "lucide-react";

import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { SharedMapSwitcher } from "./SharePanel";

export function SharedLayerPanel() {
  const wb = useWorkbench();
  const { map, setTableOpen, setRecordsOpen } = useMapRef();
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(
    () =>
      new Set(
        wb.groups.flatMap((group) => (group.containerLayerId ? [group.containerLayerId] : [])),
      ),
  );

  const zoomTo = (layerId: string) => {
    const layer = wb.layers.find((item) => item.id === layerId);
    if (!map || !layer?.data.features.length) return;
    const bounds = turfBbox(layer.data as never) as [number, number, number, number];
    if (bounds.every(Number.isFinite)) map.fitBounds(bounds, { padding: 60, maxZoom: 17 });
  };

  const groupLayerIds = (groupId: string) => {
    const groupIds = new Set([groupId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of wb.groups) {
        if (group.parentId && groupIds.has(group.parentId) && !groupIds.has(group.id)) {
          groupIds.add(group.id);
          changed = true;
        }
      }
    }
    return wb.layers.filter((layer) => groupIds.has(layer.groupId));
  };

  const renderLayer = (layerId: string, depth: number): ReactNode => {
    const layer = wb.layers.find((item) => item.id === layerId);
    if (!layer) return null;
    const container = wb.groups.find((group) => group.containerLayerId === layer.id);
    const expanded = expandedLayers.has(layer.id);
    return (
      <div key={layer.id} style={{ marginLeft: depth * 10 }}>
        <div className="flex items-center gap-1 rounded-lg bg-card p-1.5">
          {container ? (
            <button
              type="button"
              onClick={() =>
                setExpandedLayers((current) => {
                  const next = new Set(current);
                  if (next.has(layer.id)) next.delete(layer.id);
                  else next.add(layer.id);
                  return next;
                })
              }
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              aria-label={expanded ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <button
            onClick={() => wb.toggleVisible(layer.id)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            title={layer.visible ? "Hide layer" : "Show layer"}
          >
            {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
          <span
            className="size-3 rounded-full border border-black/10"
            style={{ background: layer.style.fillColor }}
          />
          <button
            onClick={() => wb.setActiveLayer(layer.id)}
            className="min-w-0 flex-1 px-1 py-1 text-left"
          >
            <span className="block truncate text-xs font-medium">{layer.name}</span>
            <span className="num block text-[9px] text-muted-foreground">
              {layer.data.features.length.toLocaleString()} features
            </span>
          </button>
          {container && <Layers className="size-3.5 shrink-0 text-primary" />}
          <button
            onClick={() => zoomTo(layer.id)}
            className="rounded-md p-1.5 hover:bg-accent"
            title="Zoom to layer"
          >
            <LocateFixed className="size-3.5" />
          </button>
          <button
            onClick={() => {
              wb.setActiveLayer(layer.id);
              setTableOpen(true);
            }}
            className="rounded-md p-1.5 hover:bg-accent"
            title="View attributes"
          >
            <Table2 className="size-3.5" />
          </button>
        </div>
        {container && expanded && (
          <div className="mt-1 space-y-1 border-l border-primary/25 pl-1">
            {wb.layers
              .filter((item) => item.groupId === container.id)
              .map((item) => renderLayer(item.id, depth + 1))}
            {wb.groups
              .filter((group) => group.parentId === container.id && !group.containerLayerId)
              .map((group) => renderGroup(group.id, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderGroup = (groupId: string, depth: number): ReactNode => {
    const group = wb.groups.find((item) => item.id === groupId);
    if (!group || group.containerLayerId) return null;
    const layers = groupLayerIds(group.id);
    return (
      <section
        key={group.id}
        style={{ marginLeft: depth * 10 }}
        className="rounded-xl border border-sidebar-border"
      >
        <button
          onClick={() => wb.toggleGroup(group.id)}
          className="flex w-full items-center gap-1 px-2 py-2 text-left text-xs font-semibold"
        >
          {group.collapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
          <span className="text-[10px] font-normal text-muted-foreground">{layers.length}</span>
        </button>
        {!group.collapsed && (
          <div className="space-y-1 border-t border-sidebar-border p-1.5">
            {wb.layers
              .filter((layer) => layer.groupId === group.id)
              .map((layer) => renderLayer(layer.id, 0))}
            {wb.groups
              .filter((child) => child.parentId === group.id && !child.containerLayerId)
              .map((child) => renderGroup(child.id, 1))}
          </div>
        )}
      </section>
    );
  };

  const rootGroups = wb.groups.filter(
    (group) =>
      !group.containerLayerId &&
      (!group.parentId || !wb.groups.some((candidate) => candidate.id === group.parentId)),
  );

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <SharedMapSwitcher />
      <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-3 text-sm font-semibold">
        <Layers className="size-4 text-primary" /> {wb.projectName}
        <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold uppercase text-accent-foreground">
          {wb.accessRole === "viewer" ? "view only" : wb.accessRole}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-2">{rootGroups.map((group) => renderGroup(group.id, 0))}</div>
      </div>
      {wb.canViewNotes && (
        <button
          className="mx-3 mb-2 rounded-xl bg-secondary px-3 py-2 text-left text-xs font-semibold"
          onClick={() => setRecordsOpen(true)}
        >
          View project & layer notes
        </button>
      )}
      <div className="border-t border-sidebar-border p-3 text-[9px] leading-relaxed text-muted-foreground">
        Shared map access is limited to the layers and features selected by its administrator.
      </div>
    </div>
  );
}
