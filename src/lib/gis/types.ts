import type { WaterWorkspaceState } from "@/lib/water/types";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { PipelineEngineeringState } from "@/lib/pipeline/types";
import type { WeatherWorkspaceState } from "@/lib/weather/types";

export type FillPattern =
  "solid" | "diagonal" | "horizontal" | "vertical" | "crosshatch" | "dotted";
export type StrokePattern = "solid" | "dashed" | "dotted";

export interface CategoryStyleRule {
  value: string;
  label: string;
  color: string;
  visible: boolean;
}

export interface IconStyleRule {
  value: string;
  label: string;
  icon: string;
}

export interface CategorizedIconStyle {
  enabled: boolean;
  field: string;
  rules: IconStyleRule[];
  fallbackIcon: string;
}

export interface CategorizedStyle {
  enabled: boolean;
  field: string;
  rules: CategoryStyleRule[];
  fallbackColor: string;
  fallbackVisible: boolean;
}

export type LabelPlacement =
  "auto" | "center" | "above" | "below" | "left" | "right" | "follow-line" | "horizontal";

export interface LayerStyle {
  fillColor: string;
  fillOpacity: number;
  fillPattern: FillPattern;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokePattern: StrokePattern;
  pointSize: number;
  pointIcon: string;
  pointIconColor: string | null;
  pointIconSize: number;
  categorizedIcons?: CategorizedIconStyle;
  labelTemplate: string;
  labelFields: string[];
  labelSeparator: string;
  labelEnabled: boolean;
  labelMinZoom: number;
  labelMaxZoom: number;
  labelFont: string;
  labelSize: number;
  labelScaleWithZoom: boolean;
  labelColor: string;
  labelOpacity: number;
  labelHaloColor: string;
  labelHaloWidth: number;
  labelPlacement: LabelPlacement;
  labelAllowOverlap: boolean;
  labelMaxWidth: number;
  labelLineSpacing: number;
  categorized?: CategorizedStyle;
}

export interface AreaUnitsPref {
  area: "acres" | "sqft" | "sqm" | "hectares";
  length: "miles" | "feet" | "meters" | "kilometers";
}

export type LayerSource =
  | {
      kind: "import";
      fileName: string;
      fileSizeBytes?: number;
      featureCount?: number;
      coordinateCount?: number;
      catalogId?: string;
      attribution?: string;
      sourceUrl?: string;
      designSource?: "canva" | "sketchup" | "gis";
    }
  | {
      kind: "draw";
      purpose?: "map-notes" | "site-design";
      siteObjectKind?: string;
    }
  | {
      kind: "image";
      fileName: string;
      dataUrl: string;
      coordinates: [[number, number], [number, number], [number, number], [number, number]];
      designSource?: "canva" | "image";
    }
  | {
      kind: "derived";
      sourceLayerId: string;
      query?: string;
      cachedAt?: string;
      cacheProvenance?: Record<string, unknown>;
    }
  | {
      kind: "remote";
      url: string;
      catalogId?: string;
      attribution?: string;
      where?: string;
      outFields?: string[];
      requiresViewport?: boolean;
      minZoom?: number;
      refreshMinutes?: number;
      lastRefreshedAt?: number;
      refreshToken?: number;
      loading?: boolean;
      loadStatus?: "idle" | "loading" | "complete" | "zoom-in" | "error";
      loadedFeatures?: number;
      expectedFeatures?: number;
      loadError?: string;
    };

export interface GisLayer {
  id: string;
  name: string;
  note?: string;
  noteUpdatedAt?: number;
  groupId: string;
  visible: boolean;
  data: FeatureCollection;
  style: LayerStyle;
  source: LayerSource;
  createdAt: number;
}

export interface LayerGroup {
  id: string;
  name: string;
  collapsed: boolean;
  parentId?: string | null;
  /** Identifies a group that acts as a container for one layer's original features and sublayers. */
  containerLayerId?: string;
}

export type PrintAnnotation =
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      text: string;
      textColor: string;
      backgroundColor: string | null;
      font: "Inter" | "Arial" | "Georgia" | "Courier New";
      fontSize: number;
    }
  | {
      id: string;
      type: "line" | "arrow";
      x: number;
      y: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
    }
  | {
      id: string;
      type: "marker";
      lng: number;
      lat: number;
      label: string;
      color: string;
      showCoordinates: boolean;
      gpsOnly?: boolean;
      coordinateFormat?: "decimal" | "dms";
    }
  | {
      id: string;
      type: "callout";
      lng: number;
      lat: number;
      x: number;
      y: number;
      text: string;
      color: string;
      backgroundColor: string;
      textColor: string;
      contentMode: "label" | "label-gps" | "gps" | "label-dms" | "dms";
    };

export type PrintFurnitureCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right" | "custom";

export interface PrintFurniturePosition {
  corner: PrintFurnitureCorner;
  /** Position within the map frame, as percentages. Used after dragging. */
  x: number;
  y: number;
}

export type PrintFurnitureKey = "legend" | "compass" | "scale" | "attribution";

export type PrintPaper = "letter" | "legal" | "tabloid" | "a5" | "a4" | "a3";

export interface PrintComposition {
  title: string;
  subtitle: string;
  paper: PrintPaper;
  orientation: "landscape" | "portrait";
  showTitle: boolean;
  showLegend: boolean;
  showCompass: boolean;
  showScale: boolean;
  showDate: boolean;
  showAttribution: boolean;
  showProjectNotes?: boolean;
  includedNoteIds?: string[];
  frameBorder: boolean;
  frame: { x: number; y: number; width: number; height: number };
  furniture: Record<PrintFurnitureKey, PrintFurniturePosition>;
  includedLayerIds: string[];
  legendItems: Record<string, { visible: boolean; name: string }>;
  annotations: PrintAnnotation[];
  mapView?: { center: [number, number]; zoom: number; bearing: number; pitch: number };
}

