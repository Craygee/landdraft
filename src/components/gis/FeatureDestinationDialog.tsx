import { useEffect, useMemo, useState } from "react";
import { FolderPlus, Layers3, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { Feature, Geometry } from "geojson";

import { useMapRef } from "@/lib/gis/mapRef";
import { labelFieldsFromTemplate } from "@/lib/gis/labels";
import { useWorkbench } from "@/lib/gis/store";
import { cn } from "@/lib/utils";
import { defaultMarkerIcon, markerIcons } from "@/lib/gis/markerIcons";

type DestinationMode = "new" | "existing";

const geometryFamily = (geometry: Geometry) =>
  geometry.type.includes("Polygon")
    ? "polygon"
    : geometry.type.includes("LineString")
      ? "line"
      : geometry.type.includes("Point")
        ? "point"
        : "other";

const namedFeature = (feature: Feature, name: string) => ({
  ...structuredClone(feature),
  properties: { ...(feature.properties ?? {}), ...(name.trim() ? { NAME: name.trim() } : {}) },
});

const labelAttributePriority = [
  "NAME",
  "OWNER_NAME",
  "ADDRESS",
  "SITE_ADDRESS",
  "SITUS_ADDR",
  "PARCEL_ID",
  "GEO_ID",
  "ACRES",
];

export function FeatureDestinationDialog() {
  const wb = useWorkbench();
  const { pendingFeatureSave: pending, setPendingFeatureSave } = useMapRef();
  const [mode, setMode] = useState<DestinationMode>("new");
  const [layerName, setLayerName] = useState("");
  const [featureName, setFeatureName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [existingLayerId, setExistingLayerId] = useState("");
  const [labelsEnabled, setLabelsEnabled] = useState(false);
  const [labelField, setLabelField] = useState("");
  const [markerIcon, setMarkerIcon] = useState(defaultMarkerIcon.symbol);
  const [markerColor, setMarkerColor] = useState("#2f7d4f");
  const [markerSize, setMarkerSize] = useState(22);

  const pointFeaturesOnly = useMemo(
    () =>
      Boolean(
        pending?.features.length &&
        pending.features.every((feature) => geometryFamily(feature.geometry) === "point"),
      ),
    [pending],
  );

  const compatibleLayers = useMemo(() => {
    if (!pending) return [];
    const families = new Set(pending.features.map((feature) => geometryFamily(feature.geometry)));
    return wb.layers.filter((layer) => {
      if (layer.source.kind === "remote" || layer.source.kind === "image") return false;
      if (layer.data.features.length === 0) return true;
      const layerFamilies = new Set(
        layer.data.features.slice(0, 100).map((feature) => geometryFamily(feature.geometry)),
      );
      return [...families].every((family) => layerFamilies.has(family));
    });
  }, [pending, wb.layers]);

  const labelAttributes = useMemo(() => {
    if (!pending) return [];
    const keys = new Set<string>();
    for (const feature of pending.features.slice(0, 2_000)) {
      for (const [key, value] of Object.entries(feature.properties ?? {})) {
        if (key.startsWith("__") || key === "ATTACHMENTS" || typeof value === "object") continue;
        keys.add(key);
      }
    }
    return [...keys].sort((left, right) => {
      const leftPriority = labelAttributePriority.indexOf(left.toUpperCase());
      const rightPriority = labelAttributePriority.indexOf(right.toUpperCase());
      if (leftPriority >= 0 || rightPriority >= 0)
        return (
          (leftPriority < 0 ? labelAttributePriority.length : leftPriority) -
          (rightPriority < 0 ? labelAttributePriority.length : rightPriority)
        );
      return left.localeCompare(right);
    });
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const inheritedField =
      pending.style?.labelFields?.[0] ??
      labelFieldsFromTemplate(pending.style?.labelTemplate ?? "")[0] ??
      "";
    const defaultField = labelAttributes.includes(inheritedField)
      ? inheritedField
      : (labelAttributes[0] ?? "");
    setLabelField(defaultField);
    setLabelsEnabled(Boolean(pending.style?.labelEnabled && defaultField));
    if (pointFeaturesOnly) {
      const firstProperties = pending.features[0]?.properties ?? {};
      const featureMarkerColor =
        typeof firstProperties["MARKER_COLOR"] === "string" && firstProperties["MARKER_COLOR"]
          ? firstProperties["MARKER_COLOR"]
          : undefined;
      const requestedMarkerSize = Number(
        pending.style?.pointIconSize ?? firstProperties["MARKER_SIZE"] ?? 22,
      );
      setMarkerIcon(
        pending.style?.pointIcon ||
          String(firstProperties["MARKER_ICON"] ?? "") ||
          defaultMarkerIcon.symbol,
      );
      setMarkerColor(
        pending.style?.pointIconColor ??
          featureMarkerColor ??
          pending.style?.fillColor ??
          "#2f7d4f",
      );
      setMarkerSize(Number.isFinite(requestedMarkerSize) ? requestedMarkerSize : 22);
    }
  }, [labelAttributes, pending, pointFeaturesOnly]);

  if (!pending || !wb.canEditProject) return null;
  const effectiveLayerName = layerName || pending.suggestedLayerName;
  const effectiveFeatureName = featureName || pending.suggestedFeatureName || "";
  const effectiveGroupId = groupId || pending.defaultGroupId;

  const close = () => {
    setPendingFeatureSave(null);
    setMode("new");
    setLayerName("");
    setFeatureName("");
    setGroupId("");
    setNewGroupName("");
    setExistingLayerId("");
    setLabelsEnabled(false);
    setLabelField("");
    setMarkerIcon(defaultMarkerIcon.symbol);
    setMarkerColor("#2f7d4f");
    setMarkerSize(22);
  };

  const save = () => {
    const features = pending.features.map((feature, index) => {
      const named = namedFeature(
        feature,
        pending.features.length === 1
          ? effectiveFeatureName
          : pending.separate
            ? String(feature.properties?.["NAME"] ?? `${effectiveLayerName} ${index + 1}`)
            : "",
      );
      return pointFeaturesOnly
        ? {
            ...named,
            properties: {
              ...(named.properties ?? {}),
              MARKER_ICON: markerIcon,
              MARKER_COLOR: markerColor,
              MARKER_SIZE: markerSize,
            },
          }
        : named;
    });
    if (mode === "existing" && !pending.separate) {
      const target = compatibleLayers.find((layer) => layer.id === existingLayerId);
      if (!target) {
        toast.error("Choose a compatible destination layer");
        return;
      }
      features.forEach((feature) => wb.appendFeature(target.id, feature as never));
      wb.setActiveLayer(target.id);
      toast.success(
        `${features.length} feature${features.length === 1 ? "" : "s"} added to ${target.name}`,
      );
      close();
      return;
    }
    if (labelsEnabled && !labelField) {
      toast.error("Choose an attribute for the feature labels");
      return;
    }
    const targetGroupId = newGroupName.trim() ? wb.addGroup(newGroupName.trim()) : effectiveGroupId;
    const style = {
      ...(pending.style ?? {}),
      ...(pointFeaturesOnly
        ? {
            pointIcon: markerIcon,
            pointIconColor: markerColor,
            pointIconSize: markerSize,
            fillColor: markerColor,
          }
        : {}),
      labelEnabled: labelsEnabled,
      ...(labelField
        ? {
            labelTemplate: `{${labelField}}`,
            labelFields: [labelField],
          }
        : {}),
    };
    if (pending.separate) {
      features.forEach((feature, index) =>
        wb.addLayer({
          name: String(feature.properties?.["NAME"] ?? `${effectiveLayerName} ${index + 1}`),
          groupId: targetGroupId,
          source: pending.source,
          style,
          data: { type: "FeatureCollection", features: [feature as never] },
        }),
      );
      toast.success(`${features.length} layers created`);
    } else {
      const layer = wb.addLayer({
        name: effectiveLayerName.trim() || "New layer",
        groupId: targetGroupId,
        source: pending.source,
        style,
        data: { type: "FeatureCollection", features: features as never },
      });
      toast.success(`${layer.name} created`);
    }
    close();
  };

  return (
    <div className="app-overlay-viewport fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-foreground/25 p-4 backdrop-blur-[2px]">
      <section
        className="feature-destination-dialog panel-surface w-full max-w-md rounded-3xl p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Layers3 className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold">
              Save {pending.features.length > 1 ? "features" : "feature"}
            </h2>
            <p className="text-[10px] text-muted-foreground">Choose where this geometry belongs.</p>
          </div>
          <button
            onClick={close}
            className="ml-auto rounded-lg p-2 hover:bg-accent"
            aria-label="Cancel save"
            title="Cancel"
          >
            <X className="size-4" />
          </button>
        </div>

        {!pending.separate && (
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
            <button
              onClick={() => setMode("new")}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-semibold",
                mode === "new" && "bg-card shadow-sm",
              )}
            >
              <FolderPlus className="mr-1 inline size-3.5" /> New layer
            </button>
            <button
              onClick={() => setMode("existing")}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-semibold",
                mode === "existing" && "bg-card shadow-sm",
              )}
            >
              <Plus className="mr-1 inline size-3.5" /> Existing layer
            </button>
          </div>
        )}

        {pending.features.length === 1 && (
          <label className="mt-3 block text-[10px] font-medium text-muted-foreground">
            Feature name
            <input
              value={featureName}
              onChange={(event) => setFeatureName(event.target.value)}
              placeholder={pending.suggestedFeatureName ?? "Feature name"}
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
        )}

        {pointFeaturesOnly && (
          <section className="mt-3 rounded-2xl border border-border bg-secondary/35 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold">Marker symbol</h3>
                <p className="text-[9px] text-muted-foreground">
                  Choose how this marker appears on the main map.
                </p>
              </div>
              <span
                className="flex size-9 items-center justify-center rounded-xl bg-card text-xl shadow-sm"
                style={{ color: markerColor }}
                aria-label="Selected marker preview"
              >
                {markerIcon}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {markerIcons.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  onClick={() => setMarkerIcon(icon.symbol)}
                  title={`${icon.label} · ${icon.category}`}
                  aria-label={`Use ${icon.label} marker`}
                  aria-pressed={markerIcon === icon.symbol}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-lg border bg-card text-base hover:bg-accent",
                    markerIcon === icon.symbol
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border",
                  )}
                  style={{ color: markerColor }}
                >
                  {icon.symbol}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <input
                type="color"
                value={markerColor}
                onChange={(event) => setMarkerColor(event.target.value)}
                aria-label="Marker color"
                className="h-8 w-10 rounded-lg border border-border bg-card p-1"
              />
              <input
                type="range"
                min={12}
                max={48}
                value={markerSize}
                onChange={(event) => setMarkerSize(Number(event.target.value))}
                aria-label="Marker size"
                className="accent-primary"
              />
              <span className="num text-[10px] text-muted-foreground">{markerSize}px</span>
            </div>
          </section>
        )}

        {mode === "new" || pending.separate ? (
          <div className="mt-3 space-y-3">
            {!pending.separate && (
              <label className="block text-[10px] font-medium text-muted-foreground">
                Layer name
                <input
                  value={layerName}
                  onChange={(event) => setLayerName(event.target.value)}
                  placeholder={pending.suggestedLayerName}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                />
              </label>
            )}
            <section className="rounded-xl border border-border bg-secondary/40 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <input
                  type="checkbox"
                  checked={labelsEnabled}
                  disabled={labelAttributes.length === 0}
                  onChange={(event) => setLabelsEnabled(event.target.checked)}
                  className="accent-primary"
                />
                Label features in this layer
              </label>
              {labelsEnabled && labelAttributes.length > 0 ? (
                <label className="mt-2 block text-[10px] font-medium text-muted-foreground">
                  Label attribute
                  <select
                    value={labelField}
                    onChange={(event) => setLabelField(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground"
                  >
                    {labelAttributes.map((attribute) => (
                      <option key={attribute} value={attribute}>
                        {attribute}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="mt-1 text-[9px] text-muted-foreground">
                  {labelAttributes.length
                    ? "Labels stay off until this option is selected."
                    : "These features do not contain a usable label attribute."}
                </p>
              )}
            </section>
            <label className="block text-[10px] font-medium text-muted-foreground">
              Layer group
              <select
                value={effectiveGroupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground"
              >
                {wb.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] font-medium text-muted-foreground">
              Or create a new group
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder="Optional group name"
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>
        ) : (
          <label className="mt-3 block text-[10px] font-medium text-muted-foreground">
            Compatible layer
            <select
              value={existingLayerId}
              onChange={(event) => setExistingLayerId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground"
            >
              <option value="">Choose layer</option>
              {compatibleLayers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
            </select>
            {compatibleLayers.length === 0 && (
              <span className="mt-1 block text-[9px]">
                No editable layer currently has compatible geometry.
              </span>
            )}
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={close}
            className="rounded-xl px-4 py-2 text-xs font-semibold hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Save feature
          </button>
        </div>
      </section>
    </div>
  );
}
