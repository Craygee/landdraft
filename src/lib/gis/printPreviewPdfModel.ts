import { printPageGeometry } from "./printLayout.ts";
import type { PrintPaper, PrintComposition } from "./types.ts";
/** Keep mobile canvas allocations bounded while retaining up to 192 DPI. PDF physical dimensions never change. */
export function previewPdfGeometry(
  paper: PrintPaper,
  orientation: PrintComposition["orientation"],
) {
  const page = printPageGeometry(paper, orientation);
  const scale = Math.min(
    2,
    Math.sqrt(3_000_000 / (page.widthPixels * page.heightPixels)),
    4096 / Math.max(page.widthPixels, page.heightPixels),
  );
  return {
    ...page,
    scale,
    rasterWidth: Math.floor(page.widthPixels * scale),
    rasterHeight: Math.floor(page.heightPixels * scale),
  };
}
