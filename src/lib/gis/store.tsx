import { applyGroupStyle } from "./groupStyle";
import { toggleLayerTreeSelection } from "./layerTreeSelection";
import { applySharePermissions, sharedCapabilities } from "./sharePermissions";
import { preserveSelectedFeatures } from "./stableSelection";
import type { WaterWorkspaceState } from "@/lib/water/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { FeatureCollection, Geometry } from "geojson";
import {
  defaultStyle,
  type GisLayer,
  type LayerGroup,
  type LayerStyle,
  type LayerSource,
  type ProjectState,
  type AreaUnitsPref,
  type PrintComposition,
  type AssistantConversation,
  type ConnectionRecoveryHint,
  type MapViewState,
  type ProjectRecords,
  type ProjectEvent,
  type ProjectEventType,
  emptyProjectRecords,
} from "./types";
import type { PipelineEngineeringState } from "@/lib/pipeline/types";
import { normalizePipelineEngineeringState } from "@/lib/pipeline/model";
import type { WeatherWorkspaceState } from "@/lib/weather/types";
import { normalizeWeatherWorkspace } from "@/lib/weather/model";
import {
  workspaceProjectStore,
  type ProjectSummary,
  type ProjectVersion,
  type SaveReason,
  type StoredProject,
} from "./project";
import { useAuth } from "@/lib/auth";
import { LANDDRAFT_APP_VERSION, projectVersionLabel } from "@/lib/appVersion";
import { downloadSharedState, shareStore, type MapShare, type ShareRole } from "./sharing";
import { DEFAULT_BASEMAP_ID } from "./basemaps";
import { createCoreLayerGroups, ensureCoreLayerGroups } from "./projectGroups";
import { normalizeLayerData, normalizeLayerStyle } from "./layerNormalization";

export type DrawMode =
  | "none"
  | "select-multiple"
  | "select-box"
  | "polygon"
  | "line"
  | "point"
  | "note"
  | "measure-area"
  | "measure-line";

export interface SelectedFeature {
  layerId: string;
  index: number;
}

