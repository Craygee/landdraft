import { Archive, FileDown, FileJson, FileText, Layers3, Printer } from "lucide-react";
import { toast } from "sonner";

import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";
import { downloadProjectFile } from "@/lib/gis/project";
import { exportLayer, type ExportFormat } from "@/lib/gis/export";

const layerFormats: Array<{ id: ExportFormat; label: string }> = [
  { id: "geojson", label: "GeoJSON" },
  { id: "kml", label: "KML" },
  { id: "kmz", label: "KMZ" },
  { id: "shp", label: "Shapefile (.zip)" },
];

export function ExportPanel({ onDone }: { onDone?: () => void }) {
  const wb = useWorkbench();
  const { setPrintOpen } = useMapRef();
  const active = wb.activeLayer;

  const layer = (format: ExportFormat) => {
    if (!active || !wb.canExportLayers) return;
    void exportLayer(active.data, active.name, format, active.style)
      .then(() => {
        toast.success(`${active.name} exported`);
        onDone?.();
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Layer export failed"),
      );
  };

  return (
    <div className="space-y-3 p-3 text-xs">
      <section>
        <h3 className="mb-1.5 flex items-center gap-1.5 font-semibold">
          <FileText className="size-3.5 text-primary" /> Map layout
        </h3>
        <button
          onClick={() => {
            onDone?.();
            setPrintOpen(true);
          }}
          className="flex w-full items-center gap-2 rounded-xl bg-primary px-3 py-2 text-left font-medium text-primary-foreground"
        >
          <Printer className="size-4" />
          <span>
            Open print composer
            <span className="block text-[10px] font-normal opacity-80">
              Titles, legend, page size, annotations and Save as PDF
            </span>
          </span>
        </button>
      </section>

      {wb.canExportLayers && (
        <section className="border-t border-border pt-3">
          <h3 className="mb-1.5 flex items-center gap-1.5 font-semibold">
            <Layers3 className="size-3.5 text-primary" /> Active layer
          </h3>
          <p className="mb-1.5 truncate text-[10px] text-muted-foreground">
            {active ? active.name : "Select a layer first"}
          </p>
          <p className="mb-2 text-[10px] text-muted-foreground">
            KMZ includes colors, transparency and marker images for Google Earth. SHP ZIP includes
            matching SLD style files; load them in your GIS. Hatch and dash support varies by
            format.
          </p>
          <div className="grid grid-cols-2 gap-1">
            {layerFormats.map((format) => (
              <ExportButton
                key={format.id}
                label={format.label}
                disabled={!active}
                onClick={() => layer(format.id)}
              />
            ))}
          </div>
        </section>
      )}
      {wb.canBackupProject && (
        <section className="border-t border-border pt-3">
          <button
            onClick={() => {
              downloadProjectFile(wb.toProjectState());
              toast.success("Project backup exported");
              onDone?.();
            }}
            className="flex w-full items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-left font-medium hover:bg-accent"
          >
            <Archive className="size-4 text-primary" />
            <span>
              Project backup
              <span className="block text-[10px] font-normal text-muted-foreground">
                All layers, styles and project settings
              </span>
            </span>
          </button>
        </section>
      )}
    </div>
  );
}

export function ExportButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1 rounded-xl bg-secondary px-2 py-2 font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label.includes("Geo") ? (
        <FileJson className="size-3.5" />
      ) : (
        <FileDown className="size-3.5" />
      )}
      {label}
    </button>
  );
}
