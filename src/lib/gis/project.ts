import type { MapViewState, ProjectState } from "./types";
import { recoverSnapshot } from "./snapshotRecovery";
import { LANDDRAFT_APP_VERSION, projectVersionLabel } from "@/lib/appVersion";
import {
  cloudConfigured,
  cloudDataRequest,
  deletePrivateProjectFiles,
  downloadPrivateProjectFile,
  listPrivateProjectFiles,
  uploadPrivateProjectFile,
} from "@/lib/cloud";

export type SaveReason = "manual" | "autosave" | "restored";

export interface ProjectVersion {
  id: string;
  savedAt: number;
  reason: SaveReason;
  state?: ProjectState;
  storagePath?: string;
}

export interface StoredProject {
  recoveryNotice?: string;
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  autosave: boolean;
  state: ProjectState;
  versions: ProjectVersion[];
  parentProjectId: string | null;
  showInQuickSwitch: boolean;
  showInMobileBar: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  autosave: boolean;
  versionCount: number;
  parentProjectId: string | null;
  showInQuickSwitch: boolean;
  showInMobileBar: boolean;
}

export interface ProjectNavigationVisibility {
  showInQuickSwitch: boolean;
  showInMobileBar: boolean;
}

const WORKSPACE_KEY = "landdraft.workspace.v2";
const LEGACY_WORKSPACE_KEY = "terrasketch.workspace.v2";
const LEGACY_PROJECT_KEY = "terrasketch.project.v1";
const LOCAL_ACCOUNTS_KEY = "landdraft.accounts.v1";
const LEGACY_ACCOUNTS_KEY = "terrasketch.accounts.v1";
const migrationKey = (userId: string) => `landdraft.cloud-migrated.${userId}`;
const lastProjectKey = (userId: string) => `landdraft.last-project.${userId}`;
const legacyLastProjectKey = (userId: string) => `terrasketch.last-project.${userId}`;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const compactState = (state: ProjectState): ProjectState => {
  const layers = state.layers.map((layer) => {
    if (layer.source.kind !== "remote" || !layer.source.requiresViewport) return layer;
    const source = { ...layer.source };
    delete source.lastRefreshedAt;
    delete source.loading;
    delete source.loadStatus;
    delete source.loadedFeatures;
    delete source.expectedFeatures;
    delete source.loadError;
    return { ...layer, source, data: { type: "FeatureCollection" as const, features: [] } };
  });
  return { ...state, layers };
};

const compactProject = (project: StoredProject): StoredProject => ({
  ...project,
  showInQuickSwitch: project.showInQuickSwitch ?? true,
  showInMobileBar: project.showInMobileBar ?? true,
  state: compactState(project.state),
  versions: (project.versions ?? []).map((version) => ({
    ...version,
    ...(version.state ? { state: compactState(version.state) } : {}),
  })),
});

const readProjects = (): StoredProject[] => {
  try {
    const current = window.localStorage.getItem(WORKSPACE_KEY);
    const legacy = window.localStorage.getItem(LEGACY_WORKSPACE_KEY);
    const projects = JSON.parse(current ?? legacy ?? "[]") as StoredProject[];
    if (!current && legacy) window.localStorage.setItem(WORKSPACE_KEY, legacy);
    return projects;
  } catch {
    return [];
  }
};

const writeProjects = (projects: StoredProject[]) =>
  window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(projects));

const summary = (project: StoredProject): ProjectSummary => ({
  id: project.id,
  name: project.name,
  updatedAt: project.updatedAt,
  autosave: project.autosave,
  versionCount: project.versions.length,
  parentProjectId: project.parentProjectId ?? project.state.parentProjectId ?? null,
  showInQuickSwitch: project.showInQuickSwitch ?? true,
  showInMobileBar: project.showInMobileBar ?? true,
});

interface CloudProjectRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  autosave: boolean;
  state_path: string;
  parent_project_id: string | null;
  show_in_quick_switch: boolean;
  show_in_mobile_bar: boolean;
  last_opened_at: string;
  map_view: MapViewState;
}

interface CloudVersionRow {
  id: string;
  project_id: string;
  saved_at: string;
  reason: SaveReason;
  state_path: string;
}

