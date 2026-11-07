# LandDraft 0.9.229

## iPad rotation

- Attempts to fix the app and map being cut off after turning an iPad to landscape. The app now
  measures the window after a rotation, measures again as the rotation settles, and sizes its
  full-screen layouts from that measurement.
- The cut-off did not reproduce in desktop Chrome, so the cause in iPad Safari is inferred, not
  confirmed. Confirm this on a real iPad.

## Weather on iPad

- The compass, zoom buttons and scale bar now sit above Weather's bottom tab bar at every width where
  the bar shows. They previously cleared it only below 768px, while the bar shows up to 1024px.
- At those wider sizes, the movement and zoom lock buttons now sit on the left above the scale bar,
  as they do on phones.

## Data safety and operating cost

- App code and stylesheet only. No database, storage, Edge Function or infrastructure change.

## Verification

- 234 GIS tests, TypeScript validation and lint on the changed files pass.
- Measured on the test site in emulated sizes: Map mode rotating between 820x1180 and 1180x820, and
  Weather at 820x1180, 1000x700 and 1180x820. The app filled the window and no measured map control
  overlapped the menu or tab bar.
- Not exercised: a physical iPad or Safari. The other full-screen workspaces share the new sizing
  but were not opened. The map canvas could not be confirmed resizing in these runs, because the
  test browser was hidden and paused drawing; it did catch up in an earlier run.

## Rollback

Publish a forward revert of this release to `39ecae1` (0.9.228). Do not force-push.
