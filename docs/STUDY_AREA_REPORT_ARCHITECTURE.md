# Study Area Report architecture

## Objective

Study Area Report is an optional, project-persisted LandDraft workspace that turns a polygonal study area and the project's available evidence into an editable, source-attributed and re-runnable report. It extends the existing GIS project rather than creating a duplicate project or data silo.

## Initial flow

1. User opens **Study Area Report** from LandDraft Tools.
2. User chooses a boundary from a polygon layer, the saved project area or an approximate current view.
3. User edits cover title, subtitle, company and optional logo.
4. LandDraft can add the shipped national screening template, then refreshes active live feature services for the exact boundary.
5. Each report section receives a status: `ready`, `partial` or `insufficient`.
6. The user enables/disables sections, edits the user narrative and reviews figures and evidence.
7. A re-run refreshes generated evidence while preserving user-authored narrative and cover settings.
8. Browser print creates a PDF-ready report. Project versioning remains the history/rollback mechanism.

## Persistence

`ProjectState.studyReport` is optional. Existing projects therefore remain valid and do not gain report data until the workspace is opened or changed.

The persisted workspace contains:

- cover settings;
- selected boundary snapshot and provenance;
- ordered section configuration;
- the latest analysis run;
- user-authored section narrative;
- generation and stale-state timestamps.

Only the latest run is stored in the project state. Existing LandDraft project versions provide historical report snapshots without duplicating a large run ledger inside every project save.

## Evidence model

Every section separates:

- `generatedNarrative`: regenerated from evidence;
- `userNarrative`: retained across reruns;
- `metrics`: values with labels and units;
- `layerIds`: project layers used;
- `mapLayerIds`: only intersecting or applicable raster layers that belong in that section's figure;
- `analysis`: per-layer geometry counts, clipped/unioned polygon coverage and concise attribute summaries;
- `sources`: de-duplicated attribution and URLs;
- `status` and `gapMessage`.

Category matching uses conservative source/name keywords, followed by an actual spatial-intersection pass. Features outside the boundary are excluded. Polygon evidence is clipped to the boundary and unioned before section coverage is reported, subject to documented geometry limits. It does not claim that a loaded layer is authoritative merely because its name resembles a category.

## Map figures

Report figures are deterministic SVG maps created from each section's `mapLayerIds`. Off-boundary vector features are filtered, geometry is clipped to the selected boundary, polygon/line/point drawing order is controlled and a total feature budget prevents unreadable output. Supported WMS raster context (including Annual NLCD) is rendered for the exact report extent. Saved LandDraft elevation profiles remain embedded as profile figures.

Future server-side rendering can add basemap tiles, provider-specific legends and higher-resolution static cartography, subject to licensing and attribution.

## Capability hooks

The module defines non-restrictive capability identifiers for future account, organization and subscription assignment:

- `studyReport.basic`
- `studyReport.advanced`
- `studyReport.publicData`
- `studyReport.export`
- `studyReport.enterprise`

The current foundation does not change payment plans, billing, administrative permissions or existing access roles.

## Security and privacy

- Project/user layers are analyzed in the existing authenticated project boundary.
- No project data is sent to generative AI by this foundation.
- Logo content is stored in the project only after file-type and size validation.
- Public data retains attribution and source URLs.
- Shared-project editing follows existing LandDraft project permissions.

## Phases

### Phase 1 — deployable foundation

- persisted model and normalization;
- boundary selection;
- section toggles and ordering;
- evidence analysis over loaded layers;
- editable narrative and explicit insufficient-data sections;
- generated vector maps and saved elevation-profile figure;
- cover branding and printable preview;
- tests and documentation.

### Phase 2 — provider-backed analysis (in progress)

- shipped national screening template and verified USGS Annual NLCD, NRCS SSURGO and FEMA National Risk Index connections;
- client-side AOI refresh for active ArcGIS/GeoJSON services, with progress, feature budgets, failure/truncation warnings and provenance;
- section-specific intersection counts, geometry composition, polygon coverage and attribute summaries;
- boundary-clipped, section-specific maps and WMS extent rendering;
- remaining: dedicated server-side adapters, provider health/caching, raster zonal statistics and source-specific professional metrics.

### Phase 3 — advanced report authoring

- page/figure editor, richer tables and captions;
- repository attachments and selected project notes;
- saved report artifacts in the project repository;
- comparative scenarios and changed-since-last-run review;
- accessible HTML and server-rendered PDF options.

### Phase 4 — optional assisted narrative

- evidence-grounded drafting with citations;
- no invented observations;
- explicit organization approval, provider configuration and usage telemetry before external AI calls.

## Known initial limitations

- Analysis refreshes active viewport-bound services but does not automatically retrieve source-only/download-only catalog records.
- Raster layers can be rendered as report context where a compatible WMS template exists, but raster class values are not yet sampled into zonal statistics.
- Geometry figures are report-specific evidence maps, not survey-grade cartography or a substitute for the provider's original map.
- Very dense service results are capped and explicitly reported as incomplete; narrowing the study boundary improves completeness.
- A project-area/current-view boundary is rectangular unless the user selects a polygon layer.
- Browser print controls final PDF paper/output settings.
