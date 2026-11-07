import { readFile, writeFile, open, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
const base = resolve(".data/texas-parcels");
const source = JSON.parse(await readFile(join(base, "current.json"), "utf8"));
const version = source.sha256.slice(0, 16),
  folder = join(base, "index", version);
const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
// full: everything; search-only: search shards; overview-only: overview tiers.
const uploadMode =
  process.env.PARCEL_UPLOAD_MODE ??
  (process.env.PARCEL_SEARCH_ONLY === "1" ? "search-only" : "full");
if (!["full", "search-only", "overview-only"].includes(uploadMode))
  throw new Error(`Unknown parcel upload mode ${uploadMode}`);
let searchObjects = [];
if (manifest.search?.status === "ready" && uploadMode !== "overview-only")
  searchObjects = JSON.parse(await readFile(join(folder, "search", "objects.json"), "utf8"));
const wrangler = process.env.PARCEL_WRANGLER_JS;
if (!wrangler && !process.env.PARCEL_PUBLISH_TOKEN)
  throw new Error("A server-side parcel publishing credential is required");
const receiptFile = join(folder, "upload-receipts.json");
let receipts = {};
try {
  receipts = JSON.parse(await readFile(receiptFile, "utf8"));
} catch {}
const cliPut = (file, key) =>
  new Promise((resolveJob, reject) => {
    const args = [
      wrangler,
      "r2",
      "object",
      "put",
      `landdraft-public-parcels/${key}`,
      "--file",
      file,
      "--remote",
    ];
    const child = spawn(process.execPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolveJob()
        : reject(new Error(`Upload failed (${code}): ${output.slice(-600)}`)),
    );
  });
const service = "https://landdraft-public-parcels.tight-sky-0ae1.workers.dev";
async function httpPut(file, key) {
  const auth = { Authorization: `Bearer ${process.env.PARCEL_PUBLISH_TOKEN}` };
  const fileSize = (await stat(file)).size;
  if (fileSize < 50 * 1024 * 1024) {
    const handle = await open(file, "r");
    try {
      const r = await fetch(`${service}/admin/object?${new URLSearchParams({ key })}`, {
        method: "PUT",
        headers: auth,
        body: handle.createReadStream(),
        duplex: "half",
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) throw new Error(`Parcel publisher object failed (${r.status})`);
      return;
    } finally {
      await handle.close();
    }
  }
  const call = async (action, params, method, body) => {
    const r = await fetch(`${service}/admin/${action}?${new URLSearchParams({ key, ...params })}`, {
      method,
      headers: auth,
      body,
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) throw new Error(`Parcel publisher ${action} failed (${r.status})`);
    return r.json();
  };
  const { uploadId } = await call("start", {}, "POST");
  const handle = await open(file, "r"),
    parts = [];
  try {
    const size = (await handle.stat()).size,
      chunk = 32 * 1024 * 1024;
    for (let offset = 0; offset < size; offset += chunk) {
      const buffer = Buffer.alloc(Math.min(chunk, size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead !== buffer.length) throw new Error("Incomplete local part");
      parts.push(await call("part", { uploadId, part: String(parts.length + 1) }, "PUT", buffer));
    }
    await call("complete", { uploadId }, "POST", JSON.stringify(parts));
  } catch (error) {
    await call("abort", { uploadId }, "DELETE").catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }
}
const put = process.env.PARCEL_PUBLISH_TOKEN ? httpPut : cliPut;
// Sequential receipts are durable; upload parts in bounded parallel batches.
const spatialFiles = uploadMode === "full" ? [...manifest.parts, ...manifest.unmapped] : [];
const overviewFiles = manifest.overview?.tiers ?? [];
if (uploadMode === "overview-only" && !overviewFiles.length)
  throw new Error("No overview tiers were built");
const files = [
  ...spatialFiles.map((item) => ({ ...item, local: item.file, key: item.file })),
  ...overviewFiles.map((item) => ({ ...item, local: item.file, key: item.file })),
  ...searchObjects.map((item) => ({
    ...item,
    local: join("search", item.file),
    key: `search/${item.file}`,
  })),
];
for (let i = 0; i < files.length; i += 3) {
  await Promise.all(
    files.slice(i, i + 3).map(async (part) => {
      if (
        !/^(?:part-\d{4}\.fgb|overview-\d{4}\.fgb|unmapped-\d{4}\.parquet|search\/(?:id|owner|address|county|block\/\d{5}|section\/\d{5})\/(?:index\.json|data\.pack))$/.test(
          part.key,
        )
      )
        throw new Error("Invalid part path");
      if (part.bytes > 30_000_000_000)
        throw new Error("Part exceeds the bounded multipart upload limit");
      if (part.sha256 ? receipts[part.key]?.sha256 === part.sha256 : receipts[part.key]?.uploadedAt)
        return;
      await put(join(folder, part.local), `texas/versions/${version}/${part.key}`);
      receipts[part.key] = { uploadedAt: new Date().toISOString(), sha256: part.sha256 };
    }),
  );
  await writeFile(receiptFile, JSON.stringify(receipts, null, 2));
  console.log(`Uploaded ${Object.keys(receipts).length}/${files.length} parts`);
}
const published = {
  ...manifest,
  status: "ready",
  version,
  publishedAt: new Date().toISOString(),
  sourceEtag: source.etag,
  weeklyUpdates: true,
};
await writeFile(join(folder, "published.json"), JSON.stringify(published));
await put(join(folder, "published.json"), `texas/versions/${version}/manifest.json`);
// The active manifest changes only after every immutable part has uploaded successfully.
await put(join(folder, "published.json"), "texas/current.json");
console.log(`Published ${manifest.features} mapped records at version ${version}`);
