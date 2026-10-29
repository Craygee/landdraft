# LandDraft recovery and project history

Last updated: 2026-08-24 (America/Chicago)

This document is the handoff and recovery map for LandDraft. It records the authoritative source,
deployment and data connections, major product decisions, recovery points, and the outstanding work
requested after the backup. It deliberately contains no passwords, private keys, service-role keys,
OAuth secrets, session tokens, or signing files.

## Current verified recovery point

The immutable tag `landdraft-pre-ai-symbology-20260824` identifies the last published release before
the categorized-symbology and GIS-assistant upgrade.

| Copy                        | Repository                                          | Commit at tag                              |
| --------------------------- | --------------------------------------------------- | ------------------------------------------ |
| Primary source              | `https://github.com/Craygee/landdraft.git`            | `d2a04276a3526ff429c72661fb7c3176e6eaee59` |
| Connected deployment source | `https://github.com/Craygee/landdraft-deployment.git` | `062a00d9db5426a1feacb42ebbdbfdb3ae415f0a` |

Both tags were pushed to GitHub. Published Git history must remain forward-only: do not force push,
rebase, amend, or squash commits already synchronized to the deployment service.

### Verified local backup artifacts

These files are intentionally kept outside Git tracking under
`.local-backups/LandDraft-20260824-pre-ai-symbology/` so repository history does not recursively
contain copies of itself.

| Artifact                                |   Bytes | SHA-256                                                            |
| --------------------------------------- | ------: | ------------------------------------------------------------------ |
| `terrasketch-gis-complete.bundle`       | 438,967 | `C8137FDAC3ABABDF53E99BD0C761D6D917E2FBC8B24D17CEB99845410103589D` |
| `terrasketch-gis-source-d2a0427.zip`    | 299,614 | `04186EEA781A777C1123BE67475BB207FB51AB18B1A491686313D0738AE41C77` |
| `terra-sketch-buddy-complete.bundle`    | 396,620 | `F98AC024A676499F10BC4EADF2367B803879E7FD29A8AC7460A757F9454AA9D7` |
| `terra-sketch-buddy-source-062a00d.zip` | 299,614 | `7DDA284523160A5E26DBD9215B7625D7156A85654BE566C11D13CA29A3A557B4` |

Both Git bundles passed `git bundle verify` and record complete repository history. Both source ZIPs
opened successfully and contain 136 tracked entries.

## Restore instructions

Restore the primary repository from its bundle:

```sh
git clone terrasketch-gis-complete.bundle landdraft-restored
cd landdraft-restored
git switch codex/terrasketch-gis
```

Restore the deployment-sync repository:

```sh
git clone terra-sketch-buddy-complete.bundle landdraft-deployment-restored
```

To restore from GitHub instead, clone either repository and check out the recovery tag:

```sh
git checkout landdraft-pre-ai-symbology-20260824
```

Install from the committed package manifest and build before deployment. The verified baseline used
TypeScript 5.8, React 19, Vite 8, MapLibre GL 6, Turf 7, TanStack Start, and Supabase REST/Auth.

## Authoritative connections

### Application and hosting

- Product name: LandDraft.
- Production URL: `https://landdraft.net/`.
- Hosted URL: `https://landdraft.lovable.app/`.
- Preview URL: `https://id-preview--1ae14b2c-6113-4015-a13c-83a43a8622a1.lovable.app/`.
- Deployment project ID: `1ae14b2c-6113-4015-a13c-83a43a8622a1`.
- Deployment project slug: `landdraft`.
- GitHub is authoritative. Code is edited, checked, committed, and pushed in the repositories. The
  deployment service is used only for GitHub sync, preview, and deployment; do not use its AI agent
  to implement or repair the application.

### Cloud accounts and project data

