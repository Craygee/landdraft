import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  readSupabaseServerKey,
  supabaseServerHeaders,
} from "../../../supabase/functions/_shared/serverCredentials.ts";

test("Supabase server credentials prefer the current secret-key dictionary", () => {
  const environment = new Map([
    ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_current" })],
    ["SUPABASE_SERVICE_ROLE_KEY", "legacy.header.signature"],
  ]);

  assert.equal(
    readSupabaseServerKey((name) => environment.get(name)),
    "sb_secret_current",
  );
  assert.deepEqual(supabaseServerHeaders("sb_secret_current"), {
    apikey: "sb_secret_current",
    "Content-Type": "application/json",
  });
});

test("legacy service-role JWTs retain their bearer authorization header", () => {
  assert.deepEqual(supabaseServerHeaders("legacy.header.signature"), {
    apikey: "legacy.header.signature",
    Authorization: "Bearer legacy.header.signature",
    "Content-Type": "application/json",
  });
});

test("the corrective quota migration does not schema-qualify SQL expressions", () => {
  const sql = readFileSync(
    new URL(
      "../../../supabase/migrations/202611050001_fix_ai_quota_functions.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /create or replace function public\.consume_ai_daily_quota/);
  assert.match(sql, /create or replace function public\.release_ai_daily_quota/);
  assert.doesNotMatch(sql, /pg_catalog\.(?:coalesce|greatest)/i);
});
