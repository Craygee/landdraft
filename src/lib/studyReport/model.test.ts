import test from "node:test";
import assert from "node:assert/strict";
import type { GisLayer, ProjectRecords } from "../gis/types.ts";
import { defaultStyle, emptyProjectRecords } from "../gis/types.ts";
import {
  analyzeStudyReport,
  createStudyReportWorkspace,
  normalizeStudyReportWorkspace,
  studyBoundaryFromBounds,
  studyBoundaryFromLayer,
  studyEvidenceSignature,
} from "./model.ts";
import { hasStudyReportCapability } from "./entitlements.ts";

const layer = (input: Partial<GisLayer> & Pick<GisLayer, "id" | "name">): GisLayer => ({
  groupId: "working",
  visible: true,
  data: { type: "FeatureCollection", features: [] },
  style: defaultStyle(),
  source: { kind: "draw" },
  createdAt: 1,
  ...input,
  id: input.id,
  name: input.name,
});

test("creates polygon study boundaries from layer geometry and fixed bounds", () => {
  const polygonLayer = layer({
    id: "study",
    name: "Study boundary",
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-100, 32],
                [-99.99, 32],
                [-99.99, 32.01],
                [-100, 32.01],
                [-100, 32],
              ],
            ],
          },
        },
      ],
    },
  });
  const fromLayer = studyBoundaryFromLayer(polygonLayer);
  assert.ok(fromLayer);
  assert.equal(fromLayer.sourceLayerId, "study");
  assert.ok(fromLayer.areaAcres > 200);
  const fromBounds = studyBoundaryFromBounds(
    "Project area",
    "project-area",
    [-100, 32, -99.99, 32.01],
  );
  assert.ok(fromBounds.areaAcres > 200);
});

test("refuses an oversized feature collection as a persisted report boundary", () => {
  const oversized = layer({
    id: "too-large",
    name: "Statewide parcels",
    data: {
      type: "FeatureCollection",
      features: Array.from({ length: 501 }, (_, index) => {
        const x = -100 + index * 0.00001;
        return {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [x, 32],
                [x + 0.000001, 32],
                [x + 0.000001, 32.000001],
                [x, 32],
              ],
            ],
          },
        };
      }),
    },
  });
  assert.equal(studyBoundaryFromLayer(oversized), null);
});

test("classifies mapped evidence and preserves missing categories as insufficient", () => {
  const workspace = createStudyReportWorkspace("Research Site");
  workspace.boundary = studyBoundaryFromBounds(
    "Project area",
    "project-area",
    [-100.1, 31.9, -99.9, 32.1],
  );
  const hydrology = layer({
    id: "wetlands",
    name: "National Wetlands Inventory",
    source: {
      kind: "remote",
      url: "https://example.test/wetlands",
      attribution: "U.S. Fish and Wildlife Service",
    },
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { type: "wetland" },
          geometry: { type: "Point", coordinates: [-100, 32] },
        },
      ],
    },
  });
  const result = analyzeStudyReport({
    workspace,
    layers: [hydrology],
    records: emptyProjectRecords(),
    analyzedAt: "2026-11-04T12:00:00.000Z",
  });
  const water = result.currentRun?.sections.find((section) => section.id === "hydrology");
  const soils = result.currentRun?.sections.find((section) => section.id === "soils");
  assert.equal(water?.status, "ready");
  assert.equal(water?.metrics.find((metric) => metric.id === "features")?.value, "1");
  assert.equal(water?.sources[0]?.attribution, "U.S. Fish and Wildlife Service");
  assert.equal(soils?.status, "insufficient");
  assert.match(soils?.gapMessage ?? "", /Add an appropriate public or user layer/);
  assert.match(soils?.recommendations?.[0]?.name ?? "", /USDA-NRCS/);
  assert.ok(
    result.currentRun?.sections
      .find((section) => section.id === "data-gaps")
      ?.generatedNarrative.includes("Soils & Subsurface Context"),
  );
});

test("reruns generated analysis without replacing user narrative", () => {
  const workspace = createStudyReportWorkspace("Editable Report");
  workspace.boundary = studyBoundaryFromBounds(
    "Current view",
    "current-view",
    [-101, 31, -100, 32],
  );
  const terrainConfig = workspace.sections.find((section) => section.id === "terrain")!;
  terrainConfig.userNarrative = "Field reconnaissance found a graded pad on the east side.";
  terrainConfig.narrativeMode = "replace";
  const first = analyzeStudyReport({
    workspace,
    layers: [],
    records: emptyProjectRecords(),
    analyzedAt: "2026-11-04T12:00:00.000Z",
  });
  const rerun = analyzeStudyReport({
    workspace: first,
    layers: [layer({ id: "elevation", name: "USGS 3DEP Elevation" })],
    records: emptyProjectRecords(),
    analyzedAt: "2026-11-04T13:00:00.000Z",
  });
  assert.equal(
    rerun.sections.find((section) => section.id === "terrain")?.userNarrative,
    "Field reconnaissance found a graded pad on the east side.",
  );
  assert.equal(
    rerun.sections.find((section) => section.id === "terrain")?.narrativeMode,
    "replace",
  );
  assert.equal(
    rerun.currentRun?.sections.find((section) => section.id === "terrain")?.status,
    "partial",
  );
});

test("normalization restores new sections without removing existing edits", () => {
  const workspace = createStudyReportWorkspace("Legacy");
  workspace.sections = workspace.sections.filter((section) => section.id === "terrain");
  workspace.sections[0]!.userNarrative = "Keep this edit";
  const normalized = normalizeStudyReportWorkspace(workspace, "Legacy");
  assert.ok(normalized.sections.length > 10);
  assert.equal(
    normalized.sections.find((section) => section.id === "terrain")?.userNarrative,
    "Keep this edit",
  );
});

test("evidence signature changes with layer or record evidence", () => {
  const records: ProjectRecords = emptyProjectRecords();
  const empty = studyEvidenceSignature([], records);
  const withLayer = studyEvidenceSignature([layer({ id: "a", name: "A" })], records);
  records.notes.push({
    id: "n",
    title: "Note",
    body: "Body",
    createdAt: 1,
    updatedAt: 1,
    author: "Tester",
    includeInPacket: true,
  });
  const withRecord = studyEvidenceSignature([layer({ id: "a", name: "A" })], records);
  assert.notEqual(empty, withLayer);
  assert.notEqual(withLayer, withRecord);
});

test("study report tier hooks are independent and non-restrictive by default", () => {
  assert.equal(hasStudyReportCapability("studyReport.basic"), true);
  assert.equal(hasStudyReportCapability("studyReport.basic", { moduleEnabled: false }), false);
  assert.equal(
    hasStudyReportCapability("studyReport.export", {
      organizationCapabilities: { "studyReport.export": false },
    }),
    false,
  );
});
