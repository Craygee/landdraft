# LandDraft 0.9.217

Release date: 2026-11-04

## Study Area Report foundation

- Adds an optional `/study-report` workspace for generating a repeatable study-area report from an
  existing polygon layer, saved project area or current map view.
- Adds a user-defined cover title, subtitle, company and image logo; section visibility, ordering,
  titles and narratives remain editable.
- Generates source-attributed overview, land-cover, terrain, hydrology, soils, suitability,
  environmental, infrastructure, energy, hazard, project-record and data-gap sections from loaded
  project/public evidence.
- Embeds deterministic map figures, saved elevation profiles and saved buildable-area results when
  those artifacts exist. Missing vital evidence remains an explicit **Insufficient Data** section.
- Re-running refreshes generated evidence while preserving user-authored narrative. Existing
  project version history supplies forward recovery without adding a database table.
- Browser print provides the initial review/PDF workflow. Provider-backed automatic acquisition,
  server-rendered reports and optional grounded AI narrative remain later phases.

## Terrain 3D map repair

- The Terrain & Site Context 3D workspace now loads OpenStreetMap and the selected reference
  surface before attaching the optional elevation mesh.
- Terrarium DEM, 3D terrain and hillshade are progressive enhancements. Their failure can no longer
  prevent the ordinary map from drawing.
- Topographic and imagery surface switching no longer replaces the entire MapLibre style, avoiding
  a second startup load that could race the first render.
- The map container retains a responsive minimum height and continues to open at zoom 11.

## Access, data and costs

- Study Area Report includes independent `studyReport.*` capability hooks but remains
  nonrestrictive by default. No billing, plan, payment or administrator changes are included.
- The foundation analyzes loaded project and public data locally and adds no paid provider.
  Future provider-backed acquisition, server PDF rendering, commercial imagery or AI can add
  licensing, request, storage and compute costs; pricing remains undecided.
- No database migration, storage change, provider credential or environment variable is required.
- No project, layer, feature, file, note, saved version, owner, membership, share, hierarchy or
  backup is deleted or rewritten.

## Verification

- GIS tests: 196 passed.
- Weather tests: 129 passed.
- Pipeline tests: 38 passed.
- Water tests: 20 passed.
- Study Area Report tests: 7 passed.
- TypeScript: passed.
- Changed-file ESLint: passed.
- A disposable Chrome/WebGL smoke page rendered the topographic reference and 3D terrain at zoom
  11; the temporary fixture and browser profile were removed after verification.
- Production client, SSR and Cloudflare build: passed.

## Rollback

Rollback remains forward-only through the preserved `landdraft-v0.9.216` source and deployment
trees. No database or project-state rollback is required.
