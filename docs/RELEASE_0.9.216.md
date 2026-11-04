# LandDraft 0.9.216

Status: Release candidate; not published

## Secure sharing

- Map owners can independently allow or deny recipient printing/PDF creation and GIS layer exports.
- When note sharing is enabled, owners choose individual project notes, layer notes, the project
  summary, and legacy layer notes. Select all and Clear controls support larger projects.
- Selected map-note markers follow their associated note. Unselected note text and markers are
  removed before the protected share snapshot is uploaded.
- Existing links retain their prior behavior until an owner changes their sharing options. New
  shares require explicit note selection.
- Personalized recipient layer scopes continue to receive only the selected notes applicable to
  that recipient's shared layers.
- Invitation email descriptions now reflect the tools actually enabled for the shared map.

## Compatibility and operations

- No database migration, storage-policy change, billing change, or user-data rewrite is required.
- The existing `map_view.sharePermissions` JSON object stores the additional controls.
- Publishing this release requires deploying the updated `share-invite` Edge Function together
  with the application release.

## Verification

- TypeScript: pass
- GIS tests: 195 pass
- ESLint: 0 errors; 9 existing Fast Refresh warnings
- Production client, SSR, and Cloudflare build: pass
