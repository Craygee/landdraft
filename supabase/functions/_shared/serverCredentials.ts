export type EnvironmentReader = (name: string) => string | undefined;

const parseDefaultSecretKey = (raw: string | undefined) => {
  if (!raw) return "";
  try {
    const keys = JSON.parse(raw) as Record<string, unknown>;
    return typeof keys["default"] === "string" ? keys["default"].trim() : "";
  } catch {
    return "";
  }
};

/**
 * Prefer Supabase's current server-only secret key, while retaining the legacy
 * service-role JWT as a migration fallback.
 */
export const readSupabaseServerKey = (readEnvironment: EnvironmentReader) =>
  parseDefaultSecretKey(readEnvironment("SUPABASE_SECRET_KEYS")) ||
  readEnvironment("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
  "";

const isLegacyJwt = (key: string) => key.split(".").length === 3;

/**
 * Publishable/secret API keys belong only in `apikey`. Legacy service-role JWTs
 * still require the bearer header for PostgREST role selection.
 */
export const supabaseServerHeaders = (key: string): Record<string, string> => ({
  apikey: key,
  ...(isLegacyJwt(key) ? { Authorization: `Bearer ${key}` } : {}),
  "Content-Type": "application/json",
});
