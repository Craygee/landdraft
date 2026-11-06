import test from "node:test";
import assert from "node:assert/strict";
import type { Feature } from "geojson";
import { catalog } from "../gis/catalog.ts";
import { publicDataTemplateEntries } from "../gis/publicDataTemplates.ts";
import type { GisLayer } from "../gis/types.ts";
import { defaultStyle, emptyProjectRecords } from "../gis/types.ts";
import { figureFrame, rasterImageUrl, scaleBar } from "./figure.ts";
import {
  measureLandCover,
  measureTerrainFromGrid,
  nlcdPixelUrl,
  planStudyTerrain,
  studySamplePoints,
} from "./measurements.ts";
import {
  analyzeStudyReport,
  createStudyReportWorkspace,
  studyBoundaryFromBounds,
  studyBoundaryFromLayer,
  studyBoundaryFromSelection,
  studyEvidenceSignature,
  studyQuietSources,
} from "./model.ts";
import { refreshStudyLayers, STUDY_REFRESH_LAYER_LIMIT } from "./refresh.ts";
import { STUDY_SOURCE_PROFILES, studySectionsForLayer } from "./sourceProfiles.ts";
import type { StudyReportLayerStatus } from "./types.ts";

const layer = (input: Partial<GisLayer> & Pick<GisLayer, "id" | "name">): GisLayer => ({
  groupId: "working",
  visible: true,
  data: { type: "FeatureCollection", features: [] },
  style: defaultStyle(),
  source: { kind: "draw" },
  createdAt: 1,
  ...input,
});

const square = (
  west: number,
  south: number,
  east: number,
  north: number,
  properties: Record<string, unknown> = {},
  hole?: [number, number, number, number],
): Feature => ({
  type: "Feature",
  properties,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
      ...(hole
        ? [
            [
              [hole[0], hole[1]],
              [hole[0], hole[3]],
              [hole[2], hole[3]],
              [hole[2], hole[1]],
              [hole[0], hole[1]],
            ],
          ]
        : []),
    ],
  },
});
const point = (lon: number, lat: number, properties: Record<string, unknown> = {}): Feature => ({
  type: "Feature",
  properties,
  geometry: { type: "Point", coordinates: [lon, lat] },
});
const remote = (id: string, catalogId: string, name: string, features: Feature[]) =>
  layer({
    id,
    name,
    source: {
      kind: "remote",
      url: `https://example.test/${id}/FeatureServer/0`,
      catalogId,
      requiresViewport: true,
    },
    data: { type: "FeatureCollection", features },
  });
const complete = (ids: string[]): StudyReportLayerStatus[] =>
  ids.map((layerId) => ({
    layerId,
    state: "complete",
    retrievedAt: "2026-11-05T12:00:00.000Z",
    nearbyMiles: 1,
  }));
const workspaceFor = (bounds: [number, number, number, number]) => {
  const workspace = createStudyReportWorkspace("Test");
  workspace.boundary = studyBoundaryFromBounds("Test area", "project-area", bounds);
  return workspace;
};
const section = (result: ReturnType<typeof analyzeStudyReport>, id: string) =>
  result.currentRun!.sections.find((item) => item.id === id)!;

test("every shipped connection is routed explicitly to at least one report section", () => {
  const unrouted = catalog
    .filter((entry) => entry.url || entry.downloadUrl)
    .filter((entry) => !STUDY_SOURCE_PROFILES[entry.id]?.sections.length)
    .map((entry) => entry.id);
  assert.deepEqual(unrouted, []);
  const stale = Object.keys(STUDY_SOURCE_PROFILES).filter(
    (id) => !catalog.some((entry) => entry.id === id),
  );
  assert.deepEqual(stale, []);
});

