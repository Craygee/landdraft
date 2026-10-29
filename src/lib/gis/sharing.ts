import {
  applySharePermissions,
  refreshSharedNotes,
  sharePermissions,
  NEW_SHARE_PERMISSIONS,
  type SharePermissions,
} from "./sharePermissions";
import {
  cloudConfigured,
  cloudDataRequest,
  cloudFunctionRequest,
  deletePrivateProjectFiles,
  downloadPrivateProjectFile,
  uploadPrivateProjectFile,
} from "@/lib/cloud";
import { workspaceProjectStore } from "./project";
import type { GisLayer, MapViewState, ProjectState } from "./types";

export type ShareRole = "viewer" | "editor" | "admin";

export interface ShareLayerScope {
  layerId: string;
  featureIndexes: number[] | null;
}

export interface MapShare {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  statePath: string;
  mapView: MapViewState;
  layerScope: ShareLayerScope[];
  active: boolean;
  role: ShareRole;
  permissions: SharePermissions;
  createdAt: number;
  updatedAt: number;
}

export interface ShareMember {
  id: string;
  shareId: string;
  userId: string | null;
  email: string;
  role: ShareRole;
  active: boolean;
  acceptedAt: number | null;
}

export interface ShareInvitationResult {
  member: ShareMember;
  emailSent: boolean;
  messageId?: string;
  warning?: string;
}

export interface ShareSubmission {
  id: string;
  shareId: string;
  sourceProjectId: string;
  copyProjectId: string;
  submittedBy: string;
  status: "draft" | "submitted" | "reviewed" | "archived";
  note: string;
  createdAt: number;
  updatedAt: number;
}