- Supabase project reference: `txgbeskieqvvptgtjyou`.
- Supabase base URL: `https://txgbeskieqvvptgtjyou.supabase.co`.
- The authenticated `gis-assistant` Edge Function is the only hosted-AI integration point. It uses
  an explicit provider switch, defaults to Groq's free GPT-OSS service, has no automatic paid
  fallback, and keeps every provider key in Supabase server secrets.
- OAuth callback: `https://txgbeskieqvvptgtjyou.supabase.co/auth/v1/callback`.
- Browser environment keys: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Only the publishable browser key is present in the repository environment. Authorization is
  enforced by authenticated JWTs and row-level security.
- Google login is supported and configured through Supabase/Google OAuth. Apple login is supported
  by the application but appears only when the Apple provider is fully configured and enabled.
- Never commit a database password, Supabase service-role key, Google client secret, Apple `.p8`
  key, Apple client secret, or access token.

Database definition and security are versioned in:

1. `supabase/migrations/202608220001_cloud_workspace.sql`
2. `supabase/migrations/202608230001_secure_project_creation.sql`
3. `supabase/migrations/202608230002_project_hierarchy.sql`
4. `supabase/migrations/202608260001_secure_map_sharing.sql`
5. `supabase/migrations/202609040001_project_email_intake.sql`
6. `supabase/migrations/202609050001_ai_usage_quota.sql`

The schema provides private projects, memberships, compressed content-addressed snapshot paths,
25-entry restore history, project hierarchy, guarded project creation, RLS, and private project
assets. Large map state is stored as compressed snapshots rather than expanded database rows.

### Cloud-data backup limitation

This recovery pass preserved the complete schema, migrations, application connection map, and both
Git histories. It did **not** export raw production authentication users, storage objects, or project
rows because the workspace correctly does not contain a database password or service-role secret,
and a publishable browser key cannot bypass RLS. Use the Supabase Dashboard backup/export controls
or an authorized `pg_dump` connection to create an off-platform data dump. Store that dump in an
encrypted location, never in Git. Free-plan retention should not be treated as the only backup.

## Product history from this collaboration

The product began as a browser GIS workbench and was progressively expanded through the following
decisions and releases:

1. Built the full-screen MapLibre workbench, grouped layers, file imports, drawing, measurement,
   coordinate display, public-data catalog, attribute table, styling, labels, and GIS exports.
2. Added cloud collaboration foundations and initial spatial-analysis concepts.
3. Repaired pipeline connectors, layer visibility, map lifecycle, overlay ordering, and hosted map
   worker behavior; replaced a retired pipeline endpoint.
4. Removed comparative third-party product copy and adopted neutral LandDraft terminology. Do not
   add named product comparisons back to user-facing copy or project documentation.
5. Added the mobile field interface, Texas data catalog, paper formats, parcel streaming,
   viewport-only loading, feature selection, active-layer preference, and dense-layer performance
   safeguards.
6. Added draggable groups/subgroups, group styling, stroke/fill patterns, transparent parcel fills,
   label controls, working-layer routing, and simplified advanced menus.
7. Rebranded the application to LandDraft and created the current mark.
8. Added secure cross-device accounts, Google/Apple provider support, autosave, 25 restore points,
   projects, subprojects, duplication, overlays, sharing foundations, and secure creation policies.
9. Added the GIS assistant UI, nested public-data workflows, print composer, independent legend
   controls, map furniture, smart callouts, decimal/DMS labels, draggable print annotations, and PDF
   output.
10. Added map pan/zoom locks, feature destination prompts, vertex editing, multi-selection repair,
    more reliable line/point/polygon editing, and AI response rendering fixes.
11. Added the current spatial-analysis panel (buffer, centroid, merge, intersection, difference,
    convex hull), versioned first-run/advanced/print walkthroughs, mobile help, and corrected print
    frame defaults/reset behavior.

The commit log is the exact technical record. Important recent primary commits are:

