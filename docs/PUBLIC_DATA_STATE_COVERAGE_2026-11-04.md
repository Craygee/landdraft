# LandDraft public-data state coverage — 2026-11-04

## Shipped behavior

- A project can select one or more states. State-specific catalog entries are shown only when at least one of their states is selected; nationwide entries remain visible.
- State-specific entries carry an inactive future entitlement key such as `data.state.TX`. This is metadata only and does not add a paywall or change core mapping access.
- Remote layers are viewport- and zoom-bounded. LandDraft does not download a full national or statewide high-density service into the browser.
- Once a public layer is added to a project, it remains a normal saved project layer. Changing the catalog state filter does not delete it.

## National foundation available in every state

| Theme                   | Source                        | Coverage / notes                                                                                                                                                                                                       |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| States and counties     | U.S. Census Bureau TIGERweb   | Current nationwide state/county service; public federal data.                                                                                                                                                          |
| Incorporated places     | U.S. Census Bureau TIGERweb   | Current incorporated-place boundaries.                                                                                                                                                                                 |
| Primary and local roads | U.S. Census Bureau TIGERweb   | Separate regional and detailed viewport layers.                                                                                                                                                                        |
| Census tracts           | U.S. Census Bureau TIGERweb   | 2020 tracts.                                                                                                                                                                                                           |
| Opportunity Zones       | HUD / Treasury ArcGIS service | OZ 1.0 designations; verify eligibility against Treasury/IRS records.                                                                                                                                                  |
| Transmission lines      | EIA/HIFLD public service      | Nationwide screening layer; voltage classes receive a consistent LandDraft palette and dashed lines.                                                                                                                   |
| Electric power plants   | U.S. EIA live feature service | Nationwide plant, utility, technology, primary-fuel and capacity attributes. A separate LandDraft view screens combustion-turbine/internal-combustion peaker candidates and labels the classification as non-official. |
| Natural-gas pipelines   | EIA public service            | Nationwide generalized interstate/intrastate/gathering layer; type colors are consistent. NPMS remains the authoritative controlled-access source where applicable.                                                    |
| Wind turbines           | USGS / LBNL                   | Nationwide utility-scale turbine database with a wind-turbine symbol.                                                                                                                                                  |
| Solar facilities        | USGS / LBNL                   | Nationwide large-scale photovoltaic facilities.                                                                                                                                                                        |
| Hydrography             | USGS                          | National flowlines plus existing water/wetland catalog sources.                                                                                                                                                        |

Official service directories checked:

- <https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_restmapservice.html>
- <https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0>
- <https://services2.arcgis.com/FiaPA4ga0iQKduv3/ArcGIS/rest/services/Power_Plants_in_the_US/FeatureServer/0>
- <https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0>

## Texas plant layers added 2026-11-05

- **Texas Natural-Gas Power Plants — EIA** uses the national EIA plant service with the publisher-side filter `State = 'Texas' AND PrimSource = 'natural gas'`. It returned 301 records during release validation.
- **Texas Natural Gas Processing Plants — HIFLD Archive** is a live independently hosted public ArcGIS copy containing 209 Texas points. The item credits HIFLD/ORNL/ANL/NGA source data and was republished in May 2024, but it is not a current Railroad Commission facility feed. LandDraft exposes `SOURCEDATE`, `VAL_DATE`, status, operator and positional-reliability fields and tells users to confirm current facilities against RRC records.
- The RRC R-3 monthly JSON reporting program remains the current official plant-report source, but it is a monthly ZIP/report dataset rather than a ready-to-map live geometry API. LandDraft does not mislabel those reports as a direct GIS layer.

The public-data drawer now leaves account-connected services at the bottom of the ready-to-add library. **My account services** in the filter row brings only those private account services forward. Account URLs, every-map preferences, removals and health history remain private to the signed-in account.

## State parcel services enabled in this increment

| State         | Source                                                   | Status                                                                                           |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Texas         | TxGIO 2025 CC0 collection served by LandDraft            | Active; 253 counties, with the known Donley County gap disclosed.                                |
| Florida       | Florida DOR / Florida GIO statewide cadastral service    | Active at detailed zoom; annual statewide compilation from 67 county appraisers.                 |
| Connecticut   | Connecticut GIS Office statewide Parcel/CAMA service     | Active at detailed zoom; municipal suppression/completeness varies.                              |
| Ohio          | Ohio OGRIP statewide public parcel view                  | Active at detailed zoom; state AS-IS disclaimer applies.                                         |
| West Virginia | WV County Assessors / WV Property Tax Division / WVGISTC | Active at detailed zoom; Tax Year 2023 public service, with county-record verification required. |

