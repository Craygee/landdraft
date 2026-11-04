# Study Area Report module

## Capabilities

- Define a study area from a project polygon, saved project area or current map view.
- Generate an editable report from loaded public and user layers.
- Turn sections on/off and reorder them.
- Create source-attributed overview, terrain, hydrology, soils, environmental, infrastructure, energy, hazard, records and data-gap sections.
- Embed available saved elevation profiles.
- Generate printable mapped figures from project evidence.
- Customize cover title, subtitle, company and logo.
- Re-run after project data changes while retaining user narrative.
- Preserve vital missing evidence as an explicit **Insufficient Data** block.

## Dependencies

- LandDraft project store and project-version history.
- Existing GIS layer/source metadata.
- `@turf/turf` for client-side geometry measurements and intersections.
- Existing elevation/buildable analysis artifacts.
- Browser print/PDF for the foundation export.

## Potential operating costs

The foundation uses local analysis and browser printing and has no new paid provider requirement. Later provider-backed queries, commercial imagery/parcels/hazards, object storage, server-side PDF rendering and optional AI narrative may introduce licensing, request, compute or storage costs. Pricing is intentionally undecided.

## Safety and interpretation

Study Area Report is screening and documentation software. A mapped inventory or derived value is not a survey, title opinion, jurisdictional determination, environmental site assessment, engineering design or regulatory approval. Each section must retain source, date, coverage and limitation context.
