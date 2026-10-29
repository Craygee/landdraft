import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronRight,
  Clock3,
  Download,
  FileArchive,
  FileText,
  Folder,
  FolderPlus,
  Layers3,
  Mail,
  NotebookPen,
  Paperclip,
  Plus,
  Printer,
  Pin,
  MapPin,
  RefreshCw,
  Search,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { useMapRef } from "@/lib/gis/mapRef";
import { groupLayersForMap, mapBoundsForLayers } from "@/lib/gis/recordNavigation";
import {
  deleteProjectAsset,
  downloadProjectAsset,
  extractEmailAttachments,
  parseEmailFile,
  projectAssetBlob,
  uploadProjectAsset,
} from "@/lib/gis/projectRecords";
import { useWorkbench } from "@/lib/gis/store";
import {
  assignInboundEmail,
  ensureAccountEmailAlias,
  ensureProjectEmailAlias,
  listInboundProjectEmails,
  markInboundEmailImported,
  type InboundProjectEmail,
  type ProjectEmailAlias,
} from "@/lib/gis/inboundEmail";
import type {
  LayerNoteRecord,
  ProjectDocument,
  ProjectEventType,
  ProjectNote,
  ProjectRecords,
} from "@/lib/gis/types";
import { cn } from "@/lib/utils";

type Tab = "notes" | "layer-notes" | "files" | "activity" | "email" | "summary";

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "notes", label: "Notes", icon: <NotebookPen /> },
  { id: "layer-notes", label: "Layer notes", icon: <Layers3 /> },
  { id: "files", label: "Files", icon: <Folder /> },
  { id: "activity", label: "Activity", icon: <Clock3 /> },
  { id: "email", label: "Email", icon: <Mail /> },
  { id: "summary", label: "Summary", icon: <Archive /> },
];

const eventTypes: Array<{ value: "all" | ProjectEventType; label: string }> = [
  { value: "all", label: "All events" },
  { value: "note", label: "Notes" },
  { value: "upload", label: "Uploads" },
  { value: "email", label: "Email" },
  { value: "map", label: "Maps and layers" },
  { value: "import", label: "File imports" },
  { value: "public-data", label: "Public data" },
  { value: "remote-change", label: "Remote user changes" },
  { value: "project", label: "Project changes" },
];

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] ?? character;
  });

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const fileDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const dateTimeInputValue = (timestamp: number) => {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
};

const parseLayerNoteTags = (value: string) => [
  ...new Set(
    value
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#+/, "").trim())
      .filter(Boolean),
  ),
];

const layerNoteTagDraft = (tags: string[]) => tags.map((tag) => `#${tag}`).join(" ");

