# LandDraft 0.9.218

Release date: 2026-11-05

## Power and gas public data

- Adds the live EIA U.S. electric power-plant service as a shipped Energy layer.
- Adds a separate EIA technology-screened peaker-candidate layer for natural-gas and petroleum combustion-turbine/internal-combustion plants. It is explicitly labeled as a screening result rather than an official dispatch or market classification.
- Adds Texas natural-gas-fired power plants as a publisher-filtered view of the EIA service.
- Adds a live Texas natural-gas processing-plant layer from an independently hosted public ArcGIS copy credited to HIFLD. Its archive status, May 2024 republication and need for current RRC confirmation remain visible in the catalog.
- New power and gas points receive distinct default power/fuel icons and colors when first added.

## Account-service organization

- Private account-connected services now appear after the shipped ready-to-add catalog instead of above it.
- A **My account services** filter brings only those private connections forward.
- Search matches private services by their saved name or URL, while removed services remain excluded and reconnectable through the existing account controls.
- No account connection, removal, override, health history or every-map setting is promoted into shipped defaults.

## Dependencies and operating costs

- EIA and the public ArcGIS services require no LandDraft API key or new environment variable.
- Layers stream viewport-bounded features from publisher infrastructure, so there is currently no direct provider fee. Publisher availability, rate limits, data vintage, browser bandwidth and support remain operating dependencies.
- No billing, plan, payment, entitlement enforcement or administrator permission changes are included. Pricing remains undecided.

## Data safety

- No database migration or storage change is required.
- No project, map, layer, feature, file, note, version, account, share or backup is deleted or rewritten.

## Validation

- Live publisher queries returned 13,446 EIA power plants, 1,265 technology-screened peaker candidates, 301 Texas natural-gas power plants and 209 Texas gas-processing plant points at validation time.
- GIS regression tests, TypeScript, changed-file ESLint and the production build passed before release.

## Rollback

Rollback remains forward-only through the preserved `landdraft-v0.9.217` source and deployment trees. No database or project-state rollback is required.
