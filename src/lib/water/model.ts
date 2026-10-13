import { area, bbox, booleanPointInPolygon, booleanIntersects, kinks } from "@turf/turf";
import type { WaterArea, WaterRecord, WaterSourceId } from "./types.ts";

export function validateWaterArea(value: unknown): WaterArea {
  if (JSON.stringify(value)?.length > 150_000)
    throw new Error("Study boundary is too detailed. Simplify it first.");
  const a = value as WaterArea;
  if (a?.type !== "Feature" || !["Polygon", "MultiPolygon"].includes(a.geometry?.type))
    throw new Error("Select a polygon or multipolygon study area.");
  const polygons =
    a.geometry.type === "Polygon" ? [a.geometry.coordinates] : a.geometry.coordinates;
  let count = 0;
  for (const rings of polygons) {
    if (!rings.length) throw new Error("Study boundary is empty.");
    for (const ring of rings) {
      if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))
        throw new Error("Study boundary rings must be closed.");
      for (const p of ring) {
        if (
          ++count > 2000 ||
          p.length < 2 ||
          typeof p[0] !== "number" ||
          typeof p[1] !== "number" ||
          !Number.isFinite(p[0]) ||
          !Number.isFinite(p[1]) ||
          Math.abs(p[0]) > 180 ||
          Math.abs(p[1]) > 90
        )
          throw new Error("Invalid or excessively detailed WGS84 boundary.");
      }
    }
  }
  const clean: WaterArea = { type: "Feature", properties: {}, geometry: a.geometry };
  const b = bbox(clean);
  if (b[2]! - b[0]! > 5 || b[3]! - b[1]! > 5 || area(clean) > 10_000_000_000)
    throw new Error("Choose a smaller study area (under 10,000 km²) for quick analysis.");
  if (area(clean) < 1 || kinks(clean).features.length)
    throw new Error("Study boundary must have area and no self intersections.");
  return clean;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Reviewed against USGS parameter-codes/items/{code}, 2026-09-13. Units remain source values.
const PARAMETERS: Record<string, string> = {
  "00060": "Discharge",
  "00065": "Gauge height",
  "00045": "Precipitation",
  "72019": "Depth to water below land surface",
  "62610": "Groundwater elevation above NGVD29",
  "00095": "Specific conductance at 25°C",
  "00010": "Water temperature",
};
export const waterParameterName = (code: string) => PARAMETERS[code] ?? `Parameter ${code}`;

