import { useEffect, useState } from "react";
import { List, X } from "lucide-react";
import { useWorkbench } from "@/lib/gis/store";
import { LegendSwatch } from "./LegendSwatch";
import { useMapRef } from "@/lib/gis/mapRef";
import { fillId, lineId, pointId, markerIconId, imageId } from "@/lib/gis/mapStyle";
import { legendValuesInView, legendZoomBounds } from "@/lib/gis/legendInView";
import type { GisLayer } from "@/lib/gis/types";
import { toast } from "sonner";

export function MapLegendControl({
  inline = false,
  onClose,
  open: controlledOpen,
  onOpenChange,
}: {
  inline?: boolean;
  onClose?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(inline);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const wb = useWorkbench();
  const { map } = useMapRef();
  const [inView, setInView] = useState<Record<string, Record<string, string[]>>>({});
  useEffect(() => {
    if (!map || !open) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!map.isStyleLoaded()) return;
        const next: Record<string, Record<string, string[]>> = {};
        for (const layer of wb.displayLayers) {
          if (!layer.visible) continue;
          const ids = [
            fillId(layer.id),
            lineId(layer.id),
            pointId(layer.id),
            markerIconId(layer.id),
          ].filter((id) => Boolean(map.getLayer(id)));
          const values = legendValuesInView(
            layer,
            ids.length ? map.queryRenderedFeatures(undefined, { layers: ids }) : [],
          );
          if (values) {
            next[layer.id] = values;
          } else if (layer.source.kind === "image" && map.getLayer(imageId(layer.id))) {
            const coords = layer.source.coordinates;
            const bounds = map.getBounds();
            if (
              Math.max(...coords.map((p) => p[0])) >= bounds.getWest() &&
              Math.min(...coords.map((p) => p[0])) <= bounds.getEast() &&
              Math.max(...coords.map((p) => p[1])) >= bounds.getSouth() &&
              Math.min(...coords.map((p) => p[1])) <= bounds.getNorth()
            )
              next[layer.id] = {};
          }
        }
        setInView((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      });
    };
    update();
    map.on("moveend", update);
    map.on("idle", update);
    map.on("sourcedata", update);
    return () => {
      cancelAnimationFrame(frame);
      map.off("moveend", update);
      map.off("idle", update);
      map.off("sourcedata", update);
    };
  }, [map, open, wb.displayLayers]);
  const visible = wb.displayLayers.filter((layer) => layer.visible && inView[layer.id]);
  const zoomTo = (layer: GisLayer, value?: string) => {
    if (!map) return;
    const bounds = legendZoomBounds(layer, value);
    if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: 17, duration: 650 });
    else toast.info("No loaded feature geometry to zoom to");
  };
  return (
    <div className="relative">
      {!inline && (
        <button
          type="button"
          aria-label={open ? "Hide map legend" : "Show map legend"}
          aria-expanded={open}
          title={open ? "Hide legend" : "Show legend"}
          onClick={() => setOpen(!open)}
          className="float-surface flex h-10 items-center gap-2 rounded-full px-3 text-xs font-semibold"
        >
          <List className="size-4" /> Legend
        </button>
      )}
      {open && (
        <section
          aria-label="Visible layer legend"
          className={
            inline
              ? "float-surface w-60 max-w-full rounded-xl p-3"
              : "map-legend-panel float-surface absolute right-0 top-12 w-64 max-w-[calc(100vw-2rem)] rounded-xl p-3"
          }
        >
          <header className="mb-2 flex items-center justify-between text-sm font-semibold">
            Layers in this view
            <button
              type="button"
              aria-label="Close map legend"
              onClick={() => {
                setOpen(false);
                onClose?.();
              }}
              className="rounded p-1"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="max-h-[40dvh] space-y-2 overflow-y-auto">
            {visible.length === 0 && (
              <p className="text-xs text-muted-foreground">No layer items in this view.</p>
            )}
            {visible.map((layer) => (
              <div key={layer.id} className="space-y-1 border-b border-border/40 pb-2">
                <button
                  type="button"
                  onClick={() => zoomTo(layer)}
                  title={`Zoom to ${layer.name}`}
                  className="flex w-full items-center gap-2 rounded p-1 text-left hover:bg-accent"
                >
                  <LegendSwatch layer={layer} />
                  <span className="min-w-0 break-words text-xs font-medium">{layer.name}</span>
                </button>
                {layer.style.categorized?.enabled &&
                  layer.style.categorized.rules
                    .filter(
                      (rule) =>
                        rule.visible &&
                        inView[layer.id]?.[layer.style.categorized!.field]?.includes(rule.value),
                    )
                    .map((rule) => {
                      const iconRule =
                        layer.style.categorizedIcons?.enabled &&
                        layer.style.categorizedIcons.field === layer.style.categorized?.field
                          ? layer.style.categorizedIcons.rules.find(
                              (icon) => icon.value === rule.value,
                            )
                          : undefined;
                      const styled = {
                        ...layer,
                        style: {
                          ...layer.style,
                          categorizedIcons: {
                            enabled: false,
                            field: "",
                            rules: [],
                            fallbackIcon: "",
                          },
                          fillColor: rule.color,
                          strokeColor: rule.color,
                          pointIconColor: rule.color,
                          pointIcon: iconRule?.icon || layer.style.pointIcon,
                          fillPattern: iconRule?.fillPattern ?? layer.style.fillPattern,
                          strokePattern: iconRule?.strokePattern ?? layer.style.strokePattern,
                        },
                      };
                      return (
                        <button
                          type="button"
                          onClick={() => zoomTo(layer, rule.value)}
                          title={`Zoom to ${layer.name}: ${rule.label || rule.value}`}
                          key={rule.value}
                          className="ml-3 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded p-1 text-left hover:bg-accent"
                        >
                          <LegendSwatch layer={styled} />
                          <span className="break-words text-xs">
                            {rule.label || rule.value || "(empty)"}
                          </span>
                        </button>
                      );
                    })}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
