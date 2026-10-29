import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const root = resolve(".data/texas-parcels");
await mkdir(root, { recursive: true });
const json = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Catalog unavailable: ${r.status}`);
  return r.json();
};
const catalogUrl = "https://api.tnris.org/api/v1/collections?search=land%20parcels";
const catalog = await json(catalogUrl);
if (catalog.next) throw new Error("Unexpected catalog pagination; inventory requires review");
const collection = catalog.results
  .filter((c) => c.name === "Land Parcels" && c.public)
  .sort((a, b) => b.acquisition_date.localeCompare(a.acquisition_date))[0];
if (!collection || collection.license_abbreviation !== "CC0-1.0")
  throw new Error(
    "Newest public parcel collection requires license review; existing dataset retained",
  );
const resourcesUrl = `https://api.tnris.org/api/v1/resources?collection_id=${collection.collection_id}`;
const resources = await json(resourcesUrl);
if (resources.next || resources.results.length !== resources.count)
  throw new Error("Incomplete resource inventory");
const statewide = resources.results.find(
  (r) => r.area_type === "state" && r.area_type_name === "Texas",
);
if (!statewide) throw new Error("No statewide archive available");
const countyFips = new Set(
  resources.results
    .filter((r) => r.area_type === "county")
    .map((r) => /_(48\d{3})_/.exec(r.resource)?.[1]),
);
const missing = Array.from(
  { length: 254 },
  (_, i) => `48${String(i * 2 + 1).padStart(3, "0")}`,
).filter((f) => !countyFips.has(f));
const resource = new URL(statewide.resource);
if (
  resource.hostname !== "data.geographic.texas.gov" ||
  !resource.pathname.startsWith(`/${collection.collection_id}/resources/`) ||
  !resource.pathname.endsWith(".zip")
)
  throw new Error("Unexpected archive location");
// TxGIO's public S3 distribution of the same DataHub resource. No authentication.
const downloadUrl = `https://s3.amazonaws.com/data.tnris.org${resource.pathname}`;
const head = await fetch(downloadUrl, { method: "HEAD", signal: AbortSignal.timeout(20000) });
if (!head.ok) throw new Error(`Archive unavailable: ${head.status}`);
const bytes = Number(head.headers.get("content-length"));
const etag = head.headers.get("etag");
if (!etag || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 10_000_000_000)
  throw new Error("Invalid or oversized statewide archive");
const report = {
  checkedAt: new Date().toISOString(),
  catalogUrl,
  resourcesUrl,
  collection,
  resources: resources.results,
  downloadUrl,
  etag,
  bytes,
  lastModified: head.headers.get("last-modified"),
  countyCount: countyFips.size,
  missingCountyFips: missing,
  license: "CC0-1.0",
};
await writeFile(join(root, "latest-check.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    collection: collection.collection_id,
    license: report.license,
    bytes,
    counties: countyFips.size,
    missingCountyFips: missing,
  }),
);
if (!process.argv.includes("--download")) {
  console.log("Inventory refreshed. Pass --download to store the statewide archive.");
  process.exit(0);
}
let prior = null;
try {
  prior = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
} catch {}
if (
  prior?.etag === etag &&
  prior?.bytes === bytes &&
  (await stat(join(root, prior.file)).catch(() => null))?.size === bytes
) {
  console.log("Current archive unchanged; no download needed.");
  process.exit(0);
}
const version = `${collection.collection_id}-${etag.replace(/[^a-zA-Z0-9]/g, "")}`;
const file = `${version}.zip`,
  temp = join(root, `${file}.partial`);
const response = await fetch(downloadUrl, {
  headers: { "If-Match": etag },
  signal: AbortSignal.timeout(30 * 60 * 1000),
});
if (!response.ok || !response.body) throw new Error(`Archive download failed: ${response.status}`);
if (response.headers.get("etag") !== etag) throw new Error("Source changed during download");
const hash = createHash("sha256");
let received = 0,
  lastLog = 0;
const meter = new Transform({
  transform(chunk, encoding, done) {
    received += chunk.length;
    if (received > bytes) {
      done(new Error("Archive exceeds expected size"));
      return;
    }
    hash.update(chunk);
    if (received - lastLog > 250_000_000) {
      console.log(`Downloaded ${Math.round(received / 1e6)} / ${Math.round(bytes / 1e6)} MB`);
      lastLog = received;
    }
    done(null, chunk);
  },
});
await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temp));
if (received !== bytes) throw new Error("Incomplete archive; previous version retained");
await rename(temp, join(root, file));
const completed = {
  ...report,
  file,
  sha256: hash.digest("hex"),
  downloadedAt: new Date().toISOString(),
  status: "downloaded-not-yet-indexed",
};
await writeFile(join(root, `${version}.json`), JSON.stringify(completed, null, 2));
await writeFile(join(root, "current.json.next"), JSON.stringify(completed, null, 2));
await rename(join(root, "current.json.next"), join(root, "current.json"));
console.log(
  JSON.stringify({ status: completed.status, file, bytes: received, sha256: completed.sha256 }),
);
