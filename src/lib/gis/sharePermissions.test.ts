import test from "node:test";
import assert from "node:assert/strict";
import {
  applySharePermissions,
  refreshSharedNotes,
  sharedCapabilities,
  sharePermissions,
  NEW_SHARE_PERMISSIONS,
} from "./sharePermissions.ts";
import { defaultStyle, emptyProjectRecords, type ProjectState, type GisLayer } from "./types.ts";
const layer = (id: string): GisLayer => ({
  id,
  name: id,
  groupId: "g",
  visible: true,
  createdAt: 0,
  source: { kind: "draw" },
  style: defaultStyle(),
  note: "Legacy private note",
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Parcel" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ],
  },
});
const note = {
  id: "project-note",
  title: "Private project",
  body: "Project body",
  author: "Owner",
  createdAt: 1,
  updatedAt: 1,
  includeInPacket: true,
};
const state = (): ProjectState => ({
  version: 1,
  name: "Source",
  groups: [],
  layers: [
    layer("included"),
    {
      ...layer("map-notes"),
      source: { kind: "draw", purpose: "map-notes" },
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              NAME: "Sensitive marker",
              NOTE: "Secret",
              NOTE_ID: "1",
              NOTE_SCOPE: "layer",
              ASSOCIATED_LAYER_ID: "excluded",
            },
            geometry: { type: "Point", coordinates: [0, 0] },
          },
          {
            type: "Feature",
            properties: {
              NAME: "Shared marker",
              NOTE: "Allowed",
              NOTE_ID: "2",
              NOTE_SCOPE: "layer",
              ASSOCIATED_LAYER_ID: "included",
            },
            geometry: { type: "Point", coordinates: [0, 0] },
          },
        ],
      },
    },
  ],
  basemapId: "street",
  units: { area: "acres", length: "miles" },
  assistant: { messages: [], actions: [] },
  records: {
    ...emptyProjectRecords(),
    notes: [note],
    layerNotes: [
      {
        id: "a",
        layerId: "included",
        subject: "Shared",
        body: "Shared body",
        tags: [],
        author: "Owner",
        createdAt: 1,
        updatedAt: 1,
        includeInPacket: true,
      },
      {
        id: "b",
        layerId: "excluded",
        subject: "Not shared",
        body: "Excluded layer body",
        tags: [],
        author: "Owner",
        createdAt: 1,
        updatedAt: 1,
        includeInPacket: true,
      },
    ],
    documents: [],
    events: [
      {
        id: "e",
        type: "note",
        title: "Private note copied into activity",
        detail: "Secret",
        actor: "owner",
        createdAt: 1,
        projectId: "p",
        projectName: "source",
      },
    ],
    summary: "Private summary",
  },
});
test("new shares allow exports and require an explicit note opt-in", () => {
  assert.deepEqual(NEW_SHARE_PERMISSIONS, { allowExport: true, allowNotes: false });
  assert.deepEqual(sharePermissions(undefined), { allowExport: true, allowNotes: true });
  assert.deepEqual(sharePermissions({ allowExport: false, allowNotes: false }), {
    allowExport: false,
    allowNotes: false,
  });
});
test("viewer capabilities remove editing, AI, map search and backup independently of layer export", () => {
  for (const allowExport of [true, false])
    for (const allowNotes of [true, false]) {
      const caps = sharedCapabilities("viewer", { allowExport, allowNotes });
      assert.equal(caps.canEditProject, false);
      assert.equal(caps.canUseAi, false);
      assert.equal(caps.canSearchMap, false);
      assert.equal(caps.canBackupProject, false);
      assert.equal(caps.canExportLayers, allowExport);
      assert.equal(caps.canViewNotes, allowNotes);
    }
});
test("owners and admins retain full tools; editors must use their editable working copy", () => {
  for (const role of ["owner", "admin"]) {
    const caps = sharedCapabilities(role, { allowExport: false, allowNotes: false });
    assert.ok(Object.values(caps).every(Boolean));
  }
  assert.equal(sharedCapabilities("editor").canEditProject, false);
  assert.equal(sharedCapabilities("owner").canUseAi, true);
});
test("hidden notes are absent from snapshot records, legacy fields and note markers without altering source geometry", () => {
  const source = state();
  const before = JSON.stringify(source);
  const output = applySharePermissions(source, { allowExport: true, allowNotes: false });
  assert.equal(output.records!.notes.length, 0);
  assert.equal(output.records!.layerNotes.length, 0);
  assert.equal(output.records!.events.length, 0);
  assert.equal(output.records!.summary, "");
  assert.equal(output.layers[0]!.note, undefined);
  assert.equal(output.layers[1]!.data.features.length, 0);
  assert.deepEqual(output.layers[0]!.data, source.layers[0]!.data);
  assert.equal(JSON.stringify(source), before);
  assert.ok(!JSON.stringify(output).includes("Secret"));
});
test("allowed project notes and shared-layer notes are read from scoped snapshots only", () => {
  const output = applySharePermissions(state(), { allowExport: false, allowNotes: true });
  assert.equal(output.records!.notes[0]!.body, "Project body");
  assert.deepEqual(
    output.records!.layerNotes.map((n) => n.layerId),
    ["included"],
  );
  assert.equal(output.layers[1]!.data.features.length, 1);
  assert.equal(output.layers[1]!.data.features[0]!.properties!["NOTE"], "Allowed");
  assert.equal(output.records!.events.length, 0);
});
test("reapplying sharing restrictions is safe for old or incomplete record collections", () => {
  const source = state();
  delete source.records;
  const result = applySharePermissions(
    applySharePermissions(source, NEW_SHARE_PERMISSIONS),
    NEW_SHARE_PERMISSIONS,
  );
  assert.equal(result.records!.notes.length, 0);
  assert.equal(result.layers[0]!.data.features.length, 1);
});

test("changing sharing options retains cached remote geometry and never applies source indexes twice", () => {
  const snapshot = state();
  const source = state();
  snapshot.layers[0]!.source = { kind: "remote", url: "https://example.org/FeatureServer/0" };
  source.layers[0]!.data.features = [];
  source.records!.notes[0]!.body = "Updated source note";
  const output = refreshSharedNotes(
    snapshot,
    source,
    [
      { layerId: "included", featureIndexes: [9] },
      { layerId: "map-notes", featureIndexes: [1] },
    ],
    { allowExport: false, allowNotes: true },
  );
  assert.deepEqual(output.layers[0]!.data, snapshot.layers[0]!.data);
  assert.equal(output.records!.notes[0]!.body, "Updated source note");
  assert.equal(output.layers[1]!.data.features.length, 1);
  assert.equal(output.layers[1]!.data.features[0]!.properties!["NOTE_ID"], "2");
});