test("agency names and URLs cannot pull layers into the wrong sections", () => {
  const route = (catalogId: string) => {
    const entry = catalog.find((item) => item.id === catalogId)!;
    return studySectionsForLayer(remote(entry.id, entry.id, entry.name, []));
  };
  assert.equal(route("txdot-roadways").includes("environmental"), false);
  assert.equal(route("tx-transmission").includes("environmental"), false);
  assert.equal(route("nhd-flowlines").includes("soils"), false);
  assert.equal(route("usgs-annual-nlcd-land-cover").includes("soils"), false);
  assert.deepEqual(route("fema-national-risk-index"), ["hazards"]);
  // Word boundaries also protect user layers.
  const user = (name: string) => studySectionsForLayer(layer({ id: name, name }));
  assert.deepEqual(user("Trail easement"), ["environmental"]);
  assert.equal(user("Department notes").includes("environmental"), false);
  assert.equal(user("Broadband survey").includes("land-cover"), false);
  assert.ok(user("Road access").includes("infrastructure"));
  assert.equal(user("Broadroad").includes("infrastructure"), false);
});

test("a failed source is reported as not evaluated and differs from a completed empty query", () => {
  const workspace = workspaceFor([-100, 32, -99.9, 32.1]);
  const wetlands = remote("w", "fws-wetlands", "National Wetlands Inventory", []);
  const failed = analyzeStudyReport({
    workspace,
    layers: [wetlands],
    records: emptyProjectRecords(),
    layerStatuses: [{ layerId: "w", state: "failed", message: "HTTP 503" }],
  });
  const empty = analyzeStudyReport({
    workspace,
    layers: [wetlands],
    records: emptyProjectRecords(),
    layerStatuses: complete(["w"]),
  });
  assert.equal(section(failed, "hydrology").status, "partial");
  assert.match(section(failed, "hydrology").generatedNarrative, /Incomplete: National Wetlands/);
  assert.equal(section(failed, "hydrology").sources[0]?.queryState, "failed");
  assert.ok(
    failed.currentRun!.warnings.some((item) => /failed.*not as no findings.*503/.test(item)),
  );
  assert.equal(section(empty, "hydrology").status, "ready");
  assert.match(section(empty, "hydrology").generatedNarrative, /not proof the condition is absent/);
  assert.notEqual(
    section(failed, "hydrology").generatedNarrative,
    section(empty, "hydrology").generatedNarrative,
  );
});

test("refresh discards old data on failure, reports truncation and has no silent layer cap", async () => {
  const boundary = studyBoundaryFromBounds("A", "project-area", [-100, 32, -99.9, 32.1]);
  const stale = remote("bad", "fws-wetlands", "Wetlands", [point(-99.95, 32.05)]);
  const big = remote("big", "wv-parcels-statewide", "Parcels", []);
  const fine = remote("ok", "nhd-flowlines", "Streams", []);
  const bboxes: Record<string, number[]> = {};
  const result = await refreshStudyLayers([stale, big, fine], boundary, {
    retryDelayMs: 0,
    fetchFeatures: async (url, options) => {
      bboxes[url] = options.bbox as number[];
      if (url.includes("/bad/")) throw new Error("Service returned HTTP 400");
      const features = url.includes("/ok/") ? [point(-99.95, 32.05)] : [];
      return {
        data: { type: "FeatureCollection", features },
        loaded: url.includes("/big/") ? 5000 : features.length,
        complete: !url.includes("/big/"),
        truncated: url.includes("/big/"),
      };
    },
    fetchCount: async () => 18454,
    now: () => new Date("2026-11-05T12:00:00.000Z"),
  });
  const states = Object.fromEntries(result.statuses.map((item) => [item.layerId, item]));
  assert.equal(states["bad"]?.state, "failed");
  assert.equal(result.layers.find((item) => item.id === "bad")?.data.features.length, 0);
  assert.equal(states["big"]?.state, "truncated");
  assert.equal(states["big"]?.expected, 18454);
  assert.match(states["big"]?.message ?? "", /minimums/);
  assert.equal(states["ok"]?.state, "complete");
  assert.ok(result.refreshed.every((item) => item.id !== "bad"));
  // Streams search 0.25 mi beyond the boundary; parcels search only the boundary extent.
  assert.ok((bboxes["https://example.test/ok/FeatureServer/0"]?.[0] ?? 0) < -100);
  assert.equal(bboxes["https://example.test/big/FeatureServer/0"]?.[0], -100);

  const many = Array.from({ length: STUDY_REFRESH_LAYER_LIMIT + 3 }, (_, index) =>
    remote(`l${index}`, "nhd-flowlines", `Layer ${index}`, []),
  );
  const capped = await refreshStudyLayers(many, boundary, {
    fetchFeatures: async () => ({
      data: { type: "FeatureCollection", features: [] },
      loaded: 0,
      complete: true,
      truncated: false,
    }),
  });
  assert.equal(capped.statuses.filter((item) => item.state === "not-refreshed").length, 3);
  assert.equal(capped.statuses.length, many.length);
});

