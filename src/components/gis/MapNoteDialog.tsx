import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  FileText,
  Loader2,
  Paperclip,
  Pin,
  Save,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { useMapRef } from "@/lib/gis/mapRef";
import { markerIcons } from "@/lib/gis/markerIcons";
import { uploadProjectAsset } from "@/lib/gis/projectRecords";
import { useWorkbench } from "@/lib/gis/store";
import type { LayerNoteRecord, ProjectDocument, ProjectNote } from "@/lib/gis/types";
import { cn } from "@/lib/utils";

type Destination = "project" | "layer";

const parseTags = (value: string) => [
  ...new Set(
    value
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#+/, "").trim())
      .filter(Boolean),
  ),
];

const tagSuggestions = (value: string, available: string[]) => {
  const match = value.match(/(?:^|\s)#([^\s#]*)$/);
  if (!match) return [];
  const needle = (match[1] ?? "").toLowerCase();
  return available.filter((tag) => tag.toLowerCase().includes(needle)).slice(0, 8);
};

const applyTag = (value: string, tag: string) =>
  `${value.replace(/(?:^|\s)#[^\s#]*$/, "").trim()}${value.trim() ? " " : ""}#${tag} `;

const dateTimeValue = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function MapNoteDialog() {
  const wb = useWorkbench();
  const wbRef = useRef(wb);
  wbRef.current = wb;
  const auth = useAuth();
  const { pendingMapNoteLocation: location, setPendingMapNoteLocation } = useMapRef();
  const [destination, setDestination] = useState<Destination>("project");
  const [layerId, setLayerId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tagText, setTagText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [manualTimestamp, setManualTimestamp] = useState(false);
  const [createdAt, setCreatedAt] = useState(Date.now());
  const [icon, setIcon] = useState("⚑");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const availableTags = useMemo(
    () =>
      [...new Set(wb.records.layerNotes.flatMap((note) => note.tags))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [wb.records.layerNotes],
  );
  const associationLayers = useMemo(() => {
    const seen = new Set<string>();
    return wb.displayLayers.filter((layer) => {
      if (seen.has(layer.id)) return false;
      seen.add(layer.id);
      return true;
    });
  }, [wb.displayLayers]);
  const suggestions = tagSuggestions(tagText, availableTags);

  useEffect(() => {
    if (!location) return;
    const current = wbRef.current;
    const defaultLayer =
      current.displayLayers.find(
        (layer) =>
          layer.id === current.activeLayerId &&
          !(layer.source.kind === "draw" && layer.source.purpose === "map-notes"),
      ) ??
      current.displayLayers.find(
        (layer) => !(layer.source.kind === "draw" && layer.source.purpose === "map-notes"),
      ) ??
      current.displayLayers[0];
    setDestination("project");
    setLayerId(defaultLayer?.id ?? "");
    setSubject("");
    setBody("");
    setTagText("");
    setPinned(false);
    setManualTimestamp(false);
    setCreatedAt(Date.now());
    setIcon("⚑");
    setFiles([]);
  }, [location]);

  if (!location || !wb.canEditProject) return null;

  const close = () => setPendingMapNoteLocation(null);

  const queueFiles = (incoming: FileList | File[]) => {
    const accepted = Array.from(incoming).filter((file) => {
      if (file.size <= 50 * 1024 * 1024) return true;
      toast.error(`${file.name} is larger than the 50 MB project-file limit`);
      return false;
    });
    setFiles((current) => [...current, ...accepted]);
  };

  const save = async () => {
    const noteBody = body.trim();
    if (!noteBody) {
      toast.error("Enter a note");
      return;
    }
    const layer =
      destination === "layer" ? associationLayers.find((item) => item.id === layerId) : null;
    if (destination === "layer" && !layer) {
      toast.error("Choose a layer for this note");
      return;
    }
    if (files.length && !auth.user) {
      toast.error("Sign in before attaching files");
      return;
    }

    const noteId = window.crypto.randomUUID();
    const markerFeatureId = window.crypto.randomUUID();
    const title = subject.trim() || "Map note";
    const timestamp = manualTimestamp ? createdAt : Date.now();
    const author = auth.user?.name || auth.user?.email || "LandDraft user";
    setBusy(true);
    try {
      const documents: ProjectDocument[] = [];
      if (auth.user) {
        for (const file of files) {
          documents.push(
            await uploadProjectAsset({
              userId: auth.user.id,
              projectId: wb.projectId,
              folderId: "general",
              fileName: file.name,
              data: file,
              source: "upload",
              uploadedBy: author,
              ...(layer ? { layerId: layer.id, layerNoteId: noteId } : { projectNoteId: noteId }),
            }),
          );
        }
      }

      const mapLocation = { ...location, markerFeatureId };
      if (layer) {
        const note: LayerNoteRecord = {
          id: noteId,
          layerId: layer.id,
          subject: title,
          body: noteBody,
          tags: parseTags(tagText),
          createdAt: timestamp,
          updatedAt: Date.now(),
          author,
          includeInPacket: true,
          pinned,
          mapLocation,
        };
        wb.setProjectRecords({
          ...wb.records,
          layerNotes: [note, ...wb.records.layerNotes],
          documents: [...documents, ...wb.records.documents],
        });
      } else {
        const note: ProjectNote = {
          id: noteId,
          title,
          body: noteBody,
          createdAt: timestamp,
          updatedAt: Date.now(),
          author,
          includeInPacket: true,
          pinned,
          mapLocation,
        };
        wb.setProjectRecords({
          ...wb.records,
          notes: [note, ...wb.records.notes],
          documents: [...documents, ...wb.records.documents],
        });
      }

      const marker = {
        type: "Feature" as const,
        id: markerFeatureId,
        geometry: {
          type: "Point" as const,
          coordinates: [location.lng, location.lat],
        },
        properties: {
          NAME: title,
          NOTE: noteBody,
          NOTE_ID: noteId,
          NOTE_SCOPE: layer ? "layer" : "project",
          ASSOCIATED_LAYER: layer?.name ?? "Project",
          ASSOCIATED_LAYER_ID: layer?.id ?? "",
          PINNED: pinned,
          MARKER_ICON: icon,
          MARKER_COLOR: "#1f7044",
          MARKER_SIZE: 24,
          LAT: Number(location.lat.toFixed(6)),
          LON: Number(location.lng.toFixed(6)),
          CREATED: new Date(timestamp).toISOString(),
        },
      };
      const markerLayer = wb.layers.find(
        (item) => item.source.kind === "draw" && item.source.purpose === "map-notes",
      );
      if (markerLayer) wb.appendFeature(markerLayer.id, marker);
      else
        wb.addLayer({
          name: "Map notes",
          groupId: wb.groups.some((group) => group.id === "working")
            ? "working"
            : (wb.groups[0]?.id ?? "working"),
          source: { kind: "draw", purpose: "map-notes" },
          data: { type: "FeatureCollection", features: [marker] },
          style: {
            fillColor: "#1f7044",
            strokeColor: "#ffffff",
            strokeWidth: 2,
            pointSize: 9,
            pointIcon: icon,
            pointIconColor: "#1f7044",
            pointIconSize: 24,
            labelEnabled: true,
            labelTemplate: "{NAME}",
            labelFields: ["NAME"],
            labelMinZoom: 0,
            labelMaxZoom: 24,
          },
        });
      wb.addProjectEvent({
        type: "note",
        title: `Added map note: ${title}`,
        detail: layer ? `Layer note for ${layer.name}` : "Project note",
        relatedId: noteId,
      });
      toast.success("Map note saved", {
        description: pinned
          ? "The marker and pinned note are now visible."
          : "The marker is now visible on the map.",
      });
      close();
    } catch (error) {
      toast.error("Map note could not be saved", {
        description: error instanceof Error ? error.message : "Project storage is unavailable",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-overlay-viewport fixed inset-0 z-[115] flex items-center justify-center overflow-y-auto bg-foreground/25 p-4 backdrop-blur-[2px]">
      <section
        className="panel-surface w-full max-w-lg rounded-3xl p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <StickyNote className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">Add map note</h2>
            <p className="num text-[10px] text-muted-foreground">
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
            </p>
          </div>
          <button
            onClick={close}
            className="rounded-lg p-2 hover:bg-accent"
            aria-label="Cancel note marker"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
          <button
            type="button"
            onClick={() => setDestination("project")}
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-semibold",
              destination === "project" && "bg-card shadow-sm",
            )}
          >
            Project note
          </button>
          <button
            type="button"
            onClick={() => setDestination("layer")}
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-semibold",
              destination === "layer" && "bg-card shadow-sm",
            )}
          >
            Layer note
          </button>
        </div>

        {destination === "layer" && (
          <label className="mt-3 block text-[10px] font-semibold">
            Associated layer
            <select
              value={layerId}
              onChange={(event) => setLayerId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal"
            >
              <option value="">Choose a layer</option>
              {associationLayers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <label className="text-[10px] font-semibold">
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              autoFocus
              placeholder="What is this location about?"
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal outline-none focus:border-primary"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setManualTimestamp((current) => !current);
              if (manualTimestamp) setCreatedAt(Date.now());
            }}
            className={cn(
              "mt-[18px] flex size-8 items-center justify-center rounded-xl border border-border bg-card hover:bg-accent",
              manualTimestamp && "border-primary text-primary",
            )}
            title="Change timestamp manually"
            aria-label="Change timestamp manually"
          >
            <Clock3 className="size-3.5" />
          </button>
        </div>
        {manualTimestamp && (
          <input
            type="datetime-local"
            aria-label="Map note timestamp"
            value={dateTimeValue(createdAt)}
            onChange={(event) => setCreatedAt(new Date(event.target.value).getTime() || Date.now())}
            className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs"
          />
        )}
        {destination === "layer" && (
          <>
            <input
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              placeholder="Tags — type # for suggestions"
              aria-label="Layer note tags"
              className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
            />
            {suggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {suggestions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTagText((current) => applyTag(current, tag))}
                    className="rounded-full bg-secondary px-2 py-1 text-[9px] hover:bg-accent"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <label className="mt-2 block text-[10px] font-semibold">
          Note
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            placeholder="Add details about this location…"
            className="mt-1 w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal leading-relaxed outline-none focus:border-primary"
          />
        </label>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-[10px] font-semibold">
            Marker icon
            <select
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal"
            >
              {markerIcons.map((item) => (
                <option key={item.id} value={item.symbol}>
                  {item.symbol} {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-[18px] flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
              className="accent-primary"
            />
            <Pin className="size-3.5 text-primary" /> Pin in Project Records
          </label>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            queueFiles(event.dataTransfer.files);
          }}
          className="mt-3 rounded-xl border border-dashed border-border bg-secondary/40 p-3 text-center"
        >
          <Paperclip className="mx-auto size-4 text-primary" />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Drop attachments here or{" "}
            <label className="cursor-pointer font-semibold text-primary hover:underline">
              browse
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) queueFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </p>
        </div>
        {files.length > 0 && (
          <div className="mt-2 space-y-1">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center gap-2 rounded-lg bg-secondary px-2 py-1.5"
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[10px]">{file.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  className="rounded p-1 text-destructive hover:bg-destructive/10"
                  aria-label={`Remove ${file.name}`}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-xl px-4 py-2 text-xs font-semibold hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save map note
          </button>
        </div>
      </section>
    </div>
  );
}
