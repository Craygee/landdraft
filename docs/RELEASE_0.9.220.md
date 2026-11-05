# LandDraft 0.9.220 — Note PDF previews and consistent pipeline commodities

## Capabilities

- Opens PDF attachments from project notes, layer notes and the project file repository in an
  in-app secure preview, with download retained as a fallback.
- Adds a permanent Records & files shortcut immediately beside Project area in the main bar.
- Updates Texas RRC Pipelines — Detailed to use the current official `COMMODITY` attribute and a
  single reusable LandDraft pipeline-commodity palette.

## Dependencies and operating cost

- PDF bytes continue to use the existing private project-file storage and authenticated download
  path. No third-party PDF service or new paid dependency is introduced.
- The RRC layer continues to use the existing official public ArcGIS service. No additional API,
  credential, database migration or recurring provider cost is introduced.

## Data safety

- No project, map, layer, note, attachment, saved version or account record is deleted or rewritten.
- Existing saved layer styles remain intact; the corrected commodity default applies when the public
  RRC layer is newly added.
