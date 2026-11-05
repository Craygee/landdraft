# LandDraft 0.9.224

## Study Area Report analysis

- Runs an asynchronous boundary-specific refresh for active live feature services before building
  the report. Progress is shown in the workspace and provider failures or 5,000-feature screening
  limits remain visible instead of being treated as no findings.
- Spatially intersects vector evidence with the selected boundary, clips and unions polygon
  coverage, counts point/line/polygon evidence and summarizes leading source attributes.
- Adds a traceable evidence table to each applicable report section.
- Uses only section-specific, intersecting evidence in report maps. Off-site features are removed,
  polygons/lines/points draw in a controlled order, figures are clipped to the study boundary and
  dense maps use a bounded feature budget.
- Supports compatible WMS context in report figures, including the official Annual NLCD land-cover
  map for the exact study extent.

## Public data

- Adds verified official connections for USGS/MRLC Annual NLCD Land Cover (2025), USDA-NRCS
  national SSURGO soil map units and FEMA National Risk Index census tracts.
- Adds a shipped **Study area report — national screening** template that brings in land cover,
  topography, soils, hydrography, wetlands, flood hazards, environmental facilities, roads,
  transmission, power plants and natural-hazard context without duplicating existing project
  sources.
- No credentials or paid providers are required. Source limitations, attribution and coverage
  cautions remain in the catalog and report.

## Responsive workspace

- The configuration panel switches to side-by-side layout only at wide desktop widths, keeps
  controls within the available width and lets long action labels wrap.
- Cover inputs, logo controls, boundary selection, report-data action and Run/Re-run action now fit
  narrow desktop, tablet and mobile layouts without horizontal overflow.

## Data safety

- No project, map, layer, feature, note, attachment, saved version, account or share is deleted or
  replaced.
- The report schema remains version 1; all new analysis fields are optional and existing saved
  reports remain compatible.
- No database migration, payment, plan, entitlement, permission or infrastructure change is
  required.

## Dependencies and operating cost

- Uses existing `@turf/turf`, ArcGIS/GeoJSON loading, MapLibre WMS rendering, project storage and
  browser print/PDF capabilities.
- The new government services are public and add no direct provider fee, though provider rate
  limits and availability apply. Pricing remains undecided.

## Verification

- 214 GIS tests, 129 Weather tests, 38 Pipeline tests, 20 Water tests and 8 Study Report tests pass.
- TypeScript validation, lint (zero errors; existing Fast Refresh warnings only) and the production
  build pass.
- Small live read-only requests verified the current USGS WMS, NRCS SSURGO and FEMA NRI endpoints;
  NRCS and FEMA return browser CORS permissions compatible with `landdraft.net`.

## Rollback

Restore the preceding `landdraft-v0.9.223` tag through a normal forward revert. Do not rewrite
published Git history.
