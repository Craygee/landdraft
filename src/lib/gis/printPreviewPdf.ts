import { buildSingleImagePdf, canvasToJpeg } from "./imagePdf";
import { previewPdfGeometry } from "./printPreviewPdfModel";
import type { PrintPaper, PrintComposition } from "./types";

/** Capture the existing composed page, not a second approximation of its layout. */
export async function createPrintPreviewPdf(
  page: HTMLElement,
  paper: PrintPaper,
  orientation: PrintComposition["orientation"],
  signal?: AbortSignal,
): Promise<Blob> {
  if (!page.isConnected) throw new Error("The print preview is no longer open.");
  const geometry = previewPdfGeometry(paper, orientation);
  const { default: html2canvas } = await import("html2canvas-pro");
  await document.fonts.ready;
  await Promise.all(
    Array.from(page.querySelectorAll("img")).map(async (image) => {
      if (!image.complete) await image.decode();
      if (!image.naturalWidth)
        throw new Error("A preview image is not ready. Wait for it to load, then retry.");
    }),
  );
  if (signal?.aborted || !page.isConnected)
    throw new DOMException("PDF export cancelled", "AbortError");
  // Freeze the WebGL map pixels before cloning. A normal DOM clone cannot retain a live WebGL context.
  const canvases = Array.from(page.querySelectorAll("canvas"));
  const snapshots = canvases.map((canvas) => canvas.toDataURL("image/png"));
  const resourceErrors: Error[] = [];
  const canvas = await html2canvas(page, {
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    allowTaint: false,
    imageTimeout: 15000,
    width: geometry.widthPixels,
    height: geometry.heightPixels,
    scale: geometry.scale,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    scrollX: 0,
    scrollY: 0,
    normalizeDom: true,
    ...(signal ? { signal } : {}),
    ignoreElements: (element) =>
      element.hasAttribute("data-print-editor-only") ||
      element.classList.contains("maplibregl-ctrl-top-left") ||
      element.classList.contains("print-composer-ui"),
    onError: (error) => resourceErrors.push(error),
    onclone: (_document, clone) => {
      // Remove only preview magnification and ancestor clipping. Keep all child transforms:
      // markers, moved legends, and annotations depend on those for their exact placement.
      let ancestor = clone.parentElement;
      while (ancestor) {
        ancestor.style.setProperty("transform", "none", "important");
        ancestor.style.setProperty("translate", "none", "important");
        ancestor.style.setProperty("overflow", "visible", "important");
        ancestor = ancestor.parentElement;
      }
      Object.assign(clone.style, {
        transform: "none",
        translate: "none",
        position: "fixed",
        left: "0",
        top: "0",
        margin: "0",
        width: `${geometry.widthPixels}px`,
        height: `${geometry.heightPixels}px`,
        boxShadow: "none",
        overflow: "hidden",
      });
      clone.querySelectorAll<HTMLElement>("[data-print-selected]").forEach((element) => {
        element.style.setProperty("--tw-ring-shadow", "0 0 #0000");
        element.style.setProperty("--tw-ring-offset-shadow", "0 0 #0000");
      });
      clone.querySelectorAll("canvas").forEach((element, index) => {
        const image = _document.createElement("img");
        image.src = snapshots[index]!;
        image.width = element.width;
        image.height = element.height;
        image.className = element.className;
        image.style.cssText = element.style.cssText;
        image.style.objectFit = "fill";
        image.alt = "Rendered map";
        element.replaceWith(image);
      });
    },
  });
  try {
    if (resourceErrors.length)
      throw new Error(`A preview resource could not be captured: ${resourceErrors[0]!.message}`);
    if (signal?.aborted) throw new DOMException("PDF export cancelled", "AbortError");
    const jpeg = await canvasToJpeg(canvas);
    return buildSingleImagePdf(
      jpeg,
      canvas.width,
      canvas.height,
      geometry.widthPoints,
      geometry.heightPoints,
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