const projectStateBlob = async (state: ProjectState) => {
  const json = JSON.stringify(state);
  if ("CompressionStream" in window) {
    const compressed = new Blob([json], { type: "application/json" })
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const blob = await new Response(compressed).blob();
    const digest = await window.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return {
      blob,
      extension: "json.gz",
      hash: bytesToHex(new Uint8Array(digest)),
    };
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  const hash = bytesToHex(new Uint8Array(digest));
  return { blob: new Blob([json], { type: "application/json" }), extension: "json", hash };
};

const uploadProjectState = async (userId: string, projectId: string, state: ProjectState) => {
  const encoded = await projectStateBlob(state);
  const path = `${userId}/${projectId}/states/${encoded.hash}.${encoded.extension}`;
  await uploadPrivateProjectFile(path, encoded.blob);
  return path;
};

const downloadProjectState = async (path: string): Promise<ProjectState> => {
  const bytes = await downloadPrivateProjectFile(path);
  let text: string;
  if (path.endsWith(".gz")) {
    if (!("DecompressionStream" in window))
      throw new Error("This browser cannot open compressed cloud map snapshots");
    const decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(decompressed).text();
  } else text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as ProjectState;
};

// Never garbage-collect snapshots from a browser's version list. Another tab may
// have uploaded a new object before committing its database reference. Retention
// requires a server-side grace period and transactional reference checks.

const cloudVersions = async (projectId: string): Promise<ProjectVersion[]> => {
  const rows = await cloudDataRequest<CloudVersionRow[]>(
    `/rest/v1/project_versions?select=id,project_id,saved_at,reason,state_path&project_id=eq.${encodeURIComponent(projectId)}&order=saved_at.desc&limit=25`,
  );
  return rows.map((row) => ({
    id: row.id,
    savedAt: new Date(row.saved_at).getTime(),
    reason: row.reason,
    storagePath: row.state_path,
  }));
};

const storedFromCloud = async (
  row: CloudProjectRow,
  allowRecovery = true,
): Promise<StoredProject> => {
  const versions = await cloudVersions(row.id);
  const { state, recoveredAt } = allowRecovery
    ? await recoverSnapshot(row.state_path, versions, downloadProjectState)
    : { state: await downloadProjectState(row.state_path), recoveredAt: null };
  return {
    id: row.id,
    userId: row.owner_id,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    autosave: recoveredAt !== null ? false : row.autosave,
    ...(recoveredAt !== null
      ? {
          recoveryNotice: `The latest saved file is missing. Opened an earlier version from ${new Date(recoveredAt).toLocaleString()}. Autosave is paused; review this version before saving. No cloud project reference has been changed.`,
        }
      : {}),
    state: { ...state, mapView: row.map_view ?? state.mapView },
    versions,
    parentProjectId: row.parent_project_id,
    showInQuickSwitch: row.show_in_quick_switch ?? true,
    showInMobileBar: row.show_in_mobile_bar ?? true,
  };
};

const cloudProjectSelect =
  "id,owner_id,name,created_at,updated_at,autosave,state_path,parent_project_id,show_in_quick_switch,show_in_mobile_bar,last_opened_at,map_view";

const touchCloudProject = async (projectId: string) => {
  await cloudDataRequest("/rest/v1/rpc/touch_project_opened", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId }),
  });
};

