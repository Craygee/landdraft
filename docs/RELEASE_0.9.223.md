# LandDraft 0.9.223

## Project print compositions

- Keeps the complete Print Map composition scoped to its project, including page preferences,
  titles, legend names, layer choices, map furniture, annotations, callouts and saved map view.
- Rehydrates the selected project's composition when project context changes and cancels delayed
  saves from the previously active project, preventing one project's print setup from leaking into
  another.
- Adds a clearly project-scoped reset action. Resetting one project does not change any other
  project's print composition.

## Callouts

- Ordinary callouts support multiple lines and remain in placement mode so several callouts can be
  added in one pass.
- Adds Feature callout mode. Click a visible vector feature, choose which of its available attribute
  fields should appear, and LandDraft draws an arrow to the clicked feature location.
- Feature callouts store a printable attribute snapshot with the project composition so the printed
  result remains reproducible even if a remote source later changes.

## Data safety

- No project, map, layer, feature, note, attachment, saved version, account or share is deleted or
  replaced.
- Existing print compositions remain compatible. The feature metadata is optional and only added to
  newly created feature callouts.
- No database migration or new provider credential is required.

## Dependencies and operating cost

- Uses the existing LandDraft map renderer, project storage and Print Map PDF pipeline.
- Adds no paid provider, external service, subscription, entitlement or billing change. Pricing
  remains undecided.

## Verification

- New regression coverage validates safe attribute filtering, useful default field selection and
  multiline feature-callout formatting.
- 212 GIS tests, 129 Weather tests, 38 Pipeline tests, 20 Water tests and 7 Study Report tests pass.
- TypeScript validation, lint (zero errors; existing Fast Refresh warnings only) and the production
  build pass.

## Rollback

Restore the preceding `landdraft-v0.9.222` tag through a normal forward revert. Do not rewrite
published Git history.
