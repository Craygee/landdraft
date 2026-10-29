import { basemapProbeUrl, basemaps, saveBasemapUrlOverride, setBasemapFallback } from "./basemaps";
import { catalog, retiredCatalog, type CatalogEntry } from "./catalog";
import { normalizeArcgisLayerUrl } from "./arcgis";
import { getParcelManifest, isTexasParcelSource, TEXAS_PARCEL_URL } from "./texasParcels";
import type { ConnectionRecoveryHint, GisLayer } from "./types";
import type { AccountService } from "./publicDataAccountModel";

export type ConnectionKind = "basemap" | "public-data" | "project-layer";
export type ConnectionStatus = "healthy" | "fallback" | "error";

export interface ConnectionResult {
  id: string;
  name: string;
  kind: ConnectionKind;
  status: ConnectionStatus;
  url: string;
  effectiveUrl?: string;
  configuredUrl?: string;
  sourcePage?: string;
  basemapId?: string;
  message: string;
}

export interface ConnectionReplacement {
  url: string;
  notes: string;
  title: string;
  source: "trusted alternative" | "publisher page" | "public GIS directory" | "existing URL";
  /** Only high-confidence matches are applied silently during the sign-in health check. */
  safeToAutoApply: boolean;
}

interface ConnectionTarget {
  id: string;
  name: string;
  kind: ConnectionKind;
  url: string;
  configuredUrl?: string;
  fallbackUrl?: string;
  sourcePage?: string;
  basemapId?: string;
}

const URL_OVERRIDES_KEY = "landdraft.catalog-url-overrides.v1";
const CONNECTION_HINTS_KEY = "landdraft.connection-hints.v1";

interface ReplacementCandidate extends ConnectionReplacement {
  score: number;
}

