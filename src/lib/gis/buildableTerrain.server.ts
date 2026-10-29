import {
  BUILDABLE_DEM_URL,
  decodeElevationBip,
  validateGridRequest,
} from "./buildableTerrainModel.ts";
import type { TerrainGrid } from "./buildableTerrainModel.ts";
let product: { date: string | null; expires: number } | null = null;
async function productDate(): Promise<string | null> {
  if (product && product.expires > Date.now()) return product.date;
  try {
    const response = await fetch(BUILDABLE_DEM_URL + "?f=json", {
      signal: AbortSignal.timeout(8000),
    });
    const metadata = (await response.json()) as { copyrightText?: string };
    const date = metadata.copyrightText?.slice(0, 500) ?? null;
    product = { date, expires: Date.now() + 86400000 };
    return date;
  } catch {
    return null;
  }
}
export async function handleBuildableTerrainRequest(request: Request): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/analysis/buildable-terrain") return null;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const raw = await request.text();
    if (raw.length > 2000)
      return Response.json({ error: "Terrain request too large" }, { status: 400 });
    const body: unknown = JSON.parse(raw);
    if (!validateGridRequest(body))
      return Response.json(
        { error: "Use a 3–256 cell local UTM grid with 10–60 metre spacing." },
        { status: 400 },
      );
    const url = new URL(BUILDABLE_DEM_URL + "/exportImage");
    url.search = new URLSearchParams({
      bbox: body.bbox.join(","),
      bboxSR: String(body.epsg),
      imageSR: String(body.epsg),
      size: `${body.width},${body.height}`,
      format: "bip",
      pixelType: "F32",
      bandIds: "0",
      interpolation: "RSP_NearestNeighbor",
      adjustAspectRatio: "false",
      renderingRule: JSON.stringify({ rasterFunction: "None" }),
      f: "image",
    }).toString();
    const [response, date] = await Promise.all([
      fetch(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(35000)]) }),
      productDate(),
    ]);
    if (!response.ok) throw new Error(`USGS DEM service returned HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 300000)
      throw new Error("USGS raster response exceeds the bounded grid budget.");
    const values = decodeElevationBip(bytes, body.width, body.height);
    if (values.every((v) => v === null))
      throw new Error("USGS returned no valid terrain coverage for this area.");
    const grid: TerrainGrid = {
      ...body,
      values,
      source: "USGS 3DEP bare-earth DEM — numeric grid",
      sourceUrl: BUILDABLE_DEM_URL,
      retrievedAt: new Date().toISOString(),
      productDate: date,
      sourceResolutionM: null,
      verticalDatum: "Source DEM vertical datum varies; verify before engineering use",
    };
    return Response.json(grid, { headers: { "cache-control": "private, max-age=3600" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "USGS terrain could not load" },
      { status: 503 },
    );
  }
}
