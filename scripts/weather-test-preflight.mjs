export const TEST_SUPABASE_URL = "https://unuxnecqjvmtztxxqudb.supabase.co";
export const TEST_BRANCH = "codex/landdraft-test";
const FORBIDDEN_DATABASE_REFERENCES = ["txgbeskieqvvptgtjyou", "ijramwbgxtsigjolovjp"];

/**
 * Code-only preparation deploys application code and leaves the Worker's existing secrets alone.
 * It does not need the encryption key and never writes a secrets file.
 */
export const isCodeOnly = (argv) => argv.includes("--code-only");

/** Every requirement for a test deployment, returning the validated provider policy. */
export function checkTestEnvironment(
  env,
  { branch, codeOnly, sourceStatus = "", headCommit, publishedTestCommit },
) {
  // A second checkout cannot hold the test branch itself, so code-only preparation also
  // accepts the exact commit that branch has published. The default path stays strict.
  const atPublishedCommit = codeOnly && Boolean(headCommit) && headCommit === publishedTestCommit;
  if (branch !== TEST_BRANCH && !atPublishedCommit)
    throw new Error(
      `Test deployment requires ${TEST_BRANCH}, or for code-only its exact published commit`,
    );
  if (env.VITE_LANDDRAFT_ACCESS_ENFORCEMENT !== "true")
    throw new Error(
      "Test access controls are active: build and deploy with VITE_LANDDRAFT_ACCESS_ENFORCEMENT=true",
    );
  if (
    env.VITE_SUPABASE_URL !== TEST_SUPABASE_URL ||
    !env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")
  )
    throw new Error("Expected isolated test Supabase public configuration");
  if (codeOnly) {
    // The release file names one commit, so uncommitted changes would make it untrue.
    if (sourceStatus.trim())
      throw new Error("Code-only deployment requires a clean checkout of the named commit");
  } else if (
    !env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY ||
    env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY.length < 32
  )
    throw new Error("Missing existing test encryption key");
  const policy = JSON.parse(env.WEATHER_PROVIDER_POLICY || "{}");
  if (policy.version !== 1 || !Array.isArray(policy.grants) || policy.grants.length)
    throw new Error("Online test release must have zero commercial grants");
  return policy;
}

/** Text that must never appear in a built artifact. The key is checked only when it is present. */
export const forbiddenArtifactText = (env) => [
  ...FORBIDDEN_DATABASE_REFERENCES,
  ...(env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY ? [env.XWEATHER_CREDENTIAL_ENCRYPTION_KEY] : []),
];