- `52f9030` — Rebrand GIS workbench as LandDraft
- `56d99ab` — Add secure cross-device cloud workspaces
- `346d2e6` — Configure production authentication
- `79d79c3` — Add GIS assistant and nested data workflows
- `541e850` — Add print composer and project hierarchy
- `86a6825` / `15250ad` — Add and repair vertex editing
- `c23d2e6` — Improve multi-selection controls and AI responses
- `d2a0427` — Add spatial analysis and guided tours

## Current architecture notes

- `src/lib/gis/store.tsx` is the central project/layer/selection state and persistence API.
- `src/lib/gis/mapRef.tsx` coordinates map UI panels, editing, pending feature destinations, and the
  live MapLibre instance.
- `src/components/gis/MapCanvas.tsx` owns rendering, map interaction, feature hit-testing, selection,
  drawing, locks, and vertex editing.
- `src/lib/gis/mapStyle.ts` builds MapLibre source/layer specifications and ordering.
- `src/components/gis/LayerPanel.tsx` owns group/layer organization, style entry points, file import,
  labels, ordering, and layer actions.
- `src/components/gis/AiAssistant.tsx` currently supplies deterministic local GIS help/actions. Its
  behavior must be upgraded rather than represented as a general remote language model unless a
  secure server-side model connection is actually configured.
- `src/components/gis/PrintComposer.tsx` persists a print-only composition independently of the
  project map.
- `src/components/gis/TourProvider.tsx` and `src/lib/gis/tours.ts` provide centrally registered,
  versioned walkthroughs. Add future tour-worthy features to the registry and increment its version.
- Remote public layers should remain viewport/zoom constrained and analysis should stay lazy-loaded
  to protect initial performance.

## Outstanding request after this recovery point

The next requested release should:

1. Add categorized/value-based symbology so a user can choose an attribute field and assign styles
   to each distinct value, including streamed public layers where client-side styling is possible.
2. Turn the assistant into a conversational LandDraft expert that understands the current map,
   teaches exact UI steps, performs supported GIS actions, asks focused questions when names or
   destinations are missing, analyzes visible/selected map data for patterns, records each request
   and result, and can roll back the latest three AI-applied changes.
3. Increase the clickable hit area around line features without making the visible stroke thicker.
4. Add expandable feature-level sublayers/lists for rename, edit, and removal actions.
5. Diagnose multi-select so clicking features selects only the intended rendered feature(s), with
   correct deduplication and active-layer behavior.
6. Keep the interface compact: common choices visible, detail controls inside collapsed advanced
   sections, with mobile behavior remaining uncluttered.

## Completed release after the recovery point

Primary commit `d7a597b` completes the request above. It adds:

- `LayerStyle.categorized`, with an attribute field, per-value color/visibility rules, and a fallback
  style. MapLibre expressions apply these rules to points, lines, and polygons; streamed public
  layers retain the rule set while unseen values use the fallback.
- A compact Color features by attribute editor with up to 100 loaded distinct values and a refresh
  action for viewport-fed layers.
- Project-scoped `AssistantConversation` data containing up to 80 messages and the three most recent
  reversible assistant actions. It is serialized through the existing project state and Supabase
  project/version storage, so no new cloud service or secret is required.
- Assistant actions save a normal project restore point before changing layer state. The Revert
  control calls the existing secure version restore path, then preserves the current conversation
  while removing the reverted action from its three-item stack.
- Conversational program help, clarification prompts, exact UI instructions, current-map pattern
  summaries, attribute selection, categorized styling, public-data routing, panel opening, and map
  report generation. This remains an on-device LandDraft intent engine; a general-purpose remote
  language model still requires a separately configured secure server-side provider and secret.
- Expandable feature sublayers with search, selection/zoom, rename, visibility, and deletion or
  local hiding controls. Feature deletion remaps selection indexes safely.
- A 12-pixel invisible hit target for line features. Click and box selection query only base
  selectable geometry layers, deduplicate style-layer hits by feature, and continue to prefer the
  active layer when rendered features overlap.

