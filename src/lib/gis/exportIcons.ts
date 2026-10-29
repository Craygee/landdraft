import { iconKey, resolveExportStyle, type StyledExportLayer } from "./exportStyle";
/** Freeze browser-rendered marker glyphs as portable PNGs before invoking the export worker. */
export async function withExportIcons<T extends StyledExportLayer>(
  layer: T,
): Promise<T & { exportIcons?: Record<string, string> }> {
  if (!layer.style || typeof document === "undefined") return layer;
  const exportIcons: Record<string, string> = {};
  for (const feature of layer.data.features) {
    const style = resolveExportStyle(layer.style, feature.properties);
    const key = iconKey(style);
    if (exportIcons[key]) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Marker image export is unavailable in this browser.");
    ctx.fillStyle = style.iconColor;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    if (style.icon) {
      ctx.font = '44px "Segoe UI Symbol", "Apple Color Emoji", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeText(style.icon, 32, 32);
      ctx.fillText(style.icon, 32, 32);
    } else {
      ctx.beginPath();
      ctx.arc(32, 32, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    exportIcons[key] = canvas.toDataURL("image/png");
  }
  return { ...layer, exportIcons };
}
