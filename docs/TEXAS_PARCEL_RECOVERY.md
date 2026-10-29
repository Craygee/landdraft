# Texas parcel recovery — public statewide archive

The previous 2019 ArcGIS item was retired/inaccessible. TxGIO's current MapServer returned metadata but rejected real feature queries. Do not equate successful metadata with a working parcel layer.

## Registered source and license

- Publisher: Texas Geographic Information Office (TxGIO), with county appraisal districts/BIS compilation.
- Official program: https://gio.texas.gov/stratmap/land-parcels.html
- Collection metadata: https://api.tnris.org/api/v1/collections?search=land%20parcels
- 2025 collection: `0fa04328-872e-481c-b453-126a74777593`.
- Explicit collection license: **CC0-1.0**, https://spdx.org/licenses/CC0-1.0.html; reviewed September 14, 2026.
- Resources: https://api.tnris.org/api/v1/resources?collection_id=0fa04328-872e-481c-b453-126a74777593
- Public archive: https://s3.amazonaws.com/data.tnris.org/0fa04328-872e-481c-b453-126a74777593/resources/stratmap25-landparcels_48_lp.zip

This direct collection license replaces the earlier unresolved TxDOT-mirror licensing assessment. The mirror is not used for the statewide archive. The source catalog marks the compilation non-authoritative; preserve the AS-IS/not-a-survey context.

## Verified coverage and integrity

- Actual archive: 2,812,975,183 bytes (publisher resource metadata reports a different size).
- SHA256: `22786b9f1ed23fd824d23ed50d9a462b36cbcc260fdf59cfacdfead789047803`.
- 14,347,648 source records = 14,336,277 mapped + 11,371 retained without usable geometry.
- 253 county resources. Donley (48129) absent. This is all available statewide-release data, not a claim of all 254 counties.
- Source edition June 2025; county acquisition/tax dates vary. Weekly checks do not make old county records current.
- Original fields retained; geometry transformed EPSG:3857 to EPSG:4326 using always-XY. Source geographic outliers are not silently deleted.

## Storage and access

Dedicated Cloudflare R2 bucket/Worker `landdraft-public-parcels` contains only public parcel files, with no private-project bindings. Versioned spatial FlatGeobuf parts support HTTP byte ranges. Browser queries use viewport bounds and a feature budget. Missing-geometry records remain separate Parquet files. Source URLs, edition, retrieval time and license accompany displayed/exported features.

Statewide attribute search is a separate index in the same public version. The main map can search outside the viewed extent by county, `Prop_ID`/`GEO_ID`, owner name, situs address, and parsed block/section values from `LEGAL_DESC`. The service selects a compressed prefix shard, stops at a bounded result limit, and returns source identifiers plus parcel bounds. Adding a result resolves the exact geometry from the existing FlatGeobuf archive; the search index does not duplicate or replace the map layer. Block and section are derived search fields because TxGIO does not publish dedicated block/section columns, and the original legal description remains attached to each result.

The old project-area Supabase cache migration/function is an inactive prototype, superseded for this statewide request; do not apply it to enable statewide storage.

## Weekly refresh and rollback

GitHub Actions `.github/workflows/texas-parcels.yml` on `Craygee/landdraft` checks Mondays at 07:17 UTC and supports manual dispatch. It checks the newest public collection's explicit license, inventories all resources, compares source ETag, downloads only when changed, verifies archive length/hash, validates spatial and search-index counts, uploads immutable parts and search shards, then publishes `texas/current.json` last. Failed ingestion keeps the previous manifest.

A dedicated `PARCEL_PUBLISH_TOKEN` secret is in GitHub Actions and the parcel Worker's `PUBLISH_TOKEN`; never copy it into client code, reports or logs. The publisher endpoint only permits the public parcel namespace. Rotation is supported by `tools/texas-parcels-provision.mjs` using in-memory generation and CLI stdin. Keep previous versions for rollback; storage usage grows with new editions and requires deliberate retention review.

Rollback: restore `texas/current.json` from a previously verified immutable version manifest, preserving files referenced by active clients. Disable the GitHub workflow to pause scheduled updates. Do not delete old versions during an incident.

## Checks and remaining QA

Automated checks cover retired-URL migration, index byte-range reads, viewport limits, license rejection, identifiers/provenance, statewide search validation/shard selection, public read/write isolation and missing-dataset responses. Run TypeScript, scoped ESLint, parcel tests and production build. Verify real urban/rural viewport queries, representative ID/owner/block/section searches, source controls and an authenticated saved-layer workflow before declaring live browser QA complete. Missing/incomplete reads must remain visible errors or truncated results, never falsely complete statewide downloads.

## September 14 deployment verification

Public storage publication: 219 indexed FlatGeobuf parts plus 91 missing-geometry Parquet files. All 219 mapped files passed hosted HEAD/size checks. Full hosted queries matched every source OBJECTID in a direct geometry scan (the publisher geodatabase's own spatial index incorrectly returned empty results): Austin 1,415 / 9.0 s, San Antonio 340 / 4.5 s, El Paso 746 / 2.1 s, rural western Texas 26 / 0.8 s. These are cold-path development measurements, not an SLA.

The weekly workflow was manually executed successfully: https://github.com/Craygee/landdraft/actions/runs/34865511301 . It verified catalog/license, server-side publisher credentials, multipart write/readback and unchanged-edition detection. The future full changed-edition Linux job has not yet encountered a new publisher release; the first complete index was produced locally and uploaded with the same version/manifest scheme.

Live application release commit: `be2edcd2` (Publish LandDraft 0.9.160 public Texas parcels), pushed normally to the deployment repository main branch after validation. Browser was signed out, so authenticated desktop/iPad/mobile UI verification remains outstanding. No database migrations were applied for this statewide implementation.

Production verification: landdraft.net publicly serves version 0.9.160+be2edcd2 in its Workbench and RemoteLayerManager bundles. Lovable production deployment d5e70c27-62d3-4d03-b3ac-5f4472fa7170 was requested after the synced build was ready.
