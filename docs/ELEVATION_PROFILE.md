# Map elevation profile

Entry: Analysis → Elevation profile. Works without an existing project layer.
Click/tap vertices, then Generate profile, double-click, or press Enter. Pan normally.
Escape closes the tool. The path is a temporary analysis overlay; it does not modify
project geometry. Close removes the path/cursor and restores double-click zoom.

The bottom panel includes elevation versus horizontal map distance, sampled min/max,
gain/loss, maximum absolute sampled grade, and an incoming-segment grade in percent
and degrees. Hover, touch/drag, or the keyboard-accessible slider moves the graph
cursor and map marker. Graph zoom, full-route reset, centering on the cursor, units,
and CSV export are available. Path controls collapse after generation. On short
screens, expanded profiles hide the native bottom map controls to avoid header
overlap; Map zoom buttons remain in path settings, and collapsing/closing restores
native controls. The panel reserves its measured height above mobile navigation.

## Data and calculations

- Reuses `/api/pipeline/elevation` and its USGS 3DEP EPQS source, bounded concurrency,
  and cache. No new provider login, schema, or paid service is required.
- Samples WGS84 coordinates along a Turf geodesic line, retaining endpoints and
  all drawn corners. Adjacent duplicate input vertices are ignored.
- Default target spacing is 10 m; options are 25, 50, and 100 m. Maximum 384 samples,
  128 vertices, and 100 km. Longer routes increase actual spacing, shown in the UI.
- Requests are sequential batches of at most 96 points. A singleton last batch
  repeats the preceding point for the existing endpoint, then removes the duplicate.
- Responses must match requested stations/coordinates and the expected provider.
  Cancellation stops additional batches; closing/new requests discard stale results.
- Grade = 100 × elevation change / horizontal station separation. Slope degrees =
  atan(grade/100). No slope or gain/loss segment spans a missing elevation.
- Missing values stay null; actual zero and below-sea-level elevations remain valid.
  The shared provider parser no longer converts null/blank/boolean values to zero.
- Terrain cache keys preserve seven-decimal request coordinates. Provider resolution
  is retained when supplied and positive; unknown resolution remains unknown.
- Chart lines use linear segments and show coverage gaps. There is no spline that
  could invent extrema, smoothing, invented elevation, or global fallback dataset.
- Gain/loss and steepest grade are sampled estimates. Sampling interval is not DEM
  resolution or vertical accuracy. Original source DEM vertical datum must be
  verified for engineering work. CSV values use meters, percent and degrees.

USGS guidance: https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map

## Verification

- GIS, tooltip and pipeline suite: 90 tests passed, including endpoint retention,
  curved/multi-segment stationing, bounded batches, singleton batches, cancellation,
  response mismatch, positive/negative slope, missing versus zero, and provider parsing.
- TypeScript and scoped ESLint passed.
- A live proxy request at two generic Grand Canyon points returned HTTP 200 with
  elevations 2173.897949219 m and 2175.013916016 m and reported resolution 1 m.
  This verifies connectivity/normalization, not surveyed accuracy at other locations.
- Local UI harness used explicitly labeled synthetic terrain, separate from the
  live provider check. Verified drawing, generation, keyboard inspection, graph
  interaction/zoom and unit conversion. Layout checked at desktop 768×572,
  phone 390×844, tablet 1024×768, and landscape 844×390. Close controls remained
  in bounds; native controls returned after collapsing the short-screen panel.
- Temporary UI fixtures/server were removed. No test data was put in a user project.
- Not tested on a physical iPhone/iPad or an authenticated production project.

The tool is initially USGS coverage only. It is not a surveyed cross-section,
engineering-grade surface, complete maximum-slope survey, or guarantee that narrow
features between samples were captured. The ephemeral path is not automatically
saved to the project's layers; CSV export preserves sampled coordinates/elevations.

## Saved profiles and exports (0.9.199)
Name and Save profile to store its route, samples, source/datum and retrieval timestamp in a derived project layer. Reopen through Open saved elevation profile. New paths create new profiles; edits to an opened profile update that saved profile. Save project syncs the snapshot.

Add to Print Map saves and selects the graph panel. It can appear beside a Buildable Area summary through Print Map → Analysis reports. Separate CSV, GeoJSON (route and sample points), graph SVG and report PDF exports are available. CSV/GeoJSON use metres and retain NULL versus real zero. Graph gaps remain gaps. Standalone reports retain provider, datum, retrieval time and the terrain-not-survey limitation. Source terrain is not re-fetched automatically when opening an old snapshot.
