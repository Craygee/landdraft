import assert from "node:assert/strict";
import test from "node:test";
import { catalog, retiredCatalog, searchCatalog, SURFACE_WATER_CATEGORY } from "./catalog.ts";

test("surface water shortcut includes existing water and wetland connections without duplicates", () => {
  const entries = searchCatalog("", SURFACE_WATER_CATEGORY, ["TX"]);
  assert.equal(entries.length, 8);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 8);
  for (const entry of entries) {
    assert.ok(entry.url?.startsWith("https://"));
    assert.equal(entry.connection, "live");
    assert.ok(catalog.includes(entry));
    assert.ok(searchCatalog("", entry.category, ["TX"]).includes(entry));
  }
  assert.deepEqual(
    searchCatalog("wetland", SURFACE_WATER_CATEGORY).map((entry) => entry.id),
    ["fws-wetlands"],
  );
  assert.ok(entries.some((entry) => entry.id === "nhd-flowlines"));
  assert.ok(entries.some((entry) => entry.id === "usgs-waterbodies"));
});

test("retired defaults stay absent for new accounts but remain individually reconnectable", () => {
  const entry = { ...catalog[0]!, id: "test-retired-source", name: "Retired test source" };
  retiredCatalog.push(entry);
  try {
    assert.equal(searchCatalog("Retired test source", null).length, 0);
    assert.deepEqual(
      searchCatalog("Retired test source", null, ["TX"], { "catalog:test-retired-source": true }),
      [entry],
    );
    assert.equal(searchCatalog("Retired test source", null).length, 0);
  } finally {
    retiredCatalog.splice(retiredCatalog.indexOf(entry), 1);
  }
});
