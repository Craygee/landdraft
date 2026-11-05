import test from "node:test";
import assert from "node:assert/strict";
import { catalog, retiredCatalog } from "./catalog.ts";

test("offers detailed RRC pipeline data without removing the broader EIA layer", () => {
  const rrc = catalog.find((entry) => entry.id === "tx-rrc-pipelines");
  const eia = catalog.find((entry) => entry.id === "tx-pipelines");
  const countyZips = catalog.find((entry) => entry.id === "rrc-pipeline-county-downloads");

  assert.equal(rrc?.agency, "Railroad Commission of Texas");
  assert.equal(rrc?.countyField, "COUNTY_NAME");
  assert.match(rrc?.url ?? "", /RRC_Public_Viewer_Srvs\/MapServer\/13$/);
  assert.equal(eia?.agency, "U.S. Energy Information Administration");
  assert.equal(countyZips?.connection, "download");
  assert.match(countyZips?.sourcePage ?? "", /^https:\/\/mft\.rrc\.texas\.gov\//);
});

test("offers the official Census state-boundary shapefile as ready-to-add public data", () => {
  const states = catalog.find((entry) => entry.id === "us-state-boundaries-shp");

  assert.equal(states?.agency, "U.S. Census Bureau");
  assert.equal(states?.category, "Boundaries");
  assert.equal(states?.connection, "download");
  assert.match(states?.downloadUrl ?? "", /cb_2025_us_state_500k\.zip$/);
  assert.equal(states?.states, "US");
});

test("offers federal Opportunity Zones as a bounded viewport service", () => {
  const zones = catalog.find((entry) => entry.id === "us-opportunity-zones");

  assert.match(zones?.agency ?? "", /Housing and Urban Development/);
  assert.equal(zones?.category, "Demographics");
  assert.equal(zones?.connection, "live");
  assert.equal(zones?.requiresViewport, true);
  assert.equal(zones?.minZoom, 7);
  assert.match(zones?.url ?? "", /Opportunity_Zones\/FeatureServer\/13$/);
  assert.equal(zones?.states, "US");
});

test("keeps the retired USGS contour source reconnectable without shipping it to new users", () => {
  assert.equal(
    catalog.some((entry) => entry.id === "usgs-contours"),
    false,
  );
  assert.equal(
    retiredCatalog.some((entry) => entry.id === "usgs-contours"),
    true,
  );
  assert.equal(
    catalog.some((entry) => entry.id === "usgs-topographic-map"),
    true,
  );
});

test("ships live power, peaker-screen and Texas gas-plant layers with explicit provenance", () => {
  const power = catalog.find((entry) => entry.id === "us-power-plants-eia");
  const peakers = catalog.find((entry) => entry.id === "us-peaker-plant-candidates-eia");
  const texasGasPower = catalog.find((entry) => entry.id === "tx-natural-gas-power-plants-eia");
  const processing = catalog.find((entry) => entry.id === "tx-natural-gas-processing-plants-hifld");

  assert.equal(power?.category, "Energy");
  assert.equal(power?.connection, "live");
  assert.equal(power?.states, "US");
  assert.match(power?.url ?? "", /Power_Plants_in_the_US\/FeatureServer\/0$/);
  assert.equal(power?.defaultStyle?.pointIcon, "⚡");

  assert.match(peakers?.where ?? "", /Combustion Turbine/);
  assert.match(peakers?.description ?? "", /not an official dispatch or market designation/i);
  assert.equal(peakers?.states, "US");

  assert.equal(texasGasPower?.states instanceof Array, true);
  assert.match(texasGasPower?.where ?? "", /State = 'Texas'/);
  assert.match(texasGasPower?.where ?? "", /PrimSource = 'natural gas'/);

  assert.equal(processing?.category, "Oil & Gas");
  assert.equal(processing?.connection, "live");
  assert.match(processing?.url ?? "", /Natural_Gas_Processing_Plants\/FeatureServer\/2$/);
  assert.match(processing?.description ?? "", /independently hosted copy/i);
});
