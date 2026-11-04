# LandDraft 0.9.216

Release date: 2026-11-04

## Terrain 3D map visibility

- Terrain & Site Context 3D now opens at zoom level 11 around the active project location.
- A visible **Zoom 11** control restores the intended working camera without changing project data.
- OpenStreetMap is rendered beneath the selected USGS topographic or imagery surface so a usable
  reference map remains visible if an optional surface tile is temporarily unavailable.
- The MapLibre canvas now resizes with the workspace and again after loading, preventing a
  zero-size or stale-size map after responsive layout changes.
- Provider degradation and WebGL initialization failures are shown explicitly instead of leaving
  an unexplained blank map.

## Compatibility and data safety

- Quick analysis remains limited to 100 km² and Detailed analysis to 4 km². Zoom level 11 is the
  starting camera view, not permission to issue an unbounded terrain request.
- No database migration, storage change, permission change, provider credential or environment
  variable is required.
- No project, map, feature, file, saved version, owner, membership, share, parent/child relationship
  or backup is deleted, replaced or rewritten.
- Payments, plans, pricing, entitlements and administrative permissions are unchanged.

## Verification

- Terrain 3D regression tests: 6 passed.
- TypeScript: passed.
- Changed-file ESLint: passed with zero errors or warnings.
- Production client, SSR and Cloudflare build: passed.

## Rollback

The web application can be returned forward-only to the preserved `landdraft-v0.9.215` source and
deployment trees. No database or project-state rollback is required.
