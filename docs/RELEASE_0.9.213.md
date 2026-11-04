# LandDraft 0.9.213

Release date: 2026-11-04

## Parent-project subproject display

- An open parent project now has a clear **Subprojects shown on this map** section in the File / Projects menu.
- Each direct or nested subproject can be shown or hidden independently on the parent map.
- Selected subprojects load automatically whenever that parent project is reopened.
- The selection is saved immediately even when project autosave is disabled.
- Quick Switch and Mobile Project Bar visibility remain separate settings.
- Loading a subproject as an overlay no longer changes which project is remembered as the last project opened.
- Hierarchy traversal is cycle-safe and ignores stale selections that no longer belong beneath the open parent.

## Compatibility and data safety

- No database migration is required.
- Existing `enabledSubprojectIds` project-state data remains compatible and is used as the source of truth.
- No project, map, layer, file, saved version, permission, or parent/child relationship is deleted or rewritten by the release.

## Verification

- TypeScript: passed.
- GIS tests: 181 passed.
- Weather tests: 129 passed.
- Pipeline tests: 38 passed.
- Water tests: 20 passed.
- ESLint: zero errors; nine existing Fast Refresh warnings.
- Production build: passed.

## Rollback

The web application can be returned to `landdraft-v0.9.212` without a database rollback. Parent-project selections created in 0.9.213 remain ordinary project snapshot data and are backward-compatible with 0.9.212.