test("transient errors retry with limits per server, and a refused query is not retried", async () => {
  const boundary = studyBoundaryFromBounds("A", "project-area", [-100, 32, -99.9, 32.1]);
  const empty = {
    data: { type: "FeatureCollection" as const, features: [] },
    loaded: 0,
    complete: true,
    truncated: false,
  };
  let calls = 0;
  const recovered = await refreshStudyLayers(
    [remote("r", "nhd-flowlines", "Streams", [])],
    boundary,
    {
      retryDelayMs: 0,
      fetchFeatures: async () => {
        calls += 1;
        if (calls < 3) throw new Error("User couldn't access this resource 'public/x.mapserver'.");
        return empty;
      },
    },
  );
  assert.equal(calls, 3);
  assert.equal(recovered.statuses[0]?.state, "complete");

  calls = 0;
  const refused = await refreshStudyLayers(
    [remote("r", "nhd-flowlines", "Streams", [])],
    boundary,
    {
      retryDelayMs: 0,
      fetchFeatures: async () => {
        calls += 1;
        throw new Error("Invalid query parameter at https://example.test/q?where=1%3D1&f=geojson");
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(refused.statuses[0]?.state, "failed");
  assert.equal(refused.statuses[0]?.message?.includes("where="), false);

  let active = 0;
  let peak = 0;
  const same = Array.from({ length: 8 }, (_, index) =>
    remote(`s${index}`, "nhd-flowlines", "S", []),
  );
  await refreshStudyLayers(same, boundary, {
    fetchFeatures: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return empty;
    },
  });
  assert.ok(peak <= 2, "one server sees at most two requests at a time");
});

test("separates on-site from nearby features and labels the search distance", () => {
  const workspace = workspaceFor([-100, 32, -99.99, 32.01]);
  const plants = remote("p", "us-power-plants-eia", "Power plants", [
    point(-99.995, 32.005, { Plant_Name: "Inside", PrimSource: "solar" }),
    point(-99.98, 32.005, { Plant_Name: "Close", PrimSource: "wind" }),
    point(-99.5, 32.005, { Plant_Name: "Far", PrimSource: "gas" }),
  ]);
  const result = analyzeStudyReport({
    workspace,
    layers: [plants],
    records: emptyProjectRecords(),
    layerStatuses: [{ layerId: "p", state: "complete", nearbyMiles: 5 }],
  });
  const analysis = section(result, "energy").analysis!.layers[0]!;
  assert.equal(analysis.featureCount, 1);
  assert.equal(analysis.nearby?.count, 1);
  assert.equal(analysis.nearby?.searchMiles, 5);
  assert.equal(analysis.nearby?.nearestLabel, "Close");
  assert.equal(analysis.nearby?.nearestDirection, "E");
  // About 1,000 m east of the boundary, which is about 0.58 mi.
  assert.ok(Math.abs((analysis.nearby?.nearestMiles ?? 0) - 0.58) < 0.03);
  assert.deepEqual(analysis.attributes[0]?.values, [{ value: "solar", count: 1 }]);
});

test("Study Area does not call a source empty when another section found it on site", () => {
  const workspace = workspaceFor([-100, 32, -99.99, 32.01]);
  const plants = remote("p", "us-power-plants-eia", "Power plants", [
    point(-99.995, 32.005, { Plant_Name: "Inside" }),
  ]);
  const emptyPlants = remote("q", "us-power-plants-eia", "Far plants", [
    point(-99.5, 32.005, { Plant_Name: "Far" }),
  ]);
  const result = analyzeStudyReport({
    workspace,
    layers: [plants, emptyPlants],
    records: emptyProjectRecords(),
    layerStatuses: [
      { layerId: "p", state: "complete", nearbyMiles: 5 },
      { layerId: "q", state: "complete", nearbyMiles: 5 },
    ],
  });
  const quiet = studyQuietSources(section(result, "study-area"), result.currentRun);
  assert.deepEqual(
    quiet.map((source) => source.id),
    ["q"],
  );
});

test("a feature in the boundary hole is nearby, not on site, and line length excludes the hole", () => {
  const study = layer({
    id: "b",
    name: "Tract",
    data: {
      type: "FeatureCollection",
      features: [square(-100, 32, -99.9, 32.1, {}, [-99.98, 32.02, -99.92, 32.08])],
    },
  });
  const workspace = createStudyReportWorkspace("Hole");
  workspace.boundary = studyBoundaryFromLayer(study)!;
  const line: Feature = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [
        [-100, 32.05],
        [-99.9, 32.05],
      ],
    },
  };
  const result = analyzeStudyReport({
    workspace,
    layers: [
      study,
      // Inside the hole, about 0.3 mi from its west edge.
      remote("well", "tx-groundwater-wells", "Wells", [point(-99.975, 32.05)]),
      remote("road", "us-primary-roads-current", "Road", [line]),
    ],
    records: emptyProjectRecords(),
    layerStatuses: complete(["well", "road"]),
  });
  const well = section(result, "hydrology").analysis!.layers.find(
    (item) => item.layerId === "well",
  )!;
  assert.equal(well.featureCount, 0);
  assert.equal(well.nearby?.count, 1);
  const road = section(result, "infrastructure").analysis!.layers.find(
    (item) => item.layerId === "road",
  )!;
  // 0.1 degrees of longitude at 32°N is 5.87 mi; the hole removes 60% of it.
  assert.ok(Math.abs((road.onSiteLineMiles ?? 0) - 5.87 * 0.4) < 0.1);
});

