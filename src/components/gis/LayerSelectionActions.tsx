import { withExportIcons } from "@/lib/gis/exportIcons";
import { downloadFile } from "@/lib/gis/export";
import type { ExportItemMode } from "@/lib/gis/selectedLayerExport";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { bbox } from "@turf/turf";
import type { FeatureCollection } from "geojson";
import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import type { SelectionArea } from "@/lib/gis/selectedLayerActions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function LayerSelectionActions({ onGroup }: { onGroup: () => void }) {
  const wb = useWorkbench();
  const { map } = useMapRef();
  const selected = wb.layers.filter((l) => wb.selectedLayerIds.includes(l.id));
  const [busy, setBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState<"kmz" | "shp" | null>(null);
  const [exportMode, setExportMode] = useState<ExportItemMode>("layers");
  const [combineName, setCombineName] = useState<string | null>(null);
  const [area, setArea] = useState<(SelectionArea & { partial: boolean }) | null>(null);
  const worker = useRef<Worker | null>(null);
  const current = useRef(selected);
  current.current = selected;
  const key = selected.map((l) => l.id).join("|");
  useEffect(() => {
    setArea(null);
    setBusy(false);
    worker.current?.terminate();
    worker.current = null;
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, [key, wb.layers]);
  const run = (action: "combine" | "duplicate" | "measure", name?: string) => {
    if (action === "combine" && !name?.trim()) return;
    const snapshot = selected;
    const partial = snapshot.some((l) => l.source.kind === "remote");
    setBusy(true);
    setArea(null);
    try {
      const job = new Worker(
        new URL("../../lib/gis/selectedLayerActions.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = job;
      const finish = () => {
        job.terminate();
        if (worker.current === job) {
          worker.current = null;
          setBusy(false);
        }
      };
      job.onerror = (error) => {
        finish();
        toast.error("Could not process the selected layers.", {
          description: error.message || "Try a smaller selection.",
        });
      };
      job.onmessage = (
        event: MessageEvent<{
          error?: string;
          result: SelectionArea | FeatureCollection | FeatureCollection[];
        }>,
      ) => {
        if (worker.current !== job) return;
        finish();
        if (
          snapshot.length !== current.current.length ||
          snapshot.some((l, i) => l !== current.current[i])
        ) {
          toast.info("Selected layers changed. Run the action again.");
          return;
        }
        if (event.data.error) {
          toast.error(event.data.error);
          return;
        }
        if (action === "measure") {
          setArea({ ...(event.data.result as SelectionArea), partial });
          return;
        }
        const data =
          action === "combine"
            ? [event.data.result as FeatureCollection]
            : (event.data.result as FeatureCollection[]);
        const ids = data.map((collection, i) => {
          const source = snapshot[action === "combine" ? 0 : i]!;
          const created = wb.addLayer({
            name: action === "combine" ? name! : `${source.name} copy`,
            groupId: source.groupId,
            data: collection,
            style: structuredClone(source.style),
            source:
              action === "duplicate" && source.source.kind === "image"
                ? structuredClone(source.source)
                : {
                    kind: "derived",
                    sourceLayerId: source.id,
                    query:
                      action === "combine"
                        ? "Combined checked layers (loaded feature snapshots)"
                        : "Duplicated layer (loaded feature snapshot)",
                    cachedAt: new Date().toISOString(),
                    cacheProvenance: {
                      sourceLayers: snapshot.map((l) => ({
                        id: l.id,
                        name: l.name,
                        source:
                          l.source.kind === "remote"
                            ? { kind: "remote", url: l.source.url }
                            : { kind: l.source.kind },
                      })),
                      scope: "loaded-features",
                    },
                  },
          });
          if (action === "duplicate")
            wb.updateLayer(created.id, {
              visible: source.visible,
              style: structuredClone(source.style),
              ...(source.selectionLocked !== undefined
                ? { selectionLocked: source.selectionLocked }
                : {}),
              ...(source.note !== undefined ? { note: source.note } : {}),
            });
          return created.id;
        });
        wb.setSelectedLayers(ids);
        toast.success(
          action === "combine" ? "Combined layer created" : `${ids.length} layer copies created`,
          {
            description: partial
              ? "Public-data copies contain currently loaded features only. Original service connections remain unchanged."
              : "Original layers are unchanged.",
          },
        );
      };
      job.postMessage({
        action,
        layers: snapshot.map(({ id, name: layerName, data }) => ({ id, name: layerName, data })),
      });
    } catch (error) {
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Could not start layer action");
    }
  };
  const exportChecked = async () => {
    if (!exportFormat) return;
    const format = exportFormat;
    const mode = exportMode;
    const snapshot = selected;
    setExportFormat(null);
    setBusy(true);
    try {
      const exportLayers = await Promise.all(snapshot.map((layer) => withExportIcons(layer)));
      if (
        snapshot.length !== current.current.length ||
        snapshot.some((layer, i) => layer !== current.current[i])
      ) {
        setBusy(false);
        toast.info("Selected layers changed. Export again.");
        return;
      }
      const job = new Worker(
        new URL("../../lib/gis/selectedLayerExport.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = job;
      const finish = () => {
        job.terminate();
        if (worker.current === job) {
          worker.current = null;
          setBusy(false);
        }
      };
      job.onerror = (error) => {
        finish();
        toast.error("Export failed", { description: error.message || "Try a smaller selection." });
      };
      job.onmessage = (event: MessageEvent<{ bytes?: Uint8Array; error?: string }>) => {
        if (worker.current !== job) return;
        finish();
        if (
          snapshot.length !== current.current.length ||
          snapshot.some((l, i) => l !== current.current[i])
        ) {
          toast.info("Selected layers changed. Export again.");
          return;
        }
        if (event.data.error || !event.data.bytes) {
          toast.error(event.data.error || "No export file was generated.");
          return;
        }
        const bytes = event.data.bytes;
        downloadFile(
          new Blob([bytes.buffer as ArrayBuffer], {
            type: format === "kmz" ? "application/vnd.google-earth.kmz" : "application/zip",
          }),
          `LandDraft_checked_${mode}.${format === "kmz" ? "kmz" : "zip"}`,
        );
      };
      job.postMessage({
        layers: exportLayers.map(({ id, name, data, style, exportIcons }) => ({
          id,
          name,
          data,
          style,
          exportIcons,
        })),
        format,
        mode,
      });
    } catch (error) {
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Could not start export");
    }
  };
  if (!selected.length) return null;
  const item = "min-h-10 cursor-pointer";
  return (
    <div className="min-w-0">
      <Dialog
        open={exportFormat !== null}
        onOpenChange={(open) => {
          if (!open) setExportFormat(null);
        }}
      >
        <DialogContent className="z-[160] max-h-[85dvh] max-w-[min(24rem,calc(100vw-24px))] overflow-y-auto">
          <DialogTitle>Export checked layers · {exportFormat?.toUpperCase()}</DialogTitle>
          <DialogDescription>
            KMZ preserves colors, transparency and marker images. SHP includes SLD style files to
            load in compatible GIS software. Multipart items are split by style where needed. Choose
            how checked layers become exported items. Multipart polygons and their holes are
            preserved.
          </DialogDescription>
          <label className="text-sm font-medium" htmlFor="checked-export-items">
            Export items
          </label>
          <select
            id="checked-export-items"
            className="w-full rounded-lg border bg-background p-3 text-base"
            value={exportMode}
            onChange={(event) => setExportMode(event.target.value as ExportItemMode)}
          >
            <option value="layers">One multipart item per checked layer</option>
            <option value="features">Original features as separate items</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Layer items use MultiPolygon for polygon features. Original geometries and all member
            attributes are included as GeoJSON files in the archive. Multipart parts are not
            dissolved.
          </p>
          {exportFormat === "shp" && (
            <p className="text-xs text-muted-foreground">
              SHP is a ZIP of .shp, .shx, .dbf and .prj files. Mixed geometry families use separate
              files; multipoints become point records. Field-name mappings and full attributes are
              included.
            </p>
          )}
          {selected.some((l) => l.source.kind === "remote") && (
            <p className="text-xs font-medium">
              Connected layers export currently loaded features only, not the entire service.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              className="rounded-lg border px-3 py-2 text-sm"
              onClick={() => setExportFormat(null)}
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={exportChecked}
            >
              Export {exportFormat?.toUpperCase()}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={combineName !== null}
        onOpenChange={(open) => {
          if (!open) setCombineName(null);
        }}
      >
        <DialogContent className="z-[160] max-h-[85dvh] max-w-[min(24rem,calc(100vw-24px))] overflow-y-auto">
          <DialogTitle>Combine selected layers</DialogTitle>
          <DialogDescription>
            Create one editable layer containing all loaded features and their attributes. Original
            layers remain unchanged.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = combineName?.trim();
              if (name) {
                setCombineName(null);
                run("combine", name);
              }
            }}
          >
            <label htmlFor="combined-layer-name" className="text-sm font-medium">
              New layer name
            </label>
            <input
              id="combined-layer-name"
              autoFocus
              value={combineName ?? ""}
              onChange={(event) => setCombineName(event.target.value)}
              className="mt-2 w-full rounded-lg border bg-background p-3 text-base"
            />
            {selected.some((l) => l.source.kind === "remote") && (
              <p className="mt-2 text-xs text-muted-foreground">
                Connected public layers contribute currently loaded features only, not the entire
                service.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCombineName(null)}
                className="rounded-lg border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!combineName?.trim()}
                className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                Create layer
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy}
          className="flex min-h-8 items-center gap-1 rounded-lg bg-primary px-2 py-1 font-semibold text-primary-foreground"
          aria-label={`Actions for ${selected.length} selected ${selected.length === 1 ? "layer" : "layers"}`}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null} Selection actions ·{" "}
          {selected.length}
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={12} className="z-[150] w-64">
          <DropdownMenuItem className={item} disabled={selected.length < 2} onSelect={onGroup}>
            Group selected
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => run("duplicate")}>
            Duplicate selected
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => setCombineName("Combined selection")}>
            Combine into new layer
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => run("measure")}>
            Measure area (acres)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={item} onSelect={() => setExportFormat("kmz")}>
            Export checked layers · KMZ
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => setExportFormat("shp")}>
            Export checked layers · SHP (ZIP)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={item}
            onSelect={() => selected.forEach((l) => wb.updateLayer(l.id, { visible: true }))}
          >
            Show selected
          </DropdownMenuItem>
          <DropdownMenuItem
            className={item}
            onSelect={() => selected.forEach((l) => wb.updateLayer(l.id, { visible: false }))}
          >
            Hide selected
          </DropdownMenuItem>
          <DropdownMenuItem
            className={item}
            onSelect={() => {
              try {
                const data: FeatureCollection = {
                  type: "FeatureCollection",
                  features: selected.flatMap((l) => l.data.features),
                };
                if (!data.features.length) throw new Error("No loaded features to zoom to.");
                const bounds = bbox(data);
                if (!bounds.every(Number.isFinite))
                  throw new Error("No valid geometry to zoom to.");
                map?.fitBounds(
                  [
                    [bounds[0]!, bounds[1]!],
                    [bounds[2]!, bounds[3]!],
                  ],
                  { padding: 60, maxZoom: 16 },
                );
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not zoom to selection");
              }
            }}
          >
            Zoom to selected
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => wb.setSelectedLayers([])}>
            Clear layer selection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {busy && (
        <p role="status" className="mt-1 text-muted-foreground">
          Processing selected layers…{" "}
          <button
            className="underline"
            onClick={() => {
              worker.current?.terminate();
              worker.current = null;
              setBusy(false);
            }}
          >
            Cancel
          </button>
        </p>
      )}
      {area && (
        <div
          role="status"
          className="mt-2 max-w-64 rounded-lg border bg-background p-2 text-xs font-normal text-foreground"
        >
          <button
            aria-label="Close acreage result"
            onClick={() => setArea(null)}
            className="float-right p-1"
          >
            <X className="size-3" />
          </button>
          <strong>
            {area.acres.toLocaleString(undefined, { maximumFractionDigits: 2 })} acres
          </strong>
          <p className="mt-1 break-words">{area.layerNames.join(", ")}</p>
          <p className="mt-1">
            {area.polygonFeatures} polygon features; overlaps counted once. Holes excluded.{" "}
            {area.ignoredFeatures ? `${area.ignoredFeatures} non-area features ignored.` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            Mapped geometry estimate; not survey acreage.{" "}
            {area.partial
              ? "Public-data layers: currently loaded features only, not the entire service."
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}
