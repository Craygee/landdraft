# Terrain & Site Context 3D

Status: Production release 0.9.217

Owner branch: `codex/topography-3d-module-2026-11-04`

Core mapping impact: Adds raster public-layer support without restricting or replacing core mapping

Pricing: Undecided

## Capabilities

- Replaces the retired dense contour-feature default with the maintained USGS Topographic Map tile
  service for visual topographic reference.
- Adds an optional `/terrain-3d` workspace where a user can select the current view or draw a
  bounded rectangular study area.
- Opens the specialist map at zoom level 11 around the active project location and provides a
  one-click camera reset to that working zoom.
- Provides Quick analysis up to 100 km² and Detailed analysis up to 4 km².
- Renders an interactive orbitable terrain mesh with USGS topographic or attributed imagery
  coloring, mapped wetlands and visible project/public features.
- Initializes OpenStreetMap and the selected reference surface independently, then progressively
  attaches the optional DEM, 3D terrain and hillshade. A DEM/WebGL terrain failure therefore
  degrades to a usable reference map instead of a blank canvas.
- Resizes the MapLibre canvas with its workspace and enforces a minimum map height for responsive
  layouts.
- Reports bounded numeric elevation summaries from USGS 3DEP. During a numeric-service outage,
  Quick mode may use a clearly labeled approximate display-mesh sample; Detailed mode never
  substitutes that lower-assurance result.
- Preserves existing project copies of the retired contour layer. It does not rewrite, delete or
  silently replace saved project data.

This release is preliminary visualization and screening. It is not a survey, wetland
determination, grading plan, drainage analysis, geotechnical study or engineering certification.

## Dependencies

- Existing React, MapLibre, LandDraft project store, map-layer renderer, print composer and remote
  ArcGIS query client.
- USGS Topographic Map cached tiles for the shipped public reference layer and 3D surface coloring.
- Existing server-side `/api/analysis/buildable-terrain` proxy and USGS 3DEP dynamic elevation
  service for numeric grids.
- Mapzen-format Terrarium elevation tiles on AWS Open Data for the browser display mesh.
- USFWS National Wetlands Inventory for optional study-area context.
- Esri World Imagery for an optional attributed visual surface.
- No new package, environment variable, provider credential, database table, function, policy,
  storage bucket or migration.

## Potential operating costs

- The currently configured USGS, USFWS and public Terrarium services require no LandDraft API key;
  provider availability, rate limits, bandwidth and terms remain external dependencies.
- Esri imagery usage must retain provider attribution and remain within applicable service terms.
  High-volume, offline or guaranteed-service use could require licensed imagery or hosted caching.
- Detailed terrain grids and wetland queries are bounded to control upstream load, transfer volume
  and browser memory.
- Future saved 3D studies, high-resolution terrain, model exports or organization-specific imagery
  could add object-storage, egress and compute costs. Product pricing remains undecided.

## Administration/billing coordination

- Shared frontend additions are the raster `LayerSource`, map/print/legend rendering support, the
  public catalog entry, specialist-module link and route.
- The module remains open under the current core mapping access contract. It adds no paywall,
  entitlement enforcement, payment, plan, grant, quota or administrator permission.
- The previously reviewed administration contract defines free core mapping and does not enforce
  GIS-module access. This release preserves that contract and requires no portal or schema change.
- A future paid `terrain.3d` capability would require a separate coordinated administration and
  billing release; this release does not make that decision.

## Security and privacy

- Study bounds and analysis results are session state in this increment. No new cloud record or
  location-history collection is added.
- Existing private project layers remain under the normal authenticated project store and are used
  only as read-only display context in the 3D workspace.
- External requests are bounded by area, cell count, feature count and timeouts. Provider failures
  remain visible and are never converted into invented terrain or a claim that wetlands are absent.
- Existing project records, ownership, sharing, restore history, storage objects and backups are
  unchanged.

## Test plan

- Validate catalog retirement and new-source availability for existing and new accounts.
- Validate raster opacity, ordering, legend, print rendering and parent/subproject deduplication.
- Validate Quick and Detailed area limits, numeric summaries, missing-data behavior and labeled
  display-mesh fallback.
- Validate desktop and responsive control layouts and touch/mouse terrain navigation.
- Exercise USGS topographic, 3DEP, Terrarium and NWI provider health and degraded states.
- Run TypeScript, ESLint, production build and GIS, Weather, Pipeline and Water suites.

Release verification on 2026-11-04:

- TypeScript: passed.
- ESLint: zero errors; nine existing Fast Refresh warnings.
- Production client, SSR and Cloudflare build: passed.
- GIS: 196 passed; Weather: 129 passed; Pipeline: 38 passed; Water: 20 passed; Study Report: 7
  passed.
- A disposable headless Chrome/WebGL smoke page rendered the USGS topographic surface and the 3D
  terrain mesh at zoom 11 before release; the fixture and browser profile were removed afterward.
- Live read-only probes: USGS Topographic tile, USGS EPQS point, USGS 3DEP metadata/grid,
  Terrarium tile and NWI service responded successfully.

## Release notes

- User-visible: maintained USGS topographic public layer and optional Terrain & Site Context 3D
  workspace.
- Existing saved copies of the retired contour source remain intact; new users receive the new
  maintained source instead.
- No setup, credential, database, billing, entitlement, production-infrastructure or backup change
  is required.
- Rollback is application-only through the preserved `landdraft-v0.9.215` release; no database or
  project-state rollback is required.