const trustedBasemapCandidates: Record<string, Array<Omit<ReplacementCandidate, "score">>> = {
  street: [
    {
      url: "https://tiles.openfreemap.org/styles/liberty",
      title: "Detailed street map",
      notes: "Current keyless street style with roads, boundaries and place labels.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
    {
      url: "https://tiles.openfreemap.org/styles/bright",
      title: "Bright street map",
      notes: "Keyless street style with a lighter visual treatment.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
    {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      title: "Standard street tiles",
      notes: "Community street tiles; normal interactive viewing and attribution are required.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
  ],
  satellite: [
    {
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      title: "Global satellite imagery",
      notes: "Current global cached imagery service.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      title: "Global satellite imagery alternate host",
      notes: "Equivalent global imagery endpoint on the alternate official host.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
  ],
  topo: [
    {
      url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
      title: "USGS Topographic map",
      notes: "Official USGS terrain, contours and hydrography tiles.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
    {
      url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
      title: "Topographic map",
      notes: "Keyless topographic tiles with terrain and contours.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      title: "Global topographic map",
      notes: "Global cached topographic map on an alternate official service.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
  ],
  dark: [
    {
      url: "https://tiles.openfreemap.org/styles/dark",
      title: "Dark map",
      notes: "Current keyless dark vector style.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
    {
      url: "https://tiles.openfreemap.org/styles/fiord",
      title: "Muted dark map",
      notes: "Keyless low-light vector style and the closest visual fallback.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
  ],
  osm: [
    {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      title: "Standard community street map",
      notes: "Standard community tiles; normal interactive viewing and attribution are required.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
    {
      url: "https://tiles.openfreemap.org/styles/bright",
      title: "Bright vector street map",
      notes: "Keyless vector alternative based on the same open street data.",
      source: "trusted alternative",
      safeToAutoApply: true,
    },
  ],
};

function readRecord(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function resolveCatalogUrl(entry: CatalogEntry): string | undefined {
  return readRecord(URL_OVERRIDES_KEY)[entry.id] || entry.url;
}

export function saveCatalogUrlOverride(id: string, url: string): void {
  const current = readRecord(URL_OVERRIDES_KEY);
  current[id] = url.trim();
  window.localStorage.setItem(URL_OVERRIDES_KEY, JSON.stringify(current));
}

export interface ConnectionHint {
  url: string;
  notes: string;
  updatedAt: string;
}

export function saveConnectionHint(id: string, hint: Omit<ConnectionHint, "updatedAt">): void {
  if (typeof window === "undefined") return;
  let current: Record<string, ConnectionHint> = {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONNECTION_HINTS_KEY) ?? "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) current = stored;
  } catch {
    // A damaged optional hint cache should never block the data library.
  }
  current[id] = { ...hint, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(CONNECTION_HINTS_KEY, JSON.stringify(current));
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => window.clearTimeout(timer) };
}

const isQueryableArcgisLayer = (raw: string) =>
  /\/(?:FeatureServer|MapServer)(?:\/\d+)?\/?$/i.test(raw.trim().replace(/\?.*$/, ""));

export async function probeConnectionUrl(
  url: string,
  timeoutMs = 8_000,
  expectDataService = false,
): Promise<void> {
  const timeout = withTimeout(timeoutMs);
  try {
    if (isTexasParcelSource(url)) {
      await getParcelManifest(timeout.signal);
      return;
    }
    const arcgisDataLayer = isQueryableArcgisLayer(url);
    const target = arcgisDataLayer
      ? `${normalizeArcgisLayerUrl(url)}/query?where=1%3D1&returnCountOnly=true&f=json`
      : url;
    const response = await fetch(target, { signal: timeout.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const contentType = response.headers.get("content-type") ?? "";
    if (
      arcgisDataLayer ||
      contentType.includes("json") ||
      /\/styles\//i.test(url) ||
      expectDataService
    ) {
      const json = (await response.json()) as {
        error?: { message?: string };
        version?: number;
        features?: unknown[];
        count?: number;
        tiles?: string[];
        sources?: Record<string, { tiles?: string[]; url?: string }>;
      };
      if (json.error) throw new Error(json.error.message ?? "The service returned an error");
      if (arcgisDataLayer && typeof json.count !== "number")
        throw new Error("The ArcGIS layer did not accept a lightweight data query");
      if (/\/styles\//i.test(url) && json.version !== 8)
        throw new Error("The endpoint did not return a MapLibre style");
      if (/\/styles\//i.test(url) && json.version === 8) {
        const sourceTemplates: string[] = [];
        for (const source of Object.values(json.sources ?? {})) {
          if (source.tiles?.[0]) sourceTemplates.push(source.tiles[0]);
          else if (source.url?.startsWith("https://")) {
            const tileJsonResponse = await fetch(source.url, { signal: timeout.signal });
            if (!tileJsonResponse.ok)
              throw new Error(`Basemap source returned HTTP ${tileJsonResponse.status}`);
            const tileJson = (await tileJsonResponse.json()) as { tiles?: string[] };
            if (tileJson.tiles?.[0]) sourceTemplates.push(tileJson.tiles[0]);
          }
        }
        for (const template of sourceTemplates.slice(0, 2)) {
          const tileResponse = await fetch(basemapProbeUrl(template), { signal: timeout.signal });
          if (!tileResponse.ok)
            throw new Error(`Basemap tiles returned HTTP ${tileResponse.status}`);
        }
      }
      if (expectDataService && !arcgisDataLayer && !Array.isArray(json.features))
        throw new Error("The URL is reachable, but it is not an ArcGIS layer or GeoJSON service");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    throw error;
  } finally {
    timeout.clear();
  }
}

async function checkTarget(target: ConnectionTarget): Promise<ConnectionResult> {
  try {
    await probeConnectionUrl(target.url);
    if (target.basemapId) setBasemapFallback(target.basemapId, false);
    return {
      ...target,
      status: "healthy",
      message: "Connection verified",
    };
  } catch (primaryError) {
    if (target.fallbackUrl) {
      try {
        await probeConnectionUrl(target.fallbackUrl);
        if (target.basemapId) setBasemapFallback(target.basemapId, true);
        return {
          ...target,
          status: "fallback",
          effectiveUrl: target.fallbackUrl,
          message: "Preferred provider is unavailable; an equivalent fallback is active",
        };
      } catch {
        // Report the preferred connection error below; the UI offers a repair clue form.
      }
    }
    return {
      ...target,
      status: "error",
      message: primaryError instanceof Error ? primaryError.message : "Connection failed",
    };
  }
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function safePublicUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

const serviceUrlPattern = /https:\/\/[^\s"'<>]+?(?:FeatureServer|MapServer)(?:\/\d+)?/gi;

function directServiceCandidate(raw: string): string | null {
  const safe = safePublicUrl(raw);
  if (!safe) return null;
  if (/\/(?:FeatureServer|MapServer)(?:\/\d+)?\/?(?:\?.*)?$/i.test(safe))
    return normalizeArcgisLayerUrl(safe);
  if (/\.geojson(?:\?.*)?$/i.test(safe)) return safe;
  return null;
}

async function candidatesFromPublisherPage(raw: string): Promise<string[]> {
  const pageUrl = safePublicUrl(raw);
  if (!pageUrl || directServiceCandidate(pageUrl)) return [];
  const timeout = withTimeout(10_000);
  try {
    const response = await fetch(pageUrl, { signal: timeout.signal });
    if (!response.ok) return [];
    const text = (await response.text()).replaceAll("\\/", "/").replaceAll("&amp;", "&");
    return [...text.matchAll(serviceUrlPattern)]
      .map((match) => directServiceCandidate(match[0]))
      .filter((url): url is string => Boolean(url));
  } catch {
    return [];
  } finally {
    timeout.clear();
  }
}

interface ArcgisSearchItem {
  title?: string;
  owner?: string;
  type?: string;
  url?: string;
  modified?: number;
}

const searchTokens = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 3 && !["map", "data", "layer", "public"].includes(token)),
  );

function similarityScore(needle: string, item: ArcgisSearchItem): number {
  const wanted = searchTokens(needle);
  const titleTokens = searchTokens(item.title ?? "");
  const found = searchTokens(`${item.title ?? ""} ${item.owner ?? ""} ${item.url ?? ""}`);
  let overlap = 0;
  for (const token of wanted) if (found.has(token)) overlap += 1;
  const coverage = wanted.size ? overlap / wanted.size : 0;
  const normalizedNeedle = [...wanted].join(" ");
  const normalizedTitle = [...titleTokens].join(" ");
  const exactBonus = normalizedTitle === normalizedNeedle ? 100 : 0;
  const extraTitleTokens = [...titleTokens].filter((token) => !wanted.has(token)).length;
  const recency = item.modified
    ? Math.min(1, Math.max(0, (item.modified - 1_577_836_800_000) / 315_576_000_000))
    : 0;
  return coverage * 100 + overlap * 8 + exactBonus - extraTitleTokens * 6 + recency;
}

async function candidatesFromPublicGisSearch(name: string): Promise<ReplacementCandidate[]> {
  const params = new URLSearchParams({
    f: "json",
    num: "20",
    q: `"${name.replaceAll('"', "")}" AND (type:"Feature Service" OR type:"Map Service")`,
  });
  const timeout = withTimeout(12_000);
  try {
    const response = await fetch(`https://www.arcgis.com/sharing/rest/search?${params}`, {
      signal: timeout.signal,
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { results?: ArcgisSearchItem[] };
    const candidates: ReplacementCandidate[] = [];
    for (const item of json.results ?? []) {
      const url = item.url ? directServiceCandidate(item.url) : null;
      if (!url) continue;
      const title = item.title?.trim() || name;
      const owner = item.owner?.trim();
      candidates.push({
        url,
        title,
        notes: `Reachable public GIS result${owner ? ` published by ${owner}` : ""}. Review the publisher before using it.`,
        source: "public GIS directory",
        safeToAutoApply: false,
        score: similarityScore(name, item),
      });
    }
    return candidates
      .filter((candidate) => candidate.score >= 35)
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  } finally {
    timeout.clear();
  }
}

async function firstReachableCandidate(
  candidates: ReplacementCandidate[],
  kind: ConnectionKind,
): Promise<ConnectionReplacement | null> {
  const ordered = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const checked = await mapWithLimit(ordered, 3, async (candidate) => {
    try {
      await probeConnectionUrl(
        kind === "basemap" ? basemapProbeUrl(candidate.url) : candidate.url,
        10_000,
        kind !== "basemap",
      );
      return candidate;
    } catch {
      return null;
    }
  });
  return checked.find((candidate): candidate is ReplacementCandidate => candidate !== null) ?? null;
}

/** Searches live trusted endpoints, publisher pages and the public GIS directory. */
export async function findConnectionReplacement(
  result: ConnectionResult,
  clueUrl = "",
  clueNotes = "",
): Promise<ConnectionReplacement> {
  if (result.id === "catalog:tx-parcels" || /2019_Texas_Parcels_StratMap/i.test(result.url)) {
    await getParcelManifest();
    return {
      url: TEXAS_PARCEL_URL,
      title: "Texas Land Parcels — Statewide",
      notes:
        "Verified public TxGIO CC0 archive hosted by LandDraft; 253 counties in the 2025 release.",
      source: "publisher page",
      safeToAutoApply: true,
    };
  }
  if (result.kind === "basemap") {
    const candidates = (trustedBasemapCandidates[result.basemapId ?? ""] ?? []).map(
      (candidate, index) => ({ ...candidate, score: 1_000 - index }),
    );
    const replacement = await firstReachableCandidate(candidates, result.kind);
    if (replacement) return replacement;
    throw new Error("No healthy equivalent basemap was found right now.");
  }

  const candidates: ReplacementCandidate[] = [];
  const addDirect = (raw: string, source: ConnectionReplacement["source"], score: number) => {
    const url = directServiceCandidate(raw);
    if (!url) return;
    candidates.push({
      url,
      title: result.name,
      notes: clueNotes.trim() || `Reachable service found from the ${source}.`,
      source,
      safeToAutoApply: source !== "existing URL" || url === result.configuredUrl,
      score,
    });
  };

  addDirect(clueUrl, "publisher page", 500);
  addDirect(result.sourcePage ?? "", "publisher page", 450);
  addDirect(result.url, "existing URL", 300);

  const pages = [clueUrl, result.sourcePage ?? ""].filter(Boolean);
  const pageCandidates = (await Promise.all(pages.map(candidatesFromPublisherPage))).flat();
  for (const url of pageCandidates) addDirect(url, "publisher page", 400);
  candidates.push(...(await candidatesFromPublicGisSearch(result.name)));

  const replacement = await firstReachableCandidate(candidates, result.kind);
  if (replacement) return replacement;
  throw new Error(
    "No verified replacement was found. Add a publisher website or another clue and try again.",
  );
}

export async function checkProjectConnections(
  layers: GisLayer[],
  connectionHints: Record<string, ConnectionRecoveryHint> = {},
  account: {
    removed?: Record<string, string>;
    services?: Record<string, AccountService>;
    overrides?: Record<string, string>;
    restoredDefaults?: Record<string, boolean>;
  } = {},
): Promise<ConnectionResult[]> {
  const targets: ConnectionTarget[] = basemaps.map((basemap) => {
    const override = connectionHints[`basemap:${basemap.id}`];
    if (override?.verified && override.url) saveBasemapUrlOverride(basemap.id, override.url);
    return {
      id: `basemap:${basemap.id}`,
      name: `${basemap.label} basemap`,
      kind: "basemap",
      url: override?.verified ? basemapProbeUrl(override.url) : basemap.healthUrl,
      configuredUrl: override?.verified ? override.url : basemap.connectionUrl,
      ...(basemap.fallbackHealthUrl ? { fallbackUrl: basemap.fallbackHealthUrl } : {}),
      basemapId: basemap.id,
    };
  });

  for (const entry of [
    ...catalog,
    ...retiredCatalog.filter((entry) => account.restoredDefaults?.[`catalog:${entry.id}`]),
  ]) {
    if (account.removed?.[`catalog:${entry.id}`]) continue;
    const cloudOverride = connectionHints[`catalog:${entry.id}`];
    const url =
      account.overrides?.[`catalog:${entry.id}`] ??
      (cloudOverride?.verified ? cloudOverride.url : resolveCatalogUrl(entry));
    if (!url) continue;
    targets.push({
      id: `catalog:${entry.id}`,
      name: entry.name,
      kind: "public-data",
      url,
      configuredUrl: url,
      ...(entry.sourcePage ? { sourcePage: entry.sourcePage } : {}),
    });
  }

  for (const service of Object.values(account.services ?? {})) {
    if (!account.removed?.[`account:${service.id}`])
      targets.push({
        id: `account:${service.id}`,
        name: service.name,
        kind: "public-data",
        url: service.url,
        configuredUrl: service.url,
      });
  }
  for (const layer of layers) {
    if (layer.source.kind === "remote" && layer.source.accountServiceId) continue;
    if (layer.source.kind !== "remote" || layer.source.catalogId) continue;
    targets.push({
      id: `layer:${layer.id}`,
      name: layer.name,
      kind: "project-layer",
      url: layer.source.url,
      configuredUrl: layer.source.url,
    });
  }

  const unique = [...new Map(targets.map((target) => [target.id, target])).values()];
  return mapWithLimit(unique, 4, checkTarget);
}
