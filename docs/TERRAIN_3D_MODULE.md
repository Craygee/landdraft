# LandDraft Terrain & Site Context 3D

Status: optional foundation module, version 0.1.1 (2026-11-04).

## Purpose

Terrain & Site Context 3D turns a deliberately bounded map area into an interactive perspective
view. It keeps three different things separate:

1. the visual elevation surface used for smooth browser rendering;
2. the numeric elevation grid used for analysis; and
3. contextual overlays such as mapped wetlands and visible project/public layers.

It is preliminary visualization and screening. It is not a survey, grading model, wetland
determination, jurisdictional delineation, drainage design, geotechnical study or engineering
certification.

## Initial capabilities

- select the current viewport or draw a two-corner rectangular study area;
- enforce a 100 km² quick-analysis limit and a 4 km² detailed-analysis limit;
- render an orbitable/tiltable 3D terrain surface with touch, mouse and navigation controls;
- open at zoom level 11 around the active project location with a one-click camera reset;
- retain an OpenStreetMap reference beneath USGS topographic or imagery surface tiles;
- switch between a USGS topographic reference surface and attributed global imagery;
- adjust vertical exaggeration without changing the stored numeric elevations;
- request a bounded USGS 3DEP bare-earth numeric grid through LandDraft's existing server proxy;
- quick analysis requests a 40 m target cell; detailed analysis requests a 10 m target cell;
- report the actual output spacing, missing cells, coverage, minimum, maximum, mean and relief;
- load mapped National Wetlands Inventory polygons for the study area when available;
- display existing visible LandDraft project/public features in the same perspective view;
- inspect the rendered terrain elevation under the pointer; and
- expose timestamps, source links and limitations.

The terrain request planner may coarsen output up to 60 m to remain inside the existing 256×256
numeric-grid safety budget. The interface reports the actual spacing. Missing DEM values remain
missing and mapped wetland absence never becomes a claim that wetlands are absent.

If the USGS numeric service is temporarily unavailable, Quick analysis may show a separately
labeled approximate sample from the loaded display mesh. Detailed analysis never substitutes that
lower-assurance estimate for the USGS numeric grid.

## Sources and licenses

| Purpose           | Source                                                                                                                       | Use and limitation                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric analysis  | [USGS 3DEP Bare Earth DEM dynamic service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) | U.S. federal public data. Best-available source resolution and vertical datum vary. Interpolated or gridded elevations are not survey control.                                                                      |
| 3D display mesh   | [Terrain Tiles on AWS Open Data](https://registry.opendata.aws/terrain-tiles/) / Mapzen Terrarium                            | Global display surface compiled from multiple open elevation sources. Source-specific attribution applies. It is not the authoritative numeric result; a labeled Quick fallback may sample it during a USGS outage. |
| Topographic color | [USGS Topographic Map](https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer)                              | USGS The National Map and credited contributing sources. Visual reference only.                                                                                                                                     |
| Optional imagery  | Esri World Imagery cached service                                                                                            | Esri and named imagery contributors. Visual context only; dates and resolution vary. No random web images are scraped.                                                                                              |
| Wetlands context  | [USFWS National Wetlands Inventory](https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper)                 | Screening inventory, not a jurisdictional determination. Service gaps or mapped absence do not prove absence.                                                                                                       |

USGS documents 3DEP DEM and contour products through The National Map and states that point-query
elevations are interpolated and not precisely surveyed values. MapLibre supports Terrarium and
Terrain-RGB raster DEM sources for browser terrain rendering.

## Architecture

`/terrain-3d` is a lazy-loaded specialist route using the normal authenticated LandDraft project
store. It has no database migration and does not alter project geometry. The component creates a
separate MapLibre view so 3D camera state, selected study bounds and temporary analysis results do
not disturb the main project map.

The module uses:

- `terrain3d.ts` for source constants, area budgets, bounded study input and numeric summaries;
- the existing `/api/analysis/buildable-terrain` proxy for validated USGS grids;
- the existing ArcGIS paged-query client for viewport-bounded wetland features; and
- existing project layer data as read-only context.

The module is linked from LandDraft Tools. Access currently follows `mapping.core`; a future
`terrain.3d` entitlement can be added without changing the analysis contract. Pricing is undecided.

## Provider and operating-cost considerations

- Current USGS, USFWS and AWS terrain sources are keyless public services; no per-request price is
  configured in LandDraft.
- Esri imagery is used under its service attribution/usage terms. Heavy or offline use may require a
  separately licensed imagery provider or self-hosted cache.
- Production usage should be monitored by provider, endpoint, response bytes, cache hit and study
  mode before any commercial tier is set.
- Detailed grids and wetland queries are bounded to control upstream load and browser memory.
- A future organization may configure a commercial DEM/imagery adapter, but credentials must stay
  server-side and provider output must retain provenance.

## Known limitations and next phase

- The real-time Terrarium display mesh and the USGS numeric analysis grid are different products;
  small visual and numeric differences are expected and are labeled.
- Buildings, trees and subsurface conditions are not reconstructed from generic imagery.
- Wetland polygons are draped as context; they are not converted into hydrologic simulations.
- Current visible project features are displayed with simplified 3D-workspace symbology.
- Analysis results are session results in this first increment; saved named studies, snapshots,
  exports and print integration are the next persistence phase.
- Future deeper analysis can add slope/aspect surfaces, drainage, cut/fill, land-cover adapters,
  higher-resolution licensed DEMs, model exports and reproducible study records.
