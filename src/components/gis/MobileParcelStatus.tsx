import { useEffect, useState } from "react";
import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { isParcelLayer } from "@/lib/gis/parcelDisplay";
import { TEXAS_PARCEL_URL } from "@/lib/gis/texasParcels";
import type { GisLayer } from "@/lib/gis/types";

/** Inspect the actual project layer, not just the public catalog's manifest health. */
export function MobileParcelStatus() {
  const wb = useWorkbench();
  const { map, layerRenderErrors } = useMapRef();
  const layers = wb.displayLayers.filter(isParcelLayer);
  const [zoom, setZoom] = useState(map?.getZoom() ?? 0);
  const [attached, setAttached] = useState<Record<string, boolean>>({});
  const signature = layers
    .map(
      (layer) =>
        `${layer.id}:${layer.visible}:${layer.data.features.length}:${layer.source.kind === "remote" ? layer.source.loadStatus : ""}`,
    )
    .join("|");
  useEffect(() => {
    if (!map) return;
    const update = () => {
      setZoom(map.getZoom());
      const next = Object.fromEntries(
        layers.map((layer) => [layer.id, Boolean(map.getLayer(`line-${layer.id}`))]),
      );
      setAttached((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    update();
    map.on("idle", update);
    map.on("moveend", update);
    return () => {
      map.off("idle", update);
      map.off("moveend", update);
    };
    // IDs, visibility and download state determine this inspection; geometry is not copied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);

  const reconnect = (layer?: GisLayer) => {
    const style = {
      fillOpacity: 0,
      strokeColor: "#1e6f43",
      strokeWidth: 1.2,
      strokeOpacity: 1,
      labelEnabled: true,
      labelTemplate: "{OWNER_NAME}",
      labelFields: ["OWNER_NAME"],
      labelUseLayerName: false,
      labelSize: 11,
      labelMinZoom: 11,
      labelMaxZoom: 24,
      labelScaleWithZoom: true,
    };
    if (!layer || layer.source.kind !== "remote") {
      const added = wb.addLayer({
        name: "Texas Land Parcels — Statewide",
        groupId: "public",
        source: {
          kind: "remote",
          catalogId: "tx-parcels",
          url: TEXAS_PARCEL_URL,
          requiresViewport: true,
          minZoom: 10,
          parcelDisplayVersion: 2,
        },
        style,
        data: { type: "FeatureCollection", features: [] },
      });
      wb.setActiveLayer(added.id);
      return;
    }
    wb.updateDisplayLayer(layer.id, {
      visible: true,
      style: { ...layer.style, ...style },
      source: {
        ...layer.source,
        url: TEXAS_PARCEL_URL,
        requiresViewport: true,
        minZoom: 10,
        parcelDisplayVersion: 2,
        refreshToken: (layer.source.refreshToken ?? 0) + 1,
      },
    });
    const position = wb.layers.findIndex((item) => item.id === layer.id);
    for (let i = 0; i < position; i++) wb.moveLayer(layer.id, -1);
  };

  return (
    <section
      aria-label="Texas parcel display status"
      className="space-y-2 rounded-2xl border border-border p-3"
    >
      <h3 className="text-sm font-semibold">Texas parcel display · zoom {zoom.toFixed(1)}</h3>
      <p className="text-xs text-muted-foreground">
        Borders from zoom 10. Large-parcel labels from 11, growing to normal size at 13. Full detail
        at 12+.
      </p>
      {!layers.length && (
        <>
          <p className="text-xs">Texas parcel data is not added to this project.</p>
          <button
            disabled={!wb.canEditProject}
            onClick={() => reconnect()}
            className="min-h-11 w-full rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Add Texas parcels to this map
          </button>
        </>
      )}
      {layers.map((layer) => (
        <div key={layer.id} className="space-y-2 border-t border-border pt-2">
          <p className="break-words text-xs font-semibold">{layer.name}</p>
          <p className="text-xs">
            {layer.visible ? "On" : "Hidden"} · {layer.data.features.length.toLocaleString()}{" "}
            downloaded ·{" "}
            {attached[layer.id] ? "outline renderer attached" : "outline renderer not attached"}
          </p>
          {layer.source.kind === "remote" && (
            <>
              <p className="text-xs">
                {layer.source.loading
                  ? "Loading visible area…"
                  : `Load state: ${layer.source.loadStatus ?? "not started"}`}
              </p>
              {layer.source.minZoom !== undefined && zoom < layer.source.minZoom && (
                <p className="text-xs">Saved layer cutoff is zoom {layer.source.minZoom}+.</p>
              )}
              {layer.source.loadError && (
                <p role="status" className="break-words text-xs text-destructive">
                  {layer.source.loadError}
                </p>
              )}
            </>
          )}
          {layerRenderErrors[layer.id] && (
            <p role="status" className="break-words text-xs text-destructive">
              Map rendering: {layerRenderErrors[layer.id]}
            </p>
          )}
          <button
            disabled={
              !wb.canEditProject || (layer.source.kind === "remote" && layer.source.loading)
            }
            onClick={() => reconnect(layer)}
            className="min-h-11 w-full rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Show / reconnect Texas parcels
          </button>
          <p className="text-[11px] text-muted-foreground">
            Restores green outlines and owner labels, reconnects the stored statewide source, and
            brings this layer to the front. Keeps your map position.
          </p>
        </div>
      ))}
    </section>
  );
}
