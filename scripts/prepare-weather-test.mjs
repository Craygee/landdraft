import { readFile, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (branch !== "codex/landdraft-test")
  throw new Error("Test deployment requires codex/landdraft-test");
const env = process.env;
if (env.VITE_LANDDRAFT_ACCESS_ENFORCEMENT !== "true")
  throw new Error(
    "Test access controls are active: build and deploy with VITE_LANDDRAFT_ACCESS_ENFORCEMENT=true",
  );
const url = "https://unuxnecqjvmtztxxqudb.supabase.co";
if (
  env.VITE_SUPABASE_URL !== url ||
  !env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")
)
  throw new Error("Expected isolated test Supabase public configuration");
if (!env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY || env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY.length < 32)
  throw new Error("Missing existing test encryption key");
const policy = JSON.parse(env.WEATHER_PROVIDER_POLICY || "{}");
if (policy.version !== 1 || !Array.isArray(policy.grants) || policy.grants.length)
  throw new Error("Online test release must have zero commercial grants");
const configPath = resolve(".output/server/wrangler.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.main !== "index.mjs" || !config.assets?.directory)
  throw new Error("Unexpected Worker build");
config.name = "landdraft-test";
config.account_id = "af489b2ad3227fd7aaafd91556d7893f";
config.workers_dev = true;
config.preview_urls = false;
delete config.routes;
delete config.route;
config.vars = {
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  WEATHER_PROVIDER_POLICY: JSON.stringify(policy),
  WEATHER_ENABLE_OPEN_METEO_EVALUATION: "false",
};
// Preserve the account's existing plan limits; never require a paid upgrade.
delete config.limits;
const publicRoot = resolve(".output/public");
let testReferenceSeen = false;
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    if (!/\.(js|mjs|json|html|map)$/.test(entry.name)) continue;
    const text = await readFile(file, "utf8");
    if (text.includes("unuxnecqjvmtztxxqudb")) testReferenceSeen = true;
    if (
      ["txgbeskieqvvptgtjyou", "ijramwbgxtsigjolovjp", env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY].some(
        (value) => text.includes(value),
      )
    )
      throw new Error("Public artifact contains a forbidden database reference or secret");
  }
}
await scan(publicRoot);
if (!testReferenceSeen) throw new Error("Test database reference absent from browser build");
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
await writeFile(
  resolve(".output/weather-test-secrets.json"),
  JSON.stringify({
    XWEATHER_CREDENTIAL_ENCRYPTION_KEY: env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY,
  }),
);
const headersFile = join(publicRoot, "_headers");
const headers = await readFile(headersFile, "utf8").catch(() => "");
await writeFile(headersFile, headers + "\n/*\n  X-Robots-Tag: noindex, nofollow\n");
await writeFile(
  join(publicRoot, "weather-test-release.json"),
  JSON.stringify(
    {
      environment: "test",
      builtAt: new Date().toISOString(),
      branch,
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      scope:
        "LandDraft Weather public-source layers, native radar/rainfall, and versioned storm intensity, trend, confidence, quality and explainability analysis; test beta",
      commercialProvidersEnabled: false,
    },
    null,
    2,
  ),
);
console.log(
  "Prepared isolated landdraft-test Worker; artifact isolation and secret scan passed. No secret values printed.",
);
