# LandDraft 0.9.212

Release date: 2026-11-04

## Shared maps and collaboration

- The universal share starts from the owner's currently visible layers, as before.
- A map administrator can give an individual recipient a personalized layer selection or return
  that person to the universal selection. Personalized snapshots remain private to that recipient.
- Recipient layer visibility and opacity are local display choices and survive automatic shared-map
  refreshes while the share is open.
- The owner can start recipients at the largest visible shared layer, the current map view, or one
  selected shared layer.
- Existing administrator access is presented as **Live collaborator**. Collaborators edit the
  original project and saved changes are picked up by other open clients. This is direct shared
  editing, not conflict-free simultaneous editing; collaborators should not edit the same feature
  at the same time.
- Viewer and editor-copy permissions remain unchanged. Export, notes, and opacity controls remain
  independently configurable.

Database dependency: apply
`supabase/migrations/202611040001_share_member_layer_scopes.sql` before publishing the web client.
The migration is additive: it adds two nullable member fields, a guarded administrator RPC, and
member-specific storage-read enforcement. It does not rewrite project snapshots or user data.

## Elevation profiles

- **Quick average** is the default and requests at most 64 terrain samples for a fast general
  profile.
- **Detailed** mode supports a user-selected point density per kilometre or mile, subject to the
  existing 384-sample and 100 km safety limits.
- Missing terrain can be connected by a clearly identified estimate or left as observed gaps.
- CSV/GeoJSON exports identify each sample as observed or interpolated. Missing source values are
  never converted to zero.

## Public data catalog

- National current Census county, incorporated-place, primary-road, and local-road services were
  added with viewport and zoom limits.
- U.S. transmission and natural-gas pipeline services are available regardless of selected state.
  Transmission defaults to dashed voltage-class colors; natural-gas lines default to type colors.
- Wind turbines and Texas substations use their matching LandDraft symbols by default.
- Official statewide parcel services were added for Florida, Connecticut, and Ohio alongside the
  existing Texas parcel system. Selected state filters can be combined and nationwide layers remain
  available.
- Future `data.state.<code>` metadata is present for region-specific catalog entries but no
  entitlement, plan, price, or paywall is enabled.
- The requested Texas COOP and IOU layers are shipped as source references only. Their publisher
  metadata identifies Platts as the original source and does not establish unrestricted commercial
  redistribution rights. They must not be silently enabled as live commercial defaults.

See `docs/PUBLIC_DATA_STATE_COVERAGE_2026-11-04.md` for provenance, limits, and the next-state
review process.

## Verification

- TypeScript: passed.
- GIS tests: 179 passed.
- Weather tests: 129 passed.
- Pipeline tests: 38 passed.
- Water tests: 20 passed.
- Full migration replay: 708 database grant, RLS, and RPC assertions passed with both explicit and
  legacy automatic-grant baselines.
- ESLint: zero errors; nine pre-existing Fast Refresh warnings.
- Production build: passed.
- Authenticated multi-user desktop/mobile browser verification remains an operational smoke check
  after the additive migration and deployment because the local QA origin does not share production
  authentication cookies.

## Rollback

The web application can be returned to the prior deployment commit without removing the two nullable
columns. Leaving those columns and the RPC installed is backward-compatible with 0.9.211. Do not
delete personalized snapshot objects or alter project/user rows as part of a web rollback.
