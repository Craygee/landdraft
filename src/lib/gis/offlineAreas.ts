import {
  OFFLINE_AREA_FEATURE,
  validateOfflineBounds,
  validateOfflineComplexity,
} from "./offlineAreaPolicy";
export { OFFLINE_AREA_FEATURE, validateOfflineBounds } from "./offlineAreaPolicy";
import type { FeatureCollection } from "geojson";
import { fetchRemoteGeoJSONPaged } from "./arcgis";
import { TEXAS_PARCEL_URL } from "./texasParcels";
import { buildParcelLabels } from "./parcelDisplay";
import { defaultStyle, type GisLayer } from "./types";

export interface OfflineArea {
  id: string;
  userId: string;
  name: string;
  bounds: [number, number, number, number];
  savedAt: string;
  bytes: number;
  parcels: FeatureCollection;
  labels: FeatureCollection;
  roads: FeatureCollection;
  coverage: string;
  attribution: string;
}
export type OfflineAreaSummary = Omit<OfflineArea, "parcels" | "roads" | "labels">;
const summary = (area: OfflineArea): OfflineAreaSummary => ({
  id: area.id,
  userId: area.userId,
  name: area.name,
  bounds: area.bounds,
  savedAt: area.savedAt,
  bytes: area.bytes,
  coverage: area.coverage,
  attribution: area.attribution,
});
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("landdraft-offline-areas-v1", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("areas"))
        request.result.createObjectStore("areas", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("metadata")) {
        const metadata = request.result.createObjectStore("metadata", { keyPath: "id" });
        const cursor = request.transaction!.objectStore("areas").openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) {
            metadata.put(summary(cursor.result.value as OfflineArea));
            cursor.result.continue();
          }
        };
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
export async function listOfflineAreas(userId: string): Promise<OfflineAreaSummary[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("metadata", "readonly");
    const request = tx.objectStore("metadata").getAll();
    request.onsuccess = () =>
      resolve((request.result as OfflineAreaSummary[]).filter((area) => area.userId === userId));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
export async function deleteOfflineArea(id: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["areas", "metadata"], "readwrite");
    tx.objectStore("areas").delete(id);
    tx.objectStore("metadata").delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function prepareOfflineViewer() {
  if (!window.isSecureContext || !("serviceWorker" in navigator))
    throw new Error("Offline downloads require a supported browser over HTTPS (or localhost)");
  const registration = await navigator.serviceWorker.register("/offline-sw.js", {
    scope: "/offline.html",
  });
  await registration.update();
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error("The offline viewer could not be installed");
  if (worker.state !== "activated")
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.removeEventListener("statechange", check);
        reject(new Error("Offline viewer installation timed out; retry while online"));
      }, 20000);
      const check = () => {
        if (worker.state === "activated" || worker.state === "redundant") {
          clearTimeout(timeout);
          worker.removeEventListener("statechange", check);
          if (worker.state === "activated") resolve();
          else reject(new Error("Offline viewer installation failed"));
        }
      };
      worker.addEventListener("statechange", check);
      check();
    });
}
export async function downloadOfflineArea(input: {
  userId: string;
  name: string;
  bounds: OfflineArea["bounds"];
  parcels: boolean;
  roads: boolean;
  signal: AbortSignal;
  progress: (message: string) => void;
}) {
  validateOfflineBounds(input.bounds);
  if (!input.parcels && !input.roads) throw new Error("Choose parcels or roads to download");
  const existing = await listOfflineAreas(input.userId);
  if (existing.length >= OFFLINE_AREA_FEATURE.maxPacks)
    throw new Error("Remove an old download before adding another offline area");
  input.progress("Installing offline viewer…");
  await prepareOfflineViewer();
  const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });
  let parcels = empty();
  const roads = empty();
  const load = async (url: string, max: number) => {
    const result = await fetchRemoteGeoJSONPaged(url, {
      bbox: input.bounds,
      maxTotalFeatures: max,
      pageSize: 1000,
      signal: input.signal,
    });
    if (result.truncated || !result.complete)
      throw new Error(
        "This area contains too much data for a complete offline download. Choose a smaller extent.",
      );
    return result.data;
  };
  if (input.parcels) {
    input.progress("Downloading full parcel boundaries…");
    const data = await load(TEXAS_PARCEL_URL, 12000);
    if (!data.features.length)
      throw new Error(
        "No Texas parcel coverage returned for this extent. Choose another area or download roads only.",
      );
    parcels = {
      type: "FeatureCollection",
      features: data.features.map((feature) => ({
        ...feature,
        properties: {
          OWNER_NAME:
            feature.properties?.["OWNER_NAME"] ?? feature.properties?.["owner_name"] ?? "",
          PROP_ID: feature.properties?.["PROP_ID"] ?? feature.id ?? "",
          COUNTY: feature.properties?.["COUNTY"] ?? feature.properties?.["county"] ?? "",
          LD_EDITION: feature.properties?.["LD_EDITION"] ?? "",
        },
      })),
    };
  }
  if (input.roads)
    for (const id of [29, 30, 31, 32]) {
      input.progress(`Downloading public roads (${id - 28}/4)…`);
      const data = await load(
        `https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/${id}`,
        3000,
      );
      roads.features.push(
        ...data.features.map((feature) => ({
          ...feature,
          properties: {
            NAME:
              feature.properties?.["FULLNAME"] ??
              feature.properties?.["NAME"] ??
              feature.properties?.["name"] ??
              "Road",
          },
        })),
      );
    }
  if (input.roads && !roads.features.length)
    throw new Error(
      "No roads returned for this area. Choose another extent or download parcels only.",
    );
  input.signal.throwIfAborted();
  validateOfflineComplexity([parcels, roads]);
  const style = { ...defaultStyle(), labelSize: 11, labelScaleWithZoom: false };
  const labelInput: GisLayer = {
    id: "offline",
    name: input.name,
    groupId: "public",
    visible: true,
    createdAt: Date.now(),
    source: { kind: "draw" },
    style,
    data: parcels,
  };
  const labeled = {
    ...parcels,
    features: parcels.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, __label: feature.properties?.["OWNER_NAME"] },
    })),
  };
  const area: OfflineArea = {
    id: crypto.randomUUID(),
    userId: input.userId,
    name: input.name.trim() || "Offline area",
    bounds: input.bounds,
    savedAt: new Date().toISOString(),
    bytes: 0,
    parcels,
    labels: buildParcelLabels(labelInput, labeled),
    roads,
    coverage: `Texas parcels: ${parcels.features.length}; USGS roads: ${roads.features.length}. Coverage reflects source editions, not guaranteed completeness.`,
    attribution:
      "TxGIO / contributing appraisal districts · CC0-1.0. USGS / U.S. Census Bureau / USFS public transportation data. Not a survey or a routable road network.",
  };
  area.bytes = new Blob([JSON.stringify(area)]).size;
  if (area.bytes > OFFLINE_AREA_FEATURE.maxBytes)
    throw new Error("Download exceeds 25 MB. Choose a smaller area.");
  const estimate = await navigator.storage?.estimate();
  if (estimate?.quota && area.bytes > estimate.quota - (estimate.usage ?? 0) - 5 * 1024 * 1024)
    throw new Error("Not enough device storage. Remove an old download and try again.");
  const db = await database();
  if (input.signal.aborted) {
    db.close();
    input.signal.throwIfAborted();
  }
  input.progress("Saving download on this device…");
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["areas", "metadata"], "readwrite");
    tx.objectStore("areas").put(area);
    tx.objectStore("metadata").put(summary(area));
    const cancel = () => {
      try {
        tx.abort();
      } catch {
        /* Already committed. */
      }
    };
    input.signal.addEventListener("abort", cancel, { once: true });
    tx.oncomplete = () => {
      input.signal.removeEventListener("abort", cancel);
      db.close();
      resolve();
    };
    tx.onabort = () => {
      input.signal.removeEventListener("abort", cancel);
      db.close();
      reject(tx.error ?? new Error("Device storage failed"));
    };
  });
  await navigator.storage?.persist().catch(() => false);
  return area;
}
