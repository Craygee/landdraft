import { SharedNotesPanel } from "./SharedNotesPanel";
import { WorkspaceLoading, WorkspaceRecoveryNotice } from "./WorkspaceLoading";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { WorkbenchProvider, useWorkbench } from "@/lib/gis/store";
import { MapRefProvider, useMapRef } from "@/lib/gis/mapRef";
import { MapCanvas } from "./MapCanvas";
import { LayerPanel } from "./LayerPanel";
import { TopBar } from "./TopBar";
import { SearchBox } from "./SearchBox";
import { BasemapControl } from "./BasemapControl";
import { DrawToolbar } from "./DrawToolbar";
import { AttributeTable } from "./AttributeTable";
import { DataDrawer } from "./DataDrawer";
import { cn } from "@/lib/utils";
import { RemoteLayerManager } from "./RemoteLayerManager";
import { SelectionToolbar } from "./SelectionToolbar";
import { AuthGate } from "@/lib/auth";
import { FeatureDestinationDialog } from "./FeatureDestinationDialog";
import { TourProvider } from "./TourProvider";
import { SharedLayerPanel } from "./SharedLayerPanel";
import { ConnectionManager } from "./ConnectionManager";
import { MapNoteDialog } from "./MapNoteDialog";
import { FeatureAttributesWindow } from "./FeatureAttributesWindow";
import { MapLegendControl } from "./MapLegendControl";
import { AccountPublicDataProvider } from "@/lib/gis/AccountPublicData";
import { AccountServiceLayers } from "./AccountServiceLayers";

const AiAssistant = lazy(() =>
  import("./AiAssistant").then((module) => ({ default: module.AiAssistant })),
);
const PrintComposer = lazy(() =>
  import("./PrintComposer").then((module) => ({ default: module.PrintComposer })),
);
const ElevationProfilePanel = lazy(() =>
  import("./ElevationProfilePanel").then((module) => ({ default: module.ElevationProfilePanel })),
);
const SpatialAnalysisPanel = lazy(() =>
  import("./SpatialAnalysisPanel").then((module) => ({ default: module.SpatialAnalysisPanel })),
);
const BuildableAreaPanel = lazy(() =>
  import("./BuildableAreaPanel").then((module) => ({ default: module.BuildableAreaPanel })),
);
const ProjectRecordsPanel = lazy(() =>
  import("./ProjectRecordsPanel").then((module) => ({ default: module.ProjectRecordsPanel })),
);
const SiteDesignerPanel = lazy(() =>
  import("./SiteDesignerPanel").then((module) => ({ default: module.SiteDesignerPanel })),
);

export default function Workbench() {
  return (
    <AuthGate>
      <AccountPublicDataProvider>
        <WorkbenchProvider>
          <MapRefProvider>
            <TourProvider>
              <WorkbenchShell />
              <RemoteLayerManager />
              <AccountServiceLayers />
              <FeatureDestinationDialog />
              <MapNoteDialog />
              <ConnectionManager />
              <Toaster />
            </TourProvider>
          </MapRefProvider>
        </WorkbenchProvider>
      </AccountPublicDataProvider>
    </AuthGate>
  );
}