test("coverage is per source and per class, and unrelated sources are never added together", () => {
  const workspace = workspaceFor([-100, 32, -99.9, 32.1]);
  const huc = remote("huc", "usgs-watersheds-huc12", "HUC12", [
    square(-101, 31, -99, 33, { name: "Big Creek" }),
  ]);
  const flood = remote("fema", "fema-flood-zones", "FEMA zones", [
    square(-100, 32, -99.95, 32.1, { FLD_ZONE: "AE" }),
    square(-99.95, 32, -99.9, 32.1, { FLD_ZONE: "X" }),
    square(-100, 32, -99.95, 32.1, { FLD_ZONE: "AE" }),
  ]);
  const result = analyzeStudyReport({
    workspace,
    layers: [huc, flood],
    records: emptyProjectRecords(),
    layerStatuses: complete(["huc", "fema"]),
  });
  const hydrology = section(result, "hydrology");
  assert.equal(hydrology.analysis?.mappedCoverageAcres, undefined);
  assert.equal(
    hydrology.metrics.some((metric) => metric.id === "coverage"),
    false,
  );
  const zones = hydrology.analysis!.layers.find((item) => item.layerId === "fema")!;
  const byZone = Object.fromEntries(
    zones.coverageClasses!.map((item) => [item.value, item.percent]),
  );
  assert.ok(Math.abs((byZone["AE"] ?? 0) - 50) < 0.5, "duplicate AE polygons count once");
  assert.ok(Math.abs((byZone["X"] ?? 0) - 50) < 0.5);
  assert.equal(hydrology.analysis!.layers.find((item) => item.layerId === "huc")?.context, true);
});

