// Public CC0 files only. This worker has no private project or account bindings.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, ETag, Accept-Ranges",
};

const publicFile =
  /^\/texas\/versions\/[a-f0-9]{16}\/(?:manifest\.json|(?:part|overview)-\d{4}\.fgb|unmapped-\d{4}\.parquet|search\/[-a-z0-9_/]+\/(?:index\.json|data\.pack))$/;
const publicKey =
  /^texas\/versions\/[a-f0-9]{16}\/(?:manifest\.json|(?:part|overview)-\d{4}\.fgb|unmapped-\d{4}\.parquet|search\/[-a-z0-9_/]+\/(?:index\.json|data\.pack))$/;
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const clean = (value, maximum = 120) =>
  String(value ?? "")
    .trim()
    .slice(0, maximum);
const json = (body, status = 200, cache = "no-store") =>
  Response.json(body, {
    status,
    headers: { ...cors, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" },
  });

async function activeManifest(env) {
  const object = await env.PARCELS.get("texas/current.json");
  if (!object) return null;
  try {
    return await object.json();
  } catch {
    return null;
  }
}

const countyEntry = (manifest, requested) => {
  const key = normalize(requested);
  return manifest.search?.counties?.find((county) => normalize(county.name) === key) ?? null;
};

const matches = (record, filters) => {
  if (filters.county && normalize(record.county) !== normalize(filters.county)) return false;
  if (
    filters.parcelId &&
    ![record.propertyId, record.geoId].some((value) => normalize(value) === filters.parcelId)
  )
    return false;
  if (filters.owner && !normalize(record.ownerName).startsWith(filters.owner)) return false;
  if (filters.address && !normalize(record.situsAddress).startsWith(filters.address)) return false;
  if (filters.block && normalize(record.block) !== filters.block) return false;
  if (filters.section && normalize(record.section) !== filters.section) return false;
  return true;
};

async function readMatches(object, filters, limit) {
  const stream = object.body.pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const results = [];
  const seen = new Set();
  let pending = "";
  let limited = false;
  const accept = (line) => {
    if (!line || limited) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (!matches(record, filters)) return;
    const identity = `${record.fips}|${record.propertyId ?? ""}|${record.geoId ?? ""}|${record.sourceFeatureId ?? ""}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    if (results.length >= limit) {
      limited = true;
      return;
    }
    results.push(record);
  };
  while (!limited) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) accept(line);
    if (done) {
      accept(pending);
      break;
    }
  }
  if (limited) await reader.cancel();
  return { results, limited };
}

function selectSearchTarget(manifest, filters, county) {
  const textPrefixLength = manifest.search.prefixLength ?? 3;
  const idPrefixLength = manifest.search.idPrefixLength ?? textPrefixLength;
  const legalPrefixLength = manifest.search.legalPrefixLength ?? textPrefixLength;
  const prefix = (value, length) => value.slice(0, length).toLowerCase();
  const root = `texas/versions/${manifest.version}/search`;
  if (filters.parcelId)
    return { folder: `${root}/id`, prefix: prefix(filters.parcelId, idPrefixLength) };
  if (filters.owner)
    return { folder: `${root}/owner`, prefix: prefix(filters.owner, textPrefixLength) };
  if (filters.address)
    return { folder: `${root}/address`, prefix: prefix(filters.address, textPrefixLength) };
  if (filters.block && county)
    return {
      folder: `${root}/block/${county.fips}`,
      prefix: prefix(filters.block, legalPrefixLength),
    };
  if (filters.section && county)
    return {
      folder: `${root}/section/${county.fips}`,
      prefix: prefix(filters.section, legalPrefixLength),
    };
  if (county) return { folder: `${root}/county`, prefix: county.fips };
  return null;
}

async function parcelSearch(request, env) {
  const manifest = await activeManifest(env);
  if (!manifest?.search || manifest.search.status !== "ready")
    return json(
      { error: "Statewide parcel search is being prepared. Parcel map loading remains available." },
      503,
    );
  const url = new URL(request.url);
  if (url.pathname === "/texas/search/meta")
    return json(
      {
        status: "ready",
        sourceDate: manifest.sourceDate,
        updatedAt: manifest.search.updatedAt,
        minimumTextLength: manifest.search.minimumTextLength ?? 3,
        maximumResults: manifest.search.maximumResults ?? 50,
        counties: manifest.search.counties,
      },
      200,
      "public, max-age=300",
    );

  const raw = Object.fromEntries(
    ["county", "owner", "parcelId", "block", "section", "address"].map((key) => [
      key,
      clean(url.searchParams.get(key)),
    ]),
  );
  if (!Object.values(raw).some(Boolean))
    return json({ error: "Enter at least one parcel search filter." }, 400);
  const minimum = manifest.search.minimumTextLength ?? 3;
  const filters = {
    county: raw.county,
    owner: normalize(raw.owner),
    parcelId: normalize(raw.parcelId),
    block: normalize(raw.block),
    section: normalize(raw.section),
    address: normalize(raw.address),
  };
  for (const [name, value] of [
    ["owner or name", filters.owner],
    ["parcel/property ID", filters.parcelId],
    ["address", filters.address],
  ])
    if (value && value.length < minimum)
      return json({ error: `Enter at least ${minimum} letters or numbers for the ${name}.` }, 400);
  const county = raw.county ? countyEntry(manifest, raw.county) : null;
  if (raw.county && !county)
    return json({ error: "Choose a county from the Texas parcel list." }, 400);
  if ((filters.block || filters.section) && !county)
    return json({ error: "Choose a county when searching by block or section." }, 400);
  const target = selectSearchTarget(manifest, filters, county);
  if (!target) return json({ error: "Add a more specific parcel search filter." }, 400);
  const indexObject = await env.PARCELS.get(`${target.folder}/index.json`);
  const directory = indexObject ? await indexObject.json().catch(() => null) : null;
  const entry = directory?.entries?.[target.prefix];
  const object = entry
    ? await env.PARCELS.get(`${target.folder}/data.pack`, {
        range: { offset: entry.offset, length: entry.length },
      })
    : null;
  const limit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("limit")) || 25, manifest.search.maximumResults ?? 50),
  );
  const found = object
    ? await readMatches(object, filters, limit)
    : { results: [], limited: false };
  return json(
    {
      ...found,
      sourceDate: manifest.sourceDate,
      searched: Object.fromEntries(Object.entries(raw).filter(([, value]) => value)),
    },
    200,
    "public, max-age=60",
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/admin/")) return upload(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", { status: 405, headers: cors });
    if (url.pathname === "/texas/search" || url.pathname === "/texas/search/meta") {
      if (request.method === "HEAD") return new Response(null, { status: 200, headers: cors });
      return parcelSearch(request, env);
    }
    const path = url.pathname;
    if (path !== "/texas/current.json" && !publicFile.test(path))
      return new Response("Not found", { status: 404, headers: cors });
    const range = request.headers.get("Range");
    if (range && !/^bytes=\d+-\d*$/.test(range))
      return new Response("Unsupported byte range", { status: 416, headers: cors });
    const object =
      request.method === "HEAD"
        ? await env.PARCELS.head(path.slice(1))
        : await env.PARCELS.get(path.slice(1), range ? { range: request.headers } : {});
    if (!object) return new Response("Dataset not yet published", { status: 404, headers: cors });
    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set(
      "Content-Type",
      path.endsWith(".json")
        ? "application/json"
        : path.endsWith(".fgb")
          ? "application/flatgeobuf"
          : path.endsWith(".pack")
            ? "application/octet-stream"
            : "application/octet-stream",
    );
    headers.set(
      "Cache-Control",
      path.endsWith("/current.json") ? "public, max-age=60" : "public, max-age=31536000, immutable",
    );
    let status = 200;
    if (range && object.range) {
      const { offset = 0, length } = object.range;
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("Content-Length", String(length));
      status = 206;
    } else headers.set("Content-Length", String(object.size));
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  },
};

// A dedicated rotatable publisher secret authorizes only this public-data bucket.
async function upload(request, env) {
  if (!env.PUBLISH_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.PUBLISH_TOKEN}`)
    return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url),
    key = url.searchParams.get("key") ?? "";
  if (key !== "texas/current.json" && !publicKey.test(key))
    return new Response("Invalid key", { status: 400 });
  try {
    if (request.method === "PUT" && url.pathname === "/admin/object") {
      if (!request.body) return new Response("Missing object", { status: 400 });
      await env.PARCELS.put(key, request.body);
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/admin/start") {
      const item = await env.PARCELS.createMultipartUpload(key);
      return Response.json({ uploadId: item.uploadId });
    }
    if (request.method === "PUT" && url.pathname === "/admin/part") {
      const part = Number(url.searchParams.get("part"));
      if (!Number.isInteger(part) || part < 1 || part > 1000 || !request.body)
        return new Response("Invalid part", { status: 400 });
      const item = env.PARCELS.resumeMultipartUpload(key, url.searchParams.get("uploadId"));
      return Response.json(await item.uploadPart(part, request.body));
    }
    if (request.method === "POST" && url.pathname === "/admin/complete") {
      const item = env.PARCELS.resumeMultipartUpload(key, url.searchParams.get("uploadId"));
      const parts = await request.json();
      if (!Array.isArray(parts) || parts.length > 1000)
        return new Response("Invalid parts", { status: 400 });
      await item.complete(parts);
      return Response.json({ ok: true });
    }
    if (request.method === "DELETE" && url.pathname === "/admin/abort") {
      await env.PARCELS.resumeMultipartUpload(key, url.searchParams.get("uploadId")).abort();
      return Response.json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch {
    return new Response("Public dataset upload failed", { status: 502 });
  }
}