function WorkbenchShell() {
  const [panelOpen, setPanelOpen] = useState(true);
  const wb = useWorkbench();
  const {
    assistantOpen,
    printOpen,
    analysisOpen,
    elevationProfileOpen,
    buildableAreaOpen,
    recordsOpen,
    siteDesignerOpen,
  } = useMapRef();

  useEffect(() => {
    if (window.innerWidth < 768) setPanelOpen(false);
  }, []);

  // The search box and draw toolbar wrap onto extra rows on narrower screens.
  // Publish where they end so the legend and drawing bars sit below them
  // instead of underneath. Search results are left out on purpose, so the
  // bars do not jump while someone types.
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === "undefined") return;
    const searchBar = searchRef.current?.firstElementChild?.firstElementChild ?? null;
    const toolbar = toolbarRef.current;
    const update = () => {
      const top = main.getBoundingClientRect().top;
      let bottom = 0;
      for (const el of [searchBar, toolbar]) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height > 0) bottom = Math.max(bottom, rect.bottom - top);
      }
      const root = document.documentElement;
      if (bottom > 0) {
        main.style.setProperty("--map-top-inset", `${Math.round(bottom + 12)}px`);
        // Viewport position, for windows portaled outside the map area.
        root.style.setProperty("--map-top-offset", `${Math.round(top + bottom + 12)}px`);
      } else {
        main.style.removeProperty("--map-top-inset");
        root.style.removeProperty("--map-top-offset");
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(main);
    if (searchBar) observer.observe(searchBar);
    if (toolbar) observer.observe(toolbar);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--map-top-offset");
    };
  }, [wb.projectReady, wb.canEditProject, wb.canSearchMap]);

  if (!wb.projectReady) return <WorkspaceLoading />;

  return (
    <div className="app-safe-frame app-viewport flex flex-col bg-background">
      <WorkspaceRecoveryNotice />
      <TopBar onTogglePanel={() => setPanelOpen((o) => !o)} panelOpen={panelOpen} />

      <div className="relative flex min-h-0 flex-1">
        <aside
          data-tour="layer-panel"
          className={cn(
            "absolute inset-y-0 left-0 z-30 w-72 border-r border-border shadow-float transition-transform md:relative md:z-auto md:shadow-none",
            panelOpen ? "translate-x-0" : "-translate-x-full md:hidden",
          )}
        >
          {wb.canEditProject ? <LayerPanel /> : <SharedLayerPanel />}
        </aside>

        <main ref={mainRef} className="relative min-w-0 flex-1">
          <MapCanvas />
          <FeatureAttributesWindow />
          <div className="absolute right-3 top-[calc(var(--map-top-inset,4rem)+0.5rem)] z-30">
            <MapLegendControl />
          </div>
          {wb.canEditProject && <SelectionToolbar />}

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3">
            <div className="pointer-events-auto flex flex-wrap items-start justify-between gap-2">
              <div ref={searchRef} data-tour="map-search">
                {wb.canSearchMap && <SearchBox />}
              </div>
              {wb.canEditProject && (
                <div className="hidden max-w-full md:block">
                  <div ref={toolbarRef} data-tour="draw-toolbar">
                    <DrawToolbar />
                  </div>
                </div>
              )}
            </div>
          </div>

          {wb.canEditProject && (
            <div className="pointer-events-auto absolute bottom-16 left-1/2 z-20 -translate-x-1/2 md:hidden">
              <div data-tour="draw-toolbar">
                <DrawToolbar />
              </div>
            </div>
          )}

          <div className="pointer-events-auto absolute bottom-16 right-14 z-20 md:bottom-24">
            <div data-tour="basemap-control">
              <BasemapControl />
            </div>
          </div>

          <DataDrawer />
          {analysisOpen && wb.canEditProject && (
            <Suspense fallback={null}>
              <SpatialAnalysisPanel />
            </Suspense>
          )}
          {assistantOpen && wb.canUseAi && (
            <Suspense fallback={null}>
              <AiAssistant />
            </Suspense>
          )}
        </main>
      </div>

      <AttributeTable />
      {buildableAreaOpen && wb.canEditProject && (
        <Suspense fallback={null}>
          <BuildableAreaPanel />
        </Suspense>
      )}
      {elevationProfileOpen && wb.canEditProject && (
        <Suspense fallback={null}>
          <ElevationProfilePanel />
        </Suspense>
      )}
      {printOpen && (
        <Suspense fallback={null}>
          <PrintComposer />
        </Suspense>
      )}
      {recordsOpen && !wb.canEditProject && wb.canViewNotes && <SharedNotesPanel />}
      {recordsOpen && wb.canEditProject && (
        <Suspense fallback={null}>
          <ProjectRecordsPanel />
        </Suspense>
      )}
      {siteDesignerOpen && wb.canEditProject && (
        <Suspense fallback={null}>
          <SiteDesignerPanel />
        </Suspense>
      )}
    </div>
  );
}
