import { bbox } from "@turf/turf";
import { WATER_SOURCES } from "./registry.ts";
import { normalizeWaterRecord, recordsInside, validateWaterArea } from "./model.ts";
import type { WaterArea, WaterSourceId, WaterSourceResult } from "./types.ts";

const inFlight = new Map<string, Promise<WaterSourceResult>>();
let active = 0;
// No persistent shared cache of study geometry or project records. Runtime deduplication only.
export async function fetchWaterSource(
  sourceId: WaterSourceId,
  input: WaterArea,
): Promise<WaterSourceResult> {
  const area = validateWaterArea(input);
  const source = WATER_SOURCES.find((s) => s.id === sourceId);
  if (!source?.enabled || source.license !== "PUBLIC_OPEN")
    throw new Error("Water source is disabled or requires license review.");
  const key = JSON.stringify([sourceId, area.geometry]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (active >= 6) throw new Error("Water analysis is busy. Please retry shortly.");
  const task = query();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }

  async function query(): Promise<WaterSourceResult> {
    active++;
    const retrievedAt = new Date().toISOString();
    const base: WaterSourceResult = {
      sourceId,
      status: "unavailable",
      retrievedAt,
      records: [],
      message: "",
      truncated: false,
      requestUrl: "",
      rejectedCount: 0,
    };
    try {
      const b = bbox(area);
      if (
        sourceId.startsWith("twdb-") &&
        (b[2]! < -106.7 || b[0]! > -93.4 || b[3]! < 25.7 || b[1]! > 36.6)
      )
        return {
          ...base,
          status: "outside-coverage",
          message: "TWDB covers Texas. No request made.",
        };
      const url = new URL(source!.endpoint);
      if (sourceId.startsWith("usgs-")) {
        url.search = new URLSearchParams({
          f: "json",
          bbox: b.join(","),
          limit: "1000",
        }).toString();
      } else {
        url.search = new URLSearchParams({
          f: "json",
          where: "1=1",
          geometry: b.join(","),
          geometryType: "esriGeometryEnvelope",
          inSR: "4326",
          outSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outFields:
            sourceId === "twdb-well-reports"
              ? "ObjectId,WellReportTrackingNumber,WellType,ProposedUse,County,DateOfWellCompletion,BoreholeDepthFt,LocationError"
              : "ObjectId,StateWellNumber,PrimaryWaterUse,Elevation,WaterLevelObservationType,WaterQualityAvailable,AquiferCodeName,CountyName,WellType,WellDepth",
          returnGeometry: "true",
          orderByFields: "ObjectId",
          resultRecordCount: "1000",
        }).toString();
      }
      if (sourceId === "twdb-aquifers" || sourceId === "twdb-minor-aquifers") {
        url.searchParams.set("f", "geojson");
        url.searchParams.set(
          "outFields",
          sourceId === "twdb-aquifers" ? "OBJECTID,AQUIFER,AQ_NAME" : "OBJECTID,AQUIFER,AQU_NAME",
        );
        url.searchParams.set("orderByFields", "OBJECTID");
        url.searchParams.set("maxAllowableOffset", "0.001");
      }
      base.requestUrl = url.toString();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        return {
          ...base,
          status: response.status === 429 ? "rate-limited" : "unavailable",
          message: `Source returned HTTP ${response.status}. Other sources remain usable.`,
        };
      const payload = await response.text();
      if (payload.length > 8_000_000) throw new Error("Source response too large");
      const data = JSON.parse(payload) as {
        features?: unknown[];
        error?: unknown;
        exceededTransferLimit?: boolean;
        links?: { rel?: string }[];
      };
      if (data.error || !Array.isArray(data.features))
        return {
          ...base,
          message: "Source schema changed or returned an error; no records inferred.",
        };
      const normalized = data.features
        .slice(0, 1000)
        .map((f) => normalizeWaterRecord(sourceId, f, retrievedAt));
      const records = recordsInside(
        normalized.filter((r) => r !== null),
        area,
      );
      const truncated =
        data.exceededTransferLimit === true ||
        data.links?.some((l) => l.rel === "next") === true ||
        data.features.length > 1000;
      const rejectedCount = normalized.filter((r) => !r).length;
      return {
        ...base,
        records,
        truncated,
        rejectedCount,
        status: truncated || rejectedCount ? "degraded" : "available",
        message: truncated
          ? "Partial inventory: source limit reached. Use a smaller area; counts are not complete."
          : records.length
            ? `${records.length} source records within the boundary. Inventory is not a water-availability assessment.`
            : "No records returned within this boundary. This does not establish absence of water.",
      };
    } catch {
      return {
        ...base,
        message:
          "Source unavailable, timed out or returned an invalid response. Retry or investigate the original source.",
      };
    } finally {
      active--;
    }
  }
}
