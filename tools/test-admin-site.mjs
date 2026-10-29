import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { mutateSite } = await import(
  pathToFileURL(resolve("../Migration to dev account/deployments/landdraft-admin/worker/site.mjs"))
);
const env = {
  SITE_ACCESS_READY: "true",
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-placeholder",
};
const identity = { sub: "verified-owner-fixture" };
test("inactive controls cannot call the private database", async () => {
  const result = await mutateSite(
    "/api/site/settings",
    { allowNewAccounts: false },
    {},
    identity,
    () => {
      throw Error("must not call");
    },
  );
  assert.equal(result.status, 503);
});
test("boolean validation prevents truthy strings from changing admission", async () => {
  const result = await mutateSite(
    "/api/site/settings",
    { fullyLockedDown: "false" },
    env,
    identity,
    () => {
      throw Error("must not call");
    },
  );
  assert.equal(result.status, 400);
});
test("the RPC actor comes from verified identity, never the submitted payload", async () => {
  let sent;
  const result = await mutateSite(
    "/api/site/settings",
    { allowNewAccounts: false, p_actor: "attacker" },
    env,
    identity,
    async (url, options) => {
      sent = JSON.parse(options.body);
      return Response.json({ ok: true });
    },
  );
  assert.equal(result.status, 200);
  assert.equal(sent.p_actor, identity.sub);
  assert.equal(sent.p_action, "settings");
});
test("database errors fail closed without disclosing upstream details", async () => {
  const result = await mutateSite(
    "/api/site/account",
    { userId: "00000000-0000-4000-8000-000000000001", lockedOut: true },
    env,
    identity,
    async () => new Response("private diagnostic", { status: 500 }),
  );
  assert.equal(result.status, 409);
  assert.doesNotMatch(JSON.stringify(result), /private diagnostic/);
});