interface ShareRow {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  state_path: string;
  map_view: MapViewState & { sharePermissions?: SharePermissions };
  layer_scope: ShareLayerScope[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  share_id: string;
  user_id: string | null;
  invited_email: string;
  role: ShareRole;
  active: boolean;
  accepted_at: string | null;
}

interface SubmissionRow {
  id: string;
  share_id: string;
  source_project_id: string;
  copy_project_id: string;
  submitted_by: string;
  status: ShareSubmission["status"];
  note: string;
  created_at: string;
  updated_at: string;
}

const SHARE_SELECT =
  "id,project_id,owner_id,name,state_path,map_view,layer_scope,active,created_at,updated_at";
const MEMBER_SELECT = "id,share_id,user_id,invited_email,role,active,accepted_at";
const SUBMISSION_SELECT =
  "id,share_id,source_project_id,copy_project_id,submitted_by,status,note,created_at,updated_at";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const mapMember = (row: MemberRow): ShareMember => ({
  id: row.id,
  shareId: row.share_id,
  userId: row.user_id,
  email: row.invited_email,
  role: row.role,
  active: row.active,
  acceptedAt: row.accepted_at ? new Date(row.accepted_at).getTime() : null,
});

const mapSubmission = (row: SubmissionRow): ShareSubmission => ({
  id: row.id,
  shareId: row.share_id,
  sourceProjectId: row.source_project_id,
  copyProjectId: row.copy_project_id,
  submittedBy: row.submitted_by,
  status: row.status,
  note: row.note,
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});

const roleFor = (
  row: ShareRow,
  members: MemberRow[],
  userId: string,
  email: string,
): ShareRole | null => {
  if (row.owner_id === userId) return "admin";
  const normalizedEmail = email.trim().toLowerCase();
  const matches = members.filter(
    (member) =>
      member.share_id === row.id &&
      member.active &&
      (member.user_id === userId || member.invited_email.toLowerCase() === normalizedEmail),
  );
  if (matches.some((member) => member.role === "admin")) return "admin";
  if (matches.some((member) => member.role === "editor")) return "editor";
  return matches.some((member) => member.role === "viewer") ? "viewer" : null;
};

const mapShare = (row: ShareRow, role: ShareRole): MapShare => ({
  id: row.id,
  projectId: row.project_id,
  ownerId: row.owner_id,
  name: row.name,
  statePath: row.state_path,
  mapView: row.map_view,
  layerScope: Array.isArray(row.layer_scope) ? row.layer_scope : [],
  permissions: sharePermissions(row.map_view?.sharePermissions),
  active: row.active,
  role,
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});

const uploadShareState = async (
  userId: string,
  projectId: string,
  shareId: string,
  state: ProjectState,
) => {
  const path = `${userId}/${projectId}/shares/${shareId}/state.json`;
  await uploadPrivateProjectFile(
    path,
    new Blob([JSON.stringify(state)], { type: "application/json" }),
  );
  return path;
};

export const downloadSharedState = async (path: string): Promise<ProjectState> => {
  const bytes = await downloadPrivateProjectFile(path);
  return JSON.parse(new TextDecoder().decode(bytes)) as ProjectState;
};

export function scopedShareState(
  state: ProjectState,
  liveLayers: GisLayer[],
  scope: ShareLayerScope[],
  mapView: MapViewState,
  permissions: SharePermissions = NEW_SHARE_PERMISSIONS,
): ProjectState {
  const byId = new Map(scope.map((entry) => [entry.layerId, entry.featureIndexes]));
  const layers = liveLayers
    .filter((layer) => byId.has(layer.id))
    .map((layer) => {
      const indexes = byId.get(layer.id);
      if (!indexes) return clone(layer);
      const selected = new Set(indexes);
      return {
        ...clone(layer),
        source: {
          kind: "derived" as const,
          sourceLayerId: layer.id,
          query: "Shared feature selection",
        },
        data: {
          type: "FeatureCollection" as const,
          features: layer.data.features.filter((_, index) => selected.has(index)),
        },
      };
    });
  const includedGroupIds = new Set(layers.map((layer) => layer.groupId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of state.groups) {
      if (
        includedGroupIds.has(group.id) &&
        group.parentId &&
        !includedGroupIds.has(group.parentId)
      ) {
        includedGroupIds.add(group.parentId);
        changed = true;
      }
    }
  }
  return applySharePermissions(
    {
      ...clone(state),
      mapView,
      groups: state.groups.filter((group) => includedGroupIds.has(group.id)),
      layers,
      enabledSubprojectIds: [],
      assistant: { messages: [], actions: [] },
    },
    permissions,
  );
}

export const shareUrl = (shareId: string) => {
  const url = new URL(window.location.origin);
  url.searchParams.set("share", shareId);
  return url.toString();
};

export const shareStore = {
  async claimInvitations(): Promise<void> {
    if (!cloudConfigured) return;
    await cloudDataRequest("/rest/v1/rpc/claim_share_invitations", {
      method: "POST",
      body: "{}",
    });
  },

  async list(
    userId: string,
    email: string,
  ): Promise<{
    shares: MapShare[];
    members: ShareMember[];
    submissions: ShareSubmission[];
  }> {
    if (!cloudConfigured) return { shares: [], members: [], submissions: [] };
    await this.claimInvitations();
    const [rows, memberRows, submissionRows] = await Promise.all([
      cloudDataRequest<ShareRow[]>(
        `/rest/v1/project_shares?select=${SHARE_SELECT}&order=updated_at.desc`,
      ),
      cloudDataRequest<MemberRow[]>(
        `/rest/v1/share_members?select=${MEMBER_SELECT}&order=created_at.asc`,
      ),
      cloudDataRequest<SubmissionRow[]>(
        `/rest/v1/share_submissions?select=${SUBMISSION_SELECT}&order=updated_at.desc`,
      ),
    ]);
    const shares = rows.flatMap((row) => {
      const role = roleFor(row, memberRows, userId, email);
      return role ? [mapShare(row, role)] : [];
    });
    return {
      shares,
      members: memberRows.map(mapMember),
      submissions: submissionRows.map(mapSubmission),
    };
  },

  async get(userId: string, email: string, shareId: string): Promise<MapShare | null> {
    const [rows, memberRows] = await Promise.all([
      cloudDataRequest<ShareRow[]>(
        `/rest/v1/project_shares?select=${SHARE_SELECT}&id=eq.${encodeURIComponent(shareId)}&active=eq.true&limit=1`,
      ),
      cloudDataRequest<MemberRow[]>(
        `/rest/v1/share_members?select=${MEMBER_SELECT}&share_id=eq.${encodeURIComponent(shareId)}`,
      ),
    ]);
    const row = rows[0];
    if (!row) return null;
    const role = roleFor(row, memberRows, userId, email);
    return role ? mapShare(row, role) : null;
  },

  async create(input: {
    userId: string;
    projectId: string;
    name: string;
    state: ProjectState;
    mapView: MapViewState;
    layerScope: ShareLayerScope[];
    permissions?: SharePermissions;
  }): Promise<MapShare> {
    if (!cloudConfigured) throw new Error("Cloud sharing is not configured");
    const id = window.crypto.randomUUID();
    const permissions = input.permissions ?? NEW_SHARE_PERMISSIONS;
    const statePath = await uploadShareState(
      input.userId,
      input.projectId,
      id,
      applySharePermissions(input.state, permissions),
    );
    const rows = await cloudDataRequest<ShareRow[]>("/rest/v1/rpc/create_project_share", {
      method: "POST",
      body: JSON.stringify({
        p_id: id,
        p_project_id: input.projectId,
        p_name: input.name.trim(),
        p_state_path: statePath,
        p_map_view: { ...input.mapView, sharePermissions: permissions },
        p_layer_scope: input.layerScope,
      }),
    });
    const row = rows[0];
    if (!row) throw new Error("The shared map could not be created");
    return mapShare(row, "admin");
  },

  async updateSnapshot(input: {
    share: MapShare;
    userId: string;
    state: ProjectState;
    mapView: MapViewState;
    layerScope: ShareLayerScope[];
    name?: string;
    permissions?: SharePermissions;
  }): Promise<void> {
    const permissions = input.permissions ?? input.share.permissions;
    const statePath = await uploadShareState(
      input.userId,
      input.share.projectId,
      input.share.id,
      applySharePermissions(input.state, permissions),
    );
    await cloudDataRequest(`/rest/v1/project_shares?id=eq.${encodeURIComponent(input.share.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        state_path: statePath,
        map_view: { ...input.mapView, sharePermissions: permissions },
        layer_scope: input.layerScope,
        ...(input.name ? { name: input.name.trim() } : {}),
      }),
    });
  },

  async updatePermissions(input: {
    share: MapShare;
    userId: string;
    permissions: SharePermissions;
  }): Promise<void> {
    const project = await workspaceProjectStore.load(input.userId, input.share.projectId);
    if (!project)
      throw new Error("The source project could not be loaded. Sharing options were not changed.");
    const snapshot = await downloadSharedState(input.share.statePath);
    const state = refreshSharedNotes(
      snapshot,
      project.state,
      input.share.layerScope,
      input.permissions,
    );
    await this.updateSnapshot({
      ...input,
      state,
      mapView: input.share.mapView,
      layerScope: input.share.layerScope,
    });
  },

  async invite(shareId: string, email: string, role: ShareRole): Promise<ShareInvitationResult> {
    const result = await cloudFunctionRequest<{
      member?: MemberRow;
      emailSent?: boolean;
      messageId?: string | null;
      warning?: string;
    }>("share-invite", { shareId, email, role });
    if (!result.member) throw new Error("The person could not be added");
    return {
      member: mapMember(result.member),
      emailSent: result.emailSent === true,
      ...(result.messageId ? { messageId: result.messageId } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
    };
  },

  async updateMember(memberId: string, role: ShareRole): Promise<void> {
    await cloudDataRequest(`/rest/v1/share_members?id=eq.${encodeURIComponent(memberId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ role }),
    });
  },

