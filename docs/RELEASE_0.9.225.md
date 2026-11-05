# LandDraft 0.9.225

## Data Groups readability

- Keeps the existing Data Groups panel width.
- Gives primary and nested layer names a full-width, two-line title area beneath the compact
  control row, while preserving selection, visibility, lock, style, label, drag and rename
  behavior.
- Existing hover titles remain available for exceptionally long names.

## West Virginia public data

- Adds the official statewide West Virginia parcel service maintained through county assessors,
  the WV Property Tax Division and the WV GIS Technical Center. The publisher identifies the
  current service as Tax Year 2023 and requires county-record verification.
- Adds official WVDEP oil-and-gas wells, simplified horizontal laterals, well-pad footprints and
  gas-pipeline construction/workspace areas.
- Adds **West Virginia energy & infrastructure** and **West Virginia site screening** templates.
  They reuse existing national EIA transmission, natural-gas pipeline, power-plant and
  peaker-candidate services rather than duplicating federal records.
- All high-density services remain viewport- and zoom-bounded. Pipeline construction is labeled
  as construction/permit context, not a complete operating pipeline inventory.

## Data safety and operating cost

- No project, map, layer, feature, note, attachment, saved version, account or share is deleted or
  replaced.
- No database migration, payment, plan, entitlement, permission or production-infrastructure
  change is required.
- The public government services require no LandDraft API credential or direct provider fee.
  Publisher availability, bandwidth, update schedules and rate limits remain external
  dependencies. Pricing remains undecided.

## Verification

- Live read-only service checks returned browser CORS access for `landdraft.net` and current record
  counts for parcels, wells, laterals, pads and pipeline-construction areas.
- 216 GIS tests pass.
- TypeScript validation, lint (zero errors; existing Fast Refresh warnings only) and the production
  build pass.

## Rollback

Restore the preceding `landdraft-v0.9.224` tag through a normal forward revert. Do not rewrite
published Git history.
