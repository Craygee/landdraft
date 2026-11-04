import type { GisLayer, LayerSource } from "./types";

const credentialParameters = new Set([
  "access_token",
  "api_key",
  "apikey",
  "key",
  "subscription-key",
  "token",
]);

function normalizedSourceUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "");
    const parameters = Array.from(url.searchParams.entries())
      .filter(([name]) => !credentialParameters.has(name.toLowerCase()))
      .sort(([leftName, leftValue], [rightName, rightValue]) =>
        `${leftName}\u0000${leftValue}`.localeCompare(`${rightName}\u0000${rightValue}`),
      );
    url.search = "";
    for (const [name, parameter] of parameters) url.searchParams.append(name, parameter);
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function normalizedWhere(value?: string): string {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized === "1=1" ? "" : normalized;
}

function sourceIdentity(source: LayerSource): string | null {
  if (source.kind === "remote") {
    const filter = normalizedWhere(source.where);
    if (source.catalogId) return `catalog:${source.catalogId}|where:${filter}`;
    if (source.url) return `url:${normalizedSourceUrl(source.url)}|where:${filter}`;
    if (source.accountServiceId)
      return `account:${source.accountOwnerId ?? "current"}:${source.accountServiceId}|where:${filter}`;
    return null;
  }
  if (source.kind !== "import") return null;
  if (source.catalogId) return `catalog:${source.catalogId}|where:`;
  if (source.sourceUrl) return `url:${normalizedSourceUrl(source.sourceUrl)}|where:`;
  return null;
}

/**
 * Compose the parent and selected-subproject map without drawing the same public connection twice.
 * Parent order wins unless it is hidden and a visible copy exists. Drawn, derived, image and local
 * file-import layers intentionally remain independent project content.
 */
export function dedupePublicDataLayers(layers: GisLayer[]): GisLayer[] {
  const selectedIndex = new Map<string, number>();
  layers.forEach((layer, index) => {
    const identity = sourceIdentity(layer.source);
    if (!identity) return;
    const existingIndex = selectedIndex.get(identity);
    if (existingIndex === undefined || (!layers[existingIndex]?.visible && layer.visible))
      selectedIndex.set(identity, index);
  });

  return layers.filter((layer, index) => {
    const identity = sourceIdentity(layer.source);
    return !identity || selectedIndex.get(identity) === index;
  });
}
