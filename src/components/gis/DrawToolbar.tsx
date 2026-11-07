import {
  Hexagon,
  Minus,
  MapPinPlus,
  Ruler,
  MousePointer2,
  Move3d,
  Magnet,
  LocateFixed,
  ScanSearch,
  ListChecks,
  StickyNote,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useWorkbench, type DrawMode } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import { cn } from "@/lib/utils";
import { AREA_UNITS, LENGTH_UNITS, type AreaUnit, type LengthUnit } from "@/lib/gis/measure";

const tools: Array<{ mode: DrawMode; label: string; icon: React.ReactNode }> = [
  { mode: "none", label: "Select", icon: <MousePointer2 className="size-4" /> },
  {
    mode: "select-multiple",
    label: "Select multiple features",
    icon: <ListChecks className="size-4" />,
  },
  {
    mode: "select-box",
    label: "Select by dragging a box",
    icon: <ScanSearch className="size-4" />,
  },
  { mode: "polygon", label: "Draw area", icon: <Hexagon className="size-4" /> },
  { mode: "line", label: "Draw line", icon: <Minus className="size-4" /> },
  { mode: "point", label: "Add marker", icon: <MapPinPlus className="size-4" /> },
  { mode: "note", label: "Drop note marker", icon: <StickyNote className="size-4" /> },
  { mode: "measure-area", label: "Measure area", icon: <Ruler className="size-4" /> },
  { mode: "measure-line", label: "Measure distance", icon: <Move3d className="size-4" /> },
];

const COLLAPSE_KEY = "landdraft.draw-toolbar-collapsed.v1";

export function DrawToolbar() {
  const wb = useWorkbench();
  const { map, setPendingFeatureSave } = useMapRef();
  const addGpsPoint = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const feature = {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [coords.longitude, coords.latitude] },
          properties: {
            NAME: "GPS location",
            LAT: Number(coords.latitude.toFixed(6)),
            LON: Number(coords.longitude.toFixed(6)),
            ACCURACY_M: Math.round(coords.accuracy),
            CAPTURED: new Date().toISOString(),
          },
        };
        setPendingFeatureSave({
          features: [feature],
          suggestedLayerName: "GPS points",
          suggestedFeatureName: "GPS location",
          defaultGroupId: "sketch",
          source: { kind: "draw" },
        });
        map?.easeTo({
          center: [coords.longitude, coords.latitude],
          zoom: Math.max(map.getZoom(), 16),
        });
        toast.success(`GPS captured · ±${Math.round(coords.accuracy)} m`);
      },
      (error) => toast.error("Could not read your location", { description: error.message }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
    } catch {
      // Private windows can refuse storage; the toggle still works for this visit.
    }
  };
  if (!wb.canEditProject) return null;
  const activeTool = tools.find((tool) => tool.mode === wb.drawMode) ?? tools[0]!;
  const visibleTools = collapsed ? [activeTool] : tools;
  return (
    <div className="float-surface flex max-w-full flex-wrap items-center gap-1 rounded-2xl p-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {visibleTools.map((tool) => (
          <button
            key={tool.mode}
            onClick={() => wb.setDrawMode(tool.mode)}
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={wb.drawMode === tool.mode}
            className={cn(
              "flex size-9 items-center justify-center rounded-xl transition-colors",
              wb.drawMode === tool.mode
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      {!collapsed && (
        <>
          <div className="mx-0.5 h-7 w-px bg-border" />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={`Snap, GPS and units · ${AREA_UNITS[wb.units.area].label}, ${LENGTH_UNITS[wb.units.length].label}`}
                aria-label="Snap, GPS and units"
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl hover:bg-accent",
                  wb.snapEnabled && "text-primary",
                )}
              >
                <SlidersHorizontal className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 space-y-2 rounded-2xl p-2">
              <button
                type="button"
                onClick={() => wb.setSnapEnabled(!wb.snapEnabled)}
                aria-pressed={wb.snapEnabled}
                aria-label="Snap to visible features"
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs hover:bg-accent",
                  wb.snapEnabled && "bg-accent text-primary",
                )}
              >
                <Magnet className="size-4" />
                <span className="flex-1">Snap to visible features</span>
                <span className="text-[10px] font-semibold">{wb.snapEnabled ? "On" : "Off"}</span>
              </button>
              <button
                type="button"
                onClick={addGpsPoint}
                aria-label="Add GPS point"
                className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <LocateFixed className="size-4" />
                <span className="flex-1">Add GPS point</span>
              </button>
              <div className="grid grid-cols-2 gap-1.5 border-t border-border pt-2">
                <label className="text-[10px] text-muted-foreground">
                  Area
                  <select
                    value={wb.units.area}
                    onChange={(e) => wb.setUnits({ area: e.target.value as AreaUnit })}
                    aria-label="Area units"
                    className="mt-0.5 h-8 w-full rounded-lg bg-secondary px-2 text-xs text-secondary-foreground"
                  >
                    {(Object.keys(AREA_UNITS) as AreaUnit[]).map((u) => (
                      <option key={u} value={u}>
                        {AREA_UNITS[u].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] text-muted-foreground">
                  Length
                  <select
                    value={wb.units.length}
                    onChange={(e) => wb.setUnits({ length: e.target.value as LengthUnit })}
                    aria-label="Length units"
                    className="mt-0.5 h-8 w-full rounded-lg bg-secondary px-2 text-xs text-secondary-foreground"
                  >
                    {(Object.keys(LENGTH_UNITS) as LengthUnit[]).map((u) => (
                      <option key={u} value={u}>
                        {LENGTH_UNITS[u].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? "Show all drawing tools" : "Collapse the drawing tools"}
        aria-label={collapsed ? "Show all drawing tools" : "Collapse the drawing tools"}
        aria-expanded={!collapsed}
        className="flex h-9 w-6 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent"
      >
        {collapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </button>
    </div>
  );
}
