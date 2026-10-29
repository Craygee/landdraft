import { PublicLayerAddedBadge } from "./PublicLayerAddedBadge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  Database,
  Loader2,
  Plus,
  Link2,
  ShieldAlert,
  ExternalLink,
  Radio,
  Clock3,
  SlidersHorizontal,
  Library,
  CircleCheck,
  TriangleAlert,
  ChevronDown,
  RotateCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { useAccountPublicData } from "@/lib/gis/AccountPublicData";
import type { AccountService } from "@/lib/gis/publicDataAccountModel";
import {
  PublicDataAccountSettings,
  AccountServiceLibrary,
  RemovedPublicDataSources,
  RemovePublicDataSource,
} from "./PublicDataAccountControls";

import {
  categories,
  searchCatalog,
  SURFACE_WATER_CATEGORY,
  US_STATES,
  type CatalogEntry,
} from "@/lib/gis/catalog";
import { fetchArcgisFields, fetchRemoteGeoJSON, type ArcgisField } from "@/lib/gis/arcgis";
import {
  dataGovDiscoveryUrl,
  searchRepositories,
  type PublicRepository,
} from "@/lib/gis/repositories";
import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import {
  checkProjectConnections,
  findConnectionReplacement,
  probeConnectionUrl,
  resolveCatalogUrl,
  saveCatalogUrlOverride,
  saveConnectionHint,
  type ConnectionResult,
} from "@/lib/gis/connectionHealth";
import { basemapProbeUrl, saveBasemapUrlOverride } from "@/lib/gis/basemaps";
import { cn } from "@/lib/utils";
import { importFile } from "@/lib/gis/import";

const catalogLayerStyle = (entry: CatalogEntry) => {
  if (entry.id === "tx-parcels")
    return {
      fillOpacity: 0,
      strokeWidth: 1,
      labelEnabled: true,
      labelTemplate: "{OWNER_NAME}",
      labelFields: ["OWNER_NAME"],
      labelMinZoom: 11,
      labelSize: 11,
      labelScaleWithZoom: true,
    };
  if (entry.id === "us-state-boundaries-shp")
    return {
      fillOpacity: 0.08,
      strokeWidth: 2,
      strokeColor: "#3b6ea5",
      fillColor: "#3b6ea5",
      labelEnabled: true,
      labelTemplate: "{NAME}",
      labelFields: ["NAME"],
      labelSize: 12,
    };
  if (entry.id === "us-opportunity-zones")
    return {
      fillOpacity: 0.22,
      strokeWidth: 1.5,
      strokeColor: "#6b3fa0",
      fillColor: "#8a5bb8",
      labelEnabled: false,
    };
  if (entry.geometry === "line") return { fillOpacity: 0, strokeWidth: 2.5 };
  return {};
};