const layerNoteTagSuggestions = (value: string, available: string[]) => {
  const match = value.match(/(?:^|\s)#([^\s#]*)$/);
  if (!match) return [];
  const needle = (match[1] ?? "").toLowerCase();
  return available.filter((tag) => tag.toLowerCase().includes(needle)).slice(0, 8);
};

const applyLayerNoteTag = (value: string, tag: string) =>
  `${value.replace(/(?:^|\s)#[^\s#]*$/, "").trim()}${value.trim() ? " " : ""}#${tag} `;

export function ProjectRecordsPanel() {
  const wb = useWorkbench();
  const auth = useAuth();
  const { map, setRecordsOpen, recordsTargetNoteId, setRecordsTargetNoteId } = useMapRef();
  const [tab, setTab] = useState<Tab>("notes");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteLayerId, setNoteLayerId] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [notePinned, setNotePinned] = useState(false);
  const [pendingNoteFiles, setPendingNoteFiles] = useState<File[]>([]);
  const [noteEditor, setNoteEditor] = useState<ProjectNote | null>(null);
  const [layerNoteEditor, setLayerNoteEditor] = useState<LayerNoteRecord | null>(null);
  const [layerNoteEditorTagText, setLayerNoteEditorTagText] = useState("");
  const [layerNoteTimestampOpen, setLayerNoteTimestampOpen] = useState(false);
  const [layerNoteQuery, setLayerNoteQuery] = useState("");
  const [layerNoteGroupFilter, setLayerNoteGroupFilter] = useState("all");
  const [layerNoteLayerFilter, setLayerNoteLayerFilter] = useState("all");
  const [layerNoteTagFilter, setLayerNoteTagFilter] = useState("all");
  const [folderId, setFolderId] = useState("general");
  const [newFolder, setNewFolder] = useState("");
  const [eventType, setEventType] = useState<"all" | ProjectEventType>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [layerAttachmentBusyId, setLayerAttachmentBusyId] = useState<string | null>(null);
  const [projectNoteAttachmentBusyId, setProjectNoteAttachmentBusyId] = useState<string | null>(
    null,
  );
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSetupError, setEmailSetupError] = useState("");
  const [projectEmailAlias, setProjectEmailAlias] = useState<ProjectEmailAlias | null>(null);
  const [accountEmailAlias, setAccountEmailAlias] = useState<ProjectEmailAlias | null>(null);
  const [inboundEmails, setInboundEmails] = useState<InboundProjectEmail[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const noteFileInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const records = wb.records;
  const allLayerNoteTags = [...new Set(records.layerNotes.flatMap((note) => note.tags))].sort(
    (left, right) => left.localeCompare(right),
  );
  const layerNoteRows = records.layerNotes
    .map((note) => {
      const order = wb.displayLayers.findIndex((item) => item.id === note.layerId);
      const layer = order >= 0 ? wb.displayLayers[order] : undefined;
      const group = wb.groups.find((item) => item.id === layer?.groupId);
      return { note, layer, group, order: order >= 0 ? order + 1 : Number.MAX_SAFE_INTEGER };
    })
    .sort((left, right) => left.order - right.order || right.note.createdAt - left.note.createdAt);
  const filteredLayerNoteRows = layerNoteRows.filter(({ note, layer, group }) => {
    const needle = layerNoteQuery.trim().toLowerCase();
    return (
      (layerNoteGroupFilter === "all" || group?.id === layerNoteGroupFilter) &&
      (layerNoteLayerFilter === "all" || layer?.id === layerNoteLayerFilter) &&
      (layerNoteTagFilter === "all" || note.tags.includes(layerNoteTagFilter)) &&
      (!needle ||
        `${note.subject} ${note.body} ${note.tags.join(" ")} ${note.author} ${layer?.name ?? "Detached layer"} ${group?.name ?? ""}`
          .toLowerCase()
          .includes(needle))
    );
  });
  const attachmentsForLayerNote = (layerId: string, noteId: string) => {
    const noteCount = records.layerNotes.filter((note) => note.layerId === layerId).length;
    return records.documents.filter(
      (document) =>
        document.layerNoteId === noteId ||
        (!document.layerNoteId && document.layerId === layerId && noteCount === 1),
    );
  };
  const editorTagSuggestions = layerNoteTagSuggestions(layerNoteEditorTagText, allLayerNoteTags);
  const pinnedNotes = [
    ...records.notes
      .filter((note) => note.pinned)
      .map((note) => ({ kind: "project" as const, note, createdAt: note.createdAt })),
    ...layerNoteRows
      .filter(({ note }) => note.pinned)
      .map((row) => ({ kind: "layer" as const, ...row, createdAt: row.note.createdAt })),
  ].sort((left, right) => right.createdAt - left.createdAt);
  const attachmentsForProjectNote = (noteId: string) =>
    records.documents.filter((document) => document.projectNoteId === noteId);

  const zoomToRecordLayers = (layers: typeof wb.displayLayers, label: string) => {
    if (!map) {
      toast.error("Map is not ready yet");
      return false;
    }
    const bounds = mapBoundsForLayers(layers);
    if (!bounds) {
      toast.error(`${label} has no loaded map features to zoom to`);
      return false;
    }
    const [west, south, east, north] = bounds;
    if (west === east && south === north) {
      map.easeTo({ center: [west, south], zoom: Math.max(map.getZoom(), 16) });
    } else {
      map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
    }
    setRecordsOpen(false);
    return true;
  };

  const zoomToLayerRecord = (layerId: string) => {
    const layer = wb.displayLayers.find((item) => item.id === layerId);
    if (!layer || !zoomToRecordLayers([layer], layer?.name ?? "Layer")) return;
    if (!layer.visible) wb.toggleVisible(layer.id);
    wb.setActiveLayer(layer.id);
  };

  const zoomToGroupRecord = (groupId: string) => {
    const group = wb.groups.find((item) => item.id === groupId);
    const layers = groupLayersForMap(groupId, wb.groups, wb.displayLayers);
    if (!zoomToRecordLayers(layers, group?.name ?? "Group")) return;
    wb.setGroupVisible(groupId, true);
    if (group?.collapsed) wb.toggleGroup(groupId);
    wb.setSelectedGroups([groupId]);
  };

  const updateMapNoteMarker = (noteId: string, properties: Record<string, unknown>) => {
    const markerLayer = wb.layers.find(
      (layer) => layer.source.kind === "draw" && layer.source.purpose === "map-notes",
    );
    const markerIndex = markerLayer?.data.features.findIndex(
      (feature) => feature.properties?.["NOTE_ID"] === noteId,
    );
    if (markerLayer && markerIndex !== undefined && markerIndex >= 0)
      wb.updateFeatureProperties(markerLayer.id, markerIndex, properties);
  };

  const removeMapNoteMarker = (noteId: string) => {
    const markerLayer = wb.layers.find(
      (layer) => layer.source.kind === "draw" && layer.source.purpose === "map-notes",
    );
    const markerIndex = markerLayer?.data.features.findIndex(
      (feature) => feature.properties?.["NOTE_ID"] === noteId,
    );
    if (markerLayer && markerIndex !== undefined && markerIndex >= 0)
      wb.removeFeatures(markerLayer.id, [markerIndex]);
  };

  const refreshInboundEmail = async () => {
    if (!auth.user || !auth.cloudEnabled) return;
    setEmailBusy(true);
    setEmailSetupError("");
    try {
      const [projectAlias, accountAlias, messages] = await Promise.all([
        ensureProjectEmailAlias(wb.projectId),
        ensureAccountEmailAlias(),
        listInboundProjectEmails(wb.projectId),
      ]);
      setProjectEmailAlias(projectAlias);
      setAccountEmailAlias(accountAlias);
      setInboundEmails(messages);
    } catch (error) {
      setEmailSetupError(
        error instanceof Error ? error.message : "Project email intake is unavailable",
      );
    } finally {
      setEmailBusy(false);
    }
  };

  useEffect(() => {
    if (tab !== "email") return;
    void refreshInboundEmail();
    // Project changes recreate the scoped intake address and message list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id, tab, wb.projectId]);

  useEffect(() => {
    if (!recordsTargetNoteId) return;

    const projectNote = records.notes.find((note) => note.id === recordsTargetNoteId);
    if (projectNote) {
      setNoteEditor({ ...projectNote });
      setTab("notes");
      setRecordsTargetNoteId(null);
      return;
    }

    const layerNote = records.layerNotes.find((note) => note.id === recordsTargetNoteId);
    if (layerNote) {
      setLayerNoteEditor({ ...layerNote });
      setLayerNoteEditorTagText(layerNoteTagDraft(layerNote.tags));
      setLayerNoteTimestampOpen(false);
      setTab("layer-notes");
    }
    setRecordsTargetNoteId(null);
  }, [records.layerNotes, records.notes, recordsTargetNoteId, setRecordsTargetNoteId]);

  const update = (patch: Partial<ProjectRecords>) => wb.setProjectRecords({ ...records, ...patch });

  const folderPath = (id: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    let current = records.folders.find((folder) => folder.id === id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = records.folders.find((folder) => folder.id === current?.parentId);
    }
    return names.join(" / ") || "General";
  };

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.events.filter(
      (event) =>
        (eventType === "all" || event.type === eventType) &&
        (!needle ||
          `${event.title} ${event.detail} ${event.actor} ${event.projectName}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [eventType, query, records.events]);

  const relatedRecordKind = (relatedId?: string) => {
    if (!relatedId) return null;
    if (records.notes.some((note) => note.id === relatedId)) return "project-note" as const;
    if (records.layerNotes.some((note) => note.id === relatedId)) return "layer-note" as const;
    if (records.documents.some((document) => document.id === relatedId)) return "file" as const;
    return null;
  };

  const openRelatedRecord = (relatedId?: string) => {
    const kind = relatedRecordKind(relatedId);
    if (!relatedId || !kind) return;
    if (kind === "project-note") {
      const note = records.notes.find((item) => item.id === relatedId);
      if (note) setNoteEditor({ ...note });
      setTab("notes");
      return;
    }
    if (kind === "layer-note") {
      const note = records.layerNotes.find((item) => item.id === relatedId);
      if (note) {
        setLayerNoteEditor({ ...note });
        setLayerNoteEditorTagText(layerNoteTagDraft(note.tags));
        setLayerNoteTimestampOpen(false);
      }
      setTab("layer-notes");
      return;
    }
    setTab("files");
  };

  const restoreActivityNote = (event: ProjectRecords["events"][number]) => {
    if (!event.relatedId || event.type !== "note" || /^deleted\b/i.test(event.title)) return;
    const history = records.events
      .filter((item) => item.type === "note" && item.relatedId === event.relatedId)
      .sort((left, right) => left.createdAt - right.createdAt);
    const latest = history.at(-1) ?? event;
    if (/^deleted\b/i.test(latest.title)) {
      toast.info("This note was deleted after the recorded activity.");
      return;
    }
    const title = latest.title
      .replace(/^(added|updated)\s+(map\s+|layer\s+|project\s+)?note\s*:\s*/i, "")
      .trim();
    const note: ProjectNote = {
      id: event.relatedId,
      title: title && title !== latest.title ? title : `Recovered: ${latest.title}`,
      body:
        [...history].reverse().find((item) => item.detail.trim())?.detail ||
        "Recovered from project activity. The original note body was not present in this project snapshot.",
      createdAt: history[0]?.createdAt ?? event.createdAt,
      updatedAt: latest.createdAt,
      author: latest.actor || "LandDraft user",
      includeInPacket: true,
      pinned: false,
    };
    update({ notes: [note, ...records.notes] });
    setNoteEditor(note);
    setTab("notes");
    toast.success("Recovered the available note summary from project activity", {
      description: "Review and save it to keep the restored project note.",
    });
  };

  const queueNoteFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingNoteFiles((current) => {
      const next = [...current];
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} is larger than the 50 MB project-file limit`);
          continue;
        }
        if (
          !next.some(
            (item) =>
              item.name === file.name &&
              item.size === file.size &&
              item.lastModified === file.lastModified,
          )
        )
          next.push(file);
      }
      return next;
    });
  };

  const addNote = async () => {
    const body = noteBody.trim();
    if (!body) {
      toast.error("Enter a note");
      return;
    }
    const targetLayer = noteLayerId
      ? wb.displayLayers.find((layer) => layer.id === noteLayerId)
      : undefined;
    if (noteLayerId && !targetLayer) {
      toast.error("Choose an available layer for this note");
      return;
    }
    const now = Date.now();
    const id = window.crypto.randomUUID();
    const note: ProjectNote = {
      id,
      title: noteTitle.trim() || (targetLayer ? "Layer note" : "Project note"),
      body,
      createdAt: now,
      updatedAt: now,
      author: auth.user?.name || auth.user?.email || "LandDraft user",
      includeInPacket: true,
      pinned: notePinned,
    };
    const attachments: ProjectDocument[] = [];
    if (pendingNoteFiles.length && auth.user) {
      setProjectNoteAttachmentBusyId(id);
      for (const file of pendingNoteFiles) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} is larger than the 50 MB project-file limit`);
          continue;
        }
        try {
          attachments.push(
            await uploadProjectAsset({
              userId: auth.user.id,
              projectId: wb.projectId,
              folderId: "general",
              fileName: file.name,
              data: file,
              source: "upload",
              uploadedBy: auth.user.name || auth.user.email,
              ...(targetLayer
                ? { layerId: targetLayer.id, layerNoteId: id }
                : { projectNoteId: id }),
            }),
          );
        } catch (error) {
          toast.error(`${file.name} could not be attached`, {
            description: error instanceof Error ? error.message : "Cloud storage is unavailable",
          });
        }
      }
      setProjectNoteAttachmentBusyId(null);
    }
    const layerNote: LayerNoteRecord | null = targetLayer
      ? {
          id,
          layerId: targetLayer.id,
          subject: note.title,
          body: note.body,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          author: note.author,
          includeInPacket: true,
          pinned: note.pinned ?? false,
          tags: [],
        }
      : null;
    update({
      ...(layerNote
        ? { layerNotes: [layerNote, ...records.layerNotes] }
        : { notes: [note, ...records.notes] }),
      documents: [...attachments, ...records.documents],
    });
    wb.addProjectEvent({
      type: "note",
      title:
        noteTitle.trim() ||
        (targetLayer ? `Added note to ${targetLayer.name}` : "Added project note"),
      detail: body.slice(0, 180),
      relatedId: id,
    });
    for (const document of attachments)
      wb.addProjectEvent({
        type: "upload",
        title: `Attached ${document.name} to ${note.title}`,
        detail: `${formatBytes(document.size)} · ${targetLayer ? "Layer" : "Project"} note attachment`,
        relatedId: id,
      });
    setNoteTitle("");
    setNoteBody("");
    setNotePinned(false);
    setPendingNoteFiles([]);
    if (noteFileInput.current) noteFileInput.current.value = "";
    if (layerNote) {
      setLayerNoteEditor(layerNote);
      setLayerNoteEditorTagText("");
      setLayerNoteLayerFilter(targetLayer!.id);
      setLayerNoteGroupFilter("all");
      setLayerNoteTagFilter("all");
      setLayerNoteQuery("");
      setTab("layer-notes");
    } else setNoteEditor(note);
    toast.success(targetLayer ? "Note added to this layer" : "Note added to this project");
  };

  const saveEditedNote = () => {
    if (!noteEditor) return;
    const title = noteEditor.title.trim() || "Project note";
    const body = noteEditor.body.trim();
    if (!body) {
      toast.error("Enter a note");
      return;
    }
    const updatedNote = { ...noteEditor, title, body, updatedAt: Date.now() };
    update({
      notes: records.notes.map((note) => (note.id === updatedNote.id ? updatedNote : note)),
    });
    setNoteEditor(updatedNote);
    updateMapNoteMarker(updatedNote.id, {
      NAME: title,
      NOTE: body,
      PINNED: Boolean(updatedNote.pinned),
    });
    wb.addProjectEvent({
      type: "note",
      title: `Updated note: ${title}`,
      detail: body.slice(0, 180),
      relatedId: updatedNote.id,
    });
    toast.success("Note changes saved");
  };

  const createFolder = () => {
    const name = newFolder.trim();
    if (!name) return;
    const id = window.crypto.randomUUID();
    update({
      folders: [
        ...records.folders,
        { id, name, parentId: folderId || null, createdAt: Date.now() },
      ],
    });
    wb.addProjectEvent({ type: "project", title: `Created folder ${name}` });
    setNewFolder("");
    setFolderId(id);
  };

  const uploadFiles = async (files: FileList | null, forceEmail = false) => {
    if (!files?.length || !auth.user) return;
    setBusy(true);
    try {
      const added: ProjectDocument[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} is larger than the 50 MB project-file limit`);
          continue;
        }
        const email = await parseEmailFile(file);
        const attachments = email ? await extractEmailAttachments(file) : [];
        added.push(
          await uploadProjectAsset({
            userId: auth.user.id,
            projectId: wb.projectId,
            folderId: forceEmail || email ? "email" : folderId,
            fileName: file.name,
            data: file,
            source: forceEmail || email ? "email" : "upload",
            uploadedBy: auth.user.name || auth.user.email,
            ...(email ? { email } : {}),
          }),
        );
        for (const attachment of attachments) {
          if (attachment.size > 50 * 1024 * 1024) continue;
          added.push(
            await uploadProjectAsset({
              userId: auth.user.id,
              projectId: wb.projectId,
              folderId: "email",
              fileName: attachment.name,
              data: attachment,
              source: "email",
              uploadedBy: auth.user.name || auth.user.email,
            }),
          );
        }
      }
      if (added.length) {
        update({ documents: [...added, ...records.documents] });
        for (const item of added)
          wb.addProjectEvent({
            type: item.source === "email" ? "email" : "upload",
            title: `${item.source === "email" ? "Added email" : "Uploaded"} ${item.name}`,
            detail: `${formatBytes(item.size)} · ${folderPath(item.folderId)}`,
            relatedId: item.id,
          });
        toast.success(`${added.length} project file${added.length === 1 ? "" : "s"} stored`);
      }
    } catch (error) {
      toast.error("Project file could not be stored", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
      if (emailInput.current) emailInput.current.value = "";
    }
  };

  const uploadLayerAttachments = async (
    layerId: string,
    layerNoteId: string,
    files: FileList | null,
  ) => {
    if (!files?.length) return;
    if (!auth.user) {
      toast.error("Sign in before attaching files to a layer note");
      return;
    }
    const layer = wb.displayLayers.find((item) => item.id === layerId);
    const layerName = layer?.name ?? "detached layer note";
    setLayerAttachmentBusyId(layerId);
    try {
      const added: ProjectDocument[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} is larger than the 50 MB project-file limit`);
          continue;
        }
        added.push(
          await uploadProjectAsset({
            userId: auth.user.id,
            projectId: wb.projectId,
            folderId: "general",
            fileName: file.name,
            data: file,
            source: "upload",
            uploadedBy: auth.user.name || auth.user.email,
            layerId,
            layerNoteId,
          }),
        );
      }
      if (!added.length) return;
      update({ documents: [...added, ...records.documents] });
      for (const document of added)
        wb.addProjectEvent({
          type: "upload",
          title: `Attached ${document.name} to ${layerName}`,
          detail: `${formatBytes(document.size)} · Layer note attachment`,
          relatedId: layerNoteId,
        });
      toast.success(
        `${added.length} attachment${added.length === 1 ? "" : "s"} added to ${layerName}`,
      );
    } catch (error) {
      toast.error("Layer attachment could not be stored", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setLayerAttachmentBusyId(null);
    }
  };

  const uploadProjectNoteAttachments = async (
    projectNoteId: string,
    files: FileList | File[] | null,
  ) => {
    if (!files?.length) return;
    if (!auth.user) {
      toast.error("Sign in before attaching files to a project note");
      return;
    }
    setProjectNoteAttachmentBusyId(projectNoteId);
    try {
      const added: ProjectDocument[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} is larger than the 50 MB project-file limit`);
          continue;
        }
        added.push(
          await uploadProjectAsset({
            userId: auth.user.id,
            projectId: wb.projectId,
            folderId: "general",
            fileName: file.name,
            data: file,
            source: "upload",
            uploadedBy: auth.user.name || auth.user.email,
            projectNoteId,
          }),
        );
      }
      if (!added.length) return;
      update({ documents: [...added, ...records.documents] });
      for (const document of added)
        wb.addProjectEvent({
          type: "upload",
          title: `Attached ${document.name} to a project note`,
          detail: `${formatBytes(document.size)} · Project note attachment`,
          relatedId: projectNoteId,
        });
      toast.success(
        `${added.length} project-note attachment${added.length === 1 ? "" : "s"} added`,
      );
    } catch (error) {
      toast.error("Project-note attachment could not be stored", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setProjectNoteAttachmentBusyId(null);
    }
  };

  const saveLayerNoteEditor = () => {
    if (!layerNoteEditor) return;
    const subject = layerNoteEditor.subject.trim() || "Layer note";
    const body = layerNoteEditor.body.trim();
    if (!body) {
      toast.error("Enter a note");
      return;
    }
    const updatedNote: LayerNoteRecord = {
      ...layerNoteEditor,
      subject,
      body,
      tags: parseLayerNoteTags(layerNoteEditorTagText),
      updatedAt: Date.now(),
    };
    update({
      layerNotes: records.layerNotes.map((note) =>
        note.id === updatedNote.id ? updatedNote : note,
      ),
    });
    setLayerNoteEditor(updatedNote);
    updateMapNoteMarker(updatedNote.id, {
      NAME: subject,
      NOTE: body,
      PINNED: Boolean(updatedNote.pinned),
    });
    wb.addProjectEvent({
      type: "note",
      title: `Updated layer note: ${subject}`,
      detail: body.slice(0, 180),
      relatedId: updatedNote.id,
    });
    toast.success("Layer note changes saved");
  };

  const deleteLayerNote = async (note: LayerNoteRecord) => {
    if (!window.confirm(`Delete “${note.subject}” and its attachments?`)) return;
    const attachments = attachmentsForLayerNote(note.layerId, note.id);
    setLayerAttachmentBusyId(note.layerId);
    try {
      await Promise.all(attachments.map((document) => deleteProjectAsset(document)));
      update({
        layerNotes: records.layerNotes.filter((item) => item.id !== note.id),
        documents: records.documents.filter(
          (document) => !attachments.some((attachment) => attachment.id === document.id),
        ),
      });
      wb.addProjectEvent({
        type: "project",
        title: `Deleted layer note: ${note.subject}`,
        relatedId: note.id,
      });
      removeMapNoteMarker(note.id);
      setLayerNoteEditor(null);
      toast.success("Layer note deleted");
    } catch (error) {
      toast.error("Layer note could not be deleted", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setLayerAttachmentBusyId(null);
    }
  };

  const deleteProjectNote = async (note: ProjectNote) => {
    if (!window.confirm(`Delete “${note.title}” and its attachments?`)) return;
    const attachments = attachmentsForProjectNote(note.id);
    setProjectNoteAttachmentBusyId(note.id);
    try {
      await Promise.all(attachments.map((document) => deleteProjectAsset(document)));
      update({
        notes: records.notes.filter((item) => item.id !== note.id),
        documents: records.documents.filter(
          (document) => !attachments.some((attachment) => attachment.id === document.id),
        ),
      });
      removeMapNoteMarker(note.id);
      wb.addProjectEvent({
        type: "project",
        title: `Deleted project note: ${note.title}`,
        relatedId: note.id,
      });
      setNoteEditor(null);
      toast.success("Project note deleted");
    } catch (error) {
      toast.error("Project note could not be deleted", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setProjectNoteAttachmentBusyId(null);
    }
  };

  const removeDocument = async (document: ProjectDocument) => {
    setBusy(true);
    try {
      await deleteProjectAsset(document);
      update({ documents: records.documents.filter((item) => item.id !== document.id) });
      const layer = document.layerId
        ? wb.displayLayers.find((item) => item.id === document.layerId)
        : undefined;
      wb.addProjectEvent({
        type: "project",
        title: `Removed ${document.name}`,
        ...(layer
          ? {
              detail: `Removed from layer note: ${layer.name}`,
              relatedId: document.layerNoteId ?? layer.id,
            }
          : {}),
      });
      toast.success(layer ? "Layer attachment removed" : "Project file removed");
    } catch (error) {
      toast.error("File could not be removed", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setBusy(false);
    }
  };

  const addInboundEmailToProject = async (email: InboundProjectEmail) => {
    if (!auth.user) return;
    setEmailBusy(true);
    try {
      if (!email.projectId) await assignInboundEmail(email.id, wb.projectId);
      const createdAt = email.receivedAt || Date.now();
      const uploadedBy = email.fromAddress || "Inbound email";
      const candidates: ProjectDocument[] = [];
      if (email.rawStoragePath)
        candidates.push({
          id: `inbound-email-${email.id}`,
          name: `${email.subject || "Email"}.eml`.replace(/[\\/:*?"<>|]+/g, "_"),
          storagePath: email.rawStoragePath,
          mimeType: "message/rfc822",
          size: 0,
          folderId: "email",
          source: "email",
          createdAt,
          uploadedBy,
          includeInPacket: true,
          email: {
            from: email.fromAddress,
            to: email.toAddresses.join(", "),
            subject: email.subject,
            sentAt: new Date(createdAt).toISOString(),
            ...(email.textBody ? { preview: email.textBody.slice(0, 4_000) } : {}),
          },
        });
      for (const attachment of email.attachments) {
        if (attachment.status !== "ready" || !attachment.storagePath) continue;
        candidates.push({
          id: `inbound-attachment-${attachment.id}`,
          name: attachment.fileName,
          storagePath: attachment.storagePath,
          mimeType: attachment.contentType,
          size: attachment.byteSize,
          folderId: "email",
          source: "email",
          createdAt,
          uploadedBy,
          includeInPacket: true,
        });
      }
      const existingPaths = new Set(records.documents.map((document) => document.storagePath));
      const additions = candidates.filter((document) => !existingPaths.has(document.storagePath));
      if (additions.length) update({ documents: [...additions, ...records.documents] });
      await markInboundEmailImported(email.id, wb.projectId);
      wb.addProjectEvent({
        type: "email",
        title: `Added email: ${email.subject}`,
        detail: `${email.fromAddress || "Unknown sender"} · ${additions.length} stored file${additions.length === 1 ? "" : "s"}`,
        relatedId: email.id,
      });
      toast.success("Email added to this project's records");
      await refreshInboundEmail();
    } catch (error) {
      toast.error("Email could not be added", {
        description: error instanceof Error ? error.message : "Cloud email intake is unavailable",
      });
    } finally {
      setEmailBusy(false);
    }
  };

  const packetHtml = async () => {
    const notes = records.notes.filter((note) => note.includeInPacket);
    const layerNotes = records.layerNotes.filter((note) => note.includeInPacket);
    const documents = records.documents.filter((document) => document.includeInPacket);
    const renderedDocuments: string[] = [];
    for (const document of documents) {
      let content = "";
      if (document.email?.preview) {
        content = `<dl><dt>From</dt><dd>${escapeHtml(document.email.from ?? "")}</dd><dt>To</dt><dd>${escapeHtml(document.email.to ?? "")}</dd><dt>Subject</dt><dd>${escapeHtml(document.email.subject ?? document.name)}</dd></dl><pre>${escapeHtml(document.email.preview)}</pre>`;
      } else if (document.mimeType.startsWith("image/")) {
        const source = await fileDataUrl(await projectAssetBlob(document));
        content = `<img src="${source}" alt="${escapeHtml(document.name)}" />`;
      } else {
        content = `<p class="attachment">Attached file: ${escapeHtml(document.name)} (${formatBytes(document.size)}). The original is included in the downloadable packet.</p>`;
      }
      renderedDocuments.push(
        `<section class="page"><h2>${escapeHtml(document.name)}</h2><p class="meta">${escapeHtml(folderPath(document.folderId))}${document.layerId ? ` · Layer: ${escapeHtml(wb.displayLayers.find((layer) => layer.id === document.layerId)?.name ?? "Removed layer")}` : ""} · ${new Date(document.createdAt).toLocaleString()}</p>${content}</section>`,
      );
    }
    return `<!doctype html><html><head><title>${escapeHtml(wb.projectName)} packet</title><style>@page{margin:.65in}body{font:12pt Arial,sans-serif;color:#173328}h1,h2{color:#1f7044}.cover,.page{break-after:page}.meta{color:#647067;font-size:9pt}.tags{color:#1f7044;font-size:9pt}article{white-space:pre-wrap;line-height:1.5}img{max-width:100%;max-height:8in;object-fit:contain}pre{white-space:pre-wrap;font:10pt Arial;line-height:1.45}dl{display:grid;grid-template-columns:70px 1fr;gap:4px}dt{font-weight:bold}.attachment{border:1px solid #ccd4ce;padding:16px;border-radius:8px}</style></head><body><section class="cover"><h1>${escapeHtml(wb.projectName)}</h1><p>${escapeHtml(records.summary || "Project records packet")}</p><p class="meta">Created ${new Date().toLocaleString()} · ${notes.length} project notes · ${layerNotes.length} layer notes · ${documents.length} files</p></section>${notes.map((note) => `<section class="page"><h2>${escapeHtml(note.title)}</h2><p class="meta">${escapeHtml(note.author)} · ${new Date(note.createdAt).toLocaleString()}</p><article>${escapeHtml(note.body)}</article></section>`).join("")}${layerNotes
      .map((note) => {
        const layer = wb.displayLayers.find((item) => item.id === note.layerId);
        const group = wb.groups.find((item) => item.id === layer?.groupId);
        return `<section class="page"><h2>${escapeHtml(note.subject)}</h2><p class="meta">Layer: ${escapeHtml(layer?.name ?? "Removed layer")} · Group: ${escapeHtml(group?.name ?? "Removed group")} · ${escapeHtml(note.author)} · ${new Date(note.createdAt).toLocaleString()}</p>${note.tags.length ? `<p class="tags">${escapeHtml(layerNoteTagDraft(note.tags))}</p>` : ""}<article>${escapeHtml(note.body)}</article></section>`;
      })
      .join("")}${renderedDocuments.join("")}</body></html>`;
  };

  const printPacket = async () => {
    const popup = window.open("", "_blank");
    if (!popup) {
      toast.error("Allow pop-ups to print a project packet");
      return;
    }
    popup.document.write("<p style='font-family:sans-serif'>Preparing project packet…</p>");
    try {
      const html = await packetHtml();
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      window.setTimeout(() => popup.print(), 500);
    } catch (error) {
      popup.close();
      toast.error("Packet could not be prepared", {
        description: error instanceof Error ? error.message : "Project files are unavailable",
      });
    }
  };

  const downloadPacket = async () => {
    setBusy(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      zip.file("packet.html", await packetHtml());
      for (const document of records.documents.filter((item) => item.includeInPacket))
        zip.file(
          `files/${folderPath(document.folderId)}/${document.name}`,
          await projectAssetBlob(document),
        );
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${wb.projectName.replace(/[^a-z0-9_-]+/gi, "_")}_records_packet.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } catch (error) {
      toast.error("Packet could not be downloaded", {
        description: error instanceof Error ? error.message : "Project files are unavailable",
      });
    } finally {
      setBusy(false);
    }
  };

  const inboundDomain =
    (import.meta.env as Record<string, string | undefined>)["VITE_INBOUND_EMAIL_DOMAIN"]?.trim() ||
    "inbound.landdraft.net";
  const projectInboundAddress =
    inboundDomain && projectEmailAlias ? `${projectEmailAlias.localPart}@${inboundDomain}` : null;
  const accountInboundAddress =
    inboundDomain && accountEmailAlias ? `${accountEmailAlias.localPart}@${inboundDomain}` : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Project records and notes"
      className="project-records-panel app-overlay-viewport fixed inset-0 z-[95] flex justify-end bg-foreground/20 backdrop-blur-[2px]"
    >
      <section className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-float">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Archive className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold">Project records</h2>
            <p className="truncate text-[10px] text-muted-foreground">{wb.projectName}</p>
          </div>
          <select
            value={wb.projectId}
            disabled={busy || projectNoteAttachmentBusyId !== null}
            onChange={(event) => void wb.openProject(event.target.value)}
            className="hidden max-w-48 rounded-xl border border-border bg-secondary px-2 py-1.5 text-xs sm:block"
            aria-label="Filter records by project"
          >
            {wb.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setRecordsOpen(false)}
            className="rounded-xl p-2 hover:bg-accent"
            aria-label="Close project records"
          >
            <X className="size-4" />
          </button>
        </header>

        <label className="block shrink-0 border-b border-border px-4 py-2 text-xs font-semibold sm:hidden">
          Project
          <select
            value={wb.projectId}
            onChange={(event) => void wb.openProject(event.target.value)}
            disabled={busy || projectNoteAttachmentBusyId !== null}
            className="mt-1 min-h-11 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-base"
          >
            {wb.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <nav className="flex shrink-0 overflow-x-auto border-b border-border p-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold",
                tab === item.id ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              <span className="[&>svg]:size-3.5">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "notes" && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-secondary/40 p-3">
                <label className="mb-2 block text-xs font-semibold">
                  Save note to
                  <select
                    value={noteLayerId}
                    onChange={(event) => setNoteLayerId(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-border bg-card px-3 py-2 text-base sm:text-sm"
                  >
                    <option value="">Project: {wb.projectName}</option>
                    {wb.displayLayers.map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        Layer: {layer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="new-note-subject" className="text-[10px] font-semibold">
                  Subject
                </label>
                <input
                  id="new-note-subject"
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  placeholder="What is this note about?"
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <label htmlFor="new-note-body" className="mt-2 block text-[10px] font-semibold">
                  Note
                </label>
                <textarea
                  id="new-note-body"
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                  placeholder={noteLayerId ? "Add a note to this layer…" : "Add a project note…"}
                  rows={4}
                  className="mt-1 w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <section
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    queueNoteFiles(event.dataTransfer.files);
                  }}
                  className="mt-2 rounded-xl border border-dashed border-primary/40 bg-card/70 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Paperclip className="size-3.5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold">Drop files onto this note</p>
                      <p className="text-[9px] text-muted-foreground">
                        Files are stored with the note and remain downloadable from it.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => noteFileInput.current?.click()}
                      className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-[10px] font-semibold hover:bg-accent"
                    >
                      <Plus className="size-3" /> Choose files
                    </button>
                    <input
                      ref={noteFileInput}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => queueNoteFiles(event.target.files)}
                    />
                  </div>
                  {pendingNoteFiles.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {pendingNoteFiles.map((file) => (
                        <div
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="flex items-center gap-2 rounded-lg bg-secondary px-2 py-1.5"
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">
                            {file.name} · {formatBytes(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingNoteFiles((current) =>
                                current.filter((item) => item !== file),
                              )
                            }
                            className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                            aria-label={`Remove ${file.name} from this note`}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    disabled={projectNoteAttachmentBusyId !== null}
                    onClick={() => void addNote()}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    <Plus className="size-3.5" /> Add note
                  </button>
                  <label className="flex items-center gap-1.5 text-[10px] font-semibold">
                    <input
                      type="checkbox"
                      checked={notePinned}
                      onChange={(event) => setNotePinned(event.target.checked)}
                      className="accent-primary"
                    />
                    <Pin className="size-3 text-primary" /> Pin note
                  </label>
                </div>
              </section>

              {pinnedNotes.length > 0 && (
                <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Pin className="size-4 text-primary" />
                    <div>
                      <h3 className="text-xs font-semibold">Pinned project records</h3>
                      <p className="text-[9px] text-muted-foreground">
                        Project and layer notes · newest first
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {pinnedNotes.map((entry) => {
                      const projectNote = entry.kind === "project" ? entry.note : null;
                      const layerNote = entry.kind === "layer" ? entry.note : null;
                      const title = projectNote?.title ?? layerNote?.subject ?? "Pinned note";
                      const detail =
                        entry.kind === "project"
                          ? `Project note · ${new Date(entry.createdAt).toLocaleString()}`
                          : `${entry.layer?.name ?? "Detached layer"} · ${entry.group?.name ?? "Original layer unavailable"} · ${new Date(entry.createdAt).toLocaleString()}`;
                      return (
                        <button
                          key={`${entry.kind}-${entry.note.id}`}
                          type="button"
                          onClick={() => {
                            if (entry.kind === "project") {
                              setNoteEditor({ ...entry.note });
                            } else {
                              setLayerNoteEditor({ ...entry.note });
                              setLayerNoteEditorTagText(layerNoteTagDraft(entry.note.tags));
                              setLayerNoteTimestampOpen(false);
                              setTab("layer-notes");
                            }
                          }}
                          className="flex w-full items-center gap-2 rounded-xl bg-card px-2.5 py-2 text-left hover:bg-accent"
                        >
                          <Pin className="size-3.5 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-semibold">
                              {title}
                            </span>
                            <span className="block truncate text-[9px] text-muted-foreground">
                              {detail}
                            </span>
                          </span>
                          <ChevronRight className="size-3.5 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {layerNoteRows.length > 0 && (
                <section className="rounded-2xl border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Layers3 className="size-4 text-primary" />
                    <div>
                      <h3 className="text-xs font-semibold">Layer notes</h3>
                      <p className="text-[9px] text-muted-foreground">
                        Saved notes listed in current layer order
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {layerNoteRows.map(({ note, layer, group, order }) => (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => {
                          setLayerNoteEditor({ ...note });
                          setLayerNoteEditorTagText(layerNoteTagDraft(note.tags));
                          setLayerNoteTimestampOpen(false);
                          setTab("layer-notes");
                        }}
                        className="flex w-full items-center gap-2 rounded-xl bg-secondary px-2.5 py-2 text-left hover:bg-accent"
                      >
                        <span className="num flex size-6 shrink-0 items-center justify-center rounded-lg bg-card text-[9px] font-semibold">
                          {Number.isFinite(order) ? order : "—"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-semibold">
                            {note.pinned && <Pin className="mr-1 inline size-2.5 text-primary" />}
                            {note.subject}
                          </span>
                          <span className="block truncate text-[9px] text-muted-foreground">
                            {layer?.name ?? "Detached layer"} ·{" "}
                            {group?.name ?? "Original layer unavailable"}
                            {note.tags.length ? ` · ${layerNoteTagDraft(note.tags)}` : ""}
                          </span>
                        </span>
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-border p-3">
                <h3 className="mb-2 text-xs font-semibold">Project notes</h3>
                <div className="space-y-1">
                  {records.notes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => setNoteEditor({ ...note })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-accent",
                        noteEditor?.id === note.id
                          ? "bg-accent ring-1 ring-primary"
                          : "bg-secondary",
                      )}
                    >
                      <NotebookPen className="size-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold">
                          {note.pinned && <Pin className="mr-1 inline size-2.5 text-primary" />}
                          {note.title}
                        </span>
                        <span className="block truncate text-[9px] text-muted-foreground">
                          {note.author} · {new Date(note.createdAt).toLocaleString()}
                        </span>
                      </span>
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    </button>
                  ))}
                  {!records.notes.length && (
                    <Empty text="No project notes yet. Notes can be included on maps and in project packets." />
                  )}
                </div>
              </section>

              {noteEditor && (
                <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">Edit note</h3>
                    <button
                      type="button"
                      onClick={() => setNoteEditor(null)}
                      className="rounded-lg p-1 hover:bg-accent"
                      aria-label="Close note editor"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <label className="mt-2 block text-[10px] font-semibold">
                    Subject
                    <input
                      value={noteEditor.title}
                      onChange={(event) =>
                        setNoteEditor((current) =>
                          current ? { ...current, title: event.target.value } : current,
                        )
                      }
                      className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
                    />
                  </label>
                  <label className="mt-2 block text-[10px] font-semibold">
                    Note
                    <textarea
                      value={noteEditor.body}
                      onChange={(event) =>
                        setNoteEditor((current) =>
                          current ? { ...current, body: event.target.value } : current,
                        )
                      }
                      rows={5}
                      className="mt-1 w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-xs leading-relaxed outline-none focus:border-primary"
                    />
                  </label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-[10px] font-semibold">
                      Date and time
                      <input
                        type="datetime-local"
                        value={dateTimeInputValue(noteEditor.createdAt)}
                        onChange={(event) => {
                          const timestamp = new Date(event.target.value).getTime();
                          if (Number.isFinite(timestamp))
                            setNoteEditor((current) =>
                              current ? { ...current, createdAt: timestamp } : current,
                            );
                        }}
                        className="mt-1 w-full rounded-xl border border-border bg-card px-2 py-2 text-[10px]"
                      />
                    </label>
                    <label className="text-[10px] font-semibold">
                      Author or source
                      <input
                        value={noteEditor.author}
                        onChange={(event) =>
                          setNoteEditor((current) =>
                            current ? { ...current, author: event.target.value } : current,
                          )
                        }
                        className="mt-1 w-full rounded-xl border border-border bg-card px-2 py-2 text-[10px]"
                      />
                    </label>
                  </div>
                  {noteEditor.mapLocation && (
                    <button
                      type="button"
                      onClick={() => {
                        map?.easeTo({
                          center: [noteEditor.mapLocation!.lng, noteEditor.mapLocation!.lat],
                          zoom: Math.max(map.getZoom(), 16),
                        });
                        setRecordsOpen(false);
                      }}
                      className="mt-2 flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-[10px] font-semibold hover:bg-accent"
                    >
                      <MapPin className="size-3.5 text-primary" /> Show note marker on map
                    </button>
                  )}
                  <section
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void uploadProjectNoteAttachments(noteEditor.id, event.dataTransfer.files);
                    }}
                    className="mt-2 rounded-xl border border-dashed border-border bg-card/70 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <Paperclip className="size-3.5 text-primary" />
                      <p className="min-w-0 flex-1 text-[10px] font-semibold">
                        Attachments
                        {attachmentsForProjectNote(noteEditor.id).length
                          ? ` (${attachmentsForProjectNote(noteEditor.id).length})`
                          : ""}
                      </p>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-[10px] font-semibold hover:bg-accent",
                          projectNoteAttachmentBusyId === noteEditor.id &&
                            "pointer-events-none opacity-50",
                        )}
                      >
                        <Plus className="size-3" /> Add files
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          disabled={projectNoteAttachmentBusyId === noteEditor.id}
                          onChange={(event) => {
                            void uploadProjectNoteAttachments(noteEditor.id, event.target.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      Drag files into this box, or use Add files.
                    </p>
                    {attachmentsForProjectNote(noteEditor.id).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {attachmentsForProjectNote(noteEditor.id).map((document) => (
                          <div
                            key={document.id}
                            className="flex items-center gap-2 rounded-lg bg-secondary px-2 py-1.5"
                          >
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">
                              {document.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => void downloadProjectAsset(document)}
                              className="rounded-md p-1 hover:bg-accent"
                              aria-label={`Download ${document.name}`}
                            >
                              <Download className="size-3" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void removeDocument(document)}
                              className="rounded-md p-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                              aria-label={`Remove ${document.name}`}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={saveEditedNote}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[10px] font-semibold text-primary-foreground"
                    >
                      <Save className="size-3.5" /> Save changes
                    </button>
                    <label className="flex items-center gap-1 text-[10px]">
                      <input
                        type="checkbox"
                        checked={noteEditor.includeInPacket}
                        onChange={(event) =>
                          setNoteEditor((current) =>
                            current
                              ? { ...current, includeInPacket: event.target.checked }
                              : current,
                          )
                        }
                        className="accent-primary"
                      />
                      Include in packet
                    </label>
                    <label className="flex items-center gap-1 text-[10px]">
                      <input
                        type="checkbox"
                        checked={Boolean(noteEditor.pinned)}
                        onChange={(event) =>
                          setNoteEditor((current) =>
                            current ? { ...current, pinned: event.target.checked } : current,
                          )
                        }
                        className="accent-primary"
                      />
                      <Pin className="size-3 text-primary" /> Pinned
                    </label>
                    <button
                      type="button"
                      disabled={projectNoteAttachmentBusyId === noteEditor.id}
                      onClick={() => void deleteProjectNote(noteEditor)}
                      className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3" /> Delete
                    </button>
                  </div>
                  <p className="mt-2 text-[9px] text-muted-foreground">
                    Last edited {new Date(noteEditor.updatedAt).toLocaleString()}
                  </p>
                </section>
              )}
            </div>
          )}

          {tab === "layer-notes" && (
            <div className="space-y-3">
              <section className="rounded-2xl border border-border bg-secondary/40 p-3">
                <div className="flex items-center gap-2">
                  <Layers3 className="size-4 text-primary" />
                  <div>
                    <h3 className="text-xs font-semibold">Notes attached to map layers</h3>
                    <button
                      onClick={() => {
                        setNoteLayerId(
                          layerNoteLayerFilter !== "all"
                            ? layerNoteLayerFilter
                            : (wb.activeLayerId ?? wb.displayLayers[0]?.id ?? ""),
                        );
                        setTab("notes");
                      }}
                      className="mt-2 flex min-h-11 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                    >
                      <Plus className="size-4" /> Add layer note
                    </button>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Notes and their files, listed front to back in the same order as the Layers
                      panel.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="relative sm:col-span-2">
                    <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                    <input
                      value={layerNoteQuery}
                      onChange={(event) => setLayerNoteQuery(event.target.value)}
                      placeholder="Search subject, note, layer, group, author, or tag"
                      className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-xs outline-none focus:border-primary"
                    />
                  </label>
                  <select
                    value={layerNoteGroupFilter}
                    onChange={(event) => setLayerNoteGroupFilter(event.target.value)}
                    className="rounded-xl border border-border bg-card px-3 py-2 text-xs"
                    aria-label="Filter layer notes by group"
                  >
                    <option value="all">All data groups</option>
                    {wb.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={layerNoteLayerFilter}
                    onChange={(event) => setLayerNoteLayerFilter(event.target.value)}
                    className="rounded-xl border border-border bg-card px-3 py-2 text-xs"
                    aria-label="Filter layer notes by layer"
                  >
                    <option value="all">All layers</option>
                    {wb.displayLayers.map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        {layer.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={layerNoteTagFilter}
                    onChange={(event) => setLayerNoteTagFilter(event.target.value)}
                    className="rounded-xl border border-border bg-card px-3 py-2 text-xs sm:col-span-2"
                    aria-label="Filter layer notes by tag"
                  >
                    <option value="all">All tags</option>
                    {allLayerNoteTags.map((tag) => (
                      <option key={tag} value={tag}>
                        #{tag}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="space-y-1 rounded-2xl border border-border p-3">
                <p className="mb-2 text-[10px] font-semibold">
                  {filteredLayerNoteRows.length} matching note
                  {filteredLayerNoteRows.length === 1 ? "" : "s"}
                </p>
                {filteredLayerNoteRows.map(({ note, layer, group, order }) => (
                  <div
                    key={note.id}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-accent",
                      layerNoteEditor?.id === note.id
                        ? "bg-primary/10 ring-1 ring-primary"
                        : "bg-secondary",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setLayerNoteEditor({ ...note });
                        setLayerNoteEditorTagText(layerNoteTagDraft(note.tags));
                        setLayerNoteTimestampOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      <span className="num flex size-6 shrink-0 items-center justify-center rounded-lg bg-card text-[9px] font-semibold">
                        {Number.isFinite(order) ? order : "—"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold">
                          {note.pinned && <Pin className="mr-1 inline size-2.5 text-primary" />}
                          {note.subject}
                        </span>
                        <span className="block truncate text-[9px] text-muted-foreground">
                          {layer?.name ?? "Detached layer"} ·{" "}
                          {group?.name ?? "Original layer unavailable"} ·{" "}
                          {new Date(note.createdAt).toLocaleString()}
                        </span>
                        {note.tags.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {note.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-card px-1.5 py-0.5 text-[8px]"
                              >
                                #{tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                    {layer && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => zoomToLayerRecord(layer.id)}
                          className="rounded-lg bg-card p-1.5 text-primary hover:bg-primary/10"
                          aria-label={`Zoom to layer ${layer.name}`}
                          title={`Zoom to layer: ${layer.name}`}
                        >
                          <MapPin className="size-3.5" />
                        </button>
                        {group && (
                          <button
                            type="button"
                            onClick={() => zoomToGroupRecord(group.id)}
                            className="rounded-lg bg-card p-1.5 text-primary hover:bg-primary/10"
                            aria-label={`Zoom to group ${group.name}`}
                            title={`Zoom to group: ${group.name}`}
                          >
                            <Folder className="size-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!filteredLayerNoteRows.length && (
                  <Empty
                    text={
                      layerNoteRows.length
                        ? "No layer notes match these filters."
                        : "No layer notes yet. Expand a layer in the Layers panel and use its note button to add one."
                    }
                  />
                )}
              </section>

              {layerNoteEditor &&
                (() => {
                  const layer = wb.displayLayers.find(
                    (item) => item.id === layerNoteEditor.layerId,
                  );
                  const group = wb.groups.find((item) => item.id === layer?.groupId);
                  const attachments = attachmentsForLayerNote(
                    layerNoteEditor.layerId,
                    layerNoteEditor.id,
                  );
                  return (
                    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-xs font-semibold">Edit layer note</h3>
                          <p className="truncate text-[9px] text-muted-foreground">
                            {layer?.name ?? "Detached layer"} ·{" "}
                            {group?.name ?? "Original layer unavailable"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLayerNoteEditor(null)}
                          className="rounded-lg p-1 hover:bg-accent"
                          aria-label="Close layer note editor"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      {layer && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => zoomToLayerRecord(layer.id)}
                            className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-[10px] font-semibold hover:bg-accent"
                          >
                            <MapPin className="size-3.5 text-primary" /> Zoom to layer
                          </button>
                          {group && (
                            <button
                              type="button"
                              onClick={() => zoomToGroupRecord(group.id)}
                              className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-[10px] font-semibold hover:bg-accent"
                            >
                              <Folder className="size-3.5 text-primary" /> Zoom to group
                            </button>
                          )}
                        </div>
                      )}
                      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                        <label className="text-[10px] font-semibold">
                          Subject
                          <input
                            value={layerNoteEditor.subject}
                            onChange={(event) =>
                              setLayerNoteEditor((current) =>
                                current ? { ...current, subject: event.target.value } : current,
                              )
                            }
                            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal outline-none focus:border-primary"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setLayerNoteTimestampOpen((current) => !current)}
                          className={cn(
                            "mt-[18px] flex size-8 items-center justify-center rounded-xl border border-border bg-card hover:bg-accent",
                            layerNoteTimestampOpen && "border-primary text-primary",
                          )}
                          title="Change timestamp manually"
                          aria-label="Change timestamp manually"
                        >
                          <Clock3 className="size-3.5" />
                        </button>
                      </div>
                      {layerNoteTimestampOpen && (
                        <label className="mt-2 block text-[10px] font-semibold">
                          Date and time
                          <input
                            type="datetime-local"
                            value={dateTimeInputValue(layerNoteEditor.createdAt)}
                            onChange={(event) =>
                              setLayerNoteEditor((current) =>
                                current
                                  ? {
                                      ...current,
                                      createdAt:
                                        new Date(event.target.value).getTime() || current.createdAt,
                                    }
                                  : current,
                              )
                            }
                            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal"
                          />
                        </label>
                      )}
                      <label className="mt-2 block text-[10px] font-semibold">
                        Tags
                        <input
                          value={layerNoteEditorTagText}
                          onChange={(event) => setLayerNoteEditorTagText(event.target.value)}
                          placeholder="Type # to reuse a tag, or add a custom tag"
                          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal outline-none focus:border-primary"
                        />
                      </label>
                      {editorTagSuggestions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {editorTagSuggestions.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setLayerNoteEditorTagText((current) =>
                                  applyLayerNoteTag(current, tag),
                                )
                              }
                              className="rounded-full bg-secondary px-2 py-1 text-[9px] hover:bg-accent"
                            >
                              #{tag}
                            </button>
                          ))}
                        </div>
                      )}
                      <label className="mt-2 block text-[10px] font-semibold">
                        Note
                        <textarea
                          value={layerNoteEditor.body}
                          onChange={(event) =>
                            setLayerNoteEditor((current) =>
                              current ? { ...current, body: event.target.value } : current,
                            )
                          }
                          rows={6}
                          className="mt-1 w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-xs font-normal leading-relaxed outline-none focus:border-primary"
                        />
                      </label>

                      {layerNoteEditor.mapLocation && (
                        <button
                          type="button"
                          onClick={() => {
                            map?.easeTo({
                              center: [
                                layerNoteEditor.mapLocation!.lng,
                                layerNoteEditor.mapLocation!.lat,
                              ],
                              zoom: Math.max(map.getZoom(), 16),
                            });
                            setRecordsOpen(false);
                          }}
                          className="mt-2 flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-[10px] font-semibold hover:bg-accent"
                        >
                          <MapPin className="size-3.5 text-primary" /> Show note marker on map
                        </button>
                      )}

                      <section
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          void uploadLayerAttachments(
                            layerNoteEditor.layerId,
                            layerNoteEditor.id,
                            event.dataTransfer.files,
                          );
                        }}
                        className="mt-2 rounded-xl border border-dashed border-border bg-card/70 p-2"
                      >
                        <div className="flex items-center gap-2">
                          <Paperclip className="size-3.5 text-primary" />
                          <p className="min-w-0 flex-1 text-[10px] font-semibold">
                            Attachments {attachments.length > 0 && `(${attachments.length})`}
                          </p>
                          <label
                            className={cn(
                              "flex cursor-pointer items-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-[10px] font-semibold hover:bg-accent",
                              layerAttachmentBusyId === layerNoteEditor.layerId &&
                                "pointer-events-none opacity-50",
                            )}
                          >
                            <Plus className="size-3" /> Add files
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              disabled={layerAttachmentBusyId === layerNoteEditor.layerId}
                              onChange={(event) => {
                                void uploadLayerAttachments(
                                  layerNoteEditor.layerId,
                                  layerNoteEditor.id,
                                  event.target.files,
                                );
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                        </div>
                        <p className="mt-1 text-[9px] text-muted-foreground">
                          Drag files into this box, or use Add files.
                        </p>
                        {attachments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {attachments.map((document) => (
                              <div
                                key={document.id}
                                className="flex items-center gap-2 rounded-lg bg-secondary px-2 py-1.5"
                              >
                                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[10px] font-semibold">
                                    {document.name}
                                  </span>
                                  <span className="block text-[9px] text-muted-foreground">
                                    {formatBytes(document.size)} ·{" "}
                                    {new Date(document.createdAt).toLocaleDateString()}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void downloadProjectAsset(document)}
                                  className="rounded-md p-1 hover:bg-accent"
                                  aria-label={`Download ${document.name}`}
                                >
                                  <Download className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void removeDocument(document)}
                                  className="rounded-md p-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                  aria-label={`Remove ${document.name}`}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={saveLayerNoteEditor}
                          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[10px] font-semibold text-primary-foreground"
                        >
                          <Save className="size-3.5" /> Save changes
                        </button>
                        <label className="flex items-center gap-1 text-[10px]">
                          <input
                            type="checkbox"
                            checked={layerNoteEditor.includeInPacket}
                            onChange={(event) =>
                              setLayerNoteEditor((current) =>
                                current
                                  ? { ...current, includeInPacket: event.target.checked }
                                  : current,
                              )
                            }
                            className="accent-primary"
                          />
                          Include in packet
                        </label>
                        <label className="flex items-center gap-1 text-[10px]">
                          <input
                            type="checkbox"
                            checked={Boolean(layerNoteEditor.pinned)}
                            onChange={(event) =>
                              setLayerNoteEditor((current) =>
                                current ? { ...current, pinned: event.target.checked } : current,
                              )
                            }
                            className="accent-primary"
                          />
                          <Pin className="size-3 text-primary" /> Pinned
                        </label>
                        <button
                          type="button"
                          disabled={layerAttachmentBusyId === layerNoteEditor.layerId}
                          onClick={() => void deleteLayerNote(layerNoteEditor)}
                          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          <Trash2 className="size-3" /> Delete note
                        </button>
                      </div>
                      <p className="mt-2 text-[9px] text-muted-foreground">
                        {layerNoteEditor.author} · Last edited{" "}
                        {new Date(layerNoteEditor.updatedAt).toLocaleString()}
                      </p>
                    </section>
                  );
                })()}
            </div>
          )}

          {tab === "files" && (
            <div className="space-y-4">
              <section className="grid gap-2 rounded-2xl border border-border bg-secondary/40 p-3 sm:grid-cols-[1fr_auto]">
                <select
                  value={folderId}
                  onChange={(event) => setFolderId(event.target.value)}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-xs"
                >
                  {records.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folderPath(folder.id)}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Upload className="size-3.5" /> Upload files
                </button>
                <input
                  value={newFolder}
                  onChange={(event) => setNewFolder(event.target.value)}
                  placeholder="New folder or subfolder"
                  className="rounded-xl border border-border bg-card px-3 py-2 text-xs"
                />
                <button
                  onClick={createFolder}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold"
                >
                  <FolderPlus className="size-3.5" /> Create folder
                </button>
              </section>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                accept="*/*,.eml,message/rfc822"
                onChange={(event) => void uploadFiles(event.target.files)}
              />
              {records.documents
                .filter((document) => folderId === "all" || document.folderId === folderId)
                .map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center gap-3 rounded-2xl border border-border p-3"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
                      {document.source === "email" ? (
                        <Mail className="size-4" />
                      ) : document.source === "map" ? (
                        <FileText className="size-4" />
                      ) : (
                        <Paperclip className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{document.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {folderPath(document.folderId)} · {formatBytes(document.size)} ·{" "}
                        {new Date(document.createdAt).toLocaleDateString()}
                        {document.layerId && (
                          <>
                            {" "}
                            · Layer:{" "}
                            {wb.displayLayers.find((layer) => layer.id === document.layerId)
                              ?.name ?? "Removed layer"}
                          </>
                        )}
                        {document.layerNoteId && (
                          <>
                            {" "}
                            · Note:{" "}
                            {records.layerNotes.find((note) => note.id === document.layerNoteId)
                              ?.subject ?? "Removed layer note"}
                          </>
                        )}
                        {document.projectNoteId && (
                          <>
                            {" "}
                            · Note:{" "}
                            {records.notes.find((note) => note.id === document.projectNoteId)
                              ?.title ?? "Removed project note"}
                          </>
                        )}
                      </p>
                    </div>
                    <label className="flex items-center gap-1 text-[10px]">
                      <input
                        type="checkbox"
                        checked={document.includeInPacket}
                        onChange={(event) =>
                          update({
                            documents: records.documents.map((item) =>
                              item.id === document.id
                                ? { ...item, includeInPacket: event.target.checked }
                                : item,
                            ),
                          })
                        }
                        className="accent-primary"
                      />{" "}
                      Packet
                    </label>
                    <button
                      onClick={() => void downloadProjectAsset(document)}
                      className="rounded-lg p-2 hover:bg-accent"
                      aria-label={`Download ${document.name}`}
                    >
                      <Download className="size-3.5" />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void removeDocument(document)}
                      className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                      aria-label={`Delete ${document.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              {!records.documents.length && (
                <Empty text="Store project documents, photos, PDFs, email files, and saved maps here." />
              )}
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                <select
                  value={eventType}
                  onChange={(event) => setEventType(event.target.value as typeof eventType)}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-xs"
                >
                  {eventTypes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 rounded-xl border border-border px-3">
                  <Search className="size-3.5 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter activity"
                    className="min-w-0 flex-1 py-2 text-xs outline-none"
                  />
                </label>
              </div>
              {filteredEvents.map((event) => {
                const linkedKind = relatedRecordKind(event.relatedId);
                const recoverableNote =
                  !linkedKind &&
                  event.type === "note" &&
                  Boolean(event.relatedId) &&
                  !/^deleted\b/i.test(event.title);
                return (
                  <button
                    key={event.id}
                    type="button"
                    disabled={!linkedKind && !recoverableNote}
                    onClick={() =>
                      linkedKind ? openRelatedRecord(event.relatedId) : restoreActivityNote(event)
                    }
                    className={cn(
                      "w-full rounded-2xl border border-border p-3 text-left",
                      linkedKind || recoverableNote
                        ? "hover:border-primary hover:bg-primary/5"
                        : "cursor-default",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px] font-semibold uppercase">
                        {event.type.replace("-", " ")}
                      </span>
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold">{event.title}</p>
                      <time className="text-[9px] text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </time>
                      {(linkedKind || recoverableNote) && (
                        <ChevronRight className="size-3.5 text-primary" />
                      )}
                    </div>
                    {event.detail && (
                      <p className="mt-1 text-[10px] text-muted-foreground">{event.detail}</p>
                    )}
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      {event.actor} · {event.projectName}
                    </p>
                    {recoverableNote && (
                      <p className="mt-2 text-[9px] font-semibold text-amber-700">
                        Original note object unavailable · open to recover the activity summary
                      </p>
                    )}
                  </button>
                );
              })}
              {!filteredEvents.length && (
                <Empty text="Project events will appear here with timestamps and the person who made the change." />
              )}
            </div>
          )}

          {tab === "email" && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-secondary/40 p-4">
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-primary" />
                  <h3 className="min-w-0 flex-1 text-sm font-semibold">Project email intake</h3>
                  {auth.cloudEnabled && (
                    <button
                      type="button"
                      disabled={emailBusy}
                      onClick={() => void refreshInboundEmail()}
                      className="rounded-lg p-2 hover:bg-accent disabled:opacity-50"
                      aria-label="Refresh project email"
                      title="Refresh project email"
                    >
                      <RefreshCw className={cn("size-3.5", emailBusy && "animate-spin")} />
                    </button>
                  )}
                </div>
                {projectInboundAddress && accountInboundAddress ? (
                  <div className="mt-3 grid gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Send directly to this project
                      </p>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(projectInboundAddress);
                          toast.success("Project intake address copied");
                        }}
                        className="num mt-1 w-full break-all rounded-xl border border-border bg-card px-3 py-2 text-left text-xs font-semibold"
                      >
                        {projectInboundAddress}
                      </button>
                    </div>
                    <details className="rounded-xl border border-border bg-card px-3 py-2">
                      <summary className="cursor-pointer text-xs font-semibold">
                        Account inbox for sorting later
                      </summary>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Email this address when you have not chosen a project. Messages can be added
                        to the current project below.
                      </p>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(accountInboundAddress);
                          toast.success("Account inbox address copied");
                        }}
                        className="num mt-2 w-full break-all rounded-lg bg-secondary px-2 py-2 text-left text-[10px] font-semibold"
                      >
                        {accountInboundAddress}
                      </button>
                    </details>
                  </div>
                ) : (
                  <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    {emailSetupError
                      ? `Production intake setup is not complete yet: ${emailSetupError}`
                      : "The secure inbox is being connected to its receiving domain. Until it is live, upload exported .eml files below; they remain searchable and packet-ready."}
                  </p>
                )}
                <button
                  disabled={busy}
                  onClick={() => emailInput.current?.click()}
                  className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                >
                  <Upload className="size-3.5" /> Import .eml email
                </button>
                <input
                  ref={emailInput}
                  type="file"
                  multiple
                  accept=".eml,message/rfc822"
                  className="hidden"
                  onChange={(event) => void uploadFiles(event.target.files, true)}
                />
              </section>

              {!!inboundEmails.length && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <h3 className="text-xs font-semibold">Received email</h3>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px]">
                      {inboundEmails.length} recent
                    </span>
                  </div>
                  {inboundEmails.map((email) => {
                    const importedHere = email.importedProjectId === wb.projectId;
                    return (
                      <article key={email.id} className="rounded-2xl border border-border p-3">
                        <div className="flex items-start gap-2">
                          <span
                            className={cn(
                              "mt-1 size-2 shrink-0 rounded-full",
                              email.status === "ready"
                                ? "bg-emerald-500"
                                : email.status === "processing"
                                  ? "bg-amber-500"
                                  : "bg-red-500",
                            )}
                            title={`Intake status: ${email.status}`}
                          />
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-xs font-semibold">{email.subject}</h4>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {email.projectId ? "Project inbox" : "Account inbox"} · From{" "}
                              {email.fromAddress || "unknown sender"}
                            </p>
                            <p className="text-[9px] text-muted-foreground">
                              {new Date(email.receivedAt).toLocaleString()} ·{" "}
                              {email.attachments.filter((item) => item.status === "ready").length}{" "}
                              attachment
                              {email.attachments.filter((item) => item.status === "ready")
                                .length === 1
                                ? ""
                                : "s"}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={emailBusy || importedHere || email.status === "processing"}
                            onClick={() => void addInboundEmailToProject(email)}
                            className="shrink-0 rounded-xl bg-primary px-3 py-2 text-[10px] font-semibold text-primary-foreground disabled:bg-secondary disabled:text-muted-foreground"
                          >
                            {importedHere ? "Added" : "Add to this project"}
                          </button>
                        </div>
                        {email.textBody && (
                          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[10px] leading-relaxed">
                            {email.textBody}
                          </p>
                        )}
                        {email.errorMessage && (
                          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] text-amber-900">
                            {email.errorMessage}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </section>
              )}

              {records.documents
                .filter((item) => item.source === "email")
                .map((document) => (
                  <article key={document.id} className="rounded-2xl border border-border p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xs font-semibold">
                          {document.email?.subject || document.name}
                        </h3>
                        <p className="truncate text-[10px] text-muted-foreground">
                          From {document.email?.from || "email file"}
                        </p>
                      </div>
                      <button onClick={() => void downloadProjectAsset(document)} className="p-2">
                        <Download className="size-3.5" />
                      </button>
                    </div>
                    {document.email?.preview && (
                      <p className="mt-2 line-clamp-5 text-[10px] leading-relaxed">
                        {document.email.preview}
                      </p>
                    )}
                  </article>
                ))}
            </div>
          )}

          {tab === "summary" && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-secondary/40 p-4">
                <h3 className="text-sm font-semibold">Project summary</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Capture the purpose, findings, decisions, and next steps. This becomes the source
                  brief for the future AI presentation builder.
                </p>
                <textarea
                  value={records.summary}
                  onChange={(event) => update({ summary: event.target.value })}
                  rows={12}
                  placeholder="Purpose, audience, key findings, decisions, risks, and recommended next steps…"
                  className="mt-3 w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary"
                />
              </section>
              <section className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                <strong className="text-foreground">Presentation module foundation</strong>
                <p className="mt-1">
                  The summary, selected notes, maps, emails, and documents are now organized as
                  presentation-ready sources. PowerPoint/PDF/Canva generation can build from this
                  repository without changing the map project.
                </p>
              </section>
            </div>
          )}
        </main>

        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-border p-3">
          <button
            onClick={() => void printPacket()}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 py-2.5 text-xs font-semibold"
          >
            <Printer className="size-3.5" /> Print packet
          </button>
          <button
            disabled={busy}
            onClick={() => void downloadPacket()}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <FileArchive className="size-3.5" /> Download packet
          </button>
        </footer>
      </section>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
