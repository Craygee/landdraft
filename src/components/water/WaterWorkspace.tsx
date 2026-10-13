import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { area as turfArea, bbox, bboxPolygon, point } from "@turf/turf";
import {
  ArrowLeft,
  Droplets,
  PanelLeft,
  Play,
  Save,
  Download,
  Layers3,
  ExternalLink,
  GripHorizontal,
  MapPinPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MapCanvas } from "@/components/gis/MapCanvas";
import { FeatureDestinationDialog } from "@/components/gis/FeatureDestinationDialog";
import { BasemapControl } from "@/components/gis/BasemapControl";
import { SearchBox } from "@/components/gis/SearchBox";
import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
import { importFile } from "@/lib/gis/import";
import { getCloudSession } from "@/lib/cloud";
import { analyzeWaterSource } from "@/lib/water/api";
import { measurementAge, validateWaterArea, waterCsv } from "@/lib/water/model";
import { buildHydrologyProducts, buildWellSiteProfile, wellStyle } from "@/lib/water/analysis";
import { WATER_OPTIONAL_SOURCES, WATER_SOURCES } from "@/lib/water/registry";
import { defaultStyle } from "@/lib/gis/types";
import {
  WATER_DISCLAIMER,
  type WaterAnalysis,
  type WaterArea,
  type WaterRecord,
  type WaterSourceResult,
  type WellSiteProfile,
  type WellColorMode,
} from "@/lib/water/types";

const PrintComposer = lazy(() =>
  import("@/components/gis/PrintComposer").then((m) => ({ default: m.PrintComposer })),
);

const button =
  "min-h-11 rounded-lg border px-3 py-2 text-sm hover:bg-secondary disabled:opacity-40";
const WATER_LAYER_PREFIX = "Water evidence ·";
const HYDROLOGY_LAYER_PREFIX = "Hydrology analysis ·";
const HYDROLOGY_REFERENCE_PREFIX = "Hydrology reference ·";
const isWaterModuleLayer = (name: string) =>
  name.startsWith(WATER_LAYER_PREFIX) ||
  name.startsWith(HYDROLOGY_LAYER_PREFIX) ||
  name.startsWith(HYDROLOGY_REFERENCE_PREFIX);

