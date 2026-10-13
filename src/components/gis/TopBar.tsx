import { useState } from "react";
import {
  Save,
  FolderOpen,
  Database,
  Table2,
  PanelLeft,
  Info,
  FileDown,
  Sparkles,
  Printer,
  Beaker,
  PlayCircle,
  LogOut,
  UserRound,
  Share2,
  Navigation,
  NotebookTabs,
  ChevronDown,
  Waypoints,
  CloudSun,
  Droplets,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkbench } from "@/lib/gis/store";
import { useAuth } from "@/lib/auth";
import {
  LANDDRAFT_APP_CHANNEL,
  LANDDRAFT_APP_VERSION,
  LANDDRAFT_APP_VERSION_SHORT,
} from "@/lib/appVersion";
import { useMapRef } from "@/lib/gis/mapRef";
import { cn } from "@/lib/utils";
import { ExportPanel } from "./ExportMenu";
import { ProjectMenu } from "./ProjectMenu";
import { LandDraftMark } from "@/components/brand/LandDraftMark";
import { useTours } from "./TourProvider";
import { SharePanel } from "./SharePanel";
import { ProjectAreaControl } from "./ProjectAreaControl";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { LandDraftTools } from "./LandDraftTools";
import { ButtonHelpSettings } from "@/components/ui/ButtonHelpSettings";

