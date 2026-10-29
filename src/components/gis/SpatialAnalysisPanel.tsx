import { useMemo, useState } from "react";
import {
  buffer,
  centroid,
  convex,
  difference,
  featureCollection,
  intersect,
  union,
} from "@turf/turf";
import type { Feature, Geometry, Polygon, MultiPolygon } from "geojson";
import { Beaker, ChevronDown, Loader2, Mountain, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";

type Operation = "buffer" | "centroid" | "union" | "intersect" | "difference" | "convex";
type PolygonFeature = Feature<Polygon | MultiPolygon>;
type AnalysisResult = {
  id: string;
  kind: "layer" | "features";
  layerId: string;
  layerName: string;
  analysisName: string;
  featureCount: number;
  featureIndexes: number[];
};

const operations: Array<{ id: Operation; name: string; description: string }> = [
  {
    id: "buffer",
    name: "Buffer",
    description: "Create an area at a chosen distance around points, lines or polygons.",
  },
  {
    id: "centroid",
    name: "Centroid points",
    description: "Place one center point for every input feature.",
  },
  {
    id: "union",
    name: "Merge polygons",
    description: "Combine overlapping or adjacent polygon features into one result.",
  },
  {
    id: "intersect",
    name: "Intersection",
    description: "Keep only portions of the input that overlap a second polygon layer.",
  },
  {
    id: "difference",
    name: "Difference / erase",
    description: "Remove portions covered by a second polygon layer.",
  },
  {
    id: "convex",
    name: "Convex hull",
    description: "Draw the simplest outer boundary around all input features.",
  },
];

export function SpatialAnalysisPanel() {
  const wb = useWorkbench();
  const {
    setAnalysisOpen,
    setPendingFeatureSave,
    setElevationProfileOpen,
    setBuildableAreaOpen,
    setDrawerOpen,
    setTableOpen,
    setEditEnabled,
  } = useMapRef();
  const usableLayers = wb.layers.filter((layer) => layer.data.features.length > 0);
  const [layerId, setLayerId] = useState(wb.activeLayerId ?? usableLayers[0]?.id ?? "");
  const [overlayLayerId, setOverlayLayerId] = useState("");
  const [operation, setOperation] = useState<Operation>("buffer");
  const [distance, setDistance] = useState(1);
  const [units, setUnits] = useState<"feet" | "miles" | "meters" | "kilometers">("miles");
  const [useSelection, setUseSelection] = useState(true);
  const [running, setRunning] = useState(false);

  const inputLayer = wb.layers.find((layer) => layer.id === layerId);
  const overlayLayer = wb.layers.find((layer) => layer.id === overlayLayerId);
  const selectedIndexes = useMemo(
    () => wb.selectedFeatures.filter((item) => item.layerId === layerId).map((item) => item.index),
    [layerId, wb.selectedFeatures],
  );
  const selectedOperation = operations.find((item) => item.id === operation) ?? operations[0]!;
  const needsOverlay = operation === "intersect" || operation === "difference";
  const analysisResults = useMemo<AnalysisResult[]>(() => {
    const results: AnalysisResult[] = [];
    wb.layers.forEach((layer) => {
      const analysisFeatures = layer.data.features
        .map((feature, index) => ({
          index,
          name: feature.properties?.["ANALYSIS"],
          runId: feature.properties?.["ANALYSIS_RUN_ID"],
          analyzedAt: feature.properties?.["ANALYZED_AT"],
        }))
        .filter((item): item is typeof item & { name: string } => typeof item.name === "string");
      if (analysisFeatures.length === 0) return;

      const derivedQuery = layer.source.kind === "derived" ? layer.source.query : undefined;
      const isAnalysisLayer =
        layer.source.kind === "derived" &&
        (typeof derivedQuery === "string" ||
          analysisFeatures.length === layer.data.features.length);
      if (isAnalysisLayer) {
        results.push({
          id: `layer:${layer.id}`,
          kind: "layer",
          layerId: layer.id,
          layerName: layer.name,
          analysisName: String(derivedQuery ?? analysisFeatures[0]?.name ?? "Analysis"),
          featureCount: layer.data.features.length,
          featureIndexes: [],
        });
        return;
      }

      const batches = new Map<string, { name: string; indexes: number[] }>();
      analysisFeatures.forEach((item) => {
        const batchId =
          typeof item.runId === "string" && item.runId
            ? item.runId
            : `${item.name}:${String(item.analyzedAt ?? "legacy")}`;
        const batch = batches.get(batchId) ?? { name: item.name, indexes: [] as number[] };
        batch.indexes.push(item.index);
        batches.set(batchId, batch);
      });
      batches.forEach((batch, batchId) =>
        results.push({
          id: `features:${layer.id}:${batchId}`,
          kind: "features",
          layerId: layer.id,
          layerName: layer.name,
          analysisName: batch.name,
          featureCount: batch.indexes.length,
          featureIndexes: batch.indexes,
        }),
      );
    });
    return results;
  }, [wb.layers]);

  const removeAnalysisResult = (result: AnalysisResult) => {
    const target = result.kind === "layer" ? result.layerName : `${result.analysisName} additions`;
    if (!window.confirm(`Remove ${target}?`)) return;
    if (result.kind === "layer") wb.removeLayers([result.layerId]);
    else wb.removeFeatures(result.layerId, result.featureIndexes);
    toast.success(`${target} removed`);
  };

  const runAnalysis = () => {
    if (!inputLayer) {
      toast.error("Choose an input layer");
      return;
    }
    const inputs =
      useSelection && selectedIndexes.length > 0
        ? selectedIndexes
            .map((index) => inputLayer.data.features[index])
            .filter((feature): feature is Feature => Boolean(feature))
        : inputLayer.data.features;
    if (inputs.length === 0) {
      toast.error("The input layer has no usable features");
      return;
    }
    if (inputs.length > 5000) {
      toast.error("Select fewer than 5,000 features", {
        description:
          "A smaller analysis keeps the browser responsive. Use attribute or box selection first.",
      });
      return;
    }
    if (needsOverlay && !overlayLayer) {
      toast.error("Choose an overlay polygon layer");
      return;
    }

    setRunning(true);
    window.setTimeout(() => {
      try {
        const analyzedAt = new Date().toISOString();
        const analysisRunId = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const output = analyze(
          operation,
          inputs,
          overlayLayer?.data.features ?? [],
          distance,
          units,
        ).map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            ANALYSIS_RUN_ID: analysisRunId,
            ANALYZED_AT: analyzedAt,
          },
        }));
        if (output.length === 0) {
          toast.info("The analysis produced no features", {
            description: "Try a different selection, distance, or overlay layer.",
          });
          return;
        }
        const label = selectedOperation.name;
        setPendingFeatureSave({
          features: output,
          suggestedLayerName: `${inputLayer.name} — ${label}`,
          defaultGroupId: wb.derivedLayerGroupId,
          source: { kind: "derived", sourceLayerId: inputLayer.id, query: label },
          style: inputLayer.style,
        });
        setAnalysisOpen(false);
        toast.success(
          `${output.length.toLocaleString()} analysis feature${output.length === 1 ? "" : "s"} ready`,
        );
      } catch (error) {
        toast.error("Spatial analysis could not finish", {
          description:
            error instanceof Error ? error.message : "Check the selected geometries and try again.",
        });
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  return (
    <section
      data-tour="analysis-panel"
      className="float-surface absolute right-3 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-3xl"
      aria-label="Spatial analysis tools"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Beaker className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold">Spatial analysis</h2>
          <p className="text-[10px] text-muted-foreground">Powerful tools, guided step by step</p>
        </div>
        <button
          onClick={() => setAnalysisOpen(false)}
          className="ml-auto rounded-xl p-2 hover:bg-accent"
          aria-label="Close spatial analysis"
          title="Close spatial analysis"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="space-y-4 overflow-y-auto p-4 text-xs">
        <button
          onClick={() => {
            wb.setDrawMode("none");
            setEditEnabled(false);
            setDrawerOpen(false);
            setTableOpen(false);
            setAnalysisOpen(false);
            setElevationProfileOpen(false);
            setBuildableAreaOpen(true);
          }}
          className="flex min-h-11 w-full items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 text-left"
        >
          <Beaker className="mt-1 size-5 shrink-0 text-primary" />
          <span>
            <strong className="block text-sm">Buildable Area</strong>
            <span className="mt-1 block text-xs text-muted-foreground">
              Screen a rectangle or polygon for mapped exclusions, conditional land and contiguous
              candidate acreage.
            </span>
          </span>
        </button>
        <button
          onClick={() => {
            wb.setDrawMode("none");
            wb.setSelectedFeatures([]);
            setEditEnabled(false);
            setDrawerOpen(false);
            setTableOpen(false);
            setAnalysisOpen(false);
            setBuildableAreaOpen(false);
            setElevationProfileOpen(true);
          }}
          className="flex min-h-11 w-full items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 text-left"
        >
          <Mountain className="mt-1 size-5 shrink-0 text-primary" />
          <span>
            <strong className="block text-sm">Elevation profile</strong>
            <span className="mt-1 block text-xs text-muted-foreground">
              Draw a path and inspect terrain elevation, distance and slope on an interactive graph.
            </span>
          </span>
        </button>
        {usableLayers.length === 0 ? (
          <div className="rounded-2xl bg-secondary p-4 text-center text-muted-foreground">
            Add or draw a layer first, then return here to analyze it.
          </div>
        ) : (
          <>
            <label className="block font-semibold">
              1. Input layer
              <select
                value={layerId}
                onChange={(event) => setLayerId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-normal outline-none focus:border-primary"
              >
                {usableLayers.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name} · {layer.data.features.length.toLocaleString()} features
                  </option>
                ))}
              </select>
            </label>

            {selectedIndexes.length > 0 && (
              <label className="flex items-start gap-2 rounded-xl bg-primary/10 p-3">
                <input
                  type="checkbox"
                  checked={useSelection}
                  onChange={(event) => setUseSelection(event.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <strong className="block">Use {selectedIndexes.length} selected features</strong>
                  <span className="text-[10px] text-muted-foreground">
                    Turn off to analyze the whole layer.
                  </span>
                </span>
              </label>
            )}

            <label className="block font-semibold">
              2. Tool
              <div className="relative mt-1">
                <select
                  value={operation}
                  onChange={(event) => setOperation(event.target.value as Operation)}
                  className="w-full appearance-none rounded-xl border border-border bg-card px-3 py-2 pr-9 font-normal outline-none focus:border-primary"
                >
                  {operations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
              </div>
            </label>
            <p className="-mt-2 rounded-xl bg-secondary px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {selectedOperation.description}
            </p>

            {operation === "buffer" && (
              <div className="grid grid-cols-[1fr_1.2fr] gap-2">
                <label className="font-semibold">
                  Distance
                  <input
                    type="number"
                    min={0.0001}
                    step="any"
                    value={distance}
                    onChange={(event) => setDistance(Math.max(0.0001, Number(event.target.value)))}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-normal"
                  />
                </label>
                <label className="font-semibold">
                  Units
                  <select
                    value={units}
                    onChange={(event) => setUnits(event.target.value as typeof units)}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-normal capitalize"
                  >
                    {(["feet", "miles", "meters", "kilometers"] as const).map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {needsOverlay && (
              <label className="block font-semibold">
                3. Overlay polygon layer
                <select
                  value={overlayLayerId}
                  onChange={(event) => setOverlayLayerId(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-normal outline-none focus:border-primary"
                >
                  <option value="">Choose a layer…</option>
                  {usableLayers
                    .filter((layer) => layer.id !== layerId && hasPolygons(layer.data.features))
                    .map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        {layer.name}
                      </option>
                    ))}
                </select>
              </label>
            )}

            <button
              onClick={runAnalysis}
              disabled={running}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {running ? "Analyzing…" : `Run ${selectedOperation.name}`}
            </button>
            <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
              Results open in the standard destination dialog so you can create a new Working layer,
              choose another category, or append compatible features to an existing layer.
            </p>

            {analysisResults.length > 0 && (
              <details className="group rounded-2xl border border-border bg-card/60">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-semibold">
                  <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open:rotate-0" />
                  Analysis results on map
                  <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px]">
                    {analysisResults.length}
                  </span>
                </summary>
                <div className="space-y-1 border-t border-border p-2">
                  {analysisResults.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-secondary"
                    >
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[11px]">
                          {result.kind === "layer" ? result.layerName : result.analysisName}
                        </strong>
                        <span className="block truncate text-[9px] text-muted-foreground">
                          {result.featureCount.toLocaleString()} feature
                          {result.featureCount === 1 ? "" : "s"}
                          {result.kind === "features" ? ` added to ${result.layerName}` : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAnalysisResult(result)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
                        aria-label={`Remove ${result.analysisName} result from ${result.layerName}`}
                        title="Remove this analysis result"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function analyze(
  operation: Operation,
  inputs: Feature[],
  overlays: Feature[],
  distance: number,
  units: "feet" | "miles" | "meters" | "kilometers",
): Feature[] {
  if (operation === "buffer")
    return inputs.flatMap((feature) => {
      const result = buffer(feature, distance, { units });
      return result ? [withAnalysisProperties(result, feature, "Buffer")] : [];
    });

  if (operation === "centroid")
    return inputs.map((feature) => withAnalysisProperties(centroid(feature), feature, "Centroid"));

  if (operation === "convex") {
    const result = convex(featureCollection(inputs));
    return result ? [withAnalysisProperties(result, inputs[0], "Convex hull")] : [];
  }

  const polygons = inputs.filter(isPolygonFeature);
  if (polygons.length === 0)
    throw new Error("This tool needs polygon features in the input layer.");

  if (operation === "union") {
    const result = polygons.length === 1 ? polygons[0] : union(featureCollection(polygons));
    return result ? [withAnalysisProperties(result, polygons[0], "Merge polygons")] : [];
  }

  const overlayPolygons = overlays.filter(isPolygonFeature);
  if (overlayPolygons.length === 0) throw new Error("The overlay layer needs polygon features.");
  if (overlayPolygons.length > 2500)
    throw new Error("Select or filter the overlay layer to fewer than 2,500 polygons first.");
  const mask =
    overlayPolygons.length === 1 ? overlayPolygons[0] : union(featureCollection(overlayPolygons));
  if (!mask) return [];

  return polygons.flatMap((feature) => {
    const result =
      operation === "intersect"
        ? intersect(featureCollection([feature, mask]))
        : difference(featureCollection([feature, mask]));
    return result
      ? [
          withAnalysisProperties(
            result,
            feature,
            operation === "intersect" ? "Intersection" : "Difference",
          ),
        ]
      : [];
  });
}

function withAnalysisProperties(
  result: Feature,
  source: Feature | undefined,
  name: string,
): Feature {
  return {
    ...result,
    properties: {
      ...(source?.properties ?? {}),
      ANALYSIS: name,
      ANALYZED_AT: new Date().toISOString(),
    },
  } as Feature<Geometry>;
}

function isPolygonFeature(feature: Feature): feature is PolygonFeature {
  return feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon";
}

function hasPolygons(features: Feature[]): boolean {
  return features.some(isPolygonFeature);
}
