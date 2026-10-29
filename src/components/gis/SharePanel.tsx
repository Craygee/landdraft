import { NEW_SHARE_PERMISSIONS, type SharePermissions } from "@/lib/gis/sharePermissions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bbox as turfBbox } from "@turf/turf";
import {
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { useMapRef } from "@/lib/gis/mapRef";
import {
  scopedShareState,
  shareStore,
  shareUrl,
  type MapShare,
  type ShareLayerScope,
  type ShareMember,
  type ShareRole,
  type ShareSubmission,
} from "@/lib/gis/sharing";
import { useWorkbench } from "@/lib/gis/store";
import type { MapViewState } from "@/lib/gis/types";
import { cn } from "@/lib/utils";

interface SharingData {
  shares: MapShare[];
  members: ShareMember[];
  submissions: ShareSubmission[];
}

const emptyData: SharingData = { shares: [], members: [], submissions: [] };

const roleHelp: Record<ShareRole, string> = {
  viewer: "Can explore the shared map and attributes, but cannot change data.",
  editor: "Gets a separate editable copy that the map administrator can review.",
  admin: "Can directly edit the original project and manage sharing.",
};

const mapViewFrom = (map: ReturnType<typeof useMapRef>["map"], fallback: MapViewState) => {
  if (!map) return fallback;
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat] as [number, number],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
};

const shareViewForScope = (
  map: ReturnType<typeof useMapRef>["map"],
  fallback: MapViewState,
  scope: ShareLayerScope[],
  layers: ReturnType<typeof useWorkbench>["layers"],
): MapViewState => {
  if (!map) return fallback;
  const candidates = scope.flatMap((entry) => {
    const layer = layers.find((item) => item.id === entry.layerId);
    if (!layer || !layer.visible) return [];
    const selected = entry.featureIndexes ? new Set(entry.featureIndexes) : null;
    const features = selected
      ? layer.data.features.filter((_, index) => selected.has(index))
      : layer.data.features;
    if (!features.length) return [];
    try {
      const bounds = turfBbox({ type: "FeatureCollection", features } as never) as [
        number,
        number,
        number,
        number,
      ];
      if (!bounds.every(Number.isFinite)) return [];
      const width = Math.abs(bounds[2] - bounds[0]);
      const height = Math.abs(bounds[3] - bounds[1]);
      return [{ bounds, score: width * height || width + height || 1 }];
    } catch {
      return [];
    }
  });
  const largest = candidates.sort((a, b) => b.score - a.score)[0];
  if (!largest) return mapViewFrom(map, fallback);
  try {
    const camera = map.cameraForBounds(largest.bounds, { padding: 70, maxZoom: 16 });
    if (!camera?.center) return mapViewFrom(map, fallback);
    const center = Array.isArray(camera.center)
      ? camera.center
      : "lng" in camera.center
        ? [camera.center.lng, camera.center.lat]
        : [camera.center.lon, camera.center.lat];
    return {
      center: [Number(center[0]), Number(center[1])],
      zoom: camera.zoom ?? map.getZoom(),
      bearing: camera.bearing ?? map.getBearing(),
      pitch: map.getPitch(),
    };
  } catch {
    return mapViewFrom(map, fallback);
  }
};

const flattenedShareGroups = (
  groups: ReturnType<typeof useWorkbench>["groups"],
): Array<{ group: ReturnType<typeof useWorkbench>["groups"][number]; depth: number }> => {
  const result: Array<{
    group: ReturnType<typeof useWorkbench>["groups"][number];
    depth: number;
  }> = [];
  const visited = new Set<string>();
  const visit = (group: ReturnType<typeof useWorkbench>["groups"][number], depth: number) => {
    if (visited.has(group.id)) return;
    visited.add(group.id);
    result.push({ group, depth });
    groups.filter((item) => item.parentId === group.id).forEach((child) => visit(child, depth + 1));
  };
  groups
    .filter((group) => !group.parentId || !groups.some((item) => item.id === group.parentId))
    .forEach((group) => visit(group, 0));
  groups.filter((group) => !visited.has(group.id)).forEach((group) => visit(group, 0));
  return result;
};

const nestedShareGroupIds = (
  groupId: string,
  groups: ReturnType<typeof useWorkbench>["groups"],
) => {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    groups.forEach((group) => {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    });
  }
  return ids;
};

