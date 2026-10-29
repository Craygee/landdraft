import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Circle,
  Database,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import {
  checkProjectConnections,
  findConnectionReplacement,
  probeConnectionUrl,
  saveCatalogUrlOverride,
  saveConnectionHint,
  type ConnectionReplacement,
  type ConnectionResult,
} from "@/lib/gis/connectionHealth";
import { basemapProbeUrl, saveBasemapUrlOverride } from "@/lib/gis/basemaps";
import { cn } from "@/lib/utils";
import { useAccountPublicData } from "@/lib/gis/AccountPublicData";

const statusLabel = {
  healthy: "Connected",
  fallback: "Fallback active",
  error: "Needs attention",
} as const;

export function ConnectionManager({ floatingBadge = true }: { floatingBadge?: boolean } = {}) {
  const account = useAccountPublicData();
  const accountRef = useRef(account);
  accountRef.current = account;
  const wb = useWorkbench();
  const { connectionsOpen, setConnectionsOpen, setDrawerOpen } = useMapRef();
  const [connections, setConnections] = useState<ConnectionResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [badgeExpanded, setBadgeExpanded] = useState(false);
  const [badgeHidden, setBadgeHidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const wbRef = useRef(wb);
  wbRef.current = wb;
  const autoCheckedProject = useRef<string | null>(null);
  const checkingRef = useRef(false);

  const applyReplacement = useCallback(
    async (result: ConnectionResult, replacement: ConnectionReplacement, quiet = false) => {
      const current = wbRef.current;
      const url = replacement.url.trim();
      await probeConnectionUrl(
        result.kind === "basemap" ? basemapProbeUrl(url) : url,
        10_000,
        result.kind !== "basemap",
      );
      if (result.kind === "basemap") {
        saveBasemapUrlOverride(result.basemapId ?? result.id.replace(/^basemap:/, ""), url);
      } else if (result.id.startsWith("account:")) {
        const id = result.id.slice(8);
        await accountRef.current.update((config) => {
          const service = config.services[id];
          if (!service) throw new Error("Account service no longer exists");
          return { ...config, services: { ...config.services, [id]: { ...service, url } } };
        });
        for (const layer of current.layers) {
          if (layer.source.kind === "remote" && layer.source.accountServiceId === id)
            current.updateLayer(layer.id, { source: { ...layer.source, url } });
        }
      } else if (result.id.startsWith("catalog:")) {
        await accountRef.current.update((config) => ({
          ...config,
          overrides: { ...config.overrides, [result.id]: url },
        }));
        const catalogId = result.id.slice("catalog:".length);
        saveCatalogUrlOverride(catalogId, url);
        for (const layer of current.layers) {
          if (layer.source.kind === "remote" && layer.source.catalogId === catalogId)
            current.updateLayer(layer.id, { source: { ...layer.source, url } });
        }
      } else if (result.id.startsWith("layer:")) {
        const layerId = result.id.slice("layer:".length);
        const layer = current.layers.find((item) => item.id === layerId);
        if (layer?.source.kind === "remote")
          current.updateLayer(layerId, { source: { ...layer.source, url } });
      }
      const hint = {
        url,
        notes: replacement.notes,
        updatedAt: new Date().toISOString(),
        verified: true,
      };
      saveConnectionHint(result.id, hint);
      current.setConnectionHint(result.id, hint);
      setUrls((value) => ({ ...value, [result.id]: url }));
      setNotes((value) => ({ ...value, [result.id]: replacement.notes }));
      if (!quiet) toast.success(`${result.name} reconnected`);
    },
    [],
  );

  const checkAll = useCallback(
    async ({ autoRepair = false, notify = false } = {}) => {
      if (checkingRef.current || !navigator.onLine) return;
      checkingRef.current = true;
      setChecking(true);
      try {
        let results = await checkProjectConnections(
          wbRef.current.layers,
          wbRef.current.connectionHints,
          accountRef.current.config,
        );
        let repaired = 0;
        if (autoRepair) {
          const broken = results.filter((item) => item.status !== "healthy");
          for (const result of broken) {
            try {
              const replacement = await findConnectionReplacement(
                result,
                wbRef.current.connectionHints[result.id]?.url ?? result.configuredUrl ?? "",
                wbRef.current.connectionHints[result.id]?.notes ?? "",
              );
              if (!replacement.safeToAutoApply) continue;
              await applyReplacement(result, replacement, true);
              repaired += 1;
            } catch {
              // The failure is reported only after every safe recovery path has been attempted.
            }
          }
          if (repaired) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            results = await checkProjectConnections(
              wbRef.current.layers,
              wbRef.current.connectionHints,
              accountRef.current.config,
            );
          }
        }
        setConnections(results);
        void accountRef.current.recordHealth(results).catch(() => {
          // Current connection results remain usable even when account sync is offline.
        });
        const failed = results.filter((item) => item.status === "error");
        if (repaired)
          toast.success(
            `${repaired} connection${repaired === 1 ? " was" : "s were"} updated automatically`,
          );
        if (notify) {
          if (failed.length)
            toast.warning(
              `${failed.length} connection${failed.length === 1 ? "" : "s"} need attention`,
              {
                description:
                  "Automatic recovery was attempted. Select View connections to see details and repair options.",
                action: {
                  label: "View connections",
                  onClick: () => {
                    setExpandedId(failed[0]?.id ?? null);
                    setConnectionsOpen(true);
                  },
                },
              },
            );
          else if (!repaired) toast.success("All map and public-data connections are online");
        }
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    },
    [applyReplacement, setConnectionsOpen],
  );

  const accountConnections = JSON.stringify([
    account.config.services,
    account.config.removed,
    account.config.overrides,
    account.config.restoredDefaults,
  ]);
  useEffect(() => {
    const key = wb.projectId + accountConnections;
    if (!account.ready || !wb.projectReady || !wb.projectId || autoCheckedProject.current === key)
      return;
    const timer = window.setTimeout(() => {
      autoCheckedProject.current = key;
      void checkAll({ autoRepair: true, notify: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [checkAll, wb.projectId, wb.projectReady, account.ready, accountConnections]);
  useEffect(() => {
    if (!account.ready || !wb.projectReady) return;
    const timer = window.setInterval(() => void checkAll(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [account.ready, checkAll, wb.projectReady]);

  useEffect(() => {
    if (connectionsOpen && !connections.length && !checking) void checkAll();
  }, [checkAll, checking, connections.length, connectionsOpen]);

  const findReplacement = async (result: ConnectionResult) => {
    setBusyId(`find:${result.id}`);
    try {
      const replacement = await findConnectionReplacement(
        result,
        urls[result.id] ?? wb.connectionHints[result.id]?.url ?? result.configuredUrl ?? "",
        notes[result.id] ?? wb.connectionHints[result.id]?.notes ?? "",
      );
      setUrls((value) => ({ ...value, [result.id]: replacement.url }));
      setNotes((value) => ({
        ...value,
        [result.id]: `${replacement.notes} Found via ${replacement.source}.`,
      }));
      toast.success("Verified replacement found", {
        description: "Review it, then choose Test & use.",
      });
    } catch (error) {
      toast.error("A replacement was not found", {
        description: error instanceof Error ? error.message : "Add a source clue and try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const testAndUse = async (result: ConnectionResult) => {
    const url = (
      urls[result.id] ??
      wb.connectionHints[result.id]?.url ??
      result.configuredUrl
    )?.trim();
    if (!url) return;
    setBusyId(`use:${result.id}`);
    try {
      await applyReplacement(result, {
        url,
        title: result.name,
        notes: notes[result.id]?.trim() || "Manually verified connection",
        source: "existing URL",
        safeToAutoApply: false,
      });
      await checkAll();
    } catch (error) {
      toast.error("That connection could not be verified", {
        description: error instanceof Error ? error.message : "Check the URL and try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const grouped = useMemo(
    () =>
      [
        ["Basemaps", connections.filter((item) => item.kind === "basemap")],
        ["Public data", connections.filter((item) => item.kind === "public-data")],
        ["Project connections", connections.filter((item) => item.kind === "project-layer")],
      ] as const,
    [connections],
  );

  if (!connectionsOpen) {
    const failed = connections.filter((result) => result.status === "error");
    if (!floatingBadge || !failed.length || wb.selectedFeatures.length > 0 || badgeHidden)
      return null;
    return (
      <div
        className="connection-status-control fixed bottom-28 right-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center rounded-xl border border-destructive/30 bg-card text-xs font-semibold text-destructive shadow-float sm:bottom-4"
        data-connection-badge="true"
      >
        <button
          onClick={() => setBadgeExpanded(!badgeExpanded)}
          aria-expanded={badgeExpanded}
          aria-label={`${badgeExpanded ? "Collapse" : "Expand"} ${failed.length} connection issues`}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1 px-2"
        >
          <Link2 className="size-4 shrink-0" />
          <span>{failed.length}</span>
        </button>
        {badgeExpanded && (
          <>
            <button
              onClick={() => {
                setExpandedId(failed[0]?.id ?? null);
                setConnectionsOpen(true);
              }}
              className="min-h-11 px-2"
            >
              View connection details
            </button>
            <button
              onClick={() => setBadgeHidden(true)}
              aria-label="Hide connection status; reopen from Help and settings, API connections"
              className="flex size-11 shrink-0 items-center justify-center"
            >
              <X className="size-4" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/25 p-3 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="API connections"
        className="flex max-h-[min(88dvh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-float"
      >
        <header className="flex items-center gap-3 border-b border-border p-4">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Database className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">API connections</h2>
            <p className="text-[11px] text-muted-foreground">
              Live source status, automatic recovery, and manual URL controls
            </p>
          </div>
          <button
            onClick={() => void checkAll({ autoRepair: true, notify: true })}
            disabled={checking}
            className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            {checking ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Check & repair
          </button>
          <button
            onClick={() => setConnectionsOpen(false)}
            aria-label="Close connections"
            className="rounded-xl p-2 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {checking && !connections.length ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking live sources…
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(([label, items]) =>
                items.length ? (
                  <div key={label}>
                    <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>{label}</span>
                      <span>{items.length}</span>
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-border">
                      {items.map((result) => {
                        const expanded = expandedId === result.id;
                        const sourceUrl =
                          urls[result.id] ??
                          wb.connectionHints[result.id]?.url ??
                          result.configuredUrl ??
                          result.url;
                        return (
                          <div key={result.id} className="border-b border-border last:border-b-0">
                            <button
                              onClick={() => setExpandedId(expanded ? null : result.id)}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/60"
                              aria-expanded={expanded}
                            >
                              <Circle
                                className={cn(
                                  "size-2.5 shrink-0 fill-current",
                                  result.status === "healthy" && "text-emerald-600",
                                  result.status === "fallback" && "text-amber-500",
                                  result.status === "error" && "text-red-600",
                                )}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold">
                                  {result.name}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {statusLabel[result.status]} · {result.message}
                                </span>
                              </span>
                              <ChevronDown
                                className={cn(
                                  "size-4 transition-transform",
                                  expanded && "rotate-180",
                                )}
                              />
                            </button>
                            {expanded && (
                              <div className="space-y-2 border-t border-border bg-secondary/35 p-3">
                                <div className="flex items-center gap-2">
                                  <input
                                    value={sourceUrl}
                                    onChange={(event) =>
                                      setUrls((value) => ({
                                        ...value,
                                        [result.id]: event.target.value,
                                      }))
                                    }
                                    aria-label={`${result.name} URL`}
                                    className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
                                  />
                                  <a
                                    href={result.sourcePage ?? sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Open source"
                                    className="rounded-xl border border-border bg-card p-2 hover:bg-accent"
                                  >
                                    <ExternalLink className="size-4" />
                                  </a>
                                </div>
                                <textarea
                                  value={
                                    notes[result.id] ?? wb.connectionHints[result.id]?.notes ?? ""
                                  }
                                  onChange={(event) =>
                                    setNotes((value) => ({
                                      ...value,
                                      [result.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Optional publisher page or reconnect note"
                                  rows={2}
                                  className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => void findReplacement(result)}
                                    disabled={busyId !== null}
                                    className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                                  >
                                    {busyId === `find:${result.id}` ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Search className="size-3.5" />
                                    )}
                                    Find replacement
                                  </button>
                                  <button
                                    onClick={() => void testAndUse(result)}
                                    disabled={busyId !== null}
                                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                                  >
                                    {busyId === `use:${result.id}` ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Link2 className="size-3.5" />
                                    )}
                                    Test & use
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border p-3 text-[10px] text-muted-foreground sm:px-4">
          <span>Green = online · amber = fallback · red = unavailable after recovery</span>
          <button
            onClick={() => {
              setConnectionsOpen(false);
              setDrawerOpen(true);
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent"
          >
            <Plus className="size-3.5" /> Add connection
          </button>
        </footer>
      </section>
    </div>
  );
}
