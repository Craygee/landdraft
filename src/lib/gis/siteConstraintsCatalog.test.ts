import assert from "node:assert/strict";
import test from "node:test";
import { siteConstraintsCatalog } from "./siteConstraintsCatalog.ts";

test("site screening catalog separates map connections from source-only references", () => {
  assert.equal(
    new Set(siteConstraintsCatalog.map((entry) => entry.id)).size,
    siteConstraintsCatalog.length,
  );
  const mapped = siteConstraintsCatalog.filter((entry) => entry.url);
  assert.equal(mapped.length, 23);
  for (const entry of mapped) {
    assert.equal(entry.requiresViewport, true);
    assert.ok(entry.minZoom !== undefined);
    assert.ok(entry.sourcePage?.startsWith("https://"));
  }
  for (const entry of siteConstraintsCatalog.filter((entry) => !entry.url)) {
    assert.equal(entry.connection, "download");
    assert.ok(entry.sourcePage);
  }
});

test("FEMA floodplain presets use source filters instead of duplicating all flood zones", () => {
  for (const id of [
    "fema-100-year-floodplain",
    "fema-500-year-floodplain",
    "fema-regulatory-floodway",
  ]) {
    const entry = siteConstraintsCatalog.find((item) => item.id === id);
    assert.ok(entry);
    assert.ok(entry?.url?.endsWith("/MapServer/28"));
    assert.ok(entry.where);
  }
});