export type ProjectEventType =
  "note" | "upload" | "email" | "map" | "import" | "public-data" | "remote-change" | "project";

export interface ProjectNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  author: string;
  includeInPacket: boolean;
  pinned?: boolean;
  mapLocation?: MapNoteLocation;
}

export interface MapNoteLocation {
  lng: number;
  lat: number;
  markerFeatureId: string;
}

export interface LayerNoteRecord {
  id: string;
  layerId: string;
  subject: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  author: string;
  includeInPacket: boolean;
  pinned?: boolean;
  mapLocation?: MapNoteLocation;
}

export interface ProjectFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface EmailDocumentDetails {
  from?: string;
  to?: string;
  subject?: string;
  sentAt?: string;
  preview?: string;
}

export interface ProjectDocument {
  id: string;
  name: string;
  storagePath: string;
  mimeType: string;
  size: number;
  folderId: string;
  source: "upload" | "email" | "map";
  createdAt: number;
  uploadedBy: string;
  includeInPacket: boolean;
  /** Links a repository document to the note/record for a specific map layer. */
  layerId?: string;
  /** Links a layer document to one specific structured layer note. */
  layerNoteId?: string;
  /** Links a repository document to one project note. */
  projectNoteId?: string;
  email?: EmailDocumentDetails;
}

export interface ProjectEvent {
  id: string;
  type: ProjectEventType;
  title: string;
  detail: string;
  createdAt: number;
  actor: string;
  projectId: string;
  projectName: string;
  relatedId?: string;
}

export interface ProjectRecords {
  notes: ProjectNote[];
  layerNotes: LayerNoteRecord[];
  folders: ProjectFolder[];
  documents: ProjectDocument[];
  events: ProjectEvent[];
  summary: string;
}

export const emptyProjectRecords = (): ProjectRecords => ({
  notes: [],
  layerNotes: [],
  folders: [
    { id: "general", name: "General", parentId: null, createdAt: Date.now() },
    { id: "maps", name: "Maps", parentId: null, createdAt: Date.now() },
    { id: "email", name: "Email", parentId: null, createdAt: Date.now() },
  ],
  documents: [],
  events: [],
  summary: "",
});

export interface ProjectState {
  version: 1;
  /** LandDraft application release that created this project snapshot or backup. */
  landDraftVersion?: string;
  name: string;
  groups: LayerGroup[];
  layers: GisLayer[];
  basemapId: string;
  mapView?: MapViewState;
  /** Optional preferred extent restored whenever this project is opened. */
  projectArea?: MapViewState;
  units: AreaUnitsPref;
  selectedStates?: string[];
  derivedLayerGroupId?: string;
  parentProjectId?: string | null;
  enabledSubprojectIds?: string[];
  printComposition?: PrintComposition;
  assistant?: AssistantConversation;
  connectionHints?: Record<string, ConnectionRecoveryHint>;
  records?: ProjectRecords;
  /** Optional specialized pipeline workspace. Core GIS projects do not create this until opened. */
  pipelineEngineering?: PipelineEngineeringState;
  /** Optional Weather workspace. Core GIS projects remain usable when this module is unopened. */
  weatherWorkspace?: WeatherWorkspaceState;
  waterWorkspace?: WaterWorkspaceState;
  shareSource?: {
    shareId: string;
    sourceProjectId: string;
    sourceName: string;
  };
  savedAt?: number;
}

export interface MapViewState {
  /** Fixed WGS84 coverage for project-area downloads; older camera-only areas omit this. */
  bounds?: [number, number, number, number];
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface ConnectionRecoveryHint {
  url: string;
  notes: string;
  updatedAt: string;
  verified?: boolean;
}

export interface AssistantMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  createdAt: number;
}

export interface AssistantAction {
  id: string;
  request: string;
  summary: string;
  versionId: string;
  createdAt: number;
}

export interface AssistantConversation {
  messages: AssistantMessage[];
  actions: AssistantAction[];
}

export type GisFeature = Feature<Geometry, Record<string, unknown>>;

export const defaultStyle = (seed = 0): LayerStyle => {
  const palette = ["#2f7d4f", "#c9832c", "#3b6ea5", "#8e4a86", "#b0453a", "#3f7f7a"];
  const color = palette[seed % palette.length] ?? "#2f7d4f";
  return {
    fillColor: color,
    fillOpacity: 0.35,
    fillPattern: "solid",
    strokeColor: color,
    strokeWidth: 2,
    strokeOpacity: 1,
    strokePattern: "solid",
    pointSize: 6,
    pointIcon: "",
    pointIconColor: null,
    pointIconSize: 18,
    labelTemplate: "",
    labelFields: [],
    labelSeparator: " · ",
    labelEnabled: false,
    labelMinZoom: 4,
    labelMaxZoom: 24,
    labelFont: "Open Sans Regular",
    labelSize: 14,
    labelScaleWithZoom: true,
    labelColor: "#1d2a20",
    labelOpacity: 1,
    labelHaloColor: "#fdfbf3",
    labelHaloWidth: 1.6,
    labelPlacement: "auto",
    labelAllowOverlap: false,
    labelMaxWidth: 12,
    labelLineSpacing: 1.2,
  };
};
