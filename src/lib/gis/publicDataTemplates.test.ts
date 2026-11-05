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
