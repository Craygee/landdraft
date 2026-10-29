import type { LayerStyle } from "./types";
import { withExportIcons } from "./exportIcons";
import { toast } from "sonner";
import type { FeatureCollection } from "geojson";
import { toKml } from "./exportGeometry";
export { toKml } from "./exportGeometry";

export type ExportFormat = "geojson" | "kml" | "kmz" | "shp";

const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "layer";

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Keep a user-initiated fallback available when mobile Safari blocks an
  // automatic download after asynchronous ZIP generation.
  toast("File ready: " + filename, {
    duration: 20000,
    action: {
      label: "Save file",
      onClick: () => {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.target = "_blank";
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
    },
  });
  setTimeout(() => URL.revokeObjectURL(url), 300000);
}
const download = downloadFile;

export async function exportLayer(
  fc: FeatureCollection,
  layerName: string,
  format: ExportFormat,
  style?: LayerStyle,
): Promise<void> {
  const base = safeName(layerName);
  if (format === "geojson") {
    download(
      new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" }),
      `${base}.geojson`,
    );
    return;
  }
  if (format === "kml") {
    download(
      new Blob([toKml(fc, layerName, style)], { type: "application/vnd.google-earth.kml+xml" }),
      `${base}.kml`,
    );
    return;
  }
  if ((format === "kmz" || format === "shp") && style) {
    const { checkedLayersArchive } = await import("./selectedLayerExport");
    const layer = await withExportIcons({ id: "layer", name: layerName, data: fc, style });
    const bytes = await checkedLayersArchive([layer], format, "features");
    download(
      new Blob([bytes.buffer as ArrayBuffer], {
        type: format === "kmz" ? "application/vnd.google-earth.kmz" : "application/zip",
      }),
      `${base}.${format === "kmz" ? "kmz" : "zip"}`,
    );
    return;
  }
  if (format === "kmz") {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("doc.kml", toKml(fc, layerName, style));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    download(blob, `${base}.kmz`);
    return;
  }
  await exportShapefileZip(fc, base);
}

/** Zipped Shapefile: geometry types are split into separate .shp members. */
async function exportShapefileZip(fc: FeatureCollection, base: string): Promise<void> {
  const { shapefileArchive } = await import("./selectedLayerExport");
  const bytes = await shapefileArchive(fc);
  download(
    new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }),
    `${base}_shapefile.zip`,
  );
}
