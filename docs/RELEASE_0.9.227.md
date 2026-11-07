# LandDraft 0.9.227

## Study Area Report

- Turns the report into a source-backed screening study: it queries each active source for the
  study boundary plus a listed search distance, separates on-site from nearby features, and reports
  coverage by source and class without adding sources together.
- Measures terrain from the numeric USGS 3DEP grid and land cover from a labeled NLCD point sample.
  Both are labeled as derived estimates.
- Reports a failed or incomplete source as not evaluated, never as no findings. An empty query is
  stated as the query result, not proof of absence.
- The report does not infer buildability, legal access, easement widths, environmental clearance,
  water rights, well yield, utility capacity or connection rights from mapped proximity.
- Prints every page. The app's fixed window layout previously cut printing off after page one.

## Public data

- Adds 55 verified catalog connections (16 national, 17 Texas, 22 West Virginia), the Texas and West
  Virginia land study templates, and an expanded national screening template. Endpoints and known
  gaps are listed in `docs/STUDY_REPORT_SOURCES.md`.
- Connection checks now send map-image sources a real map area, so working sources no longer show as
  failed.

## Sharing

- Requires migration `202611060001_fix_personalized_share_access.sql`, listed below.
- People can open personalized shares, which the function protecting those snapshots was wrongly
  denying to everyone.
- Pending invitations match the account's confirmed email rather than the login token.
- A recipient limited to a personalized copy cannot open the full shared version.
- Creating a share no longer reports failure when the browser blocks copying the link.

## Data safety and operating cost

- One additive database change: `202611060001` adds one function and replaces one function and one
  read policy. It deletes no rows, columns or files. Apply it before publishing this release. By
  code review 0.9.226 is compatible with it; that pairing was not separately tested.
- No storage-layout, payment, plan, entitlement or production-infrastructure change. Edge Functions
  are unchanged.
- New sources need no LandDraft credential or direct provider fee. Publisher availability, update
  timing and rate limits remain external dependencies.

## Verification

- 221 GIS, 129 Weather, 38 Pipeline, 20 Water and 29 Study Report tests pass, plus an isolated
  database test of share access.
- TypeScript validation and lint (zero errors) pass.
- Exercised signed in on the test site against the test database: report, saving, reloading, adding
  public data, creating a share, and printing a 38-page PDF.
- Not exercised: opening a personalized share as a recipient through the app.

## Known limits

- Flowline and lake layers can time out on the map when dozens of layers load at once. The report
  still gets their results.
- USGS 3DEP Hillshade and Slope, Local Access Roads and Driller's Well Reports can show as failed in
  connection checks when those services are slow.

## Rollback

Publish a forward revert of this release to `f5a41f8` (0.9.226). Do not force-push. Leave the
database change in place, because reversing it would bring back the personalized share defect.