const HYDROLOGY_REFERENCES = [
  {
    id: "tx-minor-aquifers",
    name: "Texas minor aquifers",
    agency: "Texas Water Development Board",
    url: "https://services2.arcgis.com/LYMgRMwHfrWWEg3s/arcgis/rest/services/TWDB_Minor_Aquifers/FeatureServer/0",
    geometry: "polygon" as const,
    minZoom: 5,
    color: "#a16207",
    sourceUrl: "https://www.twdb.texas.gov/groundwater/aquifer/minor.asp",
  },
  {
    id: "tx-public-water-wells",
    name: "Texas public water system wells",
    agency: "Texas Commission on Environmental Quality",
    url: "https://services2.arcgis.com/LYMgRMwHfrWWEg3s/arcgis/rest/services/TCEQ_Public_Water_System_Wells/FeatureServer/0",
    geometry: "point" as const,
    minZoom: 8,
    color: "#0891b2",
    sourceUrl: "https://gis-tceq.opendata.arcgis.com/",
  },
  {
    id: "nhd-flowlines",
    name: "National Hydrography flowlines",
    agency: "U.S. Geological Survey",
    url: "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6",
    geometry: "line" as const,
    minZoom: 8,
    color: "#0284c7",
    sourceUrl: "https://www.usgs.gov/the-national-map-data-delivery/gis-data-download",
  },
  {
    id: "wbd-huc12",
    name: "Watershed boundaries (HUC12)",
    agency: "U.S. Geological Survey",
    url: "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6",
    geometry: "polygon" as const,
    minZoom: 7,
    color: "#4f46e5",
    sourceUrl: "https://www.usgs.gov/national-hydrography/watershed-boundary-dataset",
  },
  {
    id: "fema-nfhl-zones",
    name: "FEMA flood hazard zones",
    agency: "Federal Emergency Management Agency",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
    geometry: "polygon" as const,
    minZoom: 8,
    color: "#0e7490",
    sourceUrl: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
  },
];
function download(name: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WaterWorkspace() {
  const wb = useWorkbench();
  const { map, printOpen, setPrintOpen } = useMapRef();
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState<"Overview" | "Hydrology" | "Records" | "Sources">("Overview");
  const [optional, setOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<WaterSourceResult[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [wellColorMode, setWellColorMode] = useState<WellColorMode>("depth");
  const [selectedAquifer, setSelectedAquifer] = useState<string>("");
  const [profileMode, setProfileMode] = useState(false);
  const [wellProfile, setWellProfile] = useState<WellSiteProfile | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelDrag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const run = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = panelDrag.current;
      const frame = mainRef.current?.getBoundingClientRect();
      const floating = panelRef.current?.getBoundingClientRect();
      if (!drag || !frame || !floating || event.pointerId !== drag.pointerId) return;
      setPanelPosition({
        left: Math.max(
          8,
          Math.min(frame.width - floating.width - 8, event.clientX - frame.left - drag.offsetX),
        ),
        top: Math.max(
          8,
          Math.min(frame.height - floating.height - 8, event.clientY - frame.top - drag.offsetY),
        ),
      });
    };
    const finish = (event: PointerEvent) => {
      if (panelDrag.current?.pointerId === event.pointerId) panelDrag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, []);
  const state = wb.waterWorkspace;
  const study = state?.area;
  const results = progress ?? state?.analysis?.results ?? [];
  const records = results.flatMap((r) => r.records);
  const filtered = records.filter((r) =>
    `${r.name} ${r.kind} ${r.aquifer ?? ""} ${r.county ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selectedMapFeature = wb.selectedFeature
    ? wb.layers.find((l) => l.id === wb.selectedFeature!.layerId)?.data.features[
        wb.selectedFeature.index
      ]
    : undefined;
  const record = records.find(
    (r) => r.id === (selectedMapFeature?.properties?.["waterRecordId"] ?? selected),
  );
  useEffect(() => {
    if (!map || !profileMode) return;
    const place = (event: { lngLat: { lng: number; lat: number } }) => {
      const coordinate: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      const profile = buildWellSiteProfile(records, coordinate);
      setWellProfile(profile);
      setProfileMode(false);
      setPanel(true);
      setTab("Hydrology");
      const groupId =
        wb.groups.find((group) => group.name === "Water & Hydrogeology")?.id ??
        wb.addGroup("Water & Hydrogeology");
      const name = `${HYDROLOGY_LAYER_PREFIX} Proposed well profile`;
      const data = {
        type: "FeatureCollection" as const,
        features: [
          point(coordinate, {
            NAME: "Proposed well profile",
            classification: "LANDDRAFT-DERIVED",
            aquiferCount: profile.aquifers.length,
            analysisMethod: `Nearby well evidence within ${profile.searchRadiusMiles} miles`,
          }),
        ],
      };
      const existing = wb.layers.find((layer) => layer.name === name);
      if (existing) wb.updateLayer(existing.id, { data, visible: true });
      else
        wb.addLayer({
          name,
          groupId,
          data,
          source: {
            kind: "derived",
            sourceLayerId: "water-analysis",
            query: profile.limitation,
            cachedAt: profile.generatedAt,
          },
          style: {
            ...defaultStyle(6),
            fillColor: "#0ea5e9",
            strokeColor: "#082f49",
            strokeWidth: 2,
            pointSize: 10,
            pointIcon: "◉",
            pointIconColor: "#0ea5e9",
            pointIconSize: 24,
          },
        });
    };
    map.getCanvas().style.cursor = "crosshair";
    map.once("click", place);
    return () => {
      map.off("click", place);
      map.getCanvas().style.cursor = "";
    };
  }, [map, profileMode, records, wb]);
  const polygons = useMemo(
    () =>
      wb.layers.flatMap((l) =>
        l.data.features.flatMap((f, i) =>
          f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon"
            ? [{ key: `${l.id}:${i}`, label: `${l.name} · ${i + 1}`, feature: f as WaterArea }]
            : [],
        ),
      ),
    [wb.layers],
  );

  function choose(a: WaterArea) {
    try {
      const valid = validateWaterArea(a);
      run.current++;
      setBusy(false);
      setProgress(null);
      setSelected(null);
      wb.setWaterWorkspace({ version: 1, enabled: true, area: valid });
      // Old study outputs cannot remain visible as results for the new area.
      for (const l of wb.layers.filter(
        (l) => l.name.startsWith(WATER_LAYER_PREFIX) || l.name.startsWith(HYDROLOGY_LAYER_PREFIX),
      ))
        wb.updateLayer(l.id, { visible: false });
      const boundary = wb.layers.find((l) => l.name === "Water study boundary");
      const data = { type: "FeatureCollection" as const, features: [valid] };
      if (boundary) wb.updateLayer(boundary.id, { data, visible: true });
      else
        wb.addLayer({
          name: "Water study boundary",
          data,
          groupId:
            wb.groups.find((g) => g.name === "Water & Hydrogeology")?.id ??
            wb.addGroup("Water & Hydrogeology"),
          source: { kind: "draw" },
          style: {
            fillColor: "#0284c7",
            fillOpacity: 0.06,
            strokeColor: "#0284c7",
            strokeWidth: 2,
          },
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid study area");
    }
  }
  async function importBoundary(file: File) {
    try {
      if (file.size > 10_000_000) throw new Error("Use a boundary file smaller than 10 MB.");
      const imported = await importFile(file);
      const geometries = imported.data.features.flatMap((f) =>
        f.geometry.type === "Polygon"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiPolygon"
            ? f.geometry.coordinates
            : [],
      );
      if (!geometries.length) throw new Error("File contains no polygon boundaries.");
      const valid = validateWaterArea({
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: geometries },
      });
      choose(valid);
      const b = bbox(valid);
      map?.fitBounds(
        [
          [b[0]!, b[1]!],
          [b[2]!, b[3]!],
        ],
        { padding: 50 },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not import boundary");
    }
  }
  async function analyze() {
    if (!study || !wb.canEditProject) return;
    const token = ++run.current;
    setBusy(true);
    setProgress([]);
    setSelected(null);
    const collected: WaterSourceResult[] = [];
    const groupId =
      wb.groups.find((g) => g.name === "Water & Hydrogeology")?.id ??
      wb.addGroup("Water & Hydrogeology");
    for (const old of wb.layers.filter(
      (l) => l.name.startsWith(WATER_LAYER_PREFIX) || l.name.startsWith(HYDROLOGY_LAYER_PREFIX),
    ))
      wb.updateLayer(old.id, { visible: false });
    for (const source of WATER_SOURCES.filter((s) => s.enabled)) {
      if (token !== run.current) return;
      let result: WaterSourceResult;
      try {
        const session = await getCloudSession();
        result = JSON.parse(
          await analyzeWaterSource({
            data: { sourceId: source.id, area: study, accessToken: session.access_token },
          }),
        ) as WaterSourceResult;
      } catch {
        result = {
          sourceId: source.id,
          status: "unavailable",
          records: [],
          retrievedAt: new Date().toISOString(),
          message: "Request failed. Retry this analysis or view the original source.",
          truncated: false,
          requestUrl: "",
          rejectedCount: 0,
        };
      }
      if (token !== run.current) return;
      collected.push(result);
      setProgress([...collected]);
      if (result.records.length) {
        const data = {
          type: "FeatureCollection" as const,
          features: result.records.map((r) => ({
            type: "Feature" as const,
            geometry: r.geometry,
            properties: {
              waterRecordId: r.id,
              NAME: r.name,
              source: source.agency,
              sourceRecordId: r.sourceRecordId,
              sourceUrl: r.sourceUrl,
              classification: r.classification,
              evidence: r.evidence,
              aquifer: r.aquifer,
              wellType: r.kind,
              depthFt: r.depth,
              depthClass:
                r.depth === null
                  ? "Unknown"
                  : r.depth < 100
                    ? "0–99 ft"
                    : r.depth < 300
                      ? "100–299 ft"
                      : r.depth < 600
                        ? "300–599 ft"
                        : r.depth < 1_000
                          ? "600–999 ft"
                          : "1,000+ ft",
              parameterCode: r.measurement?.parameterCode,
              measurementValue: r.measurement?.value,
              measurementUnit: r.measurement?.unit,
              observationTime: r.observationTime,
              retrievedAt: r.retrievedAt,
            },
          })),
        };
        const name = `${WATER_LAYER_PREFIX} ${source.title}`;
        const existing = wb.layers.find((l) => l.name === name);
        if (existing) wb.updateLayer(existing.id, { data, visible: true });
        else
          wb.addLayer({
            name,
            groupId,
            data,
            source: { kind: "import", fileName: `${source.id}-public-records.geojson` },
            style:
              source.id === "twdb-wells"
                ? wellStyle("depth", result.records)
                : source.id === "usgs-sites"
                  ? wellStyle("aquifer", result.records)
                  : {
                      ...defaultStyle(source.id === "usgs-measurements" ? 2 : 1),
                      fillColor:
                        source.id === "twdb-aquifers"
                          ? "#b45309"
                          : source.id === "twdb-minor-aquifers"
                            ? "#a16207"
                            : "#0284c7",
                      fillOpacity:
                        source.id === "twdb-aquifers" || source.id === "twdb-minor-aquifers"
                          ? 0.15
                          : 0.8,
                      pointSize: 5,
                    },
          });
      }
    }
    const hydrology = buildHydrologyProducts(
      collected.flatMap((result) => result.records),
      study,
      wellColorMode,
    );
    for (const product of hydrology.layers) {
      const aquiferProduct = product.data.features.some(
        (feature) => typeof feature.properties?.["aquifer"] === "string",
      );
      const existing = wb.layers.find((layer) => layer.name === product.name);
      if (existing)
        wb.updateLayer(existing.id, {
          data: product.data,
          style: product.style,
          visible: !aquiferProduct,
        });
      else {
        const addedId = wb.addLayer({
          name: product.name,
          groupId,
          data: product.data,
          source: {
            kind: "derived",
            sourceLayerId: "water-analysis",
            query: product.description,
            cachedAt: new Date().toISOString(),
          },
          style: product.style,
        });
        if (aquiferProduct) wb.updateLayer(addedId.id, { visible: false });
      }
    }
    const analysis: WaterAnalysis = {
      id: crypto.randomUUID(),
      version: "water-analysis-2",
      area: study,
      createdAt: new Date().toISOString(),
      results: collected,
      studies: hydrology.studies,
    };
    wb.setWaterWorkspace({ version: 1, enabled: true, area: study, analysis });
    setSelectedAquifer(hydrology.studies.aquifers[0]?.name ?? "");
    setBusy(false);
  }
  function changeWellColorMode(mode: WellColorMode) {
    setWellColorMode(mode);
    const layer = wb.layers.find(
      (item) => item.name === `${HYDROLOGY_LAYER_PREFIX} Wells by attributes`,
    );
    if (layer) wb.updateStyle(layer.id, wellStyle(mode, records));
  }
  function addHydrologyReference(reference: (typeof HYDROLOGY_REFERENCES)[number]) {
    const existing = wb.layers.find(
      (layer) => layer.source.kind === "remote" && layer.source.catalogId === reference.id,
    );
    if (existing) {
      wb.updateLayer(existing.id, { visible: true });
      wb.setActiveLayer(existing.id);
      toast.success(`${reference.name} is visible`);
      return;
    }
    const groupId =
      wb.groups.find((group) => group.name === "Water & Hydrogeology")?.id ??
      wb.addGroup("Water & Hydrogeology");
    const style = {
      ...defaultStyle(reference.geometry === "line" ? 2 : reference.geometry === "point" ? 5 : 3),
      fillColor: reference.color,
      strokeColor: reference.color,
      fillOpacity: reference.geometry === "polygon" ? 0.18 : 0.82,
      strokeWidth: reference.geometry === "line" ? 2 : 1.5,
      pointSize: 5,
    };
    wb.addLayer({
      name: `${HYDROLOGY_REFERENCE_PREFIX} ${reference.name}`,
      groupId,
      data: { type: "FeatureCollection", features: [] },
      source: {
        kind: "remote",
        url: reference.url,
        catalogId: reference.id,
        attribution: reference.agency,
        requiresViewport: true,
        minZoom: reference.minZoom,
      },
      style,
    });
    toast.success(`${reference.name} added`, {
      description: `Loads for the visible map at zoom ${reference.minZoom} or closer.`,
    });
  }
  function showAquiferProducts(name: string) {
    setSelectedAquifer(name);
    const aquiferNames = state?.analysis?.studies?.aquifers.map((item) => item.name) ?? [];
    for (const layer of wb.layers) {
      const owner = aquiferNames.find((aquifer) =>
        layer.name.startsWith(`${HYDROLOGY_LAYER_PREFIX} ${aquifer} ·`),
      );
      if (owner) wb.updateLayer(layer.id, { visible: owner === name });
    }
    const extent = records.find(
      (item) =>
        (item.sourceId === "twdb-aquifers" || item.sourceId === "twdb-minor-aquifers") &&
        (item.name === name || item.aquifer === name),
    );
    if (extent && extent.geometry.type !== "Point" && map) {
      const bounds = bbox({ type: "Feature", properties: {}, geometry: extent.geometry });
      map.fitBounds(
        [
          [bounds[0]!, bounds[1]!],
          [bounds[2]!, bounds[3]!],
        ],
        { padding: 70, maxZoom: 11 },
      );
    }
  }
  function inspect(r: WaterRecord) {
    setSelected(r.id);
    wb.setSelectedFeature(null);
    if (r.geometry.type === "Point")
      map?.flyTo({
        center: r.geometry.coordinates as [number, number],
        zoom: Math.max(map.getZoom(), 12),
      });
  }
  function exportReport() {
    const analysis = state?.analysis;
    if (!analysis) return;
    const studies = analysis.studies;
    const body = [
      `# LandDraft Water evidence report`,
      `Analysis ${analysis.id} · ${analysis.createdAt} · ${analysis.version}`,
      WATER_DISCLAIMER,
      `## Study area\n${(turfArea(analysis.area) / 4046.8564224).toFixed(1)} acres. Study boundary included in the JSON snapshot.`,
      studies
        ? `## Executive screening summary\nLandDraft created hydrogeology screening products from ${studies.wellCount} mapped wells, ${studies.depthSampleCount} usable constructed-depth values, and available comparable groundwater measurements. These products do not establish water availability, current quality, sustainable yield, saturated aquifer thickness, storage volume or drilling suitability.`
        : "## Executive screening summary\nPublic source records were retrieved. No derived hydrogeology study is stored with this earlier analysis. Water availability, current quality, sustainable yield, aquifer thickness and drilling suitability are not established.",
      ...(studies
        ? [
            `## Well-depth distribution\n${Object.entries(studies.depthBands)
              .map(([band, count]) => `- ${band}: ${count}`)
              .join("\n")}`,
            `## Measurement surfaces\n${studies.interpolation
              .map(
                (item) =>
                  `- ${item.label}: ${item.status.replaceAll("_", " ")}; ${item.sampleCount} comparable measurements${item.minimum === null ? "" : `; range ${item.minimum.toFixed(1)}–${item.maximum?.toFixed(1)} ${item.unit ?? ""}`}. ${item.method}. ${item.limitation}`,
              )
              .join("\n")}`,
            `## Aquifer screening\n${
              studies.aquifers.length
                ? studies.aquifers
                    .map(
                      (item) =>
                        `- ${item.name} (${item.extentType.replaceAll("-", " ")}): ${item.wellCount} assigned wells; ${item.depthSampleCount} depth values; ${item.mappedAreaAcres === null ? "mapped footprint unavailable" : `${item.mappedAreaAcres.toFixed(0)} mapped acres`}; storage volume ${item.storageVolumeStatus.toLowerCase()} — ${item.storageVolumeReason}`,
                    )
                    .join("\n")
                : "No source aquifer extent or well-assignment terms were returned."
            }`,
            `## Analysis limitations\n${studies.limitations.map((item) => `- ${item}`).join("\n")}`,
          ]
        : []),
      ...analysis.results.map(
        (r) =>
          `## ${WATER_SOURCES.find((s) => s.id === r.sourceId)?.title}\n${r.status}: ${r.message}\nRetrieved ${r.retrievedAt}. Rejected records: ${r.rejectedCount}.\nSource: ${r.requestUrl || WATER_SOURCES.find((s) => s.id === r.sourceId)?.url}`,
      ),
      "## Next investigations\nObtain original well logs and dated water-level/quality measurements; verify aquifer identity and vertical datum; consult applicable agencies and a qualified hydrogeologist before development.",
      "## Evidence\n" +
        analysis.results
          .flatMap((r) => r.records)
          .map(
            (r) =>
              `- ${r.name} (${r.sourceRecordId}): ${r.kind}; aquifer ${r.aquifer ?? "unknown"}; ${r.classification} / ${r.evidence}; measured ${r.observationTime ?? "date unknown"}; ${r.measurement ? `${r.measurement.originalValue} ${r.measurement.unit ?? "unknown unit"}; ${measurementAge(r.observationTime)}; ${r.measurement.approval ?? "approval unknown"}` : ""}; ${r.sourceUrl}`,
          )
          .join("\n"),
    ].join("\n\n");
    download("landdraft-water-report.md", body, "text/markdown");
  }
  return (
    <div className="app-viewport flex flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <a href="/" className={button} aria-label="Return to LandDraft map">
          <ArrowLeft className="size-4" />
        </a>
        <Droplets className="size-5 text-sky-600" />
        <div className="mr-auto">
          <h1 className="text-sm font-semibold">Water & Hydrogeology</h1>
          <p className="text-xs text-muted-foreground">
            {wb.projectName} · Optional research preview
          </p>
        </div>
        <button className={button} onClick={() => setPanel(!panel)} aria-expanded={panel}>
          <PanelLeft className="size-4" />
          <span className="sr-only">Water tools</span>
        </button>
        <button
          className={button}
          disabled={!wb.canEditProject}
          onClick={() => void wb.saveProject("manual")}
        >
          <Save className="inline size-4" /> Save
        </button>
      </header>
      <main ref={mainRef} className="relative min-h-0 flex-1 overflow-hidden">
        <MapCanvas />
        <FeatureDestinationDialog />
        {printOpen && (
          <Suspense fallback={null}>
            <PrintComposer />
          </Suspense>
        )}
        <div
          className={`absolute right-12 top-3 z-10 max-w-[72%] md:max-w-[42%] ${panel && !panelPosition ? "md:left-[384px]" : ""}`}
        >
          <SearchBox />
        </div>
        <div className="absolute bottom-8 right-3 z-10">
          <BasemapControl />
        </div>
        {profileMode && (
          <div className="absolute left-1/2 top-3 z-40 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-xl border-2 border-sky-600 bg-background px-3 py-2 text-sm shadow-xl">
            <MapPinPlus className="size-4 shrink-0 text-sky-700" />
            <span>Tap the proposed well location.</span>
            <button
              type="button"
              className="rounded-lg p-2 hover:bg-secondary"
              aria-label="Cancel well-profile marker"
              onClick={() => setProfileMode(false)}
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        {panel && (
          <aside
            ref={panelRef}
            aria-label="Water tools"
            style={panelPosition ?? undefined}
            className={`absolute inset-x-2 bottom-3 z-30 max-h-[58%] overflow-auto rounded-2xl border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-auto md:max-h-[calc(100%-24px)] md:w-[360px] ${panelPosition ? "md:inset-auto" : "md:inset-x-auto md:left-3 md:top-3"}`}
          >
            <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-3 hidden items-center justify-between border-b bg-background/95 px-3 py-1.5 backdrop-blur md:flex">
              <button
                type="button"
                className="flex min-h-10 flex-1 touch-none cursor-grab items-center justify-center gap-2 rounded-lg text-xs text-muted-foreground hover:bg-secondary active:cursor-grabbing"
                aria-label="Move water tools panel"
                onPointerDown={(event) => {
                  const frame = mainRef.current?.getBoundingClientRect();
                  const floating = panelRef.current?.getBoundingClientRect();
                  if (!frame || !floating) return;
                  panelDrag.current = {
                    pointerId: event.pointerId,
                    offsetX: event.clientX - floating.left,
                    offsetY: event.clientY - floating.top,
                  };
                  setPanelPosition({
                    left: floating.left - frame.left,
                    top: floating.top - frame.top,
                  });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
              >
                <GripHorizontal className="size-4" /> Move panel
              </button>
              {panelPosition && (
                <button
                  type="button"
                  className="min-h-10 rounded-lg px-2 text-xs hover:bg-secondary"
                  onClick={() => setPanelPosition(null)}
                >
                  Reset
                </button>
              )}
            </div>
            {!state?.enabled ? (
              <>
                <h2 className="font-semibold">Draw an area. Investigate its water.</h2>
                <p className="my-3 text-sm text-muted-foreground">
                  Bring public wells, monitoring sites and source evidence into this project. This
                  preview does not establish drilling suitability or water rights.
                </p>
                <button
                  className={button}
                  disabled={!wb.canEditProject}
                  onClick={() => wb.setWaterWorkspace({ version: 1, enabled: true })}
                >
                  Enable Water for this project
                </button>
              </>
            ) : (
              <>
                <nav className="mb-4 flex gap-1" aria-label="Water sections">
                  {(["Overview", "Hydrology", "Records", "Sources"] as const).map((t) => (
                    <button
                      key={t}
                      aria-pressed={tab === t}
                      className={`${button} ${tab === t ? "bg-secondary font-semibold" : ""}`}
                      onClick={() => setTab(t)}
                    >
                      {t}
                    </button>
                  ))}
                </nav>
                {tab === "Overview" && (
                  <>
                    <h2 className="font-semibold">1. Study area</h2>
                    <div className="my-2 grid grid-cols-2 gap-2">
                      <button
                        className={button}
                        disabled={!map || !wb.canEditProject}
                        onClick={() => {
                          if (map) {
                            const b = map.getBounds();
                            choose(
                              bboxPolygon([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]),
                            );
                          }
                        }}
                      >
                        Use map extent
                      </button>
                      <button
                        className={button}
                        disabled={!wb.canEditProject}
                        onClick={() => {
                          wb.setDrawMode("polygon");
                          setPanel(false);
                        }}
                      >
                        Draw polygon
                      </button>
                    </div>
                    <input
                      ref={upload}
                      type="file"
                      className="hidden"
                      accept=".geojson,.json,.kml,.kmz,.zip"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void importBoundary(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      className={`${button} mb-2 w-full`}
                      disabled={!wb.canEditProject}
                      onClick={() => upload.current?.click()}
                    >
                      Import GeoJSON, KML/KMZ or zipped SHP
                    </button>
                    <label className="block text-xs">
                      Use a project/imported boundary
                      <select
                        className="mt-1 min-h-11 w-full rounded-lg border bg-background p-2 text-sm"
                        value=""
                        disabled={!wb.canEditProject}
                        onChange={(e) => {
                          const p = polygons.find((p) => p.key === e.target.value);
                          if (p) choose(p.feature);
                        }}
                      >
                        <option value="">Select polygon…</option>
                        {polygons.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {study && (
                      <p className="my-2 text-sm">
                        {(turfArea(study) / 4046.8564224).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}{" "}
                        acres · {(turfArea(study) / 2589988.11).toFixed(2)} sq mi
                      </p>
                    )}
                    <button
                      className={`${button} my-3 w-full bg-primary text-primary-foreground`}
                      disabled={!study || busy || !wb.canEditProject}
                      onClick={() => void analyze()}
                    >
                      <Play className="mr-2 inline size-4" />
                      {busy
                        ? `Analyzing · ${results.length}/${WATER_SOURCES.length} sources`
                        : "Analyze Water"}
                    </button>
                    <div role="status" aria-live="polite" className="space-y-2">
                      {results.map((r) => (
                        <div key={r.sourceId} className="rounded-lg border p-3 text-xs">
                          <strong>
                            {WATER_SOURCES.find((s) => s.id === r.sourceId)?.title} · {r.status}
                          </strong>
                          <p className="mt-1">{r.message}</p>
                          <p className="mt-1 text-muted-foreground">
                            Retrieved {new Date(r.retrievedAt).toLocaleString()}; inspect each
                            record for measurement date and age.
                          </p>
                        </div>
                      ))}
                    </div>
                    {results.length > 0 && (
                      <div className="my-3 rounded-lg bg-secondary p-3 text-sm">
                        <strong>Evidence completeness: limited</strong>
                        <p>
                          {records.length} source records. Sensor readings may be historical.
                          Complete chemistry, tested yield, rights and aquifer geometry have not
                          been established.
                        </p>
                        <p className="mt-2 text-xs">
                          Counties in retrieved records:{" "}
                          {[...new Set(records.map((r) => r.county).filter(Boolean))].join(", ") ||
                            "Unknown"}
                          . This is not a boundary intersection survey.
                        </p>
                      </div>
                    )}
                    <button className={button} onClick={() => setPrintOpen(true)}>
                      Compose map / PDF figure
                    </button>
                    {state.analysis && !busy && (
                      <div className="flex flex-wrap gap-2">
                        <button className={button} onClick={exportReport}>
                          <Download className="inline size-4" /> Report (.md)
                        </button>
                        <button
                          className={button}
                          onClick={() =>
                            download(
                              "water-evidence.json",
                              JSON.stringify(state.analysis, null, 2),
                              "application/json",
                            )
                          }
                        >
                          Evidence snapshot
                        </button>
                        <button
                          className={button}
                          onClick={() =>
                            download("water-records.csv", waterCsv(records), "text/csv")
                          }
                        >
                          CSV
                        </button>
                      </div>
                    )}
                  </>
                )}
                {tab === "Hydrology" && (
                  <div className="space-y-3">
                    <section className="rounded-xl border bg-secondary/35 p-3">
                      <div className="flex items-start gap-2">
                        <Layers3 className="mt-0.5 size-4 shrink-0 text-sky-700" />
                        <div>
                          <h2 className="text-sm font-semibold">Hydrogeology screening studies</h2>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Derived LandDraft layers remain separate from official source records.
                            Missing measurements stay unavailable rather than becoming zero.
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-xl border border-sky-600/40 bg-sky-50/50 p-3 text-xs dark:bg-sky-950/20">
                      <div className="flex items-start gap-2">
                        <MapPinPlus className="mt-0.5 size-4 shrink-0 text-sky-700" />
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold">Proposed well depth profile</h3>
                          <p className="mt-1 text-muted-foreground">
                            Drop a marker to compare mapped aquifers with nearby completed-well
                            depths, reported uses, completion dates, and any real yield evidence.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`${button} mt-2 w-full bg-background`}
                        disabled={!records.length}
                        onClick={() => {
                          setProfileMode(true);
                          setPanel(false);
                        }}
                      >
                        <MapPinPlus className="mr-1 inline size-4" /> Drop well marker
                      </button>
                      {wellProfile && <WellProfileGraphic profile={wellProfile} />}
                    </section>

                    {state?.analysis?.studies?.aquifers.length ? (
                      <section className="rounded-xl border p-3 text-xs">
                        <h3 className="font-semibold">Select an aquifer map</h3>
                        <p className="mt-1 text-muted-foreground">
                          Shows that aquifer's LandDraft depth surface and reported-yield evidence
                          layers when enough real source observations exist.
                        </p>
                        <select
                          value={selectedAquifer}
                          onChange={(event) => showAquiferProducts(event.target.value)}
                          className="mt-2 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                        >
                          <option value="" disabled>
                            Choose aquifer
                          </option>
                          {state.analysis.studies.aquifers.map((aquifer) => (
                            <option key={aquifer.name} value={aquifer.name}>
                              {aquifer.name}
                            </option>
                          ))}
                        </select>
                        {selectedAquifer && (
                          <button
                            type="button"
                            className={`${button} mt-2 w-full`}
                            onClick={() => showAquiferProducts(selectedAquifer)}
                          >
                            Show selected aquifer layers
                          </button>
                        )}
                      </section>
                    ) : null}

                    <label className="block text-xs font-semibold">
                      Color the combined well layer by
                      <select
                        value={wellColorMode}
                        onChange={(event) =>
                          changeWellColorMode(event.target.value as WellColorMode)
                        }
                        disabled={!records.length}
                        className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                      >
                        <option value="depth">Constructed depth</option>
                        <option value="aquifer">Source aquifer assignment</option>
                        <option value="type">Well or site type</option>
                      </select>
                    </label>

                    {state?.analysis?.studies ? (
                      <>
                        <section className="rounded-xl border p-3 text-xs">
                          <h3 className="font-semibold">Well depth study</h3>
                          <p className="mt-1 text-muted-foreground">
                            {state.analysis.studies.wellCount} mapped wells ·{" "}
                            {state.analysis.studies.depthSampleCount} usable depth values
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-1">
                            {Object.entries(state.analysis.studies.depthBands).map(
                              ([band, count]) => (
                                <div
                                  key={band}
                                  className="flex items-center justify-between rounded-lg bg-secondary px-2 py-1.5"
                                >
                                  <span>{band}</span>
                                  <strong>{count}</strong>
                                </div>
                              ),
                            )}
                          </div>
                        </section>

                        <section className="rounded-xl border p-3 text-xs">
                          <h3 className="font-semibold">Groundwater surfaces and gradients</h3>
                          <div className="mt-2 space-y-2">
                            {state.analysis.studies.interpolation.map((studyResult) => (
                              <div key={studyResult.id} className="rounded-lg bg-secondary p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <strong>{studyResult.label}</strong>
                                  <span
                                    className={
                                      studyResult.status === "AVAILABLE"
                                        ? "font-semibold text-emerald-700"
                                        : "font-semibold text-amber-700"
                                    }
                                  >
                                    {studyResult.status.replaceAll("_", " ")}
                                  </span>
                                </div>
                                <p className="mt-1">
                                  {studyResult.sampleCount} comparable measurement
                                  {studyResult.sampleCount === 1 ? "" : "s"}
                                  {studyResult.minimum !== null
                                    ? ` · ${studyResult.minimum.toFixed(1)}–${studyResult.maximum?.toFixed(1)} ${studyResult.unit ?? ""}`
                                    : ""}
                                </p>
                                <p className="mt-1 text-muted-foreground">
                                  {studyResult.method}. {studyResult.limitation}
                                </p>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-xl border p-3 text-xs">
                          <h3 className="font-semibold">Aquifer evidence by study area</h3>
                          <p className="mt-1 text-muted-foreground">
                            Footprint area is clipped to the selected study boundary. Storage volume
                            remains unavailable without saturated thickness and storage properties.
                          </p>
                          <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                            {state.analysis.studies.aquifers.slice(0, 40).map((aquifer) => (
                              <div key={aquifer.name} className="rounded-lg bg-secondary p-2">
                                <strong>{aquifer.name}</strong>
                                <p className="mt-0.5 text-muted-foreground">
                                  {aquifer.extentType.replaceAll("-", " ")} · {aquifer.wellCount}{" "}
                                  assigned wells · {aquifer.depthSampleCount} depth samples
                                </p>
                                <p>
                                  {aquifer.mappedAreaAcres === null
                                    ? "Mapped footprint unavailable"
                                    : `${aquifer.mappedAreaAcres.toLocaleString(undefined, { maximumFractionDigits: 0 })} mapped acres`}
                                  {aquifer.medianDepthFt === null
                                    ? " · depth unavailable"
                                    : ` · median well depth ${aquifer.medianDepthFt.toFixed(0)} ft`}
                                </p>
                                <p className="mt-1">
                                  Depth surface:{" "}
                                  {(aquifer.depthSurfaceStatus ?? "INSUFFICIENT_DATA").replaceAll(
                                    "_",
                                    " ",
                                  )}
                                  {" · "}Yield evidence:{" "}
                                  {(aquifer.yieldSurfaceStatus ?? "INSUFFICIENT_DATA").replaceAll(
                                    "_",
                                    " ",
                                  )}
                                  {(aquifer.yieldSampleCount ?? 0)
                                    ? ` (${aquifer.yieldSampleCount} reported values)`
                                    : " (no reported GPM values)"}
                                </p>
                                {Object.keys(aquifer.reportedUses ?? {}).length > 0 && (
                                  <p className="mt-1 text-muted-foreground">
                                    Reported uses:{" "}
                                    {Object.entries(aquifer.reportedUses ?? {})
                                      .slice(0, 4)
                                      .map(([use, count]) => `${use} ${count}`)
                                      .join(" · ")}
                                  </p>
                                )}
                                {aquifer.earliestCompletionYear && aquifer.latestCompletionYear && (
                                  <p className="mt-1 text-muted-foreground">
                                    Retrieved completion history: {aquifer.earliestCompletionYear}–
                                    {aquifer.latestCompletionYear}
                                  </p>
                                )}
                                <p className="mt-1 text-[10px] font-semibold text-amber-700">
                                  Storage volume: unavailable
                                </p>
                              </div>
                            ))}
                            {!state.analysis.studies.aquifers.length && (
                              <p className="text-muted-foreground">
                                No aquifer extent or well-assignment terms were returned.
                              </p>
                            )}
                          </div>
                        </section>
                      </>
                    ) : (
                      <p className="rounded-xl border p-3 text-sm text-muted-foreground">
                        Run Analyze Water to build the well, aquifer, density, and measurement
                        studies for this boundary.
                      </p>
                    )}

                    <section className="rounded-xl border p-3 text-xs">
                      <h3 className="font-semibold">Public hydrology reference layers</h3>
                      <p className="mt-1 text-muted-foreground">
                        Add official visual context. These layers do not become groundwater
                        measurements or inputs to the interpolation automatically.
                      </p>
                      <div className="mt-2 space-y-2">
                        {HYDROLOGY_REFERENCES.map((reference) => {
                          const added = wb.layers.some(
                            (layer) =>
                              layer.source.kind === "remote" &&
                              layer.source.catalogId === reference.id,
                          );
                          return (
                            <div
                              key={reference.id}
                              className="flex items-center gap-2 rounded-lg bg-secondary p-2"
                            >
                              <div className="min-w-0 flex-1">
                                <strong className="block truncate">{reference.name}</strong>
                                <span className="text-[10px] text-muted-foreground">
                                  {reference.agency} · zoom {reference.minZoom}+
                                </span>
                              </div>
                              <a
                                href={reference.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open source for ${reference.name}`}
                                className="rounded-lg p-2 hover:bg-accent"
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                              <button
                                type="button"
                                className={button}
                                onClick={() => addHydrologyReference(reference)}
                              >
                                {added ? "Show" : "Add"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    {wb.layers.some(
                      (layer) =>
                        layer.name.startsWith(HYDROLOGY_LAYER_PREFIX) ||
                        layer.name.startsWith(HYDROLOGY_REFERENCE_PREFIX),
                    ) && (
                      <section className="rounded-xl border p-3 text-xs">
                        <h3 className="font-semibold">Hydrology layers</h3>
                        <div className="mt-2 space-y-1">
                          {wb.layers
                            .filter(
                              (layer) =>
                                layer.name.startsWith(HYDROLOGY_LAYER_PREFIX) ||
                                layer.name.startsWith(HYDROLOGY_REFERENCE_PREFIX),
                            )
                            .map((layer) => (
                              <label
                                key={layer.id}
                                className="flex min-h-11 items-center gap-2 rounded-lg bg-secondary px-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={layer.visible}
                                  onChange={() => wb.toggleVisible(layer.id)}
                                />
                                <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                                <span className="text-[9px] text-muted-foreground">
                                  {layer.data.features.length.toLocaleString()}
                                </span>
                              </label>
                            ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
                {tab === "Records" && (
                  <>
                    <label className="text-xs">
                      Find wells, aquifers or counties
                      <input
                        className="my-2 min-h-11 w-full rounded-lg border bg-background p-2"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search source records"
                      />
                    </label>
                    <p className="mb-2 text-xs">
                      {filtered.length} records · ○ blue USGS · ○ teal TWDB
                    </p>
                    {record && <RecordCard record={record} />}
                    <div className="space-y-1">
                      {filtered.slice(0, 200).map((r) => (
                        <button
                          key={r.id}
                          className="min-h-11 w-full rounded-lg border p-2 text-left text-xs hover:bg-secondary"
                          onClick={() => inspect(r)}
                        >
                          <strong>{r.name}</strong>
                          <span className="block text-muted-foreground">
                            {r.kind} · {r.aquifer ?? "Aquifer unknown"} · {r.sourceId}
                          </span>
                        </button>
                      ))}
                    </div>
                    {filtered.length > 200 && (
                      <p className="text-xs">
                        Showing 200 rows. Narrow the search or export all retrieved records.
                      </p>
                    )}
                    {!records.length && (
                      <p className="text-sm">
                        Analyze an area to retrieve records. No data does not mean no water.
                      </p>
                    )}
                  </>
                )}
                {tab === "Sources" && (
                  <>
                    <h2 className="font-semibold">Water Sources</h2>
                    {WATER_SOURCES.map((s) => (
                      <div key={s.id} className="my-3 rounded-lg border p-3 text-xs">
                        <strong>{s.title}</strong>
                        <p>
                          {s.coverage} · {s.license.replaceAll("_", " ")}
                        </p>
                        <p>
                          Credit: {s.attribution} · reviewed {s.reviewedAt}
                        </p>
                        <div className="mt-2 flex gap-4">
                          <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                            Original source
                          </a>
                          <a href={s.terms} target="_blank" rel="noreferrer" className="underline">
                            Terms
                          </a>
                        </div>
                      </div>
                    ))}
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={optional}
                        onChange={(e) => setOptional(e.target.checked)}
                      />
                      Show all possible layers
                    </label>
                    {optional &&
                      WATER_OPTIONAL_SOURCES.map((s) => (
                        <div
                          key={s.title}
                          className="my-2 rounded-lg border p-3 text-xs text-muted-foreground"
                        >
                          <strong>{s.title} · Unavailable</strong>
                          <p>{s.requirement}</p>
                          <a href={s.url} className="underline" target="_blank" rel="noreferrer">
                            Investigate original source
                          </a>
                        </div>
                      ))}
                  </>
                )}
                {wb.layers.some((l) => isWaterModuleLayer(l.name) && l.data.features.length) && (
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm">
                      Map layers & legends
                    </summary>
                    {wb.layers
                      .filter((l) => isWaterModuleLayer(l.name) && l.data.features.length)
                      .map((l) => (
                        <div key={l.id} className="mb-2 rounded-lg border p-2 text-xs">
                          <label className="flex min-h-11 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={l.visible}
                              onChange={() => wb.toggleVisible(l.id)}
                            />
                            <span>
                              {l.name} ·{" "}
                              {l.data.features[0]?.properties?.["classification"] as string}
                            </span>
                          </label>
                          <label>
                            Opacity
                            <input
                              aria-label={`${l.name} opacity`}
                              type="range"
                              min="0"
                              max="1"
                              step="0.1"
                              value={l.style.fillOpacity}
                              onChange={(e) =>
                                wb.updateStyle(l.id, { fillOpacity: Number(e.target.value) })
                              }
                              className="min-h-11 w-full"
                            />
                          </label>
                        </div>
                      ))}
                  </details>
                )}
                <details className="mt-4 text-xs text-muted-foreground">
                  <summary className="min-h-11 cursor-pointer py-2">
                    Scope, limitations & module settings
                  </summary>
                  <p>{WATER_DISCLAIMER}</p>
                  <p className="my-2">
                    Project enablement is a preference, not a subscription grant. Derived screening
                    layers are identified separately from official source data and retain their
                    stated limitations.
                  </p>
                  <button
                    disabled={!wb.canEditProject}
                    className={button}
                    onClick={() => {
                      run.current++;
                      setBusy(false);
                      wb.setWaterWorkspace({ ...state, enabled: false });
                      for (const l of wb.layers.filter((l) => isWaterModuleLayer(l.name)))
                        wb.updateLayer(l.id, { visible: false });
                    }}
                  >
                    Disable Water
                  </button>
                </details>
              </>
            )}
          </aside>
        )}
        {!panel && (
          <button
            className={`${button} absolute bottom-5 left-3 z-20 bg-background shadow-lg`}
            onClick={() => setPanel(true)}
          >
            Water tools
          </button>
        )}
      </main>
    </div>
  );
}

function WellProfileGraphic({ profile }: { profile: WellSiteProfile }) {
  const usable = profile.aquifers
    .filter((aquifer) => aquifer.estimatedCompletionDepthFt !== null)
    .slice(0, 8);
  const maxDepth = Math.max(
    100,
    ...usable.map(
      (aquifer) => aquifer.maximumCompletionDepthFt ?? aquifer.estimatedCompletionDepthFt ?? 0,
    ),
  );
  return (
    <div className="mt-3 rounded-lg border bg-background p-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <strong>Point profile</strong>
          <p className="text-[10px] text-muted-foreground">
            {profile.coordinate[1].toFixed(5)}, {profile.coordinate[0].toFixed(5)} · nearby evidence
            within {profile.searchRadiusMiles} mi
          </p>
        </div>
        <span className="rounded-full bg-sky-100 px-2 py-1 text-[9px] font-semibold text-sky-800">
          LANDDRAFT SCREENING
        </span>
      </div>
      {usable.length ? (
        <div className="mt-3 overflow-x-auto">
          <div className="relative h-72 min-w-[290px] border-l-2 border-slate-700 pl-12">
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <div
                key={ratio}
                className="absolute left-0 right-0 border-t border-dashed border-slate-300"
                style={{ top: `${ratio * 100}%` }}
              >
                <span className="absolute -left-1 -translate-x-full -translate-y-1/2 text-[9px] text-muted-foreground">
                  {(maxDepth * ratio).toFixed(0)} ft
                </span>
              </div>
            ))}
            {usable.map((aquifer, index) => {
              const estimate = aquifer.estimatedCompletionDepthFt!;
              const top = Math.min(96, Math.max(1, (estimate / maxDepth) * 100));
              return (
                <div
                  key={aquifer.name}
                  className="absolute left-2 right-1 flex -translate-y-1/2 items-center gap-2"
                  style={{ top: `${top}%` }}
                >
                  <span
                    className="size-3 shrink-0 rounded-full border-2 border-white shadow"
                    style={{ background: palettesForProfile[index % palettesForProfile.length] }}
                  />
                  <span className="min-w-0 rounded-md bg-background/95 px-1.5 py-1 shadow-sm">
                    <strong className="block truncate">{aquifer.name}</strong>
                    <span className="block text-[9px] text-muted-foreground">
                      estimated completion {estimate.toFixed(0)} ft · {aquifer.depthSampleCount}{" "}
                      depth samples · {aquifer.confidence.toLowerCase()} confidence
                    </span>
                    <span className="block text-[9px]">
                      {aquifer.estimatedYieldGpm === null
                        ? "Reported yield: insufficient data"
                        : `Estimated from reported tests: ${aquifer.estimatedYieldGpm.toFixed(0)} gpm`}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900">
          No aquifer has three nearby completed-depth records at this point. Missing values were not
          converted to zero.
        </p>
      )}
      <div className="mt-2 space-y-1">
        {profile.aquifers.slice(0, 8).map((aquifer) => (
          <details key={aquifer.name} className="rounded-lg bg-secondary px-2">
            <summary className="min-h-10 cursor-pointer py-2 font-semibold">
              {aquifer.name} · {aquifer.extentType.replaceAll("-", " ")}
            </summary>
            <p>
              Completion-depth evidence: {aquifer.depthSampleCount} samples
              {aquifer.minimumCompletionDepthFt === null
                ? ""
                : ` · observed range ${aquifer.minimumCompletionDepthFt.toFixed(0)}–${aquifer.maximumCompletionDepthFt?.toFixed(0)} ft`}
            </p>
            <p>
              Nearest retrieved well: {aquifer.nearestWellMiles?.toFixed(1) ?? "unknown"} mi · yield
              samples: {aquifer.yieldSampleCount}
            </p>
            {aquifer.earliestCompletionYear && aquifer.latestCompletionYear && (
              <p>
                Retrieved completion history: {aquifer.earliestCompletionYear}–
                {aquifer.latestCompletionYear}
              </p>
            )}
            {Object.keys(aquifer.nearbyReportedUses).length > 0 && (
              <p>
                Nearby reported uses:{" "}
                {Object.entries(aquifer.nearbyReportedUses)
                  .map(([use, count]) => `${use} ${count}`)
                  .join(" · ")}
              </p>
            )}
            <p className="pb-2 text-[10px] text-muted-foreground">{aquifer.limitation}</p>
          </details>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">{profile.limitation}</p>
    </div>
  );
}

const palettesForProfile = ["#0284c7", "#7c3aed", "#16a34a", "#ea580c", "#be123c", "#0891b2"];

function RecordCard({ record: r }: { record: WaterRecord }) {
  return (
    <section
      aria-label="Selected water record"
      className="mb-3 rounded-xl border-2 border-sky-600 p-3 text-xs"
    >
      <h3 className="font-semibold">{r.name}</h3>
      <p className="my-2">
        {r.classification} · {r.evidence}
      </p>
      {r.measurement && (
        <div className="my-2 rounded-lg bg-secondary p-2">
          <strong>
            {r.measurement.originalValue || "No numeric value"}{" "}
            {r.measurement.unit ?? "Unit unknown"}
          </strong>
          <p>
            USGS parameter {r.measurement.parameterCode} ·{" "}
            {r.measurement.approval ?? "Approval unknown"}
          </p>
          <p>
            {measurementAge(r.observationTime)} ·{" "}
            {r.observationTime
              ? `${Math.max(0, Math.floor((Date.now() - Date.parse(r.observationTime)) / 3_600_000))} hours old`
              : "Age unknown"}
          </p>
          <a
            href={`https://api.waterdata.usgs.gov/ogcapi/v1/collections/parameter-codes/items/${encodeURIComponent(r.measurement.parameterCode)}?f=html`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Parameter definition and units
          </a>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2">
        <dt>Aquifer (source term)</dt>
        <dd>{r.aquifer ?? "Unknown"}</dd>
        <dt>Well depth</dt>
        <dd>
          {r.depth === null
            ? "Unknown / unverified units"
            : `${r.depth} ${r.depthUnit} below land surface`}
        </dd>
        <dt>Vertical datum</dt>
        <dd>{r.verticalDatum ?? "Unknown"}</dd>
        <dt>Location accuracy</dt>
        <dd>{r.locationAccuracy ?? "Unknown"}</dd>
        <dt>HUC</dt>
        <dd>{r.huc ?? "Unknown"}</dd>
        <dt>Measured date</dt>
        <dd>{r.observationTime ? new Date(r.observationTime).toLocaleString() : "Unknown"}</dd>
        <dt>Retrieved</dt>
        <dd>{new Date(r.retrievedAt).toLocaleString()}</dd>
      </dl>
      <ul className="my-2 list-disc pl-4">
        {r.flags.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <a
        href={r.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block min-h-11 py-2 underline"
      >
        View original source · {r.sourceRecordId}
      </a>
      <details>
        <summary className="min-h-11 cursor-pointer py-2">How obtained / original fields</summary>
        <p>Direct source record; no interpolation, flow or yield model applied.</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify(r.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}
