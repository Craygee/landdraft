import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  FileText,
  ImagePlus,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  Save,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { LandDraftMark } from "@/components/brand/LandDraftMark";
import { StudyAreaMapFigure } from "./StudyAreaMapFigure";
import { useWorkbench } from "@/lib/gis/store";
import {
  buildableSvg,
  elevationFromLayer,
  elevationSvg,
  svgDataUrl,
} from "@/lib/gis/analysisArtifacts";
import { snapshotFromLayer } from "@/lib/gis/buildableAreaModel";
import { fetchArcgisFeatureCount, fetchRemoteGeoJSONPaged } from "@/lib/gis/arcgis";
import type { TerrainGrid } from "@/lib/gis/buildableTerrainModel";
import { publicDataTemplateById } from "@/lib/gis/publicDataTemplates";
import {
  measureLandCover,
  measureTerrainFromGrid,
  planStudyTerrain,
  readNlcdPixel,
} from "@/lib/studyReport/measurements";
import {
  analyzeStudyReport,
  approximateBoundsFromMapView,
  createStudyReportWorkspace,
  normalizeStudyReportWorkspace,
  studyBoundaryFromBounds,
  studyBoundaryFromLayer,
  studyAcres,
  studyBoundaryFromSelection,
  studyEvidenceSignature,
  studyPercent,
  studyQueryStateLabel,
  type StudyMeasurementResult,
} from "@/lib/studyReport/model";
import { refreshStudyLayers } from "@/lib/studyReport/refresh";
import type {
  StudyReportSectionConfig,
  StudyReportSectionId,
  StudyReportWorkspaceState,
} from "@/lib/studyReport/types";
import { hasStudyReportCapability } from "@/lib/studyReport/entitlements";

