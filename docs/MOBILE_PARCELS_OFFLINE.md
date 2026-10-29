# Mobile parcel display and offline areas

This enhances the existing map; layer IDs, selection identities, project tools,
field capture, weather/pipeline/water modules and original parcel geometry remain.

## Parcel overview

- The Texas public parcel layer uses full detail at zoom 12+ and starts the size-based overview at zoom 10. Existing default
  cutoffs of 11/12 migrate to 9; custom higher cutoffs and label preferences stay.
- Below zoom 12, the bounded FlatGeobuf spatial query scans at most 12,000 records,
  retains at most 4,000, and omits polygons too small to read at the current scale.
  Above that scale, the existing full-detail viewport loading resumes.
- Overview status distinguishes larger-parcel overview from full detail at zoom 12+. Truncated queries retain the
  existing zoom-in indication; this is not a claim of complete parcel coverage.
- Source polygons and IDs are retained. Screen-area selection changes visibility,
  never parcel boundaries or selected property identities.
- Parcel labels use a dedicated point source. A conservative interior circle is
  calculated against polygon edges and holes, choosing the largest usable part of
  a multipolygon. Wrapped owner text is shown only at a zoom where its padded
  bounding rectangle fits inside that circle. Map-aligned pitch and collision
  prevention remain active. This can intentionally withhold labels in narrow or
  irregular parcels. Advanced size/font/zoom settings remain available.
- This public source remains Texas/TxGIO, with county-edition dates and coverage
  gaps. It does not acquire Land id's nationwide or commercial parcel records.

## Mobile layout

- Selection is in the bottom navigation; selected-item actions dock above it.
- The left Layers visibility control and right Legend remain. There is one legend
  toggle, and opening either quick panel closes the other.
- Draw/measurement selection closes the tool picker. Drawing feedback is above
  bottom navigation, clear of search and the right-hand map controls.
- Connection badges do not intercept taps while mobile panels or drawing tools
  are active; connection details remain available through the existing menus.
- Short-screen layer/legend panels and search results scroll within the viewport.
- Draw, layers, data, AI, export/print, field capture and module links are retained.

## Offline preview

Open **Data → Offline areas**, or **Layers → Offline areas** in field mode. Select
the current map extent before downloading. Downloads are bounded to 600 km²,
0.4° across, 25 MB, 300,000 coordinates and eight saved areas per account/device.
Dense areas require smaller extents. Partial/truncated downloads are rejected;
existing packs stay intact on errors or cancellation.

Packs contain Texas parcel outlines/owner names/IDs and optional public USGS road
geometry. Road classes 29–32 are queried directly from The National Map's public
transportation service. No basemap tile scraping or external bulk tile caching is
performed. No private project content, authentication tokens or live GPS positions
are copied into these packs.

Downloads live in device IndexedDB. Version 2 separates small area metadata from
geometry, so browsing downloads does not deserialize every saved map. Geometry is
read for only the chosen pack. Saves/deletes cover both stores atomically.

Open the saved-area link while online and bookmark it or add the separate offline
viewer to the home screen before travel. `/offline.html` has a narrowly scoped
service worker caching only its static viewer assets. The signed-in GIS app and
cloud APIs are not cached or made anonymously available. The standalone viewer
can reopen without the application server or sign-in network being reachable.

Offline supports pan/zoom, owner/parcel inspection, GPS position and a selected
target's bearing/straight-line distance. It **does not provide turn-by-turn road
routing, access verification, traffic, imagery, live weather or complete property
records**. GPS depends on device hardware and permission. Browser eviction can
remove downloads; verify packs before travel. Public-data downloads remain on
the device until removed. They do not sync between devices.

`OFFLINE_AREA_FEATURE` centralizes preview status and limits. The current preview
does not bill or enforce a premium tier. Before making it paid, integrate a
server-verified download entitlement and a deliberate offline license/expiry and
existing-download policy; do not rely on editable client settings for billing
enforcement. Bump the offline service-worker asset version on viewer releases.

## Verification

- Geometry tests cover scale-based visibility, unchanged IDs/geometry, holes,
  conservative label fit, and the dedicated point-source filter.