test("minimal-hazard flood zones stay in tables but off maps, and summaries restate findings", () => {
  const workspace = workspaceFor([-100, 32, -99.9, 32.1]);
  const flood = remote("fema", "fema-flood-zones", "FEMA zones", [
    square(-100, 32, -99.95, 32.1, { FLD_ZONE: "AE", ZONE_SUBTY: " " }),
    square(-99.95, 32, -99.9, 32.1, { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }),
  ]);
  const aquifer = remote("aq", "usgs-principal-aquifers", "Aquifer", [
    square(-101, 31, -99, 33, { AQ_NAME: "Trinity" }),
  ]);
  const result = analyzeStudyReport({
    workspace,
    layers: [flood, aquifer],
    records: emptyProjectRecords(),
    layerStatuses: complete(["fema", "aq"]),
  });
  const zones = section(result, "hydrology").analysis!.layers.find((l) => l.layerId === "fema")!;
  assert.equal(zones.coverageClasses?.length, 2);
  assert.match(zones.note ?? "", /minimal flood hazard are counted/);
  assert.equal(result.currentRun!.figureSnapshot!.features["fema"]?.length, 1);
  const highlights = section(result, "executive-summary").highlights!;
  assert.ok(highlights.some((item) => item.includes("FEMA zones")));
  assert.equal(
    highlights.some((item) => item.includes("Aquifer")),
    false,
    "context is not a finding",
  );
});

test("field names match regardless of case and very small figures do not read as zero", () => {
  const workspace = workspaceFor([-100, 32, -99.9, 32.1]);
  const ponds = remote("ponds", "usgs-waterbodies", "Ponds", [
    square(-99.95, 32.05, -99.9499, 32.0501, { GNIS_NAME: "Upper Pond", FTYPE: "390" }),
  ]);
  const result = analyzeStudyReport({
    workspace,
    layers: [ponds],
    records: emptyProjectRecords(),
    layerStatuses: complete(["ponds"]),
  });
  const analysis = section(result, "hydrology").analysis!.layers[0]!;
  assert.equal(analysis.attributes[0]?.field, "GNIS_NAME");
  assert.match(
    section(result, "hydrology").generatedNarrative,
    /under 0\.1% of the study area|under 0\.1 acres/,
  );
  assert.equal(section(result, "hydrology").generatedNarrative.includes("0 acres"), false);
});

test("the gap list and section sources stay compact and readable", () => {
  const workspace = workspaceFor([-100, 32, -99.9, 32.1]);
  const wetlands = remote("w", "fws-wetlands", "NWI", []);
  const result = analyzeStudyReport({
    workspace,
    layers: [wetlands],
    records: emptyProjectRecords(),
    layerStatuses: complete(["w"]),
  });
  assert.equal(
    section(result, "data-gaps").generatedNarrative.includes("Executive Summary"),
    false,
  );
  assert.equal(section(result, "hydrology").sources[0]?.license, undefined);
  assert.ok(section(result, "sources").sources[0]?.license);
  const wv = remote("p", "wv-parcels-statewide", "WV parcels", []);
  const scoped = analyzeStudyReport({
    workspace,
    layers: [wv],
    records: emptyProjectRecords(),
    layerStatuses: complete(["p"]),
  });
  assert.equal(section(scoped, "land-cover").sources[0]?.coverage, "WV");
});

test("the boundary denominator counts overlaps once and a whole boundary layer is not evidence", () => {
  const a = square(-100, 32, -99.9, 32.1);
  const study = layer({
    id: "wetland-tract",
    name: "Wetland tract",
    data: { type: "FeatureCollection", features: [a, a] },
  });
  const single = studyBoundaryFromLayer(
    layer({ id: "s", name: "S", data: { type: "FeatureCollection", features: [a] } }),
  )!;
  const boundary = studyBoundaryFromLayer(study)!;
  assert.ok(Math.abs(boundary.areaAcres - single.areaAcres) < 0.01);
  const workspace = createStudyReportWorkspace("Self");
  workspace.boundary = boundary;
  const result = analyzeStudyReport({
    workspace,
    layers: [study],
    records: emptyProjectRecords(),
  });
  assert.equal(section(result, "hydrology").status, "insufficient");
  assert.equal(section(result, "study-area").metrics[1]?.value, "0");
});