const createCloudProject = async (
  userId: string,
  name: string,
  state: ProjectState,
  id: string = window.crypto.randomUUID(),
  autosave = true,
  parentProjectId: string | null = null,
  navigation: Partial<ProjectNavigationVisibility> = {},
) => {
  const cleanState = { ...compactState(state), name, parentProjectId };
  const statePath = await uploadProjectState(userId, id, cleanState);
  const rows = await cloudDataRequest<CloudProjectRow[]>("/rest/v1/rpc/create_project", {
    method: "POST",
    body: JSON.stringify({
      p_id: id,
      p_name: name,
      p_autosave: autosave,
      p_state_path: statePath,
    }),
  });
  const row = rows[0];
  if (!row) throw new Error("Cloud project could not be created");
  if (parentProjectId)
    await cloudDataRequest("/rest/v1/rpc/set_project_parent", {
      method: "POST",
      body: JSON.stringify({ p_project_id: id, p_parent_project_id: parentProjectId }),
    });
  row.parent_project_id = parentProjectId;
  const showInQuickSwitch = navigation.showInQuickSwitch ?? true;
  const showInMobileBar = navigation.showInMobileBar ?? true;
  if (!showInQuickSwitch || !showInMobileBar) {
    await cloudDataRequest(`/rest/v1/projects?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        show_in_quick_switch: showInQuickSwitch,
        show_in_mobile_bar: showInMobileBar,
      }),
    });
  }
  row.show_in_quick_switch = showInQuickSwitch;
  row.show_in_mobile_bar = showInMobileBar;
  return storedFromCloud(row, false);
};

export const workspaceProjectStore = {
  async list(userId: string): Promise<ProjectSummary[]> {
    if (cloudConfigured) {
      const rows = await cloudDataRequest<
        Pick<
          CloudProjectRow,
          | "id"
          | "name"
          | "updated_at"
          | "autosave"
          | "parent_project_id"
          | "show_in_quick_switch"
          | "show_in_mobile_bar"
        >[]
      >(
        "/rest/v1/projects?select=id,name,updated_at,autosave,parent_project_id,show_in_quick_switch,show_in_mobile_bar&order=updated_at.desc",
      );
      const versionRows = await cloudDataRequest<{ project_id: string }[]>(
        "/rest/v1/project_versions?select=project_id",
      );
      const counts = new Map<string, number>();
      for (const version of versionRows)
        counts.set(version.project_id, (counts.get(version.project_id) ?? 0) + 1);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        updatedAt: new Date(row.updated_at).getTime(),
        autosave: row.autosave,
        versionCount: counts.get(row.id) ?? 0,
        parentProjectId: row.parent_project_id,
        showInQuickSwitch: row.show_in_quick_switch ?? true,
        showInMobileBar: row.show_in_mobile_bar ?? true,
      }));
    }
    return readProjects()
      .filter((project) => project.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summary);
  },

  async create(
    userId: string,
    name: string,
    state: ProjectState,
    parentProjectId: string | null = null,
    navigation: Partial<ProjectNavigationVisibility> = {},
  ): Promise<StoredProject> {
    if (cloudConfigured)
      return createCloudProject(userId, name, state, undefined, true, parentProjectId, navigation);
    const now = Date.now();
    const cleanState = { ...compactState(state), name, parentProjectId };
    const project: StoredProject = {
      id: window.crypto.randomUUID(),
      userId,
      name,
      createdAt: now,
      updatedAt: now,
      autosave: true,
      state: cleanState,
      versions: [
        { id: window.crypto.randomUUID(), savedAt: now, reason: "manual", state: cleanState },
      ],
      parentProjectId,
      showInQuickSwitch: navigation.showInQuickSwitch ?? true,
      showInMobileBar: navigation.showInMobileBar ?? true,
    };
    writeProjects([...readProjects(), project]);
    window.localStorage.setItem(lastProjectKey(userId), project.id);
    return clone(project);
  },

  async load(
    userId: string,
    projectId: string,
    updateLastOpened = true,
  ): Promise<StoredProject | null> {
    if (cloudConfigured) {
      const rows = await cloudDataRequest<CloudProjectRow[]>(
        `/rest/v1/projects?select=${cloudProjectSelect}&id=eq.${encodeURIComponent(projectId)}&limit=1`,
      );
      if (!rows[0]) return null;
      if (updateLastOpened) await touchCloudProject(rows[0].id);
      return storedFromCloud(rows[0]);
    }
    const projects = readProjects();
    const index = projects.findIndex((item) => item.userId === userId && item.id === projectId);
    if (index < 0) return null;
    const stored = projects[index] as StoredProject;
    const project = compactProject(stored);
    if (JSON.stringify(stored) !== JSON.stringify(project)) {
      projects[index] = project;
      writeProjects(projects);
    }
    if (updateLastOpened) window.localStorage.setItem(lastProjectKey(userId), project.id);
    return clone(project);
  },

  async loadLast(userId: string): Promise<StoredProject | null> {
    if (cloudConfigured) {
      const rows = await cloudDataRequest<CloudProjectRow[]>(
        `/rest/v1/projects?select=${cloudProjectSelect}&order=last_opened_at.desc,updated_at.desc&limit=1`,
      );
      return rows[0] ? storedFromCloud(rows[0]) : null;
    }
    const projects = readProjects();
    const userProjects = projects.filter((item) => item.userId === userId);
    const currentLastId = window.localStorage.getItem(lastProjectKey(userId));
    const legacyLastId = window.localStorage.getItem(legacyLastProjectKey(userId));
    const lastId = currentLastId ?? legacyLastId;
    if (!currentLastId && legacyLastId)
      window.localStorage.setItem(lastProjectKey(userId), legacyLastId);
    const stored =
      userProjects.find((item) => item.id === lastId) ??
      userProjects.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!stored) return null;
    const project = compactProject(stored);
    if (JSON.stringify(stored) !== JSON.stringify(project)) {
      const index = projects.findIndex((item) => item.id === stored.id);
      if (index >= 0) projects[index] = project;
      writeProjects(projects);
    }
    return clone(project);
  },

  async save(
    userId: string,
    projectId: string,
    state: ProjectState,
    reason: SaveReason,
  ): Promise<StoredProject> {
    if (cloudConfigured) {
      const cleanState = compactState(state);
      const statePath = await uploadProjectState(userId, projectId, cleanState);
      const rows = await cloudDataRequest<CloudProjectRow[]>("/rest/v1/rpc/save_project_snapshot", {
        method: "POST",
        body: JSON.stringify({
          p_project_id: projectId,
          p_name: cleanState.name,
          p_state_path: statePath,
          p_reason: reason,
        }),
      });
      const row = rows[0];
      if (!row) throw new Error("Project was not found or is no longer editable");
      const project = await storedFromCloud(row, false);
      return project;
    }
    const projects = readProjects();
    const index = projects.findIndex((item) => item.userId === userId && item.id === projectId);
    if (index < 0) throw new Error("Project was not found");
    const storedCurrent = projects[index] as StoredProject;
    const current = compactProject(storedCurrent);
    const cleanState = compactState(state);
    if (reason === "autosave" && JSON.stringify(current.state) === JSON.stringify(cleanState)) {
      if (JSON.stringify(storedCurrent) !== JSON.stringify(current)) {
        projects[index] = current;
        writeProjects(projects);
      }
      return clone(current);
    }
    const now = Date.now();
    const snapshot: ProjectVersion = {
      id: window.crypto.randomUUID(),
      savedAt: now,
      reason,
      state: cleanState,
    };
    let versions = current.versions ?? [];
    if (
      reason === "autosave" &&
      versions[0]?.reason === "autosave" &&
      now - versions[0].savedAt < 60_000
    )
      versions = [snapshot, ...versions.slice(1)];
    else versions = [snapshot, ...versions];
    const project: StoredProject = {
      ...current,
      name: cleanState.name,
      state: cleanState,
      updatedAt: now,
      versions: versions.slice(0, 25),
    };
    projects[index] = project;
    writeProjects(projects);
    window.localStorage.setItem(lastProjectKey(userId), project.id);
    return clone(project);
  },

  async setAutosave(userId: string, projectId: string, autosave: boolean): Promise<void> {
    if (cloudConfigured) {
      await cloudDataRequest(`/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ autosave }),
      });
      return;
    }
    const projects = readProjects();
    const index = projects.findIndex((item) => item.userId === userId && item.id === projectId);
    if (index < 0) return;
    projects[index] = { ...(projects[index] as StoredProject), autosave };
    writeProjects(projects);
  },

  async setNavigationVisibility(
    userId: string,
    projectId: string,
    visibility: ProjectNavigationVisibility,
  ): Promise<void> {
    if (cloudConfigured) {
      await cloudDataRequest(`/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          show_in_quick_switch: visibility.showInQuickSwitch,
          show_in_mobile_bar: visibility.showInMobileBar,
        }),
      });
      return;
    }
    const projects = readProjects();
    const index = projects.findIndex((item) => item.userId === userId && item.id === projectId);
    if (index < 0) return;
    projects[index] = {
      ...(projects[index] as StoredProject),
      ...visibility,
    };
    writeProjects(projects);
  },

  async setMapView(userId: string, projectId: string, mapView: MapViewState): Promise<void> {
    if (cloudConfigured) {
      await cloudDataRequest("/rest/v1/rpc/update_project_view", {
        method: "POST",
        body: JSON.stringify({ p_project_id: projectId, p_map_view: mapView }),
      });
      return;
    }
    const projects = readProjects();
    const index = projects.findIndex((item) => item.userId === userId && item.id === projectId);
    if (index < 0) return;
    const project = projects[index] as StoredProject;
    projects[index] = { ...project, state: { ...project.state, mapView } };
    writeProjects(projects);
  },

  async setParent(
    userId: string,
    projectId: string,
    parentProjectId: string | null,
  ): Promise<void> {
    if (cloudConfigured) {
      await cloudDataRequest("/rest/v1/rpc/set_project_parent", {
        method: "POST",
        body: JSON.stringify({ p_project_id: projectId, p_parent_project_id: parentProjectId }),
      });
      return;
    }
    const projects = readProjects();
    const index = projects.findIndex((item) => item.userId === userId && item.id === projectId);
    if (index < 0) return;
    const project = projects[index] as StoredProject;
    projects[index] = {
      ...project,
      parentProjectId,
      state: { ...project.state, parentProjectId },
    };
    writeProjects(projects);
  },

  async remove(userId: string, projectId: string): Promise<void> {
    if (cloudConfigured) {
      await cloudDataRequest(`/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
      void listPrivateProjectFiles(`${userId}/${projectId}/states`)
        .then(deletePrivateProjectFiles)
        .catch((error) => console.warn("Deleted project files will be cleaned up later", error));
      return;
    }
    writeProjects(readProjects().filter((item) => item.userId !== userId || item.id !== projectId));
  },

  async migrateLocalAccount(userId: string, email: string): Promise<number> {
    if (!cloudConfigured || window.localStorage.getItem(migrationKey(userId))) return 0;
    try {
      const rawAccounts =
        window.localStorage.getItem(LOCAL_ACCOUNTS_KEY) ??
        window.localStorage.getItem(LEGACY_ACCOUNTS_KEY) ??
        "[]";
      const accounts = JSON.parse(rawAccounts) as { id: string; email: string }[];
      const account = accounts.find((item) => item.email.toLowerCase() === email.toLowerCase());
      if (!account) {
        window.localStorage.setItem(migrationKey(userId), "none");
        return 0;
      }
      const localProjects = readProjects().filter((project) => project.userId === account.id);
      const cloudProjects = await this.list(userId);
      const existingIds = new Set(cloudProjects.map((project) => project.id));
      let imported = 0;
      for (const project of localProjects) {
        if (existingIds.has(project.id)) continue;
        await createCloudProject(
          userId,
          project.name,
          project.state,
          project.id,
          project.autosave,
          project.parentProjectId ?? null,
          {
            showInQuickSwitch: project.showInQuickSwitch ?? true,
            showInMobileBar: project.showInMobileBar ?? true,
          },
        );
        imported += 1;
      }
      window.localStorage.setItem(migrationKey(userId), String(imported));
      return imported;
    } catch (error) {
      console.warn("Local project migration will be retried", error);
      return 0;
    }
  },

  async loadVersion(version: ProjectVersion): Promise<ProjectState> {
    if (version.state) return clone(version.state);
    if (cloudConfigured && version.storagePath) return downloadProjectState(version.storagePath);
    throw new Error("This restore point is no longer available");
  },

  async readLegacy(): Promise<ProjectState | null> {
    try {
      const raw = window.localStorage.getItem(LEGACY_PROJECT_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw) as ProjectState;
      return state.version === 1 ? state : null;
    } catch {
      return null;
    }
  },
};

export function downloadProjectFile(state: ProjectState) {
  const exportedAt = Date.now();
  const versionedState: ProjectState = {
    ...state,
    landDraftVersion: LANDDRAFT_APP_VERSION,
    savedAt: exportedAt,
  };
  const blob = new Blob([JSON.stringify(versionedState, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const projectName = state.name.replace(/[^\w-]+/g, "_") || "landdraft";
  a.download = `${projectName}_${projectVersionLabel(exportedAt)}.landdraft.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
