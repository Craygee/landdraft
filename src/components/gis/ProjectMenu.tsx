import {
  ChevronRight,
  Cloud,
  Copy,
  Clock3,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  LogOut,
  Navigation,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  UserRound,
  ArrowUpFromLine,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { projectVersionLabel } from "@/lib/appVersion";
import { useWorkbench } from "@/lib/gis/store";
import { cn } from "@/lib/utils";

type View = "projects" | "settings";

export function ProjectMenu({ onClose }: { onClose: () => void }) {
  const wb = useWorkbench();
  const auth = useAuth();
  const [movingProject, setMovingProject] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [savingMove, setSavingMove] = useState(false);
  const [newName, setNewName] = useState("");
  const [view, setView] = useState<View>("projects");
  const [subprojectName, setSubprojectName] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(projectAncestorIds(wb.projectId, wb.projects)),
  );

  const projectIds = new Set(wb.projects.map((project) => project.id));
  const roots = wb.projects.filter(
    (project) => !project.parentProjectId || !projectIds.has(project.parentProjectId),
  );
  const childrenOf = (parentId: string) =>
    wb.projects.filter((project) => project.parentProjectId === parentId);

  useEffect(() => {
    const ancestors = projectAncestorIds(wb.projectId, wb.projects);
    if (ancestors.length === 0) return;
    setExpandedProjects((current) => new Set([...current, ...ancestors]));
  }, [wb.projectId, wb.projects]);

  const createProject = () => {
    if (!newName.trim()) return;
    void wb.createProject(newName).then(() => {
      setNewName("");
      toast.success("New project created");
    });
  };

  const renderProjectTree = (project: (typeof wb.projects)[number], depth = 0): React.ReactNode => {
    const children = childrenOf(project.id);
    const isSubproject = depth > 0;
    const parentOpen = Boolean(project.parentProjectId && wb.projectId === project.parentProjectId);
    const expanded = expandedProjects.has(project.id);
    return (
      <div
        key={project.id}
        className={cn(depth === 0 && "rounded-xl bg-secondary p-1")}
        style={depth > 0 ? { marginLeft: Math.min(depth, 6) * 12 } : undefined}
      >
        <ProjectRow
          project={project}
          active={project.id === wb.projectId}
          subproject={isSubproject}
          overlayEnabled={parentOpen && wb.enabledSubprojectIds.includes(project.id)}
          hasChildren={children.length > 0}
          expanded={expanded}
          onToggleExpanded={() =>
            setExpandedProjects((current) => {
              const next = new Set(current);
              if (next.has(project.id)) next.delete(project.id);
              else next.add(project.id);
              return next;
            })
          }
          {...(parentOpen
            ? {
                onToggleOverlay: (enabled: boolean) =>
                  void wb.toggleSubprojectOverlay(project.id, enabled),
              }
            : {})}
          onMove={() => {
            setMovingProject(project.id);
            setDestination("");
          }}
          onOpen={() => void wb.openProject(project.id).then(onClose)}
          onDuplicate={() =>
            void wb
              .duplicateProject(project.id)
              .then(() =>
                toast.success(isSubproject ? "Subproject duplicated" : "Project duplicated"),
              )
          }
          {...(isSubproject
            ? {
                onPromote: () =>
                  void wb
                    .promoteProject(project.id)
                    .then(() => toast.success("Subproject moved to top level")),
              }
            : {})}
          onDelete={() => {
            const suffix = children.length > 0 ? " and detach its subprojects" : "";
            if (!window.confirm(`Delete “${project.name}”${suffix}?`)) return;
            void wb
              .deleteProject(project.id)
              .then(() => toast.success(isSubproject ? "Subproject deleted" : "Project deleted"));
          }}
          onNavigationChange={(visibility) =>
            wb.setProjectNavigationVisibility(project.id, visibility).catch((error) => {
              toast.error("Navigation settings could not be saved", {
                description: error instanceof Error ? error.message : "Please try again.",
              });
            })
          }
        />
        {movingProject === project.id && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
            <label className="text-xs">
              Move under project
              <select
                aria-label="Parent project"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="ml-2 rounded border border-border bg-card p-2"
              >
                <option value="">Choose parent</option>
                {wb.projects
                  .filter(
                    (candidate) =>
                      candidate.id !== project.id &&
                      !projectAncestorIds(candidate.id, wb.projects).includes(project.id),
                  )
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={!destination || savingMove}
              className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"
              onClick={async () => {
                setSavingMove(true);
                try {
                  await wb.moveProject(project.id, destination);
                  setExpandedProjects((current) => new Set([...current, destination]));
                  setMovingProject(null);
                  toast.success("Project moved to subproject");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not move project");
                } finally {
                  setSavingMove(false);
                }
              }}
            >
              Move
            </button>
            <button
              disabled={savingMove}
              onClick={() => setMovingProject(null)}
              className="px-2 py-2 text-xs"
            >
              Cancel
            </button>
          </div>
        )}
        {children.length > 0 && expanded && (
          <div className="space-y-1 border-l border-border pl-1">
            {children.map((child) => renderProjectTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="project-menu-height w-[min(92vw,410px)] overflow-y-auto p-3 text-xs">
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-secondary p-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <UserRound className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{auth.user?.name}</div>
          <div className="truncate text-[10px] text-muted-foreground">{auth.user?.email}</div>
        </div>
        <button
          onClick={() => void auth.signOut()}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 rounded-xl bg-secondary p-1">
        <TabButton
          active={view === "projects"}
          onClick={() => setView("projects")}
          icon={<FolderOpen className="size-3.5" />}
          label="Projects"
        />
        <TabButton
          active={view === "settings"}
          onClick={() => setView("settings")}
          icon={<Settings2 className="size-3.5" />}
          label="Settings"
        />
      </div>

      {view === "projects" ? (
        <>
          <div className="mb-3 flex gap-1">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createProject();
              }}
              placeholder="New project name"
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 outline-none focus:border-primary"
            />
            <button
              onClick={createProject}
              className="rounded-xl bg-primary px-3 text-primary-foreground"
              aria-label="Create project"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <section>
            <h3 className="mb-1 flex items-center gap-1.5 font-semibold">
              <FolderOpen className="size-3.5 text-primary" /> Switch project
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                {wb.projects.length} maps
              </span>
            </h3>
            <div className="space-y-1">{roots.map((project) => renderProjectTree(project))}</div>
          </section>

          <details className="group mt-3 rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2.5 font-semibold">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              Subprojects
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Create an independent area map from the project you have open. Open its parent later
                to switch this subproject on as a live overlay.
              </p>
              <div className="flex gap-1">
                <input
                  value={subprojectName}
                  onChange={(event) => setSubprojectName(event.target.value)}
                  placeholder={`${wb.projectName} area`}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5"
                />
                <button
                  onClick={() =>
                    void wb.createSubproject(subprojectName).then(() => {
                      setSubprojectName("");
                      toast.success("Subproject created");
                    })
                  }
                  className="flex items-center gap-1 rounded-lg bg-primary px-2 text-primary-foreground"
                >
                  <FolderPlus className="size-3.5" /> Add
                </button>
              </div>
            </div>
          </details>
        </>
      ) : (
        <div className="space-y-3">
          <section className="space-y-1 rounded-xl border border-border p-3">
            <label className="block font-semibold" htmlFor="project-settings-name">
              Project name
            </label>
            <input
              id="project-settings-name"
              value={wb.projectName}
              onChange={(event) => wb.setProjectName(event.target.value)}
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5 outline-none focus:border-primary"
            />
          </section>

          <section className="space-y-1 rounded-xl border border-border p-3">
            <label className="block font-semibold" htmlFor="derived-layer-category">
              New layers from selections
            </label>
            <select
              id="derived-layer-category"
              value={wb.derivedLayerGroupId}
              onChange={(event) => wb.setDerivedLayerGroupId(event.target.value)}
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5"
            >
              {wb.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              “New layer,” split selections, and table-result layers go here. Newly created
              categories appear automatically.
            </p>
          </section>

          <details className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2.5 font-semibold">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              Advanced project options
            </summary>
            <div className="space-y-3 border-t border-border p-3">
              <label className="flex items-center gap-2 rounded-lg bg-secondary p-2.5">
                <input
                  type="checkbox"
                  checked={wb.autosave}
                  onChange={(event) => void wb.setAutosave(event.target.checked)}
                  className="accent-primary"
                />
                <span className="font-medium">Autosave this project</span>
                <span className="ml-auto text-[10px] text-muted-foreground">after changes</span>
              </label>

              <section>
                <h3 className="mb-1 flex items-center gap-1.5 font-semibold">
                  <Clock3 className="size-3.5 text-primary" /> Save history
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                    {wb.saveHistory.length}/25
                  </span>
                </h3>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {wb.saveHistory.map((version, index) => (
                    <div
                      key={version.id}
                      className="flex items-center rounded-xl bg-secondary px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block text-[11px] font-medium">
                          {index === 0 ? "Latest · " : ""}
                          {projectVersionLabel(version.savedAt)}
                        </span>
                        <span className="capitalize text-[10px] text-muted-foreground">
                          {new Date(version.savedAt).toLocaleString()} · {version.reason}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          void wb
                            .duplicateVersion(version.id)
                            .then(() => toast.success("Version duplicated as a new project"))
                        }
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium hover:bg-accent"
                        title={`Duplicate ${projectVersionLabel(version.savedAt)} as a separate project`}
                        aria-label={`Duplicate ${projectVersionLabel(version.savedAt)} as a separate project`}
                      >
                        <Copy className="size-3" /> Copy
                      </button>
                      <button
                        onClick={() =>
                          void wb
                            .restoreVersion(version.id)
                            .then(() => toast.success("Save restored"))
                        }
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium hover:bg-accent"
                        title={`Restore ${projectVersionLabel(version.savedAt)}`}
                      >
                        <RotateCcw className="size-3" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </details>
        </div>
      )}

      <p className="mt-3 text-center text-[9px] leading-relaxed text-muted-foreground">
        {auth.cloudEnabled ? (
          <span className="inline-flex items-center gap-1">
            <Cloud className="size-3" /> Secure cloud workspace · available on all your devices
          </span>
        ) : (
          "Cloud connection pending; projects currently remain on this device."
        )}
      </p>
    </div>
  );
}

function ProjectRow({
  project,
  active,
  subproject,
  overlayEnabled,
  hasChildren,
  expanded,
  onToggleExpanded,
  onToggleOverlay,
  onOpen,
  onDuplicate,
  onMove,
  onPromote,
  onDelete,
  onNavigationChange,
}: {
  project: ReturnType<typeof useWorkbench>["projects"][number];
  active: boolean;
  subproject?: boolean;
  overlayEnabled?: boolean;
  hasChildren: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleOverlay?: (enabled: boolean) => void;
  onOpen: () => void;
  onDuplicate: () => void;
  onMove: () => void;
  onPromote?: () => void;
  onDelete: () => void;
  onNavigationChange: (visibility: {
    showInQuickSwitch: boolean;
    showInMobileBar: boolean;
  }) => Promise<void>;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [savingNavigation, setSavingNavigation] = useState(false);

  const updateNavigation = async (visibility: {
    showInQuickSwitch: boolean;
    showInMobileBar: boolean;
  }) => {
    setSavingNavigation(true);
    try {
      await onNavigationChange(visibility);
    } finally {
      setSavingNavigation(false);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-lg p-0.5",
          active && "bg-accent ring-1 ring-primary",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            className="rounded-lg p-1.5 hover:bg-card"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
            aria-expanded={expanded}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        {onToggleOverlay && (
          <button
            onClick={() => onToggleOverlay(!overlayEnabled)}
            className="rounded-lg p-1.5 text-primary hover:bg-card"
            aria-label={`${overlayEnabled ? "Hide" : "Show"} ${project.name} on parent`}
            title="Toggle live overlay on the open parent"
          >
            {overlayEnabled ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
        )}
        <button onClick={onOpen} className="min-w-0 flex-1 px-1.5 py-1.5 text-left">
          <span className="block truncate font-medium" title={project.name}>
            {project.name}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {active ? "Open now · " : ""}
            {subproject ? "Subproject · " : ""}
            {project.versionCount} saves
          </span>
        </button>
        <button
          type="button"
          onClick={() => setNavigationOpen((current) => !current)}
          className={cn("rounded-lg p-1.5 hover:bg-card", navigationOpen && "bg-card text-primary")}
          title="Navigation visibility"
          aria-label={`Navigation visibility for ${project.name}`}
          aria-expanded={navigationOpen}
        >
          <Navigation className="size-3.5" />
        </button>
        <button onClick={onDuplicate} className="rounded-lg p-1.5 hover:bg-card" title="Duplicate">
          <Copy className="size-3.5" />
        </button>
        <button
          onClick={onMove}
          title="Make subproject / move under another project"
          aria-label={`Move ${project.name} under another project`}
          className="rounded-lg p-1.5 hover:bg-card"
        >
          <FolderPlus className="size-3.5" />
        </button>
        {onPromote && (
          <button
            onClick={onPromote}
            className="rounded-lg p-1.5 hover:bg-card"
            title="Move to top level"
          >
            <ArrowUpFromLine className="size-3.5" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10"
          aria-label={`Delete ${project.name}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {navigationOpen && (
        <section className="mx-1 mb-1 mt-1 rounded-lg border border-border bg-card p-2.5">
          <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Navigation className="size-3" /> Navigation
          </h4>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-accent">
            <input
              type="checkbox"
              checked={project.showInQuickSwitch}
              disabled={savingNavigation}
              onChange={(event) =>
                void updateNavigation({
                  showInQuickSwitch: event.target.checked,
                  showInMobileBar: project.showInMobileBar,
                })
              }
              className="accent-primary"
            />
            <span className="font-medium">Show in Quick Switch</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-accent">
            <input
              type="checkbox"
              checked={project.showInMobileBar}
              disabled={savingNavigation}
              onChange={(event) =>
                void updateNavigation({
                  showInQuickSwitch: project.showInQuickSwitch,
                  showInMobileBar: event.target.checked,
                })
              }
              className="accent-primary"
            />
            <span className="font-medium">Show in Mobile Project Bar</span>
          </label>
          <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
            These lists are independent. Hiding this project here does not remove or change it.
          </p>
        </section>
      )}
    </div>
  );
}

function projectAncestorIds(
  projectId: string,
  projects: ReturnType<typeof useWorkbench>["projects"],
): string[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(projectId);
  while (current?.parentProjectId && !visited.has(current.parentProjectId)) {
    visited.add(current.parentProjectId);
    ancestors.unshift(current.parentProjectId);
    current = byId.get(current.parentProjectId);
  }
  return ancestors;
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-medium",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