export function normalizeWaterRecord(
  sourceId: WaterSourceId,
  value: unknown,
  retrievedAt: string,
): WaterRecord | null {
  if (sourceId === "usgs-measurements") return normalizeMeasurement(value, retrievedAt);
  if (sourceId === "twdb-aquifers" || sourceId === "twdb-minor-aquifers")
    return normalizeAquifer(sourceId, value, retrievedAt);
  const f = value as {
    id?: unknown;
    properties?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: number[]; x?: number; y?: number };
  };
  const p = sourceId === "usgs-sites" ? f?.properties : f?.attributes;
  if (!p) return null;
  const coords =
    sourceId === "usgs-sites" ? f.geometry?.coordinates : [f.geometry?.x, f.geometry?.y];
  if (
    !coords ||
    coords.length < 2 ||
    coords.slice(0, 2).some((v) => typeof v !== "number" || !Number.isFinite(v)) ||
    Math.abs(coords[0]!) > 180 ||
    Math.abs(coords[1]!) > 90
  )
    return null;
  if (sourceId === "usgs-sites" && (f.geometry?.type !== "Point" || p["agency_code"] !== "USGS"))
    return null;
  const usgs = sourceId === "usgs-sites";
  const submitted = sourceId === "twdb-well-reports";
  const id = text(
    usgs ? (p["id"] ?? f.id) : submitted ? p["WellReportTrackingNumber"] : p["StateWellNumber"],
  );
  if (!id) return null;
  const rawDepth = number(
    usgs ? p["well_constructed_depth"] : submitted ? p["BoreholeDepthFt"] : p["WellDepth"],
  );
  const flags = [
    "Source-reported record; not independently verified",
    "Measurement date unknown; not evidence of current conditions",
  ];
  if (rawDepth !== null && rawDepth < 0)
    flags.push("Invalid negative depth retained in original record");
  if (!text(p["vertical_datum"])) flags.push("Vertical datum unknown; do not combine elevations");
  if (p["WaterQualityAvailable"] === "Y")
    flags.push("Quality records available at source; chemistry not retrieved");
  if (!usgs && rawDepth !== null)
    flags.push(
      submitted
        ? "Submitted well report identifies BoreholeDepthFt as feet; source value retained"
        : "TWDB Groundwater Data Viewer identifies WellDepth as feet; source value retained",
    );
  const submittedDate = number(p["DateOfWellCompletion"]);
  const observationTime =
    submittedDate !== null && Number.isFinite(submittedDate)
      ? new Date(submittedDate).toISOString()
      : null;
  return {
    id: `${sourceId}:${id}`,
    sourceId,
    sourceRecordId: id,
    name:
      text(p["monitoring_location_name"]) ??
      (submitted ? `Submitted well report ${id}` : `TWDB ${id}`),
    kind: text(usgs ? p["site_type"] : p["WellType"]) ?? "Unknown",
    geometry: { type: "Point", coordinates: [coords[0]!, coords[1]!] },
    classification: "OBSERVED",
    evidence: "Source reported",
    aquifer: submitted
      ? null
      : text(usgs ? (p["aquifer_code"] ?? p["national_aquifer_code"]) : p["AquiferCodeName"]),
    county: text(usgs ? p["county_name"] : submitted ? p["County"] : p["CountyName"]),
    state: usgs ? text(p["state_name"]) : "Texas",
    huc: text(p["hydrologic_unit_code"]),
    depth: rawDepth !== null && rawDepth >= 0 ? rawDepth : null,
    depthUnit: rawDepth !== null && rawDepth >= 0 ? "ft" : null,
    verticalDatum: text(p["vertical_datum"]),
    locationAccuracy: text(p["horizontal_positional_accuracy"]),
    observationTime,
    retrievedAt,
    sourceUrl: usgs
      ? `https://waterdata.usgs.gov/monitoring-location/${encodeURIComponent(id)}/`
      : submitted
        ? `https://www3.twdb.texas.gov/apps/WaterDataInteractive/GroundwaterDataViewer/?map=sdr`
        : `https://www.twdb.texas.gov/groundwater/data/gwdbrpt.asp`,
    raw: p,
    flags,
  };
}

export function measurementAge(time: string | null, now = Date.now()) {
  if (!time || !Number.isFinite(Date.parse(time))) return "Unknown";
  const hours = (now - Date.parse(time)) / 3_600_000;
  if (hours < -1) return "Invalid future timestamp";
  if (hours <= 6) return "Recent sensor reading";
  if (hours <= 24) return "Aging sensor reading";
  if (hours <= 24 * 365) return "Stale sensor reading";
  return "Historical sensor reading";
}

function normalizeMeasurement(value: unknown, retrievedAt: string): WaterRecord | null {
  const f = value as { id?: unknown; properties?: Record<string, unknown>; geometry?: unknown };
  const p = f?.properties;
  if (!p || !text(p["monitoring_location_id"])?.startsWith("USGS-")) return null;
  const site = text(p["monitoring_location_id"])!;
  const record = normalizeWaterRecord(
    "usgs-sites",
    { geometry: f.geometry, properties: { id: site, agency_code: "USGS" } },
    retrievedAt,
  );
  if (!record || !text(f.id) || !text(p["parameter_code"])) return null;
  const originalValue = text(p["value"]) ?? "";
  const parsed = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(originalValue)
    ? Number(originalValue)
    : null;
  const date = text(p["time"]);
  const observationTime = date && Number.isFinite(Date.parse(date)) ? date : null;
  const qualifier = text(p["qualifier"]);
  return {
    ...record,
    classification: qualifier?.toLowerCase().includes("estimat") ? "DERIVED" : "OBSERVED",
    id: `usgs-measurements:${String(f.id)}`,
    sourceId: "usgs-measurements",
    sourceRecordId: String(f.id),
    name: `${site} · ${waterParameterName(String(p["parameter_code"]))}`,
    kind: "Sensor measurement",
    raw: p,
    observationTime,
    measurement: {
      parameterCode: String(p["parameter_code"]),
      originalValue,
      value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
      unit: text(p["unit_of_measure"]),
      approval: text(p["approval_status"]),
      qualifier,
    },
    flags: [
      measurementAge(observationTime, Date.parse(retrievedAt)),
      "Latest means last available, not necessarily current",
      "Parameter code and source units retained; no aquifer or depth interval inferred",
      ...(qualifier
        ? [`Source qualifier: ${qualifier}; value requires source interpretation`]
        : []),
      ...(p["approval_status"] === "Provisional"
        ? ["Provisional USGS data; subject to revision"]
        : []),
    ],
  };
}

