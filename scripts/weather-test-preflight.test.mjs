import assert from "node:assert/strict";
import test from "node:test";
import {
  TEST_BRANCH,
  TEST_SUPABASE_URL,
  checkTestEnvironment,
  forbiddenArtifactText,
  isCodeOnly,
} from "./weather-test-preflight.mjs";

const env = {
  VITE_LANDDRAFT_ACCESS_ENFORCEMENT: "true",
  VITE_SUPABASE_URL: TEST_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  WEATHER_PROVIDER_POLICY: '{"version":1,"grants":[]}',
};
const codeOnly = { branch: TEST_BRANCH, codeOnly: true };

test("code-only preparation passes without the encryption key", () => {
  assert.equal(isCodeOnly(["node", "script", "--code-only"]), true);
  assert.deepEqual(checkTestEnvironment(env, codeOnly), { version: 1, grants: [] });
});

test("the default path still requires the encryption key", () => {
  assert.equal(isCodeOnly(["node", "script"]), false);
  assert.throws(
    () => checkTestEnvironment(env, { branch: TEST_BRANCH, codeOnly: false }),
    /Missing existing test encryption key/,
  );
  assert.ok(
    checkTestEnvironment(
      { ...env, XWEATHER_CREDENTIAL_ENCRYPTION_KEY: "k".repeat(32) },
      { branch: TEST_BRANCH, codeOnly: false },
    ),
  );
});

test("code-only preparation keeps the branch, database, access and grant checks", () => {
  assert.throws(() => checkTestEnvironment(env, { ...codeOnly, branch: "main" }), /requires codex/);
  assert.throws(
    () => checkTestEnvironment({ ...env, VITE_LANDDRAFT_ACCESS_ENFORCEMENT: "false" }, codeOnly),
    /ACCESS_ENFORCEMENT=true/,
  );
  assert.throws(
    () =>
      checkTestEnvironment(
        { ...env, VITE_SUPABASE_URL: "https://txgbeskieqvvptgtjyou.supabase.co" },
        codeOnly,
      ),
    /isolated test Supabase/,
  );
  assert.throws(
    () =>
      checkTestEnvironment(
        { ...env, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_example" },
        codeOnly,
      ),
    /isolated test Supabase/,
  );
  assert.throws(
    () =>
      checkTestEnvironment(
        { ...env, WEATHER_PROVIDER_POLICY: '{"version":1,"grants":[{"id":"x"}]}' },
        codeOnly,
      ),
    /zero commercial grants/,
  );
});

test("code-only preparation refuses a checkout that does not match its commit", () => {
  assert.throws(
    () => checkTestEnvironment(env, { ...codeOnly, sourceStatus: " M src/server.ts\n" }),
    /clean checkout/,
  );
});

test("code-only preparation accepts another checkout only at the published test commit", () => {
  const elsewhere = { branch: "claude/example", codeOnly: true };
  assert.ok(
    checkTestEnvironment(env, { ...elsewhere, headCommit: "abc", publishedTestCommit: "abc" }),
  );
  assert.ok(
    checkTestEnvironment(env, {
      ...elsewhere,
      branch: "",
      headCommit: "abc",
      publishedTestCommit: "abc",
    }),
  );
  for (const commits of [
    { headCommit: "abc", publishedTestCommit: "def" },
    { headCommit: "abc" },
    { headCommit: "", publishedTestCommit: "" },
    { headCommit: undefined, publishedTestCommit: undefined },
    {},
  ]) {
    assert.throws(() => checkTestEnvironment(env, { ...elsewhere, ...commits }), /requires codex/);
  }
});

test("a matching commit keeps every other check and does not relax the default path", () => {
  const matching = {
    branch: "claude/example",
    codeOnly: true,
    headCommit: "abc",
    publishedTestCommit: "abc",
  };
  assert.throws(
    () => checkTestEnvironment(env, { ...matching, sourceStatus: " M src/server.ts\n" }),
    /clean checkout/,
  );
  assert.throws(
    () =>
      checkTestEnvironment(
        { ...env, VITE_SUPABASE_URL: "https://txgbeskieqvvptgtjyou.supabase.co" },
        matching,
      ),
    /isolated test Supabase/,
  );
  assert.throws(
    () =>
      checkTestEnvironment(
        { ...env, XWEATHER_CREDENTIAL_ENCRYPTION_KEY: "k".repeat(32) },
        { ...matching, codeOnly: false },
      ),
    /requires codex/,
  );
});

test("artifact scan always covers production databases and adds the key only when present", () => {
  assert.equal(forbiddenArtifactText(env).length, 2);
  assert.ok(forbiddenArtifactText(env).includes("txgbeskieqvvptgtjyou"));
  assert.ok(
    forbiddenArtifactText({ ...env, XWEATHER_CREDENTIAL_ENCRYPTION_KEY: "secret" }).includes(
      "secret",
    ),
  );
});
