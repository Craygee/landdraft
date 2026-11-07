# Study Area Report: public data sources

Verified 2026-11-05 with small read-only queries against a Texas test area (Caldwell County), a
West Virginia test area (Monongalia County) and an Atlantic point outside all coverage. Each live
layer below returned GeoJSON in WGS84, answered paged queries, gave an empty result (not an error)
outside coverage, and allowed browser requests from `landdraft.net`.

Reuse terms were read from each service's published metadata. This is not legal advice. Where it
says "no license advertised", the publisher states no terms either way; see the review list at the
end before relying on those sources commercially.

## Added: national

| Catalog ID                                | Publisher            | Endpoint                                                                                          | What it can establish                                            | Cannot establish                                             |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `padus-fee-managers`                      | USGS GAP, PAD-US 4.1 | `services.arcgis.com/v01gqwM5QqNysAAi/.../Fee_Managers_PADUS/FeatureServer/0`                     | Reported public and private protected land, manager, designation | Legal boundary, absence of protection                        |
| `padus-easements`                         | USGS GAP, PAD-US 4.1 | `.../Protection_Mechanism_Category_PADUS/FeatureServer/0`, `FeatClass='Easement'`                 | Reported conservation easements                                  | Terms, width, clear title (reporting is voluntary)           |
| `usgs-state-geologic-map`                 | USGS SGMC v1.1       | `energy.usgs.gov/.../State_Geological_Map_Compilation/FeatureServer/1`                            | Regional lithology and age                                       | Foundation or geotechnical conditions                        |
| `usgs-quaternary-faults`                  | USGS                 | `earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/21`                               | Mapped Quaternary faults, slip, age                              | Low hazard where empty; limited eastern coverage             |
| `usgs-landslide-inventory`                | USGS                 | `.../US_Landslide_point_v2/FeatureServer/11`                                                      | Reported landslides, confidence                                  | Stability where empty                                        |
| `usgs-principal-aquifers`                 | USGS                 | `.../Principle_aquifers_us/FeatureServer/0`                                                       | Regional aquifer                                                 | Depth, yield, quality, rights                                |
| `bts-rail-network`                        | BTS / FRA            | `services.arcgis.com/xOi1kZaI0eWDREZv/.../NTAD_North_American_Rail_Network_Lines/FeatureServer/0` | Rail lines, owner, trackage rights                               | Spur feasibility or service                                  |
| `fws-critical-habitat`                    | USFWS                | `services.arcgis.com/QVENGdaPbd4LUkLV/.../USFWS_Critical_Habitat/FeatureServer/0`                 | Final critical habitat                                           | Legal boundary (Federal Register controls); species presence |
| `nps-nrhp-points`, `nps-nrhp-polygons`    | NPS                  | `mapservices.nps.gov/.../nrhp_locations/MapServer/0`, `/1`                                        | Listed National Register properties                              | Cultural-resource clearance                                  |
| `epa-water-system-boundaries`             | EPA                  | `services.arcgis.com/cJ9YHowT8TU7DUyn/.../Water_System_Boundaries/FeatureServer/0`                | Likely community water system (many boundaries are modeled)      | Capacity or connection right                                 |
| `epa-ust-facilities`, `epa-lust-releases` | EPA / ASTSWMO        | `.../UST_Finder_Feature_Layer_2/FeatureServer/0`, `/1`                                            | Reported tanks and releases, 2018–2021                           | Current status or plume extent                               |

Map images, shown for context and never measured:

| Catalog ID                                   | Endpoint                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `usgs-imagery`                               | `basemap.nationalmap.gov/.../USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`      |
| `usgs-3dep-hillshade`, `usgs-3dep-slope-map` | `elevation.nationalmap.gov/.../3DEPElevation/ImageServer/exportImage`         |
| `wv-landslide-susceptibility`                | `services.wvgis.wvu.edu/.../Landslide_Hazard_Susceptibility/MapServer/export` |

## Added: Texas