export function SharePanel({ onClose }: { onClose: () => void }) {
  const wb = useWorkbench();
  const auth = useAuth();
  const { map } = useMapRef();
  const [data, setData] = useState<SharingData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"create" | "shared">(wb.canEditProject ? "create" : "shared");
  const [shareName, setShareName] = useState(`${wb.projectName} shared map`);
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(wb.layers.map((layer) => [layer.id, layer.visible])),
  );
  const [selectedOnly, setSelectedOnly] = useState<Record<string, boolean>>({});
  const [managedShareId, setManagedShareId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<SharePermissions>({ ...NEW_SHARE_PERMISSIONS });
  const [managedPermissions, setManagedPermissions] = useState<SharePermissions>({
    ...NEW_SHARE_PERMISSIONS,
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ShareRole>("viewer");

  const refresh = useCallback(async () => {
    const userId = auth.user?.id;
    if (!userId) return;
    setLoading(true);
    try {
      const result = await shareStore.list(userId, auth.user?.email ?? "");
      setData(result);
      setManagedShareId(
        (current) => current ?? result.shares.find((s) => s.ownerId === userId)?.id ?? null,
      );
    } catch (error) {
      toast.error("Sharing could not load", {
        description: error instanceof Error ? error.message : "Try again shortly.",
      });
    } finally {
      setLoading(false);
    }
  }, [auth.user?.email, auth.user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedByLayer = useMemo(() => {
    const result = new Map<string, number[]>();
    for (const selection of wb.selectedFeatures) {
      const indexes = result.get(selection.layerId) ?? [];
      indexes.push(selection.index);
      result.set(selection.layerId, indexes);
    }
    return result;
  }, [wb.selectedFeatures]);
  const shareGroups = useMemo(() => flattenedShareGroups(wb.groups), [wb.groups]);

  const setGroupIncluded = (groupId: string, checked: boolean) => {
    const groupIds = nestedShareGroupIds(groupId, wb.groups);
    setIncluded((current) => ({
      ...current,
      ...Object.fromEntries(
        wb.layers
          .filter((layer) => groupIds.has(layer.groupId))
          .map((layer) => [layer.id, checked]),
      ),
    }));
  };

  const currentScope = (): ShareLayerScope[] =>
    wb.layers.flatMap((layer) => {
      if (!included[layer.id]) return [];
      const indexes = selectedByLayer.get(layer.id) ?? [];
      return [
        {
          layerId: layer.id,
          featureIndexes: selectedOnly[layer.id] && indexes.length ? indexes : null,
        },
      ];
    });

  const createShare = async () => {
    const userId = auth.user?.id;
    if (!userId) return;
    const scope = currentScope();
    if (!scope.length) {
      toast.error("Choose at least one layer to share");
      return;
    }
    setBusy(true);
    try {
      await wb.saveProject("manual");
      const mapView = shareViewForScope(map, wb.mapView, scope, wb.layers);
      const projectState = scopedShareState(
        wb.toProjectState(),
        wb.layers,
        scope,
        mapView,
        permissions,
      );
      const share = await shareStore.create({
        userId,
        projectId: wb.projectId,
        name: shareName.trim() || `${wb.projectName} shared map`,
        state: projectState,
        mapView,
        layerScope: scope,
        permissions,
      });
      await refresh();
      setManagedShareId(share.id);
      await navigator.clipboard.writeText(shareUrl(share.id));
      toast.success("Private share link created", {
        description:
          "Link copied. It grants no access by itself; new invitations default to View only.",
      });
    } catch (error) {
      toast.error("Shared map could not be created", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const updateShare = async (share: MapShare) => {
    if (share.projectId !== wb.projectId) {
      toast.error("Open the source project before updating its shared layers.");
      return;
    }
    const userId = auth.user?.id;
    if (!userId) return;
    const scope = currentScope();
    if (!scope.length) {
      toast.error("Choose at least one layer to share");
      return;
    }
    setBusy(true);
    try {
      const mapView = shareViewForScope(map, wb.mapView, scope, wb.layers);
      await shareStore.updateSnapshot({
        share,
        userId,
        state: scopedShareState(wb.toProjectState(), wb.layers, scope, mapView, managedPermissions),
        mapView,
        layerScope: scope,
        name: shareName,
        permissions: managedPermissions,
      });
      await refresh();
      toast.success("Shared map updated", {
        description: "Recipients will see this extent and selected content next time they open it.",
      });
    } catch (error) {
      toast.error("Shared map could not be updated", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const managedShare = data.shares.find((share) => share.id === managedShareId) ?? null;
  useEffect(() => {
    if (managedShare) setManagedPermissions(managedShare.permissions);
  }, [managedShare]);
  const savePermissions = async () => {
    if (!managedShare || !auth.user) return;
    setBusy(true);
    try {
      await shareStore.updatePermissions({
        share: managedShare,
        userId: auth.user.id,
        permissions: managedPermissions,
      });
      await refresh();
      toast.success("Sharing options saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sharing options could not be saved");
    } finally {
      setBusy(false);
    }
  };
  const managedMembers = data.members.filter((member) => member.shareId === managedShareId);
  const managedSubmissions = data.submissions.filter(
    (submission) => submission.shareId === managedShareId,
  );
  const incomingShares = data.shares.filter((share) => share.ownerId !== auth.user?.id);
  const createdShares = data.shares.filter((share) => share.ownerId === auth.user?.id);
  const currentSubmission = data.submissions.find(
    (submission) => submission.copyProjectId === wb.projectId,
  );

  const invite = async () => {
    if (!managedShare || !inviteEmail.trim()) return;
    const email = inviteEmail.trim();
    setBusy(true);
    try {
      const result = await shareStore.invite(managedShare.id, email, inviteRole);
      setInviteEmail("");
      await refresh();
      if (result.emailSent)
        toast.success("Invitation emailed", {
          description: `${email} received ${inviteRole} access and a secure LandDraft link.`,
        });
      else {
        await navigator.clipboard.writeText(shareUrl(managedShare.id)).catch(() => undefined);
        toast.warning("Access granted, but email was not sent", {
          description: `${result.warning ?? "Outbound email is temporarily unavailable"} The secure link was copied so you can send it directly.`,
          duration: 8_000,
        });
      }
    } catch (error) {
      toast.error("Person could not be added", {
        description: error instanceof Error ? error.message : "Check the email and try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-panel-height w-[min(94vw,520px)] overflow-y-auto p-3 text-xs">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Users className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Share maps</h2>
          <p className="text-[10px] text-muted-foreground">
            Private links · signed-in access · email invitations
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="rounded-lg p-2 hover:bg-accent"
          title="Refresh sharing"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </button>
        <button
          onClick={onClose}
          className="rounded-lg p-2 hover:bg-accent"
          aria-label="Close sharing"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 rounded-xl bg-secondary p-1">
        <Tab active={tab === "create"} onClick={() => setTab("create")} label="Share this map" />
        <Tab active={tab === "shared"} onClick={() => setTab("shared")} label="Shared maps" />
      </div>

      {tab === "create" ? (
        <div className="space-y-3">
          {!wb.canEditProject ? (
            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 font-semibold">
                <LockKeyhole className="size-4 text-primary" /> {wb.projectName}
                <RoleBadge role={wb.accessRole === "owner" ? "admin" : wb.accessRole} />
              </div>
              <p className="mt-2 text-muted-foreground">
                {wb.accessRole === "editor"
                  ? "Your edits are kept in a separate project so the original map remains protected."
                  : "This map is view only. You can inspect features, switch layers, print, and change the basemap."}
              </p>
              {wb.accessRole === "editor" && wb.activeShare && (
                <button
                  onClick={() =>
                    void wb.createSharedWorkingCopy().then(() => {
                      onClose();
                      toast.success("Editable copy opened");
                    })
                  }
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 font-semibold text-primary-foreground"
                >
                  <Copy className="size-3.5" /> Open my editable copy
                </button>
              )}
            </div>
          ) : (
            <>
              <section className="space-y-2 rounded-xl border border-border p-3">
                <label className="block font-semibold" htmlFor="share-name">
                  Shared map name
                </label>
                <input
                  id="share-name"
                  value={shareName}
                  onChange={(event) => setShareName(event.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-2 py-2 outline-none focus:border-primary"
                />
                <p className="text-[10px] text-muted-foreground">
                  The current map extent, zoom, basemap, styles, and visible state are captured.
                </p>
              </section>

              <section className="rounded-xl border border-border">
                <div className="flex items-center border-b border-border px-3 py-2 font-semibold">
                  Layers and features
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                    {Object.values(included).filter(Boolean).length} included
                  </span>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto p-2">
                  {shareGroups.map(({ group, depth }) => {
                    const nestedIds = nestedShareGroupIds(group.id, wb.groups);
                    const groupedLayers = wb.layers.filter((layer) => nestedIds.has(layer.groupId));
                    const includedCount = groupedLayers.filter(
                      (layer) => included[layer.id],
                    ).length;
                    return (
                      <div key={group.id}>
                        <label
                          className="flex items-center gap-1.5 rounded-lg bg-accent/50 px-2 py-1.5 font-semibold"
                          style={{ marginLeft: depth * 12 }}
                        >
                          <input
                            type="checkbox"
                            checked={
                              groupedLayers.length > 0 && includedCount === groupedLayers.length
                            }
                            ref={(input) => {
                              if (input)
                                input.indeterminate =
                                  includedCount > 0 && includedCount < groupedLayers.length;
                            }}
                            onChange={(event) => setGroupIncluded(group.id, event.target.checked)}
                            className="accent-primary"
                          />
                          <ChevronRight className="size-3 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{group.name}</span>
                          <span className="num text-[9px] text-muted-foreground">
                            {includedCount}/{groupedLayers.length}
                          </span>
                        </label>
                        <div className="mt-1 space-y-1" style={{ marginLeft: depth * 12 + 18 }}>
                          {wb.layers
                            .filter((layer) => layer.groupId === group.id)
                            .map((layer) => {
                              const selectedCount = selectedByLayer.get(layer.id)?.length ?? 0;
                              return (
                                <div key={layer.id} className="rounded-lg bg-secondary p-2">
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(included[layer.id])}
                                      onChange={(event) =>
                                        setIncluded((current) => ({
                                          ...current,
                                          [layer.id]: event.target.checked,
                                        }))
                                      }
                                      className="accent-primary"
                                    />
                                    <span
                                      className="size-2.5 rounded-full"
                                      style={{ background: layer.style.fillColor }}
                                    />
                                    <span className="min-w-0 flex-1 truncate font-medium">
                                      {layer.name}
                                    </span>
                                    <span className="num text-[10px] text-muted-foreground">
                                      {layer.data.features.length.toLocaleString()}
                                    </span>
                                  </label>
                                  {selectedCount > 0 && included[layer.id] && (
                                    <label className="mt-1.5 flex items-center gap-2 pl-5 text-[10px] text-muted-foreground">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(selectedOnly[layer.id])}
                                        onChange={(event) =>
                                          setSelectedOnly((current) => ({
                                            ...current,
                                            [layer.id]: event.target.checked,
                                          }))
                                        }
                                        className="accent-primary"
                                      />
                                      Share only the {selectedCount} selected feature
                                      {selectedCount === 1 ? "" : "s"}
                                    </label>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <SharingOptions value={permissions} onChange={setPermissions} />
              <button
                onClick={() => void createShare()}
                disabled={busy}
                title="Create a private link. Add people afterward; new invitations default to View only."
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Create private share link
              </button>
              <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
                The link alone grants no access. Add people below; invitations default to View only,
                with optional Editor copy or Admin access.
              </p>
            </>
          )}

          {wb.shareSource && currentSubmission && (
            <section className="rounded-xl border border-primary/30 bg-accent/40 p-3">
              <h3 className="font-semibold">Working copy for {wb.shareSource.sourceName}</h3>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Your changes stay in this project. Submit it when it is ready for the map
                administrator.
              </p>
              <button
                onClick={() =>
                  void wb.saveProject("manual").then(async () => {
                    await shareStore.updateSubmission(currentSubmission.id, "submitted");
                    await refresh();
                    toast.success("Map submitted for review");
                  })
                }
                className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground"
              >
                <Send className="size-3.5" /> Submit latest changes
              </button>
            </section>
          )}

          {createdShares.length > 0 && (
            <section className="rounded-xl border border-border">
              <div className="border-b border-border px-3 py-2 font-semibold">
                Manage shared maps
              </div>
              <div className="space-y-1 p-2">
                {createdShares.map((share) => (
                  <button
                    key={share.id}
                    onClick={() => {
                      setManagedShareId(share.id);
                      setShareName(share.name);
                      setIncluded(
                        Object.fromEntries(
                          wb.layers.map((layer) => [
                            layer.id,
                            share.layerScope.some((entry) => entry.layerId === layer.id),
                          ]),
                        ),
                      );
                      setSelectedOnly(
                        Object.fromEntries(
                          share.layerScope.map((entry) => [
                            entry.layerId,
                            Boolean(entry.featureIndexes),
                          ]),
                        ),
                      );
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent",
                      share.id === managedShareId && "bg-secondary ring-1 ring-primary",
                    )}
                  >
                    <Eye className="size-3.5 text-primary" />
                    <span className="min-w-0 flex-1 truncate font-medium">{share.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {data.members.filter((member) => member.shareId === share.id).length} people
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {managedShare && (
            <section className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate font-semibold">{managedShare.name}</h3>
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(shareUrl(managedShare.id))
                      .then(() => toast.success("Share link copied"))
                  }
                  className="rounded-lg p-2 hover:bg-accent"
                  title="Copy secure link"
                >
                  <Clipboard className="size-3.5" />
                </button>
                <button
                  onClick={() => void updateShare(managedShare)}
                  className="rounded-lg p-2 hover:bg-accent"
                  title="Update shared content and map extent"
                >
                  <RefreshCw className="size-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm(`Remove “${managedShare.name}” and all access?`)) return;
                    void shareStore.removeShare(managedShare).then(async () => {
                      setManagedShareId(null);
                      await refresh();
                      toast.success("Shared map removed");
                    });
                  }}
                  className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                  title="Remove shared map"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <SharingOptions value={managedPermissions} onChange={setManagedPermissions} />
              <button
                disabled={busy}
                onClick={() => void savePermissions()}
                className="w-full rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
              >
                Save sharing options
              </button>
              <p className="text-[10px] text-muted-foreground">
                Applies to recipients of this shared map. Saving updates permission settings and
                included notes; existing shared feature geometry stays unchanged. Owners and
                administrators retain full access.
              </p>
              <div className="grid grid-cols-[1fr_105px_auto] gap-1">
                <input
                  type="email"
                  autoComplete="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="Email address"
                  className="min-w-0 rounded-lg border border-border bg-card px-2 py-2"
                />
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as ShareRole)}
                  className="rounded-lg border border-border bg-card px-2"
                >
                  <option value="viewer">View only</option>
                  <option value="editor">Editor copy</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => void invite()}
                  className="rounded-lg bg-primary px-2 text-primary-foreground"
                  title="Grant access and email a secure invitation"
                  aria-label="Grant access and send invitation email"
                >
                  <UserPlus className="size-4" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">{roleHelp[inviteRole]}</p>

              <div className="space-y-1">
                {managedMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-lg bg-secondary p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{member.email}</div>
                      <div className="text-[9px] text-muted-foreground">
                        {member.acceptedAt ? "Access active" : "Invited · account required"}
                      </div>
                    </div>
                    <select
                      value={member.role}
                      onChange={(event) =>
                        void shareStore
                          .updateMember(member.id, event.target.value as ShareRole)
                          .then(refresh)
                      }
                      className="rounded-lg border border-border bg-card px-2 py-1"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void shareStore
                          .invite(managedShare.id, member.email, member.role)
                          .then((result) => {
                            if (result.emailSent)
                              toast.success("Invitation email resent", {
                                description: `Sent to ${member.email}.`,
                              });
                            else
                              toast.warning("Email was not sent", {
                                description:
                                  result.warning ?? "Outbound email is temporarily unavailable.",
                              });
                          })
                          .catch((error: unknown) =>
                            toast.error("Invitation could not be resent", {
                              description:
                                error instanceof Error ? error.message : "Try again shortly.",
                            }),
                          )
                          .finally(() => setBusy(false));
                      }}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      title="Resend invitation email"
                      aria-label={`Resend invitation email to ${member.email}`}
                    >
                      <Send className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void shareStore.removeMember(member.id).then(refresh)}
                      className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10"
                      title="Remove access"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {managedSubmissions.length > 0 && (
                <div className="border-t border-border pt-3">
                  <h3 className="mb-1 font-semibold">Editor copies to review</h3>
                  <div className="space-y-1">
                    {managedSubmissions.map((submission) => (
                      <div
                        key={submission.id}
                        className="flex items-center gap-2 rounded-lg bg-secondary p-2"
                      >
                        <span className="min-w-0 flex-1">
                          <strong className="block capitalize">{submission.status}</strong>
                          <span className="text-[9px] text-muted-foreground">
                            Updated {new Date(submission.updatedAt).toLocaleString()}
                          </span>
                        </span>
                        <button
                          onClick={() =>
                            void wb.openReviewProject(submission.copyProjectId).then(onClose)
                          }
                          className="flex items-center gap-1 rounded-lg bg-card px-2 py-1.5 font-medium"
                        >
                          <ExternalLink className="size-3" /> Review
                        </button>
                        {submission.status === "submitted" && (
                          <button
                            onClick={() =>
                              void shareStore
                                .updateSubmission(submission.id, "reviewed")
                                .then(refresh)
                            }
                            className="rounded-lg p-1.5 text-primary hover:bg-card"
                            title="Mark reviewed"
                          >
                            <Check className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      ) : (
        <SharedList
          loading={loading}
          shares={incomingShares}
          onOpen={(share) => void wb.openSharedMap(share.id).then(onClose)}
        />
      )}
    </div>
  );
}

export function SharedMapSwitcher() {
  const wb = useWorkbench();
  const auth = useAuth();
  const [shares, setShares] = useState<MapShare[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userId = auth.user?.id;
    if (!userId) return;
    void shareStore
      .list(userId, auth.user?.email ?? "")
      .then((result) => setShares(result.shares.filter((share) => share.ownerId !== userId)))
      .finally(() => setLoading(false));
  }, [auth.user?.email, auth.user?.id]);

  return (
    <div className="border-b border-sidebar-border p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Users className="size-3.5 text-primary" /> Shared maps
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading access…
        </div>
      ) : shares.length ? (
        <div className="space-y-1">
          {shares.map((share) => (
            <button
              key={share.id}
              onClick={() => void wb.openSharedMap(share.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent",
                wb.activeShare?.id === share.id && "bg-sidebar-accent ring-1 ring-primary",
              )}
            >
              <Eye className="size-3.5 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium">{share.name}</span>
              <RoleBadge role={share.role} />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          No maps have been shared with this account.
        </p>
      )}
    </div>
  );
}

function SharedList({
  loading,
  shares,
  onOpen,
}: {
  loading: boolean;
  shares: MapShare[];
  onOpen: (share: MapShare) => void;
}) {
  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading shared maps…
      </div>
    );
  if (!shares.length)
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
        No maps have been shared with this account yet.
      </div>
    );
  return (
    <div className="space-y-2">
      {shares.map((share) => (
        <button
          key={share.id}
          onClick={() => onOpen(share)}
          className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-primary hover:bg-accent"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-secondary">
            <Eye className="size-4 text-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate">{share.name}</strong>
            <span className="text-[10px] text-muted-foreground">
              Updated {new Date(share.updatedAt).toLocaleString()}
            </span>
          </span>
          <RoleBadge role={share.role} />
        </button>
      ))}
    </div>
  );
}

function RoleBadge({ role }: { role: ShareRole }) {
  return (
    <span className="rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold capitalize text-accent-foreground">
      {role === "viewer" ? "view" : role}
    </span>
  );
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg px-2 py-1.5 font-medium",
        active ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SharingOptions({
  value,
  onChange,
}: {
  value: SharePermissions;
  onChange: (value: SharePermissions) => void;
}) {
  return (
    <section
      className="space-y-2 rounded-xl border border-border p-3"
      aria-label="Shared map permissions"
    >
      <h3 className="font-semibold">Recipient permissions</h3>
      <label className="flex min-h-9 items-center gap-2">
        <input
          type="checkbox"
          checked={value.allowExport}
          onChange={(e) => onChange({ ...value, allowExport: e.target.checked })}
        />
        Allow export of active layers
      </label>
      <label className="flex min-h-9 items-center gap-2">
        <input
          type="checkbox"
          checked={value.allowNotes}
          onChange={(e) => onChange({ ...value, allowNotes: e.target.checked })}
        />
        Allow viewing project and shared-layer notes
      </label>
      <p className="text-[10px] text-muted-foreground">
        Viewers cannot draw, use AI or map search, or download a project backup. Notes are read only
        for viewers. Map printing remains available.
      </p>
    </section>
  );
}
