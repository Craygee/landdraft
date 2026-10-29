import { downloadParcels, SOURCE_URL, validateBounds } from "./model.ts";

// Constant-time comparison so response timing does not reveal the job secret.
const secretMatches = (provided: string | null, expected: string) => {
  const a = new TextEncoder().encode(provided ?? "");
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) difference |= (a[i] ?? 0) ^ b[i]!;
  return difference === 0;
};

// Called only by the database scheduler. User configuration uses RLS-protected RPCs.
Deno.serve(async (req) => {
  const secret = Deno.env.get("PARCEL_JOB_SECRET");
  if (
    req.method !== "POST" ||
    !secret ||
    secret.length < 32 ||
    !secretMatches(req.headers.get("x-parcel-job-secret"), secret)
  )
    return new Response("Unauthorized", { status: 401 });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const rpc = async (name: string, body: unknown) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("Parcel job database request failed");
    return r.status === 204 ? null : await r.json();
  };
  try {
    const [job] = await rpc("claim_parcel_cache_job", {});
    if (!job) return Response.json({ status: "idle" });
    let data = null,
      provenance = null,
      error = null;
    try {
      data = await downloadParcels(validateBounds(job.bounds));
      if (job.feature_count > 0 && data.features.length === 0)
        throw new Error("Unexpected empty replacement requires review");
      provenance = {
        source: SOURCE_URL,
        product: "2025 Land Parcels",
        provider: "TxDOT / TxGIO / contributing appraisal districts",
        bounds: job.bounds,
        retrievedAt: new Date().toISOString(),
        version: "parcel-cache-v1",
        notice:
          "Not a survey. Acquisition dates and tax years are preserved on each parcel. Weekly checks do not imply weekly source updates.",
      };
    } catch {
      // Do not leak request contents, location, or source payloads into logs.
      error =
        "Publisher unavailable, incomplete data, or project-area limit exceeded. Last successful copy retained; review area or try later.";
    }
    await rpc("finish_parcel_cache_job", {
      p_project: job.project_id,
      p_lease: job.lease,
      p_data: data,
      p_provenance: provenance,
      p_error: error,
    });
    return Response.json({ status: error ? "error" : "ready" });
  } catch {
    return Response.json(
      { error: "Parcel job failed; last successful copy retained." },
      { status: 503 },
    );
  }
});
