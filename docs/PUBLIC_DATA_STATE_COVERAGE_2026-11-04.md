# LandDraft public-data state coverage — 2026-11-04

## Shipped behavior

- A project can select one or more states. State-specific catalog entries are shown only when at least one of their states is selected; nationwide entries remain visible.
- State-specific entries carry an inactive future entitlement key such as `data.state.TX`. This is metadata only and does not add a paywall or change core mapping access.
- Remote layers are viewport- and zoom-bounded. LandDraft does not download a full national or statewide high-density service into the browser.
- Once a public layer is added to a project, it remains a normal saved project layer. Changing the catalog state filter does not delete it.

## National foundation available in every state

| Theme                   | Source                        | Coverage / notes                                                                                                                                                    |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| States and counties     | U.S. Census Bureau TIGERweb   | Current nationwide state/county service; public federal data.                                                                                                       |
| Incorporated places     | U.S. Census Bureau TIGERweb   | Current incorporated-place boundaries.                                                                                                                              |
| Primary and local roads | U.S. Census Bureau TIGERweb   | Separate regional and detailed viewport layers.                                                                                                                     |
| Census tracts           | U.S. Census Bureau TIGERweb   | 2020 tracts.                                                                                                                                                        |
| Opportunity Zones       | HUD / Treasury ArcGIS service | OZ 1.0 designations; verify eligibility against Treasury/IRS records.                                                                                               |
| Transmission lines      | EIA/HIFLD public service      | Nationwide screening layer; voltage classes receive a consistent LandDraft palette and dashed lines.                                                                |
| Natural-gas pipelines   | EIA public service            | Nationwide generalized interstate/intrastate/gathering layer; type colors are consistent. NPMS remains the authoritative controlled-access source where applicable. |
| Wind turbines           | USGS / LBNL                   | Nationwide utility-scale turbine database with a wind-turbine symbol.                                                                                               |
| Solar facilities        | USGS / LBNL                   | Nationwide large-scale photovoltaic facilities.                                                                                                                     |
| Hydrography             | USGS                          | National flowlines plus existing water/wetland catalog sources.                                                                                                     |

Official service directories checked:

- <https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_restmapservice.html>
- <https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0>
- <https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0>

## State parcel services enabled in this increment

| State       | Source                                                | Status                                                                           |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Texas       | TxGIO 2025 CC0 collection served by LandDraft         | Active; 253 counties, with the known Donley County gap disclosed.                |
| Florida     | Florida DOR / Florida GIO statewide cadastral service | Active at detailed zoom; annual statewide compilation from 67 county appraisers. |
| Connecticut | Connecticut GIS Office statewide Parcel/CAMA service  | Active at detailed zoom; municipal suppression/completeness varies.              |
| Ohio        | Ohio OGRIP statewide public parcel view               | Active at detailed zoom; state AS-IS disclaimer applies.                         |

Parcel programs differ materially by state. There is no single authoritative, unrestricted federal parcel layer. Local assessors are normally the stewards, and statewide programs vary in completeness, fields, update cadence, download rights, and privacy redactions. LandDraft must validate an official service and its terms before turning it into a shipped live layer. A viewer alone is not treated as a reusable dataset.

Official parcel references checked:

- Texas: <https://geographic.texas.gov/stratmap/land-parcels>
- Florida: <https://geodata.floridagio.gov/>
- Connecticut: <https://portal.ct.gov/datapolicy/gis-office/parcel-and-cama>
- Ohio: <https://www.arcgis.com/home/item.html?id=26ab5fad8d5d4258a7492a14de83bc0e>
- New Jersey statewide downloads/reference: <https://www.nj.gov/njgin/edata/parcels/>

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

Priority parcel candidates for the next verified batch include New Jersey, Indiana, North Carolina, Wisconsin, Arkansas, Mississippi, Montana, West Virginia and North Dakota. Each needs endpoint and terms verification rather than bulk-adding search results.

## Operating-cost notes

- Census, EIA, USGS and state ArcGIS services used here do not currently require LandDraft API credentials, but publisher availability and rate limits are external dependencies.
- Browser viewport queries have no direct LandDraft provider fee today. They do create bandwidth, support and reliability costs.
- A future hosted parcel cache or state entitlement product would add object storage, ingestion, change detection, CDN, database and support costs. Pricing remains undecided.
