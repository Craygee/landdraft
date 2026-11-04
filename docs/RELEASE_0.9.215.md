# LandDraft 0.9.215

Release date: 2026-11-04

## Maintained topographic public data

- The failed **Topographic Index Contours — USGS** default is retired from the shipped catalog.
- New users receive **USGS Topographic Map — The National Map**, a maintained, attributed tile
  layer with contours, terrain, hydrography, land cover, roads, boundaries and place names.
- The new layer supports visibility, opacity, ordering, legends, printing, project persistence and
  parent/subproject display deduplication.
- Existing saved copies of the retired contour layer are preserved. Retirement does not delete or
  rewrite a project layer.

## Terrain & Site Context 3D

- Adds the optional `/terrain-3d` specialist workspace.
- Users can select the current view or draw a bounded area, choose Quick or Detailed analysis and
  orbit/tilt the resulting terrain from different perspectives.
- The surface can use USGS topographic coloring or attributed imagery and can include mapped
  wetlands plus visible project/public features.
- Numeric elevation summaries use bounded USGS 3DEP grids. Quick mode has a clearly labeled
  display-mesh estimate during a numeric-provider outage; Detailed mode never substitutes it.
- Results remain screening estimates rather than surveyed or engineering-certified terrain.

## Topography-dependent tools

- Pipeline profiles and the general elevation-profile tool continue to use current numeric USGS
  EPQS elevations through `/api/pipeline/elevation`.
- Buildable-area and Detailed 3D analyses use the USGS 3DEP numeric grid service.
- Visual topographic layers use the new USGS Topographic Map tiles. No calculation reads pixel
  colors or depends on the retired contour-feature connection.

## Compatibility and data safety

- No database migration, storage change, permission change, provider credential or environment
  variable is required.
- No project, map, feature, file, saved version, owner, membership, share, parent/child relationship
  or backup is deleted or rewritten.
- Payments, plans, pricing, entitlements, administrative permissions and core mapping access are
  unchanged. Pricing for the optional module remains undecided.

## Verification

- TypeScript: passed.
- GIS tests: 194 passed.
- Weather tests: 129 passed.
- Pipeline tests: 38 passed.
- Water tests: 20 passed.
- ESLint: zero errors; nine existing Fast Refresh warnings.
- Production client, SSR and Cloudflare build: passed.
- Read-only provider probes passed for USGS Topographic tiles, USGS EPQS, USGS 3DEP numeric grids,
  Terrarium elevation tiles and USFWS NWI metadata.

## Rollback

The web application can be returned forward-only to the preserved `landdraft-v0.9.214` source and
deployment trees. No database or project-state rollback is required.
