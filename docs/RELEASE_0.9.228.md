# LandDraft 0.9.228

## Map on iPad

- The compass, zoom buttons and scale bar now sit above the bottom menu on the map view. iPads open
  the mobile map, but the offsets that clear its menu only applied below 768px wide.
- At those wider sizes, the movement and zoom lock buttons now sit on the left above the scale bar,
  as they do on phones.

## Data safety and operating cost

- Stylesheet change only. No database, storage, Edge Function or infrastructure change.

## Verification

- 227 GIS tests and TypeScript validation pass. The new layout tests fail on the old stylesheet.
- Measured on the test site in Map mode at 768x1024, 1024x768, 820x1180, 1180x820, 1024x1366,
  1366x1024 and 844x390: no map control overlaps the menu or another control.
- Not exercised: a physical iPad. Those sizes were emulated in a desktop browser, which reports no
  home-indicator safe area.

## Rollback

Publish a forward revert of this release to `f366064` (0.9.227). Do not force-push.
