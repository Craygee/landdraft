# Study Area Report architecture

## Objective

Study Area Report is an optional, project-persisted LandDraft workspace that turns a polygonal study area and the project's available evidence into an editable, source-attributed and re-runnable report. It extends the existing GIS project rather than creating a duplicate project or data silo.

## Initial flow

1. User opens **Study Area Report** from LandDraft Tools.
2. User chooses a boundary from a polygon layer, the saved project area or an approximate current view.
3. User edits cover title, subtitle, company and optional logo.
4. LandDraft analyzes loaded project layers against the boundary.
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
- `sources`: de-duplicated attribution and URLs;
- `status` and `gapMessage`.

Initial category matching uses conservative source/name keywords and geometry presence. It does not claim that a loaded layer is authoritative merely because its name resembles a category. Later provider adapters can replace keyword discovery with catalog metadata and dedicated queries.

## Map figures

The first increment creates deterministic SVG figures from the selected boundary and loaded project vector layers. These remain printable, source-linked and independent of fragile screenshot timing. Saved LandDraft elevation profiles are embedded as profile figures. Raster/public services remain listed as context evidence even when a client-side feature count is unavailable.

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

### Phase 2 — provider-backed analysis

- server-side adapters for validated terrain, soils, wetlands, flood, hydrography, land cover, environmental facilities, climate and infrastructure;
- viewport/AOI query budgets, caching, rate-limit handling and provenance;
- data-quality and coverage matrix;
- section-specific metrics and professional legends.

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

- Analysis is limited to project layers already loaded into the client.
- Raster layers can be shown as available context but are not sampled in the first increment.
- Geometry figures are schematic vector maps and do not yet include a rendered basemap.
- A project-area/current-view boundary is rectangular unless the user selects a polygon layer.
- Browser print controls final PDF paper/output settings.