interface WorkbenchState {
  projectId: string;
  projectReady: boolean;
  projectError: string | null;
  projectRecoveryNotice: string | null;
  projectName: string;
  projects: ProjectSummary[];
  saveHistory: ProjectVersion[];
  autosave: boolean;
  lastSavedAt: number | null;
  groups: LayerGroup[];
  layers: GisLayer[];
  basemapId: string;
  mapView: MapViewState;
  projectArea: MapViewState | undefined;
  accessRole: "owner" | ShareRole;
  activeShare: MapShare | null;
  shareSource: ProjectState["shareSource"];
  units: AreaUnitsPref;
  activeLayerId: string | null;
  selectedLayerIds: string[];
  selectedGroupIds: string[];
  selectedFeature: SelectedFeature | null;
  selectedFeatures: SelectedFeature[];
  drawMode: DrawMode;
  snapEnabled: boolean;
  selectedStates: string[];
  derivedLayerGroupId: string;
  parentProjectId: string | null;
  enabledSubprojectIds: string[];
  subprojectOverlays: Array<{ projectId: string; projectName: string; layers: GisLayer[] }>;
  printComposition: PrintComposition | undefined;
  assistant: AssistantConversation;
  connectionHints: Record<string, ConnectionRecoveryHint>;
  records: ProjectRecords;
  pipelineEngineering: PipelineEngineeringState | undefined;
  weatherWorkspace: WeatherWorkspaceState | undefined;
  waterWorkspace: WaterWorkspaceState | undefined;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const initialState = (): WorkbenchState => ({
  projectId: "",
  projectReady: false,
  projectError: null,
  projectRecoveryNotice: null,
  projectName: "Untitled project",
  projects: [],
  saveHistory: [],
  autosave: true,
  lastSavedAt: null,
  groups: createCoreLayerGroups(),
  layers: [],
  basemapId: DEFAULT_BASEMAP_ID,
  mapView: { center: [-98.5, 31.3], zoom: 6, bearing: 0, pitch: 0 },
  projectArea: undefined,
  accessRole: "owner",
  activeShare: null,
  shareSource: undefined,
  units: { area: "acres", length: "miles" },
  activeLayerId: null,
  selectedLayerIds: [],
  selectedGroupIds: [],
  selectedFeature: null,
  selectedFeatures: [],
  drawMode: "none",
  snapEnabled: true,
  selectedStates: ["TX"],
  derivedLayerGroupId: "working",
  parentProjectId: null,
  enabledSubprojectIds: [],
  subprojectOverlays: [],
  printComposition: undefined,
  assistant: { messages: [], actions: [] },
  connectionHints: {},
  records: emptyProjectRecords(),
  pipelineEngineering: undefined,
  weatherWorkspace: undefined,
  waterWorkspace: undefined,
});

const blankProjectState = (name: string): ProjectState => ({
  version: 1,
  landDraftVersion: LANDDRAFT_APP_VERSION,
  name,
  groups: createCoreLayerGroups(),
  layers: [],
  basemapId: DEFAULT_BASEMAP_ID,
  mapView: { center: [-98.5, 31.3], zoom: 6, bearing: 0, pitch: 0 },
  units: { area: "acres", length: "miles" },
  selectedStates: ["TX"],
  derivedLayerGroupId: "working",
  parentProjectId: null,
  enabledSubprojectIds: [],
  records: emptyProjectRecords(),
});

const normalizedLayer = (layer: GisLayer, index: number): GisLayer => {
  let source =
    layer.source.kind === "remote" && layer.source.catalogId && !layer.source.requiresViewport
      ? { ...layer.source, requiresViewport: true }
      : layer.source;
  const style = normalizeLayerStyle(layer.style, index);
  // Apply the requested parcel defaults once. Later user zoom/font edits survive reopening.
  if (
    source.kind === "remote" &&
    source.catalogId === "tx-parcels" &&
    (source.parcelDisplayVersion ?? 0) < 2
  ) {
    const previousMinZoom = source.minZoom;
    source = { ...source, parcelDisplayVersion: 2 };
    if (previousMinZoom === undefined || [8, 9, 11, 12].includes(previousMinZoom))
      source.minZoom = 10;
    if (style.labelMinZoom === 8 || style.labelMinZoom === 9) style.labelMinZoom = 11;
    if (style.labelSize === 11) style.labelScaleWithZoom = true;
  }
  return {
    ...layer,
    data: normalizeLayerData(layer.data),
    source,
    style,
  };
};

const durableLayer = (layer: GisLayer): GisLayer => {
  if (layer.source.kind !== "remote" || !layer.source.requiresViewport) return layer;
  const source = { ...layer.source };
  delete source.lastRefreshedAt;
  delete source.loading;
  delete source.loadStatus;
  delete source.loadedFeatures;
  delete source.expectedFeatures;
  delete source.loadError;
  return {
    ...layer,
    data: { type: "FeatureCollection", features: [] },
    source,
  };
};

const withoutLegacyLayerNote = (layer: GisLayer): GisLayer => {
  const normalized = { ...layer };
  delete normalized.note;
  delete normalized.noteUpdatedAt;
  return normalized;
};

const normalizedProject = (
  project: StoredProject,
  projects: ProjectSummary[],
  accessRole: WorkbenchState["accessRole"] = "owner",
  activeShare: MapShare | null = null,
) => {
  const stored = project.state;
  const groups = ensureCoreLayerGroups(stored.groups);
  const normalizedLayers = stored.layers.map((layer, index) => {
    const normalized = normalizedLayer(layer, index);
    const durable = activeShare && accessRole !== "admin" ? normalized : durableLayer(normalized);
    // Legacy single-note fields are migrated into records.layerNotes below. Clear the old copy so
    // deleting a structured note cannot cause it to reappear on a later project reload.
    return withoutLegacyLayerNote(durable);
  });
  const normalizedHierarchy = normalizeLayerContainers(groups, normalizedLayers);
  return {
    projectId: project.id,
    projectReady: true,
    projectError: null,
    projectName: stored.name,
    projectRecoveryNotice: project.recoveryNotice ?? null,
    projects,
    saveHistory: project.versions ?? [],
    autosave: project.autosave,
    lastSavedAt: project.updatedAt,
    groups: normalizedHierarchy.groups,
    // Viewer/editor shares contain the exact feature snapshot chosen by the owner. Keep that
    // snapshot long enough for the first-open map extent to include every shared feature; normal
    // owner projects still discard viewport caches and reload them efficiently.
    layers: normalizedHierarchy.layers,
    basemapId: stored.basemapId,
    mapView: activeShare?.mapView ??
      stored.projectArea ??
      stored.mapView ?? {
        center: [-98.5, 31.3] as [number, number],
        zoom: 6,
        bearing: 0,
        pitch: 0,
      },
    projectArea: stored.projectArea,
    accessRole,
    activeShare,
    shareSource: stored.shareSource,
    units: stored.units,
    activeLayerId: null,
    selectedLayerIds: [],
    selectedGroupIds: [],
    selectedFeature: null,
    selectedFeatures: [],
    drawMode: "none" as DrawMode,
    selectedStates: stored.selectedStates?.length ? stored.selectedStates : ["TX"],
    derivedLayerGroupId: normalizedHierarchy.groups.some(
      (group) => group.id === stored.derivedLayerGroupId,
    )
      ? (stored.derivedLayerGroupId as string)
      : "working",
    parentProjectId:
      "parentProjectId" in project ? project.parentProjectId : (stored.parentProjectId ?? null),
    enabledSubprojectIds: stored.enabledSubprojectIds ?? [],
    subprojectOverlays: [],
    printComposition: stored.printComposition,
    assistant: stored.assistant ?? { messages: [], actions: [] },
    connectionHints: stored.connectionHints ?? {},
    records: {
      ...emptyProjectRecords(),
      ...(stored.records ?? {}),
      notes: stored.records?.notes ?? [],
      layerNotes: [
        ...(stored.records?.layerNotes ?? []),
        ...stored.layers
          .filter(
            (layer) =>
              (Boolean(layer.note?.trim()) ||
                Boolean(
                  stored.records?.documents?.some(
                    (document) => document.layerId === layer.id && !document.layerNoteId,
                  ),
                )) &&
              !(stored.records?.layerNotes ?? []).some((note) => note.layerId === layer.id),
          )
          .map((layer) => ({
            id: `legacy-${layer.id}`,
            layerId: layer.id,
            subject: layer.note?.trim() ? `${layer.name} note` : `${layer.name} attachments`,
            body: layer.note?.trim() || "Attachments saved for this layer.",
            tags: [],
            createdAt: layer.noteUpdatedAt ?? layer.createdAt,
            updatedAt: layer.noteUpdatedAt ?? layer.createdAt,
            author: "LandDraft user",
            includeInPacket: true,
          })),
      ],
      folders: stored.records?.folders?.length
        ? stored.records.folders
        : emptyProjectRecords().folders,
      documents: stored.records?.documents ?? [],
      events: stored.records?.events ?? [],
    },
    pipelineEngineering: stored.pipelineEngineering
      ? normalizePipelineEngineeringState(stored.pipelineEngineering)
      : undefined,
    waterWorkspace: stored.waterWorkspace,
    weatherWorkspace: stored.weatherWorkspace
      ? normalizeWeatherWorkspace(stored.weatherWorkspace)
      : undefined,
  };
};

const stateToProject = (state: WorkbenchState): ProjectState => ({
  version: 1,
  landDraftVersion: LANDDRAFT_APP_VERSION,
  name: state.projectName,
  groups: state.groups,
  layers: state.layers.map(durableLayer),
  basemapId: state.basemapId,
  mapView: state.mapView,
  ...(state.projectArea ? { projectArea: state.projectArea } : {}),
  units: state.units,
  selectedStates: state.selectedStates,
  derivedLayerGroupId: state.derivedLayerGroupId,
  parentProjectId: state.parentProjectId,
  enabledSubprojectIds: state.enabledSubprojectIds,
  ...(state.printComposition ? { printComposition: state.printComposition } : {}),
  assistant: state.assistant,
  connectionHints: state.connectionHints,
  records: state.records,
  ...(state.pipelineEngineering ? { pipelineEngineering: state.pipelineEngineering } : {}),
  ...(state.waterWorkspace ? { waterWorkspace: state.waterWorkspace } : {}),
  ...(state.weatherWorkspace ? { weatherWorkspace: state.weatherWorkspace } : {}),
  ...(state.shareSource ? { shareSource: state.shareSource } : {}),
});

export interface WorkbenchApi extends WorkbenchState {
  addLayer: (input: {
    name: string;
    data: FeatureCollection;
    groupId: string;
    source: LayerSource;
    style?: Partial<LayerStyle>;
  }) => GisLayer;
  updateLayer: (id: string, patch: Partial<Omit<GisLayer, "id">>) => void;
  updateDisplayLayer: (id: string, patch: Partial<Omit<GisLayer, "id">>) => void;
  setLayerNote: (id: string, note: string) => void;
  updateStyle: (id: string, patch: Partial<LayerStyle>) => void;
  removeLayers: (ids: string[]) => void;
  duplicateLayer: (id: string, targetGroupId?: string) => void;
  toggleVisible: (id: string) => void;
  moveLayer: (id: string, direction: -1 | 1) => void;
  moveLayerToEdge: (id: string, edge: "front" | "back") => void;
  reorderLayer: (id: string, targetGroupId: string, beforeLayerId?: string) => void;
  reorderGroup: (
    id: string,
    targetGroupId: string,
    position: "before" | "inside" | "after",
  ) => void;
  nestGroupInLayer: (groupId: string, layerId: string) => void;
  nestLayerInLayer: (layerId: string, targetLayerId: string) => void;
  setLayerGroup: (id: string, groupId: string) => void;
  addGroup: (name: string) => string;
  addSubgroup: (parentId: string, name: string) => void;
  renameGroup: (id: string, name: string) => void;
  groupSelectedGroups: (ids: string[], name: string) => void;
  removeGroup: (id: string) => void;
  toggleGroup: (id: string) => void;
  toggleGroupSelection: (id: string) => void;
  setSelectedGroups: (ids: string[]) => void;
  setGroupVisible: (id: string, visible: boolean) => void;
  applyStyleToGroup: (id: string, patch: Partial<LayerStyle>) => void;
  setActiveLayer: (id: string | null) => void;
  toggleLayerSelection: (id: string, additive: boolean) => void;
  setSelectedLayers: (ids: string[]) => void;
  setSelectedFeature: (sel: SelectedFeature | null) => void;
  setSelectedFeatures: (selections: SelectedFeature[]) => void;
  setDrawMode: (mode: DrawMode) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSelectedStates: (states: string[]) => void;
  setDerivedLayerGroupId: (groupId: string) => void;
  setBasemapId: (id: string) => void;
  setMapView: (view: MapViewState) => void;
  setProjectArea: (view: MapViewState | null) => Promise<void>;
  setUnits: (units: Partial<AreaUnitsPref>) => void;
  setProjectName: (name: string) => void;
  appendFeature: (layerId: string, feature: FeatureCollection["features"][number]) => void;
  updateFeatureProperties: (
    layerId: string,
    index: number,
    properties: Record<string, unknown>,
  ) => void;
  updateFeaturesProperties: (
    layerId: string,
    updates: Array<{ index: number; properties: Record<string, unknown> }>,
  ) => void;
  updateFeatureGeometry: (layerId: string, index: number, geometry: Geometry) => void;
  removeFeatures: (layerId: string, indexes: number[]) => void;
  setAssistantConversation: (conversation: AssistantConversation) => void;
  setConnectionHint: (id: string, hint: ConnectionRecoveryHint) => void;
  setProjectRecords: (records: ProjectRecords) => void;
  setPipelineEngineering: (state: PipelineEngineeringState | undefined) => void;
  setWaterWorkspace: (state: WaterWorkspaceState | undefined) => void;
  setWeatherWorkspace: (state: WeatherWorkspaceState | undefined) => void;
  addProjectEvent: (input: {
    type: ProjectEventType;
    title: string;
    detail?: string;
    relatedId?: string;
  }) => void;
  saveProject: (reason?: SaveReason) => Promise<ProjectVersion | undefined>;
  createProject: (name: string) => Promise<void>;
  createSubproject: (name: string, parentProjectId?: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;
  duplicateVersion: (versionId: string) => Promise<void>;
  promoteProject: (id: string) => Promise<void>;
  moveProject: (id: string, parentId: string) => Promise<void>;
  toggleSubprojectOverlay: (id: string, enabled: boolean) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  openSharedMap: (id: string) => Promise<void>;
  createSharedWorkingCopy: () => Promise<void>;
  openReviewProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;
  setAutosave: (enabled: boolean) => Promise<void>;
  setProjectNavigationVisibility: (
    id: string,
    visibility: { showInQuickSwitch: boolean; showInMobileBar: boolean },
  ) => Promise<void>;
  setPrintComposition: (composition: PrintComposition) => void;
  toProjectState: () => ProjectState;
  layersInGroup: (groupId: string) => GisLayer[];
  activeLayer: GisLayer | null;
  displayLayers: GisLayer[];
  canEditProject: boolean;
  canExportLayers: boolean;
  canViewNotes: boolean;
  canUseAi: boolean;
  canSearchMap: boolean;
  canBackupProject: boolean;
}

const WorkbenchContext = createContext<WorkbenchApi | null>(null);

const palette = ["#2f7d4f", "#c9832c", "#3b6ea5", "#8e4a86", "#b0453a", "#3f7f7a"];

const colorSeed = (value: string) =>
  Array.from(value).reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0);

const sourceFamily = (sourceId: string, layers: GisLayer[]): GisLayer | undefined => {
  let current = layers.find((layer) => layer.id === sourceId);
  const visited = new Set<string>();
  while (current?.source.kind === "derived" && !visited.has(current.id)) {
    visited.add(current.id);
    const sourceLayerId = current.source.sourceLayerId;
    current = layers.find((layer) => layer.id === sourceLayerId);
  }
  return current;
};

const derivedStyle = (
  sourceId: string,
  layers: GisLayer[],
  requested: Partial<LayerStyle> = {},
): LayerStyle => {
  const source = sourceFamily(sourceId, layers) ?? layers.find((layer) => layer.id === sourceId);
  const familyId = source?.id ?? sourceId;
  let index = colorSeed(`${familyId}:derived`) % palette.length;
  if (palette[index]?.toLowerCase() === source?.style.fillColor.toLowerCase())
    index = (index + 1) % palette.length;
  const color = palette[index] ?? "#3b6ea5";
  return {
    ...(source?.style ?? defaultStyle(index)),
    ...requested,
    fillColor: color,
    strokeColor: color,
    fillOpacity: 0.5,
  };
};

const descendantGroupIds = (groupId: string, groups: LayerGroup[]): Set<string> => {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return ids;
};

const normalizeLayerContainers = (groups: LayerGroup[], layers: GisLayer[]) => {
  let normalizedGroups = groups.map((group) => ({ ...group }));
  let normalizedLayers = layers.map((layer) => ({ ...layer }));
  for (const container of normalizedGroups.filter((group) => group.containerLayerId)) {
    const target = normalizedLayers.find((layer) => layer.id === container.containerLayerId);
    const fallbackGroupId =
      container.parentId && normalizedGroups.some((group) => group.id === container.parentId)
        ? container.parentId
        : (normalizedGroups.find((group) => !group.containerLayerId)?.id ?? "working");
    // A focused share may intentionally exclude the parent layer while including one of its
    // children. Promote those children to the nearest visible group instead of hiding them behind
    // a structural container whose owning layer is absent.
    if (!target) {
      normalizedLayers = normalizedLayers.map((layer) =>
        layer.groupId === container.id ? { ...layer, groupId: fallbackGroupId } : layer,
      );
      normalizedGroups = normalizedGroups
        .filter((group) => group.id !== container.id)
        .map((group) =>
          group.parentId === container.id ? { ...group, parentId: fallbackGroupId } : group,
        );
      continue;
    }
    // The first container implementation placed the target layer inside its own structural
    // container. Move that layer back beside the container so the container can render beneath
    // the layer row without creating a duplicate or self-referencing tree.
    if (target?.groupId === container.id) {
      target.groupId = fallbackGroupId;
    }
  }
  return {
    groups: normalizedGroups,
    layers: orderedLayersForGroups(normalizedLayers, normalizedGroups),
  };
};

const orderedLayersForGroups = (layers: GisLayer[], groups: LayerGroup[]): GisLayer[] => {
  const ordered: GisLayer[] = [];
  const visitedLayers = new Set<string>();
  const visitedGroups = new Set<string>();
  const visitLayer = (layer: GisLayer) => {
    if (visitedLayers.has(layer.id)) return;
    visitedLayers.add(layer.id);
    ordered.push(layer);
    const container = groups.find((group) => group.containerLayerId === layer.id);
    if (container) visitGroup(container);
  };
  const visitGroup = (group: LayerGroup) => {
    if (visitedGroups.has(group.id)) return;
    visitedGroups.add(group.id);
    layers.filter((layer) => layer.groupId === group.id).forEach(visitLayer);
    groups
      .filter((child) => child.parentId === group.id && !child.containerLayerId)
      .forEach(visitGroup);
  };

  groups
    .filter(
      (group) =>
        !group.containerLayerId &&
        (!group.parentId || !groups.some((candidate) => candidate.id === group.parentId)),
    )
    .forEach(visitGroup);
  groups
    .filter((group) => !group.containerLayerId && !visitedGroups.has(group.id))
    .forEach(visitGroup);
  layers.filter((layer) => !visitedLayers.has(layer.id)).forEach(visitLayer);
  return ordered;
};

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [state, setState] = useState<WorkbenchState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapViewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosave = useRef(true);
  const bootUserId = useRef<string | null>(null);

