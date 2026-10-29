import { useEffect, useRef, useState } from "react";
import { Download, MapPinned, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useMapRef } from "@/lib/gis/mapRef";
import {
  deleteOfflineArea,
  downloadOfflineArea,
  listOfflineAreas,
  validateOfflineBounds,
  type OfflineArea,
  type OfflineAreaSummary,
} from "@/lib/gis/offlineAreas";

export function OfflineAreasPanel({ onClose }: { onClose: () => void }) {
  const { map } = useMapRef();
  const { user } = useAuth();
  const [name, setName] = useState("Field area");
  const [bounds, setBounds] = useState<OfflineArea["bounds"] | null>(null);
  const [packs, setPacks] = useState<OfflineAreaSummary[]>([]);
  const [parcels, setParcels] = useState(true),
    [roads, setRoads] = useState(true);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);
  const refresh = async () => {
    if (user) setPacks(await listOfflineAreas(user.id));
  };
  const chooseExtent = () => {
    if (!map) return;
    const area = map.getBounds();
    const next: OfflineArea["bounds"] = [
      area.getWest(),
      area.getSouth(),
      area.getEast(),
      area.getNorth(),
    ];
    try {
      const km = validateOfflineBounds(next);
      setBounds(next);
      setProgress(
        `Selected extent: approximately ${km.toFixed(1)} km². This full area will be downloaded, not only currently loaded parcels.`,
      );
    } catch (error) {
      setBounds(null);
      setProgress(error instanceof Error ? error.message : "Choose a smaller area");
    }
  };
  useEffect(() => {
    void refresh().catch((error) => setProgress(String(error)));
    return () => controller.current?.abort();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="absolute inset-0 z-[85] flex items-end bg-foreground/20 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:justify-center">
      <section
        aria-label="Offline areas"
        role="dialog"
        aria-modal="true"
        className="panel-surface flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
      >
        <header className="flex items-center justify-between border-b p-3">
          <strong className="flex items-center gap-2">
            <Download className="size-4" />
            Offline areas · Preview
          </strong>
          <button aria-label="Close offline areas" className="rounded p-3" onClick={onClose}>
            <X className="size-5" />
          </button>
        </header>
        <div className="space-y-3 overflow-y-auto p-4 text-sm">
          <p>
            Save a map extent on this device for parcel viewing, public roads and GPS
            bearing/distance guidance without a connection.
          </p>
          <p className="text-xs text-muted-foreground">
            Pan and zoom to your study area, then open this panel and choose Use current extent.
            Maximum 600 km², 25 MB per area and 8 areas. Dense areas may require a smaller extent.
          </p>
          <label className="block">
            Area name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-xl border bg-card p-3 text-base"
            />
          </label>
          <button
            disabled={busy}
            onClick={chooseExtent}
            className="flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2"
          >
            <MapPinned className="size-4" />
            Use current map extent
          </button>
          {bounds && (
            <p className="break-words text-xs text-muted-foreground">
              {bounds.map((n) => n.toFixed(4)).join(", ")}
            </p>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              disabled={busy}
              checked={parcels}
              onChange={(event) => setParcels(event.target.checked)}
            />
            Texas parcel lines and owner names
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              disabled={busy}
              checked={roads}
              onChange={(event) => setRoads(event.target.checked)}
            />
            Public roads for orientation
          </label>
          <button
            disabled={busy || !bounds || !user || (!parcels && !roads)}
            className="min-h-11 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-50"
            onClick={async () => {
              if (!bounds || !user) return;
              const abort = new AbortController();
              controller.current = abort;
              setBusy(true);
              try {
                const saved = await downloadOfflineArea({
                  userId: user.id,
                  name,
                  bounds,
                  parcels,
                  roads,
                  signal: abort.signal,
                  progress: setProgress,
                });
                localStorage.setItem("landdraft.offline-user", user.id);
                await refresh();
                setProgress(
                  `Saved ${saved.name} · ${(saved.bytes / 1048576).toFixed(1)} MB. Open the offline viewer below and bookmark it before leaving coverage.`,
                );
                toast.success("Offline area saved on this device");
              } catch (error) {
                setProgress(
                  error instanceof Error
                    ? error.name === "AbortError"
                      ? "Download canceled. Existing saved areas are unchanged."
                      : error.message
                    : "Download failed",
                );
              } finally {
                setBusy(false);
                controller.current = null;
              }
            }}
          >
            {busy ? "Downloading…" : "Download selected extent"}
          </button>
          {busy && (
            <button
              onClick={() => controller.current?.abort()}
              className="min-h-11 w-full rounded-xl border p-2"
            >
              Cancel download
            </button>
          )}
          {progress && (
            <p role="status" className="rounded-xl bg-secondary p-3 text-xs">
              {progress}
            </p>
          )}
          <h3 className="font-semibold">Saved on this device</h3>
          {packs.length === 0 && (
            <p className="text-xs text-muted-foreground">No downloaded areas.</p>
          )}
          {packs.map((area) => (
            <div key={area.id} className="flex items-center gap-2 rounded-xl border p-2">
              <a
                href={`/offline.html?user=${encodeURIComponent(user?.id ?? "")}&area=${encodeURIComponent(area.id)}`}
                className="min-w-0 flex-1 p-2 text-primary underline"
              >
                <strong className="block break-words">{area.name}</strong>
                <span className="text-xs">
                  {(area.bytes / 1048576).toFixed(1)} MB ·{" "}
                  {new Date(area.savedAt).toLocaleDateString()}
                </span>
              </a>
              <button
                disabled={busy}
                aria-label={`Delete offline area ${area.name}`}
                className="min-h-11 min-w-11 rounded p-2"
                onClick={async () => {
                  try {
                    await deleteOfflineArea(area.id);
                    await refresh();
                  } catch (error) {
                    setProgress(String(error));
                  }
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Downloads remain on this device until removed and may be evicted by the browser. Check
            them before travel. Imagery, live weather, full parcel records and turn-by-turn routing
            are not included. This preview is free; offline areas are intended to become a paid
            feature later.
          </p>
        </div>
      </section>
    </div>
  );
}
