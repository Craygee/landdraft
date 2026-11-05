# Study Area Report research

Status: foundation research for the optional LandDraft Study Area Report module.

## Reference report review

The user-provided 21-page land summary was reviewed as a structural reference. It uses a branded cover, contents page, summary metrics, valuation and risk-style indices, property and land characteristics, terrain, vegetation, soils, development suitability, renewable-energy opportunity, infrastructure, environmental records, wells and storage-tank records. LandDraft will not reproduce proprietary scores, wording, visual identity or unpublished methods. The useful pattern is a source-attributed, map-heavy report assembled around one defined geography.

LandDraft's implementation uses three evidence states:

- **Observed**: a value or geometry exists in a user layer or attributed public-data layer.
- **Derived**: LandDraft calculates a value from identified observed inputs and records the method.
- **Insufficient data**: the expected evidence is absent, inaccessible or unsuitable for the requested analysis. The report preserves an editable gap instead of inventing a value.

## Public-data candidates

These are evidence providers reviewed for the report workflow. “Connected” means LandDraft ships a usable catalog connection; other rows remain documented candidates. Each integration retains source, coverage, limitations and attribution.

| Topic                                | Preferred public source                                                                   | Use                                                             | Important limitation                                                                        | Access/cost                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Elevation and terrain                | USGS 3D Elevation Program (3DEP), Elevation Point Query Service and National Map services | elevation profiles, relief, slope screening and terrain figures | interpolated terrain is not a boundary, design or construction survey                       | public; 3DEP is free and without use restrictions                |
| Surface water and watersheds         | USGS 3D Hydrography Program, NHDPlus HR and Watershed Boundary Dataset                    | streams, waterbodies, drainage context and watersheds           | legacy NHD is retired from maintenance; prefer current 3DHP/NHDPlus products when available | public map/download services                                     |
| Wetlands                             | U.S. Fish & Wildlife Service National Wetlands Inventory                                  | mapped wetland and riparian context                             | inventory mapping is not a jurisdictional wetland determination                             | public REST/WMS/download                                         |
| Flood hazards                        | FEMA National Flood Hazard Layer                                                          | effective flood-hazard context and mapped zones                 | coverage and map effective dates vary; not a substitute for a site-specific flood study     | public GIS services                                              |
| Soils                                | USDA-NRCS SSURGO / `cg_soils` FeatureServer                                               | connected national map-unit polygons and planning attributes    | scale, map-unit composition and NOTCOM gaps require careful reporting                       | public FeatureServer; connected                                  |
| Land cover                           | USGS/MRLC Annual NLCD                                                                     | connected 2025 land-cover map context                           | modeled 30 m classification; CONUS coverage; not parcel-scale verification                  | public WMS; connected                                            |
| Environmental facilities             | EPA Facility Registry Service, Envirofacts and ECHO                                       | facility and regulated-program context                          | a listed facility is not proof of contamination or liability                                | public APIs, services and downloads                              |
| Boundaries, roads and hydrography    | U.S. Census Bureau TIGER/Line and TIGERweb                                                | administrative context, roads and selected physical features    | not a parcel or engineering road survey                                                     | public downloads and REST/WMS                                    |
| Energy infrastructure and statistics | U.S. Energy Information Administration Energy Atlas and Open Data                         | energy context, plants, systems and time-series statistics      | product coverage and update cadence vary; some APIs require a free key                      | public; API registration may be required                         |
| Solar resource                       | National Renewable Energy Laboratory solar resource datasets / NSRDB                      | regional solar-resource context                                 | resource potential is not a project yield or feasibility guarantee                          | public maps/downloads; some services require keys or have quotas |
| Weather and climate                  | NOAA/NCEI Climate Normals and web services                                                | climate context and long-term normals                           | normals are not a site-specific forecast                                                    | public; some APIs require a token                                |
| Natural-hazard screening             | FEMA National Risk Index Census Tracts                                                    | connected composite and 18-hazard screening context             | census-tract planning index; not a parcel-specific probability or regulatory determination  | public FeatureServer; connected                                  |

## Official references

- USGS 3DEP: https://www.usgs.gov/3d-elevation-program
- USGS elevation accuracy note: https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map
- USGS hydrography access: https://www.usgs.gov/national-hydrography/access-national-hydrography-products
- USDA-NRCS SSURGO: https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo
- U.S. Fish & Wildlife Service wetlands services: https://www.fws.gov/rivers/carp/carp/program/national-wetlands-inventory/web-mapping-services
- FEMA Flood Map Service Center / NFHL: https://msc.fema.gov/
- EPA FRS data options: https://www.epa.gov/frs/frs-data-download-options
- Census TIGER data guide: https://www.census.gov/programs-surveys/geography/guidance/tiger-data-products-guide.html
- MRLC data services: https://www.mrlc.gov/data-services-page
- USGS Annual NLCD access: https://www.usgs.gov/centers/eros/science/annual-nlcd-data-access
- NRCS national SSURGO FeatureServer: https://apps.geo.fpac.usda.gov/nrcs-geodata/rest/services/soils/cg_soils/FeatureServer/0
- FEMA National Risk Index: https://www.fema.gov/flood-maps/products-tools/national-risk-index
- FEMA National Risk Index FeatureServer: https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0
- EIA Energy Atlas: https://atlas.eia.gov/
- NOAA/NCEI web services: https://www.ncei.noaa.gov/cdo-web/webservices
- NREL solar resource maps: https://www.nrel.gov/gis/solar-resource-maps

## Product principles

1. Never turn absence of data into a favorable result.
2. Show observed, derived and user-entered content separately.
3. Preserve a source ledger for every generated section.
4. Keep public-data publication dates and retrieval dates where available.
5. Use warnings appropriate to the source: screening, inventory, modeled estimate or official designation.
6. Permit a user to edit narrative without rewriting the underlying observed evidence.
7. Re-running analysis updates generated content but retains user-authored additions.
8. The report now refreshes active viewport services directly for the selected boundary with a 5,000-feature-per-layer screening cap. Provider failures and truncation remain visible; high-volume server-side acquisition is still a later phase.

## Dependencies and potential operating costs

- Client-side geometry analysis: existing `@turf/turf`; no incremental service cost.
- Printable report preview: browser print/PDF; no incremental service cost.
- Public GIS services: generally no direct fee, but usage policies, rate limits, attribution and service reliability apply.
- High-resolution imagery, parcel records, commercial hazard data, document conversion, server-side map rendering and AI-assisted narrative could incur per-request, storage or licensing costs. They are intentionally not enabled by this foundation.
- Pricing and subscription packaging remain undecided. Capability hooks are included without activating a restrictive paywall.
