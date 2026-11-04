# LandDraft 0.9.214

Release date: 2026-11-04

## Public data across parent and subproject maps

- A parent map now draws an identical public dataset only once, even when the same source is present in several selected subprojects.
- Stable catalog IDs are preferred for matching; otherwise LandDraft compares normalized service URLs without credential parameters.
- The parent-project copy wins when it is visible. If it is hidden and a selected subproject has a visible copy, the visible copy is retained.
- Public layers with different source filters remain separate so intentional views such as different hazard classes are not lost.
- Drawn, derived, image, and ordinary local-file layers remain independent project content and are never collapsed merely because their names match.

## Compatibility and data safety

- No database migration is required.
- The change affects only the composed display list. It does not delete duplicate layer records from any project or alter project snapshots.
- No project, map, feature, file, saved version, permission, or parent/child relationship is deleted or rewritten.

## Verification

- TypeScript: passed.
- GIS tests: 185 passed.
- Weather tests: 129 passed.
- Pipeline tests: 38 passed.
- Water tests: 20 passed.
- ESLint: zero errors; nine existing Fast Refresh warnings.
- Production build: passed.

## Rollback

The web application can be returned to `landdraft-v0.9.213` without a database rollback. Because duplicate suppression is display-only, rollback does not require project-state repair.