export function TopBar({
  onTogglePanel,
  panelOpen,
}: {
  onTogglePanel: () => void;
  panelOpen: boolean;
}) {
  const wb = useWorkbench();
  const auth = useAuth();
  const {
    setDrawerOpen,
    setTableOpen,
    tableOpen,
    assistantOpen,
    setAssistantOpen,
    setPrintOpen,
    analysisOpen,
    setAnalysisOpen,
    setConnectionsOpen,
    recordsOpen,
    setRecordsOpen,
  } = useMapRef();
  const { startTour, featureTips, setFeatureTips } = useTours();
  const [showAbout, setShowAbout] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showModulesMenu, setShowModulesMenu] = useState(false);

  const save = async () => {
    await wb.saveProject();
    toast.success("Project saved", { description: "A new restore point was added to history." });
  };

  const closeCompactMenus = () => {
    setShowDataMenu(false);
    setShowFileMenu(false);
    setShowModulesMenu(false);
  };

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-4">
      <button
        onClick={onTogglePanel}
        aria-label="Toggle layer panel"
        title={panelOpen ? "Hide the layer panel" : "Show the layer panel"}
        className={cn(
          "rounded-xl p-2 transition-colors hover:bg-accent",
          panelOpen && "bg-secondary",
        )}
      >
        <PanelLeft className="size-4" />
      </button>

      <button
        onClick={() => {
          window.sessionStorage.removeItem("landdraft.force-desktop.v1");
          window.localStorage.setItem("landdraft.mobile-mode.v1", "field");
          const params = new URLSearchParams(window.location.search);
          params.delete("desktop");
          window.location.assign(
            `/mobile${params.size ? `?${params}` : ""}${window.location.hash}`,
          );
        }}
        aria-label="Open field notes view"
        title="Open the streamlined field notes and GPS view"
        className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground transition-colors hover:bg-accent"
      >
        <Navigation className="size-4" />
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <LandDraftMark className="size-5" />
        </span>
        <div className="hidden leading-tight min-[420px]:block">
          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-bold tracking-tight">LandDraft</h1>
            <span
              className={cn(
                "hidden rounded-full px-1.5 py-0.5 text-[8px] font-semibold min-[1100px]:inline",
                LANDDRAFT_APP_CHANNEL === "test"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-secondary text-muted-foreground",
              )}
              title={`LandDraft ${LANDDRAFT_APP_VERSION}`}
            >
              v{LANDDRAFT_APP_VERSION_SHORT}
            </span>
          </div>
          <p className="hidden text-[10px] text-muted-foreground min-[1100px]:block">
            Map, measure and shape the land
          </p>
        </div>
      </div>

      {wb.canEditProject && (
        <div className="ml-1 hidden items-center md:flex lg:ml-2">
          <ProjectSwitcher mode="desktop" />
        </div>
      )}

      <ProjectAreaControl />

      <div className="ml-auto hidden items-center gap-1 min-[1480px]:flex">
        <BarBtn
          icon={<Sparkles className="size-4" />}
          label="AI"
          help="Ask LandDraft AI to search, select, explain, or report"
          onClick={() => setAssistantOpen(!assistantOpen)}
          primary
          tourId="top-ai"
        />
        {wb.canEditProject && (
          <BarBtn
            icon={<Database className="size-4" />}
            label="Public data"
            help="Find and add official public datasets"
            onClick={() => setDrawerOpen(true)}
            tourId="top-public-data"
          />
        )}
        <MenuBarButton
          icon={<LayoutGrid className="size-4" />}
          label="Modules"
          help="Open Water, Weather, or Pipeline"
          open={showModulesMenu}
          tourId="top-modules"
          onClick={() => {
            setShowModulesMenu((value) => !value);
            setShowDataMenu(false);
            setShowFileMenu(false);
            setShowProjects(false);
            setShowExport(false);
            setShowShare(false);
            setShowAbout(false);
          }}
        />
        {wb.canEditProject && (
          <BarBtn
            icon={<Beaker className="size-4" />}
            label="Analysis"
            help="Create buffers, centroids, intersections and other derived layers"
            onClick={() => setAnalysisOpen(!analysisOpen)}
            tourId="top-analysis"
          />
        )}
        <BarBtn
          icon={<Table2 className="size-4" />}
          label="Table"
          help={
            wb.canEditProject
              ? "Search and edit layer attribute tables"
              : "Search shared attributes"
          }
          onClick={() => setTableOpen(!tableOpen)}
          tourId="top-table"
        />
        <MenuBarButton
          icon={<FolderOpen className="size-4" />}
          label="File"
          help="Save, print, share, and export"
          open={showFileMenu}
          tourId="compact-file-menu"
          onClick={() => {
            setShowFileMenu((value) => !value);
            setShowModulesMenu(false);
            setShowDataMenu(false);
            setShowProjects(false);
            setShowExport(false);
            setShowShare(false);
            setShowAbout(false);
          }}
        />
        {wb.canEditProject && (
          <BarBtn
            icon={<FolderOpen className="size-4" />}
            label="Projects"
            help="Switch, duplicate, or organize projects"
            onClick={() => {
              setShowProjects((value) => !value);
              setShowExport(false);
              setShowShare(false);
              setShowAbout(false);
              closeCompactMenus();
            }}
            tourId="top-projects"
          />
        )}
        {wb.canEditProject && (
          <BarBtn
            icon={<NotebookTabs className="size-4" />}
            label="Records"
            help="Project notes, documents, activity, email, and packets"
            onClick={() => setRecordsOpen(!recordsOpen)}
            tourId="top-records"
          />
        )}
      </div>

      <div className="ml-auto flex items-center gap-1 min-[1480px]:hidden">
        <BarBtn
          icon={<Sparkles className="size-4" />}
          label="AI"
          help="Ask LandDraft AI to search, select, explain, or report"
          onClick={() => {
            closeCompactMenus();
            setAssistantOpen(!assistantOpen);
          }}
          primary
          tourId="top-ai"
        />
        <MenuBarButton
          icon={<LayoutGrid className="size-4" />}
          label="Modules"
          help="Open Water, Weather, or Pipeline"
          open={showModulesMenu}
          tourId="compact-modules-menu"
          onClick={() => {
            setShowModulesMenu((value) => !value);
            setShowDataMenu(false);
            setShowFileMenu(false);
            setShowProjects(false);
            setShowExport(false);
            setShowShare(false);
            setShowAbout(false);
          }}
        />
        <MenuBarButton
          icon={<Database className="size-4" />}
          label="Data"
          help="Public data, analysis, and attribute tables"
          open={showDataMenu}
          tourId="compact-data-menu"
          onClick={() => {
            setShowDataMenu((value) => !value);
            setShowModulesMenu(false);
            setShowFileMenu(false);
            setShowProjects(false);
            setShowExport(false);
            setShowShare(false);
            setShowAbout(false);
          }}
        />
        <MenuBarButton
          icon={<FolderOpen className="size-4" />}
          label="File"
          help="Save, print, share, projects, records, and export"
          open={showFileMenu}
          tourId="compact-file-menu"
          onClick={() => {
            setShowFileMenu((value) => !value);
            setShowModulesMenu(false);
            setShowDataMenu(false);
            setShowProjects(false);
            setShowExport(false);
            setShowShare(false);
            setShowAbout(false);
          }}
        />
      </div>

      <LandDraftTools />
      <button
        onClick={() => {
          setShowAbout((s) => !s);
          setShowProjects(false);
          setShowExport(false);
          setShowShare(false);
          closeCompactMenus();
        }}
        aria-label="Help, account, and disclaimers"
        title="Help, account, and LandDraft information"
        data-tour="top-info"
        className="shrink-0 rounded-xl p-2 text-muted-foreground transition-colors hover:bg-accent"
      >
        <Info className="size-4" />
      </button>

      {wb.lastSavedAt && (
        <span className="num absolute -bottom-6 right-4 rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground shadow-panel">
          {wb.autosave ? "autosaved" : "saved"} {new Date(wb.lastSavedAt).toLocaleTimeString()}
        </span>
      )}

      {showProjects && (
        <div className="float-surface absolute right-2 top-14 rounded-2xl">
          <ProjectMenu onClose={() => setShowProjects(false)} />
        </div>
      )}

      {showExport && (
        <div className="float-surface absolute right-2 top-14 w-80 rounded-2xl">
          <ExportPanel onDone={() => setShowExport(false)} />
        </div>
      )}

      {showShare && (
        <div className="float-surface absolute right-2 top-14 rounded-2xl">
          <SharePanel onClose={() => setShowShare(false)} />
        </div>
      )}

      {showDataMenu && (
        <div
          role="menu"
          className="float-surface absolute right-2 top-14 max-h-[calc(100dvh-4rem)] w-64 overflow-y-auto rounded-2xl p-2 min-[1480px]:hidden"
        >
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Data & analysis
          </div>
          {wb.canEditProject && (
            <MenuAction
              icon={<Database className="size-4" />}
              label="Public data"
              help="Find and add official public datasets"
              onClick={() => {
                closeCompactMenus();
                setDrawerOpen(true);
              }}
            />
          )}
          {wb.canEditProject && (
            <MenuAction
              icon={<Beaker className="size-4" />}
              label="Spatial analysis"
              help="Buffers, intersections, centroids, and derived layers"
              onClick={() => {
                closeCompactMenus();
                setAnalysisOpen(!analysisOpen);
              }}
            />
          )}
          <MenuAction
            icon={<Table2 className="size-4" />}
            label="Attribute table"
            help={
              wb.canEditProject ? "Search and edit layer attributes" : "Search shared attributes"
            }
            onClick={() => {
              closeCompactMenus();
              setTableOpen(!tableOpen);
            }}
          />
        </div>
      )}

      {showModulesMenu && (
        <div
          role="menu"
          className="float-surface absolute right-2 top-14 max-h-[calc(100dvh-4rem)] w-72 overflow-y-auto rounded-2xl p-2"
        >
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            LandDraft modules
          </div>
          <MenuAction
            icon={<Droplets className="size-4" />}
            label="Water & Hydrogeology"
            help="Aquifers, wells, hydrology studies, water observations, and sources"
            onClick={() => window.location.assign("/water")}
          />
          <MenuAction
            icon={<CloudSun className="size-4" />}
            label="Weather & Meteorology"
            help="Radar, warnings, forecasts, inspection, and professional layers"
            onClick={() => window.location.assign("/weather")}
          />
          {wb.canEditProject && (
            <MenuAction
              icon={<Waypoints className="size-4" />}
              label="Pipeline Engineering"
              help="Terrain-aware routing, hydraulic screening, quantities, and estimating"
              onClick={() => window.location.assign("/pipeline")}
            />
          )}
        </div>
      )}

      {showFileMenu && (
        <div
          role="menu"
          className="float-surface absolute right-2 top-14 max-h-[calc(100dvh-4rem)] w-64 overflow-y-auto rounded-2xl p-2"
        >
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Project & file
          </div>
          {wb.canEditProject && (
            <MenuAction
              icon={<Save className="size-4" />}
              label="Save project"
              help="Save now and add a restore point"
              onClick={() => {
                closeCompactMenus();
                void save();
              }}
            />
          )}
          <MenuAction
            icon={<Printer className="size-4" />}
            label="Print map"
            help="Open the printable map composer"
            onClick={() => {
              closeCompactMenus();
              setPrintOpen(true);
            }}
          />
          <MenuAction
            icon={<Share2 className="size-4" />}
            label="Share map"
            help="Create a secure live-map link and manage access"
            onClick={() => {
              closeCompactMenus();
              setShowShare(true);
            }}
          />
          {wb.canEditProject && (
            <MenuAction
              icon={<FolderOpen className="size-4" />}
              label="Projects"
              help="Switch, duplicate, or organize projects"
              onClick={() => {
                closeCompactMenus();
                setShowProjects(true);
              }}
            />
          )}
          {wb.canEditProject && (
            <MenuAction
              icon={<NotebookTabs className="size-4" />}
              label="Records & files"
              help="Project notes, documents, activity, email, and packets"
              onClick={() => {
                closeCompactMenus();
                setRecordsOpen(!recordsOpen);
              }}
            />
          )}
          {wb.canEditProject && (
            <MenuAction
              icon={<FileDown className="size-4" />}
              label="Export GIS data"
              help="Export GeoJSON, KML, KMZ, or Shapefile"
              onClick={() => {
                closeCompactMenus();
                setShowExport(true);
              }}
            />
          )}
          <div className="my-1 border-t border-border" />
          <div className="px-2 py-2">
            <div className="text-[10px] text-muted-foreground">Signed in as</div>
            <div className="break-words text-xs font-semibold">{auth.user?.email}</div>
          </div>
          <MenuAction
            icon={<LogOut className="size-4" />}
            label="Log out"
            help="Sign out of LandDraft on this device"
            onClick={() => {
              closeCompactMenus();
              void auth.signOut();
            }}
          />
        </div>
      )}

      {showAbout && (
        <div className="float-surface absolute right-2 top-14 max-h-[calc(100dvh-4rem)] w-80 overflow-y-auto rounded-2xl p-4 text-xs leading-relaxed">
          <h2 className="text-sm font-semibold">Help & settings</h2>
          <p className="mt-1 text-muted-foreground">
            Replay a walkthrough at any time. Tours point to the controls on the real screen.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button
              onClick={() => {
                setShowAbout(false);
                startTour("basic");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 font-semibold text-primary-foreground"
            >
              <PlayCircle className="size-3.5" /> Quick tour
            </button>
            <button
              onClick={() => {
                setShowAbout(false);
                startTour("advanced");
              }}
              className="rounded-xl bg-secondary px-3 py-2 font-semibold hover:bg-accent"
            >
              Advanced tour
            </button>
            <button
              onClick={() => {
                setShowAbout(false);
                startTour("print");
              }}
              className="col-span-2 rounded-xl bg-secondary px-3 py-2 font-semibold hover:bg-accent"
            >
              Print map tour
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-xl border border-border px-3 py-2">
            <input
              type="checkbox"
              checked={featureTips}
              onChange={(event) => setFeatureTips(event.target.checked)}
              className="accent-primary"
            />
            <span>
              <strong className="block font-semibold">Offer tours for major new features</strong>
              <span className="text-[10px] text-muted-foreground">
                You can turn this back on even if you skipped the welcome tour.
              </span>
            </span>
          </label>

          <div className="mt-3">
            <ButtonHelpSettings compact />
          </div>

          <button
            onClick={() => {
              setShowAbout(false);
              setConnectionsOpen(true);
            }}
            className="mt-3 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:bg-accent"
          >
            <Database className="size-4 text-primary" />
            <span className="min-w-0 flex-1">
              <strong className="block font-semibold">API connections</strong>
              <span className="block text-[10px] text-muted-foreground">
                Check sources, repair links, or enter a URL
              </span>
            </span>
          </button>

          <h3 className="mb-1 mt-4 border-t border-border pt-3 text-sm font-semibold">
            About LandDraft
          </h3>
          <div className="mb-2 flex items-center justify-between rounded-lg bg-secondary px-2.5 py-2">
            <span className="font-medium">Application version</span>
            <span className="font-mono text-[10px]" title={LANDDRAFT_APP_VERSION}>
              v{LANDDRAFT_APP_VERSION}
            </span>
          </div>
          <p className="text-muted-foreground">
            A friendly browser workbench for maps: bring your own files, stream official public
            datasets, draw, measure, label and organize multiple projects.
          </p>
          <p className="mt-2 font-medium">Legal boundary disclaimer</p>
          <p className="text-muted-foreground">
            Measurements, sketches and public datasets are for planning and reference only. They are
            not surveys and do not determine property lines, ownership, easements or jurisdiction.
            Always verify with county records and a licensed surveyor.
          </p>
          <p className="mt-2 text-muted-foreground">
            {auth.cloudEnabled
              ? "Signed-in projects, autosave, and up to 25 restore points are stored in your private cloud workspace and follow you across devices."
              : "Cloud connection is pending; this deployment is temporarily using its existing device workspace."}
          </p>
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">Account</h3>
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-secondary p-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-muted-foreground">Signed in as</div>
                <div className="break-words font-semibold">{auth.user?.name}</div>
                <div className="break-words text-[10px] text-muted-foreground">
                  {auth.user?.email}
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAbout(false);
                  void auth.signOut();
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 font-semibold text-destructive hover:bg-accent"
                title="Log out of LandDraft"
              >
                <LogOut className="size-3.5" /> Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function BarBtn({
  icon,
  label,
  onClick,
  primary,
  help,
  tourId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  help?: string;
  tourId?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={help ?? label}
      aria-label={label}
      data-tour={tourId}
      className={cn(
        "flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-colors",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "bg-secondary text-secondary-foreground hover:bg-accent",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MenuBarButton({
  icon,
  label,
  help,
  open,
  onClick,
  tourId,
}: {
  icon: React.ReactNode;
  label: string;
  help: string;
  open: boolean;
  onClick: () => void;
  tourId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={label}
      title={help}
      data-tour={tourId}
      className={cn(
        "flex items-center gap-1 rounded-xl bg-secondary px-2.5 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent",
        open && "bg-accent",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <ChevronDown
        className={cn("hidden size-3 transition-transform sm:block", open && "rotate-180")}
      />
    </button>
  );
}

function MenuAction({
  icon,
  label,
  help,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  help: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={help}
      role="menuitem"
      className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span className="min-w-0">
        <strong className="block text-xs font-semibold">{label}</strong>
        <span className="block text-[10px] leading-snug text-muted-foreground">{help}</span>
      </span>
    </button>
  );
}
