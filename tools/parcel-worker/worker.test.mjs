import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import worker from "./worker.mjs";
const origin = "https://parcels.example";
test("public endpoint blocks writes and unknown paths", async () => {
  assert.equal(
    (await worker.fetch(new Request(origin + "/texas/current.json", { method: "PUT" }), {})).status,
    405,
  );
  assert.equal((await worker.fetch(new Request(origin + "/private/secrets"), {})).status, 404);
  assert.equal(
    (
      await worker.fetch(new Request(origin + "/admin/start", { method: "POST" }), {
        PUBLISH_TOKEN: "test",
      })
    ).status,
    401,
  );
});
test("publisher credential is restricted to parcel object paths", async () => {
  const req = new Request(origin + "/admin/start?key=private/account", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
  });
  assert.equal((await worker.fetch(req, { PUBLISH_TOKEN: "test" })).status, 400);
});
test("publisher can put only an allowed public search shard", async () => {
  let saved = "";
  const response = await worker.fetch(
    new Request(
      origin + "/admin/object?key=texas/versions/1234567890abcdef/search/owner/data.pack",
      { method: "PUT", headers: { Authorization: "Bearer test" }, body: "public" },
    ),
    {
      PUBLISH_TOKEN: "test",
      PARCELS: {
        put: async (key) => {
          saved = key;
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(saved, "texas/versions/1234567890abcdef/search/owner/data.pack");
});
test("missing dataset is explicit, and byte ranges preserve CORS and lengths", async () => {
  assert.equal(
    (
      await worker.fetch(new Request(origin + "/texas/current.json"), {
        PARCELS: { get: async () => null },
      })
    ).status,
    404,
  );
  const req = new Request(origin + "/texas/versions/1234567890abcdef/part-0000.fgb", {
    headers: { Range: "bytes=4-7" },
  });
  const response = await worker.fetch(req, {
    PARCELS: {
      get: async (key, options) => {
        assert.equal(options.range.get("Range"), "bytes=4-7");
        return {
          body: new Uint8Array([1, 2, 3, 4]),
          size: 100,
          range: { offset: 4, length: 4 },
          httpEtag: '"abc"',
          writeHttpMetadata() {},
        };
      },
    },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 4-7/100");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await response.arrayBuffer()).byteLength, 4);
});
test("statewide parcel search validates filters and reads the selected prefix shard", async () => {
  const manifest = {
    status: "ready",
    version: "1234567890abcdef",
    sourceDate: "2025-06-01",
    search: {
      status: "ready",
      prefixLength: 3,
      minimumTextLength: 3,
      maximumResults: 50,
      updatedAt: "2026-09-25",
      counties: [{ name: "Travis", fips: "48453" }],
    },
  };
  const records = gzipSync(
    Buffer.from(
      [
        JSON.stringify({
          sourceFeatureId: "7",
          propertyId: "102197",
          geoId: "102050201",
          ownerName: "MILLER JAMES",
          legalDescription: "LOT 14 BLK B SEC 1",
          situsAddress: "1815 TREADWELL ST",
          county: "TRAVIS",
          fips: "48453",
          block: "B",
          section: "1",
          bounds: [-97.8, 30.2, -97.79, 30.21],
        }),
        JSON.stringify({
          sourceFeatureId: "8",
          propertyId: "999",
          ownerName: "OTHER OWNER",
          county: "TRAVIS",
          fips: "48453",
          bounds: [-97, 30, -96.9, 30.1],
        }),
      ].join("\n"),
    ),
  );
  const env = {
    PARCELS: {
      get: async (key, options) => {
        if (key === "texas/current.json") return { json: async () => manifest };
        if (key.endsWith("/index.json"))
          return {
            json: async () => ({
              entries: { mil: { offset: 0, length: records.length } },
            }),
          };
        assert.equal(key, "texas/versions/1234567890abcdef/search/owner/data.pack");
        assert.deepEqual(options.range, { offset: 0, length: records.length });
        return { body: new Blob([records]).stream() };
      },
    },
  };
  const response = await worker.fetch(
    new Request(origin + "/texas/search?county=Travis&owner=Miller"),
    env,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].propertyId, "102197");
  assert.equal(payload.results[0].bounds[0], -97.8);
  const bad = await worker.fetch(new Request(origin + "/texas/search?block=B"), env);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /county/i);
});
test("property ID search uses the narrow ID shard and requires an exact identifier", async () => {
  const manifest = {
    status: "ready",
    version: "1234567890abcdef",
    sourceDate: "2025-06-01",
    search: {
      status: "ready",
      schemaVersion: 2,
      prefixLength: 3,
      idPrefixLength: 5,
      legalPrefixLength: 3,
      minimumTextLength: 3,
      maximumResults: 50,
      counties: [{ name: "Travis", fips: "48453" }],
    },
  };
  const records = gzipSync(
    Buffer.from(
      [
        {
          sourceFeatureId: "7",
          propertyId: "102197",
          geoId: "102050201",
          county: "TRAVIS",
          fips: "48453",
        },
        {
          sourceFeatureId: "8",
          propertyId: "1021979",
          geoId: "OTHER",
          county: "TRAVIS",
          fips: "48453",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    ),
  );
  const env = {
    PARCELS: {
      get: async (key, options) => {
        if (key === "texas/current.json") return { json: async () => manifest };
        if (key.endsWith("/index.json")) {
          assert.equal(key, "texas/versions/1234567890abcdef/search/id/index.json");
          return {
            json: async () => ({ entries: { 10219: { offset: 0, length: records.length } } }),
          };
        }
        assert.equal(key, "texas/versions/1234567890abcdef/search/id/data.pack");
        assert.deepEqual(options.range, { offset: 0, length: records.length });
        return { body: new Blob([records]).stream() };
      },
    },
  };
  const response = await worker.fetch(
    new Request(origin + "/texas/search?county=Travis&parcelId=102197"),
    env,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(
    payload.results.map((record) => record.propertyId),
    ["102197"],
  );
});
test("search metadata lists only counties in the published index", async () => {
  const env = {
    PARCELS: {
      get: async () => ({
        json: async () => ({
          sourceDate: "2025-06-01",
          search: {
            status: "ready",
            updatedAt: "2026-09-25",
            counties: [{ name: "Travis", fips: "48453" }],
          },
        }),
      }),
    },
  };
  const response = await worker.fetch(new Request(origin + "/texas/search/meta"), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).counties, [{ name: "Travis", fips: "48453" }]);
});
test("overview tiers are served and publishable, other names are not", async () => {
  const object = {
    body: new Uint8Array([1]),
    size: 1,
    httpEtag: '"o"',
    writeHttpMetadata() {},
  };
  const env = { PARCELS: { get: async () => object } };
  const ok = await worker.fetch(
    new Request(origin + "/texas/versions/1234567890abcdef/overview-0080.fgb"),
    env,
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "application/flatgeobuf");
  assert.equal(
    (
      await worker.fetch(
        new Request(origin + "/texas/versions/1234567890abcdef/overview-big.fgb"),
        env,
      )
    ).status,
    404,
  );
  let saved = "";
  const put = await worker.fetch(
    new Request(origin + "/admin/object?key=texas/versions/1234567890abcdef/overview-0005.fgb", {
      method: "PUT",
      headers: { Authorization: "Bearer test" },
      body: "fgb",
    }),
    { PUBLISH_TOKEN: "test", PARCELS: { put: async (key) => (saved = key) } },
  );
  assert.equal(put.status, 200);
  assert.equal(saved, "texas/versions/1234567890abcdef/overview-0005.fgb");
});
