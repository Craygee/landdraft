import assert from "node:assert/strict";
import test from "node:test";
import { catalog } from "./catalog.ts";
import { catalogEntryTags, catalogMinZoom } from "./catalogTags.ts";

const tagLabel = (id: string, kind: string) => {
  const entry = catalog.find((item) => item.id === id);
  assert.ok(entry, id);
  return catalogEntryTags(entry).find((tag) => tag.kind === kind)?.label;
};

test("map-image layers are tagged as map images, not polygons", () => {
  const rasters = catalog.filter((entry) => entry.rendering === "raster-tiles");
  assert.ok(rasters.length > 0);
  for (const entry of rasters) {
    const tags = catalogEntryTags(entry);
    assert.equal(tags.find((tag) => tag.kind === "geometry")?.label, "map image", entry.id);
    assert.equal(tags.find((tag) => tag.kind === "access")?.label, "streamed map tiles", entry.id);
  }
});

test("source-only entries say they open a source page, not that they download or load data", () => {
  const sourceOnly = catalog.filter((entry) => !entry.url && !entry.downloadUrl);
  assert.ok(sourceOnly.length > 0);
  for (const entry of sourceOnly) {
    const tags = catalogEntryTags(entry);
    assert.equal(tags.find((tag) => tag.kind === "connection")?.label, "source page only");
    assert.equal(
      tags.some((tag) => tag.kind === "access" || tag.kind === "zoom"),
      false,
    );
  }
});

test("zoom tags report the zoom the added layer really starts drawing at", () => {
  for (const entry of catalog) {
    if (!entry.url || entry.id === "tx-parcels") continue;
    const zoom = catalogEntryTags(entry).find((tag) => tag.kind === "zoom");
    const expected = catalogMinZoom(entry);
    if (expected === 0) assert.equal(zoom, undefined, entry.id);
    else assert.equal(zoom?.label, `zoom ${expected}+`, entry.id);
  }
  assert.equal(tagLabel("usgs-imagery", "zoom"), undefined);
  assert.equal(tagLabel("usgs-3dep-hillshade", "zoom"), "zoom 8+");
  assert.equal(tagLabel("tx-counties", "zoom"), "zoom 5+");
  assert.equal(tagLabel("tx-groundwater-wells", "zoom"), "zoom 8+");
});

test("census tracts load the 2020 tract layer, not block groups", () => {
  const tracts = catalog.find((entry) => entry.id === "census-tracts");
  assert.match(tracts?.url ?? "", /TIGERweb\/Tracts_Blocks\/MapServer\/10$/);
  assert.equal(tracts?.keywords.includes("population"), false);
});

test("gas pipeline layers share the Oil & Gas category", () => {
  for (const id of ["tx-pipelines", "tx-rrc-pipelines", "wv-natural-gas-pipelines-wvdot"])
    assert.equal(tagLabel(id, "category"), "Oil & Gas", id);
});

test("search words describe the data, not every workflow it might help", () => {
  for (const id of ["usgs-hospitals", "usgs-trails", "usgs-runways", "usgs-fire-ems"]) {
    const entry = catalog.find((item) => item.id === id)!;
    assert.equal(entry.keywords.includes("data center"), false, id);
  }
  for (const id of ["fema-100-year-floodplain", "fema-500-year-floodplain"]) {
    const entry = catalog.find((item) => item.id === id)!;
    assert.equal(entry.keywords.includes("floodway"), false, id);
  }
});
