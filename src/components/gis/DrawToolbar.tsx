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
} from "lucide-react";
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
  if (!wb.canEditProject) return null;
  return (
    <div className="float-surface flex items-center gap-1 rounded-2xl p-1.5">
      <div className="flex items-center gap-1">
        {tools.map((tool) => (
          <button
            key={tool.mode}
            onClick={() => wb.setDrawMode(tool.mode)}
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={wb.drawMode === tool.mode}
            className={cn(
              "flex h-9 items-center justify-center rounded-xl transition-colors",
              tool.mode === "point" ? "w-auto gap-1.5 px-2.5" : "w-9",
              wb.drawMode === tool.mode
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {tool.icon}
            {tool.mode === "point" && <span className="text-[10px] font-semibold">Marker</span>}
          </button>
        ))}
      </div>
      <div className="mx-1 h-7 w-px bg-border" />
      <button
        onClick={() => wb.setSnapEnabled(!wb.snapEnabled)}
        title="Snap to visible features"
        aria-label="Snap to visible features"
        aria-pressed={wb.snapEnabled}
        className={cn(
          "flex size-9 items-center justify-center rounded-xl",
          wb.snapEnabled ? "bg-accent text-primary" : "hover:bg-accent",
        )}
      >
        <Magnet className="size-4" />
      </button>
      <button
        onClick={addGpsPoint}
        title="Add GPS point"
        aria-label="Add GPS point"
        className="flex size-9 items-center justify-center rounded-xl hover:bg-accent"
      >
        <LocateFixed className="size-4" />
      </button>
      <div className="mx-1 h-7 w-px bg-border" />
      <select
        value={wb.units.area}
        onChange={(e) => wb.setUnits({ area: e.target.value as AreaUnit })}
        aria-label="Area units"
        className="h-8 rounded-lg bg-secondary px-2 text-xs text-secondary-foreground"
      >
        {(Object.keys(AREA_UNITS) as AreaUnit[]).map((u) => (
          <option key={u} value={u}>
            {AREA_UNITS[u].label}
          </option>
        ))}
      </select>
      <select
        value={wb.units.length}
        onChange={(e) => wb.setUnits({ length: e.target.value as LengthUnit })}
        aria-label="Length units"
        className="h-8 rounded-lg bg-secondary px-2 text-xs text-secondary-foreground"
      >
        {(Object.keys(LENGTH_UNITS) as LengthUnit[]).map((u) => (
          <option key={u} value={u}>
            {LENGTH_UNITS[u].label}
          </option>
        ))}
      </select>
    </div>
  );
}
