# LandDraft 0.9.221

Release date: 2026-11-05

## Terrain & Site Context 3D viewport

- Gives the Terrain 3D workspace and map region explicit dynamic-viewport dimensions so MapLibre
  uses all space below the header instead of falling back to a short canvas.
- Resizes the map when the container, window or mobile visual viewport changes, including browser
  chrome and orientation changes.
- Starts the control sheet collapsed on screens narrower than 768 pixels so the map remains the
  primary mobile surface. The existing **Controls** button opens it at any time.
- Keeps the existing zoom-11 starting view, 3D orbiting, terrain, imagery, wetlands and visible
  project/public-layer context.

## U.S. Electric Transmission Lines

- Uses the official EIA service's numeric `VOLTAGE` field for default attribute coloring instead of
  the publisher's broader `VOLT_CLASS` labels.
- Adds one centralized nationwide voltage palette and exact-value rules for the service's currently
  published voltage values. Values in the same engineering band always receive the same color.
- Keeps transmission lines dashed and uses a neutral fallback for missing, unknown or newly
  introduced values.
- These are shipped defaults for newly added public layers. Existing saved layers and intentional
  user style overrides are not rewritten.

## Dependencies, cost and data safety

- Uses the existing MapLibre workspace and existing public EIA FeatureServer; no new paid provider,
  credential, environment variable or operating cost is introduced.
- No database migration is required. No project, map, layer, feature, file, note, saved version,
  share, owner, membership, hierarchy or backup is deleted or rewritten.

## Verification

- Official EIA layer metadata verified `VOLTAGE` as `Voltage (Kilovolts)` and a numeric double.
- GIS tests: 206 passed.
- Weather tests: 129 passed.
- Pipeline tests: 38 passed.
- Water tests: 20 passed.
- Study Area Report tests: 7 passed.
- Total automated tests: 400 passed.
- TypeScript: passed.
- ESLint: passed with 0 errors and 9 existing Fast Refresh warnings.
- Production client, SSR and Cloudflare build: passed.

## Rollback

Rollback remains forward-only through the preserved `landdraft-v0.9.220` source and deployment
trees. No database or project-state rollback is required.
