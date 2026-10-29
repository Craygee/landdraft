export async function siteAllowed(url: string, key: string, authorization: string) {
  if (Deno.env.get("LANDDRAFT_ACCESS_ENFORCEMENT") !== "true") return true;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/landdraft_access_status`, {
      method: "POST",
      headers: { apikey: key, authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ p_module: "mapping.core" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body.active === true && body.allowed === true;
  } catch {
    return false;
  }
}
