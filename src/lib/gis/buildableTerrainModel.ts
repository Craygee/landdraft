/** USGS numeric DEM grid, not a rendered slope/colour image. No third-party account required. */
export const BUILDABLE_DEM_URL =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";
export interface TerrainGridRequest {
  bbox: [number, number, number, number];
  width: number;
  height: number;
  epsg: number;
}
export interface TerrainGrid extends TerrainGridRequest {
  values: (number | null)[];
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  productDate: string | null;
  sourceResolutionM: number | null;
  verticalDatum: string;
}
export function validateGridRequest(value: unknown): value is TerrainGridRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as TerrainGridRequest;
  return (
    Array.isArray(v.bbox) &&
    v.bbox.length === 4 &&
    v.bbox.every(Number.isFinite) &&
    Number.isInteger(v.width) &&
    Number.isInteger(v.height) &&
    v.width >= 3 &&
    v.height >= 3 &&
    v.width <= 256 &&
    v.height <= 256 &&
    Number.isInteger(v.epsg) &&
    ((v.epsg >= 32601 && v.epsg <= 32660) || (v.epsg >= 32701 && v.epsg <= 32760)) &&
    v.bbox[0] >= 100000 &&
    v.bbox[2] <= 900000 &&
    v.bbox[1] >= 0 &&
    v.bbox[3] <= 10000000 &&
    v.bbox[2] > v.bbox[0] &&
    v.bbox[3] > v.bbox[1] &&
    (v.bbox[2] - v.bbox[0]) / v.width >= 9.99 &&
    (v.bbox[3] - v.bbox[1]) / v.height >= 9.99 &&
    (v.bbox[2] - v.bbox[0]) / v.width <= 60.01 &&
    (v.bbox[3] - v.bbox[1]) / v.height <= 60.01
  );
}
/** ArcGIS BIP F32 is little-endian pixels followed by a row-major MSB-first validity bitmask. */
export function decodeElevationBip(
  buffer: ArrayBuffer,
  width: number,
  height: number,
): (number | null)[] {
  const count = width * height,
    bytes = new Uint8Array(buffer),
    pixelBytes = count * 4;
  if (bytes.length !== pixelBytes + Math.ceil(count / 8))
    throw new Error("USGS returned an unexpected raster size or missing no-data mask.");
  const view = new DataView(buffer);
  return Array.from({ length: count }, (_, i) => {
    const valid = (bytes[pixelBytes + (i >> 3)]! & (128 >> (i & 7))) !== 0,
      value = view.getFloat32(i * 4, true);
    return valid && Number.isFinite(value) && value >= -12000 && value <= 10000 ? value : null;
  });
}
