import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fetchTexasParcels,
  getParcelManifest,
  parcelOverviewTier,
  TEXAS_PARCEL_URL,
} from "./texasParcels.ts";
const manifest = {
  status: "ready",
  license: "CC0-1.0",
  version: "1234567890abcdef",
  features: 2,
  sourceDate: "2025-06-01",
  retrievedAt: "2026-09-14",
  parts: [{ file: "part-0000.fgb", bounds: [-98, 29, -96, 31], features: 2 }],
};
test("public index queries byte ranges, preserves source IDs, and flags feature caps", async (t) => {
  const bytes = Buffer.from(
    readFileSync(new URL("./texasParcels.fixture.txt", import.meta.url), "utf8"),
    "base64",
  );
  let ranges = 0;
  t.mock.method(globalThis, "fetch", async (url: string, opts?: RequestInit) => {
    if (url === TEXAS_PARCEL_URL) return Response.json(manifest);
    const range = new Headers(opts?.headers).get("Range");
    assert.ok(range);
    ranges++;
    const match = /bytes=(\d+)-(\d+)/.exec(range);
    assert.ok(match);
    const start = Number(match[1]),
      end = Math.min(Number(match[2]) + 1, bytes.length);
    return new Response(bytes.slice(start, end), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` },
    });
  });
  const result = await fetchTexasParcels({
    bbox: [-97.1, 29.9, -96.9, 30.1],
    where: "county='Travis'",
    maxTotalFeatures: 1,
  });
  assert.equal(result.loaded, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.complete, false);
  assert.equal(result.data.features[0]?.properties?.["LD_LICENSE"], "CC0-1.0");
  assert.ok(ranges > 0);
  assert.ok(["10", "20"].includes(String(result.data.features[0]?.id)));
});
test("unreviewed license never loads, and invalid spatial or query scope is explicit", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ...manifest, license: "UNKNOWN" }),
  );
  await assert.rejects(getParcelManifest(), /license/);
  await assert.rejects(fetchTexasParcels({ bbox: [-106, 25, -93, 37] }), /Zoom in/);
  await assert.rejects(
    fetchTexasParcels({ bbox: [-97.1, 29.9, -96.9, 30.1], where: "SECRET=1" }),
    /Clear the previous/,
  );
});

test("farther-out overview accepts a mobile extent while full-detail requests stay bounded", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ...manifest, license: "UNKNOWN" }),
  );
  const bbox: [number, number, number, number] = [-103, 33, -101, 36];
  // Reaching license validation proves overview passed the spatial guard.
  await assert.rejects(fetchTexasParcels({ bbox, parcelDisplayZoom: 8 }), /license/);
  await assert.rejects(fetchTexasParcels({ bbox }), /Zoom in/);
  await assert.rejects(
    fetchTexasParcels({ bbox: [-106, 25, -93, 37], parcelDisplayZoom: 8 }),
    /Zoom in/,
  );
});

const overviewManifest = {
  ...manifest,
  overview: {
    schemaVersion: 1,
    tiers: [
      {
        file: "overview-0080.fgb",
        minAcres: 80,
        minZoom: 8,
        maxZoom: 10,
        features: 2,
        bounds: [-98, 29, -96, 31],
      },
      {
        file: "overview-0005.fgb",
        minAcres: 5,
        minZoom: 10,
        maxZoom: 12,
        features: 2,
        bounds: [-98, 29, -96, 31],
      },
    ],
  },
};

test("overview tiers are chosen by zoom and ignored when malformed", () => {
  assert.equal(parcelOverviewTier(overviewManifest as never, 8.5)?.file, "overview-0080.fgb");
  assert.equal(parcelOverviewTier(overviewManifest as never, 10)?.file, "overview-0005.fgb");
  assert.equal(parcelOverviewTier(overviewManifest as never, 12), null);
  assert.equal(parcelOverviewTier(manifest as never, 9), null);
  const bad = structuredClone(overviewManifest);
  bad.overview.tiers[0]!.file = "../secret.fgb";
  assert.equal(parcelOverviewTier(bad as never, 9), null);
});

test("zoomed-out views read only the overview tier, and need one below zoom 10", async (t) => {
  const bytes = Buffer.from(
    readFileSync(new URL("./texasParcels.fixture.txt", import.meta.url), "utf8"),
    "base64",
  );
  const files = new Set<string>();
  let hosted: unknown = overviewManifest;
  t.mock.method(globalThis, "fetch", async (url: string, opts?: RequestInit) => {
    if (url === TEXAS_PARCEL_URL) return Response.json(hosted);
    files.add(url.split("/").pop()!);
    const match = /bytes=(\d+)-(\d+)/.exec(new Headers(opts?.headers).get("Range") ?? "");
    assert.ok(match);
    const start = Number(match[1]),
      end = Math.min(Number(match[2]) + 1, bytes.length);
    return new Response(bytes.slice(start, end), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` },
    });
  });
  // A zoom-8 desktop view is far wider than the full parts allow.
  await fetchTexasParcels({ bbox: [-100, 28, -94, 32], parcelDisplayZoom: 8.4 });
  assert.deepEqual([...files], ["overview-0080.fgb"]);
  hosted = manifest;
  await assert.rejects(
    fetchTexasParcels({ bbox: [-98, 29.5, -96.5, 30.5], parcelDisplayZoom: 9 }),
    /zoom 10/,
  );
});
