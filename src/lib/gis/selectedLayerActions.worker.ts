import {
  combineSelectedLayers,
  measureSelectedLayers,
  selectionCollection,
} from "./selectedLayerActions";
import type { SelectionLayer } from "./selectedLayerActions";
self.onmessage = (
  event: MessageEvent<{ action: "combine" | "duplicate" | "measure"; layers: SelectionLayer[] }>,
) => {
  try {
    const { action, layers } = event.data;
    selectionCollection(layers, action === "duplicate");
    const result =
      action === "measure"
        ? measureSelectedLayers(layers)
        : action === "combine"
          ? combineSelectedLayers(layers)
          : layers.map((l) => l.data);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
