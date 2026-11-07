import { readFile, appendFile } from "node:fs/promises";

const latest = JSON.parse(await readFile(".data/texas-parcels/latest-check.json", "utf8"));
const response = await fetch(
  "https://landdraft-public-parcels.tight-sky-0ae1.workers.dev/texas/current.json",
);
const current = response.ok ? await response.json() : null;
const sourceChanged =
  current?.sourceEtag !== latest.etag || current?.collectionId !== latest.collection.collection_id;
const searchBackfill =
  !sourceChanged && (current?.search?.status !== "ready" || current?.search?.schemaVersion !== 2);
// Zoomed-out overview tiers (tools/texas-parcels-overview.py) can be added to a hosted version.
const overviewBackfill =
  !sourceChanged && !searchBackfill && current?.overview?.schemaVersion !== 1;
const mode = sourceChanged
  ? "full"
  : searchBackfill
    ? "search-only"
    : overviewBackfill
      ? "overview-only"
      : "unchanged";
const needed = mode !== "unchanged";
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `needed=${needed}\nmode=${mode}\n`);
console.log(
  mode === "full"
    ? "New public archive requires spatial and search indexing"
    : mode === "search-only"
      ? "Hosted archive requires the statewide attribute-search backfill"
      : mode === "overview-only"
        ? "Hosted archive requires the zoomed-out overview backfill"
        : "Publisher archive, search index and overview are current",
);
