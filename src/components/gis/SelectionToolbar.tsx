import { DockableBar } from "./DockableBar";
import { useMemo, useRef, useState } from "react";
import {
  CopyPlus,
  Database,
  FileUp,
  GitBranchPlus,
  ListPlus,
  ListTree,
  MapPinPlus,
  Minus,
  Pentagon,
  Pencil,
  Palette,
  Table2,
  X,
  NotebookPen,
} from "lucide-react";
import { toast } from "sonner";

import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { cn } from "@/lib/utils";
import { markerIcons } from "@/lib/gis/markerIcons";

function featureName(properties: Record<string, unknown>, fallback: string): string {
  for (const key of ["NAME", "name", "OWNER_NAME", "owner_name", "Prop_ID", "GEO_ID"]) {
    const value = properties[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return fallback;
}

export function SelectionToolbar({ mobile = false }: { mobile?: boolean }) {
  const wb = useWorkbench();
  const {
    setTableOpen,
    setDrawerOpen,
    setPendingCatalogQuery,
    setPendingFeatureSave,
    editEnabled,
    setEditEnabled,
    setRecordsOpen,
    setRecordsTargetNoteId,
  } = useMapRef();
  const [showField, setShowField] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [showMarkerStyle, setShowMarkerStyle] = useState(false);
  const [markerIcon, setMarkerIcon] = useState("●");
  const [markerColor, setMarkerColor] = useState("#2f7d4f");
  const [markerSize, setMarkerSize] = useState(18);
  const [useLayerColor, setUseLayerColor] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () =>
      wb.selectedFeatures.flatMap((selection) => {
        const layer = wb.displayLayers.find((item) => item.id === selection.layerId);
        const feature = layer?.data.features[selection.index];
        return layer && feature ? [{ selection, layer, feature }] : [];
      }),
    [wb.displayLayers, wb.selectedFeatures],
  );
  const first = selected[0];
  if (!first || !wb.canEditProject) return null;

  const preview = Object.entries(first.feature.properties ?? {})
    .filter(([key]) => !key.startsWith("__") && key !== "ATTACHMENTS")
    .slice(0, 4);
  const pointSelections = selected.filter(({ feature }) => feature.geometry.type === "Point");
  const mapNoteId = first.feature.properties?.["NOTE_ID"];

  const createCombinedLayer = () => {
    setPendingFeatureSave({
      features: selected.map(({ feature }) => structuredClone(feature)),
      suggestedLayerName: `${first.layer.name} · ${selected.length} selected`,
      ...(selected.length === 1
        ? {
            suggestedFeatureName: featureName(
              (first.feature.properties ?? {}) as Record<string, unknown>,
              "Selected feature",
            ),
          }
        : {}),
      defaultGroupId: wb.derivedLayerGroupId,
      source: {
        kind: "derived",
        sourceLayerId: first.layer.id,
        query: `${selected.length} selected features`,
      },
      style: first.layer.style,
    });
    wb.setSelectedFeatures([]);
  };

  const createSeparateLayers = () => {
    if (selected.length > 25) {
      toast.error("Select 25 or fewer features to create one layer per feature");
      return;
    }
    setPendingFeatureSave({
      features: selected.map(({ feature }, index) => {
        const copy = structuredClone(feature);
        copy.properties = {
          ...(copy.properties ?? {}),
          NAME: featureName(
            (copy.properties ?? {}) as Record<string, unknown>,
            `${first.layer.name} · feature ${index + 1}`,
          ),
        };
        return copy;
      }),
      suggestedLayerName: first.layer.name,
      defaultGroupId: wb.derivedLayerGroupId,
      source: { kind: "derived", sourceLayerId: first.layer.id, query: "Selected feature" },
      style: first.layer.style,
      separate: true,
    });
    wb.setSelectedFeatures([]);
  };

  const addField = () => {
    const key = fieldName.trim();
    if (!key) {
      toast.error("Enter a field name");
      return;
    }
    for (const { selection } of selected) {
      wb.updateFeatureProperties(selection.layerId, selection.index, { [key]: fieldValue });
    }
    toast.success(`${key} added to ${selected.length} feature${selected.length === 1 ? "" : "s"}`);
    setFieldName("");
    setFieldValue("");
    setShowField(false);
  };

  const applyMarkerStyle = () => {
    for (const { selection } of pointSelections)
      wb.updateFeatureProperties(selection.layerId, selection.index, {
        MARKER_ICON: markerIcon,
        MARKER_COLOR: useLayerColor ? null : markerColor,
        MARKER_SIZE: markerSize,
      });
    wb.addProjectEvent({
      type: "map",
      title: `Styled ${pointSelections.length} marker${pointSelections.length === 1 ? "" : "s"}`,
      detail: `${markerIcon} · ${markerSize}px${useLayerColor ? " · layer fill color" : ""}`,
    });
    setShowMarkerStyle(false);
    toast.success("Marker style applied");
  };

  const attachFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Attachments must be 2 MB or smaller");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    for (const { selection, feature } of selected) {
      const current = (feature.properties ?? {})["ATTACHMENTS"];
      const attachments = Array.isArray(current) ? current : [];
      wb.updateFeatureProperties(selection.layerId, selection.index, {
        ATTACHMENTS: [
          ...attachments,
          {
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            dataUrl,
            addedAt: new Date().toISOString(),
          },
        ],
      });
    }
    toast.success(
      `${file.name} attached to ${selected.length} feature${selected.length === 1 ? "" : "s"}`,
    );
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <DockableBar
      label="selection actions"
      centered
      enabled={false}
      className={cn(
        "panel-surface pointer-events-auto absolute left-1/2 z-[60] w-[min(94vw,760px)] rounded-2xl p-2 shadow-float",
        mobile
          ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-h-[45dvh] overflow-y-auto"
          : "bottom-4",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 px-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
              {selected.length} selected
            </span>
            <span className="truncate text-xs font-semibold">{first.layer.name}</span>
          </div>
          <div className="mt-1 flex gap-x-3 overflow-hidden text-[10px] text-muted-foreground">
            {preview.map(([key, value]) => (
              <span key={key} className="max-w-40 truncate">
                <strong>{key}:</strong>{" "}
                {typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => wb.setSelectedFeatures([])}
          className="rounded-lg p-1.5 hover:bg-accent"
          aria-label="Clear feature selection"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
        <Action
          icon={<CopyPlus />}
          label={selected.length > 1 ? "New layer from selection" : "New layer"}
          onClick={createCombinedLayer}
        />
        {typeof mapNoteId === "string" && mapNoteId && (
          <Action
            icon={<NotebookPen />}
            label="Open note"
            onClick={() => {
              setRecordsTargetNoteId(mapNoteId);
              setRecordsOpen(true);
            }}
          />
        )}
        <Action
          icon={<ListTree />}
          label="Full attributes"
          onClick={() => window.dispatchEvent(new Event("landdraft:open-feature-attributes"))}
        />
        <Action
          icon={<Table2 />}
          label="Layer table"
          onClick={() => {
            wb.setActiveLayer(first.layer.id);
            setTableOpen(true);
          }}
        />

        {selected.length === 1 &&
          first.layer.source.kind !== "remote" &&
          first.layer.source.kind !== "image" && (
            <Action
              icon={<Pencil />}
              label={editEnabled ? "Finish editing" : "Edit vertices"}
              onClick={() => {
                wb.setDrawMode("none");
                setEditEnabled(!editEnabled);
              }}
              active={editEnabled}
            />
          )}
        {selected.length > 1 && (
          <Action icon={<GitBranchPlus />} label="Split layers" onClick={createSeparateLayers} />
        )}
        <Action
          icon={<ListPlus />}
          label="Add field"
          onClick={() => setShowField((value) => !value)}
        />
        <Action icon={<FileUp />} label="Attach file" onClick={() => fileRef.current?.click()} />
        {pointSelections.length > 0 && (
          <Action
            icon={<Palette />}
            label="Marker style"
            onClick={() => {
              setShowMarkerStyle((value) => !value);
              setShowField(false);
            }}
          />
        )}
        <Action
          icon={<Database />}
          label="Find data"
          onClick={() => {
            setPendingCatalogQuery(first.layer.name);
            setDrawerOpen(true);
          }}
        />
        <Action icon={<Pentagon />} label="Draw area" onClick={() => wb.setDrawMode("polygon")} />
        <Action icon={<Minus />} label="Draw line" onClick={() => wb.setDrawMode("line")} />
        <Action icon={<MapPinPlus />} label="Add point" onClick={() => wb.setDrawMode("point")} />
      </div>

      {showField && (
        <div className="mt-2 flex gap-1 border-t border-border pt-2">
          <input
            value={fieldName}
            onChange={(event) => setFieldName(event.target.value)}
            placeholder="Field name"
            aria-label="New attribute field name"
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
          <input
            value={fieldValue}
            onChange={(event) => setFieldValue(event.target.value)}
            placeholder="Value"
            aria-label="New attribute value"
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
          <button
            onClick={addField}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Apply
          </button>
        </div>
      )}
      {showMarkerStyle && (
        <div className="mt-2 grid gap-2 border-t border-border pt-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <select
            value={markerIcon}
            onChange={(event) => setMarkerIcon(event.target.value)}
            aria-label="Marker icon"
            className="min-w-0 rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
          >
            {markerIcons.map((icon) => (
              <option key={icon.id} value={icon.symbol}>
                {icon.symbol} {icon.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 rounded-lg border border-border px-2 text-[10px]">
            <input
              type="checkbox"
              checked={useLayerColor}
              onChange={(event) => setUseLayerColor(event.target.checked)}
              className="accent-primary"
            />
            Layer color
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-[10px]">
            <input
              type="color"
              value={markerColor}
              disabled={useLayerColor}
              onChange={(event) => setMarkerColor(event.target.value)}
              className="h-7 w-8 disabled:opacity-40"
              aria-label="Marker color"
            />
            <input
              type="range"
              min={10}
              max={48}
              value={markerSize}
              onChange={(event) => setMarkerSize(Number(event.target.value))}
              aria-label="Marker size"
              className="w-20 accent-primary"
            />
            {markerSize}px
          </label>
          <button
            onClick={applyMarkerStyle}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Apply
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf,.txt,.csv"
        className="hidden"
        onChange={(event) => void attachFile(event.target.files?.[0])}
      />
    </DockableBar>
  );
}

function Action({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1 rounded-xl bg-secondary px-2.5 py-1.5 text-[11px] font-medium hover:bg-accent"
      aria-pressed={active}
      title={label}
    >
      <span className={cn("[&>svg]:size-3.5", active && "text-primary")}>{icon}</span>
      {label}
    </button>
  );
}