| Catalog ID                                                                                                                                                                                     | Publisher           | Endpoint                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tx-rrc-well-locations`, `tx-rrc-orphan-wells`                                                                                                                                                 | Railroad Commission | `gis.rrc.texas.gov/.../RRC_Public_Viewer_Srvs/MapServer/1`, `/2`                                                                                                  |
| `tx-twdb-well-reports`                                                                                                                                                                         | TWDB / TDLR         | `services.twdb.texas.gov/.../Public/WellReports/FeatureServer/0`                                                                                                  |
| `tx-puc-water-ccn`, `tx-puc-sewer-ccn`                                                                                                                                                         | PUCT                | `services6.arcgis.com/N6Lzvtb46cpxThhu/.../Water_CCN_Service_Areas/FeatureServer/210`, `Sewer_CCN_Service_Areas/FeatureServer/230`                                |
| `tx-tceq-lpst`, `-pst`, `-superfund`, `-vcp`, `-brownfields`, `-ihw-corrective-action`, `-landfills`, `-wastewater-outfalls`, `-groundwater-districts`, `-water-districts`, `-edwards-aquifer` | TCEQ                | `gisweb.tceq.texas.gov/arcgis/rest/services/Public/{LPST,PST,Superfund,VCP,Brownfield,IHWCA,Landfills,WW_oufalls,GCDs,WaterDistricts,EdwardsAquifer}/MapServer/0` |
| `tx-austin-zoning`                                                                                                                                                                             | City of Austin      | `services.arcgis.com/0L95CJ0VTaxqcmED/.../PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer/0`                                                                |

Notes:

- The TWDB service fails on `outFields=*` and on `DateOfWellCompletion`, so `CatalogEntry.outFields`
  was added and the catalog requests a working list. Owner names and addresses are deliberately not
  requested. Completion dates are therefore absent; the numbered report has them.
- TCEQ answers bursts with HTTP 503 `User couldn't access this resource`. Requests are limited to two
  per server, and retried.

## Added: West Virginia

| Catalog ID                                                                           | Publisher       | Endpoint                                                                                                                              |
| ------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `wv-landslide-lidar-points`, `wv-landslide-incidents`                                | WVGISTC         | `services.wvgis.wvu.edu/.../Hazards/Landslide_Lidar_Identified_Points/MapServer/0`, `Landslide_Historical_Data_Inventory/MapServer/0` |
| `wv-aml-points`, `-lines`, `-polygons`                                               | WVDEP           | `tagis.dep.wv.gov/.../WVDEP_enterprise/abandoned_mine_lands/MapServer/1`, `/2`, `/3`                                                  |
| `wv-mining-permits`, `wv-underground-mining-limits`                                  | WVDEP           | `.../mining_reclamation/MapServer/9`, `/10`                                                                                           |
| `wv-land-use-covenants`, `wv-voluntary-remediation`, `wv-sems-sites`                 | WVDEP           | `.../environmental_remediation/MapServer/1`, `/2`, `/14`                                                                              |
| `wv-dams`, `wv-dam-inundation`                                                       | WVDEP           | `.../dam_safety/MapServer/0`, `/2`                                                                                                    |
| `wv-impaired-streams`                                                                | WVDEP           | `.../watershed_assessment/MapServer/22`                                                                                               |
| `wv-water-lines`, `wv-sewer-lines`, `wv-water-served-areas`, `wv-sewer-served-areas` | WVWDA / IJDC    | `services.wvgis.wvu.edu/.../WV_WaterSewer_WVWDA/MapServer/2`, `/3`, `/4`, `/5`                                                        |
| `wv-shpo-national-register-points`, `-polygons`                                      | WV SHPO         | `.../Society/wv_SHPO_public/MapServer/1`, `/4`                                                                                        |
| `wv-building-footprints`                                                             | WVGISTC         | `.../Structure/BuildingFootprints_WVGISTC/MapServer/0`                                                                                |
| `wv-geology-1968`                                                                    | WVGES / WVGISTC | `.../Geoscientific_Information/WV_Geology/MapServer/0`                                                                                |

