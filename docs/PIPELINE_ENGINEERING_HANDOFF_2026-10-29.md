# Pipeline Engineering — handoff for Codex review (2026-10-29)

Branch: `claude/pipeline-engineering-2026-10-29` (local only, not pushed)
Base: `origin/main` at `96a89f8` (fetched 2026-10-29; unchanged from the prior local ref)
Scope: Phase 2 of [the architecture](./PIPELINE_ENGINEERING_ARCHITECTURE.md) plus fixes to the
Phase 1 solver. Everything remains `preliminary-unvalidated`. No schema, migration, dependency,
entitlement, provider or infrastructure change.

## Commits

| Commit | Summary |
| --- | --- |
| `1153b88` | Solver: components as step changes; `limit-exceeded` status; benchmark tests |
| `2f46b2b` | Components keep placement through route edits; station entry; review flag |
| `366997e` | Survey/manual elevation control points; burial depth; abortable terrain |
| `e565d53` | Constructability, land siting, takeoff v2, estimate ledger, "Build" tab |
| (this doc) | Module doc update and this handoff |

## Defects fixed in existing behaviour

1. **Pressure scrub blended pump boosts along the pipe.** A pump's boost was applied at one
   profile point and `interpolateProfile` blended linearly from the previous station. The solver
   now emits upstream/downstream points at every component station (`discontinuity`,
   `componentIds`); interpolation never spans the pair; the map skips the zero-length segment.
2. **Hard-limit runs reported as "warning".** MAOP/minimum-pressure errors now yield
   `status: "limit-exceeded"`; per-station duplicate findings are collapsed. The status card shows
   the run's real solver version (it hard-coded v0.1.0).
3. **Components drifted on route edits.** `reprojectRouteComponents` kept the fraction of total
   length, so extending one end slid every component. It now projects to the nearest point on the
   new centerline; route-end sources/destinations follow the end; moves over 1 m set
   `placementReview`, which raises a solver warning until the user confirms or enters a station.
4. Manual start/end elevation defaulted from pipe centerline; now from ground.
5. `formatStation` could render `1+100`; fixed while moving it to `format.ts`.

The input-hash model version is bumped (`liquid-steady-v3-component-steps`) so saved runs
re-solve on open.

## New behaviour

- **Terrain** (`terrainModel.ts`): control points are exact at their station; within their
  influence range they correct the DEM with a linear taper to zero; outside, DEM is unchanged;
  without DEM, stations between controls are interpolated and labelled. Controls are stored by
  coordinate, survive edits, and are ignored (but kept) when more than 10 m off the edited route.
  `route.burialDepthM` sets centerline below ground. Stations/profile points carry
  `elevationProvenance`; the tooltip shows ground vs centerline and the DEM card says
  "not survey-grade". Terrain fetches are aborted when superseded.
- **Constructability** (`constructability.ts`): construction ranges resolve into intervals by
  evidence precedence (field > user > provider-mapped > model-estimated > default; later wins on
  ties). Trench depth = burial + OD/2 + bedding. Rock = rock-range length × width × depth, plus a
  separate % allowance over remaining trenched length. Blasting defaults to not permitted.
  Bore/HDD/casing intervals have no trench.
- **Crossings**: manual add/correct/confirm/reject with type-based default method and special
  length; re-projected on edits and reset to `unreviewed` if no longer on the route. No automatic
  detection yet.
- **Land siting** (`siting.ts`): polygons tagged with permitted facility classes or
  "No facilities"; a component whose class isn't permitted is a `FACILITY_NOT_PERMITTED` blocker
  shown with the run findings. Untagged land imposes nothing.
- **Takeoff v2**: items carry stable `key`s and trace to route, pipe, ranges, components and
  crossings. Pipe, joints, clearing (area when width set), trench, excavation, bedding, backfill,
  rock (ranged, allowance), components by kind, crossings and bore/HDD/casing length, hydrotest
  water.
- **Estimate ledger**: quantity × newest `PriceSnapshot` for that key and unit, then contingency and
  markup rows. Unpriced quantities stay `null` and are counted, never $0. New rates are new
  snapshots (never edited); Vendor Quote is not offered until a vendor library exists. Legacy
  per-metre allowances still price pipe/installation.

## Verification (local, Node 26.13.0)

- `node --experimental-strip-types --test src/lib/pipeline/*.test.ts`: **34 pass, 0 fail**
  (baseline before this work: 12 pass). New suites: `liquidSolver.test.ts`,
  `terrainModel.test.ts`, `constructability.test.ts`; `components.test.ts` updated.
- Benchmarks: 64/Re exact; Colebrook within 1% of Moody reference points and residual < 1e-6;
  Hagen-Poiseuille laminar drop exact; zero-flow static head exact; pump and valve steps.
- `tsc --noEmit`: pass. `eslint src/lib/pipeline src/components/pipeline`: pass.
  `prettier`: applied to changed files. `vite build`: pass.
- Dependencies were installed with `npm install --ignore-scripts --no-package-lock` because the repo
  lockfile is `bun.lock`; versions may differ slightly from bun's resolution.
- **Not done:** the app was not run in a browser (repo rules: no running the app until targets are
  verified local/non-production). Visual, touch and mobile checks of the new "Build" tab, station
  entry and rate entry are outstanding.

## Review notes and known limits

- `schemaVersion` stays 1. Every new field is optional, so existing saved projects load unchanged;
  old takeoffs without `key` fall back to the item id until the next solve regenerates them.
- Construction ranges are station-based and are **not** re-projected on route edits (components,
  crossings and control points are). Worth deciding before automatic detection lands.
- Land permissions reference `layerId` + `featureIndex`, which is fragile if a layer's features are
  reordered; a stable feature id would be better.
- Takeoff quantities and rates use SI units (m, m², m³) while most of the UI displays feet.
- The solve still runs on the UI thread (fine at ≤ 96 terrain samples).
- `PipelineWorkspace.tsx` is now ~2,100 lines; splitting the right-panel tabs into files is a
  sensible follow-up.
- Still out of scope: gas, EPANET, branches, optimization, vendor library, live pricing, bid
  packets, automatic crossing detection, Esri provider, mobile focus modes, any database tables.
