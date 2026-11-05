import assert from "node:assert/strict";
import test from "node:test";

import { catalog } from "./catalog.ts";
import {
  NO_PUBLIC_DATA_TEMPLATE,
  applyPublicDataTemplateLayers,
  isSourceOnlyCatalogEntry,
  publicDataTemplateEntries,
  publicDataTemplates,
} from "./publicDataTemplates.ts";
import { defaultStyle, type GisLayer } from "./types.ts";

test("new projects default to no public data template", () => {
  assert.deepEqual(publicDataTemplateEntries(NO_PUBLIC_DATA_TEMPLATE), []);
});

test("every shipped template references ready-to-load catalog services", () => {
  for (const template of publicDataTemplates) {
    const entries = publicDataTemplateEntries(template.id);
    assert.equal(entries.length, template.catalogIds.length, template.name);
    assert.ok(
      entries.every((entry) => Boolean(entry.url)),
      template.name,
    );
  }
});

test("study area report template spans the core evidence categories", () => {
  const entries = publicDataTemplateEntries("study-area-report-screening");
  const ids = new Set(entries.map((entry) => entry.id));

  assert.ok(ids.has("usgs-annual-nlcd-land-cover"));
  assert.ok(ids.has("nrcs-ssurgo-map-units"));
  assert.ok(ids.has("fema-flood-zones"));
  assert.ok(ids.has("fema-national-risk-index"));
  assert.ok(ids.has("us-primary-roads-current"));
  assert.ok(ids.has("us-power-plants-eia"));
});

test("West Virginia templates combine state services with the existing national energy foundation", () => {
  const energy = publicDataTemplateEntries("west-virginia-energy-infrastructure");
  const energyIds = new Set(energy.map((entry) => entry.id));
  const screening = publicDataTemplateEntries("west-virginia-site-screening");
  const screeningIds = new Set(screening.map((entry) => entry.id));

  assert.ok(energyIds.has("wv-oil-gas-wells"));
  assert.ok(energyIds.has("wv-horizontal-well-laterals"));
  assert.ok(energyIds.has("wv-gas-pipeline-construction"));
  assert.ok(energyIds.has("tx-transmission"));
  assert.ok(energyIds.has("tx-pipelines"));
  assert.ok(energyIds.has("us-power-plants-eia"));
  assert.ok(screeningIds.has("wv-parcels-statewide"));
  assert.ok(screeningIds.has("us-local-roads-current"));
  assert.ok(screeningIds.has("fema-flood-zones"));
  assert.ok(screeningIds.has("usgs-topographic-map"));
});

test("applying a template adds visible layers without duplicating catalog sources", () => {
  const first = applyPublicDataTemplateLayers([], "national-energy-development", 100);
  assert.equal(first.added, 5);
  assert.ok(first.layers.every((layer) => layer.visible));
  assert.ok(first.layers.every((layer) => layer.groupId === "public"));

  const hidden = first.layers.map((layer, index) =>
    index === 0 ? { ...layer, visible: false } : layer,
  );
  const second = applyPublicDataTemplateLayers(hidden, "national-energy-development", 200);
  assert.equal(second.added, 0);
  assert.equal(second.shown, 1);
  assert.equal(second.layers.length, first.layers.length);
  assert.ok(second.layers.every((layer) => layer.visible));
});

test("template application preserves an existing configured catalog layer", () => {
  const existing: GisLayer = {
    id: "existing",
    name: "Configured power plants",
    groupId: "public",
    visible: true,
    data: { type: "FeatureCollection", features: [] },
    style: defaultStyle(),
    source: {
      kind: "remote",
      url: "https://example.test/custom",
      catalogId: "us-power-plants-eia",
      where: "custom = 1",
    },
    createdAt: 1,
  };
  const result = applyPublicDataTemplateLayers([existing], "national-energy-development", 200);
  assert.equal(result.added, 4);
  assert.equal(result.layers.find((layer) => layer.id === "existing")?.source, existing.source);
});

test("source-only filter matches catalog rows whose action is Source", () => {
  const sourceOnly = catalog.find((entry) => !entry.url && !entry.downloadUrl);
  const ready = catalog.find((entry) => Boolean(entry.url || entry.downloadUrl));
  assert.ok(sourceOnly);
  assert.ok(ready);
  assert.equal(isSourceOnlyCatalogEntry(sourceOnly), true);
  assert.equal(isSourceOnlyCatalogEntry(ready), false);
});
