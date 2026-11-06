import test from "node:test";
import assert from "node:assert/strict";
import { catalog, retiredCatalog, searchCatalog } from "./catalog.ts";
import { studyEvidenceCatalog } from "./studyEvidenceCatalog.ts";
import { PIPELINE_COMMODITY_COLORS, pipelineCommodityColor } from "./pipelineCommodity.ts";
import {
  EIA_TRANSMISSION_VOLTAGE_RULES,
  TRANSMISSION_VOLTAGE_COLORS,
  transmissionVoltageColor,
} from "./transmissionVoltage.ts";

test("offers detailed RRC pipeline data without removing the broader EIA layer", () => {
  const rrc = catalog.find((entry) => entry.id === "tx-rrc-pipelines");
  const eia = catalog.find((entry) => entry.id === "tx-pipelines");
  const countyZips = catalog.find((entry) => entry.id === "rrc-pipeline-county-downloads");

  assert.equal(rrc?.agency, "Railroad Commission of Texas");
  assert.equal(rrc?.countyField, "COUNTY_NAME");
  assert.match(rrc?.url ?? "", /RRC_Public_Viewer_Srvs\/MapServer\/13$/);
  assert.equal(rrc?.defaultStyle?.categorized?.field, "COMMODITY");
  assert.equal(
    rrc?.defaultStyle?.categorized?.rules.find((rule) => rule.value === "NATURAL GAS")?.color,
    PIPELINE_COMMODITY_COLORS.naturalGas,
  );
  assert.equal(
    pipelineCommodityColor("natural gas offshore"),
    PIPELINE_COMMODITY_COLORS.naturalGas,
  );
  assert.equal(pipelineCommodityColor("CRUDE OIL"), PIPELINE_COMMODITY_COLORS.crudeOil);
  assert.equal(eia?.agency, "U.S. Energy Information Administration");
  assert.equal(countyZips?.connection, "download");
  assert.match(countyZips?.sourcePage ?? "", /^https:\/\/mft\.rrc\.texas\.gov\//);
});

test("styles national transmission lines from the numeric VOLTAGE attribute", () => {
  const transmission = catalog.find((entry) => entry.id === "tx-transmission");

  assert.equal(transmission?.defaultStyle?.strokePattern, "dashed");
  assert.equal(transmission?.defaultStyle?.categorized?.field, "VOLTAGE");
  assert.equal(transmission?.defaultStyle?.categorized?.rules, EIA_TRANSMISSION_VOLTAGE_RULES);
  assert.equal(transmissionVoltageColor(69), TRANSMISSION_VOLTAGE_COLORS.under100);
  assert.equal(transmissionVoltageColor("138"), TRANSMISSION_VOLTAGE_COLORS.from100To161);
  assert.equal(transmissionVoltageColor(345), TRANSMISSION_VOLTAGE_COLORS.from288To449);
  assert.equal(transmissionVoltageColor(500), TRANSMISSION_VOLTAGE_COLORS.from450To734);
  assert.equal(transmissionVoltageColor(765), TRANSMISSION_VOLTAGE_COLORS.from735);
  assert.equal(transmissionVoltageColor(-999999), TRANSMISSION_VOLTAGE_COLORS.unknown);
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

test("ships verified national study-report layers for land cover, soils and hazards", () => {
  const landCover = catalog.find((entry) => entry.id === "usgs-annual-nlcd-land-cover");
  const soils = catalog.find((entry) => entry.id === "nrcs-ssurgo-map-units");
  const hazards = catalog.find((entry) => entry.id === "fema-national-risk-index");

  assert.equal(landCover?.agency, "U.S. Geological Survey / MRLC Consortium");
  assert.equal(landCover?.rendering, "raster-tiles");
  assert.match(landCover?.url ?? "", /mrlc_Land-Cover-Native_conus_year_data\/wms/);
  assert.match(landCover?.url ?? "", /bbox=\{bbox-epsg-3857\}/);

  assert.equal(soils?.agency, "USDA Natural Resources Conservation Service");
  assert.equal(soils?.requiresViewport, true);
  assert.match(soils?.url ?? "", /nrcs-geodata.*cg_soils\/FeatureServer\/0$/);

  assert.equal(hazards?.agency, "Federal Emergency Management Agency");
  assert.equal(hazards?.requiresViewport, true);
  assert.match(hazards?.url ?? "", /National_Risk_Index_Census_Tracts\/FeatureServer\/0$/);
});

test("ships land-study evidence with unique IDs, full provenance and usable connections", () => {
  const ids = catalog.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "catalog IDs are stable and unique");
  const seen = new Map<string, string>();
  for (const entry of studyEvidenceCatalog) {
    assert.ok(entry.url, entry.id);
    assert.match(entry.url ?? "", /^https:\/\//, entry.id);
    assert.ok(entry.sourcePage && entry.license && entry.updateCadence, entry.id);
    assert.ok(entry.keywords.length, entry.id);
    if (entry.rendering === "raster-tiles")
      assert.ok(
        /\{bbox-epsg-3857\}|\/tile\/\{z\}\/\{y\}\/\{x\}$/.test(entry.url ?? ""),
        `${entry.id} needs a map-image URL template`,
      );
    else assert.match(entry.url ?? "", /\/(FeatureServer|MapServer)\/\d+$/, entry.id);
    const key = `${entry.url}|${entry.where ?? ""}`;
    assert.equal(seen.get(key), undefined, `${entry.id} duplicates ${seen.get(key)}`);
    seen.set(key, entry.id);
  }
  // No new entry repeats an existing connection under a different name.
  const existing = new Set(
    catalog
      .filter((entry) => !studyEvidenceCatalog.includes(entry))
      .map((entry) => `${entry.url}|${entry.where ?? ""}`),
  );
  assert.deepEqual(
    studyEvidenceCatalog.filter((entry) => existing.has(`${entry.url}|${entry.where ?? ""}`)),
    [],
  );

  const reports = catalog.find((entry) => entry.id === "tx-twdb-well-reports");
  assert.equal(reports?.outFields?.includes("WellOwner"), false);
  assert.equal(reports?.outFields?.includes("DateOfWellCompletion"), false);

  const texas = new Set(searchCatalog("", null, ["TX"]).map((entry) => entry.id));
  assert.ok(texas.has("tx-puc-water-ccn"));
  assert.equal(texas.has("wv-aml-polygons"), false);
  assert.ok(texas.has("padus-fee-managers"));
  const wv = new Set(searchCatalog("", null, ["WV"]).map((entry) => entry.id));
  assert.ok(wv.has("wv-aml-polygons"));
  assert.equal(wv.has("tx-puc-water-ccn"), false);
  assert.ok(searchCatalog("abandoned mine", null, ["WV"]).length >= 3);
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

test("ships verified West Virginia parcel and oil-gas services without duplicating national energy sources", () => {
  const parcels = catalog.find((entry) => entry.id === "wv-parcels-statewide");
  const wells = catalog.find((entry) => entry.id === "wv-oil-gas-wells");
  const laterals = catalog.find((entry) => entry.id === "wv-horizontal-well-laterals");
  const pads = catalog.find((entry) => entry.id === "wv-well-pads");
  const construction = catalog.find((entry) => entry.id === "wv-gas-pipeline-construction");
  const pipelines = catalog.find((entry) => entry.id === "wv-natural-gas-pipelines-wvdot");

  assert.deepEqual(parcels?.states, ["WV"]);
  assert.equal(parcels?.countyField, "COUNTY");
  assert.match(parcels?.url ?? "", /Planning_Cadastre\/WV_Parcels\/MapServer\/0$/);
  assert.match(parcels?.description ?? "", /Tax Year 2023/i);
  assert.equal(parcels?.requiresViewport, true);

  assert.match(wells?.url ?? "", /WVDEP_enterprise\/oil_gas\/MapServer\/7$/);
  assert.equal(wells?.defaultStyle?.pointIcon, "⊙");
  assert.match(laterals?.url ?? "", /oil_gas\/MapServer\/6$/);
  assert.equal(laterals?.defaultStyle?.strokeColor, PIPELINE_COMMODITY_COLORS.naturalGas);
  assert.match(pads?.url ?? "", /oil_gas\/MapServer\/10$/);
  assert.equal(construction?.geometry, "polygon");
  assert.match(construction?.description ?? "", /not a complete map of operating/i);
  assert.match(pipelines?.url ?? "", /Assets\/Assets\/FeatureServer\/64$/);
  assert.equal(pipelines?.geometry, "line");
  assert.deepEqual(pipelines?.states, ["WV"]);
  assert.equal(pipelines?.defaultStyle?.strokeColor, PIPELINE_COMMODITY_COLORS.naturalGas);
  assert.equal(pipelines?.defaultStyle?.strokePattern, "dashed");
  assert.match(pipelines?.description ?? "", /does not publish a source vintage/i);
  assert.match(pipelines?.description ?? "", /contact 811/i);

  const westVirginia = searchCatalog("", null, ["WV"]);
  const ids = new Set(westVirginia.map((entry) => entry.id));
  assert.ok(ids.has("wv-parcels-statewide"));
  assert.ok(ids.has("wv-oil-gas-wells"));
  assert.ok(ids.has("wv-natural-gas-pipelines-wvdot"));
  assert.ok(ids.has("tx-transmission"));
  assert.ok(ids.has("tx-pipelines"));
  assert.ok(ids.has("us-power-plants-eia"));
  assert.equal(ids.has("tx-parcels"), false);
});
