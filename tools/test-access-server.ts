import { test } from "node:test";
import assert from "node:assert/strict";
import { accessMiddleware, checkAccess, requestToken } from "../src/lib/access.server.ts";
const config = { enabled: true, url: "https://project.supabase.co", key: "public-key" };
test("server gates fail closed for stale sessions, inactive schema and upstream failures", async () => {
  assert.equal(
    (
      await checkAccess(config, "token", "weather.core", async () =>
        Response.json({ allowed: true, active: false }),
      )
    ).allowed,
    false,
  );
  assert.equal(
    (
      await checkAccess(
        config,
        "token",
        "weather.core",
        async () => new Response("", { status: 401 }),
      )
    ).allowed,
    false,
  );
  const r = await accessMiddleware(
    new Request("https://site.test/api/weather/point"),
    config,
    async () => {
      throw Error("offline");
    },
  );
  assert.equal(r?.status, 403);
  const r2 = await accessMiddleware(
    new Request("https://site.test/api/weather/point", {
      headers: { Authorization: "Bearer token" },
    }),
    config,
    async () => {
      throw Error("offline");
    },
  );
  assert.equal(r2?.status, 503);
});
test("weather requests ask authoritative weather permission; cookie is not a trusted claim", async () => {
  let module;
  const result = await accessMiddleware(
    new Request("https://site.test/api/weather/radar/native/test", {
      headers: { Cookie: "__Host-landdraft_access=valid-token" },
    }),
    config,
    async (_url, init) => {
      module = JSON.parse(String(init?.body)).p_module;
      return Response.json({ active: true, allowed: false });
    },
  );
  assert.equal(result?.status, 403);
  assert.equal(module, "weather.core");
  assert.equal(
    requestToken(
      new Request("https://site.test", {
        headers: { Cookie: "other=1; __Host-landdraft_access=token" },
      }),
    ),
    "token",
  );
});
test("session bootstrap rejects cross-site requests and only sets a secure cookie after verification", async () => {
  const foreign = await accessMiddleware(
    new Request("https://site.test/api/access/session", {
      method: "POST",
      headers: { Origin: "https://evil.test", Authorization: "Bearer token" },
    }),
    config,
  );
  assert.equal(foreign?.status, 403);
  const good = await accessMiddleware(
    new Request("https://site.test/api/access/session", {
      method: "POST",
      headers: { Origin: "https://site.test", Authorization: "Bearer token" },
    }),
    config,
    async () => Response.json({ allowed: true, active: true }),
  );
  assert.equal(good?.status, 200);
  assert.match(good?.headers.get("set-cookie") || "", /Secure; HttpOnly; SameSite=Strict/);
});
