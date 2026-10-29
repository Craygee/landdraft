import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const token = randomBytes(48).toString("base64url");
const run = (exe, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "";
    p.stdout.on("data", (b) => (output += b));
    p.stderr.on("data", (b) => (output += b));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Credential provisioning command failed; no credential printed.")),
    );
    p.stdin.end(token);
  });
await run(process.execPath, [
  process.env.PARCEL_WRANGLER_JS,
  "secret",
  "put",
  "PUBLISH_TOKEN",
  "--config",
  "tools/parcel-worker/wrangler.json",
]);
await run("C:/Program Files/GitHub CLI/gh.exe", [
  "secret",
  "set",
  "PARCEL_PUBLISH_TOKEN",
  "--repo",
  "Craygee/terrasketch-gis",
]);
console.log(
  "Dedicated parcel publishing credential installed in Worker and GitHub Actions; not written to disk.",
);
