import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "./catalog.ts";
import { fillBboxPlaceholder } from "./connectionProbe.ts";

test("connection checks send map-image sources a real map area", () => {
  const imageSources = catalog.filter((entry) => entry.url?.includes("{bbox-epsg-3857}"));
  assert.ok(imageSources.length > 0);
  for (const entry of imageSources) {
    const filled = fillBboxPlaceholder(entry.url!);
    assert.ok(!filled.includes("{"), entry.id);
    assert.match(filled, /bbox=-?\d+,-?\d+,-?\d+,-?\d+&/, entry.id);
  }
});

test("URLs without the placeholder are left unchanged", () => {
  const url = "https://example.test/MapServer/0";
  assert.equal(fillBboxPlaceholder(url), url);
});
