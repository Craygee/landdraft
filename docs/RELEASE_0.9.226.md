# LandDraft 0.9.226

## West Virginia natural-gas pipelines

- Adds the official WVDOT **West Virginia Natural Gas Pipelines** statewide reference service to
  the shipped public-data catalog.
- Includes publisher-provided company code, pipe diameter and mapped-location tolerance attributes
  where populated, with LandDraft's consistent dashed natural-gas styling.
- Updates the West Virginia energy template to use the more detailed WVDOT reference instead of
  simultaneously loading the generalized national EIA gas layer. The EIA layer remains available
  separately in Public data.
- Clearly identifies the WVDOT geometry as planning/screening information because the service does
  not advertise its source vintage or survey/as-built accuracy. Users are directed to NPMS,
  operator records and 811 for current verification.

## Account-wide public layers can be removed

- Fixes account services marked **Automatically include on every editable map** being immediately
  re-created after the user deleted their layer.
- Deleting one of these managed layers now confirms the account-wide scope, turns off automatic
  inclusion and removes the layer from the current project.
- Managed copies are removed as other editable projects open. The service remains in **My account
  services** so it can be added manually or re-enabled later.
- The behavior applies to normal layers, nested layers and multi-layer deletion. If account sync is
  not ready, LandDraft waits instead of pretending the account-wide setting was saved.

## Data safety and operating cost

- No project, feature, note, attachment, saved version, account, share or source definition is
  deleted by the release itself. Layer removal still requires a deliberate user action and a
  confirmation when it changes an account-wide automatic setting.
- No database migration, storage-layout change, payment, plan, entitlement, permission or
  production-infrastructure change is required.
- The WVDOT public service requires no LandDraft credential or direct provider fee. Publisher
  availability, bandwidth, update timing and rate limits remain external dependencies. Pricing
  remains undecided.

## Verification

- 217 GIS tests pass, including a regression test for disabling only the selected every-map account
  services without mutating the original account state.
- 129 Weather, 38 Pipeline, 20 Water and 8 Study Report tests also pass.
- TypeScript validation, lint (zero errors; existing Fast Refresh warnings only) and the production
  build pass.

## Rollback

Restore the preceding `landdraft-v0.9.225` tag through a normal forward revert. Do not rewrite
published Git history.
