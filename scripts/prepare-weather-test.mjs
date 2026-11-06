import { readFile, rm, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import {
  TEST_SUPABASE_URL as url,
  checkTestEnvironment,
  forbiddenArtifactText,
  isCodeOnly,
} from "./weather-test-preflight.mjs";

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
const env = process.env;
const codeOnly = isCodeOnly(process.argv);
const policy = checkTestEnvironment(env, {
  branch,
  codeOnly,
  sourceStatus: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }),
});
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
const forbidden = forbiddenArtifactText(env);
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
    if (forbidden.some((value) => text.includes(value)))
      throw new Error("Public artifact contains a forbidden database reference or secret");
  }
}
await scan(publicRoot);
if (!testReferenceSeen) throw new Error("Test database reference absent from browser build");
if (codeOnly) await scan(resolve(".output/server"));
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
const secretsFile = resolve(".output/weather-test-secrets.json");
if (codeOnly) await rm(secretsFile, { force: true });
else
  await writeFile(
    secretsFile,
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
      ...(codeOnly ? { preparation: "code-only" } : {}),
    },
    null,
    2,
  ),
);
console.log(
  codeOnly
    ? "Prepared isolated landdraft-test Worker in code-only mode; artifact isolation scan passed. No secrets file written; existing Worker secrets are left as they are."
    : "Prepared isolated landdraft-test Worker; artifact isolation and secret scan passed. No secret values printed.",
);
