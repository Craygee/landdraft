import assert from "node:assert/strict";
import test from "node:test";
import { infrastructureCatalog } from "./infrastructureCatalog.ts";
import { catalog, categories, searchCatalog } from "./catalog.ts";

test("infrastructure additions ship to new users without replacing existing public layers", () => {
  assert.equal(new Set(catalog.map((entry) => entry.id)).size, catalog.length);
  for (const id of [
    "tx-parcels",
    "tx-transmission",
    "tx-rrc-pipelines",
    "nhd-flowlines",
    "fws-wetlands",
    "us-opportunity-zones",
  ]) {
    assert.ok(
      catalog.some((entry) => entry.id === id),
      id,
    );
  }
  for (const entry of infrastructureCatalog) {
    assert.ok(searchCatalog("", null, ["TX"]).includes(entry));
  }
  assert.ok(categories.includes("Communications"));
  assert.equal(searchCatalog("fiber", "Communications", ["TX"]).length, 3);
  assert.equal(searchCatalog("Round Rock", "Communications", ["CA"]).length, 0);
});

test("restricted and proprietary sources remain references rather than automatic data imports", () => {
  for (const id of ["tx-coop-districts-reference", "tx-broadband-coverage-reference"]) {
    const entry = infrastructureCatalog.find((entry) => entry.id === id)!;
    assert.equal(entry.connection, "download");
    assert.equal(entry.url, undefined);
    assert.equal(entry.downloadUrl, undefined);
    assert.ok(entry.sourcePage?.startsWith("https://"));
    assert.match(entry.license, /restrict|proprietary/i);
  }
});

test("live infrastructure stays viewport bounded with explicit archive and geographic scope", () => {
  const mapped = infrastructureCatalog.filter((entry) => entry.url);
  assert.equal(mapped.length, 8);
  for (const entry of mapped) {
    assert.equal(entry.requiresViewport, true);
    assert.ok(entry.minZoom! >= 7);
    assert.equal(entry.connection, "live");
    assert.match(entry.url!, /\/(?:FeatureServer|MapServer)\/\d+$/);
  }
  const substations = mapped.find((entry) => entry.id === "tx-substations-archive")!;
  assert.equal(substations.where, "STATE = 'TX'");
  assert.match(substations.updateCadence, /Historical/);
  assert.match(substations.description, /do not establish available MW/);
});
