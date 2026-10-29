import { checkedLayersArchive } from "./selectedLayerExport";
import type { ExportItemMode, ExportSelectionLayer } from "./selectedLayerExport";
self.onmessage = async (
  event: MessageEvent<{
    layers: ExportSelectionLayer[];
    format: "kmz" | "shp";
    mode: ExportItemMode;
  }>,
) => {
  try {
    const { layers, format, mode } = event.data;
    const bytes = await checkedLayersArchive(layers, format, mode);
    self.postMessage({ bytes }, { transfer: [bytes.buffer as ArrayBuffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
