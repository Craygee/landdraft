<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Public-data defaults

Public-data additions or removals requested directly by the user in this development
chat are changes to the shipped catalog for all new users. Update the catalog and
its regression tests, rather than storing those requests only in a developer's
account. Preserve existing useful sources unless their removal is requested.

In-app account library changes have account scope: saved service connections,
every-map connections, removed-source tombstones, failure-day settings and health
history must stay private to that account and sync through private cloud storage.
Account removal hides a source from the account repository without deleting
manually added project layers. Keep removed sources available in the Reconnect
section at the bottom of Public data. Do not promote an account-specific removal
or custom URL into the shipped defaults.

For shipped default removals, move the source metadata into `retiredCatalog` in
`src/lib/gis/catalog.ts` instead of discarding it. It stays absent by default for
new users and remains individually restorable from Reconnect.

## Recovery checkpoint location (2026-10-26)

Before rollback/recovery work, read
`C:/Users/JohnGrella/Documents/Codex/2026-10-26/referenced-chatgpt-conversation-this-is-an/outputs/LandDraft-Recovery-2026-10-26/READ-ME-FIRST.txt`
and the capture receipts there. This is an encrypted local setup checkpoint plus
fresh production database/schema and admin captures. It is NOT yet a proven
full-site restore; read the guide and latest cloud receipts for uploaded-file
status, configuration exclusions and restore-validation gaps. Never restore over
active work or production without explicit approval.
