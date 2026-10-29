import assert from "node:assert/strict";
const base = "https://landdraft-public-parcels.tight-sky-0ae1.workers.dev";
const key = "texas/versions/0000000000000000/manifest.json";
const headers = { Authorization: `Bearer ${process.env.PARCEL_PUBLISH_TOKEN}` };
const call = async (action, params, method, body) => {
  const response = await fetch(
    `${base}/admin/${action}?${new URLSearchParams({ key, ...params })}`,
    { method, headers, body, signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`Publisher check ${action} failed (${response.status})`);
  return response.json();
};
const { uploadId } = await call("start", {}, "POST");
const probe = {
  purpose: "Publisher integration test; never an active dataset",
  at: new Date().toISOString(),
};
try {
  const part = await call("part", { uploadId, part: "1" }, "PUT", JSON.stringify(probe));
  await call("complete", { uploadId }, "POST", JSON.stringify([part]));
  const response = await fetch(`${base}/${key}?probe=${Date.now()}`);
  assert.deepEqual(await response.json(), probe);
  console.log("Server-side publisher credential, multipart upload and public read verified.");
} catch (error) {
  await call("abort", { uploadId }, "DELETE").catch(() => {});
  throw error;
}
