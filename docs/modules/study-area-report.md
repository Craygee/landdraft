# Study Area Report module

## Capabilities

- Define a study area from a project polygon, saved project area or current map view.
- Add a maintained national screening template from the shipped Public Data catalog.
- Refresh active live services for the exact study boundary before analysis.
- Generate an editable report from active public and user layers.
- Turn sections on/off and reorder them.
- Create source-attributed overview, terrain, hydrology, soils, environmental, infrastructure, energy, hazard, records and data-gap sections.
- Embed available saved elevation profiles.
- Generate printable, section-specific mapped figures clipped to the study boundary.
- Report per-layer feature counts, geometry composition, unioned polygon coverage and leading attributes.
- Customize cover title, subtitle, company and logo.
- Re-run after project data changes while retaining user narrative.
- Preserve vital missing evidence as an explicit **Insufficient Data** block.

## Dependencies

- LandDraft project store and project-version history.
- Existing GIS layer/source metadata.
- `@turf/turf` for client-side geometry measurements and intersections.
- Existing elevation/buildable analysis artifacts.
- Browser print/PDF for the foundation export.
- Official public services currently include USGS Annual NLCD land cover, USDA-NRCS SSURGO soils and FEMA National Risk Index, plus the existing LandDraft hydrography, wetlands, flood, environmental, road and energy catalog.

## Potential operating costs

The current module uses public government services, local analysis and browser printing and has no new paid provider requirement. Provider rate limits and availability still apply. Commercial imagery/parcels/hazards, object storage, server-side PDF rendering and optional AI narrative may later introduce licensing, request, compute or storage costs. Pricing is intentionally undecided.

## Safety and interpretation

Study Area Report is screening and documentation software. A mapped inventory or derived value is not a survey, title opinion, jurisdictional determination, environmental site assessment, engineering design or regulatory approval. Each section must retain source, date, coverage and limitation context.
