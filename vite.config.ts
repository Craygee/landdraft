// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

type PackageMetadata = { version?: string };

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as PackageMetadata;

const readGitValue = (args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const baseVersion = packageMetadata.version ?? "0.0.0";
const [major = "0", minor = "0"] = baseVersion.split(".");
const commitCount =
  process.env["VITE_LANDDRAFT_BUILD_NUMBER"] ?? readGitValue(["rev-list", "--count", "HEAD"]);
const environmentRevision =
  process.env["VITE_LANDDRAFT_COMMIT_SHA"] ??
  process.env["CF_PAGES_COMMIT_SHA"] ??
  process.env["VERCEL_GIT_COMMIT_SHA"] ??
  process.env["GITHUB_SHA"] ??
  process.env["COMMIT_SHA"];
const commitHash =
  environmentRevision?.slice(0, 8) ?? readGitValue(["rev-parse", "--short=8", "HEAD"]);
const releaseCommitMessage = readGitValue(["log", "-1", "--pretty=%s"]);
const deploymentReleaseVersion = /^Publish LandDraft (\d+\.\d+\.\d+)(?:\s|$)/.exec(
  releaseCommitMessage,
)?.[1];
const branchName =
  process.env["VITE_LANDDRAFT_BRANCH"] ??
  process.env["WORKERS_CI_BRANCH"] ??
  process.env["CF_PAGES_BRANCH"] ??
  process.env["VERCEL_GIT_COMMIT_REF"] ??
  process.env["GITHUB_REF_NAME"] ??
  (readGitValue(["branch", "--show-current"]) || "release");
// Lovable checks out the deployment repository as a shallow detached revision. Its Git commit
// count is therefore usually 1 and it has no reliable branch name. The forward-only deployment
// sync commit carries the authoritative release number in its subject so both repositories show
// the same production channel/version without relying on hosting-specific environment variables.
const releaseBranch =
  Boolean(deploymentReleaseVersion) ||
  ["main", "master", "production", "release"].includes(branchName);
const channel = releaseBranch ? "" : "-test";
const numberedVersion = deploymentReleaseVersion
  ? deploymentReleaseVersion
  : commitCount
    ? `${major}.${minor}.${commitCount}${channel}`
    : baseVersion;
const appVersion = commitHash ? `${numberedVersion}+${commitHash}` : numberedVersion;

// Nitro's default buffer/index.js alias targets Node; radar workers need the browser package.
const nativeRadarBuild = {
  cloudflare: { nodeCompat: true },
  alias: { "buffer/index.js": createRequire(import.meta.url).resolve("buffer/index.js") },
};
export default defineConfig({
  nitro: nativeRadarBuild,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: { watch: { ignored: ["**/.release/**", "**/.codex-worktrees/**"] } },
    // MapLibre ships its own web worker; pre-bundling breaks the worker URL in dev.
    optimizeDeps: { exclude: ["maplibre-gl"] },
    define: {
      __LANDDRAFT_APP_VERSION__: JSON.stringify(appVersion),
      __LANDDRAFT_APP_CHANNEL__: JSON.stringify(releaseBranch ? "release" : "test"),
      __LANDDRAFT_APP_REVISION__: JSON.stringify(commitHash || "source"),
    },
  },
});
