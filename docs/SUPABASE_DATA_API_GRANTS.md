# Supabase explicit Data API permissions — October 2026

Supabase stops automatically exposing new public tables on October 30, 2026.
Existing table grants remain. LandDraft must declare object grants in migrations;
RLS still decides which rows a caller can access.

## Audit and corrections

The inventory in `tools/database-permissions.json` classifies 20 public tables:
18 shipped tables and two optional parcel-cache tables. All have RLS enabled.
Eight tables lacked explicit service-role DML grants: profiles, projects,
project_members, project_versions, project_shares, share_members,
share_submissions and weather_provider_connections. Their original creating
migrations now grant server SELECT/INSERT/UPDATE/DELETE explicitly. Schema USAGE
is explicit in the foundational migration. These are trusted backend privileges,
not new user privileges. Existing guarded project creation stays RPC-only.

`202610200001_explicit_data_api_grants.sql` repairs existing installations in one
transaction. It preserves RLS policies, project data, account gates and storage
configuration. It removes anonymous privileges on known private tables; public
weather catalog SELECT is retained. Chaser coordinates stay RPC-only for users.
Optional parcel tables are guarded by existence checks and are never installed
or enabled by this repair. No broad default grants or ALL TABLES grants are added.
No function, unknown table, custom schema or Supabase-managed schema receives new
privileges. Existing backup roles are unaffected.

## Live procedure

1. Sign in to the actual production Supabase project; confirm its project identity.
2. Run `supabase/tests/data_api_permissions.sql` (read only). Review unknown tables,
   missing tables, RLS, sequences, function access and existing defaults. Do not
   grant unknown objects merely because they appear in this report.
3. Apply the forward repair migration, then rerun the audit. Required checks should
   be OK; optional parcel tables may report OPTIONAL NOT INSTALLED.
4. Test authenticated project load/save/share, email intake and optional weather
   provider connections. Repeat on test/preview projects that use independent DBs.
5. Follow normal migration deployment for future resets/new projects.

Status: local migration replay and RLS tests passed. Live catalog verification and
repair application are pending an authenticated Supabase dashboard session; this
report does not claim production ACLs were changed or all live schemas were checked.
A web app publish alone does not apply SQL migrations to external Supabase.

## Verification

Run `node tools/test-database-permissions.mjs [repository-root]` with the PGlite
0.5.10 package available at `.task-db-verify/node_modules/@electric-sql/pglite`, or
set `LANDDRAFT_PGLITE_MODULE` to its `dist/index.js`. The test runtime is isolated;
no database credentials or network database connection are used. Install PGlite
only in an isolated temporary npm/pnpm project, not as an application dependency.

The tests replay migrations under zero automatic grants and legacy automatic
table/function grants, check required grants in each creating migration, replay
the repair twice, inventory all tables, verify RLS, test two-user project
isolation, deny anonymous project/AI reads, exercise presence RPCs while denying
direct coordinate reads, and check server access. The read-only audit is executed
as part of the test. Auth/Storage schemas are minimal fixtures; extension creation
is skipped, and cryptographic byte generation is a test stub. These tests validate
PostgreSQL ACL/RLS behavior, not Supabase Auth, Storage, PostGIS, production hooks
or provider delivery end to end.

Future tables must have an explicit role classification, required grants and RLS
in the creating migration. Add sequence USAGE only if a serial/identity-backed
API insert needs it; current application tables use UUID/composite keys. Keep
internal/RPC-only tables denied to clients. Never solve permission errors by
granting anonymous access to every table or disabling RLS.

Official references:
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- https://supabase.com/docs/guides/api/securing-your-api

## Live preflight — October 20, 2026

Confirmed signed-in production project `txgbeskieqvvptgtjyou` (LandDraft Production,
custom URL auth.landdraft.net). Read-only SQL found 13 public application tables:
all RLS enabled, none readable by anon, zero public sequences. The same eight
server DML grants are missing live. Five weather-governance tables and both parcel
cache tables are not installed; do not install these unused features as part of
this repair. The repair now conditionally revokes privileges on optional tables.
Schema USAGE is already present for all three API roles. Existing backup-role
SELECT grants and access-control policies must remain unchanged.

Live application is awaiting action-time confirmation for eight service_role DML
grants, because that role bypasses RLS and this expands its direct table access.
No live grants, policies, records or defaults have been modified during preflight.

## Production repair applied — October 20, 2026

User explicitly approved the eight backend grants at action time. Applied an
atomic transaction to the 13 installed public tables on production. Granted
SELECT/INSERT/UPDATE/DELETE to service_role on the eight audited tables, revoked
all anon privileges on the installed private tables, and retained authenticated
presence-table denial. No records, policies, functions, defaults, schema exposure,
credentials or backup-role grants were changed. No optional tables were added.

Post-commit SQL verified 32 individual backend privileges with zero missing,
13 public tables with zero missing RLS, zero tables with anonymous table privileges,
zero missing glab_backup SELECT grants, direct authenticated project INSERT false,
and direct authenticated presence access false. No production user records were
read or written for testing. These catalog checks do not constitute an end-to-end
test of every app feature or a general guarantee against unrelated future issues.