Verification for this release: TypeScript completed with no errors, ESLint completed with no
errors (existing Fast Refresh warnings only), the production client/SSR/Cloudflare build completed,
and the unauthenticated local sign-in surface opened with no browser console errors.

## Secure map-sharing release

The sharing release adds `supabase/migrations/202608260001_secure_map_sharing.sql` and a matching
client module in `src/lib/gis/sharing.ts`. It provides signed-in viewer, editor-copy, and
administrator roles; secure snapshots limited to selected layers/features; revocable email access;
shared-map switching; near-live share refresh; editor-owned working copies and administrator review;
and a dedicated Share panel. Share URLs use `?share=<uuid>`, and Google OAuth preserves that return
path. Viewer screens intentionally omit drawing, styling, analysis, save, project-management, and
GIS export controls while retaining layer visibility, feature inspection, attributes, basemaps,
printing, and help.

Project map position is stored both in the project snapshot and in `projects.map_view`. A lightweight
debounced RPC updates the latter after map movement, independent of the autosave toggle, so the last
center, zoom, bearing, and pitch follow the account across devices. `projects.last_opened_at` controls
which project opens after sign-in. Shared-map assets use the private path pattern
`<uploader>/<project>/shares/<share>/state.json`; storage RLS checks the share ID before download.

## Project records and marker-symbol release

The project state now includes a `ProjectRecords` collection. Every main project and subproject has
its own notes, nested document folders, private file metadata, summary brief, and timestamped event
history. File content is stored in the existing private `project-assets` bucket under
`<user>/<project>/documents/...`; project JSON contains only metadata. The Project records panel
supports selected-note/file packets, printable email previews, downloadable ZIP packets with the
original files, basic MIME attachment extraction from imported `.eml` messages, and map copies in a
dedicated Maps folder. A real BCC/forwarding inbox still requires an inbound-mail provider, domain
DNS routing, and a secure webhook; the interface does not claim that routing is live until
`VITE_INBOUND_EMAIL_DOMAIN` is configured.

Print compositions can independently show selected project notes and can store PNG/PDF map copies
without changing the live project map. Search results can be added directly to a Working layer.
Point symbology supports a compact built-in icon catalog, custom color or inherited fill color,
size, per-feature overrides, and attribute-driven icon rules rendered through MapLibre expressions.
The project summary, packet selections, saved maps, emails, and documents form the structured input
for a future server-side presentation generator. The map assistant itself uses only an
authenticated, size-limited project summary through the `gis-assistant` Edge Function; it does not
send whole project files or private stored documents to the model.

## Outstanding production integrations to keep visible

- The authenticated `share-invite` Edge Function was deployed to LandDraft Production on September
  8, 2026. It uses the server-only Resend key already held by Supabase, grants access through the
  guarded `invite_share_member` RPC, and reports email delivery separately from permission changes.
  Complete an end-to-end delivery test from the published Share panel and confirm the verified
  `accounts@notify.landdraft.net` sender remains active before broader customer onboarding.
- Email intake migration `202609040001_project_email_intake.sql` and the `resend-inbound` Edge
  Function were deployed to LandDraft Production on September 4, 2026. Complete the Resend account,
  Name.com records, function secrets, end-to-end test, and written retention policy before showing
  live addresses.
- Configure production SMTP for account confirmation, password reset, and sharing notifications.
- Run the AI quota migration, deploy the authenticated `gis-assistant` Edge Function, set
  `AI_PROVIDER=groq` and its server-only `GROQ_API_KEY`, then verify help, map-action, project-query,
  and live-web requests. Provider failures must not invoke a paid fallback. The future presentation
  builder remains a separate integration.
- Finish Apple identity-provider enrollment and credentials if Apple sign-in is required.
- Confirm automated database/storage backups, error monitoring, and public-data connection alerts
  before broader customer onboarding.