- Offline policy tests reject invalid/oversized extents and over-budget geometry.
- A local browser smoke test downloaded 497 real parcels plus 139 roads (about
  0.4 MB), opened the viewer, then reloaded and zoomed it with the local server
  stopped. Target selection and landscape button bounds were checked.
- Browser layout checks covered 320×568, 390×844, 844×390 and 1024×768.
  Navigation targets at 320px were 49×46px; the active drawing controls were
  within the viewport and unobstructed in both phone orientations. Only one
  legend toggle was present, and the landscape legend close button was reachable.
- A real zoom-10 overview query returned 617 parcels in about 2.1 seconds on the
  test connection, without truncation and with stable IDs. This is a sample
  measurement, not a device/network performance guarantee.
- This is browser testing and viewport emulation, not physical iOS airplane-mode,
  GPS permission, installation, or storage-eviction testing. Those remain device
  acceptance checks before broadly promoting offline use.

## Comparison references

- https://support.id.land/parcels-overlay
- https://support.id.land/using-maps-onsite-without-cell-coverage
- https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer

Land id's public documentation describes parcel label visibility and downloaded
parcel lines/owner names. Its private zoom-selection algorithm is not published;
LandDraft's approach above is its own bounded implementation.

## Mobile project and layer notes

Data → Project & layer notes opens the existing project records panel. The composer
can save to the project or a chosen displayed layer; attachments use the corresponding
projectNoteId or layerNoteId linkage. Layer notes retain existing filtering, editing,
map navigation, and file controls. Mobile project selection is available in the panel.
The panel remounts when the mobile project changes, so drafts do not carry into another
project. Mobile note inputs use 16px type to prevent iOS focus zoom.

## Remote layer restore regression

Downloaded remote geometry is stripped by durableLayer when a project is loaded.
Spatial coverage alone must not prevent reloading that geometry. RemoteLayerManager
now scopes query keys to the project, rehydrates cleared layers without a map move,
and only reuses coverage when the last successful load is still represented in
memory. Late failures from aborted requests cannot overwrite the current request.
A successful empty result is still cacheable. Layer settings include Reload visible
area and the downloaded feature count.

Local browser verification used the actual RemoteLayerManager with isolated test
state and the actual parcel rendering specifications. At zoom 12 around Dimmitt,
a 390x844 viewport loaded 3,341 records, with visible parcel outlines and 5 owner
labels. Rendered line counts include tile duplicates and are not unique parcels.
The restore action cleared geometry and triggered a new load without map movement.
This is Chrome viewport testing, not physical iPhone or the user's project testing.

## Mobile parcel diagnostics and connection placement

The mobile map does not render a floating connection badge. Connection details
remain under Data → Connections & source errors and Help → API connections.
Data → Texas parcel display inspects the actual project layers and shows visibility,
downloaded count, load state, saved cutoff, source errors, renderer attachment,
and layer-specific synchronization errors. Show / reconnect restores the canonical
stored parcel endpoint, green boundaries and owner labels, preserves filters and
map extent, and brings an existing project layer to the front. Adding from this
section is explicit when no Texas parcel layer exists.

Map synchronization now attempts each overlay independently and retries failed
overlays after drawing the remaining healthy overlays. Errors are retained in
MapRef context for diagnostics. This addresses a failure mode where an unrelated
bad overlay could stop later layers from synchronizing; it does not establish the
cause of the user's latest blank parcel screenshot. That project still needs its
actual layer status checked. No physical iPhone or user-project verification was
performed for these diagnostics.

## Parcel border and label zoom policy (version 2)

Texas parcel borders start at zoom 10. Default owner labels start at zoom 11 where
their padded text fits a safe interior circle. Default 11px labels render at 5px
through zoom 11, interpolate to 11px at zoom 13, and stay at 11px thereafter.
The fit calculation uses the same zoom-dependent font size as MapLibre. Collision
avoidance, holes, source IDs and geometry remain unchanged. New layers and explicit
reconnect use this policy. Existing default parcel settings migrate once, retaining
custom font sizes and preserving subsequent user edits via parcelDisplayVersion.
