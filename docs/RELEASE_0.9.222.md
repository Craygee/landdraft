# LandDraft 0.9.222

## AI request repair

- Repairs the production AI quota functions so valid signed-in requests no longer fail with
  `The LandDraft AI quota check failed (404)`.
- Keeps the existing daily request and token limits, per-user isolation, and failed-request quota
  release behavior unchanged.
- Makes server-to-Supabase requests compatible with both current server-only `sb_secret_` keys and
  legacy service-role JWTs.
- Applies the same server-key compatibility to share-invitation rate limiting and the inactive
  parcel-cache worker so those backend paths do not repeat the key-migration fault.

## Root cause

The original quota migration schema-qualified PostgreSQL's `COALESCE` and `GREATEST` special
expressions. PostgreSQL accepted the function definitions but failed only when the functions ran.
The corrective migration replaces the two affected routines without changing their signatures,
tables, limits, or access grants.

## Data safety

- No project, map, layer, note, attachment, saved version, account, or AI conversation data is
  deleted or replaced.
- The migration only replaces two server-side quota function definitions.
- Existing AI usage rows and limits remain intact.
- The diagnostic one-token reservation was immediately released; the production quota table was
  left with no retained diagnostic usage.

## Dependencies and operating cost

- Uses the existing Supabase database, Edge Functions, and configured Groq provider.
- Adds no provider, paid service, subscription, entitlement, or billing change.
- Existing AI provider usage remains subject to its configured account limits and terms. Pricing
  remains undecided.

## Verification

- Production failure was reproduced directly against the quota RPC before the repair.
- New regression tests cover corrected SQL and both Supabase server-key formats.
- GIS tests, TypeScript validation, lint checks, and the production build pass.
- After deployment, production verification reserves and releases a minimal quota amount, then
  confirms an authenticated LandDraft AI request can progress beyond the quota check.

## Rollback

Application code can be restored from the preceding `landdraft-v0.9.221` tag without rewriting
history. The database repair is forward-safe; rolling it back would restore the known-broken quota
implementation and is not recommended.
