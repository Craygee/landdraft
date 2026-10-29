import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Map as MlMap } from "maplibre-gl";
import type { Feature } from "geojson";
import type { LayerSource, LayerStyle } from "./types";
import type { SiteObjectPlacementRequest } from "./siteDesigner";

export interface PendingFeatureSave {
  features: Feature[];
  suggestedLayerName: string;
  suggestedFeatureName?: string;
  defaultGroupId: string;
  source: LayerSource;
  style?: Partial<LayerStyle>;
  separate?: boolean;
}

interface MapRefApi {
  map: MlMap | null;
  setMap: (map: MlMap | null) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  tableOpen: boolean;
  setTableOpen: (open: boolean) => void;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  printOpen: boolean;
  setPrintOpen: (open: boolean) => void;
  pendingPrintAnalysisId: string | null;
  setPendingPrintAnalysisId: (id: string | null) => void;
  elevationProfileOpen: boolean;
  setElevationProfileOpen: (open: boolean) => void;
  buildableAreaOpen: boolean;
  setBuildableAreaOpen: (open: boolean) => void;
  analysisOpen: boolean;
  setAnalysisOpen: (open: boolean) => void;
  layerRenderErrors: Record<string, string>;
  setLayerRenderErrors: (errors: Record<string, string>) => void;
  connectionsOpen: boolean;
  setConnectionsOpen: (open: boolean) => void;
  recordsOpen: boolean;
  setRecordsOpen: (open: boolean) => void;
  recordsTargetNoteId: string | null;
  setRecordsTargetNoteId: (id: string | null) => void;
  siteDesignerOpen: boolean;
  setSiteDesignerOpen: (open: boolean) => void;
  pendingSiteObject: SiteObjectPlacementRequest | null;
  setPendingSiteObject: (request: SiteObjectPlacementRequest | null) => void;
  pendingCatalogQuery: string;
  setPendingCatalogQuery: (q: string) => void;
  lastPoint: { lng: number; lat: number } | null;
  setLastPoint: (p: { lng: number; lat: number } | null) => void;
  pendingFeatureSave: PendingFeatureSave | null;
  setPendingFeatureSave: (pending: PendingFeatureSave | null) => void;
  pendingMapNoteLocation: { lng: number; lat: number } | null;
  setPendingMapNoteLocation: (location: { lng: number; lat: number } | null) => void;
  editEnabled: boolean;
  setEditEnabled: (enabled: boolean) => void;
}

const MapRefContext = createContext<MapRefApi | null>(null);

export function MapRefProvider({ children }: { children: ReactNode }) {
  const [map, setMapState] = useState<MlMap | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [pendingPrintAnalysisId, setPendingPrintAnalysisId] = useState<string | null>(null);
  const [elevationProfileOpen, setElevationProfileOpen] = useState(false);
  const [buildableAreaOpen, setBuildableAreaOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [layerRenderErrors, setLayerRenderErrors] = useState<Record<string, string>>({});
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsTargetNoteId, setRecordsTargetNoteId] = useState<string | null>(null);
  const [siteDesignerOpen, setSiteDesignerOpen] = useState(false);
  const [pendingSiteObject, setPendingSiteObject] = useState<SiteObjectPlacementRequest | null>(
    null,
  );
  const [pendingCatalogQuery, setPendingCatalogQuery] = useState("");
  const [lastPoint, setLastPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [pendingFeatureSave, setPendingFeatureSave] = useState<PendingFeatureSave | null>(null);
  const [pendingMapNoteLocation, setPendingMapNoteLocation] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [editEnabled, setEditEnabled] = useState(false);

  const value = useMemo<MapRefApi>(
    () => ({
      map,
      setMap: (m) => {
        mapRef.current = m;
        setMapState(m);
      },
      drawerOpen,
      setDrawerOpen,
      tableOpen,
      setTableOpen,
      assistantOpen,
      setAssistantOpen,
      printOpen,
      setPrintOpen,
      pendingPrintAnalysisId,
      setPendingPrintAnalysisId,
      elevationProfileOpen,
      setElevationProfileOpen,
      buildableAreaOpen,
      setBuildableAreaOpen,
      analysisOpen,
      setAnalysisOpen,
      layerRenderErrors,
      setLayerRenderErrors,
      connectionsOpen,
      setConnectionsOpen,
      recordsOpen,
      setRecordsOpen,
      recordsTargetNoteId,
      setRecordsTargetNoteId,
      siteDesignerOpen,
      setSiteDesignerOpen,
      pendingSiteObject,
      setPendingSiteObject,
      pendingCatalogQuery,
      setPendingCatalogQuery,
      lastPoint,
      setLastPoint,
      pendingFeatureSave,
      setPendingFeatureSave,
      pendingMapNoteLocation,
      setPendingMapNoteLocation,
      editEnabled,
      setEditEnabled,
    }),
    [
      map,
      drawerOpen,
      tableOpen,
      assistantOpen,
      printOpen,
      pendingPrintAnalysisId,
      elevationProfileOpen,
      buildableAreaOpen,
      analysisOpen,
      layerRenderErrors,
      connectionsOpen,
      recordsOpen,
      recordsTargetNoteId,
      siteDesignerOpen,
      pendingSiteObject,
      pendingCatalogQuery,
      lastPoint,
      pendingFeatureSave,
      pendingMapNoteLocation,
      editEnabled,
    ],
  );

  return <MapRefContext.Provider value={value}>{children}</MapRefContext.Provider>;
}

export function useMapRef(): MapRefApi {
  const ctx = useContext(MapRefContext);
  if (!ctx) throw new Error("useMapRef must be used inside MapRefProvider");
  return ctx;
}