  async removeMember(memberId: string): Promise<void> {
    await cloudDataRequest(`/rest/v1/share_members?id=eq.${encodeURIComponent(memberId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  },

  async removeShare(share: MapShare): Promise<void> {
    await cloudDataRequest(`/rest/v1/project_shares?id=eq.${encodeURIComponent(share.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    await deletePrivateProjectFiles([share.statePath]).catch((error) =>
      console.warn("Removed share file will be cleaned up later", error),
    );
  },

  async createWorkingCopy(input: {
    userId: string;
    share: MapShare;
    state: ProjectState;
  }): Promise<string> {
    const existing = await cloudDataRequest<SubmissionRow[]>(
      `/rest/v1/share_submissions?select=${SUBMISSION_SELECT}&share_id=eq.${encodeURIComponent(input.share.id)}&submitted_by=eq.${encodeURIComponent(input.userId)}&limit=1`,
    );
    if (existing[0]) return existing[0].copy_project_id;
    const name = `${input.share.name} · my edits`;
    const state: ProjectState = {
      ...clone(input.state),
      name,
      shareSource: {
        shareId: input.share.id,
        sourceProjectId: input.share.projectId,
        sourceName: input.share.name,
      },
    };
    const project = await workspaceProjectStore.create(input.userId, name, state);
    await cloudDataRequest("/rest/v1/share_submissions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        share_id: input.share.id,
        source_project_id: input.share.projectId,
        copy_project_id: project.id,
        submitted_by: input.userId,
        status: "draft",
      }),
    });
    return project.id;
  },

  async updateSubmission(
    submissionId: string,
    status: ShareSubmission["status"],
    note = "",
  ): Promise<void> {
    await cloudDataRequest(`/rest/v1/share_submissions?id=eq.${encodeURIComponent(submissionId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, note }),
    });
  },
};