Parcel programs differ materially by state. There is no single authoritative, unrestricted federal parcel layer. Local assessors are normally the stewards, and statewide programs vary in completeness, fields, update cadence, download rights, and privacy redactions. LandDraft must validate an official service and its terms before turning it into a shipped live layer. A viewer alone is not treated as a reusable dataset.

Official parcel references checked:

- Texas: <https://geographic.texas.gov/stratmap/land-parcels>
- Florida: <https://geodata.floridagio.gov/>
- Connecticut: <https://portal.ct.gov/datapolicy/gis-office/parcel-and-cama>
- Ohio: <https://www.arcgis.com/home/item.html?id=26ab5fad8d5d4258a7492a14de83bc0e>
- West Virginia: <https://www.mapwv.gov/parcel/>
- New Jersey statewide downloads/reference: <https://www.nj.gov/njgin/edata/parcels/>

## West Virginia energy and infrastructure added 2026-11-05

LandDraft now ships viewport-bounded connections to the following official West Virginia
services:

- **West Virginia Land Parcels — Statewide** from the WV GIS Technical Center service credited
  to county assessors, the WV Property Tax Division and state partners. The service reports about
  1.39 million parcels and identifies its current edition as Tax Year 2023. It is public AS-IS
  screening data, not a survey, title record or substitute for county deeds and plats.
- **WVDEP Oil & Gas Wells** (all DEP wells), with permit/API, well type/use, depth, responsible
  party, status, formation and record-date attributes. The live count check returned about
  154,000 records.
- **WVDEP Horizontal Well Laterals**, with simplified mapped lateral geometry and related permit
  attributes. Simplified paths are not represented as surveyed as-builts.
- **WVDEP Oil & Gas Well Pads**, with mapped pad footprints and site/image-year fields where
  available.
- **WVDEP Gas Pipeline Construction Areas**, with construction/workspace, route, company and
  permit context. This layer is deliberately described as construction context, not a complete
  operating transmission/gathering-pipeline inventory.

Two West Virginia templates reuse those state services together with the existing national EIA
transmission, natural-gas pipeline, power-plant and peaker-candidate connections, plus USGS/LBNL
wind and solar data. Reusing catalog references prevents separate copies of the same national
records from being created merely to label them West Virginia.

Official services checked:

- <https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0>
- <https://tagis.dep.wv.gov/arcgis/rest/services/WVDEP_enterprise/oil_gas/MapServer>
- <https://tagis.dep.wv.gov/arcgis/rest/services/app_services/pipeline_construction_main_wm/MapServer/0>
- <https://dep.wv.gov/oil-and-gas/Pages/default.aspx>

Each service returned browser CORS permission for `landdraft.net`, supports bounded pagination and
responded to live count queries. WVDEP does not advertise an item-specific open-data license on
these REST layers, so the catalog retains agency attribution, the source link and a qualification
to verify permit/status information rather than treating public query access as an engineering or
title guarantee.

## Requested Texas cooperative and IOU territories

The two requested PUCT-hosted ArcGIS services are included in the Texas Energy catalog as source references, but not as automatic live commercial layers:

- `COOP_DIST/FeatureServer/310`
- `IOU/FeatureServer/300`

Both services describe the boundaries as **unofficial** and identify Platts as the original source. The COOP item terms previously exposed by the publisher limit use to parties identified in a Platts Master Service Agreement; the IOU item does not establish unrestricted commercial reuse. Public query access is not the same as permission to redistribute or embed the data in a commercial product. LandDraft therefore links to the sources and records the limitation without proxying, copying, or silently enabling the geometry. They can be enabled later after documented permission or an unrestricted official replacement is obtained.

## Next state expansion criteria

For each state, add a live parcel or infrastructure layer only after recording:

1. official publisher and steward;
2. exact layer endpoint and geometry type;
3. geographic completeness and known gaps;
4. update cadence/data vintage;
5. public/commercial reuse terms and attribution;
6. privacy-sensitive or suppressed fields;
7. tested viewport query behavior and record limits;
8. a non-survey/non-engineering disclaimer where appropriate.

Priority parcel candidates for the next verified batch include New Jersey, Indiana, North Carolina, Wisconsin, Arkansas, Mississippi, Montana and North Dakota. Each needs endpoint and terms verification rather than bulk-adding search results.

## Operating-cost notes

- Census, EIA, USGS and state ArcGIS services used here do not currently require LandDraft API credentials, but publisher availability and rate limits are external dependencies.
- Browser viewport queries have no direct LandDraft provider fee today. They do create bandwidth, support and reliability costs.
- A future hosted parcel cache or state entitlement product would add object storage, ingestion, change detection, CDN, database and support costs. Pricing remains undecided.