test("selected polygons form the boundary and the rest of that layer remains evidence", () => {
  const parcels = layer({
    id: "parcels",
    name: "Parcels",
    data: {
      type: "FeatureCollection",
      features: [
        square(-100, 32, -99.99, 32.01),
        square(-99.98, 32, -99.97, 32.01),
        point(-100, 32),
      ],
    },
  });
  const boundary = studyBoundaryFromSelection(parcels, [0, 2])!;
  assert.equal(boundary.data.features.length, 1);
  assert.equal(boundary.sourceFeatures, "selected");
  assert.ok(boundary.areaAcres > 200 && boundary.areaAcres < 300);
  assert.equal(studyBoundaryFromSelection(parcels, [2]), null);
  const workspace = createStudyReportWorkspace("Selected");
  workspace.boundary = boundary;
  const result = analyzeStudyReport({
    workspace,
    layers: [parcels],
    records: emptyProjectRecords(),
  });
  assert.equal(section(result, "land-cover").analysis?.layers[0]?.layerId, "parcels");
});

test("rectangles are flagged, and raster layers are marked as not measured", () => {
  const workspace = workspaceFor([-100, 32, -99.9, 32.1]);
  const topo = layer({
    id: "topo",
    name: "USGS Topo",
    source: {
      kind: "raster",
      tiles: ["https://example.test/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      catalogId: "usgs-topographic-map",
    },
  });
  const result = analyzeStudyReport({
    workspace,
    layers: [topo],
    records: emptyProjectRecords(),
    layerStatuses: [{ layerId: "topo", state: "visual-only" }],
  });
  assert.ok(result.currentRun!.warnings.some((item) => /rectangular extent/.test(item)));
  const terrain = section(result, "terrain");
  assert.equal(terrain.status, "partial");
  assert.match(terrain.generatedNarrative, /Map image only, not measured: USGS Topo/);
  assert.deepEqual(terrain.mapLayerIds, ["topo"]);
});

test("run keeps a bounded figure snapshot so saved maps match saved tables", () => {
  const workspace = workspaceFor([-100, 32, -99.9, 32.1]);
  const zones = remote("fema", "fema-flood-zones", "Zones", [
    square(-100.5, 31.5, -99.5, 32.5, { FLD_ZONE: "AE" }),
  ]);
  const wells = remote(
    "wells",
    "tx-groundwater-wells",
    "Wells",
    Array.from({ length: 400 }, (_, index) => point(-99.95 + index * 1e-5, 32.05)),
  );
  const result = analyzeStudyReport({
    workspace,
    layers: [zones, wells],
    records: emptyProjectRecords(),
    layerStatuses: complete(["fema", "wells"]),
  });
  const snapshot = result.currentRun!.figureSnapshot!;
  assert.equal(snapshot.features["wells"]?.length, 150);
  assert.equal(snapshot.truncated, true);
  // Polygon is clipped to the boundary rather than stored at provider size.
  const ring = (snapshot.features["fema"]?.[0]?.geometry as { coordinates: number[][][] })
    .coordinates[0]!;
  assert.ok(ring.every(([lon]) => lon! >= -100.0001 && lon! <= -99.8999));
  assert.ok(JSON.stringify(result.currentRun).length < 2_000_000);
});

test("saved reports keep their shape and panning the map does not mark a report stale", () => {
  const records = emptyProjectRecords();
  const viewport = remote("v", "nhd-flowlines", "Streams", []);
  const before = studyEvidenceSignature([viewport], records);
  const panned = {
    ...viewport,
    data: { type: "FeatureCollection" as const, features: [point(-100, 32)] },
  };
  assert.equal(studyEvidenceSignature([panned], records), before);
  const filtered: GisLayer = {
    ...viewport,
    source: {
      ...(viewport.source as Extract<GisLayer["source"], { kind: "remote" }>),
      where: "x=1",
    },
  };
  assert.notEqual(studyEvidenceSignature([filtered], records), before);
  const old = analyzeStudyReport({
    workspace: workspaceFor([-100, 32, -99.9, 32.1]),
    layers: [],
    records,
  });
  assert.equal(old.schemaVersion, 1);
  assert.equal(old.currentRun?.layerStatuses, undefined);
});

test("terrain statistics use only cells inside the polygon and match a known plane", () => {
  const boundary = studyBoundaryFromBounds("A", "project-area", [-100, 32, -99.98, 32.02]);
  const plan = planStudyTerrain(boundary);
  const dy = (plan.bbox[3] - plan.bbox[1]) / plan.height;
  // A 10% grade rising to the south, 100 m at the top row.
  const values = Array.from({ length: plan.width * plan.height }, (_, index) => {
    const row = Math.floor(index / plan.width);
    return 100 + row * dy * 0.1;
  });
  const grid = {
    ...plan,
    values,
    source: "USGS 3DEP bare-earth DEM — numeric grid",
    sourceUrl: "https://example.test",
    retrievedAt: "2026-11-05T12:00:00.000Z",
    productDate: null,
    sourceResolutionM: null,
    verticalDatum: "varies",
  };
  const measurement = measureTerrainFromGrid(boundary, grid);
  const row = (label: string) => measurement.rows.find((item) => item.label === label)?.value;
  assert.equal(row("8–15% grade"), "100.0%");
  assert.equal(row("0–5% grade"), "0.0%");
  assert.match(row("Steepest cell") ?? "", /^10% grade/);
  assert.match(measurement.limitation, /not a survey/);
  assert.match(measurement.limitation, /do not establish buildability/);

  const holes = values.map(() => null);
  assert.throws(() => measureTerrainFromGrid(boundary, { ...grid, values: holes }), /no elevation/);
  const partial = values.map((value, index) => (index % 10 === 0 ? null : value));
  const gaps = measureTerrainFromGrid(boundary, { ...grid, values: partial });
  assert.ok(gaps.rows.some((item) => item.label === "No elevation data"));
});

test("land-cover sampling honors holes, reports shares only, and refuses thin coverage", async () => {
  const holed = layer({
    id: "b",
    name: "B",
    data: {
      type: "FeatureCollection",
      features: [square(-100, 32, -99.9, 32.1, {}, [-99.98, 32.02, -99.92, 32.08])],
    },
  });
  const boundary = studyBoundaryFromLayer(holed)!;
  const points = studySamplePoints(boundary);
  assert.ok(points.length > 30 && points.length <= 80);
  assert.ok(
    points.every(([lon, lat]) => !(lon > -99.98 && lon < -99.92 && lat > 32.02 && lat < 32.08)),
  );
  const measurement = await measureLandCover(
    boundary,
    async (lon) => (lon < -99.95 ? 82 : 41),
    "2026-11-05T12:00:00.000Z",
  );
  const total = measurement.rows.reduce((sum, row) => sum + Number.parseInt(row.value, 10), 0);
  assert.ok(total >= 98 && total <= 102);
  assert.ok(measurement.rows.every((row) => !/acre/i.test(row.value)));
  assert.match(measurement.limitation, /acreage is not reported/);
  await assert.rejects(
    measureLandCover(boundary, async () => null, "2026-11-05T12:00:00.000Z"),
    /outside the conterminous/,
  );
  // Connection resets recover on retry; a point outside coverage is not retried.
  let calls = 0;
  const flaky = await measureLandCover(
    boundary,
    async () => {
      calls += 1;
      if (calls % 2) throw new Error("fetch failed");
      return 41;
    },
    "2026-11-05T12:00:00.000Z",
    { retryDelayMs: 0, concurrency: 1 },
  );
  assert.equal(flaky.rows[0]?.value, "100%");
  assert.equal(calls, points.length * 2);
  let outside = 0;
  await assert.rejects(
    measureLandCover(
      boundary,
      async () => {
        outside += 1;
        return null;
      },
      "2026-11-05T12:00:00.000Z",
      { retryDelayMs: 0 },
    ),
  );
  assert.equal(outside, points.length);
  assert.match(nlcdPixelUrl(-100, 32), /request=GetFeatureInfo/);
});

test("figures keep true proportions and draw map images for the exact extent", () => {
  const bounds: [number, number, number, number] = [-100, 32, -99.9, 32.1];
  const frame = figureFrame(bounds, { x: 26, y: 26, width: 708, height: 368 });
  const [westX, southY] = frame.project([-100, 32]);
  const [eastX, northY] = frame.project([-99.9, 32.1]);
  assert.ok(Math.abs(eastX - westX - frame.width) < 0.01);
  assert.ok(Math.abs(southY - northY - frame.height) < 0.01);
  // A degree-square at 32°N is about 15% wider than tall once latitude is respected... in Mercator
  // it is drawn square, so the frame must not be stretched to fill the plot.
  assert.ok(frame.width < 400);
  const bar = scaleBar(frame.metersPerUnit, 180);
  assert.ok(bar.width > 0 && bar.width <= 180);
  // 0.1° of longitude at 32°N is about 9.44 km.
  assert.ok(Math.abs(frame.metersPerUnit * frame.width - 9_440) < 150);

  const wms = rasterImageUrl(
    "https://example.test/wms?bbox={bbox-epsg-3857}&width=256&height=256",
    bounds,
    368,
    368,
  );
  assert.match(wms ?? "", /width=368&height=368/);
  assert.equal(wms?.includes("{bbox"), false);
  const image = rasterImageUrl(
    "https://example.test/ImageServer/exportImage?bbox={bbox-epsg-3857}&size=256,256&f=image",
    bounds,
    300,
    200,
  );
  assert.match(image ?? "", /size=300,200/);
  const tile = rasterImageUrl(
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    bounds,
    300,
    200,
  );
  assert.match(tile ?? "", /USGSTopo\/MapServer\/export\?bbox=/);
  assert.equal(rasterImageUrl("https://example.test/{z}/{x}/{y}.png", bounds, 10, 10), null);
});

test("representative Texas and West Virginia templates produce non-overlapping routed reports", () => {
  for (const [templates, bounds] of [
    [
      ["texas-land-study", "study-area-report-screening"],
      [-97.75, 29.85, -97.65, 29.95],
    ],
    [
      ["west-virginia-land-study", "study-area-report-screening"],
      [-80.05, 39.55, -79.93, 39.65],
    ],
  ] as const) {
    const entries = new Map(
      templates.flatMap((id) => publicDataTemplateEntries(id)).map((entry) => [entry.id, entry]),
    );
    const layers = [...entries.values()].map((entry) =>
      entry.rendering === "raster-tiles"
        ? layer({
            id: entry.id,
            name: entry.name,
            source: { kind: "raster", tiles: [entry.url!], tileSize: 256, catalogId: entry.id },
          })
        : remote(entry.id, entry.id, entry.name, []),
    );
    assert.ok(layers.length <= STUDY_REFRESH_LAYER_LIMIT, "a whole study must refresh in one run");
    const result = analyzeStudyReport({
      workspace: workspaceFor([...bounds]),
      layers,
      records: emptyProjectRecords(),
      layerStatuses: layers.map((item) => ({
        layerId: item.id,
        state: item.source.kind === "raster" ? ("visual-only" as const) : ("complete" as const),
      })),
    });
    for (const id of ["hydrology", "soils", "environmental", "infrastructure", "hazards"])
      assert.notEqual(section(result, id).status, "insufficient", `${templates[0]}: ${id}`);
    assert.ok(
      section(result, "environmental").sources.every((source) => !/roads?\b/i.test(source.name)),
    );
  }
});