export function DataDrawer() {
  const account = useAccountPublicData();
  const accountRef = useRef(account);
  accountRef.current = account;
  const [everyMap, setEveryMap] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const { drawerOpen, setDrawerOpen, map, pendingCatalogQuery } = useMapRef();
  const wb = useWorkbench();
  const [query, setQuery] = useState(pendingCatalogQuery);
  const [category, setCategory] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [sourceFilters, setSourceFilters] = useState<
    Record<string, { field: string; operator: string; value: string }>
  >({});
  const [county, setCounty] = useState("");
  const [showStates, setShowStates] = useState(false);
  const [mode, setMode] = useState<"layers" | "repositories">("layers");
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [fieldOptions, setFieldOptions] = useState<Record<string, ArcgisField[]>>({});
  const [selectedFields, setSelectedFields] = useState<Record<string, string[]>>({});
  const [connections, setConnections] = useState<ConnectionResult[]>([]);
  const [checkingConnections, setCheckingConnections] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [reconnectUrls, setReconnectUrls] = useState<Record<string, string>>({});
  const [reconnectNotes, setReconnectNotes] = useState<Record<string, string>>({});
  const layersRef = useRef(wb.layers);
  layersRef.current = wb.layers;
  const connectionHintsRef = useRef(wb.connectionHints);
  connectionHintsRef.current = wb.connectionHints;

  const results = useMemo(
    () =>
      searchCatalog(query, category, wb.selectedStates, account.config.restoredDefaults).filter(
        (entry) => !account.config.removed[`catalog:${entry.id}`],
      ),
    [query, category, wb.selectedStates, account.config.removed, account.config.restoredDefaults],
  );
  const repositories = useMemo(
    () => searchRepositories(query, wb.selectedStates),
    [query, wb.selectedStates],
  );

  useEffect(() => {
    if (drawerOpen) setQuery(pendingCatalogQuery);
  }, [drawerOpen, pendingCatalogQuery]);

  const verifyConnections = useCallback(async (notify = false) => {
    setCheckingConnections(true);
    try {
      const results = await checkProjectConnections(
        layersRef.current,
        connectionHintsRef.current,
        accountRef.current.config,
      );
      setConnections(results);
      void accountRef.current.recordHealth(results).catch(() => {});
      const failed = results.filter((result) => result.status === "error");
      if (notify) {
        if (failed.length) {
          toast.warning(
            `${failed.length} connection${failed.length === 1 ? "" : "s"} need attention`,
            {
              description: "Open Public data → Connections to review or reconnect them.",
            },
          );
        } else {
          toast.success("Map and public-data connections verified");
        }
      }
      return results;
    } finally {
      setCheckingConnections(false);
    }
  }, []);

  const viewportBbox = (): [number, number, number, number] | undefined => {
    if (!map) return undefined;
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  };

  const load = async (entry: CatalogEntry) => {
    const cloudOverride = wb.connectionHints[`catalog:${entry.id}`];
    const resolvedEntryUrl =
      account.config.overrides[`catalog:${entry.id}`] ??
      (cloudOverride?.verified ? cloudOverride.url : resolveCatalogUrl(entry));
    const existing = wb.layers.find(
      (layer) =>
        (layer.source.kind === "remote" || layer.source.kind === "import") &&
        layer.source.catalogId === entry.id,
    );
    // Remote entries may be added repeatedly with different field selections or
    // source filters. Reusing by catalog ID alone silently discards those options.
    if (existing && entry.downloadUrl) {
      wb.updateLayer(existing.id, {
        visible: true,
        source:
          existing.source.kind === "remote" && resolvedEntryUrl
            ? { ...existing.source, url: resolvedEntryUrl }
            : existing.source,
      });
      wb.setActiveLayer(existing.id);
      toast.success(`${entry.name} is ready`, {
        description:
          entry.minZoom && map && map.getZoom() < entry.minZoom
            ? `It will appear automatically at zoom ${entry.minZoom} or closer.`
            : "The existing layer was made visible.",
      });
      setDrawerOpen(false);
      return;
    }
    if (entry.downloadUrl) {
      setLoadingId(entry.id);
      try {
        const downloadRequestUrl =
          entry.id === "us-state-boundaries-shp"
            ? "/api/public-data/census-state-boundaries"
            : entry.downloadUrl;
        const response = await fetch(downloadRequestUrl);
        if (!response.ok) throw new Error(`Publisher returned HTTP ${response.status}`);
        const fileName = entry.downloadUrl.split("/").at(-1) || `${entry.id}.zip`;
        const result = await importFile(
          new File([await response.blob()], fileName, { type: "application/zip" }),
        );
        const layer = wb.addLayer({
          name: entry.name,
          data: result.data,
          groupId: "public",
          source: {
            kind: "import",
            fileName,
            catalogId: entry.id,
            attribution: entry.agency,
            sourceUrl: entry.downloadUrl,
          },
          style: catalogLayerStyle(entry),
        });
        wb.setActiveLayer(layer.id);
        toast.success(`${entry.name} added`, {
          description: `${result.featureCount.toLocaleString()} official boundaries loaded into Public data.`,
        });
        setDrawerOpen(false);
      } catch (error) {
        toast.error(`${entry.name} could not be imported`, {
          description:
            error instanceof Error
              ? `${error.message}. The publisher download remains available under Source details.`
              : "The publisher download could not be read.",
        });
      } finally {
        setLoadingId(null);
      }
      return;
    }
    const entryUrl = resolvedEntryUrl;
    if (!entryUrl) {
      if (entry.sourcePage) window.open(entry.sourcePage, "_blank", "noopener,noreferrer");
      return;
    }
    const countyWhere =
      entry.countyField && county.trim()
        ? `${entry.countyField}='${county.trim().replaceAll("'", "''")}'`
        : undefined;
    const filter = sourceFilters[entry.id];
    let attributeWhere = "";
    if (filter?.field) {
      const metadata = fieldOptions[entry.id]?.find((item) => item.name === filter.field);
      if (!metadata || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(filter.field)) {
        toast.error("Choose a valid source field.");
        return;
      }
      const escaped = filter.value.replaceAll("'", "''");
      if (filter.operator === "empty") attributeWhere = filter.field + " IS NULL";
      else if (filter.operator === "contains")
        attributeWhere =
          "UPPER(" +
          filter.field +
          ") LIKE '%" +
          escaped.toUpperCase().replaceAll("%", "").replaceAll("_", "") +
          "%'";
      else {
        const numeric = /Integer|SmallInteger|Double|Single|OID/.test(metadata.type);
        if (numeric && (!filter.value.trim() || !Number.isFinite(Number(filter.value)))) {
          toast.error("Enter a numeric filter value.");
          return;
        }
        attributeWhere =
          filter.field +
          (filter.operator === "not_equals" ? " <> " : " = ") +
          (numeric ? String(Number(filter.value)) : "'" + escaped + "'");
      }
    }
    const where = [entry.where, countyWhere, attributeWhere]
      .filter(Boolean)
      .map((clause) => "(" + clause + ")")
      .join(" AND ");
    const effectiveMinZoom =
      entry.minZoom ?? (entry.geometry === "point" ? 7 : entry.geometry === "line" ? 5 : 5);
    const source = {
      kind: "remote" as const,
      url: entryUrl,
      catalogId: entry.id,
      attribution: entry.agency,
      ...(where ? { where } : {}),
      requiresViewport: true,
      minZoom: effectiveMinZoom,
      ...(entry.id === "tx-parcels" ? { parcelDisplayVersion: 2 } : {}),
      ...(selectedFields[entry.id]?.length ? { outFields: selectedFields[entry.id] } : {}),
    };
    const addedLayer = wb.addLayer({
      name: entry.name + (attributeWhere ? " · filtered" : ""),
      data: { type: "FeatureCollection", features: [] },
      groupId: "public",
      source,
      style: catalogLayerStyle(entry),
    });
    wb.setActiveLayer(addedLayer.id);
    toast.success(`${entry.name} added`, {
      description:
        map && map.getZoom() < effectiveMinZoom
          ? `It will load automatically when you reach zoom ${effectiveMinZoom} or closer.`
          : "Loading the visible map area now.",
    });
    setDrawerOpen(false);
  };

  const inspectFields = async (entry: CatalogEntry) => {
    const cloudOverride = wb.connectionHints[`catalog:${entry.id}`];
    const entryUrl =
      account.config.overrides[`catalog:${entry.id}`] ??
      (cloudOverride?.verified ? cloudOverride.url : resolveCatalogUrl(entry));
    if (!entryUrl) return;
    if (inspectId === entry.id) {
      setInspectId(null);
      return;
    }
    setInspectId(entry.id);
    if (fieldOptions[entry.id]) return;
    setLoadingId(`fields:${entry.id}`);
    try {
      const fields = await fetchArcgisFields(entryUrl);
      setFieldOptions((current) => ({ ...current, [entry.id]: fields }));
      setSelectedFields((current) => ({
        ...current,
        [entry.id]: fields.map((field) => field.name),
      }));
    } catch (error) {
      toast.error("Attributes could not be inspected", {
        description:
          error instanceof Error ? error.message : "The publisher did not expose a schema",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const reconnect = async (result: ConnectionResult) => {
    const url = (reconnectUrls[result.id] ?? wb.connectionHints[result.id]?.url)?.trim();
    if (!url) return;
    setLoadingId(`connection:${result.id}`);
    try {
      await probeConnectionUrl(
        result.kind === "basemap" ? basemapProbeUrl(url) : url,
        10_000,
        result.kind !== "basemap",
      );
      if (result.kind === "basemap") {
        const basemapId = result.basemapId ?? result.id.replace(/^basemap:/, "");
        saveBasemapUrlOverride(basemapId, url);
      } else if (result.id.startsWith("account:")) {
        const id = result.id.slice(8);
        await account.update((current) => {
          const service = current.services[id];
          if (!service) throw new Error("Account service no longer exists");
          return { ...current, services: { ...current.services, [id]: { ...service, url } } };
        });
      } else if (result.id.startsWith("catalog:")) {
        await account.update((current) => ({
          ...current,
          overrides: { ...current.overrides, [result.id]: url },
        }));
        const catalogId = result.id.slice("catalog:".length);
        saveCatalogUrlOverride(catalogId, url);
        for (const layer of wb.layers) {
          if (layer.source.kind === "remote" && layer.source.catalogId === catalogId) {
            wb.updateLayer(layer.id, { source: { ...layer.source, url } });
          }
        }
      } else if (result.id.startsWith("layer:")) {
        const layerId = result.id.slice("layer:".length);
        const layer = wb.layers.find((item) => item.id === layerId);
        if (layer?.source.kind === "remote")
          wb.updateLayer(layerId, { source: { ...layer.source, url } });
      }
      saveConnectionHint(result.id, {
        url,
        notes: reconnectNotes[result.id] ?? "Verified replacement service",
      });
      wb.setConnectionHint(result.id, {
        url,
        notes: reconnectNotes[result.id] ?? "Verified replacement service",
        updatedAt: new Date().toISOString(),
        verified: true,
      });
      toast.success(`${result.name} reconnected`);
      await verifyConnections(false);
    } catch (error) {
      toast.error("That connection could not be verified", {
        description: error instanceof Error ? error.message : "Check the URL and try again",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const findReplacement = async (result: ConnectionResult) => {
    setLoadingId(`discover:${result.id}`);
    try {
      const replacement = await findConnectionReplacement(
        result,
        reconnectUrls[result.id] ?? wb.connectionHints[result.id]?.url ?? "",
        reconnectNotes[result.id] ?? wb.connectionHints[result.id]?.notes ?? "",
      );
      setReconnectUrls((current) => ({ ...current, [result.id]: replacement.url }));
      setReconnectNotes((current) => ({
        ...current,
        [result.id]: `${replacement.notes} Found via ${replacement.source}.`,
      }));
      toast.success("Healthy replacement found", {
        description: `${replacement.title} is ready to review. Select Test & use to apply it.`,
      });
    } catch (error) {
      toast.error("A replacement was not found", {
        description:
          error instanceof Error
            ? error.message
            : "Add a publisher website or another clue and try again.",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const saveReconnectClue = (result: ConnectionResult) => {
    const url =
      reconnectUrls[result.id]?.trim() ||
      wb.connectionHints[result.id]?.url ||
      result.sourcePage ||
      "";
    const notes =
      reconnectNotes[result.id]?.trim() ||
      wb.connectionHints[result.id]?.notes ||
      "Possible source for reconnecting this layer";
    if (!url && !notes) return;
    saveConnectionHint(result.id, { url, notes });
    wb.setConnectionHint(result.id, {
      url,
      notes,
      updatedAt: new Date().toISOString(),
      verified: false,
    });
    toast.success("Reconnect information saved", {
      description: "The source clue will be saved with this project.",
    });
  };

  const loadCustom = async (saved?: AccountService) => {
    const url = (saved?.url ?? customUrl).trim();
    if (!url) return;
    setLoadingId("custom");
    try {
      const bboxValue = viewportBbox();
      const data = await fetchRemoteGeoJSON(url, {
        ...(bboxValue ? { bbox: bboxValue } : {}),
        maxFeatures: 2000,
      });
      const name =
        saved?.name ?? (serviceName.trim() || url.split("/").filter(Boolean).slice(-3).join("/"));
      if (!saved && everyMap) {
        if (!account.ready)
          throw new Error("Wait for account sync before adding an account-wide service");
        const existing = Object.values(account.config.services).find(
          (service) => service.url === url,
        );
        const service = { id: existing?.id ?? crypto.randomUUID(), name, url, everyMap: true };
        await account.update((current) => {
          const removed = { ...current.removed };
          delete removed[`account:${service.id}`];
          return { ...current, services: { ...current.services, [service.id]: service }, removed };
        });
        toast.success("Service added across your account", {
          description:
            "Included on this map and other editable maps as they open. Data loads for each map's visible area.",
        });
        setCustomUrl("");
        setServiceName("");
        setDrawerOpen(false);
        return;
      }
      wb.addLayer({
        name,
        data,
        groupId: "public",
        source: { kind: "remote", url, requiresViewport: true, minZoom: 8 },
      });
      toast.success(`Connected · ${data.features.length} features`);
      setCustomUrl("");
      setDrawerOpen(false);
    } catch (err) {
      toast.error("Connection failed", {
        description: err instanceof Error ? err.message : "Check the service URL",
      });
    } finally {
      setLoadingId(null);
    }
  };

  if (!drawerOpen || !wb.canEditProject) return null;

  return (
    <div className="absolute inset-0 z-[80] flex">
      <button
        className="flex-1 bg-foreground/20 backdrop-blur-[2px]"
        aria-label="Close data drawer"
        title="Close the public data library"
        onClick={() => setDrawerOpen(false)}
      />
      <aside className="panel-surface flex h-full w-full max-w-md flex-col overflow-hidden md:rounded-l-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Database className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Public data library</h2>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close"
            title="Close the public data library"
            className="ml-auto rounded-lg p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-border px-4 py-2">
          <button
            onClick={() => setConnectionsOpen((open) => !open)}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs hover:bg-secondary"
            aria-expanded={connectionsOpen}
            title="Review basemap and public-data connection status"
          >
            {checkingConnections ? (
              <Loader2 className="size-3.5 animate-spin text-primary" />
            ) : connections.some((result) => result.status === "error") ? (
              <TriangleAlert className="size-3.5 text-clay" />
            ) : (
              <CircleCheck className="size-3.5 text-primary" />
            )}
            <span className="font-medium">
              {checkingConnections
                ? "Checking connections…"
                : connections.some((result) => result.status === "error")
                  ? `${connections.filter((result) => result.status === "error").length} connections need attention`
                  : connections.length
                    ? `${connections.length} connections verified`
                    : "Connection status"}
            </span>
            <ChevronDown
              className={cn(
                "ml-auto size-3.5 transition-transform",
                connectionsOpen && "rotate-180",
              )}
            />
          </button>
          {connectionsOpen && (
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-xl bg-secondary/60 p-2">
              <div className="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                <span>
                  {connections.filter((result) => result.status === "healthy").length} healthy ·{" "}
                  {connections.filter((result) => result.status === "fallback").length} fallback ·{" "}
                  {connections.filter((result) => result.status === "error").length} failed
                </span>
                <button
                  onClick={() => void verifyConnections(true)}
                  disabled={checkingConnections}
                  className="flex items-center gap-1 font-medium text-primary disabled:opacity-50"
                >
                  <RotateCw className={cn("size-3", checkingConnections && "animate-spin")} />
                  Check now
                </button>
              </div>
              {connections
                .filter((result) => result.status !== "healthy")
                .map((result) => (
                  <div key={result.id} className="rounded-lg border border-border bg-card p-2">
                    <div className="flex items-start gap-2">
                      {result.status === "fallback" ? (
                        <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      ) : (
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-clay" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold">{result.name}</div>
                        <div className="text-[10px] text-muted-foreground">{result.message}</div>
                      </div>
                    </div>
                    {result.status !== "healthy" && (
                      <div className="mt-2 space-y-1.5">
                        {result.sourcePage && (
                          <a
                            href={result.sourcePage}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" /> Open publisher website
                          </a>
                        )}
                        <input
                          value={
                            reconnectUrls[result.id] ?? wb.connectionHints[result.id]?.url ?? ""
                          }
                          onChange={(event) =>
                            setReconnectUrls((current) => ({
                              ...current,
                              [result.id]: event.target.value,
                            }))
                          }
                          placeholder="Replacement service or helpful website URL"
                          aria-label={`Replacement URL for ${result.name}`}
                          className="num w-full rounded-lg border border-border bg-secondary/50 px-2 py-1.5 text-[10px] outline-none focus:border-primary"
                        />
                        <textarea
                          value={
                            reconnectNotes[result.id] ?? wb.connectionHints[result.id]?.notes ?? ""
                          }
                          onChange={(event) =>
                            setReconnectNotes((current) => ({
                              ...current,
                              [result.id]: event.target.value,
                            }))
                          }
                          placeholder="Optional notes about where this data may have moved"
                          aria-label={`Reconnect notes for ${result.name}`}
                          rows={2}
                          className="w-full resize-none rounded-lg border border-border bg-secondary/50 px-2 py-1.5 text-[10px] outline-none focus:border-primary"
                        />
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => void findReplacement(result)}
                            disabled={loadingId === `discover:${result.id}`}
                            title="Search trusted alternatives, the publisher page and public GIS services"
                            className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary disabled:opacity-50"
                          >
                            {loadingId === `discover:${result.id}` ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Search className="size-3" />
                            )}
                            Find replacement
                          </button>
                          <button
                            onClick={() => void reconnect(result)}
                            disabled={
                              !(
                                reconnectUrls[result.id] ?? wb.connectionHints[result.id]?.url
                              )?.trim() || loadingId === `connection:${result.id}`
                            }
                            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {loadingId === `connection:${result.id}` ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Link2 className="size-3" />
                            )}
                            Test & use
                          </button>
                          <button
                            onClick={() => saveReconnectClue(result)}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium"
                          >
                            <Save className="size-3" /> Save source clue
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              {!checkingConnections &&
                connections.length > 0 &&
                connections.every((result) => result.status === "healthy") && (
                  <p className="px-1 py-2 text-[10px] text-muted-foreground">
                    All configured basemaps and public-data services responded successfully.
                  </p>
                )}
            </div>
          )}
        </div>

        <div className="space-y-2 border-b border-border px-4 py-3">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
            <button
              onClick={() => setMode("layers")}
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-medium",
                mode === "layers" && "bg-card text-foreground shadow-sm",
              )}
            >
              Ready-to-add layers
            </button>
            <button
              onClick={() => setMode("repositories")}
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-medium",
                mode === "repositories" && "bg-card text-foreground shadow-sm",
              )}
            >
              Search repositories
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search roads, pipelines, counties, tracts…"
              aria-label="Search public data"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          {mode === "layers" && (
            <div className="flex flex-wrap gap-1">
              <Chip active={category === null} onClick={() => setCategory(null)}>
                All
              </Chip>
              <Chip
                active={category === SURFACE_WATER_CATEGORY}
                onClick={() => setCategory(SURFACE_WATER_CATEGORY)}
              >
                {SURFACE_WATER_CATEGORY}
              </Chip>
              {categories.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          )}
          {mode === "layers" && category === SURFACE_WATER_CATEGORY && (
            <p className="text-xs text-muted-foreground">
              Add rivers and streams, lakes and ponds, wetlands, riparian habitats, hydrographic
              points and watershed boundaries. Zoom in to load detailed features in your current map
              area; each layer shows its minimum zoom. Wetland and riparian coverage varies by
              survey area.
            </p>
          )}
          <button
            onClick={() => setShowStates((value) => !value)}
            className="w-full rounded-xl bg-secondary px-3 py-2 text-left text-xs font-medium"
          >
            Project coverage · {wb.selectedStates.join(", ")}{" "}
            <span className="float-right text-muted-foreground">change</span>
          </button>
          {showStates && (
            <div className="max-h-28 overflow-y-auto rounded-xl border border-border bg-card p-2">
              <div className="grid grid-cols-8 gap-1">
                {US_STATES.map((state) => {
                  const active = wb.selectedStates.includes(state);
                  return (
                    <button
                      key={state}
                      onClick={() =>
                        wb.setSelectedStates(
                          active
                            ? wb.selectedStates.filter((value) => value !== state)
                            : [...wb.selectedStates, state],
                        )
                      }
                      className={cn(
                        "rounded px-1 py-1 text-[10px]",
                        active ? "bg-primary text-primary-foreground" : "bg-secondary",
                      )}
                    >
                      {state}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                State-specific results follow this project coverage; nationwide sources remain
                available.
              </p>
            </div>
          )}
          {mode === "repositories" && (
            <input
              value={county}
              onChange={(event) => setCounty(event.target.value)}
              placeholder="Optional county, borough or parish"
              aria-label="County repository filter"
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
            />
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {mode === "layers" ? (
            <div className="space-y-2">
              <AccountServiceLibrary onLoad={(service) => void loadCustom(service)} />
              {results.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{entry.name}</div>
                      <PublicLayerAddedBadge catalogId={entry.id} />
                      <div className="text-[11px] font-medium text-primary">{entry.agency}</div>
                      <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
                      <RemovePublicDataSource sourceId={`catalog:${entry.id}`} />
                      {entry.countyField && (
                        <input
                          value={county}
                          onChange={(event) => setCounty(event.target.value)}
                          placeholder="Optional county name, e.g. Travis"
                          aria-label="Parcel county filter"
                          className="mt-2 w-full rounded-lg border border-border bg-secondary/50 px-2 py-1 text-[11px] outline-none focus:border-primary"
                        />
                      )}
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                        <span className="rounded-full bg-secondary px-2 py-0.5">
                          {entry.category}
                        </span>
                        <span className="rounded-full bg-secondary px-2 py-0.5">
                          {entry.geometry}
                        </span>
                        {(entry.url || entry.downloadUrl) && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">
                            {entry.downloadUrl ? "official shapefile" : "loads current view"}
                          </span>
                        )}
                        <span
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2 py-0.5",
                            entry.connection === "live"
                              ? "bg-accent text-accent-foreground"
                              : "bg-secondary",
                          )}
                        >
                          {entry.connection === "live" ? (
                            <Radio className="size-2.5" />
                          ) : (
                            <Clock3 className="size-2.5" />
                          )}
                          {entry.connection}
                        </span>
                        <span className="rounded-full bg-secondary px-2 py-0.5">
                          {entry.updateCadence}
                        </span>
                        {entry.url && (
                          <span className="rounded-full bg-secondary px-2 py-0.5">
                            {entry.id === "tx-parcels"
                              ? "Borders 10+ · large-parcel labels 11+"
                              : `zoom ${entry.minZoom ?? (entry.geometry === "point" ? 7 : 5)}+`}
                          </span>
                        )}
                        <span className="rounded-full bg-secondary px-2 py-0.5">
                          {entry.license}
                        </span>
                      </div>
                      {entry.url && (
                        <button
                          onClick={() => void inspectFields(entry)}
                          className="mt-2 flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                        >
                          {loadingId === `fields:${entry.id}` ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <SlidersHorizontal className="size-3" />
                          )}
                          {inspectId === entry.id
                            ? "Hide import options"
                            : "Choose attributes to import"}
                        </button>
                      )}
                      {inspectId === entry.id &&
                        fieldOptions[entry.id] &&
                        /\/(MapServer|FeatureServer)\/\d+/i.test(entry.url ?? "") && (
                          <div className="mt-2 space-y-2 rounded-lg border border-border p-2">
                            <p className="text-[11px] font-semibold">
                              Filter features at the source
                            </p>
                            <select
                              aria-label="Source filter field"
                              className="w-full rounded border border-border bg-card p-1 text-xs"
                              value={sourceFilters[entry.id]?.field ?? ""}
                              onChange={(event) =>
                                setSourceFilters((current) => ({
                                  ...current,
                                  [entry.id]: {
                                    field: event.target.value,
                                    operator: "equals",
                                    value: "",
                                  },
                                }))
                              }
                            >
                              <option value="">All features</option>
                              {fieldOptions[entry.id]?.map((field) => (
                                <option key={field.name} value={field.name}>
                                  {field.alias || field.name}
                                </option>
                              ))}
                            </select>
                            {sourceFilters[entry.id]?.field && (
                              <>
                                <select
                                  aria-label="Source filter comparison"
                                  className="w-full rounded border border-border bg-card p-1 text-xs"
                                  value={sourceFilters[entry.id]?.operator}
                                  onChange={(event) =>
                                    setSourceFilters((current) => ({
                                      ...current,
                                      [entry.id]: {
                                        ...current[entry.id]!,
                                        operator: event.target.value,
                                      },
                                    }))
                                  }
                                >
                                  <option value="equals">equals</option>
                                  <option value="not_equals">does not equal</option>
                                  <option value="contains">contains text</option>
                                  <option value="empty">is NULL</option>
                                </select>
                                {sourceFilters[entry.id]?.operator !== "empty" && (
                                  <input
                                    aria-label="Source filter value"
                                    placeholder="Value, e.g. natural gas"
                                    value={sourceFilters[entry.id]?.value ?? ""}
                                    onChange={(event) =>
                                      setSourceFilters((current) => ({
                                        ...current,
                                        [entry.id]: {
                                          ...current[entry.id]!,
                                          value: event.target.value,
                                        },
                                      }))
                                    }
                                    className="w-full rounded border border-border bg-card p-1 text-xs"
                                  />
                                )}
                              </>
                            )}
                            <p className="text-[10px] text-muted-foreground">
                              Only matching records load as you pan. Use the source's actual
                              commodity value for natural gas pipelines.
                            </p>
                          </div>
                        )}
                      {inspectId === entry.id && fieldOptions[entry.id] && (
                        <AttributePicker
                          fields={fieldOptions[entry.id] ?? []}
                          selected={selectedFields[entry.id] ?? []}
                          onChange={(fields) =>
                            setSelectedFields((current) => ({ ...current, [entry.id]: fields }))
                          }
                        />
                      )}
                    </div>
                    <button
                      onClick={() => void load(entry)}
                      disabled={
                        loadingId === entry.id ||
                        Boolean(
                          fieldOptions[entry.id]?.length && selectedFields[entry.id]?.length === 0,
                        )
                      }
                      className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
                    >
                      {loadingId === entry.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : entry.url || entry.downloadUrl ? (
                        <Plus className="size-3.5" />
                      ) : (
                        <ExternalLink className="size-3.5" />
                      )}
                      {entry.url || entry.downloadUrl ? "Add" : "Source"}
                    </button>
                  </div>
                  {entry.sourcePage && (entry.url || entry.downloadUrl) && (
                    <a
                      href={entry.sourcePage}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                    >
                      <ExternalLink className="size-3" /> Source details
                    </a>
                  )}
                  {entry.downloadUrl && (
                    <a
                      href={entry.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-3 mt-2 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                    >
                      <ExternalLink className="size-3" /> Download original ZIP
                    </a>
                  )}
                </div>
              ))}
              {results.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No datasets match that search.
                </p>
              )}
            </div>
          ) : (
            <RepositoryResults
              repositories={repositories}
              query={query}
              states={wb.selectedStates}
              county={county}
            />
          )}

          <div className="mt-4 rounded-xl border border-border bg-secondary/50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Link2 className="size-3.5 text-primary" /> Connect any service
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Paste a FeatureServer/MapServer layer URL or a direct GeoJSON URL. Compatible feature
              services are converted into GeoJSON queries automatically.
            </p>
            <div className="mt-2 flex gap-1">
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://…/FeatureServer/0"
                aria-label="Service URL"
                className="num w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] outline-none focus:border-primary"
              />
              <button
                onClick={() => void loadCustom()}
                disabled={loadingId === "custom"}
                className="rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                {loadingId === "custom" ? <Loader2 className="size-3.5 animate-spin" /> : "Load"}
              </button>
            </div>
            <input
              value={serviceName}
              onChange={(event) => setServiceName(event.target.value)}
              placeholder="Optional layer name"
              aria-label="Connected service layer name"
              className="mt-2 w-full rounded border bg-card p-2 text-base"
            />
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={everyMap}
                onChange={(event) => setEveryMap(event.target.checked)}
              />
              Add across my account on every editable map
            </label>
          </div>

          <div className="mt-4">
            <PublicDataAccountSettings />
          </div>

          <div className="mt-4 flex gap-2 rounded-xl bg-secondary/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-clay" />
            <p>
              Public data disclaimer: datasets are streamed live from the publishing agency and may
              be incomplete, out of date or generalized. Nothing here is a survey or a legal
              boundary determination — confirm ownership, easements and property lines with the
              county records office and a licensed surveyor.
            </p>
          </div>
          <RemovedPublicDataSources />
        </div>
      </aside>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function AttributePicker({
  fields,
  selected,
  onChange,
}: {
  fields: ArcgisField[];
  selected: string[];
  onChange: (fields: string[]) => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-border bg-secondary/50 p-2">
      <div className="flex items-center justify-between text-[10px] font-medium">
        <span>
          {selected.length} of {fields.length} attributes
        </span>
        <span className="flex gap-2">
          <button
            onClick={() => onChange(fields.map((field) => field.name))}
            className="text-primary hover:underline"
          >
            All
          </button>
          <button onClick={() => onChange([])} className="text-primary hover:underline">
            None
          </button>
        </span>
      </div>
      <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-lg bg-card p-2">
        {fields.map((field) => (
          <label key={field.name} className="flex items-start gap-2 text-[10px]">
            <input
              type="checkbox"
              checked={selected.includes(field.name)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, field.name]
                    : selected.filter((name) => name !== field.name),
                )
              }
              className="mt-0.5 accent-primary"
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{field.alias}</span>
              <span className="num block truncate text-[9px] text-muted-foreground">
                {field.name}
              </span>
            </span>
          </label>
        ))}
      </div>
      {selected.length === 0 && (
        <p className="mt-1 text-[9px] text-destructive">
          Select at least one attribute before adding.
        </p>
      )}
    </div>
  );
}

function RepositoryResults({
  repositories,
  query,
  states,
  county,
}: {
  repositories: PublicRepository[];
  query: string;
  states: string[];
  county: string;
}) {
  return (
    <div className="space-y-2">
      <a
        href={dataGovDiscoveryUrl(query, states, county)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-xl bg-primary p-3 text-primary-foreground hover:opacity-90"
      >
        <Search className="size-4" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">Search the full government catalog</span>
          <span className="block truncate text-[10px] opacity-80">
            {query || "All geospatial data"} · {states.join(", ")}
            {county ? ` · ${county}` : ""}
          </span>
        </span>
        <ExternalLink className="size-3.5" />
      </a>
      {repositories.map((repository) => (
        <a
          key={repository.id}
          href={repository.url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl border border-border bg-card p-3 hover:border-primary"
        >
          <div className="flex items-start gap-2">
            <Library className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{repository.name}</div>
              <div className="text-[11px] font-medium text-primary">{repository.agency}</div>
              <p className="mt-1 text-xs text-muted-foreground">{repository.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {repository.kind}
                </span>
                {repository.topics.slice(0, 4).map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </div>
        </a>
      ))}
      {repositories.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No repository matches every search term. The full catalog search above may still find a
          local source.
        </p>
      )}
    </div>
  );
}
