import type { ProjectState } from "./types.ts";
import { emptyProjectRecords } from "./types.ts";
export interface SharePermissions {
  allowExport: boolean;
  allowNotes: boolean;
}
export const NEW_SHARE_PERMISSIONS: SharePermissions = { allowExport: true, allowNotes: false };
/** Existing links retain their previous note access until the owner changes the options. */
export function sharePermissions(value: unknown): SharePermissions {
  const input = (value && typeof value === "object" ? value : {}) as Partial<SharePermissions>;
  return { allowExport: input.allowExport !== false, allowNotes: input.allowNotes !== false };
}
export function sharedCapabilities(role: string, permissions?: SharePermissions) {
  const edit = role === "owner" || role === "admin";
  const policy = sharePermissions(permissions);
  return {
    canEditProject: edit,
    canExportLayers: edit || policy.allowExport,
    canViewNotes: edit || policy.allowNotes,
    canUseAi: edit,
    canSearchMap: edit,
    canBackupProject: edit,
  };
}
/** Strip hidden notes before upload, not just from the recipient's UI. Never mutate the owner state. */
export function applySharePermissions(
  state: ProjectState,
  permissions: SharePermissions,
): ProjectState {
  const result = structuredClone(state);
  const ids = new Set(result.layers.map((l) => l.id));
  result.assistant = { messages: [], actions: [] };
  const records = state.records ?? emptyProjectRecords();
  result.records = {
    ...emptyProjectRecords(),
    notes: permissions.allowNotes ? structuredClone(records.notes ?? []) : [],
    layerNotes: permissions.allowNotes
      ? structuredClone((records.layerNotes ?? []).filter((n) => ids.has(n.layerId)))
      : [],
    summary: permissions.allowNotes ? (records.summary ?? "") : "",
  };
  for (const layer of result.layers) {
    if (!permissions.allowNotes) {
      delete layer.note;
      delete layer.noteUpdatedAt;
    }
    layer.data.features = layer.data.features.filter((feature) => {
      const props = feature.properties ?? {};
      const isNote =
        (layer.source.kind === "draw" && layer.source.purpose === "map-notes") ||
        Boolean(props["NOTE_ID"] && props["NOTE_SCOPE"]);
      if (!isNote) return true;
      if (!permissions.allowNotes) return false;
      const associated = props["ASSOCIATED_LAYER_ID"];
      return !associated || ids.has(String(associated));
    });
  }
  // Saved print annotations may contain note copies outside the selected sharing scope.
  delete result.printComposition;

  return result;
}

/** Recheck notes using the source project, but retain the exact feature snapshot and scoped indexes already shared. */
export function refreshSharedNotes(
  snapshot: ProjectState,
  source: ProjectState,
  scope: readonly { layerId: string; featureIndexes: number[] | null }[],
  permissions: SharePermissions,
): ProjectState {
  const layers = snapshot.layers.map((layer) => {
    const original = source.layers.find((l) => l.id === layer.id);
    const { note: _note, noteUpdatedAt: _time, ...base } = layer;
    if (!original) return base;
    const item = scope.find((s) => s.layerId === layer.id);
    const indexes = item?.featureIndexes ? new Set(item.featureIndexes) : null;
    return {
      ...base,
      ...(original.note !== undefined ? { note: original.note } : {}),
      ...(original.source.kind === "draw" && original.source.purpose === "map-notes"
        ? {
            data: {
              type: "FeatureCollection" as const,
              features: original.data.features.filter((_, index) => !indexes || indexes.has(index)),
            },
          }
        : {}),
    };
  });
  return applySharePermissions(
    { ...snapshot, ...(source.records ? { records: source.records } : {}), layers },
    permissions,
  );
}
