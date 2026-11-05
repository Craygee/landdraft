# LandDraft 0.9.219 — Public data project templates

## Outcome

LandDraft now offers optional public-data templates when creating a project and inside the Public
Data library. New projects continue to default to **No template**, so existing creation behavior is
unchanged unless the user deliberately selects one.

## Capabilities

- Create a project with one of four prepared layer sets:
  - Texas energy & infrastructure
  - Texas site screening
  - National energy development
  - Water, terrain & environment
- Apply the same templates to an existing editable project from the Public Data library.
- Add referenced catalog layers to the normal Public Data group and turn them on immediately.
- Preserve an existing matching catalog layer—including its filters and configuration—instead of
  adding a duplicate; a hidden match is made visible.
- Add any state coverage required by the selected template without removing the project's current
  state selections.
- Filter Public Data results with **Hide source-only entries**. These are informational catalog
  records that open a publisher source page rather than adding a connected layer.

## Dependencies and operating cost

Templates reuse LandDraft's existing catalog, renderer, project storage, remote-layer loader and
provider attribution. No new database table, secret, account-wide setting, billing rule or paid
provider was introduced. Provider traffic follows the same viewport and zoom controls as adding the
same catalog layers individually, so this release adds no separate fixed operating cost.

## Safety and compatibility

- No project, map, layer, note, file, saved version or account setting is deleted or rewritten.
- Existing projects remain compatible and are not assigned a template retroactively.
- Applying a template is additive and reversible through the ordinary layer controls.
- The release does not change project permissions, production database schema, storage layout,
  payments, entitlements, administrative permissions or backups.

## Validation

- Public-data template regression tests cover the blank default, catalog integrity, visible-layer
  creation, duplicate avoidance, hidden-layer restoration, configured-layer preservation and the
  source-only filter rule.
- Full GIS, Weather, Pipeline, Water and Study Report suites pass.
- TypeScript and production builds pass.
- ESLint reports no errors; the existing Fast Refresh warnings remain unchanged.
