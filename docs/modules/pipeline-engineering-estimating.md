# Pipeline Engineering & Estimating

Status: Merged
Owner branch: `main`
Core mapping impact: None; this is an optional workspace and core map tools remain free  
Pricing: Undecided

## Capabilities

The target module connects route GIS, terrain, hydraulic scenarios, pipe and equipment selection,
land-aware constraints, constructability, takeoff, procurement evidence, estimates and bid drafts.
The first test increment provides the optional workspace foundation, versioned data contracts,
route selection/stationing, a preliminary incompressible liquid screening solver, result-colored
map segments, map/profile pressure scrubbing, warnings, traceable quantity takeoff, and a
budget-allowance cost foundation. Pipeline state is saved with the owning LandDraft project and
automatically invalidates/recalculates when a linked route changes.

Deliberately outside the initial validated capability are transient liquid/gas, multiphase,
flow-assurance, dense-phase CO2, hydrogen/ammonia specialty design, final MAOP/code compliance,
survey/geotechnical confirmation and construction-ready bids. Unsupported cases are refused rather
than run through an inappropriate formula.

Research and architectural decisions are in:

- [Pipeline Engineering research](../PIPELINE_ENGINEERING_RESEARCH.md)
- [Pipeline Engineering architecture](../PIPELINE_ENGINEERING_ARCHITECTURE.md)

## Dependencies

Phase 1 reuses React, MapLibre, Turf, Recharts, the existing LandDraft project store, route layers,
project save history and responsive UI components. It adds no third-party runtime dependency and no
database migration.

Planned optional dependencies/providers include USGS 3DEP, Esri elevation services, USGS 3DHP,
NRCS SSURGO, FWS NWI, FEMA NFHL, BTS NTAD, EIA API v2, EPANET 2.2, and possibly validated isolated
compute adapters using CoolProp, SciPy, OR-Tools or HiGHS. Each must receive its own provider,
license, security and deployment review before activation.

Future persistent vendor/contact/quote/estimate/bid data requires additive Supabase schema, RLS,
private storage buckets and audit events coordinated with the administration/billing workstream.

## Potential operating costs

- USGS and other federal public services are generally free, but rate limits, caching, bulk
  transfer and uptime still require engineering and monitoring.
- Esri elevation requests may be usage-based after the provider's free allocation and require an
  account/token.
- High-resolution terrain, solver artifacts, quote attachments and bid packets drive object
  storage, egress and backup costs.
- Large route/pipe/equipment optimization jobs may require queued server compute.
- Vendor-price acquisition may require licensed feeds or paid supplier integrations; public page
  access is not assumed to permit automated collection.
- Email/proposal delivery, document conversion, malware scanning and AI assistance can create
  per-use costs.
- Professional validation, standards access and engineering review are real release/operating
  costs even when software libraries are open source.

Provider prices and allowances must be reverified before release. Product pricing is intentionally
undecided.

## Administration/billing coordination

Phase 1 touches shared frontend route/store code but does not add an entitlement or schema. Before
future access enforcement, register the stable module identifier `pipeline.engineering` with the
separate administrator portal contract. The compact navigation entry was reviewed with the shared
application shell for this release.

Future database tables, storage, server functions, provider secrets, quotas and any module-access
policy are pending coordination. No payments, plans, entitlements, administrative permissions,
production infrastructure or backups are changed here.

Release coordination on 2026-09-12 confirmed that the separate administration portal currently
defines only free core mapping and does not enforce GIS module access. The Pipeline foundation is
therefore released as an open optional workspace; no administrator-portal record, grant, plan,
permission or billing behavior is changed by this release.

## Security and privacy

Pipeline routes, land constraints, vendor contacts, quotes, estimates and bids are private
project/company data. Future RLS must enforce tenant/project access independently of ordinary
shared-map visibility. Provider keys must remain server-side. Attachments require private storage,
signed URLs, size/type limits and malware scanning. Automatically acquired records preserve source,
retrieval time, confidence and provider terms.

AI may explain and stage changes but cannot silently alter confirmed engineering inputs, approve
compliance or fabricate a quote.

## Test plan

- Verify optional entry/exit at desktop, tablet, iPhone and narrow-mobile widths.
- Verify core LandDraft is unchanged when no pipeline model exists.
- Verify route linkage, edit invalidation, stationing and save/restore persistence.
- Verify liquid benchmark cases, invalid inputs, elevation head and stale-run handling.
- Verify unsupported gas/multiphase cases produce explicit blockers.
- Verify map/profile synchronization and result status/units.
- Verify quantities trace to route/model revisions and historical snapshots reproduce totals.
- Verify provider offline/rate-limit states retain sourced prior data without fabricating updates.
- Run TypeScript, ESLint, production build and module tests before coordinated review.

Current foundation verification (2026-09-11):

- TypeScript: pass.
- ESLint: pass with zero errors; the nine repository-wide Fast Refresh warnings predate this
  module.
- Production client/SSR/Cloudflare build: pass.
- Numerical smoke case: approximately 1,000 m two-point route; finite pressure loss at positive
  flow; zero loss at zero flow with no elevation change; gas input correctly refused with
  `ADVANCED_ANALYSIS_REQUIRED`.
- Auth gate and `/pipeline` route title: browser smoke check passed. Full signed-in visual and
  touch QA remains required in the test deployment.

## Release notes

- User-visible: optional Pipeline Engineering & Estimating workspace begins on the test branch.
  It is accessible from desktop Data controls and the mobile Data sheet. The specialized workspace
  has its own uncluttered model/map/properties/profile layout and responsive bottom sheets.
- Setup still required: provider credentials/proxies, validated EPANET packaging, compute service,
  private storage/RLS and organization engineering review workflow.
- Disablement: remove/hide the workspace entry; versioned pipeline project data remains inert and
  normal LandDraft mapping continues.
- Rollback: the September 10 checkpoint remains reachable as `landdraft-stable-2026-09-10`.

## Phase 2 increment (local branch `claude/pipeline-engineering-2026-10-29`)

Not merged. Details, test results and review notes:
[Pipeline handoff 2026-10-29](../PIPELINE_ENGINEERING_HANDOFF_2026-10-29.md).

- Solver 0.3.0-preliminary: components are step changes with paired profile points; no
  interpolation across pumps or valves; `limit-exceeded` run status.
- Components keep their location through route edits and are flagged for review when moved.
- Survey/manual elevation control points with influence ranges; burial depth.
- Construction ranges with evidence precedence, trench geometry, rock quantities, manual crossings,
  land facility-siting tags.
- Traceable takeoff v2 and an estimate ledger priced from immutable rate snapshots.

## Foundation limitations before the next increment

- System pipe entries are dimensional screening templates and are not pressure-rating or
  compatibility approvals.
- DEM/survey sampling, crossings, component drag/drop, pump/compressor equations, branch networks,
  route/pipe/equipment optimization, live vendor acquisition, full cost build-up and bid packet
  generation are architecture-backed but not enabled yet.
- The native solver currently supports only steady incompressible liquid routes. Gas and advanced
  fluids are deliberately blocked.
- An independent licensed engineering validation suite is required before changing the solver from
  `preliminary-unvalidated`.