const sectionStatus = {
  ready: { label: "Evidence available", className: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Review needed", className: "bg-amber-100 text-amber-900" },
  insufficient: { label: "Insufficient data", className: "bg-rose-100 text-rose-800" },
} as const;

const ANALYSIS_TIMEOUT_MS = 180_000;

function analyzeInBackground(input: Parameters<typeof analyzeStudyReport>[0]) {
  if (typeof Worker === "undefined") return Promise.resolve(analyzeStudyReport(input));
  return new Promise<StudyReportWorkspaceState>((resolve, reject) => {
    const task = new Worker(new URL("../../lib/studyReport/analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = window.setTimeout(() => {
      task.terminate();
      reject(new Error("The analysis took too long. Use a smaller boundary or fewer layers."));
    }, ANALYSIS_TIMEOUT_MS);
    const finish = () => {
      window.clearTimeout(timer);
      task.terminate();
    };
    task.onmessage = (
      event: MessageEvent<
        { ok: true; result: StudyReportWorkspaceState } | { ok: false; error: string }
      >,
    ) => {
      finish();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    task.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The analysis stopped unexpectedly."));
    };
    task.postMessage(input);
  });
}

function polygonLayer(layer: ReturnType<typeof useWorkbench>["displayLayers"][number]) {
  return layer.data.features.some(
    (feature) => feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon",
  );
}

function sourceSelection(workspace: StudyReportWorkspaceState) {
  if (!workspace.boundary) return "";
  if (workspace.boundary.sourceFeatures === "selected") return "selection";
  return workspace.boundary.source === "layer"
    ? `layer:${workspace.boundary.sourceLayerId}`
    : workspace.boundary.source;
}

function findConfig(
  sections: StudyReportSectionConfig[],
  id: StudyReportSectionId,
): StudyReportSectionConfig | undefined {
  return sections.find((section) => section.id === id);
}

function Logo({ workspace }: { workspace: StudyReportWorkspaceState }) {
  return workspace.cover.logoDataUrl ? (
    <img
      src={workspace.cover.logoDataUrl}
      alt={`${workspace.cover.company || "Report"} logo`}
      className="max-h-20 max-w-56 object-contain"
    />
  ) : (
    <div className="flex items-center gap-2 text-[#174f30]">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-[#1c7545] text-white">
        <LandDraftMark className="size-7" />
      </span>
      <div>
        <strong className="block text-xl">LandDraft</strong>
        <span className="text-xs tracking-[0.18em] text-[#5a6b60] uppercase">
          Study Area Report
        </span>
      </div>
    </div>
  );
}

export function StudyReportWorkspace() {
  const wb = useWorkbench();
  const workspace = useMemo(
    () => normalizeStudyReportWorkspace(wb.studyReport, wb.projectName),
    [wb.studyReport, wb.projectName],
  );
  const polygonLayers = useMemo(() => wb.displayLayers.filter(polygonLayer), [wb.displayLayers]);
  const canExport = wb.canExportLayers && hasStudyReportCapability("studyReport.export");
  const [selectedSectionId, setSelectedSectionId] =
    useState<StudyReportSectionId>("executive-summary");
  const [running, setRunning] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState("");
  const reportTemplate = publicDataTemplateById("study-area-report-screening");
  const connectedCatalogIds = new Set(
    wb.displayLayers.flatMap((layer) =>
      "catalogId" in layer.source && layer.source.catalogId ? [layer.source.catalogId] : [],
    ),
  );
  const missingReportSources =
    reportTemplate?.catalogIds.filter((id) => !connectedCatalogIds.has(id)).length ?? 0;

  const update = (next: StudyReportWorkspaceState) => {
    if (!wb.canEditProject) {
      toast.error("This shared project is read-only.");
      return;
    }
    wb.setStudyReport({ ...next, updatedAt: new Date().toISOString() });
  };

  useEffect(() => {
    if (!wb.projectReady || wb.studyReport || !wb.canEditProject) return;
    const initial = createStudyReportWorkspace(wb.projectName);
    // A rectangle is labeled as a rectangle. Picking the first polygon layer here could quietly make
    // a statewide parcel or flood layer the subject of the study.
    initial.boundary = wb.projectArea?.bounds
      ? studyBoundaryFromBounds("Saved project area", "project-area", wb.projectArea.bounds)
      : studyBoundaryFromBounds(
          "Approximate current map view",
          "current-view",
          approximateBoundsFromMapView(wb.mapView),
        );
    wb.setStudyReport(initial);
  }, [wb]);

  const run = async () => {
    if (!workspace.boundary) {
      toast.error("Choose a polygon, project area or current view first.");
      return;
    }
    setRunning(true);
    setAnalysisProgress("Preparing study boundary and active layers…");
    // A timer rather than an animation frame, which would stall the run in a background tab.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const activeLayers = wb.displayLayers.filter((layer) => layer.visible);
      const boundary = workspace.boundary;
      const measurementTasks: Array<Promise<StudyMeasurementResult>> = [];
      const measured = (section: StudyReportSectionId) =>
        workspace.sections.find((item) => item.id === section)?.enabled !== false;
      if (measured("terrain"))
        measurementTasks.push(
          (async () => {
            const plan = planStudyTerrain(boundary);
            const response = await fetch("/api/analysis/buildable-terrain", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(plan),
              signal: AbortSignal.timeout(50_000),
            });
            const grid = (await response.json()) as TerrainGrid & { error?: string };
            if (!response.ok || grid.error)
              throw new Error(grid.error ?? `Terrain service HTTP ${response.status}`);
            return {
              section: "terrain" as const,
              measurement: measureTerrainFromGrid(boundary, grid),
            };
          })().catch((error: unknown) => ({
            section: "terrain" as const,
            failure: {
              id: "terrain-grid",
              title: "Measured elevation and slope",
              message: error instanceof Error ? error.message : "The USGS grid could not load.",
            },
          })),
        );
      const landCoverActive = activeLayers.some(
        (layer) =>
          "catalogId" in layer.source && layer.source.catalogId === "usgs-annual-nlcd-land-cover",
      );
      if (landCoverActive && measured("land-cover"))
        measurementTasks.push(
          measureLandCover(
            boundary,
            (lon, lat) => readNlcdPixel(lon, lat),
            new Date().toISOString(),
          )
            .then((measurement) => ({ section: "land-cover" as const, measurement }))
            .catch((error: unknown) => ({
              section: "land-cover" as const,
              failure: {
                id: "nlcd-sample",
                title: "Sampled land cover",
                message: error instanceof Error ? error.message : "The USGS service failed.",
              },
            })),
        );
      const refresh = await refreshStudyLayers(activeLayers, boundary, {
        fetchFeatures: fetchRemoteGeoJSONPaged,
        fetchCount: fetchArcgisFeatureCount,
        onProgress: setAnalysisProgress,
      });
      for (const item of refresh.refreshed)
        wb.updateDisplayLayer(item.id, { data: item.data, source: item.source });
      setAnalysisProgress("Measuring terrain and land cover…");
      const measurements = await Promise.all(measurementTasks);
      setAnalysisProgress(
        "Testing features against the boundary, clipping polygons and measuring distances…",
      );
      const result = await analyzeInBackground({
        workspace,
        layers: refresh.layers,
        records: wb.records,
        layerStatuses: refresh.statuses,
        measurements,
      });
      update(result);
      const problems = refresh.statuses.filter((status) =>
        ["failed", "truncated"].includes(status.state),
      ).length;
      toast.success(
        problems
          ? `Study report refreshed. ${problems} source${problems === 1 ? "" : "s"} did not return complete data; see the report warnings.`
          : "Study report analysis refreshed.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Report analysis failed.");
    } finally {
      setRunning(false);
      setAnalysisProgress("");
    }
  };

  const currentSignature = studyEvidenceSignature(
    wb.displayLayers.filter((layer) => layer.visible),
    wb.records,
  );
  const stale = Boolean(
    workspace.currentRun &&
    (workspace.currentRun.boundaryId !== workspace.boundary?.id ||
      workspace.currentRun.evidenceSignature !== currentSignature),
  );
  const orderedSections = [...workspace.sections].sort((a, b) => a.order - b.order);
  const enabledSections = orderedSections.filter((section) => section.enabled);
  const selectedConfig = findConfig(workspace.sections, selectedSectionId) ?? orderedSections[0];

  const patchCover = (patch: Partial<StudyReportWorkspaceState["cover"]>) =>
    update({ ...workspace, cover: { ...workspace.cover, ...patch } });

  const patchSection = (id: StudyReportSectionId, patch: Partial<StudyReportSectionConfig>) =>
    update({
      ...workspace,
      sections: workspace.sections.map((section) =>
        section.id === id ? { ...section, ...patch } : section,
      ),
    });

  const moveSection = (id: StudyReportSectionId, direction: -1 | 1) => {
    const sections = [...orderedSections];
    const from = sections.findIndex((section) => section.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= sections.length) return;
    [sections[from], sections[to]] = [sections[to]!, sections[from]!];
    update({
      ...workspace,
      sections: sections.map((section, order) => ({ ...section, order })),
    });
  };

  const selectedPolygons = useMemo(() => {
    const first = wb.selectedFeatures[0];
    if (!first) return null;
    const layer = wb.displayLayers.find((candidate) => candidate.id === first.layerId);
    if (!layer) return null;
    const indexes = wb.selectedFeatures
      .filter((selection) => selection.layerId === layer.id)
      .map((selection) => selection.index)
      .filter((index) => {
        const type = layer.data.features[index]?.geometry?.type;
        return type === "Polygon" || type === "MultiPolygon";
      });
    return indexes.length ? { layer, indexes } : null;
  }, [wb.selectedFeatures, wb.displayLayers]);

  const changeBoundary = (value: string) => {
    if (value === "selection") {
      const boundary = selectedPolygons
        ? studyBoundaryFromSelection(selectedPolygons.layer, selectedPolygons.indexes)
        : null;
      if (!boundary) {
        toast.error("Select one or more polygons on the map first.");
        return;
      }
      update({ ...workspace, boundary });
      return;
    }
    if (value.startsWith("layer:")) {
      const layer = wb.displayLayers.find((candidate) => candidate.id === value.slice(6));
      const boundary = layer ? studyBoundaryFromLayer(layer) : null;
      if (!boundary) {
        toast.error(
          "That layer has no usable polygon or is too detailed. Create a simpler study-boundary layer first.",
        );
        return;
      }
      update({ ...workspace, boundary });
      return;
    }
    if (value === "project-area") {
      if (!wb.projectArea?.bounds) {
        toast.error("Set a saved project area on the map first.");
        return;
      }
      update({
        ...workspace,
        boundary: studyBoundaryFromBounds(
          "Saved project area",
          "project-area",
          wb.projectArea.bounds,
        ),
      });
      return;
    }
    update({
      ...workspace,
      boundary: studyBoundaryFromBounds(
        wb.mapView.bounds ? "Current map view" : "Approximate current map view",
        "current-view",
        approximateBoundsFromMapView(wb.mapView),
      ),
    });
  };

  const uploadLogo = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Use a PNG, JPEG or WebP logo.");
      return;
    }
    if (file.size > 1024 * 1024) {
      toast.error("Logo files must be 1 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patchCover({ logoDataUrl: String(reader.result) });
    reader.onerror = () => toast.error("The logo could not be read.");
    reader.readAsDataURL(file);
  };

  if (!wb.projectReady)
    return (
      <div className="app-viewport flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="app-viewport flex min-h-0 flex-col bg-[#e9ede7] text-foreground">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-3 sm:px-5">
        <a
          href="/"
          className="flex size-10 items-center justify-center rounded-xl hover:bg-accent"
          aria-label="Back to map"
        >
          <ArrowLeft className="size-5" />
        </a>
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <FileText className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold sm:text-lg">Study Area Report</h1>
          <p className="truncate text-xs text-muted-foreground">
            {wb.projectName} · source-attributed screening and editable report
          </p>
        </div>
        <button
          type="button"
          onClick={() => void wb.saveProject("manual")}
          disabled={!wb.canEditProject}
          className="hidden min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-accent disabled:opacity-50 sm:flex"
        >
          <Save className="size-4" /> Save project
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!workspace.currentRun || !canExport}
          title={!canExport ? "The project owner has disabled exports for this share." : undefined}
          className="flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Printer className="size-4" /> <span className="hidden sm:inline">Print / Save PDF</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto xl:grid xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] xl:overflow-hidden">
        <aside className="study-report-ui min-w-0 overflow-x-hidden border-b border-border bg-background p-3 xl:overflow-y-auto xl:border-r xl:border-b-0 xl:p-4">
          <details open className="rounded-2xl border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              1. Cover & study area
            </summary>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-xs font-medium">
                Title
                <input
                  value={workspace.cover.title}
                  onChange={(event) => patchCover({ title: event.target.value })}
                  disabled={!wb.canEditProject}
                  className="min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Subtitle
                <input
                  value={workspace.cover.subtitle}
                  onChange={(event) => patchCover({ subtitle: event.target.value })}
                  disabled={!wb.canEditProject}
                  className="min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Company
                <input
                  value={workspace.cover.company}
                  onChange={(event) => patchCover({ company: event.target.value })}
                  disabled={!wb.canEditProject}
                  className="min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm"
                />
              </label>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-accent">
                  <ImagePlus className="size-4" />{" "}
                  {workspace.cover.logoDataUrl ? "Replace logo" : "Add logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={!wb.canEditProject}
                    onChange={(event) => uploadLogo(event.target.files?.[0])}
                  />
                </label>
                {workspace.cover.logoDataUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      const { logoDataUrl: _removed, ...cover } = workspace.cover;
                      update({ ...workspace, cover });
                    }}
                    className="flex size-10 items-center justify-center rounded-xl border border-border"
                    title="Remove logo"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              <label className="grid gap-1 text-xs font-medium">
                Study boundary
                <select
                  value={sourceSelection(workspace)}
                  onChange={(event) => changeBoundary(event.target.value)}
                  disabled={!wb.canEditProject}
                  className="min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm"
                >
                  <option value="current-view">Current map view (rectangle)</option>
                  <option value="project-area" disabled={!wb.projectArea?.bounds}>
                    Saved project area (rectangle){wb.projectArea?.bounds ? "" : ", not set"}
                  </option>
                  <option
                    value="selection"
                    disabled={
                      !selectedPolygons && workspace.boundary?.sourceFeatures !== "selected"
                    }
                  >
                    Selected polygons on the map
                    {selectedPolygons
                      ? ` (${selectedPolygons.indexes.length})`
                      : workspace.boundary?.sourceFeatures === "selected"
                        ? ""
                        : ", none selected"}
                  </option>
                  {polygonLayers.map((layer) => (
                    <option key={layer.id} value={`layer:${layer.id}`}>
                      Layer: {layer.name}
                    </option>
                  ))}
                </select>
              </label>
              {workspace.boundary ? (
                <p className="rounded-xl bg-accent p-2 text-xs text-muted-foreground">
                  {workspace.boundary.name} ·{" "}
                  {workspace.boundary.areaAcres.toLocaleString("en-US", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  acres
                  {workspace.boundary.source !== "layer"
                    ? ". This is a rectangle, not a property line. Select parcels or choose a polygon layer for a parcel-specific study."
                    : ""}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  const summary = wb.applyPublicDataTemplate("study-area-report-screening");
                  if (!summary.added && !summary.shown) {
                    toast.info(
                      "The official study-report layers are already connected and visible.",
                    );
                    return;
                  }
                  toast.success(
                    `${summary.added} official layer${summary.added === 1 ? "" : "s"} added; ${summary.shown} existing layer${summary.shown === 1 ? "" : "s"} turned on.`,
                  );
                }}
                disabled={running || !wb.canEditProject}
                className="flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-primary/35 bg-primary/5 px-3 text-center text-sm font-semibold whitespace-normal text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                <Check className="size-4 shrink-0" />
                <span>
                  {missingReportSources
                    ? `Add ${missingReportSources} recommended official report layer${missingReportSources === 1 ? "" : "s"}`
                    : "Turn on official report layers"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={running || !wb.canEditProject || !workspace.boundary}
                className="flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-center text-sm font-semibold whitespace-normal text-primary-foreground disabled:opacity-50"
              >
                {running ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : workspace.currentRun ? (
                  <RefreshCw className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
                {workspace.currentRun ? "Re-run analysis" : "Run analysis"}
              </button>
              {running && analysisProgress ? (
                <p className="rounded-xl border border-primary/20 bg-primary/5 p-2 text-[11px] leading-4 text-primary">
                  {analysisProgress}
                </p>
              ) : null}
              <p className="text-[11px] leading-4 text-muted-foreground">
                Analysis queries each active live source for the study boundary plus its listed
                search distance, separates on-site from nearby features, measures terrain from the
                USGS grid and regenerates section maps. Failed or incomplete sources are reported as
                not evaluated, never as no findings.
              </p>
            </div>
          </details>

          <details open className="mt-3 rounded-2xl border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-semibold">2. Sections</summary>
            <div className="mt-3 grid gap-1.5">
              {orderedSections.map((section, index) => {
                const result = workspace.currentRun?.sections.find(
                  (item) => item.id === section.id,
                );
                return (
                  <div
                    key={section.id}
                    className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border p-2 ${selectedSectionId === section.id ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <input
                      type="checkbox"
                      checked={section.enabled}
                      onChange={(event) =>
                        patchSection(section.id, { enabled: event.target.checked })
                      }
                      disabled={!wb.canEditProject}
                      aria-label={`Include ${section.title}`}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => setSelectedSectionId(section.id)}
                      className="min-w-0 text-left"
                    >
                      <strong className="block truncate text-xs">{section.title}</strong>
                      <span className="text-[10px] text-muted-foreground">
                        {result ? sectionStatus[result.status].label : "Not analyzed"}
                      </span>
                    </button>
                    <span className="flex gap-0.5">
                      <button
                        type="button"
                        disabled={index === 0 || !wb.canEditProject}
                        onClick={() => moveSection(section.id, -1)}
                        className="flex size-7 items-center justify-center rounded-lg hover:bg-accent disabled:opacity-25"
                        title="Move section earlier"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === orderedSections.length - 1 || !wb.canEditProject}
                        onClick={() => moveSection(section.id, 1)}
                        className="flex size-7 items-center justify-center rounded-lg hover:bg-accent disabled:opacity-25"
                        title="Move section later"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </details>

          {selectedConfig ? (
            <details open className="mt-3 rounded-2xl border border-border bg-card p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                3. Edit selected section
              </summary>
              <div className="mt-3 grid gap-2">
                <label className="grid gap-1 text-xs font-medium">
                  Section title
                  <input
                    value={selectedConfig.title}
                    onChange={(event) =>
                      patchSection(selectedConfig.id, { title: event.target.value })
                    }
                    disabled={!wb.canEditProject}
                    className="min-h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium">
                  User narrative / qualified findings
                  <textarea
                    value={selectedConfig.userNarrative}
                    onChange={(event) =>
                      patchSection(selectedConfig.id, { userNarrative: event.target.value })
                    }
                    disabled={!wb.canEditProject}
                    rows={7}
                    placeholder="Add reviewed findings, assumptions, field observations or a response to an insufficient-data item. This text is preserved when analysis is re-run."
                    className="w-full min-w-0 resize-y rounded-xl border border-border bg-background p-3 text-sm"
                  />
                </label>
                <label className="flex items-start gap-2 rounded-xl border border-border bg-background p-3 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedConfig.narrativeMode === "replace"}
                    onChange={(event) =>
                      patchSection(selectedConfig.id, {
                        narrativeMode: event.target.checked ? "replace" : "append",
                      })
                    }
                    disabled={!wb.canEditProject || !selectedConfig.userNarrative.trim()}
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                  />
                  <span>
                    <strong className="block">
                      Use my narrative instead of the generated paragraph
                    </strong>
                    Evidence metrics, maps, sources and data-gap warnings remain visible and
                    auditable.
                  </span>
                </label>
              </div>
            </details>
          ) : null}
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto p-2 sm:p-5 xl:p-8">
          {stale ? (
            <div className="study-report-ui mx-auto mb-3 flex max-w-[8.5in] items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              The boundary or project evidence changed after the last run. Review the current
              report, then re-run to refresh generated findings.
            </div>
          ) : null}
          <div className="study-report-print mx-auto grid max-w-[8.5in] gap-5">
            <ReportCover workspace={workspace} projectName={wb.projectName} />
            {workspace.currentRun ? (
              <>
                <ContentsPage sections={enabledSections} workspace={workspace} />
                {enabledSections.map((config, index) => (
                  <ReportSectionPage
                    key={config.id}
                    config={config}
                    workspace={workspace}
                    layers={wb.displayLayers}
                    pageNumber={index + 3}
                  />
                ))}
              </>
            ) : (
              <div className="study-report-page flex min-h-[11in] items-center justify-center bg-white p-10 text-center shadow-xl">
                <div className="max-w-md">
                  <FileText className="mx-auto size-12 text-primary" />
                  <h2 className="mt-4 text-2xl font-semibold">Ready to analyze the study area</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Confirm the boundary and run analysis to create editable, source-attributed
                    report sections and mapped figures.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function ReportCover({
  workspace,
  projectName,
}: {
  workspace: StudyReportWorkspaceState;
  projectName: string;
}) {
  return (
    <article className="study-report-page relative flex min-h-[11in] flex-col overflow-hidden bg-[#f8f5ea] p-[0.55in] shadow-xl">
      <div className="absolute inset-x-0 top-0 h-3 bg-[#1c7545]" />
      <header className="flex min-h-20 items-start justify-between gap-5 border-b border-[#cad5ca] pb-5">
        <Logo workspace={workspace} />
        <span className="rounded-full border border-[#afc2b2] px-3 py-1 text-[10px] font-semibold tracking-[0.15em] text-[#31513d] uppercase">
          Screening report
        </span>
      </header>
      <div className="flex flex-1 flex-col justify-center py-12">
        <p className="text-sm font-semibold tracking-[0.18em] text-[#51705b] uppercase">
          {workspace.cover.company || "Prepared in LandDraft"}
        </p>
        <h1 className="mt-5 max-w-[7in] text-5xl leading-[1.04] font-semibold tracking-[-0.035em] text-[#183624]">
          {workspace.cover.title}
        </h1>
        <p className="mt-5 max-w-[6.5in] text-xl leading-8 text-[#516259]">
          {workspace.cover.subtitle}
        </p>
        <div className="mt-10 grid max-w-[6.5in] gap-3 rounded-2xl border border-[#cad5ca] bg-white/65 p-5 sm:grid-cols-2">
          <div>
            <span className="block text-[10px] font-semibold tracking-wider text-[#6a766d] uppercase">
              Project
            </span>
            <strong className="mt-1 block text-lg text-[#183624]">{projectName}</strong>
          </div>
          <div>
            <span className="block text-[10px] font-semibold tracking-wider text-[#6a766d] uppercase">
              Study area
            </span>
            <strong className="mt-1 block text-lg text-[#183624]">
              {workspace.boundary?.name ?? "Not defined"}
            </strong>
            {workspace.boundary ? (
              <span className="text-sm text-[#59675e]">
                {workspace.boundary.areaAcres.toLocaleString("en-US", { maximumFractionDigits: 1 })}{" "}
                acres
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <footer className="border-t border-[#cad5ca] pt-4 text-xs leading-5 text-[#5c685f]">
        Generated{" "}
        {workspace.currentRun
          ? new Date(workspace.currentRun.analyzedAt).toLocaleString()
          : "after analysis"}
        . LandDraft screening output is not a survey, engineering design, environmental site
        assessment, title opinion or regulatory determination.
      </footer>
    </article>
  );
}

function ContentsPage({
  sections,
  workspace,
}: {
  sections: StudyReportSectionConfig[];
  workspace: StudyReportWorkspaceState;
}) {
  return (
    <article className="study-report-page min-h-[11in] bg-white p-[0.55in] shadow-xl">
      <ReportPageHeader workspace={workspace} pageNumber={2} />
      <h2 className="mt-10 text-3xl font-semibold text-[#183624]">Contents</h2>
      <ol className="mt-8 grid gap-0">
        {sections.map((section, index) => {
          const result = workspace.currentRun?.sections.find((item) => item.id === section.id);
          return (
            <li
              key={section.id}
              className="flex items-center gap-3 border-b border-[#e1e6df] py-3 text-sm"
            >
              <span className="w-7 font-mono text-xs text-[#6a766d]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 font-semibold text-[#24392b]">{section.title}</span>
              {result ? (
                <span
                  className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase ${sectionStatus[result.status].className}`}
                >
                  {sectionStatus[result.status].label}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-10 rounded-2xl border border-[#e1c878] bg-[#fff9df] p-5 text-sm leading-6 text-[#58471a]">
        <strong className="block">How to read this report</strong>
        <ul className="mt-2 grid list-disc gap-1 pl-4">
          <li>
            <strong>Mapped record:</strong> what a publisher's data shows. Records can be old,
            incomplete or approximate.
          </li>
          <li>
            <strong>Derived estimate:</strong> LandDraft's calculation over those records, such as
            acres within a boundary or a measured slope band.
          </li>
          <li>
            <strong>Screening assumption:</strong> a rule chosen for screening, such as a Buildable
            Area buffer. It is not a legal setback.
          </li>
          <li>
            <strong>Professional determination:</strong> never produced here. Survey, title,
            engineering, environmental and legal conclusions need a qualified professional.
          </li>
        </ul>
        <p className="mt-2">
          User-authored findings are shown separately. An Insufficient Data section is a required
          follow-up item, not a favorable finding. A failed source means not evaluated.
        </p>
      </div>
    </article>
  );
}

function ReportSectionPage({
  config,
  workspace,
  layers,
  pageNumber,
}: {
  config: StudyReportSectionConfig;
  workspace: StudyReportWorkspaceState;
  layers: ReturnType<typeof useWorkbench>["displayLayers"];
  pageNumber: number;
}) {
  const result = workspace.currentRun?.sections.find((section) => section.id === config.id);
  if (!result) return null;
  const mappedLayers = (result.mapLayerIds ?? result.layerIds).flatMap((id) => {
    const layer = layers.find((candidate) => candidate.id === id);
    return layer ? [layer] : [];
  });
  const sectionLayers = result.layerIds.flatMap((id) => {
    const layer = layers.find((candidate) => candidate.id === id);
    return layer ? [layer] : [];
  });
  const elevation = sectionLayers.map(elevationFromLayer).find(Boolean) ?? null;
  const buildableLayer = sectionLayers.find((layer) => snapshotFromLayer(layer));
  const buildable = buildableLayer ? snapshotFromLayer(buildableLayer) : null;
  const statusFor = (layerId: string) =>
    workspace.currentRun?.layerStatuses?.find((status) => status.layerId === layerId);
  const quietSources = result.sources.filter(
    (source) =>
      source.queryState &&
      source.queryState !== "project-data" &&
      !result.analysis?.layers.some(
        (layer) => layer.layerId === source.id && layer.featureCount > 0,
      ),
  );
  const showMap = Boolean(
    workspace.boundary &&
    (mappedLayers.length || config.id === "study-area") &&
    [
      "study-area",
      "land-cover",
      "terrain",
      "hydrology",
      "soils",
      "site-suitability",
      "environmental",
      "infrastructure",
      "energy",
      "hazards",
    ].includes(config.id),
  );
  return (
    <article className="study-report-page min-h-[11in] bg-white p-[0.55in] shadow-xl">
      <ReportPageHeader workspace={workspace} pageNumber={pageNumber} />
      <div className="mt-7 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.16em] text-[#60806b] uppercase">
            Section {String(pageNumber - 2).padStart(2, "0")}
          </p>
          <h2 className="mt-1 text-3xl leading-tight font-semibold text-[#183624]">
            {config.title}
          </h2>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1.5 text-[9px] font-semibold uppercase ${sectionStatus[result.status].className}`}
        >
          {sectionStatus[result.status].label}
        </span>
      </div>
      {config.narrativeMode !== "replace" || !config.userNarrative ? (
        <p className="mt-5 text-[13px] leading-6 text-[#34463a]">{result.generatedNarrative}</p>
      ) : null}
      {config.userNarrative ? (
        <div className="mt-4 rounded-xl border-l-4 border-[#2b7b4d] bg-[#eef5ee] p-4">
          <span className="text-[9px] font-semibold tracking-wider text-[#4c6d57] uppercase">
            {config.narrativeMode === "replace"
              ? "User-edited report narrative"
              : "Reviewed / user-authored findings"}
          </span>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-[#26392c]">
            {config.userNarrative}
          </p>
        </div>
      ) : null}
      {result.gapMessage ? (
        <div className="mt-4 flex gap-2 rounded-xl border border-[#e3bd73] bg-[#fff8e3] p-4 text-[12px] leading-5 text-[#684c16]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong className="block">Insufficient data / follow-up</strong>
            {result.gapMessage}
          </div>
        </div>
      ) : null}
      {result.recommendations?.length ? (
        <div className="mt-4 rounded-xl border border-[#dce2d9] bg-[#f7f8f4] p-4">
          <strong className="text-[10px] tracking-wide text-[#405448] uppercase">
            Recommended official evidence sources
          </strong>
          <ul className="mt-2 grid gap-2 text-[11px] leading-4 text-[#4d5d52]">
            {result.recommendations.map((recommendation) => (
              <li key={recommendation.url}>
                <strong className="text-[#23392a]">{recommendation.name}</strong> —{" "}
                {recommendation.note}
                <br />
                <span className="break-all text-[9px] text-[#6b776f]">{recommendation.url}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.highlights?.length ? (
        <div className="mt-4 rounded-xl border border-[#dce2d9] p-4 text-[11px] leading-5 text-[#34463a]">
          <strong className="block text-[10px] tracking-wide text-[#405448] uppercase">
            Mapped on site
          </strong>
          <p className="text-[9px] text-[#59675e]">
            Records from the sources listed in each section. These are not conclusions about the
            site, and sources that failed or found nothing are not listed here.
          </p>
          <ul className="mt-1 grid list-disc gap-1 pl-4">
            {result.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {(config.id === "executive-summary" || config.id === "sources") &&
      (workspace.currentRun?.warnings.length ?? 0) > 0 ? (
        <div className="mt-4 rounded-xl border border-[#e3bd73] bg-[#fff8e3] p-4 text-[11px] leading-5 text-[#684c16]">
          <strong className="block">Warnings for this run</strong>
          <ul className="mt-1 grid list-disc gap-1 pl-4">
            {workspace.currentRun!.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.metrics.length ? (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {result.metrics.map((metric) => (
            <div key={metric.id} className="rounded-xl border border-[#dce2d9] bg-[#f7f8f4] p-3">
              <span className="block text-[9px] font-semibold tracking-wide text-[#6a766d] uppercase">
                {metric.label}
              </span>
              <strong className="mt-1 block text-lg text-[#183624]">{metric.value}</strong>
              {metric.note ? (
                <span className="text-[9px] text-[#6a766d]">{metric.note}</span>
              ) : null}
              {metric.basis ? (
                <span className="mt-1 block text-[8px] tracking-wide text-[#6a766d] uppercase">
                  {metric.basis === "mapped"
                    ? "Mapped record"
                    : metric.basis === "derived"
                      ? "Derived estimate"
                      : "Screening assumption"}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {result.measurements?.map((measurement) => (
        <div
          key={measurement.id}
          className="mt-5 overflow-hidden rounded-xl border border-[#dce2d9]"
        >
          <div className="bg-[#edf2eb] px-3 py-2">
            <strong className="text-[10px] tracking-wide text-[#405448] uppercase">
              {measurement.title} · Derived estimate
            </strong>
            <p className="mt-1 text-[9px] leading-4 text-[#59675e]">{measurement.method}</p>
          </div>
          <table className="w-full border-collapse text-left text-[10px]">
            <tbody>
              {measurement.rows.map((row) => (
                <tr key={row.label} className="border-t border-[#dce2d9]">
                  <td className="p-2 font-semibold text-[#24392b]">{row.label}</td>
                  <td className="p-2 text-right text-[#24392b]">{row.value}</td>
                  <td className="p-2 text-[#526157]">{row.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-[#dce2d9] px-3 py-2 text-[9px] leading-4 text-[#59675e]">
            {measurement.limitation} Source: {measurement.sourceName}, retrieved{" "}
            {new Date(measurement.retrievedAt).toLocaleDateString()}.
          </p>
        </div>
      ))}
      {result.analysis?.layers.length ? (
        <div className="mt-5 overflow-hidden rounded-xl border border-[#dce2d9]">
          <div className="bg-[#edf2eb] px-3 py-2">
            <strong className="text-[10px] tracking-wide text-[#405448] uppercase">
              What was found
            </strong>
            <p className="mt-1 text-[9px] leading-4 text-[#59675e]">{result.analysis.method}</p>
          </div>
          <table className="w-full border-collapse text-left text-[9px]">
            <thead className="bg-[#f7f8f4] text-[#526157]">
              <tr>
                <th className="p-2">Source</th>
                <th className="p-2 text-right">On site</th>
                <th className="p-2">Area / length inside the boundary</th>
                <th className="p-2">Nearby, outside the boundary</th>
                <th className="p-2">Attributes of on-site features</th>
              </tr>
            </thead>
            <tbody>
              {result.analysis.layers.slice(0, 14).map((layer) => (
                <tr key={layer.layerId} className="border-t border-[#dce2d9] align-top">
                  <td className="p-2 font-semibold text-[#24392b]">{layer.name}</td>
                  <td className="p-2 text-right">
                    {statusFor(layer.layerId)?.state === "truncated" ? "≥ " : ""}
                    {layer.featureCount.toLocaleString()}
                  </td>
                  <td className="p-2 text-[#526157]">
                    {layer.mappedCoverageAcres !== undefined ? (
                      <span className="block">
                        {studyAcres(layer.mappedCoverageAcres)} ac (
                        {studyPercent(layer.mappedCoveragePercent ?? 0)}% of study)
                      </span>
                    ) : null}
                    {layer.onSiteLineMiles ? (
                      <span className="block">
                        {layer.onSiteLineMiles.toLocaleString("en-US", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        mi of line
                      </span>
                    ) : null}
                    {layer.coverageClasses?.map((item) => (
                      <span key={item.value} className="block">
                        {item.value}: {studyAcres(item.acres)} ac ({studyPercent(item.percent)}%)
                      </span>
                    ))}
                    {layer.note ? <span className="block italic">{layer.note}</span> : null}
                  </td>
                  <td className="p-2 text-[#526157]">
                    {layer.nearby
                      ? layer.nearby.count
                        ? `${layer.nearby.count.toLocaleString()} within ${layer.nearby.searchMiles} mi. Nearest about ${
                            (layer.nearby.nearestMiles ?? 0) < 0.1
                              ? "under 0.1"
                              : (layer.nearby.nearestMiles ?? 0).toLocaleString("en-US", {
                                  maximumFractionDigits: 1,
                                })
                          } mi ${layer.nearby.nearestDirection ?? ""}${layer.nearby.nearestLabel ? ` (${layer.nearby.nearestLabel})` : ""}`
                        : `None within ${layer.nearby.searchMiles} mi`
                      : "Not searched"}
                  </td>
                  <td className="max-w-[2in] p-2 text-[#526157]">
                    {layer.attributes.length
                      ? layer.attributes
                          .map(
                            (attribute) =>
                              `${attribute.field}: ${attribute.values
                                .slice(0, 3)
                                .map((value) => `${value.value} (${value.count})`)
                                .join(", ")}`,
                          )
                          .join("; ")
                      : "None summarized"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {config.id !== "sources" && config.id !== "executive-summary" && quietSources.length ? (
        <div className="mt-4 rounded-xl border border-[#dce2d9] p-3 text-[9px] leading-4 text-[#526157]">
          <strong className="text-[10px] tracking-wide text-[#405448] uppercase">
            Sources with nothing on site
          </strong>
          <ul className="mt-1 grid gap-0.5">
            {quietSources.map((source) => (
              <li key={source.id}>
                <span className="font-semibold text-[#24392b]">{source.name}:</span>{" "}
                {source.queryState === "complete"
                  ? `queried, none mapped inside the boundary. Not proof of absence.${source.coverage ? ` This source only covers ${source.coverage}.` : ""}`
                  : source.queryMessage && source.queryState !== "visual-only"
                    ? `${studyQueryStateLabel(source.queryState!)}. ${source.queryMessage}`
                    : studyQueryStateLabel(source.queryState!)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {showMap && workspace.boundary ? (
        <div className="mt-5">
          <StudyAreaMapFigure
            title={config.title}
            boundary={workspace.boundary}
            layers={mappedLayers}
            snapshot={workspace.currentRun?.figureSnapshot}
          />
        </div>
      ) : null}
      {result.guidance ? (
        <div className="mt-5 grid gap-3 text-[11px] leading-5 text-[#34463a] sm:grid-cols-3">
          <div>
            <strong className="block text-[10px] tracking-wide text-[#405448] uppercase">
              Why it matters
            </strong>
            {result.guidance.whyItMatters}
          </div>
          <div>
            <strong className="block text-[10px] tracking-wide text-[#405448] uppercase">
              Not evaluated
            </strong>
            <ul className="list-disc pl-4">
              {result.guidance.notEvaluated.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong className="block text-[10px] tracking-wide text-[#405448] uppercase">
              Next verification step
            </strong>
            <ul className="list-disc pl-4">
              {result.guidance.nextSteps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {elevation && config.id === "terrain" ? (
        <figure className="mt-5 overflow-hidden rounded-xl border border-[#dce2d9]">
          <img
            src={svgDataUrl(elevationSvg(elevation, true))}
            alt={`${elevation.name} elevation profile`}
            className="w-full"
          />
          <figcaption className="border-t border-[#dce2d9] px-3 py-2 text-[10px] text-[#59675e]">
            Saved LandDraft elevation profile. Observed and interpolated status remains in the
            source artifact.
          </figcaption>
        </figure>
      ) : null}
      {buildable && config.id === "site-suitability" ? (
        <figure className="mt-5 overflow-hidden rounded-xl border border-[#dce2d9]">
          <img
            src={svgDataUrl(
              buildableSvg(
                {
                  ...buildable,
                  input: { ...buildable.input, name: buildableLayer?.name ?? buildable.input.name },
                },
                true,
              ),
            )}
            alt="Saved LandDraft buildable-area screening summary"
            className="w-full"
          />
          <figcaption className="border-t border-[#dce2d9] px-3 py-2 text-[10px] leading-4 text-[#59675e]">
            Saved Buildable Area result. Screening assumptions under the rules selected in that
            analysis, calculated on its own boundary and run date, which may differ from this study.
            It does not establish buildability.
          </figcaption>
        </figure>
      ) : null}
      {config.id === "sources" && result.sources.length ? (
        <div className="mt-6 overflow-hidden rounded-xl border border-[#dce2d9]">
          <table className="w-full border-collapse text-left text-[10px]">
            <thead className="bg-[#edf2eb] text-[#405448]">
              <tr>
                <th className="p-2">Source</th>
                <th className="p-2">This run</th>
                <th className="p-2">Publisher date / update cycle</th>
                <th className="p-2">Attribution, terms and limits</th>
              </tr>
            </thead>
            <tbody>
              {result.sources.map((source) => (
                <tr key={source.id} className="border-t border-[#dce2d9] align-top">
                  <td className="p-2 font-semibold">
                    {source.name}
                    <span className="block font-normal text-[#526157] capitalize">
                      {source.evidence.replace("-", " ")}
                    </span>
                  </td>
                  <td className="p-2 text-[#526157]">
                    {source.queryState ? studyQueryStateLabel(source.queryState) : "Not recorded"}
                    {source.retrievedAt ? (
                      <span className="block">
                        {new Date(source.retrievedAt).toLocaleDateString()}
                      </span>
                    ) : null}
                    {source.queryMessage ? (
                      <span className="block italic">{source.queryMessage}</span>
                    ) : null}
                  </td>
                  <td className="p-2 text-[#526157]">
                    {source.updateCadence ?? "Not stated by publisher"}
                  </td>
                  <td className="max-w-[3in] break-words p-2 text-[#526157]">
                    {source.attribution ?? "No separate attribution recorded"}
                    {source.license ? <span className="block">{source.license}</span> : null}
                    {source.limitations ? (
                      <span className="block">{source.limitations}</span>
                    ) : null}
                    {source.sourcePage ? <span className="block">{source.sourcePage}</span> : null}
                    {source.url ? <span className="block">{source.url}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {result.sources.length && config.id !== "sources" ? (
        <div className="mt-4 border-t border-[#e1e6df] pt-3 text-[9px] leading-4 text-[#667168]">
          <strong>Evidence:</strong>{" "}
          {result.sources
            .slice(0, 6)
            .map((source) => source.name)
            .join(" · ")}
          {result.sources.length > 6 ? ` · +${result.sources.length - 6} more` : ""}
        </div>
      ) : null}
    </article>
  );
}

function ReportPageHeader({
  workspace,
  pageNumber,
}: {
  workspace: StudyReportWorkspaceState;
  pageNumber: number;
}) {
  return (
    <header className="flex items-center justify-between border-b border-[#d7ded5] pb-3 text-[9px] tracking-wide text-[#617067] uppercase">
      <span className="flex items-center gap-2 font-semibold text-[#2f553c]">
        <Check className="size-3.5" /> {workspace.cover.company || "LandDraft Study Area Report"}
      </span>
      {/* Sections can run past one printed sheet, so a fixed page number would be wrong. */}
      <span>
        {pageNumber > 2 ? `Section ${String(pageNumber - 2).padStart(2, "0")}` : "Contents"}
      </span>
    </header>
  );
}
