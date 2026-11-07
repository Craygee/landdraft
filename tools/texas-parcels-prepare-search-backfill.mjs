import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const store = resolve(".data/texas-parcels");
const source = JSON.parse(await readFile(join(store, "current.json"), "utf8"));
const response = await fetch(
  "https://landdraft-public-parcels.tight-sky-0ae1.workers.dev/texas/current.json",
  { signal: AbortSignal.timeout(30_000) },
);
if (!response.ok) throw new Error(`Hosted parcel manifest unavailable (${response.status})`);
const hosted = await response.json();
const version = source.sha256.slice(0, 16);
if (
  hosted.status !== "ready" ||
  hosted.version !== version ||
  hosted.sourceSha256 !== source.sha256 ||
  hosted.license !== "CC0-1.0" ||
  !Array.isArray(hosted.parts) ||
  !hosted.parts.length
)
  throw new Error("Hosted parcel version does not match the verified local archive");
const folder = join(store, "index", version);
await mkdir(folder, { recursive: true });
await writeFile(join(folder, "manifest.json"), JSON.stringify(hosted, null, 2));
console.log(`Prepared backfill from the hosted manifest for parcel version ${version}`);