export function recordsInside(records: WaterRecord[], a: WaterArea) {
  const seen = new Set<string>();
  return records.filter((r) => {
    if (
      seen.has(r.id) ||
      !(r.geometry.type === "Point"
        ? booleanPointInPolygon(r.geometry, a)
        : booleanIntersects(r.geometry, a))
    )
      return false;
    seen.add(r.id);
    return true;
  });
}

function normalizeAquifer(
  sourceId: "twdb-aquifers" | "twdb-minor-aquifers",
  value: unknown,
  retrievedAt: string,
): WaterRecord | null {
  const f = value as WaterArea & { id?: number };
  if (!f?.properties || !["Polygon", "MultiPolygon"].includes(f.geometry?.type)) return null;
  const id = f.properties["OBJECTID"];
  const name = text(f.properties["AQ_NAME"] ?? f.properties["AQU_NAME"]);
  if (!Number.isInteger(id) || !name) return null;
  const rings =
    f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
  if (
    !rings.length ||
    rings.some(
      (ring) =>
        ring.length < 4 ||
        ring.some(
          (p) =>
            typeof p[0] !== "number" ||
            typeof p[1] !== "number" ||
            !Number.isFinite(p[0]) ||
            !Number.isFinite(p[1]) ||
            Math.abs(p[0]) > 180 ||
            Math.abs(p[1]) > 90,
        ),
    )
  )
    return null;
  return {
    id: `${sourceId}:${String(id)}`,
    sourceId,
    sourceRecordId: String(id),
    name,
    kind:
      sourceId === "twdb-aquifers"
        ? "Published major aquifer extent"
        : "Published minor aquifer extent",
    geometry: f.geometry,
    classification: "INFERRED",
    evidence: "Source reported",
    aquifer: name,
    county: null,
    state: "Texas",
    huc: null,
    depth: null,
    depthUnit: null,
    verticalDatum: null,
    locationAccuracy: null,
    observationTime: null,
    retrievedAt,
    sourceUrl:
      sourceId === "twdb-aquifers"
        ? "https://www.twdb.texas.gov/groundwater/aquifer/major.asp"
        : "https://www.twdb.texas.gov/groundwater/aquifer/minor.asp",
    raw: f.properties,
    flags: [
      "Published geologic interpretation; not proof of productive or accessible water",
      "Mapped extent does not establish depth, thickness, saturation, rights or yield",
      "Source geometry simplified to 0.001 degrees for display; not a survey boundary",
      "Dataset observation/version date unavailable in this response",
    ],
  };
}
export function waterCsv(records: WaterRecord[]) {
  const cell = (v: unknown) =>
    `"${String(v ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const columns: (keyof WaterRecord)[] = [
    "id",
    "name",
    "kind",
    "aquifer",
    "county",
    "state",
    "huc",
    "depth",
    "depthUnit",
    "verticalDatum",
    "locationAccuracy",
    "classification",
    "evidence",
    "observationTime",
    "retrievedAt",
    "sourceUrl",
  ];
  return [
    [...columns, "parameterCode", "measurementValue", "measurementUnit", "approval", "qualifier"]
      .map(cell)
      .join(","),
    ...records.map((r) =>
      [
        ...columns.map((c) => r[c]),
        r.measurement?.parameterCode,
        r.measurement?.originalValue,
        r.measurement?.unit,
        r.measurement?.approval,
        r.measurement?.qualifier,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
}
