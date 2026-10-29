import { layerOpacity } from "@/lib/gis/layerOpacity";
import { GroupLabelStyleEditor } from "./GroupLabelStyleEditor";
import { layerTreeIds } from "@/lib/gis/layerTreeSelection";
import { LayerSelectionActions } from "./LayerSelectionActions";
import { LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { ParcelCacheControls } from "./ParcelCacheControls";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { bbox as turfBbox } from "@turf/turf";
import type { Feature } from "geojson";
import {
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2,
  GripVertical,
  Crosshair,
  Palette,
  Table2,
  Download,
  Upload,
  FolderPlus,
  Layers,
  Loader2,
  Tag,
  Pencil,
  NotebookPen,
  Paperclip,
  FileText,
  Save,
  Search,
  MoreHorizontal,
  Clock3,
  Pin,
  ArrowUpFromLine,
  ChevronsUp,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkbench } from "@/lib/gis/store";
import { useAuth } from "@/lib/auth";
import { useMapRef } from "@/lib/gis/mapRef";
import {
  deleteProjectAsset,
  downloadProjectAsset,
  uploadProjectAsset,
} from "@/lib/gis/projectRecords";
import { importFiles, SUPPORTED_EXTENSIONS } from "@/lib/gis/import";
import { exportLayer, type ExportFormat } from "@/lib/gis/export";
import { squareMeters, formatArea } from "@/lib/gis/measure";
import type {
  FillPattern,
  GisLayer,
  LayerGroup,
  LayerNoteRecord,
  ProjectDocument,
  StrokePattern,
} from "@/lib/gis/types";
import { StyleEditor } from "./StyleEditor";
import { cn } from "@/lib/utils";
import type { LayerSource } from "@/lib/gis/types";
import { labelFieldsFromTemplate } from "@/lib/gis/labels";
import { featureGeometryType } from "@/lib/gis/layerNormalization";

const exportFormats: Array<{ id: ExportFormat; label: string }> = [
  { id: "geojson", label: "GeoJSON" },
  { id: "kml", label: "KML" },
  { id: "kmz", label: "KMZ" },
  { id: "shp", label: "Shapefile (.zip)" },
];

const remoteLoadLabel = (layer: GisLayer) => {
  if (layer.source.kind !== "remote") return null;
  const loaded = layer.source.loadedFeatures ?? layer.data.features.length;
  const expected = layer.source.expectedFeatures;
  if (layer.source.loadStatus === "loading")
    return expected !== undefined
      ? `Loading ${loaded.toLocaleString()} of ${expected.toLocaleString()} visible features…`
      : `Loading ${loaded.toLocaleString()} visible features…`;
  if (layer.source.loadStatus === "zoom-in")
    return `${(expected ?? 0).toLocaleString()} features in view · zoom in to load all`;
  if (layer.source.loadStatus === "error")
    return layer.source.loadError ?? "Visible area could not finish loading";
  if (layer.source.displayDetail === "overview")
    return `${loaded.toLocaleString()} larger parcels · full detail at zoom 12+`;
  if (layer.source.loadStatus === "complete")
    return `${loaded.toLocaleString()} visible features · complete`;
  if (layer.source.catalogId === "tx-parcels" && layer.data.features.length === 0)
    return "Borders from zoom 10 · large-parcel labels from 11";
  if (layer.source.minZoom !== undefined && layer.data.features.length === 0)
    return `Ready · appears at zoom ${layer.source.minZoom}+`;
  return `${layer.data.features.length.toLocaleString()} visible features`;
};

const formatFileSize = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

type LayerNoteComposer = {
  subject: string;
  body: string;
  tagText: string;
  manualTimestamp: boolean;
  pinned: boolean;
  createdAt: number;
  pendingFiles: File[];
};

const newLayerNoteComposer = (): LayerNoteComposer => ({
  subject: "",
  body: "",
  tagText: "",
  manualTimestamp: false,
  pinned: false,
  createdAt: Date.now(),
  pendingFiles: [],
});

const parseLayerNoteTags = (value: string) => [
  ...new Set(
    value
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#+/, "").trim())
      .filter(Boolean),
  ),
];

const tagDraft = (tags: string[]) => tags.map((tag) => `#${tag}`).join(" ");

const tagSuggestionsFor = (value: string, available: string[]) => {
  const match = value.match(/(?:^|\s)#([^\s#]*)$/);
  if (!match) return [];
  const needle = (match[1] ?? "").toLowerCase();
  return available.filter((tag) => tag.toLowerCase().includes(needle)).slice(0, 6);
};

const applyTagSuggestion = (value: string, tag: string) =>
  `${value.replace(/(?:^|\s)#[^\s#]*$/, "").trim()}${value.trim() ? " " : ""}#${tag} `;

const timestampInputValue = (timestamp: number) => {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
};

type LayerDropPosition = "before" | "inside" | "after";
type GroupDropPosition = "before" | "inside" | "after";

function LayerInsertionLine({
  target,
  active,
  dragging,
  position,
}: {
  target: string;
  active: boolean;
  dragging: boolean;
  position: "before" | "after";
}) {
  return (
    <div
      data-layer-insert-target={target}
      className={cn(
        "absolute inset-x-0 z-20 h-3 touch-none select-none",
        position === "before" ? "-top-2" : "-bottom-2",
        dragging && "cursor-row-resize",
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-x-1 top-1/2 h-px -translate-y-1/2 rounded-full bg-border/70 transition-all",
          dragging && "bg-primary/35",
          active && "inset-x-0 h-1 bg-primary shadow-[0_0_0_2px_hsl(var(--background))]",
        )}
      />
    </div>
  );
}

export function LayerPanel() {
  const wb = useWorkbench();
  const auth = useAuth();
  const { setTableOpen } = useMapRef();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [styleFor, setStyleFor] = useState<string | null>(null);
  const [exportFor, setExportFor] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteComposers, setNoteComposers] = useState<Record<string, LayerNoteComposer>>({});
  const [layerNoteEditor, setLayerNoteEditor] = useState<LayerNoteRecord | null>(null);
  const [layerNoteEditorTagText, setLayerNoteEditorTagText] = useState("");
  const [editingTimestampOpen, setEditingTimestampOpen] = useState(false);
  const [attachmentBusyFor, setAttachmentBusyFor] = useState<string | null>(null);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(() => new Set());
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const draggedLayerRef = useRef<string | null>(null);
  const draggedPointerRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const draggedGroupRef = useRef<string | null>(null);
  const draggedGroupPointerRef = useRef<number | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  const groupDropTargetRef = useRef<string | null>(null);
  const layerListRef = useRef<HTMLDivElement>(null);
  const [groupStyleFor, setGroupStyleFor] = useState<string | null>(null);
  const [groupMenuFor, setGroupMenuFor] = useState<string | null>(null);
  const visibleGroups = flattenVisibleGroups(wb.groups);

  const groupSelectedLayers = () => {
    const selectedIds = wb.layers
      .filter((layer) => wb.selectedLayerIds.includes(layer.id))
      .map((layer) => layer.id);
    if (selectedIds.length < 2) return;
    const name = window
      .prompt(
        `Name the group for ${selectedIds.length} selected layer${selectedIds.length === 1 ? "" : "s"}`,
        "New layer group",
      )
      ?.trim();
    if (!name) return;
    const groupId = wb.addGroup(name);
    selectedIds.forEach((layerId) => wb.setLayerGroup(layerId, groupId));
    wb.setSelectedLayers(selectedIds);
    toast.success(`${selectedIds.length} layer${selectedIds.length === 1 ? "" : "s"} grouped`, {
      description: `Moved into ${name}.`,
    });
  };

  const minimizeAll = () => {
    wb.groups.filter((group) => !group.collapsed).forEach((group) => wb.toggleGroup(group.id));
    setExpandedLayers(new Set());
    setStyleFor(null);
    setExportFor(null);
    setNoteFor(null);
    setLayerNoteEditor(null);
    setGroupStyleFor(null);
    setGroupMenuFor(null);
  };

  const nestSelectedGroups = () => {
    if (!wb.selectedGroupIds.length) return;
    const name = window
      .prompt(
        `Name the parent group for ${wb.selectedGroupIds.length} selected data group${wb.selectedGroupIds.length === 1 ? "" : "s"}`,
        "New parent group",
      )
      ?.trim();
    if (!name) return;
    wb.groupSelectedGroups(wb.selectedGroupIds, name);
    toast.success("Data groups nested", {
      description: `The selected groups are now subgroups of ${name}.`,
    });
  };

  const allLayerNoteTags = [...new Set(wb.records.layerNotes.flatMap((note) => note.tags))].sort(
    (left, right) => left.localeCompare(right),
  );

  const updateNoteComposer = (layerId: string, patch: Partial<LayerNoteComposer>) =>
    setNoteComposers((current) => ({
      ...current,
      [layerId]: { ...(current[layerId] ?? newLayerNoteComposer()), ...patch },
    }));

  const queueLayerNoteFiles = (layerId: string, incoming: FileList | File[]) => {
    const files = Array.from(incoming).filter((file) => {
      if (file.size <= 50 * 1024 * 1024) return true;
      toast.error(`${file.name} is larger than the 50 MB project-file limit`);
      return false;
    });
    if (!files.length) return;
    setNoteComposers((current) => {
      const composer = current[layerId] ?? newLayerNoteComposer();
      return {
        ...current,
        [layerId]: { ...composer, pendingFiles: [...composer.pendingFiles, ...files] },
      };
    });
  };

  const uploadLayerDocuments = async (
    layer: GisLayer,
    layerNoteId: string,
    incoming: FileList | File[],
  ) => {
    if (!auth.user) throw new Error("Sign in before attaching files to a layer note");
    const added: ProjectDocument[] = [];
    for (const file of Array.from(incoming)) {
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
          layerId: layer.id,
          layerNoteId,
        }),
      );
    }
    return added;
  };

  const addLayerAttachments = async (
    layer: GisLayer,
    layerNoteId: string,
    files: FileList | File[],
  ) => {
    if (!files.length) return;
    setAttachmentBusyFor(layer.id);
    try {
      const added = await uploadLayerDocuments(layer, layerNoteId, files);
      if (!added.length) return;
      wb.setProjectRecords({
        ...wb.records,
        documents: [...added, ...wb.records.documents],
      });
      for (const document of added)
        wb.addProjectEvent({
          type: "upload",
          title: `Attached ${document.name} to ${layer.name}`,
          detail: `${formatFileSize(document.size)} · Layer note attachment`,
          relatedId: layerNoteId,
        });
      toast.success(
        `${added.length} attachment${added.length === 1 ? "" : "s"} added to ${layer.name}`,
      );
    } catch (error) {
      toast.error("Layer attachment could not be stored", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setAttachmentBusyFor(null);
    }
  };

  const saveNewLayerNote = async (layer: GisLayer) => {
    const composer = noteComposers[layer.id] ?? newLayerNoteComposer();
    const subject = composer.subject.trim() || "Layer note";
    const body = composer.body.trim();
    if (!body) {
      toast.error("Enter a note");
      return;
    }
    const timestamp = composer.manualTimestamp ? composer.createdAt : Date.now();
    const note: LayerNoteRecord = {
      id: window.crypto.randomUUID(),
      layerId: layer.id,
      subject,
      body,
      tags: parseLayerNoteTags(composer.tagText),
      createdAt: timestamp,
      updatedAt: Date.now(),
      author: auth.user?.name || auth.user?.email || "LandDraft user",
      includeInPacket: true,
      pinned: composer.pinned,
    };
    setAttachmentBusyFor(layer.id);
    try {
      const added = composer.pendingFiles.length
        ? await uploadLayerDocuments(layer, note.id, composer.pendingFiles)
        : [];
      const existingDocuments = wb.records.documents.map((document) =>
        document.layerId === layer.id && !document.layerNoteId
          ? { ...document, layerNoteId: note.id }
          : document,
      );
      wb.setProjectRecords({
        ...wb.records,
        layerNotes: [note, ...wb.records.layerNotes],
        documents: [...added, ...existingDocuments],
      });
      wb.addProjectEvent({
        type: "note",
        title: `Added layer note: ${subject}`,
        detail: `${layer.name}${note.tags.length ? ` · ${tagDraft(note.tags)}` : ""}`,
        relatedId: note.id,
      });
      setNoteComposers((current) => ({ ...current, [layer.id]: newLayerNoteComposer() }));
      setLayerNoteEditor(note);
      setLayerNoteEditorTagText(tagDraft(note.tags));
      setEditingTimestampOpen(false);
      toast.success("Layer note saved");
    } catch (error) {
      toast.error("Layer note could not be saved", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setAttachmentBusyFor(null);
    }
  };

  const saveEditedLayerNote = () => {
    if (!layerNoteEditor) return;
    const subject = layerNoteEditor.subject.trim() || "Layer note";
    const body = layerNoteEditor.body.trim();
    if (!body) {
      toast.error("Enter a note");
      return;
    }
    const updated = {
      ...layerNoteEditor,
      subject,
      body,
      tags: parseLayerNoteTags(layerNoteEditorTagText),
      updatedAt: Date.now(),
    };
    wb.setProjectRecords({
      ...wb.records,
      layerNotes: wb.records.layerNotes.map((note) => (note.id === updated.id ? updated : note)),
    });
    const markerLayer = wb.layers.find(
      (layer) => layer.source.kind === "draw" && layer.source.purpose === "map-notes",
    );
    const markerIndex = markerLayer?.data.features.findIndex(
      (feature) => feature.properties?.["NOTE_ID"] === updated.id,
    );
    if (markerLayer && markerIndex !== undefined && markerIndex >= 0)
      wb.updateFeatureProperties(markerLayer.id, markerIndex, {
        NAME: subject,
        NOTE: body,
        PINNED: Boolean(updated.pinned),
      });
    wb.addProjectEvent({
      type: "note",
      title: `Updated layer note: ${subject}`,
      detail: body.slice(0, 180),
      relatedId: updated.id,
    });
    setLayerNoteEditor(updated);
    toast.success("Layer note updated");
  };

  const removeLayerAttachment = async (layer: GisLayer, document: ProjectDocument) => {
    if (!window.confirm(`Remove “${document.name}” from ${layer.name}?`)) return;
    setAttachmentBusyFor(layer.id);
    try {
      await deleteProjectAsset(document);
      wb.setProjectRecords({
        ...wb.records,
        documents: wb.records.documents.filter((item) => item.id !== document.id),
      });
      wb.addProjectEvent({
        type: "project",
        title: `Removed ${document.name}`,
        detail: `Removed from layer note: ${layer.name}`,
        relatedId: document.layerNoteId ?? layer.id,
      });
      toast.success("Layer attachment removed");
    } catch (error) {
      toast.error("Layer attachment could not be removed", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setAttachmentBusyFor(null);
    }
  };

  const deleteLayerNote = async (layer: GisLayer, note: LayerNoteRecord) => {
    if (!window.confirm(`Delete “${note.subject}” and its attachments?`)) return;
    const layerNoteCount = wb.records.layerNotes.filter((item) => item.layerId === layer.id).length;
    const attachments = wb.records.documents.filter(
      (document) =>
        document.layerNoteId === note.id ||
        (!document.layerNoteId && document.layerId === layer.id && layerNoteCount === 1),
    );
    setAttachmentBusyFor(layer.id);
    try {
      await Promise.all(attachments.map((document) => deleteProjectAsset(document)));
      wb.setProjectRecords({
        ...wb.records,
        layerNotes: wb.records.layerNotes.filter((item) => item.id !== note.id),
        documents: wb.records.documents.filter(
          (document) => !attachments.some((attachment) => attachment.id === document.id),
        ),
      });
      wb.addProjectEvent({
        type: "project",
        title: `Deleted layer note: ${note.subject}`,
        detail: layer.name,
        relatedId: note.id,
      });
      const markerLayer = wb.layers.find(
        (item) => item.source.kind === "draw" && item.source.purpose === "map-notes",
      );
      const markerIndex = markerLayer?.data.features.findIndex(
        (feature) => feature.properties?.["NOTE_ID"] === note.id,
      );
      if (markerLayer && markerIndex !== undefined && markerIndex >= 0)
        wb.removeFeatures(markerLayer.id, [markerIndex]);
      setLayerNoteEditor(null);
      toast.success("Layer note deleted");
    } catch (error) {
      toast.error("Layer note could not be deleted", {
        description: error instanceof Error ? error.message : "Cloud storage is unavailable",
      });
    } finally {
      setAttachmentBusyFor(null);
    }
  };

  const updateDropTarget = (target: string | null) => {
    if (dropTargetRef.current === target) return;
    dropTargetRef.current = target;
    setDropTarget(target);
  };

  const resetLayerDrag = () => {
    draggedLayerRef.current = null;
    draggedPointerRef.current = null;
    dropTargetRef.current = null;
    setDraggedLayerId(null);
    setDropTarget(null);
  };

  const finishLayerDrag = () => {
    const dragged = draggedLayerRef.current;
    const target = dropTargetRef.current;
    if (!dragged || !target) {
      resetLayerDrag();
      return;
    }

    if (target.startsWith("layer-repository:")) {
      const targetLayerId = target.slice("layer-repository:".length);
      const targetLayer = wb.layers.find((layer) => layer.id === targetLayerId);
      if (targetLayer && targetLayer.id !== dragged) {
        wb.nestLayerInLayer(dragged, targetLayer.id);
        setExpandedLayers((current) => new Set(current).add(targetLayer.id));
        toast.success("Layer added to Layer sublayers", {
          description: `Moved inside ${targetLayer.name}.`,
        });
      }
      resetLayerDrag();
      return;
    }

    if (target.startsWith("group:")) {
      const groupId = target.slice("group:".length);
      const group = wb.groups.find((item) => item.id === groupId);
      wb.reorderLayer(dragged, groupId);
      if (group) toast.success(`Layer moved to ${group.name}`);
      resetLayerDrag();
      return;
    }

    const [, targetLayerId, position] = target.split(":") as [string, string, LayerDropPosition];
    const targetLayer = wb.layers.find((layer) => layer.id === targetLayerId);
    if (!targetLayer || targetLayer.id === dragged) {
      resetLayerDrag();
      return;
    }

    if (position === "inside") {
      wb.nestLayerInLayer(dragged, targetLayer.id);
      setExpandedLayers((current) => new Set(current).add(targetLayer.id));
      toast.success("Layer added as a sublayer", {
        description: `${targetLayer.name} now contains the dragged layer.`,
      });
      resetLayerDrag();
      return;
    }

    let beforeLayerId: string | undefined = targetLayer.id;
    if (position === "after") {
      const targetGroupLayers = wb.layers.filter(
        (layer) => layer.groupId === targetLayer.groupId && layer.id !== dragged,
      );
      const targetIndex = targetGroupLayers.findIndex((layer) => layer.id === targetLayer.id);
      beforeLayerId = targetGroupLayers[targetIndex + 1]?.id;
    }
    wb.reorderLayer(dragged, targetLayer.groupId, beforeLayerId);
    resetLayerDrag();
  };

  const updatePointerDropTarget = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (draggedPointerRef.current !== event.pointerId) return;
    event.preventDefault();

    const list = layerListRef.current;
    if (list) {
      const bounds = list.getBoundingClientRect();
      if (event.clientY < bounds.top + 36) list.scrollBy({ top: -14 });
      else if (event.clientY > bounds.bottom - 36) list.scrollBy({ top: 14 });
    }

    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const insertionLine = hit?.closest<HTMLElement>("[data-layer-insert-target]");
    const dragged = draggedLayerRef.current;
    if (insertionLine) {
      const insertionTarget = insertionLine.dataset["layerInsertTarget"];
      const [, targetLayerId, position] = (insertionTarget ?? "").split(":") as [
        string,
        string,
        LayerDropPosition,
      ];
      const targetLayer = wb.layers.find((layer) => layer.id === targetLayerId);
      const invalidLayerTargets = dragged
        ? nestedLayerIds(dragged, wb.groups, wb.layers)
        : new Set<string>();
      if (
        !insertionTarget ||
        !targetLayer ||
        targetLayerId === dragged ||
        position === "inside" ||
        invalidLayerTargets.has(targetLayerId)
      ) {
        updateDropTarget(null);
        return;
      }
      updateDropTarget(insertionTarget);
      return;
    }
    const layerRepository = hit?.closest<HTMLElement>("[data-layer-sublayer-drop-id]");
    if (layerRepository) {
      const targetLayerId = layerRepository.dataset["layerSublayerDropId"];
      const invalidLayerTargets = dragged
        ? nestedLayerIds(dragged, wb.groups, wb.layers)
        : new Set<string>();
      if (!targetLayerId || targetLayerId === dragged || invalidLayerTargets.has(targetLayerId)) {
        updateDropTarget(null);
        return;
      }
      updateDropTarget(`layer-repository:${targetLayerId}`);
      return;
    }
    const layerRow = hit?.closest<HTMLElement>("[data-layer-drop-id]");
    if (layerRow) {
      const targetLayerId = layerRow.dataset["layerDropId"];
      const invalidLayerTargets = dragged
        ? nestedLayerIds(dragged, wb.groups, wb.layers)
        : new Set<string>();
      if (!targetLayerId || targetLayerId === dragged || invalidLayerTargets.has(targetLayerId)) {
        updateDropTarget(null);
        return;
      }
      const bounds = layerRow.getBoundingClientRect();
      const position: LayerDropPosition =
        event.clientY < bounds.top + bounds.height * 0.1
          ? "before"
          : event.clientY > bounds.bottom - bounds.height * 0.1
            ? "after"
            : "inside";
      updateDropTarget(`layer:${targetLayerId}:${position}`);
      return;
    }

    const group = hit?.closest<HTMLElement>("[data-group-drop-id]");
    const groupId = group?.dataset["groupDropId"];
    updateDropTarget(groupId ? `group:${groupId}` : null);
  };

  const startPointerLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>, layerId: string) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggedLayerRef.current = layerId;
    draggedPointerRef.current = event.pointerId;
    setDraggedLayerId(layerId);
    updateDropTarget(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const endPointerLayerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (draggedPointerRef.current !== event.pointerId) return;
    updatePointerDropTarget(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    finishLayerDrag();
  };

  const updateGroupDropTarget = (target: string | null) => {
    if (groupDropTargetRef.current === target) return;
    groupDropTargetRef.current = target;
    setGroupDropTarget(target);
  };

  const resetGroupDrag = () => {
    draggedGroupRef.current = null;
    draggedGroupPointerRef.current = null;
    groupDropTargetRef.current = null;
    setDraggedGroupId(null);
    setGroupDropTarget(null);
  };

  const updatePointerGroupDropTarget = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (draggedGroupPointerRef.current !== event.pointerId) return;
    event.preventDefault();

    const list = layerListRef.current;
    if (!list) {
      updateGroupDropTarget(null);
      return;
    }
    const listBounds = list.getBoundingClientRect();
    if (event.clientY < listBounds.top + 36) list.scrollBy({ top: -14 });
    else if (event.clientY > listBounds.bottom - 36) list.scrollBy({ top: 14 });
    if (event.clientX < listBounds.left || event.clientX > listBounds.right) {
      updateGroupDropTarget(null);
      return;
    }

    const dragged = wb.groups.find((group) => group.id === draggedGroupRef.current);
    if (!dragged) {
      updateGroupDropTarget(null);
      return;
    }

    const invalidTargets = nestedGroupIds(dragged.id, wb.groups);
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const groupRepository = hit?.closest<HTMLElement>("[data-group-sublayer-drop-id]");
    if (groupRepository) {
      const targetLayerId = groupRepository.dataset["groupSublayerDropId"];
      const targetLayer = wb.layers.find((layer) => layer.id === targetLayerId);
      if (targetLayerId && targetLayer && !invalidTargets.has(targetLayer.groupId)) {
        updateGroupDropTarget(`layer-repository:${targetLayerId}`);
        return;
      }
      updateGroupDropTarget(null);
      return;
    }
    const layerTarget = Array.from(list.querySelectorAll<HTMLElement>("[data-layer-drop-id]"))
      .flatMap((element) => {
        const id = element.dataset["layerDropId"];
        const target = wb.layers.find((layer) => layer.id === id);
        return id && target && !invalidTargets.has(target.groupId)
          ? [{ id, bounds: element.getBoundingClientRect() }]
          : [];
      })
      .find(({ bounds }) => event.clientY >= bounds.top && event.clientY <= bounds.bottom);
    if (layerTarget) {
      updateGroupDropTarget(`layer:${layerTarget.id}`);
      return;
    }

    const groupCards = Array.from(
      list.querySelectorAll<HTMLElement>("[data-group-drop-id]"),
    ).flatMap((element) => {
      const id = element.dataset["groupDropId"];
      const target = wb.groups.find((group) => group.id === id);
      return id && target && !invalidTargets.has(id)
        ? [{ id, bounds: element.getBoundingClientRect() }]
        : [];
    });

    // The remaining group card area is a normal subgroup target. Layer rows are handled above so
    // the user can intentionally turn one layer into a container of original features + sublayers.
    // Rectangle checks also avoid Safari pointer-capture quirks.
    const nestedTarget = groupCards.find(
      ({ bounds }) => event.clientY >= bounds.top && event.clientY <= bounds.bottom,
    );
    if (nestedTarget) {
      updateGroupDropTarget(`${nestedTarget.id}:inside`);
      return;
    }

    // Reordering remains available in the small gaps between group cards. Pick the nearest edge so
    // it does not compete with the much larger and more intuitive nesting target.
    const edgeTarget = groupCards
      .flatMap(({ id, bounds }) => [
        { id, position: "before" as const, distance: Math.abs(event.clientY - bounds.top) },
        { id, position: "after" as const, distance: Math.abs(event.clientY - bounds.bottom) },
      ])
      .sort((a, b) => a.distance - b.distance)[0];
    if (!edgeTarget || edgeTarget.distance > 10) {
      updateGroupDropTarget(null);
      return;
    }
    updateGroupDropTarget(`${edgeTarget.id}:${edgeTarget.position}`);
  };

  const finishGroupDrag = () => {
    const dragged = draggedGroupRef.current;
    const target = groupDropTargetRef.current;
    if (!dragged || !target) {
      resetGroupDrag();
      return;
    }
    if (target.startsWith("layer:") || target.startsWith("layer-repository:")) {
      const targetLayerId = target.startsWith("layer-repository:")
        ? target.slice("layer-repository:".length)
        : target.slice("layer:".length);
      const targetLayerName = wb.layers.find((layer) => layer.id === targetLayerId)?.name;
      wb.nestGroupInLayer(dragged, targetLayerId);
      setExpandedLayers((current) => new Set(current).add(targetLayerId));
      toast.success("Group added as layer sublayers", {
        description: targetLayerName
          ? `The original ${targetLayerName} features and the dropped group are now organized together.`
          : undefined,
      });
      resetGroupDrag();
      return;
    }
    const separator = target.lastIndexOf(":");
    const targetGroupId = target.slice(0, separator);
    const position = target.slice(separator + 1) as GroupDropPosition;
    wb.reorderGroup(dragged, targetGroupId, position);
    const targetName = wb.groups.find((group) => group.id === targetGroupId)?.name;
    toast.success(position === "inside" ? "Group nested as a subgroup" : "Layer group reordered", {
      description: position === "inside" && targetName ? `Moved inside ${targetName}.` : undefined,
    });
    resetGroupDrag();
  };

  const startPointerGroupDrag = (event: ReactPointerEvent<HTMLButtonElement>, groupId: string) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggedGroupRef.current = groupId;
    draggedGroupPointerRef.current = event.pointerId;
    setDraggedGroupId(groupId);
    updateGroupDropTarget(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const endPointerGroupDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (draggedGroupPointerRef.current !== event.pointerId) return;
    updatePointerGroupDropTarget(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    finishGroupDrag();
  };

  const toggleLayerExpanded = (id: string) => {
    setExpandedLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const { results, errors } = await importFiles(files);
      for (const r of results) {
        wb.addLayer({
          name: r.name,
          data: r.data,
          groupId: "imports",
          source: {
            kind: "import",
            fileName: r.name,
            fileSizeBytes: r.fileSizeBytes,
            featureCount: r.featureCount,
            coordinateCount: r.coordinateCount,
          },
        });
      }
      if (results.length > 0) {
        toast.success(`Imported ${results.length} file${results.length > 1 ? "s" : ""}`, {
          description: `${results.reduce((a, r) => a + r.featureCount, 0).toLocaleString()} editable features added to Imported files. Current map extent preserved.`,
        });
      }
      for (const e of errors) toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const { map } = useMapRef();
  const zoomTo = (data: GisLayer["data"]) => {
    if (!map || data.features.length === 0) return;
    try {
      const b = turfBbox(data as never) as [number, number, number, number];
      if (b.every((n) => Number.isFinite(n))) map.fitBounds(b, { padding: 60, maxZoom: 16 });
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-sidebar"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4 text-primary" /> Data Groups
          <span className="num rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">
            {wb.layers.length}
          </span>
        </div>
        <button
          onClick={() => {
            const name = window.prompt("Name your new group", "New group");
            if (name) wb.addGroup(name);
          }}
          title="Add group"
          aria-label="Add group"
          className="rounded-lg p-1.5 hover:bg-sidebar-accent"
        >
          <FolderPlus className="size-4" />
        </button>
      </div>

      <div className="mx-2 mb-2 flex items-center justify-between gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5 text-[10px]">
        <button
          type="button"
          onClick={minimizeAll}
          className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Collapse every open data group, layer, sublayer section, note, and editor"
          aria-label="Minimize all layer panel sections"
        >
          <ChevronsUp className="size-3" /> Minimize all
        </button>
        <LayerSelectionActions onGroup={groupSelectedLayers} />
      </div>

      {wb.selectedGroupIds.length > 0 && (
        <div className="mx-2 mb-2 flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-2 py-1.5 text-[10px]">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {wb.selectedGroupIds.length} data group
            {wb.selectedGroupIds.length === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            onClick={nestSelectedGroups}
            className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 font-semibold text-primary-foreground"
            title="Create a parent group containing the selected groups as subgroups"
          >
            <FolderPlus className="size-3" /> Make subgroup
          </button>
          <button
            type="button"
            onClick={() => wb.setSelectedGroups([])}
            className="rounded-lg px-1.5 py-1 font-semibold text-muted-foreground hover:bg-accent"
          >
            Clear
          </button>
        </div>
      )}

      <div ref={layerListRef} className="flex-1 overflow-y-auto px-2 pb-6">
        {visibleGroups.map(({ group, depth }) => {
          const layers = wb.layers.filter((l) => l.groupId === group.id);
          const childGroups = wb.groups.filter((item) => item.parentId === group.id);
          const groupedLayerIds = nestedGroupIds(group.id, wb.groups);
          const groupedLayers = wb.layers.filter((layer) => groupedLayerIds.has(layer.groupId));
          const allVisible =
            groupedLayers.length > 0 && groupedLayers.every((layer) => layer.visible);
          const groupSelected = wb.selectedGroupIds.includes(group.id);
          const renameGroup = () => {
            const name = window.prompt("Rename layer group", group.name)?.trim();
            if (!name || name === group.name) return;
            wb.renameGroup(group.id, name);
            toast.success(`Group renamed to ${name}`);
          };
          return (
            <div
              key={group.id}
              style={{ marginLeft: depth * 12 }}
              className={cn(
                "mb-2 rounded-xl transition-colors",
                dropTarget === `group:${group.id}` && "bg-accent/70 ring-2 ring-primary/60",
                draggedGroupId === group.id && "opacity-40",
                groupDropTarget === `${group.id}:before` &&
                  "shadow-[0_-3px_0_0_hsl(var(--primary))]",
                groupDropTarget === `${group.id}:inside` && "bg-primary/10 ring-2 ring-primary/70",
                groupDropTarget === `${group.id}:after` && "shadow-[0_3px_0_0_hsl(var(--primary))]",
              )}
            >
              <div
                data-group-header-id={group.id}
                data-group-drop-id={group.id}
                className={cn(
                  "relative flex items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent",
                  groupSelected && "bg-accent text-foreground ring-1 ring-primary/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={groupSelected}
                  onChange={() => wb.toggleGroupSelection(group.id)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Select ${group.name} group`}
                  title="Select group for nesting"
                  className="ml-1.5 size-3.5 shrink-0 accent-primary"
                />
                <button
                  onClick={() => wb.toggleGroup(group.id)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    renameGroup();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    renameGroup();
                  }}
                  title={`${group.name}${group.containerLayerId ? " layer container" : ""} · Double-click to rename`}
                  className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide"
                >
                  {group.collapsed ? (
                    <ChevronRight className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0" />
                  )}
                  {group.containerLayerId && (
                    <Layers className="size-3 shrink-0 text-primary" aria-hidden="true" />
                  )}
                  <span className="truncate">{group.name}</span>
                  <span className="num ml-auto text-[10px]">{groupedLayers.length}</span>
                </button>
                <button
                  onClick={() => wb.setGroupVisible(group.id, !allVisible)}
                  aria-label={allVisible ? `Hide ${group.name}` : `Show ${group.name}`}
                  title={allVisible ? "Hide group" : "Show group"}
                  className="rounded p-1 hover:bg-accent hover:text-foreground"
                >
                  {allVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </button>
                <button
                  onClick={() => setGroupMenuFor(groupMenuFor === group.id ? null : group.id)}
                  aria-label={`Open actions for ${group.name}`}
                  title="Rename, style, add a subgroup, or delete"
                  className="rounded p-1 hover:bg-accent hover:text-foreground"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
                {groupMenuFor === group.id && (
                  <div className="absolute right-7 top-7 z-30 w-44 rounded-xl border border-border bg-popover p-1 text-[10px] normal-case tracking-normal text-popover-foreground shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setGroupMenuFor(null);
                        renameGroup();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
                    >
                      <Pencil className="size-3.5" /> Rename group
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGroupStyleFor(groupStyleFor === group.id ? null : group.id);
                        setGroupMenuFor(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
                    >
                      <Palette className="size-3.5" /> Style every layer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGroupMenuFor(null);
                        const name = window
                          .prompt(`Name a subgroup inside ${group.name}`, "New subgroup")
                          ?.trim();
                        if (name) wb.addSubgroup(group.id, name);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
                    >
                      <FolderPlus className="size-3.5" /> Add subgroup
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGroupMenuFor(null);
                        if (
                          !window.confirm(
                            `Delete the “${group.name}” group and its subgroups? Its map layers will be kept and moved to another data group.`,
                          )
                        )
                          return;
                        wb.removeGroup(group.id);
                        toast.success("Data group deleted", {
                          description: "Its layers were kept and moved to another group.",
                        });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" /> Delete group
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onPointerDown={(event) => startPointerGroupDrag(event, group.id)}
                  onPointerMove={updatePointerGroupDropTarget}
                  onPointerUp={endPointerGroupDrag}
                  onPointerCancel={resetGroupDrag}
                  aria-label={`Drag ${group.name} group to reorder or nest`}
                  title="Drop on a group to nest it, on a layer to add it as sublayers, or between groups to reorder"
                  className={cn(
                    "mr-0.5 flex size-7 shrink-0 touch-none select-none items-center justify-center rounded hover:bg-accent hover:text-foreground",
                    draggedGroupId === group.id
                      ? "cursor-grabbing bg-accent text-foreground"
                      : "cursor-grab",
                  )}
                >
                  <GripVertical className="pointer-events-none size-4" />
                </button>
              </div>
              {groupStyleFor === group.id && (
                <GroupStyleEditor group={group} layers={groupedLayers} />
              )}
              {!group.collapsed && (
                <div className="space-y-1 pl-1">
                  {layers.length === 0 && childGroups.length === 0 && (
                    <p className="px-2 py-1 text-[11px] text-muted-foreground">Nothing here yet</p>
                  )}
                  {layers.map((layer, layerIndex) => {
                    const selected = wb.selectedLayerIds.includes(layer.id);
                    const expanded = expandedLayers.has(layer.id);
                    const sqm = expanded ? squareMeters(layer.data) : 0;
                    const labelFields =
                      layer.style.labelFields?.length > 0
                        ? layer.style.labelFields
                        : labelFieldsFromTemplate(layer.style.labelTemplate);
                    const layerAttachments = wb.records.documents.filter(
                      (document) => document.layerId === layer.id,
                    );
                    const layerNotes = wb.records.layerNotes
                      .filter((note) => note.layerId === layer.id)
                      .sort((left, right) => right.createdAt - left.createdAt);
                    const composer = noteComposers[layer.id] ?? newLayerNoteComposer();
                    const composerTagSuggestions = tagSuggestionsFor(
                      composer.tagText,
                      allLayerNoteTags,
                    );
                    const editorTagSuggestions =
                      layerNoteEditor?.layerId === layer.id
                        ? tagSuggestionsFor(layerNoteEditorTagText, allLayerNoteTags)
                        : [];
                    const attachmentsForNote = (noteId: string) =>
                      layerAttachments.filter(
                        (document) =>
                          document.layerNoteId === noteId ||
                          (!document.layerNoteId && layerNotes.length === 1),
                      );
                    return (
                      <div
                        key={layer.id}
                        className={cn(
                          "relative rounded-xl border px-1.5 py-1.5 transition-all",
                          selected
                            ? "border-primary bg-accent/60"
                            : "border-transparent hover:bg-sidebar-accent",
                          draggedLayerId === layer.id && "opacity-40",
                          dropTarget === `layer:${layer.id}:before` && "border-primary",
                          dropTarget === `layer:${layer.id}:inside` &&
                            "border-primary bg-primary/10 ring-2 ring-primary/70",
                          dropTarget === `layer-repository:${layer.id}` &&
                            "border-primary bg-primary/10 ring-2 ring-primary/70",
                          dropTarget === `layer:${layer.id}:after` && "border-primary",
                          groupDropTarget === `layer:${layer.id}` &&
                            "border-primary bg-primary/10 ring-2 ring-primary/70",
                          groupDropTarget === `layer-repository:${layer.id}` &&
                            "border-primary bg-primary/10 ring-2 ring-primary/70",
                        )}
                      >
                        <LayerInsertionLine
                          target={`layer:${layer.id}:before`}
                          active={dropTarget === `layer:${layer.id}:before`}
                          dragging={draggedLayerId !== null}
                          position="before"
                        />
                        <div
                          data-layer-drop-id={layer.id}
                          className="flex min-h-8 items-center gap-1.5"
                        >
                          <input
                            type="checkbox"
                            checked={
                              selected &&
                              layerTreeIds(layer.id, wb.layers, wb.groups).every((id) =>
                                wb.selectedLayerIds.includes(id),
                              )
                            }
                            ref={(input) => {
                              if (input) {
                                const ids = layerTreeIds(layer.id, wb.layers, wb.groups);
                                const count = ids.filter((id) =>
                                  wb.selectedLayerIds.includes(id),
                                ).length;
                                input.indeterminate = count > 0 && count < ids.length;
                              }
                            }}
                            onChange={() => wb.toggleLayerSelection(layer.id, true)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${layer.name} for batch actions`}
                            title="Select this layer and all nested layers for batch actions"
                            className="size-3.5 shrink-0 accent-primary"
                          />
                          <button
                            onClick={() => toggleLayerExpanded(layer.id)}
                            aria-label={expanded ? "Collapse layer" : "Expand layer"}
                            title={expanded ? "Collapse layer" : "Expand layer"}
                            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            {expanded ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => wb.toggleVisible(layer.id)}
                            aria-label={layer.visible ? "Hide layer" : "Show layer"}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            {layer.visible ? (
                              <Eye className="size-4" />
                            ) : (
                              <EyeOff className="size-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-pressed={Boolean(layer.selectionLocked)}
                            aria-label={
                              (layer.selectionLocked
                                ? "Unlock selection for "
                                : "Lock selection for ") + layer.name
                            }
                            title={
                              layer.selectionLocked
                                ? "Selection locked — click to unlock"
                                : "Lock selection (keep layer visible)"
                            }
                            className="rounded p-1 text-primary hover:bg-accent"
                            onClick={() => {
                              wb.updateLayer(layer.id, { selectionLocked: !layer.selectionLocked });
                              if (!layer.selectionLocked)
                                wb.setSelectedFeatures(
                                  wb.selectedFeatures.filter((item) => item.layerId !== layer.id),
                                );
                            }}
                          >
                            {layer.selectionLocked ? (
                              <LockKeyhole className="size-3.5" />
                            ) : (
                              <LockKeyholeOpen className="size-3.5 opacity-50" />
                            )}
                          </button>
                          <LayerStyleSwatch layer={layer} />
                          <button
                            data-help={layer.name}
                            title={layer.name}
                            onClick={(e) =>
                              wb.toggleLayerSelection(layer.id, e.metaKey || e.ctrlKey)
                            }
                            onDoubleClick={() => {
                              const name = window.prompt("Rename layer", layer.name);
                              if (name) wb.updateLayer(layer.id, { name });
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate text-xs font-medium">{layer.name}</div>
                            {layer.source.kind === "remote" && (
                              <div
                                className={cn(
                                  "num flex items-center gap-1 truncate text-[9px] text-muted-foreground",
                                  layer.source.loadStatus === "error" && "text-destructive",
                                )}
                                title={remoteLoadLabel(layer) ?? undefined}
                              >
                                {layer.source.loading && (
                                  <Loader2 className="size-2.5 shrink-0 animate-spin" />
                                )}
                                {remoteLoadLabel(layer)}
                              </div>
                            )}
                            {labelFields.length > 0 && (
                              <div className="num flex items-center gap-1 truncate text-[9px] text-muted-foreground">
                                <Tag className="size-2.5 shrink-0" />
                                {layer.style.labelEnabled ? "Labels" : "Labels off"} ·{" "}
                                {labelFields.join(" + ")}
                              </div>
                            )}
                          </button>
                          {wb.groups.some((group) => group.containerLayerId === layer.id) && (
                            <Layers
                              className="size-3.5 shrink-0 text-primary"
                              aria-label="Layer contains sublayers and groups"
                            />
                          )}
                          <button
                            onClick={() => {
                              if (layer.style.labelUseLayerName || layer.style.labelTemplate.trim())
                                wb.updateStyle(layer.id, {
                                  labelEnabled: !layer.style.labelEnabled,
                                });
                              else {
                                setStyleFor(layer.id);
                                setExpandedLayers((current) => new Set(current).add(layer.id));
                              }
                            }}
                            aria-label={
                              layer.style.labelUseLayerName || layer.style.labelTemplate.trim()
                                ? layer.style.labelEnabled
                                  ? "Turn labels off"
                                  : "Turn labels on"
                                : "Set up labels"
                            }
                            title={
                              layer.style.labelUseLayerName || layer.style.labelTemplate.trim()
                                ? layer.style.labelEnabled
                                  ? "Turn labels off"
                                  : "Turn labels on"
                                : "Set up labels"
                            }
                            className={cn(
                              "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground",
                              layer.style.labelEnabled && "bg-primary text-primary-foreground",
                            )}
                          >
                            <Tag className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onPointerDown={(event) => startPointerLayerDrag(event, layer.id)}
                            onPointerMove={updatePointerDropTarget}
                            onPointerUp={endPointerLayerDrag}
                            onPointerCancel={resetLayerDrag}
                            aria-label={`Drag ${layer.name} to reorder or nest`}
                            title="Drag to a line between layers to reorder, onto a layer to nest, or onto a group to move"
                            className={cn(
                              "-mr-0.5 flex size-7 shrink-0 touch-none select-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
                              draggedLayerId === layer.id
                                ? "cursor-grabbing bg-accent text-foreground"
                                : "cursor-grab",
                            )}
                          >
                            <GripVertical className="size-4 pointer-events-none" />
                          </button>
                        </div>

                        {expanded && (
                          <div className="mt-2 space-y-2">
                            <div className="num px-1 text-[10px] text-muted-foreground">
                              {remoteLoadLabel(layer) ??
                                `${layer.data.features.length.toLocaleString()} features`}
                              {sqm > 0 ? ` · ${formatArea(sqm, wb.units.area)}` : ""}
                            </div>
                            <LayerChildrenTree
                              parentLayerId={layer.id}
                              onZoom={zoomTo}
                              draggedLayerId={draggedLayerId}
                              draggedGroupId={draggedGroupId}
                              layerDropTarget={dropTarget}
                              groupDropTarget={groupDropTarget}
                              onLayerPointerDown={startPointerLayerDrag}
                              onLayerPointerMove={updatePointerDropTarget}
                              onLayerPointerUp={endPointerLayerDrag}
                              onLayerPointerCancel={resetLayerDrag}
                              onGroupPointerDown={startPointerGroupDrag}
                              onGroupPointerMove={updatePointerGroupDropTarget}
                              onGroupPointerUp={endPointerGroupDrag}
                              onGroupPointerCancel={resetGroupDrag}
                            />
                            <div className="flex flex-wrap gap-1">
                              <IconBtn
                                label="Zoom to layer"
                                onClick={() => zoomTo(layer.data)}
                                icon={<Crosshair className="size-3.5" />}
                              />
                              <IconBtn
                                label="Style"
                                onClick={() => setStyleFor(styleFor === layer.id ? null : layer.id)}
                                icon={<Palette className="size-3.5" />}
                                active={styleFor === layer.id}
                              />
                              <IconBtn
                                label="Attribute table"
                                onClick={() => {
                                  wb.setActiveLayer(layer.id);
                                  setTableOpen(true);
                                }}
                                icon={<Table2 className="size-3.5" />}
                              />
                              <IconBtn
                                label="Export"
                                onClick={() =>
                                  setExportFor(exportFor === layer.id ? null : layer.id)
                                }
                                icon={<Download className="size-3.5" />}
                                active={exportFor === layer.id}
                              />
                              <IconBtn
                                label="Duplicate in this category"
                                onClick={() => wb.duplicateLayer(layer.id)}
                                icon={<Copy className="size-3.5" />}
                              />
                              <IconBtn
                                label={
                                  layerNotes.length > 0 || layerAttachments.length > 0
                                    ? "Add or edit layer notes and attachments"
                                    : "Add layer note or attachment"
                                }
                                onClick={() => {
                                  if (!noteComposers[layer.id])
                                    setNoteComposers((current) => ({
                                      ...current,
                                      [layer.id]: newLayerNoteComposer(),
                                    }));
                                  if (noteFor === layer.id) setLayerNoteEditor(null);
                                  setNoteFor(noteFor === layer.id ? null : layer.id);
                                }}
                                icon={<NotebookPen className="size-3.5" />}
                                active={
                                  noteFor === layer.id ||
                                  layerNotes.length > 0 ||
                                  layerAttachments.length > 0
                                }
                              />
                              <IconBtn
                                label="Delete"
                                onClick={() => wb.removeLayers([layer.id])}
                                icon={<Trash2 className="size-3.5" />}
                                danger
                              />
                            </div>

                            {noteFor === layer.id && (
                              <section className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-2">
                                <div className="flex items-center gap-1.5">
                                  <NotebookPen className="size-3 text-primary" />
                                  <p className="min-w-0 flex-1 truncate text-[10px] font-semibold">
                                    New note for {layer.name}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setNoteFor(null)}
                                    className="rounded-md px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-accent"
                                  >
                                    Close
                                  </button>
                                </div>

                                <div className="grid grid-cols-[1fr_auto] gap-1">
                                  <label className="text-[9px] font-semibold">
                                    Subject
                                    <input
                                      value={composer.subject}
                                      onChange={(event) =>
                                        updateNoteComposer(layer.id, {
                                          subject: event.target.value,
                                        })
                                      }
                                      autoFocus
                                      placeholder="What is this note about?"
                                      className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] font-normal outline-none focus:border-primary"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateNoteComposer(layer.id, {
                                        manualTimestamp: !composer.manualTimestamp,
                                        createdAt: composer.manualTimestamp
                                          ? Date.now()
                                          : composer.createdAt,
                                      })
                                    }
                                    className={cn(
                                      "mt-[17px] flex size-7 items-center justify-center rounded-lg border border-border bg-card hover:bg-accent",
                                      composer.manualTimestamp && "border-primary text-primary",
                                    )}
                                    title="Change the note timestamp manually"
                                    aria-label="Change note timestamp manually"
                                  >
                                    <Clock3 className="size-3.5" />
                                  </button>
                                </div>
                                {composer.manualTimestamp && (
                                  <label className="block text-[9px] font-semibold">
                                    Date and time
                                    <input
                                      type="datetime-local"
                                      value={timestampInputValue(composer.createdAt)}
                                      onChange={(event) =>
                                        updateNoteComposer(layer.id, {
                                          createdAt:
                                            new Date(event.target.value).getTime() || Date.now(),
                                        })
                                      }
                                      className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[10px] font-normal"
                                    />
                                  </label>
                                )}
                                <label className="block text-[9px] font-semibold">
                                  Tags
                                  <input
                                    value={composer.tagText}
                                    onChange={(event) =>
                                      updateNoteComposer(layer.id, { tagText: event.target.value })
                                    }
                                    placeholder="Type # to reuse a tag, or add a new one"
                                    className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[10px] font-normal outline-none focus:border-primary"
                                  />
                                </label>
                                {composerTagSuggestions.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {composerTagSuggestions.map((tag) => (
                                      <button
                                        key={tag}
                                        type="button"
                                        onClick={() =>
                                          updateNoteComposer(layer.id, {
                                            tagText: applyTagSuggestion(composer.tagText, tag),
                                          })
                                        }
                                        className="rounded-full bg-secondary px-2 py-0.5 text-[9px] hover:bg-accent"
                                      >
                                        #{tag}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <label className="flex items-center gap-1.5 rounded-lg bg-card px-2 py-1.5 text-[9px] font-semibold">
                                  <input
                                    type="checkbox"
                                    checked={composer.pinned}
                                    onChange={(event) =>
                                      updateNoteComposer(layer.id, {
                                        pinned: event.target.checked,
                                      })
                                    }
                                    className="accent-primary"
                                  />
                                  <Pin className="size-3 text-primary" /> Pin in Project Records
                                </label>
                                <label className="block text-[9px] font-semibold">
                                  Note
                                  <textarea
                                    value={composer.body}
                                    onChange={(event) =>
                                      updateNoteComposer(layer.id, { body: event.target.value })
                                    }
                                    rows={4}
                                    placeholder="Add context, source details, decisions, or follow-up items…"
                                    className="mt-1 w-full resize-y rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] font-normal leading-relaxed outline-none focus:border-primary"
                                  />
                                </label>

                                <div
                                  onDragOver={(event) => {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "copy";
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    queueLayerNoteFiles(layer.id, event.dataTransfer.files);
                                  }}
                                  className="rounded-lg border border-dashed border-border bg-card/70 p-2 text-center"
                                >
                                  <Paperclip className="mx-auto size-3.5 text-primary" />
                                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                                    Drop files here or{" "}
                                    <label className="cursor-pointer font-semibold text-primary hover:underline">
                                      browse
                                      <input
                                        type="file"
                                        multiple
                                        className="hidden"
                                        onChange={(event) => {
                                          if (event.target.files)
                                            queueLayerNoteFiles(layer.id, event.target.files);
                                          event.currentTarget.value = "";
                                        }}
                                      />
                                    </label>
                                  </p>
                                </div>
                                {composer.pendingFiles.length > 0 && (
                                  <div className="space-y-1">
                                    {composer.pendingFiles.map((file, index) => (
                                      <div
                                        key={`${file.name}-${file.size}-${index}`}
                                        className="flex items-center gap-1.5 rounded-md bg-card px-1.5 py-1"
                                      >
                                        <FileText className="size-3 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate text-[9px]">
                                          {file.name} · {formatFileSize(file.size)}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateNoteComposer(layer.id, {
                                              pendingFiles: composer.pendingFiles.filter(
                                                (_, itemIndex) => itemIndex !== index,
                                              ),
                                            })
                                          }
                                          className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                                          aria-label={`Remove ${file.name}`}
                                        >
                                          <Trash2 className="size-2.5" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  disabled={attachmentBusyFor === layer.id}
                                  onClick={() => void saveNewLayerNote(layer)}
                                  className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
                                >
                                  {attachmentBusyFor === layer.id ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <Save className="size-3" />
                                  )}
                                  Save note
                                </button>

                                <div className="border-t border-border pt-2">
                                  <p className="mb-1 text-[9px] font-semibold">
                                    Saved notes ({layerNotes.length})
                                  </p>
                                  {layerNotes.length > 0 ? (
                                    <div className="space-y-1">
                                      {layerNotes.map((note) => {
                                        const noteOpen = layerNoteEditor?.id === note.id;
                                        return (
                                          <div key={note.id} className="space-y-1">
                                            <button
                                              type="button"
                                              aria-expanded={noteOpen}
                                              onClick={() => {
                                                if (noteOpen) {
                                                  setLayerNoteEditor(null);
                                                  setLayerNoteEditorTagText("");
                                                  setEditingTimestampOpen(false);
                                                  return;
                                                }
                                                setLayerNoteEditor({ ...note });
                                                setLayerNoteEditorTagText(tagDraft(note.tags));
                                                setEditingTimestampOpen(false);
                                              }}
                                              className={cn(
                                                "flex w-full items-start gap-1.5 rounded-lg bg-card px-2 py-1.5 text-left hover:bg-accent",
                                                noteOpen && "ring-1 ring-primary",
                                              )}
                                            >
                                              <NotebookPen className="mt-0.5 size-3 shrink-0 text-primary" />
                                              <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[10px] font-semibold">
                                                  {note.pinned && (
                                                    <Pin className="mr-1 inline size-2.5 text-primary" />
                                                  )}
                                                  {note.subject}
                                                </span>
                                                <span className="block truncate text-[8px] text-muted-foreground">
                                                  {new Date(note.createdAt).toLocaleString()}
                                                  {attachmentsForNote(note.id).length
                                                    ? ` · ${attachmentsForNote(note.id).length} file${attachmentsForNote(note.id).length === 1 ? "" : "s"}`
                                                    : ""}
                                                </span>
                                                {note.tags.length > 0 && (
                                                  <span className="mt-1 flex flex-wrap gap-1">
                                                    {note.tags.map((tag) => (
                                                      <span
                                                        key={tag}
                                                        className="rounded-full bg-secondary px-1.5 py-0.5 text-[8px]"
                                                      >
                                                        #{tag}
                                                      </span>
                                                    ))}
                                                  </span>
                                                )}
                                              </span>
                                              {noteOpen ? (
                                                <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                                              ) : (
                                                <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                                              )}
                                            </button>

                                            {noteOpen && layerNoteEditor && (
                                              <section className="rounded-lg border border-primary/30 bg-card p-2">
                                                <div className="flex items-center gap-1.5">
                                                  <p className="min-w-0 flex-1 truncate text-[10px] font-semibold">
                                                    Edit saved note
                                                  </p>
                                                  <button
                                                    type="button"
                                                    onClick={() => setLayerNoteEditor(null)}
                                                    className="rounded px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-accent"
                                                  >
                                                    Close
                                                  </button>
                                                </div>
                                                <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-1">
                                                  <input
                                                    aria-label="Layer note subject"
                                                    value={layerNoteEditor.subject}
                                                    onChange={(event) =>
                                                      setLayerNoteEditor((current) =>
                                                        current
                                                          ? {
                                                              ...current,
                                                              subject: event.target.value,
                                                            }
                                                          : current,
                                                      )
                                                    }
                                                    className="rounded-lg border border-border px-2 py-1.5 text-[10px] outline-none focus:border-primary"
                                                  />
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setEditingTimestampOpen((current) => !current)
                                                    }
                                                    className={cn(
                                                      "flex size-7 items-center justify-center rounded-lg border border-border hover:bg-accent",
                                                      editingTimestampOpen &&
                                                        "border-primary text-primary",
                                                    )}
                                                    title="Change timestamp"
                                                  >
                                                    <Clock3 className="size-3.5" />
                                                  </button>
                                                </div>
                                                {editingTimestampOpen && (
                                                  <input
                                                    aria-label="Layer note date and time"
                                                    type="datetime-local"
                                                    value={timestampInputValue(
                                                      layerNoteEditor.createdAt,
                                                    )}
                                                    onChange={(event) =>
                                                      setLayerNoteEditor((current) =>
                                                        current
                                                          ? {
                                                              ...current,
                                                              createdAt:
                                                                new Date(
                                                                  event.target.value,
                                                                ).getTime() || current.createdAt,
                                                            }
                                                          : current,
                                                      )
                                                    }
                                                    className="mt-1.5 w-full rounded-lg border border-border px-2 py-1.5 text-[10px]"
                                                  />
                                                )}
                                                <input
                                                  aria-label="Layer note tags"
                                                  value={layerNoteEditorTagText}
                                                  onChange={(event) =>
                                                    setLayerNoteEditorTagText(event.target.value)
                                                  }
                                                  placeholder="Tags — type # for suggestions"
                                                  className="mt-1.5 w-full rounded-lg border border-border px-2 py-1.5 text-[10px] outline-none focus:border-primary"
                                                />
                                                {editorTagSuggestions.length > 0 && (
                                                  <div className="mt-1 flex flex-wrap gap-1">
                                                    {editorTagSuggestions.map((tag) => (
                                                      <button
                                                        key={tag}
                                                        type="button"
                                                        onClick={() =>
                                                          setLayerNoteEditorTagText((current) =>
                                                            applyTagSuggestion(current, tag),
                                                          )
                                                        }
                                                        className="rounded-full bg-secondary px-2 py-0.5 text-[9px] hover:bg-accent"
                                                      >
                                                        #{tag}
                                                      </button>
                                                    ))}
                                                  </div>
                                                )}
                                                <textarea
                                                  aria-label="Layer note"
                                                  value={layerNoteEditor.body}
                                                  onChange={(event) =>
                                                    setLayerNoteEditor((current) =>
                                                      current
                                                        ? { ...current, body: event.target.value }
                                                        : current,
                                                    )
                                                  }
                                                  rows={5}
                                                  className="mt-1.5 w-full resize-y rounded-lg border border-border px-2 py-1.5 text-[10px] leading-relaxed outline-none focus:border-primary"
                                                />
                                                <label className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-secondary px-2 py-1.5 text-[9px] font-semibold">
                                                  <input
                                                    type="checkbox"
                                                    checked={Boolean(layerNoteEditor.pinned)}
                                                    onChange={(event) =>
                                                      setLayerNoteEditor((current) =>
                                                        current
                                                          ? {
                                                              ...current,
                                                              pinned: event.target.checked,
                                                            }
                                                          : current,
                                                      )
                                                    }
                                                    className="accent-primary"
                                                  />
                                                  <Pin className="size-3 text-primary" /> Pin in
                                                  Project Records
                                                </label>
                                                <div
                                                  onDragOver={(event) => event.preventDefault()}
                                                  onDrop={(event) => {
                                                    event.preventDefault();
                                                    void addLayerAttachments(
                                                      layer,
                                                      layerNoteEditor.id,
                                                      event.dataTransfer.files,
                                                    );
                                                  }}
                                                  className="mt-1.5 rounded-lg border border-dashed border-border p-1.5 text-center text-[9px] text-muted-foreground"
                                                >
                                                  Drop attachments or{" "}
                                                  <label className="cursor-pointer font-semibold text-primary hover:underline">
                                                    browse
                                                    <input
                                                      type="file"
                                                      multiple
                                                      className="hidden"
                                                      onChange={(event) => {
                                                        if (event.target.files)
                                                          void addLayerAttachments(
                                                            layer,
                                                            layerNoteEditor.id,
                                                            event.target.files,
                                                          );
                                                        event.currentTarget.value = "";
                                                      }}
                                                    />
                                                  </label>
                                                </div>
                                                {attachmentsForNote(layerNoteEditor.id).length >
                                                  0 && (
                                                  <div className="mt-1.5 space-y-1">
                                                    {attachmentsForNote(layerNoteEditor.id).map(
                                                      (document) => (
                                                        <div
                                                          key={document.id}
                                                          className="flex items-center gap-1.5 rounded-md bg-secondary px-1.5 py-1"
                                                        >
                                                          <FileText className="size-3 shrink-0 text-muted-foreground" />
                                                          <span className="min-w-0 flex-1 truncate text-[9px]">
                                                            {document.name} ·{" "}
                                                            {formatFileSize(document.size)}
                                                          </span>
                                                          <button
                                                            type="button"
                                                            onClick={() =>
                                                              void downloadProjectAsset(document)
                                                            }
                                                            className="rounded p-0.5 hover:bg-accent"
                                                            aria-label={`Download ${document.name}`}
                                                          >
                                                            <Download className="size-2.5" />
                                                          </button>
                                                          <button
                                                            type="button"
                                                            onClick={() =>
                                                              void removeLayerAttachment(
                                                                layer,
                                                                document,
                                                              )
                                                            }
                                                            className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                                                            aria-label={`Remove ${document.name}`}
                                                          >
                                                            <Trash2 className="size-2.5" />
                                                          </button>
                                                        </div>
                                                      ),
                                                    )}
                                                  </div>
                                                )}
                                                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                                  <button
                                                    type="button"
                                                    onClick={saveEditedLayerNote}
                                                    className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[9px] font-semibold text-primary-foreground"
                                                  >
                                                    <Save className="size-3" /> Save changes
                                                  </button>
                                                  <button
                                                    type="button"
                                                    disabled={attachmentBusyFor === layer.id}
                                                    onClick={() =>
                                                      void deleteLayerNote(layer, layerNoteEditor)
                                                    }
                                                    className="ml-auto rounded-lg px-2 py-1 text-[9px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                                  >
                                                    Delete note
                                                  </button>
                                                </div>
                                              </section>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p className="text-[9px] text-muted-foreground">
                                      No saved notes for this layer yet.
                                    </p>
                                  )}
                                </div>
                              </section>
                            )}

                            {exportFor === layer.id && (
                              <div className="grid grid-cols-2 gap-1">
                                {exportFormats.map((f) => (
                                  <button
                                    key={f.id}
                                    onClick={() => {
                                      void exportLayer(layer.data, layer.name, f.id, layer.style)
                                        .then(() => toast.success(`Exported ${f.label}`))
                                        .catch((err: unknown) =>
                                          toast.error(
                                            err instanceof Error ? err.message : "Export failed",
                                          ),
                                        );
                                    }}
                                    className="rounded-lg bg-card px-2 py-1 text-[11px] hover:bg-accent"
                                  >
                                    {f.label}
                                  </button>
                                ))}
                              </div>
                            )}

                            {styleFor === layer.id && <StyleEditor layer={layer} />}

                            <FeatureSublayers layer={layer} onZoom={zoomTo} />
                          </div>
                        )}
                        {layerIndex === layers.length - 1 && (
                          <LayerInsertionLine
                            target={`layer:${layer.id}:after`}
                            active={dropTarget === `layer:${layer.id}:after`}
                            dragging={draggedLayerId !== null}
                            position="after"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {wb.selectedLayerIds.length > 1 && (
          <button
            onClick={() => wb.removeLayers(wb.selectedLayerIds)}
            className="mt-2 w-full rounded-xl bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground"
          >
            Delete {wb.selectedLayerIds.length} selected layers
          </button>
        )}

        <div className="mt-3">
          <button
            onClick={() => fileInput.current?.click()}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-2 py-2 text-center transition-colors",
              dragging ? "border-primary bg-accent" : "border-border hover:border-primary",
            )}
            title="Add GeoJSON, KML, KMZ, zipped Shapefile, GPX, or CSV data"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : (
              <Upload className="size-4 text-primary" />
            )}
            <span className="text-[10px] font-medium">Drop files or click to add data</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={SUPPORTED_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(e) => {
              void handleFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        <p className="mt-4 rounded-xl bg-secondary/60 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          Sketches and measurements are for planning only. They are not a survey and do not
          establish legal boundaries or ownership.
        </p>
      </div>
    </div>
  );
}

interface LayerChildrenTreeProps {
  parentLayerId: string;
  onZoom: (data: GisLayer["data"]) => void;
  draggedLayerId: string | null;
  draggedGroupId: string | null;
  layerDropTarget: string | null;
  groupDropTarget: string | null;
  onLayerPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, layerId: string) => void;
  onLayerPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLayerPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLayerPointerCancel: () => void;
  onGroupPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, groupId: string) => void;
  onGroupPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onGroupPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onGroupPointerCancel: () => void;
}

function LayerChildrenTree({
  parentLayerId,
  onZoom,
  draggedLayerId,
  draggedGroupId,
  layerDropTarget,
  groupDropTarget,
  onLayerPointerDown,
  onLayerPointerMove,
  onLayerPointerUp,
  onLayerPointerCancel,
  onGroupPointerDown,
  onGroupPointerMove,
  onGroupPointerUp,
  onGroupPointerCancel,
}: LayerChildrenTreeProps) {
  const wb = useWorkbench();
  const { setTableOpen } = useMapRef();
  const [expandedLayerIds, setExpandedLayerIds] = useState<Set<string>>(() => new Set());
  const [styleFor, setStyleFor] = useState<string | null>(null);
  const [exportFor, setExportFor] = useState<string | null>(null);
  const [groupStyleFor, setGroupStyleFor] = useState<string | null>(null);
  const [groupMenuFor, setGroupMenuFor] = useState<string | null>(null);
  const [repositoriesOpen, setRepositoriesOpen] = useState(false);
  const container = wb.groups.find((group) => group.containerLayerId === parentLayerId);
  const parentLayer = wb.layers.find((layer) => layer.id === parentLayerId);
  const moveOutGroupId = container?.parentId ?? parentLayer?.groupId;

  const renderLayer = (layer: GisLayer, depth: number, isLast = false): ReactNode => {
    const selected = wb.selectedLayerIds.includes(layer.id);
    const expanded = expandedLayerIds.has(layer.id);
    const hasChildren = wb.groups.some((group) => group.containerLayerId === layer.id);
    return (
      <div
        key={layer.id}
        style={{ marginLeft: depth * 10 }}
        className={cn(
          "relative rounded-lg border px-1 py-1 transition-all",
          selected ? "border-primary bg-accent/60" : "border-border/70 bg-card/70",
          draggedLayerId === layer.id && "opacity-40",
          layerDropTarget === `layer:${layer.id}:before` && "border-primary",
          layerDropTarget === `layer:${layer.id}:inside` &&
            "border-primary bg-primary/10 ring-2 ring-primary/70",
          layerDropTarget === `layer-repository:${layer.id}` &&
            "border-primary bg-primary/10 ring-2 ring-primary/70",
          layerDropTarget === `layer:${layer.id}:after` && "border-primary",
          groupDropTarget === `layer:${layer.id}` &&
            "border-primary bg-primary/10 ring-2 ring-primary/70",
          groupDropTarget === `layer-repository:${layer.id}` &&
            "border-primary bg-primary/10 ring-2 ring-primary/70",
        )}
      >
        <LayerInsertionLine
          target={`layer:${layer.id}:before`}
          active={layerDropTarget === `layer:${layer.id}:before`}
          dragging={draggedLayerId !== null}
          position="before"
        />
        {isLast && (
          <LayerInsertionLine
            target={`layer:${layer.id}:after`}
            active={layerDropTarget === `layer:${layer.id}:after`}
            dragging={draggedLayerId !== null}
            position="after"
          />
        )}
        <div data-layer-drop-id={layer.id} className="flex min-h-7 items-center gap-1">
          <input
            type="checkbox"
            checked={
              selected &&
              layerTreeIds(layer.id, wb.layers, wb.groups).every((id) =>
                wb.selectedLayerIds.includes(id),
              )
            }
            ref={(input) => {
              if (input) {
                const ids = layerTreeIds(layer.id, wb.layers, wb.groups);
                const count = ids.filter((id) => wb.selectedLayerIds.includes(id)).length;
                input.indeterminate = count > 0 && count < ids.length;
              }
            }}
            onChange={() => wb.toggleLayerSelection(layer.id, true)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${layer.name} sublayer`}
            title="Select this layer and all nested layers for batch actions"
            className="size-3 shrink-0 accent-primary"
          />
          <button
            type="button"
            onClick={() =>
              setExpandedLayerIds((current) => {
                const next = new Set(current);
                if (next.has(layer.id)) next.delete(layer.id);
                else next.add(layer.id);
                return next;
              })
            }
            aria-label={expanded ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          <button
            type="button"
            onClick={() => wb.toggleVisible(layer.id)}
            aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-pressed={Boolean(layer.selectionLocked)}
            aria-label={
              (layer.selectionLocked ? "Unlock selection for " : "Lock selection for ") + layer.name
            }
            title={
              layer.selectionLocked
                ? "Selection locked — click to unlock"
                : "Lock selection (keep layer visible)"
            }
            className="rounded p-1 text-primary hover:bg-accent"
            onClick={() => {
              wb.updateLayer(layer.id, { selectionLocked: !layer.selectionLocked });
              if (!layer.selectionLocked)
                wb.setSelectedFeatures(
                  wb.selectedFeatures.filter((item) => item.layerId !== layer.id),
                );
            }}
          >
            {layer.selectionLocked ? (
              <LockKeyhole className="size-3.5" />
            ) : (
              <LockKeyholeOpen className="size-3.5 opacity-50" />
            )}
          </button>
          <LayerStyleSwatch layer={layer} />
          <button
            type="button"
            onClick={(event) => wb.toggleLayerSelection(layer.id, event.metaKey || event.ctrlKey)}
            onDoubleClick={() => {
              const name = window.prompt("Rename sublayer", layer.name)?.trim();
              if (name) wb.updateLayer(layer.id, { name });
            }}
            data-help={layer.name}
            title={`${layer.name} · Double-click to rename`}
            className="min-w-0 flex-1 truncate text-left text-[10px] font-medium"
          >
            {layer.name}
          </button>
          {hasChildren && <Layers className="size-3 shrink-0 text-primary" aria-hidden="true" />}
          <button
            type="button"
            onClick={() => {
              if (layer.style.labelUseLayerName || layer.style.labelTemplate.trim())
                wb.updateStyle(layer.id, { labelEnabled: !layer.style.labelEnabled });
              else setStyleFor(layer.id);
            }}
            aria-label={
              layer.style.labelEnabled ? "Turn sublayer labels off" : "Turn sublayer labels on"
            }
            title={
              layer.style.labelUseLayerName || layer.style.labelTemplate.trim()
                ? "Toggle labels"
                : "Set up labels in Style"
            }
            className={cn(
              "rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
              layer.style.labelEnabled && "bg-primary text-primary-foreground",
            )}
          >
            <Tag className="size-3" />
          </button>
          <button
            type="button"
            onPointerDown={(event) => onLayerPointerDown(event, layer.id)}
            onPointerMove={onLayerPointerMove}
            onPointerUp={onLayerPointerUp}
            onPointerCancel={onLayerPointerCancel}
            aria-label={`Drag ${layer.name} sublayer`}
            title="Drag to a line between layers to reorder, onto another layer to nest, or onto a data group to move"
            className={cn(
              "flex size-6 shrink-0 touch-none select-none items-center justify-center rounded text-muted-foreground hover:bg-accent",
              draggedLayerId === layer.id ? "cursor-grabbing" : "cursor-grab",
            )}
          >
            <GripVertical className="pointer-events-none size-3.5" />
          </button>
        </div>
        {expanded && (
          <div className="mt-1.5 space-y-1.5 border-l border-primary/20 pl-2">
            <p className="num text-[9px] text-muted-foreground">
              {remoteLoadLabel(layer) ?? `${layer.data.features.length.toLocaleString()} features`}
            </p>
            <div className="flex flex-wrap gap-1">
              <IconBtn
                label="Zoom to sublayer"
                onClick={() => onZoom(layer.data)}
                icon={<Crosshair className="size-3" />}
              />
              <IconBtn
                label="Style sublayer"
                onClick={() => setStyleFor(styleFor === layer.id ? null : layer.id)}
                icon={<Palette className="size-3" />}
                active={styleFor === layer.id}
              />
              <IconBtn
                label="Attribute table"
                onClick={() => {
                  wb.setActiveLayer(layer.id);
                  setTableOpen(true);
                }}
                icon={<Table2 className="size-3" />}
              />
              <IconBtn
                label="Export sublayer"
                onClick={() => setExportFor(exportFor === layer.id ? null : layer.id)}
                icon={<Download className="size-3" />}
                active={exportFor === layer.id}
              />
              <IconBtn
                label="Duplicate sublayer"
                onClick={() => wb.duplicateLayer(layer.id, layer.groupId)}
                icon={<Copy className="size-3" />}
              />
              {moveOutGroupId && (
                <IconBtn
                  label="Move out one level"
                  onClick={() => wb.reorderLayer(layer.id, moveOutGroupId)}
                  icon={<ArrowUpFromLine className="size-3" />}
                />
              )}
              <IconBtn
                label="Delete sublayer"
                onClick={() => wb.removeLayers([layer.id])}
                icon={<Trash2 className="size-3" />}
                danger
              />
            </div>
            {exportFor === layer.id && (
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
                {exportFormats.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    onClick={() => {
                      void exportLayer(layer.data, layer.name, format.id, layer.style);
                      setExportFor(null);
                    }}
                    className="rounded-md bg-card px-2 py-1 text-[9px] hover:bg-accent"
                  >
                    {format.label}
                  </button>
                ))}
              </div>
            )}
            {styleFor === layer.id && <StyleEditor layer={layer} />}
            <LayerChildrenTree
              parentLayerId={layer.id}
              onZoom={onZoom}
              draggedLayerId={draggedLayerId}
              draggedGroupId={draggedGroupId}
              layerDropTarget={layerDropTarget}
              groupDropTarget={groupDropTarget}
              onLayerPointerDown={onLayerPointerDown}
              onLayerPointerMove={onLayerPointerMove}
              onLayerPointerUp={onLayerPointerUp}
              onLayerPointerCancel={onLayerPointerCancel}
              onGroupPointerDown={onGroupPointerDown}
              onGroupPointerMove={onGroupPointerMove}
              onGroupPointerUp={onGroupPointerUp}
              onGroupPointerCancel={onGroupPointerCancel}
            />
            <FeatureSublayers layer={layer} onZoom={onZoom} />
          </div>
        )}
      </div>
    );
  };

  const renderLayerList = (siblings: GisLayer[], depth: number): ReactNode =>
    siblings.map((layer, layerIndex) =>
      renderLayer(layer, depth, layerIndex === siblings.length - 1),
    );

  const renderGroup = (group: LayerGroup, depth: number): ReactNode => {
    const groupIds = nestedGroupIds(group.id, wb.groups);
    const groupedLayers = wb.layers.filter((layer) => groupIds.has(layer.groupId));
    const allVisible = groupedLayers.length > 0 && groupedLayers.every((layer) => layer.visible);
    const directGroups = wb.groups.filter(
      (item) => item.parentId === group.id && !item.containerLayerId,
    );
    const directLayers = wb.layers.filter((layer) => layer.groupId === group.id);
    const selected = wb.selectedGroupIds.includes(group.id);
    const renameGroup = () => {
      const name = window.prompt("Rename subgroup", group.name)?.trim();
      if (name) wb.renameGroup(group.id, name);
    };
    return (
      <div
        key={group.id}
        style={{ marginLeft: depth * 10 }}
        className={cn(
          "rounded-lg transition-all",
          selected && "bg-accent ring-1 ring-primary/40",
          draggedGroupId === group.id && "opacity-40",
          groupDropTarget === `${group.id}:inside` && "bg-primary/10 ring-2 ring-primary/70",
          groupDropTarget === `${group.id}:before` && "shadow-[0_-3px_0_0_hsl(var(--primary))]",
          groupDropTarget === `${group.id}:after` && "shadow-[0_3px_0_0_hsl(var(--primary))]",
        )}
      >
        <div
          data-group-drop-id={group.id}
          className="relative flex min-h-7 items-center gap-1 rounded-lg bg-secondary/60 px-1"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => wb.toggleGroupSelection(group.id)}
            aria-label={`Select ${group.name} subgroup`}
            className="size-3 shrink-0 accent-primary"
          />
          <button
            type="button"
            onClick={() => wb.toggleGroup(group.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              renameGroup();
            }}
            title={`${group.name} · Double-click to rename`}
            className="flex min-w-0 flex-1 items-center gap-1 text-left text-[10px] font-semibold"
          >
            {group.collapsed ? (
              <ChevronRight className="size-3 shrink-0" />
            ) : (
              <ChevronDown className="size-3 shrink-0" />
            )}
            <Layers className="size-3 shrink-0 text-primary" />
            <span className="truncate">{group.name}</span>
            <span className="num ml-auto text-[9px] text-muted-foreground">
              {groupedLayers.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => wb.setGroupVisible(group.id, !allVisible)}
            aria-label={allVisible ? `Hide ${group.name}` : `Show ${group.name}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            {allVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setGroupMenuFor(groupMenuFor === group.id ? null : group.id)}
            aria-label={`Open actions for ${group.name}`}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {groupMenuFor === group.id && (
            <div className="absolute right-7 top-7 z-40 w-40 rounded-xl border border-border bg-popover p-1 text-[10px] text-popover-foreground shadow-xl">
              <button
                type="button"
                onClick={() => {
                  renameGroup();
                  setGroupMenuFor(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent"
              >
                <Pencil className="size-3" /> Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  setGroupStyleFor(groupStyleFor === group.id ? null : group.id);
                  setGroupMenuFor(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent"
              >
                <Palette className="size-3" /> Style all layers
              </button>
              <button
                type="button"
                onClick={() => {
                  const name = window
                    .prompt(`Name a subgroup inside ${group.name}`, "New subgroup")
                    ?.trim();
                  if (name) wb.addSubgroup(group.id, name);
                  setGroupMenuFor(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent"
              >
                <FolderPlus className="size-3" /> Add subgroup
              </button>
              {moveOutGroupId && (
                <button
                  type="button"
                  onClick={() => {
                    wb.reorderGroup(group.id, moveOutGroupId, "inside");
                    setGroupMenuFor(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent"
                >
                  <ArrowUpFromLine className="size-3" /> Move out one level
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(`Delete the “${group.name}” subgroup? Its layers will be kept.`)
                  )
                    wb.removeGroup(group.id);
                  setGroupMenuFor(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3" /> Delete subgroup
              </button>
            </div>
          )}
          <button
            type="button"
            onPointerDown={(event) => onGroupPointerDown(event, group.id)}
            onPointerMove={onGroupPointerMove}
            onPointerUp={onGroupPointerUp}
            onPointerCancel={onGroupPointerCancel}
            aria-label={`Drag ${group.name} subgroup`}
            title="Drag this subgroup onto a layer, another group, or a data group"
            className={cn(
              "flex size-6 shrink-0 touch-none select-none items-center justify-center rounded text-muted-foreground hover:bg-accent",
              draggedGroupId === group.id ? "cursor-grabbing" : "cursor-grab",
            )}
          >
            <GripVertical className="pointer-events-none size-3.5" />
          </button>
        </div>
        {groupStyleFor === group.id && <GroupStyleEditor group={group} layers={groupedLayers} />}
        {!group.collapsed && (
          <div className="mt-1 space-y-1 border-l border-primary/20 pl-1">
            {renderLayerList(directLayers, depth + 1)}
            {directGroups.map((child) => renderGroup(child, depth + 1))}
            {directGroups.length === 0 && directLayers.length === 0 && (
              <p className="px-2 py-1 text-[9px] text-muted-foreground">Nothing here yet</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const directGroups = container
    ? wb.groups.filter((group) => group.parentId === container.id && !group.containerLayerId)
    : [];
  const directLayers = container ? wb.layers.filter((layer) => layer.groupId === container.id) : [];

  return (
    <section
      className={cn(
        "space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 p-1.5 transition-colors",
        (layerDropTarget === `layer-repository:${parentLayerId}` ||
          groupDropTarget === `layer-repository:${parentLayerId}`) &&
          "border-primary bg-primary/10 ring-1 ring-primary/60",
      )}
    >
      <button
        type="button"
        data-layer-sublayer-drop-id={parentLayerId}
        data-group-sublayer-drop-id={parentLayerId}
        onClick={() => setRepositoriesOpen((open) => !open)}
        aria-expanded={repositoriesOpen}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[9px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        title={`${repositoriesOpen ? "Collapse" : "Expand"} layer and group sublayers`}
      >
        {repositoriesOpen ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <Layers className="size-3 shrink-0 text-primary" /> Layer &amp; group sublayers
        <span className="num ml-auto">{directLayers.length + directGroups.length}</span>
      </button>

      {repositoriesOpen && (
        <div className="space-y-1.5">
          <div className="space-y-1 rounded-md border border-border/70 bg-card/50 p-1">
            <p className="flex items-center gap-1 px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="size-3 text-primary" /> Layer sublayers
              <span className="num ml-auto">{directLayers.length}</span>
            </p>
            {renderLayerList(directLayers, 0)}
            <div
              data-layer-sublayer-drop-id={parentLayerId}
              className={cn(
                "rounded-md border border-dashed px-2 py-1.5 text-center text-[9px] text-muted-foreground transition-colors",
                layerDropTarget === `layer-repository:${parentLayerId}`
                  ? "border-primary bg-primary/15 font-semibold text-primary"
                  : "border-primary/30 bg-background/50",
              )}
            >
              Drop a layer here
            </div>
          </div>

          <div className="space-y-1 rounded-md border border-border/70 bg-card/50 p-1">
            <p className="flex items-center gap-1 px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              <FolderPlus className="size-3 text-primary" /> Group sublayers
              <span className="num ml-auto">{directGroups.length}</span>
            </p>
            {directGroups.map((group) => renderGroup(group, 0))}
            <div
              data-group-sublayer-drop-id={parentLayerId}
              className={cn(
                "rounded-md border border-dashed px-2 py-1.5 text-center text-[9px] text-muted-foreground transition-colors",
                groupDropTarget === `layer-repository:${parentLayerId}`
                  ? "border-primary bg-primary/15 font-semibold text-primary"
                  : "border-primary/30 bg-background/50",
              )}
            >
              Drop a group here
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function featureDisplayName(layer: GisLayer, index: number): string {
  const properties = layer.data.features[index]?.properties ?? {};
  const preferred = ["NAME", "name", "LABEL", "label", "OWNER", "owner", "ID", "id"];
  const key = preferred.find((field) => properties[field] !== undefined);
  return key ? String(properties[key]) : `Feature ${index + 1}`;
}

function transferableFeature(feature: Feature): Feature {
  const copy = JSON.parse(JSON.stringify(feature)) as Feature;
  const properties = { ...(copy.properties ?? {}) };
  delete properties["__hidden"];
  return { ...copy, properties };
}

function FeatureSublayers({
  layer,
  onZoom,
}: {
  layer: GisLayer;
  onZoom: (data: GisLayer["data"]) => void;
}) {
  const wb = useWorkbench();
  const [query, setQuery] = useState("");
  const [targetLayerId, setTargetLayerId] = useState("__new__");
  const normalizedQuery = query.trim().toLowerCase();
  const matches = layer.data.features
    .map((feature, index) => ({ feature, index, name: featureDisplayName(layer, index) }))
    .filter(({ feature, name }) => {
      if (!normalizedQuery) return true;
      return `${name} ${JSON.stringify(feature.properties ?? {})}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  const visible = matches.slice(0, 100);
  const checkedIndexes = new Set(
    wb.selectedFeatures
      .filter((selection) => selection.layerId === layer.id)
      .map((selection) => selection.index),
  );
  const targetLayers = wb.layers.filter(
    (candidate) => candidate.id !== layer.id && candidate.source.kind !== "remote",
  );

  const setCheckedIndexes = (indexes: Iterable<number>) => {
    const otherSelections = wb.selectedFeatures.filter(
      (selection) => selection.layerId !== layer.id,
    );
    const layerSelections = Array.from(new Set(indexes))
      .filter((index) => layer.data.features[index])
      .sort((a, b) => a - b)
      .map((index) => ({ layerId: layer.id, index }));
    wb.setSelectedFeatures([...otherSelections, ...layerSelections]);
    wb.setActiveLayer(layer.id);
  };

  const transferChecked = (mode: "copy" | "move") => {
    const indexes = Array.from(checkedIndexes).sort((a, b) => a - b);
    const features = indexes
      .map((index) => layer.data.features[index])
      .filter((feature): feature is Feature => Boolean(feature))
      .map(transferableFeature);
    if (!features.length) return;

    let destinationId = targetLayerId;
    let firstDestinationIndex = 0;
    if (targetLayerId === "__new__") {
      const suggestedName = `${layer.name} selection`;
      const name = window.prompt("Name the new main layer", suggestedName)?.trim();
      if (!name) return;
      const created = wb.addLayer({
        name,
        data: { type: "FeatureCollection", features },
        groupId: wb.derivedLayerGroupId,
        source: {
          kind: "derived",
          sourceLayerId: layer.id,
          query: `${mode === "move" ? "Moved" : "Copied"} checked feature sublayers`,
        },
      });
      destinationId = created.id;
    } else {
      const destination = targetLayers.find((candidate) => candidate.id === targetLayerId);
      if (!destination) return;
      firstDestinationIndex = destination.data.features.length;
      wb.updateLayer(destination.id, {
        data: {
          ...destination.data,
          features: [...destination.data.features, ...features],
        },
      });
    }

    if (mode === "move") {
      if (layer.source.kind === "remote") {
        const moving = new Set(indexes);
        wb.updateLayer(layer.id, {
          data: {
            ...layer.data,
            features: layer.data.features.map((feature, index) =>
              moving.has(index)
                ? {
                    ...feature,
                    properties: { ...(feature.properties ?? {}), __hidden: true },
                  }
                : feature,
            ),
          },
        });
      } else wb.removeFeatures(layer.id, indexes);
    }

    wb.setSelectedFeatures(
      features.map((_, index) => ({
        layerId: destinationId,
        index: firstDestinationIndex + index,
      })),
    );
    wb.setActiveLayer(destinationId);
    const destinationName =
      targetLayerId === "__new__"
        ? "a new main layer"
        : (targetLayers.find((candidate) => candidate.id === destinationId)?.name ?? "the layer");
    toast.success(
      `${features.length} feature${features.length === 1 ? "" : "s"} ${mode === "move" ? "moved" : "copied"}`,
      { description: `Added to ${destinationName}.` },
    );
  };

  const removeChecked = () => {
    const indexes = Array.from(checkedIndexes).sort((a, b) => a - b);
    if (!indexes.length) return;
    const action = layer.source.kind === "remote" ? "hide" : "remove";
    if (
      !window.confirm(
        `${action === "hide" ? "Hide" : "Remove"} ${indexes.length} checked feature${indexes.length === 1 ? "" : "s"}?`,
      )
    )
      return;
    if (layer.source.kind === "remote") {
      const removing = new Set(indexes);
      wb.updateLayer(layer.id, {
        data: {
          ...layer.data,
          features: layer.data.features.map((feature, index) =>
            removing.has(index)
              ? {
                  ...feature,
                  properties: { ...(feature.properties ?? {}), __hidden: true },
                }
              : feature,
          ),
        },
      });
    } else wb.removeFeatures(layer.id, indexes);
    setCheckedIndexes([]);
  };

  return (
    <details className="group rounded-lg border border-border bg-card/70">
      <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1.5 text-[10px] font-semibold">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        Feature sublayers ({layer.data.features.length})
      </summary>
      <div className="space-y-2 border-t border-border p-2">
        {layer.source.kind === "remote" && (
          <RemoteLayerSettings layerId={layer.id} source={layer.source} />
        )}
        <label className="relative block">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a feature or attribute"
            className="w-full rounded-lg border border-border bg-secondary py-1.5 pl-7 pr-2 text-[10px] outline-none focus:border-primary"
          />
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setCheckedIndexes([...checkedIndexes, ...visible.map(({ index }) => index)])
            }
            className="rounded-lg bg-secondary px-2 py-1 text-[9px] font-semibold hover:bg-accent"
          >
            Select shown
          </button>
          <button
            type="button"
            onClick={() => setCheckedIndexes([])}
            disabled={checkedIndexes.size === 0}
            className="rounded-lg px-2 py-1 text-[9px] font-semibold text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            Clear
          </button>
          <span className="num ml-auto text-[9px] text-muted-foreground">
            {checkedIndexes.size} checked
          </span>
        </div>
        {checkedIndexes.size > 0 && (
          <div className="space-y-1 rounded-xl border border-primary/30 bg-primary/5 p-2">
            <label className="block text-[9px] font-semibold text-muted-foreground">
              Destination main layer
              <select
                value={targetLayerId}
                onChange={(event) => setTargetLayerId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[10px] text-foreground"
              >
                <option value="__new__">+ New layer in default category</option>
                {targetLayers.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => transferChecked("copy")}
                className="rounded-lg bg-primary px-1.5 py-1.5 text-[9px] font-semibold text-primary-foreground"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => transferChecked("move")}
                className="rounded-lg bg-secondary px-1.5 py-1.5 text-[9px] font-semibold hover:bg-accent"
              >
                Move
              </button>
              <button
                type="button"
                onClick={() =>
                  onZoom({
                    type: "FeatureCollection",
                    features: Array.from(checkedIndexes)
                      .map((index) => layer.data.features[index])
                      .filter((feature): feature is Feature => Boolean(feature)),
                  })
                }
                className="rounded-lg bg-secondary px-1.5 py-1.5 text-[9px] font-semibold hover:bg-accent"
              >
                Zoom
              </button>
              <button
                type="button"
                onClick={removeChecked}
                className="rounded-lg px-1.5 py-1.5 text-[9px] font-semibold text-destructive hover:bg-destructive/10"
              >
                {layer.source.kind === "remote" ? "Hide" : "Remove"}
              </button>
            </div>
          </div>
        )}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {visible.map(({ feature, index, name }) => {
            const hidden = feature.properties?.["__hidden"] === true;
            const selected = wb.selectedFeatures.some(
              (selection) => selection.layerId === layer.id && selection.index === index,
            );
            return (
              <div
                key={`${index}-${name}`}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-1.5 py-1",
                  selected ? "border-primary bg-accent" : "border-transparent bg-secondary/50",
                )}
              >
                <input
                  type="checkbox"
                  checked={checkedIndexes.has(index)}
                  onChange={(event) => {
                    const next = new Set(checkedIndexes);
                    if (event.target.checked) next.add(index);
                    else next.delete(index);
                    setCheckedIndexes(next);
                  }}
                  aria-label={`Select ${name} for batch actions`}
                  className="size-3 shrink-0 accent-primary"
                />
                <button
                  onClick={() => wb.updateFeatureProperties(layer.id, index, { __hidden: !hidden })}
                  title={hidden ? "Show feature" : "Hide feature"}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </button>
                <button
                  onClick={() => {
                    wb.setActiveLayer(layer.id);
                    wb.setSelectedFeatures([{ layerId: layer.id, index }]);
                    onZoom({ type: "FeatureCollection", features: [feature] });
                  }}
                  className="min-w-0 flex-1 truncate text-left text-[10px]"
                  title={name}
                >
                  {name}
                </button>
                <button
                  onClick={() => {
                    const next = window.prompt("Rename feature", name)?.trim();
                    if (next) wb.updateFeatureProperties(layer.id, index, { NAME: next });
                  }}
                  title="Rename feature"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  onClick={() => {
                    if (layer.source.kind === "remote")
                      wb.updateFeatureProperties(layer.id, index, { __hidden: true });
                    else wb.removeFeatures(layer.id, [index]);
                  }}
                  title={
                    layer.source.kind === "remote"
                      ? "Hide public feature locally"
                      : "Delete feature"
                  }
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            );
          })}
          {visible.length === 0 && (
            <p className="py-2 text-center text-[10px] text-muted-foreground">
              No matching features
            </p>
          )}
        </div>
        {matches.length > visible.length && (
          <p className="text-[9px] text-muted-foreground">
            Showing the first 100 matches. Search to narrow this list.
          </p>
        )}
      </div>
    </details>
  );
}

function nestedGroupIds(groupId: string, groups: LayerGroup[]): Set<string> {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    groups.forEach((group) => {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    });
  }
  return ids;
}

function nestedLayerIds(layerId: string, groups: LayerGroup[], layers: GisLayer[]): Set<string> {
  const ids = new Set([layerId]);
  const container = groups.find((group) => group.containerLayerId === layerId);
  if (!container) return ids;
  const childGroupIds = nestedGroupIds(container.id, groups);
  for (const layer of layers) if (childGroupIds.has(layer.groupId)) ids.add(layer.id);
  return ids;
}

function flattenVisibleGroups(groups: LayerGroup[]): Array<{ group: LayerGroup; depth: number }> {
  const result: Array<{ group: LayerGroup; depth: number }> = [];
  const uniqueGroups = groups.filter(
    (group, index) => groups.findIndex((candidate) => candidate.id === group.id) === index,
  );
  const containerIds = new Set(
    uniqueGroups.filter((group) => group.containerLayerId).map((group) => group.id),
  );
  const belongsToLayerContainer = (group: LayerGroup) => {
    const visited = new Set<string>();
    let parentId = group.parentId;
    while (parentId && !visited.has(parentId)) {
      if (containerIds.has(parentId)) return true;
      visited.add(parentId);
      parentId = uniqueGroups.find((candidate) => candidate.id === parentId)?.parentId;
    }
    return false;
  };
  const reachable = new Set<string>();
  const visit = (group: LayerGroup, depth: number, hiddenByCollapsedParent = false) => {
    if (reachable.has(group.id) || group.containerLayerId || belongsToLayerContainer(group)) return;
    reachable.add(group.id);
    if (!hiddenByCollapsedParent) result.push({ group, depth });
    const hideChildren = hiddenByCollapsedParent || group.collapsed;
    uniqueGroups
      .filter((item) => item.parentId === group.id)
      .forEach((item) => visit(item, depth + 1, hideChildren));
  };
  uniqueGroups
    .filter(
      (group) =>
        !group.containerLayerId &&
        !belongsToLayerContainer(group) &&
        (!group.parentId || !uniqueGroups.some((candidate) => candidate.id === group.parentId)),
    )
    .forEach((group) => visit(group, 0));
  // Any remaining group belongs to malformed legacy cyclic data. Render it once as a root;
  // `reachable` prevents the cycle from ever repeating in the visible tree.
  uniqueGroups
    .filter(
      (group) =>
        !reachable.has(group.id) && !group.containerLayerId && !belongsToLayerContainer(group),
    )
    .forEach((group) => visit(group, 0));
  return result;
}

function GroupStyleEditor({ group, layers }: { group: LayerGroup; layers: GisLayer[] }) {
  const wb = useWorkbench();
  const style = layers[0]?.style;
  if (!style)
    return (
      <p className="mx-2 mb-1 rounded-lg bg-secondary px-2 py-1.5 text-[10px] text-muted-foreground">
        Add a layer to this group before applying a shared style.
      </p>
    );
  return (
    <div className="mx-2 mb-2 space-y-2 rounded-xl border border-border bg-secondary/60 p-2">
      <p className="text-[10px] font-semibold">
        Apply to {layers.length} layer{layers.length === 1 ? "" : "s"}
      </p>
      <label className="block text-[10px] text-muted-foreground">
        Layer opacity {Math.round(layerOpacity(style) * 100)}%
        <input
          aria-label="Every layer opacity"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={layerOpacity(style)}
          onChange={(event) =>
            wb.applyStyleToGroup(group.id, { opacity: Number(event.target.value) })
          }
          className="w-full accent-primary"
        />
      </label>
      <p className="text-[9px] text-muted-foreground">
        Layer opacity affects fills, lines, icons and labels, including colors by attribute. Fill
        opacity below only affects filled areas.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-muted-foreground">
          Fill
          <input
            type="color"
            value={style.fillColor}
            onChange={(event) => wb.applyStyleToGroup(group.id, { fillColor: event.target.value })}
            className="mt-0.5 h-7 w-full rounded border border-border bg-card"
          />
        </label>
        <label className="text-[10px] text-muted-foreground">
          Stroke
          <input
            type="color"
            value={style.strokeColor}
            onChange={(event) =>
              wb.applyStyleToGroup(group.id, { strokeColor: event.target.value })
            }
            className="mt-0.5 h-7 w-full rounded border border-border bg-card"
          />
        </label>
      </div>
      <label className="block text-[10px] text-muted-foreground">
        Fill opacity {Math.round(style.fillOpacity * 100)}%
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={style.fillOpacity}
          onChange={(event) =>
            wb.applyStyleToGroup(group.id, { fillOpacity: Number(event.target.value) })
          }
          className="w-full accent-primary"
        />
      </label>
      <div className="grid grid-cols-3 gap-1">
        {(["solid", "dashed", "dotted"] as StrokePattern[]).map((pattern) => (
          <button
            key={pattern}
            onClick={() => wb.applyStyleToGroup(group.id, { strokePattern: pattern })}
            className={cn(
              "rounded border px-1 py-1 text-[10px] capitalize",
              style.strokePattern === pattern
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card",
            )}
          >
            {pattern}
          </button>
        ))}
      </div>
      <GroupLabelStyleEditor
        layers={layers}
        onChange={(patch) => wb.applyStyleToGroup(group.id, patch)}
      />
    </div>
  );
}

function LayerStyleSwatch({ layer }: { layer: GisLayer }) {
  const fillPattern = layer.style.fillPattern as FillPattern;
  const strokePattern = (layer.style.strokePattern ?? "solid") as StrokePattern;
  const fill = layer.style.fillColor;
  const hasFill = layer.style.fillOpacity > 0;
  const features = Array.isArray(layer.data?.features) ? layer.data.features : [];
  const usableFeatures = features.filter((feature) => featureGeometryType(feature) !== null);
  const pointFeatures = usableFeatures.filter((feature) =>
    /Point$/i.test(featureGeometryType(feature) ?? ""),
  );
  const pointOnly = pointFeatures.length > 0 && pointFeatures.length === usableFeatures.length;
  const categorizedIcon =
    layer.style.categorizedIcons?.enabled && layer.style.categorizedIcons.field
      ? layer.style.categorizedIcons.fallbackIcon
      : "";
  const featureIcon = String(pointFeatures[0]?.properties?.["MARKER_ICON"] ?? "");
  const pointIcon = categorizedIcon || layer.style.pointIcon || featureIcon;
  const pointIconColor = layer.style.pointIconColor ?? fill;
  const backgroundImage = !hasFill
    ? undefined
    : fillPattern === "diagonal"
      ? `repeating-linear-gradient(135deg, transparent 0 3px, ${fill} 3px 5px)`
      : fillPattern === "horizontal"
        ? `repeating-linear-gradient(0deg, transparent 0 3px, ${fill} 3px 5px)`
        : fillPattern === "vertical"
          ? `repeating-linear-gradient(90deg, transparent 0 3px, ${fill} 3px 5px)`
          : fillPattern === "crosshatch"
            ? `repeating-linear-gradient(45deg, transparent 0 4px, ${fill} 4px 5px), repeating-linear-gradient(-45deg, transparent 0 4px, ${fill} 4px 5px)`
            : fillPattern === "dotted"
              ? `radial-gradient(circle, ${fill} 1.5px, transparent 1.7px)`
              : undefined;
  if (pointOnly && pointIcon)
    return (
      <span
        className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded bg-card font-semibold leading-none"
        aria-label={`${pointIcon} point icon`}
        title={`${pointIcon} point icon · ${layer.style.pointIconSize ?? 18}px`}
        style={{
          color: pointIconColor,
          fontSize: Math.max(11, Math.min(18, (layer.style.pointIconSize ?? 18) * 0.72)),
          opacity: (layer.style.pointIconOpacity ?? 1) * layerOpacity(layer.style),
        }}
      >
        {pointIcon}
      </span>
    );
  return (
    <span
      className="size-5 shrink-0 rounded bg-card"
      aria-label={`${hasFill ? fillPattern : "transparent"} fill with ${strokePattern} stroke`}
      title={`${hasFill ? fillPattern : "transparent"} fill · ${strokePattern} stroke`}
      style={{
        backgroundColor: !hasFill ? "transparent" : fillPattern === "solid" ? fill : `${fill}33`,
        backgroundImage,
        backgroundSize: fillPattern === "dotted" ? "6px 6px" : undefined,
        borderColor: layer.style.strokeColor,
        borderWidth: Math.max(1, Math.min(3, layer.style.strokeWidth)),
        borderStyle: strokePattern,
        opacity: (hasFill ? layer.style.fillOpacity : 1) * layerOpacity(layer.style),
      }}
    />
  );
}

function RemoteLayerSettings({
  layerId,
  source,
}: {
  layerId: string;
  source: Extract<LayerSource, { kind: "remote" }>;
}) {
  const wb = useWorkbench();
  return (
    <div className="space-y-1 rounded-lg bg-card p-2 text-[10px] text-muted-foreground">
      <p>
        Public data · {source.attribution ?? "official service"}
        {source.requiresViewport ? " · current view only" : ""}
      </p>
      {source.loadStatus === "zoom-in" && (
        <p className="text-amber-700">
          {source.expectedFeatures?.toLocaleString() ?? "Too many"} features are in this view. Zoom
          in once to load the complete visible set.
        </p>
      )}
      {source.loadStatus === "error" && source.loadError && (
        <p className="text-destructive">{source.loadError}</p>
      )}
      <label className="flex items-center gap-2">
        Auto refresh
        <select
          value={source.refreshMinutes ?? 0}
          onChange={(event) => {
            const minutes = Number(event.target.value);
            const nextSource = { ...source };
            delete nextSource.refreshMinutes;
            wb.updateLayer(layerId, {
              source: minutes ? { ...nextSource, refreshMinutes: minutes } : nextSource,
            });
          }}
          className="ml-auto rounded border border-border bg-secondary px-1 py-0.5 text-[10px]"
        >
          <option value={0}>Off</option>
          <option value={5}>5 min</option>
          <option value={15}>15 min</option>
          <option value={60}>Hourly</option>
        </select>
      </label>
      <button
        type="button"
        disabled={source.loading}
        onClick={() =>
          wb.updateDisplayLayer(layerId, {
            source: { ...source, refreshToken: (source.refreshToken ?? 0) + 1 },
          })
        }
        className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50"
      >
        {source.loading ? "Loading visible area…" : "Reload visible area"}
      </button>
      {source.loadedFeatures !== undefined && (
        <p>{source.loadedFeatures.toLocaleString()} features downloaded for this area</p>
      )}
      {source.lastRefreshedAt && (
        <p>Updated {new Date(source.lastRefreshedAt).toLocaleTimeString()}</p>
      )}
      {source.catalogId === "tx-parcels" && <ParcelCacheControls />}
    </div>
  );
}

function IconBtn({
  label,
  icon,
  onClick,
  active,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-accent hover:text-accent-foreground",
        active && "border-primary bg-primary text-primary-foreground",
        danger && "text-destructive hover:bg-destructive hover:text-destructive-foreground",
      )}
    >
      {icon}
    </button>
  );
}
