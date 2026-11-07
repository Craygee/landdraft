# LandDraft 0.9.230

## Line labels

- Labels on lines such as pipelines now show more reliably. Touching segments that carry the same
  label are joined before labelling, so a label fits on a line that the source splits into many
  short pieces.
- New label position "In the line (line breaks under label)". The label sits centered on the line,
  rotates with it and stays upright, and the line is cut away under the text with no fill behind
  it. Labels are placed on the straighter stretches and refreshed after each pan or zoom.

## Texas parcels from further out

- Texas parcels now show from zoom 8. Between zoom 8 and 10 the map shows parcels of 80 acres and
  larger, between 10 and 12 parcels of 5 acres and larger, both with simplified outlines. Full
  parcel detail is unchanged from zoom 12.
- If a zoomed-out view still holds too many parcels, the largest are kept.
- Parcel labels shrink further when zoomed out, down to a third of their size (4 px at the smallest), so more parcels
  keep a label. Existing parcel layers move to the new zoom settings once.

## Data safety and operating cost

- App code only. No database, migration, Edge Function or Worker secret change.
- The overview files (`overview-0080.fgb`, 216 MB, and `overview-0005.fgb`, 809 MB) were published
  earlier on 2026-11-07 into the existing public parcel bucket next to the current parcel version,
  and the parcel Worker was updated to serve them. Earlier app versions ignore them.

## Verification

- GIS tests, TypeScript validation, lint and the parcel pipeline tests pass; PR #7 checks are green.
- Measured through the app's loader against the published files: West Texas at zoom 8.5 in 4.0 s,
  Hill Country at zoom 9.2 in 1.5 s, Austin at zoom 10.5 in 1.2 s and at zoom 11.5 in 0.9 s.
- Rendered on the test site: in-line labels cut the line and stay upright with the map rotated.

## Rollback

Publish a forward revert of this release to 0.9.229. The overview files can stay; to remove them
from use, republish the previous parcel `current.json` without the `overview` field.