Templates added: **Texas land study** and **West Virginia land study**. The national screening
template now also includes PAD-US, geology, aquifers, critical habitat, National Register, leaking
tanks, rail, gas pipelines, water systems, landslides and faults.

## Measured values

| Value               | How                                                                                                                                                                        | Basis                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Elevation and slope | Numeric 3DEP grid through the existing `/api/analysis/buildable-terrain` endpoint. Grade uses `gradePercentAt`, now shared with Buildable Area so the two cannot disagree. | Cells inside the polygon, holes excluded                      |
| Land cover          | Annual NLCD point query (`GetFeatureInfo`, returns the class code). Confirmed against open water, forest, cropland and urban locations.                                    | Share of up to about 49 sample points. Acres are not reported |

Map images are never used for measurement.

## Not connected, and why

| Need                                              | Finding                                                                                                                                                                                      | What to do instead                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nationwide buildings                              | FEMA/ORNL USA Structures (CC BY 4.0) timed out on very small queries, so an Add button would not work reliably.                                                                              | ORNL/FEMA download, imported per project. WV footprints are connected.                       |
| Nationwide parcels, zoning                        | No free official national source. Statewide zoning does not exist in TX or WV.                                                                                                               | Connect per county or city as studies need them. Austin is connected as the pattern.         |
| Recorded boundaries, deeds, plats                 | County records; no public statewide service found.                                                                                                                                           | County clerk. Survey and title.                                                              |
| National substations, retail electric territories | HIFLD Open was deactivated 2025-08-26 per DataLumos, and the two service addresses tried no longer answer. Copies are third-party, and license terms vary. The existing Texas archive stays. | DataLumos archive of HIFLD, as an imported snapshot, after reviewing terms. Ask the utility. |
| Texas electric service areas                      | Existing references stay restricted: Platts-sourced, commercial reuse not established.                                                                                                       | PUCT filings and viewer.                                                                     |
| Pipelines by commodity and status, nationally     | No public query service was found for NPMS in this pass; its terms still need reading.                                                                                                       | NPMS viewer, operator records and 811. Texas RRC and WVDOT are connected.                    |
| Fiber and broadband                               | FCC and Texas state coverage data is proprietary or restricted. Only Round Rock municipal fiber is public.                                                                                   | FCC National Broadband Map viewer. Ask carriers.                                             |
| Karst (Texas)                                     | The TPWD layer rejects paged queries, which the adapter requires.                                                                                                                            | USGS Open-File Report 2014-1156 download, imported.                                          |
| WV well logs and yields                           | No public well-log service found.                                                                                                                                                            | Ask the WV DEP or WV Geological Survey which records exist.                                  |
| Texas well-report dates                           | That field breaks the TWDB service.                                                                                                                                                          | Open the numbered report.                                                                    |
| Seismic design values                             | USGS design tools answer per site and require engineering inputs.                                                                                                                            | Existing reference link; licensed engineer.                                                  |
| HUD QCT/DDA                                       | Service name says 2026, item title says 2027 and its description says 2024, so the designation year is unclear.                                                                              | Existing HUD reference link.                                                                 |
| USGS national geologic map v2                     | Newer than SGMC, but its map-unit query timed out under real requests.                                                                                                                       | Retest later; SGMC is connected.                                                             |
| EIA coal mines                                    | Item states Esri Master License Agreement, so reuse is unclear.                                                                                                                              | WVDEP mining layers cover WV.                                                                |
| Landslide polygons (national)                     | Timed out on a one-degree query.                                                                                                                                                             | Points are connected.                                                                        |

## Terms to review before relying on these commercially

These publish no license either way: all WVDEP, WVGISTC, WVWDA/IJDC and SHPO layers, RRC, TWDB,
PUCT and TCEQ. This matches how the catalog already treats WVDEP and WVDOT data. Most are ordinary
public records, but only counsel or the agency can confirm it.
