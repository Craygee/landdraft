# Infrastructure public data — 2026-10-20

The shipped catalog imports `infrastructureCatalog.ts`; these are defaults for all new users, not account-only saved services. Existing catalog entries, account removal/reconnect behavior and attribute-filter imports remain intact. Communications is a new category; search “fiber”, “substation” or “data center”.

## Ready-to-add map connections

- Texas substations: independently hosted public-use HIFLD archive, item `83397b209bfb4007a2f4c00e70df8e5d`, publisher chadbraden. Query is constrained to `STATE = 'TX'`. Live query returned 5,196 Texas records; a GeoJSON sample included a 2016 SOURCEDATE. This is an archive, not an authoritative current utility feed or capacity assessment. Item terms state “None (Public Use)”; retain provenance and inspect per-feature dates.
- Round Rock municipal fiber ring and conduit: City public view services, items `999003bd039b4586924820e93f667cfd` and `0626473a85394bb89abd559f09421485`. City describes these as public-use views and disclaims accuracy/suitability. Coverage is local, not statewide; no enterprise access or spare capacity is implied.
- USGS The National Map: local roads (transportation/32), runway polygons (transportation/28), trails (transportation/37), hospitals (structures/49), fire/EMS stations (structures/51). USGS service metadata describes public-domain downloads. Existing cemetery, terrain, hydrography, wetlands and floodplain entries remain in their existing categories.

Every new connected service returned a GeoJSON FeatureCollection with a feature from a real query (`outSR=4326`). Metadata geometry types matched registrations. All use viewport queries and minimum zoom limits. No statewide bulk import is triggered. This verifies service connectivity, not a physical-device UI session or every feature's accuracy.

## Explicit references, not unrestricted imports

- User-requested PUCT `COOP_DIST/FeatureServer/310`: responds publicly, but item `8bd7d46e88354017a8cbb6af96c65d0c` restricts use to individuals covered by a Platts Master Service Agreement. Added as a source-only entry with the exact requested URL. No automatic query/download is configured. Boundaries are described by the publisher as unofficial. Commercial permission must be resolved before enabling import.
- Texas BDO broadband/BEAD maps: official maps page says underlying data are proprietary and cannot be downloaded due to FCC restrictions. Added as an official source reference, not a purported open coverage API. Availability polygons would not identify physical fiber routes in any event.

Sources checked: ArcGIS item metadata and REST service metadata/query endpoints linked in each catalog entry; https://comptroller.texas.gov/programs/broadband/outreach/maps/ .

## Regression checks

Tests verify unique shipped IDs, preservation of representative existing layers, visibility to new accounts, Texas geographic scope, Communications searches, bounded live connections, archive qualifications and absence of import URLs on restricted references. No existing source was removed or replaced. No deployment is included in this change.