  const patch = useCallback((p: Partial<WorkbenchState>) => setState((s) => ({ ...s, ...p })), []);

  const setShareQuery = useCallback((shareId: string | null) => {
    const url = new URL(window.location.href);
    if (shareId) url.searchParams.set("share", shareId);
    else url.searchParams.delete("share");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const loadShareIntoState = useCallback(
    async (userId: string, email: string, shareId: string, projects: ProjectSummary[]) => {
      const share = await shareStore.get(userId, email, shareId);
      if (!share) throw new Error("This shared map is unavailable or your access was removed");
      if (share.role === "admin") {
        const project = await workspaceProjectStore.load(userId, share.projectId);
        if (!project) throw new Error("The shared project could not be opened");
        skipNextAutosave.current = true;
        setState((current) => ({
          ...current,
          ...normalizedProject(project, projects, "admin", share),
        }));
        return;
      }
      const sharedState = applySharePermissions(
        await downloadSharedState(share.statePath),
        share.permissions,
      );
      const now = share.updatedAt;
      const sharedProject: StoredProject = {
        id: share.projectId,
        userId: share.ownerId,
        name: share.name,
        createdAt: share.createdAt,
        updatedAt: now,
        autosave: false,
        state: { ...sharedState, name: share.name, mapView: share.mapView },
        versions: [],
        parentProjectId: null,
        showInQuickSwitch: false,
        showInMobileBar: false,
      };
      skipNextAutosave.current = true;
      setState((current) => ({
        ...current,
        ...normalizedProject(sharedProject, projects, share.role, share),
      }));
    },
    [],
  );

  const hydrateSubprojectOverlays = useCallback(async (userId: string, project: StoredProject) => {
    const enabledIds = project.state.enabledSubprojectIds ?? [];
    const overlays = await Promise.all(
      enabledIds.map(async (projectId) => {
        const child = await workspaceProjectStore.load(userId, projectId);
        if (!child || child.parentProjectId !== project.id) return null;
        return {
          projectId,
          projectName: child.name,
          layers: child.state.layers.map((layer, index) => ({
            ...normalizedLayer(layer, index),
            id: `subproject:${projectId}:${layer.id}`,
            name: `${child.name} · ${layer.name}`,
            source:
              layer.source.kind === "derived"
                ? {
                    ...layer.source,
                    sourceLayerId: `subproject:${projectId}:${layer.source.sourceLayerId}`,
                  }
                : layer.source,
          })),
        };
      }),
    );
    setState((current) => ({
      ...current,
      subprojectOverlays: overlays.filter((item) => item !== null),
    }));
  }, []);

  const addLayer = useCallback<WorkbenchApi["addLayer"]>(
    (input) => {
      if (
        !sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
          .canEditProject
      )
        throw new Error("This shared map is view only.");
      const existing = stateRef.current.layers;
      const style =
        input.source.kind === "derived"
          ? derivedStyle(input.source.sourceLayerId, existing, input.style)
          : { ...defaultStyle(Math.floor(Math.random() * 6)), ...input.style };
      const layer: GisLayer = {
        id: uid(),
        name: input.name,
        groupId: input.groupId,
        visible: true,
        data: input.data,
        style,
        source: input.source,
        createdAt: Date.now(),
      };
      setState((s) => {
        const type: ProjectEventType =
          input.source.kind === "remote"
            ? "public-data"
            : input.source.kind === "import"
              ? "import"
              : "map";
        const event: ProjectEvent = {
          id: uid(),
          type: s.accessRole === "admin" ? "remote-change" : type,
          title: `Added ${input.name}`,
          detail:
            input.source.kind === "remote"
              ? "Connected public or remote data layer"
              : input.source.kind === "import"
                ? `Imported ${input.source.fileName}`
                : "Created a project map layer",
          createdAt: Date.now(),
          actor: auth.user?.name || auth.user?.email || "LandDraft user",
          projectId: s.projectId,
          projectName: s.projectName,
          relatedId: layer.id,
        };
        const groups = ensureCoreLayerGroups(s.groups).map((group) =>
          group.id === input.groupId ? { ...group, collapsed: false } : group,
        );
        return {
          ...s,
          groups,
          layers: [layer, ...s.layers],
          activeLayerId: layer.id,
          selectedLayerIds: [layer.id],
          records: { ...s.records, events: [event, ...s.records.events].slice(0, 1000) },
        };
      });
      return layer;
    },
    [auth.user?.email, auth.user?.name],
  );

  const updateLayer = useCallback<WorkbenchApi["updateLayer"]>((id, p) => {
    setState((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...p } : l)),
    }));
  }, []);

  const updateDisplayLayer = useCallback<WorkbenchApi["updateDisplayLayer"]>((id, p) => {
    setState((s) => {
      const previous =
        s.layers.find((layer) => layer.id === id) ??
        s.subprojectOverlays.flatMap((overlay) => overlay.layers).find((layer) => layer.id === id);
      const selections = s.selectedFeatures.filter((item) => item.layerId === id);
      const retained =
        previous && p.data && selections.length
          ? preserveSelectedFeatures(
              previous.data,
              p.data,
              selections.map((item) => item.index),
            )
          : null;
      const patch = retained ? { ...p, data: retained.data } : p;
      let selectedIndex = 0;
      const selectedFeatures = retained
        ? s.selectedFeatures.map((item) =>
            item.layerId === id ? { ...item, index: retained.indexes[selectedIndex++]! } : item,
          )
        : s.selectedFeatures;
      return {
        ...s,
        selectedFeatures,
        selectedFeature: selectedFeatures[0] ?? null,
        layers: s.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
        subprojectOverlays: s.subprojectOverlays.map((overlay) => ({
          ...overlay,
          layers: overlay.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
        })),
      };
    });
  }, []);

  const setLayerNote = useCallback<WorkbenchApi["setLayerNote"]>(
    (id, note) => {
      if (
        !sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
          .canEditProject
      )
        return;
      const nextNote = note.trim();
      const now = Date.now();
      setState((s) => {
        const layer = s.layers.find((item) => item.id === id);
        if (!layer || (layer.note ?? "") === nextNote) return s;
        const event: ProjectEvent = {
          id: uid(),
          type: s.accessRole === "admin" ? "remote-change" : "note",
          title: `${nextNote ? "Updated" : "Cleared"} layer note: ${layer.name}`,
          detail: nextNote.slice(0, 180),
          createdAt: now,
          actor: auth.user?.name || auth.user?.email || "LandDraft user",
          projectId: s.projectId,
          projectName: s.projectName,
          relatedId: layer.id,
        };
        return {
          ...s,
          layers: s.layers.map((item) =>
            item.id === id ? { ...item, note: nextNote, noteUpdatedAt: now } : item,
          ),
          records: { ...s.records, events: [event, ...s.records.events].slice(0, 1000) },
        };
      });
    },
    [auth.user?.email, auth.user?.name],
  );

  const updateStyle = useCallback<WorkbenchApi["updateStyle"]>((id, p) => {
    setState((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === id ? { ...l, style: { ...l.style, ...p } } : l)),
    }));
  }, []);

  const removeLayers = useCallback<WorkbenchApi["removeLayers"]>((ids) => {
    setState((s) => {
      const removedIds = new Set(ids);
      let groups = s.groups.map((group) => ({ ...group }));
      let layers = s.layers.filter((layer) => !removedIds.has(layer.id));
      const removedContainers = groups.filter(
        (group) => group.containerLayerId && removedIds.has(group.containerLayerId),
      );
      for (const container of removedContainers) {
        const fallbackGroupId =
          container.parentId && groups.some((group) => group.id === container.parentId)
            ? container.parentId
            : (groups.find((group) => !group.containerLayerId)?.id ?? "working");
        layers = layers.map((layer) =>
          layer.groupId === container.id ? { ...layer, groupId: fallbackGroupId } : layer,
        );
        groups = groups
          .filter((group) => group.id !== container.id)
          .map((group) =>
            group.parentId === container.id ? { ...group, parentId: fallbackGroupId } : group,
          );
      }
      return {
        ...s,
        groups,
        layers: orderedLayersForGroups(layers, groups),
        activeLayerId: removedIds.has(s.activeLayerId ?? "") ? null : s.activeLayerId,
        selectedLayerIds: s.selectedLayerIds.filter((id) => !removedIds.has(id)),
        selectedFeature:
          s.selectedFeature && removedIds.has(s.selectedFeature.layerId) ? null : s.selectedFeature,
        selectedFeatures: s.selectedFeatures.filter((item) => !removedIds.has(item.layerId)),
      };
    });
  }, []);

  const duplicateLayer = useCallback<WorkbenchApi["duplicateLayer"]>((id, targetGroupId) => {
    setState((s) => {
      const source = s.layers.find((l) => l.id === id);
      if (!source) return s;
      const copy: GisLayer = {
        ...source,
        id: uid(),
        name: `${source.name} copy`,
        groupId: targetGroupId ?? source.groupId,
        data: JSON.parse(JSON.stringify(source.data)) as FeatureCollection,
        source: { kind: "derived", sourceLayerId: source.id, query: "Duplicated layer" },
        style: derivedStyle(source.id, s.layers),
        createdAt: Date.now(),
      };
      const index = s.layers.findIndex((l) => l.id === id);
      const layers = [...s.layers];
      const firstInTarget = layers.findIndex((layer) => layer.groupId === copy.groupId);
      layers.splice(firstInTarget >= 0 ? firstInTarget : index, 0, copy);
      return { ...s, layers, activeLayerId: copy.id, selectedLayerIds: [copy.id] };
    });
  }, []);

  const reorderLayer = useCallback<WorkbenchApi["reorderLayer"]>(
    (id, targetGroupId, beforeLayerId) => {
      setState((s) => {
        const source = s.layers.find((layer) => layer.id === id);
        if (!source) return s;
        const moved = { ...source, groupId: targetGroupId };
        const layers = s.layers.filter((layer) => layer.id !== id);
        const beforeIndex = beforeLayerId
          ? layers.findIndex((layer) => layer.id === beforeLayerId)
          : -1;
        if (beforeIndex >= 0) layers.splice(beforeIndex, 0, moved);
        else {
          const lastInGroup = layers.reduce(
            (last, layer, index) => (layer.groupId === targetGroupId ? index : last),
            -1,
          );
          layers.splice(lastInGroup + 1, 0, moved);
        }
        const groups = s.groups.map((group) =>
          group.containerLayerId === id ? { ...group, parentId: targetGroupId } : group,
        );
        return {
          ...s,
          groups,
          layers: orderedLayersForGroups(layers, groups),
          activeLayerId: id,
          selectedLayerIds: [id],
        };
      });
    },
    [],
  );

  const reorderGroup = useCallback<WorkbenchApi["reorderGroup"]>((id, targetGroupId, position) => {
    setState((s) => {
      const source = s.groups.find((group) => group.id === id);
      const target = s.groups.find((group) => group.id === targetGroupId);
      if (!source || !target || source.id === target.id) return s;
      // A group cannot be nested inside one of its own descendants.
      if (descendantGroupIds(source.id, s.groups).has(target.id)) return s;

      const groups = s.groups.filter((group) => group.id !== id);
      if (position === "inside") {
        // Appending makes the dropped group the final child while the tree flattener keeps its
        // complete descendant stack together. This works at every nesting depth.
        groups.push({ ...source, parentId: target.id });
      } else {
        const targetIndex = groups.findIndex((group) => group.id === targetGroupId);
        if (targetIndex < 0) return s;
        const sibling = { ...source };
        if (target.parentId) sibling.parentId = target.parentId;
        else delete sibling.parentId;
        groups.splice(targetIndex + (position === "after" ? 1 : 0), 0, sibling);
      }

      // Keep every group's complete layer stack together while preserving
      // the existing order of the layers within each group.
      const layers = orderedLayersForGroups(s.layers, groups);

      return { ...s, groups, layers };
    });
  }, []);

  const nestGroupInLayer = useCallback<WorkbenchApi["nestGroupInLayer"]>((groupId, layerId) => {
    setState((s) => {
      const sourceGroup = s.groups.find((group) => group.id === groupId);
      const targetLayer = s.layers.find((layer) => layer.id === layerId);
      if (!sourceGroup || !targetLayer) return s;

      // A group cannot contain a layer that is already inside that group or one of its children.
      if (descendantGroupIds(sourceGroup.id, s.groups).has(targetLayer.groupId)) return s;

      let groups = [...s.groups];
      let container = groups.find((group) => group.containerLayerId === targetLayer.id);
      if (!container) {
        container = {
          id: uid(),
          name: `${targetLayer.name} sublayers`,
          collapsed: false,
          parentId: targetLayer.groupId,
          containerLayerId: targetLayer.id,
        };
        const parentIndex = groups.findIndex((group) => group.id === targetLayer.groupId);
        groups.splice(parentIndex >= 0 ? parentIndex + 1 : groups.length, 0, container);
      }
      if (sourceGroup.parentId === container.id) return s;

      groups = groups.map((group) =>
        group.id === sourceGroup.id
          ? { ...group, parentId: container.id }
          : group.id === container.id
            ? { ...group, parentId: targetLayer.groupId }
            : group,
      );
      return {
        ...s,
        groups,
        layers: orderedLayersForGroups(s.layers, groups),
        selectedGroupIds: [sourceGroup.id],
      };
    });
  }, []);

  const nestLayerInLayer = useCallback<WorkbenchApi["nestLayerInLayer"]>(
    (layerId, targetLayerId) => {
      setState((s) => {
        const sourceLayer = s.layers.find((layer) => layer.id === layerId);
        const targetLayer = s.layers.find((layer) => layer.id === targetLayerId);
        if (!sourceLayer || !targetLayer || sourceLayer.id === targetLayer.id) return s;

        const sourceContainer = s.groups.find((group) => group.containerLayerId === sourceLayer.id);
        if (
          sourceContainer &&
          descendantGroupIds(sourceContainer.id, s.groups).has(targetLayer.groupId)
        )
          return s;

        let groups = [...s.groups];
        let targetContainer = groups.find((group) => group.containerLayerId === targetLayer.id);
        if (!targetContainer) {
          targetContainer = {
            id: uid(),
            name: `${targetLayer.name} sublayers`,
            collapsed: false,
            parentId: targetLayer.groupId,
            containerLayerId: targetLayer.id,
          };
          const parentIndex = groups.findIndex((group) => group.id === targetLayer.groupId);
          groups.splice(parentIndex >= 0 ? parentIndex + 1 : groups.length, 0, targetContainer);
        } else if (targetContainer.parentId !== targetLayer.groupId) {
          groups = groups.map((group) =>
            group.id === targetContainer?.id ? { ...group, parentId: targetLayer.groupId } : group,
          );
        }

        groups = groups.map((group) =>
          group.containerLayerId === sourceLayer.id
            ? { ...group, parentId: targetContainer.id }
            : group,
        );
        const layers = s.layers.map((layer) =>
          layer.id === sourceLayer.id ? { ...layer, groupId: targetContainer.id } : layer,
        );
        return {
          ...s,
          groups,
          layers: orderedLayersForGroups(layers, groups),
          activeLayerId: sourceLayer.id,
          selectedLayerIds: [sourceLayer.id],
        };
      });
    },
    [],
  );

  const toggleVisible = useCallback<WorkbenchApi["toggleVisible"]>((id) => {
    setState((s) => {
      const layer = s.layers.find((item) => item.id === id);
      if (!layer) return s;
      const visible = !layer.visible;
      const container = s.groups.find((group) => group.containerLayerId === id);
      const childGroupIds = container ? descendantGroupIds(container.id, s.groups) : new Set();
      return {
        ...s,
        layers: s.layers.map((item) =>
          item.id === id || childGroupIds.has(item.groupId) ? { ...item, visible } : item,
        ),
      };
    });
  }, []);

  const moveLayer = useCallback<WorkbenchApi["moveLayer"]>((id, direction) => {
    setState((s) => {
      const index = s.layers.findIndex((l) => l.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= s.layers.length) return s;
      const layers = [...s.layers];
      const [moved] = layers.splice(index, 1);
      if (!moved) return s;
      layers.splice(target, 0, moved);
      return { ...s, layers };
    });
  }, []);

  const moveLayerToEdge = useCallback<WorkbenchApi["moveLayerToEdge"]>((id, edge) => {
    setState((s) => {
      const moved = s.layers.find((layer) => layer.id === id);
      if (!moved) return s;
      const layers = s.layers.filter((layer) => layer.id !== id);
      if (edge === "front") layers.unshift(moved);
      else layers.push(moved);
      return { ...s, layers, activeLayerId: id, selectedLayerIds: [id] };
    });
  }, []);

  const setLayerGroup = useCallback<WorkbenchApi["setLayerGroup"]>(
    (id, groupId) => reorderLayer(id, groupId),
    [reorderLayer],
  );

  const addGroup = useCallback<WorkbenchApi["addGroup"]>((name) => {
    const id = uid();
    setState((s) => ({ ...s, groups: [{ id, name, collapsed: false }, ...s.groups] }));
    return id;
  }, []);

  const addSubgroup = useCallback<WorkbenchApi["addSubgroup"]>((parentId, name) => {
    setState((s) => ({
      ...s,
      groups: [...s.groups, { id: uid(), name, collapsed: false, parentId }],
    }));
  }, []);

  const renameGroup = useCallback<WorkbenchApi["renameGroup"]>((id, name) => {
    const nextName = name.trim();
    if (!nextName) return;
    setState((s) => ({
      ...s,
      groups: s.groups.map((group) => (group.id === id ? { ...group, name: nextName } : group)),
    }));
  }, []);

  const groupSelectedGroups = useCallback<WorkbenchApi["groupSelectedGroups"]>((ids, name) => {
    const nextName = name.trim();
    if (!nextName) return;
    setState((s) => {
      const selected = new Set(ids.filter((id) => s.groups.some((group) => group.id === id)));
      if (!selected.size) return s;

      const hasSelectedAncestor = (group: LayerGroup) => {
        const seen = new Set<string>();
        let parentId = group.parentId;
        while (parentId && !seen.has(parentId)) {
          if (selected.has(parentId)) return true;
          seen.add(parentId);
          parentId = s.groups.find((item) => item.id === parentId)?.parentId;
        }
        return false;
      };
      const selectedRoots = s.groups.filter(
        (group) => selected.has(group.id) && !hasSelectedAncestor(group),
      );
      if (!selectedRoots.length) return s;

      const parentIds = new Set(selectedRoots.map((group) => group.parentId ?? null));
      const parentId = parentIds.size === 1 ? (selectedRoots[0]?.parentId ?? null) : null;
      const newGroup: LayerGroup = {
        id: uid(),
        name: nextName,
        collapsed: false,
        ...(parentId ? { parentId } : {}),
      };
      const firstIndex = Math.min(
        ...selectedRoots.map((group) => s.groups.findIndex((item) => item.id === group.id)),
      );
      const groups = s.groups.map((group) =>
        selectedRoots.some((item) => item.id === group.id)
          ? { ...group, parentId: newGroup.id }
          : group,
      );
      groups.splice(Math.max(firstIndex, 0), 0, newGroup);
      return {
        ...s,
        groups,
        layers: orderedLayersForGroups(s.layers, groups),
        selectedGroupIds: [newGroup.id],
      };
    });
  }, []);

  const removeGroup = useCallback<WorkbenchApi["removeGroup"]>((id) => {
    setState((s) => {
      const group = s.groups.find((item) => item.id === id);
      if (!group) return s;
      const removedIds = descendantGroupIds(id, s.groups);
      let groups = s.groups.filter((item) => !removedIds.has(item.id));
      let targetGroupId =
        (group.parentId && groups.some((item) => item.id === group.parentId)
          ? group.parentId
          : null) ??
        (id !== "working" && groups.some((item) => item.id === "working") ? "working" : null) ??
        groups.find((item) => !item.parentId)?.id ??
        groups[0]?.id;

      if (!targetGroupId) {
        targetGroupId = "working";
        groups = [{ id: targetGroupId, name: "Working layers", collapsed: false }];
      }

      const reassignedLayers = s.layers.map((layer) =>
        removedIds.has(layer.groupId) ? { ...layer, groupId: targetGroupId } : layer,
      );
      return {
        ...s,
        groups,
        layers: orderedLayersForGroups(reassignedLayers, groups),
        derivedLayerGroupId: removedIds.has(s.derivedLayerGroupId)
          ? targetGroupId
          : s.derivedLayerGroupId,
        selectedGroupIds: s.selectedGroupIds.filter((groupId) => !removedIds.has(groupId)),
      };
    });
  }, []);

  const toggleGroup = useCallback<WorkbenchApi["toggleGroup"]>((id) => {
    setState((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)),
    }));
  }, []);

  const setGroupVisible = useCallback<WorkbenchApi["setGroupVisible"]>((id, visible) => {
    setState((s) => {
      const groupIds = descendantGroupIds(id, s.groups);
      return {
        ...s,
        layers: s.layers.map((layer) =>
          groupIds.has(layer.groupId) ? { ...layer, visible } : layer,
        ),
      };
    });
  }, []);

  const applyStyleToGroup = useCallback<WorkbenchApi["applyStyleToGroup"]>((id, stylePatch) => {
    setState((s) => {
      return { ...s, layers: applyGroupStyle(s.layers, s.groups, id, stylePatch) };
    });
  }, []);

  const toggleLayerSelection = useCallback<WorkbenchApi["toggleLayerSelection"]>((id, additive) => {
    setState((s) => {
      const selected = toggleLayerTreeSelection(
        id,
        additive,
        s.selectedLayerIds,
        s.layers,
        s.groups,
      );
      return { ...s, selectedLayerIds: selected, activeLayerId: id };
    });
  }, []);

  const appendFeature = useCallback<WorkbenchApi["appendFeature"]>((layerId, feature) => {
    if (
      !sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
        .canEditProject
    )
      return;
    setState((s) => ({
      ...s,
      layers: s.layers.map((l) =>
        l.id === layerId
          ? { ...l, data: { type: "FeatureCollection", features: [...l.data.features, feature] } }
          : l,
      ),
    }));
  }, []);

  const updateFeatureProperties = useCallback<WorkbenchApi["updateFeatureProperties"]>(
    (layerId, index, properties) => {
      if (
        !sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
          .canEditProject
      )
        return;
      setState((s) => ({
        ...s,
        layers: s.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          return {
            ...layer,
            data: {
              type: "FeatureCollection",
              features: layer.data.features.map((feature, featureIndex) =>
                featureIndex === index
                  ? { ...feature, properties: { ...(feature.properties ?? {}), ...properties } }
                  : feature,
              ),
            },
          };
        }),
      }));
    },
    [],
  );

  const updateFeaturesProperties = useCallback<WorkbenchApi["updateFeaturesProperties"]>(
    (layerId, updates) => {
      if (
        !sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
          .canEditProject
      )
        return;
      if (updates.length === 0) return;
      const updatesByIndex = new Map(updates.map((update) => [update.index, update.properties]));
      setState((s) => ({
        ...s,
        layers: s.layers.map((layer) => {
          if (layer.id !== layerId) return layer;
          return {
            ...layer,
            data: {
              type: "FeatureCollection",
              features: layer.data.features.map((feature, featureIndex) => {
                const properties = updatesByIndex.get(featureIndex);
                return properties
                  ? { ...feature, properties: { ...(feature.properties ?? {}), ...properties } }
                  : feature;
              }),
            },
          };
        }),
      }));
    },
    [],
  );

  const updateFeatureGeometry = useCallback<WorkbenchApi["updateFeatureGeometry"]>(
    (layerId, index, geometry) => {
      if (
        !sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
          .canEditProject
      )
        return;
      setState((s) => ({
        ...s,
        layers: s.layers.map((layer) =>
          layer.id === layerId
            ? {
                ...layer,
                data: {
                  type: "FeatureCollection",
                  features: layer.data.features.map((feature, featureIndex) =>
                    featureIndex === index ? { ...feature, geometry } : feature,
                  ),
                },
              }
            : layer,
        ),
      }));
    },
    [],
  );

  const removeFeatures = useCallback<WorkbenchApi["removeFeatures"]>((layerId, indexes) => {
    if (
      !sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
        .canEditProject
    )
      return;
    const removed = new Set(indexes);
    if (removed.size === 0) return;
    setState((current) => {
      const remap = (selection: SelectedFeature): SelectedFeature | null => {
        if (selection.layerId !== layerId) return selection;
        if (removed.has(selection.index)) return null;
        let offset = 0;
        for (const index of removed) if (index < selection.index) offset += 1;
        return { ...selection, index: selection.index - offset };
      };
      const selectedFeatures = current.selectedFeatures
        .map(remap)
        .filter((selection): selection is SelectedFeature => selection !== null);
      return {
        ...current,
        layers: current.layers.map((layer) =>
          layer.id === layerId
            ? {
                ...layer,
                data: {
                  type: "FeatureCollection",
                  features: layer.data.features.filter((_, index) => !removed.has(index)),
                },
              }
            : layer,
        ),
        selectedFeatures,
        selectedFeature: selectedFeatures[0] ?? null,
      };
    });
  }, []);

  const setAssistantConversation = useCallback<WorkbenchApi["setAssistantConversation"]>(
    (assistant) => {
      if (
        sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
          .canUseAi
      )
        patch({ assistant });
    },
    [patch],
  );

  const setProjectRecords = useCallback<WorkbenchApi["setProjectRecords"]>(
    (records) => {
      if (
        sharedCapabilities(stateRef.current.accessRole, stateRef.current.activeShare?.permissions)
          .canEditProject
      )
        patch({ records });
    },
    [patch],
  );
  const setPipelineEngineering = useCallback<WorkbenchApi["setPipelineEngineering"]>(
    (pipelineEngineering) => patch({ pipelineEngineering }),
    [patch],
  );
  const setWaterWorkspace = useCallback<WorkbenchApi["setWaterWorkspace"]>(
    (waterWorkspace) => patch({ waterWorkspace }),
    [patch],
  );
  const setWeatherWorkspace = useCallback<WorkbenchApi["setWeatherWorkspace"]>(
    (weatherWorkspace) => patch({ weatherWorkspace }),
    [patch],
  );

  const addProjectEvent = useCallback<WorkbenchApi["addProjectEvent"]>(
    (input) =>
      setState((current) => {
        const event: ProjectEvent = {
          id: uid(),
          type: input.type,
          title: input.title,
          detail: input.detail ?? "",
          createdAt: Date.now(),
          actor: auth.user?.name || auth.user?.email || "LandDraft user",
          projectId: current.projectId,
          projectName: current.projectName,
          ...(input.relatedId ? { relatedId: input.relatedId } : {}),
        };
        return {
          ...current,
          records: {
            ...current.records,
            events: [event, ...current.records.events].slice(0, 1000),
          },
        };
      }),
    [auth.user?.email, auth.user?.name],
  );

  const toProjectState = useCallback<WorkbenchApi["toProjectState"]>(
    () => stateToProject(state),
    [state],
  );

  const saveProject = useCallback<WorkbenchApi["saveProject"]>(
    async (reason = "manual") => {
      const userId = auth.user?.id;
      const current = stateRef.current;
      if (
        !userId ||
        !current.projectId ||
        !current.projectReady ||
        !["owner", "admin"].includes(current.accessRole)
      )
        return;
      const project = await workspaceProjectStore.save(
        userId,
        current.projectId,
        stateToProject(current),
        reason,
      );
      const projects = await workspaceProjectStore.list(userId);
      setState((value) => ({
        ...value,
        projects,
        saveHistory: project.versions,
        projectRecoveryNotice: null,
        lastSavedAt: project.updatedAt,
      }));
      return project.versions[0];
    },
    [auth.user?.id],
  );

  const setProjectArea = useCallback<WorkbenchApi["setProjectArea"]>(
    async (view) => {
      const userId = auth.user?.id;
      const current = stateRef.current;
      if (
        !userId ||
        !current.projectId ||
        !current.projectReady ||
        !["owner", "admin"].includes(current.accessRole)
      )
        return;

      const projectArea = view
        ? {
            ...view,
            center: [...view.center] as [number, number],
          }
        : undefined;
      const nextState: WorkbenchState = { ...current, projectArea };
      skipNextAutosave.current = true;
      setState(nextState);

      try {
        const project = await workspaceProjectStore.save(
          userId,
          current.projectId,
          stateToProject(nextState),
          "manual",
        );
        const projects = await workspaceProjectStore.list(userId);
        setState((value) => ({
          ...value,
          projectArea,
          projects,
          saveHistory: project.versions,
          lastSavedAt: project.updatedAt,
        }));
      } catch (error) {
        setState((value) => ({ ...value, projectArea: current.projectArea }));
        throw error;
      }
    },
    [auth.user?.id],
  );

  const createProject = useCallback<WorkbenchApi["createProject"]>(
    async (rawName) => {
      const userId = auth.user?.id;
      if (!userId) return;
      const name = rawName.trim() || "Untitled project";
      const project = await workspaceProjectStore.create(userId, name, blankProjectState(name));
      const projects = await workspaceProjectStore.list(userId);
      skipNextAutosave.current = true;
      setState((current) => ({ ...current, ...normalizedProject(project, projects) }));
    },
    [auth.user?.id],
  );

  const createSubproject = useCallback<WorkbenchApi["createSubproject"]>(
    async (rawName, requestedParentId) => {
      const userId = auth.user?.id;
      if (!userId) return;
      const parentId = requestedParentId ?? stateRef.current.projectId;
      const name = rawName.trim() || `${stateRef.current.projectName} area`;
      const { printComposition: _printComposition, ...sourceState } = stateToProject(
        stateRef.current,
      );
      const startingState: ProjectState = {
        ...sourceState,
        name,
        parentProjectId: parentId,
        enabledSubprojectIds: [],
      };
      const project = await workspaceProjectStore.create(userId, name, startingState, parentId);
      const projects = await workspaceProjectStore.list(userId);
      skipNextAutosave.current = true;
      setState((current) => ({ ...current, ...normalizedProject(project, projects) }));
    },
    [auth.user?.id],
  );

  const duplicateProject = useCallback<WorkbenchApi["duplicateProject"]>(
    async (id) => {
      const userId = auth.user?.id;
      if (!userId) return;
      const source = await workspaceProjectStore.load(userId, id);
      if (!source) throw new Error("Project was not found");
      const name = `${source.name} copy`;
      const stateCopy: ProjectState = {
        ...source.state,
        name,
        enabledSubprojectIds: [],
      };
      const project = await workspaceProjectStore.create(
        userId,
        name,
        stateCopy,
        source.parentProjectId,
        {
          showInQuickSwitch: source.showInQuickSwitch,
          showInMobileBar: source.showInMobileBar,
        },
      );
      const projects = await workspaceProjectStore.list(userId);
      skipNextAutosave.current = true;
      setState((current) => ({ ...current, ...normalizedProject(project, projects) }));
    },
    [auth.user?.id],
  );

  const duplicateVersion = useCallback<WorkbenchApi["duplicateVersion"]>(
    async (versionId) => {
      const userId = auth.user?.id;
      const current = stateRef.current;
      const version = current.saveHistory.find((item) => item.id === versionId);
      if (!userId || !version || !current.projectId) return;
      const versionState = await workspaceProjectStore.loadVersion(version);
      const versionLabel = projectVersionLabel(version.savedAt);
      const name = `${current.projectName} — ${versionLabel} copy`;
      const sourceSummary = current.projects.find((project) => project.id === current.projectId);
      const stateCopy: ProjectState = {
        ...versionState,
        landDraftVersion: LANDDRAFT_APP_VERSION,
        name,
        enabledSubprojectIds: [],
      };
      const project = await workspaceProjectStore.create(
        userId,
        name,
        stateCopy,
        current.parentProjectId,
        {
          showInQuickSwitch: sourceSummary?.showInQuickSwitch ?? true,
          showInMobileBar: sourceSummary?.showInMobileBar ?? true,
        },
      );
      const projects = await workspaceProjectStore.list(userId);
      skipNextAutosave.current = true;
      setState((value) => ({ ...value, ...normalizedProject(project, projects) }));
    },
    [auth.user?.id],
  );

  const moveProject = useCallback<WorkbenchApi["moveProject"]>(
    async (id, parentId) => {
      const userId = auth.user?.id;
      if (!userId) throw new Error("Sign in to move a project.");
      const projects = stateRef.current.projects;
      if (!projects.some((p) => p.id === id) || !projects.some((p) => p.id === parentId))
        throw new Error("Project unavailable.");
      const visited = new Set<string>([id]);
      let ancestor: string | null = parentId;
      while (ancestor) {
        if (visited.has(ancestor))
          throw new Error("A project cannot be moved under itself or its descendants.");
        visited.add(ancestor);
        ancestor = projects.find((p) => p.id === ancestor)?.parentProjectId ?? null;
      }
      await workspaceProjectStore.setParent(userId, id, parentId);
      const refreshed = await workspaceProjectStore.list(userId);
      setState((current) => ({
        ...current,
        projects: refreshed,
        enabledSubprojectIds: current.enabledSubprojectIds.filter((value) => value !== id),
        subprojectOverlays: current.subprojectOverlays.filter((value) => value.projectId !== id),
        ...(current.projectId === id ? { parentProjectId: parentId } : {}),
      }));
    },
    [auth.user?.id],
  );

  const promoteProject = useCallback<WorkbenchApi["promoteProject"]>(
    async (id) => {
      const userId = auth.user?.id;
      if (!userId) return;
      await workspaceProjectStore.setParent(userId, id, null);
      const projects = await workspaceProjectStore.list(userId);
      setState((current) => ({
        ...current,
        projects,
        ...(current.projectId === id ? { parentProjectId: null } : {}),
      }));
    },
    [auth.user?.id],
  );

  const toggleSubprojectOverlay = useCallback<WorkbenchApi["toggleSubprojectOverlay"]>(
    async (id, enabled) => {
      const userId = auth.user?.id;
      const current = stateRef.current;
      if (!userId) return;
      const enabledSubprojectIds = enabled
        ? Array.from(new Set([...current.enabledSubprojectIds, id]))
        : current.enabledSubprojectIds.filter((projectId) => projectId !== id);
      setState((value) => ({
        ...value,
        enabledSubprojectIds,
        subprojectOverlays: enabled
          ? value.subprojectOverlays
          : value.subprojectOverlays.filter((overlay) => overlay.projectId !== id),
      }));
      if (enabled) {
        const child = await workspaceProjectStore.load(userId, id);
        if (child) {
          const overlay = {
            projectId: id,
            projectName: child.name,
            layers: child.state.layers.map((layer, index) => ({
              ...normalizedLayer(layer, index),
              id: `subproject:${id}:${layer.id}`,
              name: `${child.name} · ${layer.name}`,
            })),
          };
          setState((value) => ({
            ...value,
            subprojectOverlays: [
              overlay,
              ...value.subprojectOverlays.filter((item) => item.projectId !== id),
            ],
          }));
        }
      }
    },
    [auth.user?.id],
  );

  const openProject = useCallback<WorkbenchApi["openProject"]>(
    async (id) => {
      const userId = auth.user?.id;
      if (!userId || id === stateRef.current.projectId) return;
      const project = await workspaceProjectStore.load(userId, id);
      if (!project) throw new Error("Project was not found");
      const projects = await workspaceProjectStore.list(userId);
      skipNextAutosave.current = true;
      setState((current) => ({ ...current, ...normalizedProject(project, projects) }));
      setShareQuery(null);
      void hydrateSubprojectOverlays(userId, project);
    },
    [auth.user?.id, hydrateSubprojectOverlays, setShareQuery],
  );

  const openSharedMap = useCallback<WorkbenchApi["openSharedMap"]>(
    async (id) => {
      const userId = auth.user?.id;
      const email = auth.user?.email ?? "";
      if (!userId) return;
      const projects = await workspaceProjectStore.list(userId);
      await loadShareIntoState(userId, email, id, projects);
      setShareQuery(id);
    },
    [auth.user?.email, auth.user?.id, loadShareIntoState, setShareQuery],
  );

  const createSharedWorkingCopy = useCallback<WorkbenchApi["createSharedWorkingCopy"]>(async () => {
    const userId = auth.user?.id;
    const current = stateRef.current;
    if (!userId || !current.activeShare || current.activeShare.role !== "editor") return;
    const projectId = await shareStore.createWorkingCopy({
      userId,
      share: current.activeShare,
      state: stateToProject(current),
    });
    const project = await workspaceProjectStore.load(userId, projectId);
    if (!project) throw new Error("Your editable copy could not be opened");
    const projects = await workspaceProjectStore.list(userId);
    skipNextAutosave.current = true;
    setState((value) => ({ ...value, ...normalizedProject(project, projects) }));
    setShareQuery(null);
  }, [auth.user?.id, setShareQuery]);

  const openReviewProject = useCallback<WorkbenchApi["openReviewProject"]>(
    async (id) => {
      const userId = auth.user?.id;
      if (!userId) return;
      const project = await workspaceProjectStore.load(userId, id);
      if (!project) throw new Error("The submitted map could not be opened");
      const projects = await workspaceProjectStore.list(userId);
      skipNextAutosave.current = true;
      setState((current) => ({ ...current, ...normalizedProject(project, projects, "viewer") }));
      setShareQuery(null);
    },
    [auth.user?.id, setShareQuery],
  );

  const deleteProject = useCallback<WorkbenchApi["deleteProject"]>(
    async (id) => {
      const userId = auth.user?.id;
      if (!userId) return;
      await workspaceProjectStore.remove(userId, id);
      let projects = await workspaceProjectStore.list(userId);
      if (id !== stateRef.current.projectId) {
        setState((current) => ({ ...current, projects }));
        return;
      }
      const next = projects[0];
      if (next) {
        const project = await workspaceProjectStore.load(userId, next.id);
        if (project)
          setState((current) => ({ ...current, ...normalizedProject(project, projects) }));
      } else {
        const project = await workspaceProjectStore.create(
          userId,
          "Untitled project",
          blankProjectState("Untitled project"),
        );
        projects = await workspaceProjectStore.list(userId);
        setState((current) => ({ ...current, ...normalizedProject(project, projects) }));
      }
      skipNextAutosave.current = true;
    },
    [auth.user?.id],
  );

  const restoreVersion = useCallback<WorkbenchApi["restoreVersion"]>(
    async (versionId) => {
      const userId = auth.user?.id;
      const current = stateRef.current;
      const version = current.saveHistory.find((item) => item.id === versionId);
      if (!userId || !version) return;
      const versionState = await workspaceProjectStore.loadVersion(version);
      const project = await workspaceProjectStore.save(
        userId,
        current.projectId,
        versionState,
        "restored",
      );
      const projects = await workspaceProjectStore.list(userId);
      skipNextAutosave.current = true;
      setState((value) => ({ ...value, ...normalizedProject(project, projects) }));
    },
    [auth.user?.id],
  );

  const setAutosave = useCallback<WorkbenchApi["setAutosave"]>(
    async (enabled) => {
      const userId = auth.user?.id;
      const projectId = stateRef.current.projectId;
      if (!userId || !projectId) return;
      await workspaceProjectStore.setAutosave(userId, projectId, enabled);
      setState((current) => ({
        ...current,
        autosave: enabled,
        projects: current.projects.map((project) =>
          project.id === projectId ? { ...project, autosave: enabled } : project,
        ),
      }));
    },
    [auth.user?.id],
  );

  const setProjectNavigationVisibility = useCallback<
    WorkbenchApi["setProjectNavigationVisibility"]
  >(
    async (id, visibility) => {
      const userId = auth.user?.id;
      if (!userId) return;
      await workspaceProjectStore.setNavigationVisibility(userId, id, visibility);
      setState((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === id ? { ...project, ...visibility } : project,
        ),
      }));
    },
    [auth.user?.id],
  );

  const setPrintComposition = useCallback<WorkbenchApi["setPrintComposition"]>(
    (composition) => patch({ printComposition: composition }),
    [patch],
  );

  const setConnectionHint = useCallback<WorkbenchApi["setConnectionHint"]>(
    (id, hint) =>
      setState((current) => ({
        ...current,
        connectionHints: { ...current.connectionHints, [id]: hint },
      })),
    [],
  );

  useEffect(() => {
    const userId = auth.user?.id;
    const share = state.activeShare;
    if (
      !userId ||
      !share ||
      (!["viewer", "editor"].includes(state.accessRole) && share.ownerId === userId)
    )
      return;
    let checking = false;
    const checkForShareUpdate = async () => {
      if (checking) return;
      checking = true;
      try {
        const latest = await shareStore.get(userId, auth.user?.email ?? "", share.id);
        if (!latest) {
          const project = await workspaceProjectStore.loadLast(userId);
          const projects = await workspaceProjectStore.list(userId);
          if (project) {
            skipNextAutosave.current = true;
            setState((current) => ({ ...current, ...normalizedProject(project, projects) }));
            setShareQuery(null);
          }
          return;
        }
        if (latest.updatedAt > share.updatedAt || latest.role !== state.accessRole) {
          const projects = await workspaceProjectStore.list(userId);
          await loadShareIntoState(userId, auth.user?.email ?? "", share.id, projects);
        }
      } catch (error) {
        console.warn("Shared map refresh will retry", error);
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void checkForShareUpdate(), 15_000);
    return () => window.clearInterval(timer);
  }, [
    auth.user?.email,
    auth.user?.id,
    loadShareIntoState,
    setShareQuery,
    state.accessRole,
    state.activeShare,
  ]);

  useEffect(() => {
    const userId = auth.user?.id;
    if (!userId || bootUserId.current === userId) return;
    bootUserId.current = userId;
    void (async () => {
      try {
        await workspaceProjectStore.migrateLocalAccount(userId, auth.user?.email ?? "");
        const projects = await workspaceProjectStore.list(userId);
        setState((current) => ({ ...current, projects }));
        const requestedShareId = new URL(window.location.href).searchParams.get("share");
        if (requestedShareId) {
          await loadShareIntoState(userId, auth.user?.email ?? "", requestedShareId, projects);
          return;
        }
        let project = await workspaceProjectStore.loadLast(userId);
        if (!project) {
          const legacy = await workspaceProjectStore.readLegacy();
          const initial = legacy ?? blankProjectState("Untitled project");
          project = await workspaceProjectStore.create(userId, initial.name, initial);
        }
        const refreshedProjects = await workspaceProjectStore.list(userId);
        skipNextAutosave.current = true;
        setState((current) => ({ ...current, ...normalizedProject(project, refreshedProjects) }));
        void hydrateSubprojectOverlays(userId, project);
      } catch (error) {
        setState((current) => ({
          ...current,
          projectError:
            error instanceof Error ? error.message : "The cloud workspace could not be opened",
        }));
      }
    })();
  }, [auth.user?.email, auth.user?.id, hydrateSubprojectOverlays, loadShareIntoState]);

  useEffect(() => {
    const userId = auth.user?.id;
    if (
      !userId ||
      !state.projectReady ||
      !state.projectId ||
      !["owner", "admin"].includes(state.accessRole)
    )
      return;
    if (mapViewTimer.current) clearTimeout(mapViewTimer.current);
    mapViewTimer.current = setTimeout(
      () =>
        void workspaceProjectStore
          .setMapView(userId, state.projectId, state.mapView)
          .catch((error) => console.warn("Map position will be saved again", error)),
      700,
    );
    return () => {
      if (mapViewTimer.current) clearTimeout(mapViewTimer.current);
    };
  }, [auth.user?.id, state.accessRole, state.mapView, state.projectId, state.projectReady]);

  useEffect(() => {
    if (
      !state.projectReady ||
      !state.autosave ||
      !auth.user ||
      !["owner", "admin"].includes(state.accessRole)
    )
      return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const hasLargeEditableImport = state.layers.some(
      (layer) =>
        layer.source.kind === "import" &&
        ((layer.source.fileSizeBytes ?? 0) >= 8 * 1024 * 1024 ||
          (layer.source.coordinateCount ?? 0) >= 200_000 ||
          layer.data.features.length >= 10_000),
    );
    autosaveTimer.current = setTimeout(
      () => void saveProject("autosave"),
      hasLargeEditableImport ? 10_000 : 1_500,
    );
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [
    auth.user,
    saveProject,
    state.autosave,
    state.basemapId,
    state.mapView,
    state.projectArea,
    state.groups,
    state.layers,
    state.projectId,
    state.projectName,
    state.projectReady,
    state.selectedStates,
    state.derivedLayerGroupId,
    state.enabledSubprojectIds,
    state.parentProjectId,
    state.printComposition,
    state.assistant,
    state.connectionHints,
    state.records,
    state.pipelineEngineering,
    state.weatherWorkspace,
    state.waterWorkspace,
    state.units,
    state.accessRole,
  ]);

  const value = useMemo<WorkbenchApi>(
    () => ({
      ...state,
      addLayer,
      updateLayer,
      updateDisplayLayer,
      setLayerNote,
      updateStyle,
      removeLayers,
      duplicateLayer,
      toggleVisible,
      moveLayer,
      moveLayerToEdge,
      reorderLayer,
      reorderGroup,
      nestGroupInLayer,
      nestLayerInLayer,
      setLayerGroup,
      addGroup,
      addSubgroup,
      renameGroup,
      groupSelectedGroups,
      removeGroup,
      toggleGroup,
      toggleGroupSelection: (id) =>
        setState((current) => ({
          ...current,
          selectedGroupIds: current.selectedGroupIds.includes(id)
            ? current.selectedGroupIds.filter((groupId) => groupId !== id)
            : [...current.selectedGroupIds, id],
        })),
      setSelectedGroups: (ids) =>
        setState((current) => {
          const available = new Set(current.groups.map((group) => group.id));
          return {
            ...current,
            selectedGroupIds: Array.from(new Set(ids)).filter((id) => available.has(id)),
          };
        }),
      setGroupVisible,
      applyStyleToGroup,
      setActiveLayer: (id) => patch({ activeLayerId: id }),
      toggleLayerSelection,
      setSelectedLayers: (ids) =>
        setState((current) => {
          const available = new Set(current.layers.map((layer) => layer.id));
          const selectedLayerIds = Array.from(new Set(ids)).filter((id) => available.has(id));
          return {
            ...current,
            selectedLayerIds,
            activeLayerId:
              selectedLayerIds.at(-1) ??
              (current.activeLayerId && available.has(current.activeLayerId)
                ? current.activeLayerId
                : null),
          };
        }),
      setSelectedFeature: (sel) =>
        patch({ selectedFeature: sel, selectedFeatures: sel ? [sel] : [] }),
      setSelectedFeatures: (selections) =>
        patch({ selectedFeatures: selections, selectedFeature: selections[0] ?? null }),
      setDrawMode: (mode) => {
        if (mode === "none" || state.accessRole === "owner" || state.accessRole === "admin")
          patch({ drawMode: mode });
      },
      setSnapEnabled: (enabled) => patch({ snapEnabled: enabled }),
      setSelectedStates: (states) => patch({ selectedStates: states }),
      setDerivedLayerGroupId: (groupId) => patch({ derivedLayerGroupId: groupId }),
      setBasemapId: (id) => patch({ basemapId: id }),
      setMapView: (mapView) =>
        setState((current) => {
          const previous = current.mapView;
          if (
            Math.abs(previous.center[0] - mapView.center[0]) < 1e-7 &&
            Math.abs(previous.center[1] - mapView.center[1]) < 1e-7 &&
            Math.abs(previous.zoom - mapView.zoom) < 1e-4 &&
            Math.abs(previous.bearing - mapView.bearing) < 1e-4 &&
            Math.abs(previous.pitch - mapView.pitch) < 1e-4
          )
            return current;
          return { ...current, mapView };
        }),
      setProjectArea,
      setUnits: (units) => setState((s) => ({ ...s, units: { ...s.units, ...units } })),
      setProjectName: (name) => patch({ projectName: name }),
      appendFeature,
      updateFeatureProperties,
      updateFeaturesProperties,
      updateFeatureGeometry,
      removeFeatures,
      setAssistantConversation,
      setConnectionHint,
      setProjectRecords,
      setPipelineEngineering,
      setWeatherWorkspace,
      setWaterWorkspace,
      addProjectEvent,
      saveProject,
      createProject,
      createSubproject,
      duplicateProject,
      duplicateVersion,
      promoteProject,
      moveProject,
      toggleSubprojectOverlay,
      openProject,
      openSharedMap,
      createSharedWorkingCopy,
      openReviewProject,
      deleteProject,
      restoreVersion,
      setAutosave,
      setProjectNavigationVisibility,
      setPrintComposition,
      toProjectState,
      layersInGroup: (groupId) => state.layers.filter((l) => l.groupId === groupId),
      activeLayer: state.layers.find((l) => l.id === state.activeLayerId) ?? null,
      displayLayers: [
        ...state.layers,
        ...state.subprojectOverlays.flatMap((overlay) => overlay.layers),
      ],
      ...sharedCapabilities(state.accessRole, state.activeShare?.permissions),
    }),
    [
      state,
      addLayer,
      updateLayer,
      updateDisplayLayer,
      setLayerNote,
      updateStyle,
      removeLayers,
      duplicateLayer,
      toggleVisible,
      moveLayer,
      moveLayerToEdge,
      reorderLayer,
      reorderGroup,
      nestGroupInLayer,
      nestLayerInLayer,
      setLayerGroup,
      addGroup,
      addSubgroup,
      renameGroup,
      groupSelectedGroups,
      removeGroup,
      toggleGroup,
      setGroupVisible,
      applyStyleToGroup,
      toggleLayerSelection,
      appendFeature,
      updateFeatureProperties,
      updateFeaturesProperties,
      updateFeatureGeometry,
      removeFeatures,
      setAssistantConversation,
      setConnectionHint,
      setProjectRecords,
      setPipelineEngineering,
      setWeatherWorkspace,
      setWaterWorkspace,
      addProjectEvent,
      saveProject,
      createProject,
      createSubproject,
      duplicateProject,
      duplicateVersion,
      promoteProject,
      moveProject,
      toggleSubprojectOverlay,
      openProject,
      openSharedMap,
      createSharedWorkingCopy,
      openReviewProject,
      deleteProject,
      restoreVersion,
      setAutosave,
      setProjectNavigationVisibility,
      setProjectArea,
      setPrintComposition,
      toProjectState,
      patch,
    ],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchApi {
  const ctx = useContext(WorkbenchContext);
  if (!ctx) throw new Error("useWorkbench must be used inside WorkbenchProvider");
  return ctx;
}
