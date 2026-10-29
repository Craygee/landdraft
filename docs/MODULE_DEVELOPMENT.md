# LandDraft module development

This file defines the working rules for LandDraft feature and module development after the
September 10, 2026 stable checkpoint.

## Stable checkpoint

- Tag: `landdraft-stable-2026-09-10`
- Published checkpoint commit: `e6bef3f1f250b650ef0391db8559f20089653ff5`
- Test branch starting commit: `efc47a3aa9d3cc69bd9bbd7411137dc7535f1b4b` (the current main
  head, including the precise layer-order drop-line fix)
- New module work starts on `feature/test-module-development` or a narrower feature branch based
  on it.
- Test and review module changes before merging. Do not deploy feature branches to production.

## Public test deployment

### Current shared test site (September 13, 2026)

Use `https://landdraft-test.tight-sky-0ae1.workers.dev/` for current Weather, Water,
and main-workspace testing. The active branch is `codex/landdraft-test`; use
`scripts/prepare-weather-test.mjs` with the isolated test environment before deployment.
Check `/weather-test-release.json` for the deployed source revision. Module navigation is
relative to the current host, so opening the older preview URL keeps users on that older site.
Do not change or redirect the legacy environment without checking its workspace/data dependencies.

### Legacy preview deployment

The following describes the older preview environment, not the current shared test site:

- Hosting target: the isolated Cloudflare Worker named `landdraft-preview`.
- Public test URL: `https://landdraft-preview.tight-sky-0ae1.workers.dev/`.
- Source repository: `Craygee/landdraft`.
- Allowed deployment branch: `feature/test-module-development` only.
- Build command: `bun install --frozen-lockfile && bun run build && node scripts/prepare-preview-worker.mjs`.
- Deploy command: `npx wrangler deploy --config .output/server/wrangler.json`.
- `scripts/prepare-preview-worker.mjs` refuses other branches, assigns the isolated worker name,
  enables Cloudflare preview URLs, and adds a no-index response header to the generated preview
  assets.
- The test deployment may use the existing Supabase project for authenticated integration testing
  only after its public browser URL and publishable key are added as Cloudflare build variables and
  the preview callback URL is allowed in Supabase. Never add a service-role key to the browser build.

## Product and scope guardrails

- Core mapping remains free. New modules must not place the existing map, drawing, layer,
  measurement, import, or core export workflows behind a paid entitlement.
- Pricing remains undecided. Module documentation may identify costs but must not assign a price,
  plan, paywall, trial, or entitlement.
- Module work must not change payments, plans, entitlements, administrative permissions,
  production infrastructure, or backups.
- Lovable remains a preview and deployment target only. Application changes are authored in the
  repository and reach Lovable through GitHub sync.

## Shared-change coordination gate

Before merging any module that changes shared application code or the database:

1. Identify the shared files, database objects, migrations, edge functions, storage policies, and
   environment variables affected.
2. Compare those changes with the active administration/billing work and record any overlap in the
   module document.
3. Resolve naming, schema, migration-order, permissions, and UI-entry-point conflicts before merge.
4. Rebase or merge only after coordination; never rewrite already published Git history.
5. Run type checking, linting, the production build, and module-specific tests in the test
   environment.

If the administration/billing branch or worktree is not locally available, leave the module
unmerged and record coordination as pending. Do not guess at billing or administrative contracts.

## Required module record

Create `docs/modules/<module-name>.md` for every new module. Use this template:

```markdown
# <Module name>

Status: Proposed | In test | Ready for coordinated review | Merged
Owner branch: <branch>
Core mapping impact: None | Describe the compatible change
Pricing: Undecided

## Capabilities

- What a user can do.
- What is deliberately outside this module.

## Dependencies

- Shared frontend components and application services.
- Database tables, functions, policies, migrations, storage buckets, or edge functions.
- External APIs, data providers, SDKs, authentication scopes, and environment variables.

## Potential operating costs

- Fixed services and current free-tier assumptions.
- Usage-based requests, compute, storage, bandwidth, email, AI inference, or data licensing.
- Expected cost drivers and practical usage limits.
- Unknown or provider-controlled costs that must be verified before release.

Do not set product pricing in this section.

## Administration/billing coordination

- Shared files or schema touched.
- Known overlap with administration/billing work.
- Coordination status and decisions still pending.

## Security and privacy

- Data stored, transmitted, or exposed.
- Permission and row-level-security expectations.
- Abuse, quota, and retention considerations.

## Test plan

- Desktop, tablet, and mobile behavior where applicable.
- Persistence and multi-user behavior.
- Failure, offline, rate-limit, and unavailable-provider behavior.
- Typecheck, lint, build, and module-specific test results.

## Release notes

- User-visible changes.
- Setup steps or connections still required.
- Rollback or disablement approach.
```

## Merge checklist

- [ ] Module record is complete.
- [ ] Capabilities and exclusions are clear.
- [ ] Dependencies and potential operating costs are documented.
- [ ] Pricing remains undecided.
- [ ] Core mapping remains free.
- [ ] No prohibited billing, entitlement, admin, production-infrastructure, or backup changes exist.
- [ ] Shared code/database changes have been coordinated with administration/billing work.
- [ ] Database changes are additive, ordered, reversible where practical, and tested separately.
- [ ] Typecheck, lint, build, and relevant module tests pass.
- [ ] The September 10 stable checkpoint remains reachable by tag.
