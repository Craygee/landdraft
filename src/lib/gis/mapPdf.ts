import type { Map as MlMap } from "maplibre-gl";
import type { GisLayer, PrintComposition, PrintPaper } from "./types";
import type { Feature } from "geojson";
import { legendDashArray, legendSymbolForLayer } from "./legendSymbol";
import { PRINT_DPI, printPageGeometry } from "./printLayout";

export type MapPaper = PrintPaper;

export async function createMapSnapshotBlob(
  map: MlMap,
  format: "png" | "pdf" = "pdf",
): Promise<Blob> {
  const source = map.getCanvas();
  if (format === "png")
    return new Promise<Blob>((resolve, reject) =>
      source.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Map image could not be created"))),
        "image/png",
      ),
    );
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Map PDF canvas is unavailable");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  const jpeg = await canvasToJpeg(canvas);
  return buildSingleImagePdf(
    jpeg,
    canvas.width,
    canvas.height,
    (canvas.width / PRINT_DPI) * 72,
    (canvas.height / PRINT_DPI) * 72,
  );
}

export async function exportMapPdf(
  map: MlMap,
  projectName: string,
  layers: GisLayer[],
  paper: MapPaper = "letter",
  orientation: PrintComposition["orientation"] = "landscape",
) {
  const geometry = printPageGeometry(paper, orientation);
  const page = { width: geometry.widthPixels, height: geometry.heightPixels };
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF canvas is not available");

  const margin = 34;
  const header = 66;
  const footer = 36;
  const legendWidth = 190;
  const mapWidth = page.width - margin * 2 - legendWidth;
  const mapHeight = page.height - margin * 2 - header - footer;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.fillStyle = "#17251b";
  ctx.font = "700 24px Arial, sans-serif";
  ctx.fillText(projectName || "Map", margin, margin + 25);
  ctx.fillStyle = "#617066";
  ctx.font = "12px Arial, sans-serif";
  ctx.fillText(
    `Created ${new Date().toLocaleString()} · WGS84 · zoom ${map.getZoom().toFixed(1)}`,
    margin,
    margin + 47,
  );

  ctx.drawImage(map.getCanvas(), margin, margin + header, mapWidth, mapHeight);
  ctx.strokeStyle = "#9ba59e";
  ctx.strokeRect(margin, margin + header, mapWidth, mapHeight);

  let y = margin + header + 14;
  const legendX = margin + mapWidth + 22;
  ctx.fillStyle = "#17251b";
  ctx.font = "700 15px Arial, sans-serif";
  ctx.fillText("Visible layers", legendX, y);
  y += 24;
  ctx.font = "12px Arial, sans-serif";
  for (const layer of layers.filter((item) => item.visible).slice(0, 22)) {
    drawLegendSwatch(ctx, layer, legendX, y - 12, 26, 14);
    ctx.fillStyle = "#27332b";
    ctx.fillText(ellipsize(layer.name, 22), legendX + 34, y);
    y += 22;
  }

  ctx.fillStyle = "#6a746d";
  ctx.font = "10px Arial, sans-serif";
  ctx.fillText(
    "Planning/reference map only. Verify legal boundaries and ownership with county records and a licensed surveyor.",
    margin,
    page.height - margin + 5,
  );

  const jpeg = await canvasToJpeg(canvas);
  const blob = buildSingleImagePdf(
    jpeg,
    page.width,
    page.height,
    geometry.widthPoints,
    geometry.heightPoints,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(projectName || "map").replace(/[^a-z0-9_-]+/gi, "_")}_${paper}_${orientation}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportAnalysisReportPdf(
  map: MlMap,
  projectName: string,
  layers: GisLayer[],
  options: {
    title: string;
    summary: string;
    features?: Feature[];
    sourceLayerName?: string;
  },
) {
  const page = { width: 1191, height: 842 };
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Report canvas is not available");
  const features = options.features ?? [];

  ctx.fillStyle = "#fbfaf4";
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.fillStyle = "#1f7044";
  ctx.fillRect(0, 0, page.width, 12);
  ctx.fillStyle = "#17251b";
  ctx.font = "700 27px Arial, sans-serif";
  ctx.fillText(options.title || "LandDraft GIS report", 38, 55);
  ctx.fillStyle = "#617066";
  ctx.font = "12px Arial, sans-serif";
  ctx.fillText(`${projectName} · ${new Date().toLocaleString()} · WGS84`, 38, 78);

  const mapX = 38;
  const mapY = 104;
  const mapWidth = 720;
  const mapHeight = 520;
  ctx.drawImage(map.getCanvas(), mapX, mapY, mapWidth, mapHeight);
  ctx.strokeStyle = "#aeb7b0";
  ctx.strokeRect(mapX, mapY, mapWidth, mapHeight);

  const panelX = 786;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(panelX, mapY, 367, 650);
  ctx.strokeStyle = "#d7dcd7";
  ctx.strokeRect(panelX, mapY, 367, 650);
  ctx.fillStyle = "#17251b";
  ctx.font = "700 15px Arial, sans-serif";
  ctx.fillText("Analysis", panelX + 20, mapY + 30);
  ctx.font = "12px Arial, sans-serif";
  ctx.fillStyle = "#3f4d43";
  let y = mapY + 54;
  y = drawWrappedText(ctx, options.summary, panelX + 20, y, 327, 17) + 14;

  ctx.font = "700 13px Arial, sans-serif";
  ctx.fillStyle = "#17251b";
  ctx.fillText("Result", panelX + 20, y);
  y += 22;
  ctx.font = "12px Arial, sans-serif";
  ctx.fillStyle = "#3f4d43";
  ctx.fillText(
    `${features.length.toLocaleString()} matching feature${features.length === 1 ? "" : "s"}`,
    panelX + 20,
    y,
  );
  y += 18;
  if (options.sourceLayerName) {
    ctx.fillText(`Layer: ${ellipsize(options.sourceLayerName, 42)}`, panelX + 20, y);
    y += 18;
  }
  ctx.fillText(`Visible layers: ${layers.filter((layer) => layer.visible).length}`, panelX + 20, y);
  y += 28;

  const sampleProperties = features
    .slice(0, 8)
    .map((feature) => feature.properties ?? {})
    .flatMap((properties) => Object.entries(properties).filter(([key]) => !key.startsWith("__")))
    .slice(0, 18);
  if (sampleProperties.length) {
    ctx.font = "700 13px Arial, sans-serif";
    ctx.fillStyle = "#17251b";
    ctx.fillText("Selected attributes", panelX + 20, y);
    y += 20;
    ctx.font = "11px Arial, sans-serif";
    for (const [key, value] of sampleProperties) {
      if (y > mapY + 620) break;
      ctx.fillStyle = "#617066";
      ctx.fillText(ellipsize(key, 19), panelX + 20, y);
      ctx.fillStyle = "#27332b";
      ctx.fillText(ellipsize(String(value ?? ""), 31), panelX + 146, y);
      y += 17;
    }
  }

  ctx.fillStyle = "#17251b";
  ctx.font = "700 13px Arial, sans-serif";
  ctx.fillText("Visible layers", mapX, 660);
  let legendX = mapX;
  let legendY = 685;
  for (const layer of layers.filter((item) => item.visible).slice(0, 15)) {
    drawLegendSwatch(ctx, layer, legendX, legendY - 11, 26, 13);
    ctx.fillStyle = "#27332b";
    ctx.font = "11px Arial, sans-serif";
    ctx.fillText(ellipsize(layer.name, 23), legendX + 32, legendY);
    legendX += 235;
    if (legendX > 700) {
      legendX = mapX;
      legendY += 22;
    }
  }

  ctx.fillStyle = "#6a746d";
  ctx.font = "10px Arial, sans-serif";
  ctx.fillText(
    "Planning/reference report only. Verify legal boundaries, ownership and regulated conditions with the publishing authority.",
    38,
    813,
  );

  const jpeg = await canvasToJpeg(canvas);
  const blob = buildSingleImagePdf(jpeg, page.width, page.height, 841.89, 595.28);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(options.title || "LandDraft_report").replace(/[^a-z0-9_-]+/gi, "_")}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function drawLegendSwatch(
  ctx: CanvasRenderingContext2D,
  layer: GisLayer,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const symbol = legendSymbolForLayer(layer);
  const centerY = y + height / 2;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);

  if (symbol.kind === "point") {
    if (symbol.markerIcon) {
      ctx.fillStyle = symbol.markerColor;
      ctx.globalAlpha = 1;
      ctx.font = `${Math.max(9, Math.min(14, symbol.markerSize * 0.7))}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(symbol.markerIcon, x + width / 2, centerY);
    } else {
      const radius = Math.max(3, Math.min(height / 2 - 2, symbol.markerSize / 2));
      ctx.beginPath();
      ctx.arc(x + width / 2, centerY, radius, 0, Math.PI * 2);
      ctx.globalAlpha = Math.max(0.35, symbol.fillOpacity);
      ctx.fillStyle = symbol.fillColor;
      ctx.fill();
      ctx.globalAlpha = symbol.strokeOpacity;
      ctx.strokeStyle = symbol.strokeColor;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (symbol.kind === "image") {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = symbol.fillColor;
    ctx.fillRect(x + 3, y + 3, width - 6, height - 6);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = symbol.strokeColor;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + height - 3);
    ctx.lineTo(x + width * 0.35, y + height * 0.4);
    ctx.lineTo(x + width * 0.55, y + height * 0.7);
    ctx.lineTo(x + width * 0.76, y + height * 0.3);
    ctx.lineTo(x + width - 3, y + height - 3);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (symbol.kind === "polygon") {
    const left = x + 3;
    const top = y + 3;
    const innerWidth = width - 6;
    const innerHeight = height - 6;
    ctx.globalAlpha = Math.max(0.12, symbol.fillOpacity);
    ctx.fillStyle = symbol.fillColor;
    ctx.fillRect(left, top, innerWidth, innerHeight);
    ctx.globalAlpha = symbol.strokeOpacity;
    ctx.strokeStyle = symbol.strokeColor;
    ctx.lineWidth = Math.max(1, Math.min(3, symbol.strokeWidth));
    ctx.setLineDash(legendDashArray(symbol.strokePattern));
    ctx.strokeRect(left, top, innerWidth, innerHeight);
    if (symbol.fillPattern !== "solid") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, innerWidth, innerHeight);
      ctx.clip();
      ctx.globalAlpha = Math.max(0.5, symbol.strokeOpacity);
      ctx.lineWidth = 0.8;
      ctx.setLineDash([]);
      const spacing = 4;
      if (symbol.fillPattern === "dotted") {
        ctx.fillStyle = symbol.strokeColor;
        for (let px = left + 2; px < left + innerWidth; px += spacing)
          for (let py = top + 2; py < top + innerHeight; py += spacing) {
            ctx.beginPath();
            ctx.arc(px, py, 0.7, 0, Math.PI * 2);
            ctx.fill();
          }
      } else {
        const horizontal =
          symbol.fillPattern === "horizontal" || symbol.fillPattern === "crosshatch";
        const vertical = symbol.fillPattern === "vertical" || symbol.fillPattern === "crosshatch";
        if (horizontal)
          for (let py = top + 2; py < top + innerHeight; py += spacing) {
            ctx.beginPath();
            ctx.moveTo(left, py);
            ctx.lineTo(left + innerWidth, py);
            ctx.stroke();
          }
        if (vertical)
          for (let px = left + 2; px < left + innerWidth; px += spacing) {
            ctx.beginPath();
            ctx.moveTo(px, top);
            ctx.lineTo(px, top + innerHeight);
            ctx.stroke();
          }
        if (symbol.fillPattern === "diagonal")
          for (let offset = -innerHeight; offset < innerWidth; offset += spacing) {
            ctx.beginPath();
            ctx.moveTo(left + offset, top + innerHeight);
            ctx.lineTo(left + offset + innerHeight, top);
            ctx.stroke();
          }
      }
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  const lineStart = x + 3;
  const lineEnd = x + width - 3;
  if (symbol.kind === "pipeline") {
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = Math.max(4.5, symbol.strokeWidth + 2.5);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lineStart, centerY);
    ctx.lineTo(lineEnd, centerY);
    ctx.stroke();
  }
  ctx.globalAlpha = symbol.strokeOpacity;
  ctx.strokeStyle = symbol.strokeColor;
  ctx.lineWidth = Math.max(1.4, Math.min(5, symbol.strokeWidth));
  ctx.setLineDash(legendDashArray(symbol.strokePattern));
  ctx.lineCap = symbol.strokePattern === "dotted" ? "round" : "butt";
  ctx.beginPath();
  ctx.moveTo(lineStart, centerY);
  ctx.lineTo(lineEnd, centerY);
  ctx.stroke();
  if (symbol.kind === "pipeline") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y + 3);
    ctx.lineTo(x + width / 2, y + height - 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(/\s+/);
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else line = candidate;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}

const ellipsize = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Map image could not be created"))),
      "image/jpeg",
      0.92,
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Minimal standards-compliant one-page PDF containing the composed JPEG map sheet. */
function buildSingleImagePdf(
  jpeg: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  pageWidth = imageWidth,
  pageHeight = imageHeight,
): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | Uint8Array, suffix = "") => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    push(body);
    push(`${suffix}\nendobj\n`);
  };

  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Map 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = length;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");
  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Map Do Q`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let id = 1; id <= 5; id += 1)
    push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
