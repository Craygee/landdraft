import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseDbf } from "shpjs";
import type { GisLayer } from "./types.ts";
import { defaultStyle } from "./types.ts";
import { buildLayerSpecs } from "./mapStyle.ts";
import { applyGroupStyle } from "./groupStyle.ts";
import { layerOpacity } from "./layerOpacity.ts";
import { checkedLayersArchive, styledExportItems } from "./selectedLayerExport.ts";
import { kmlColor, resolveExportStyle, iconKey } from "./exportStyle.ts";
import { toKml } from "./exportGeometry.ts";
import type { Map } from "maplibre-gl";
const layer: GisLayer = {
  id: "test",
  name: "Styled & grouped",
  groupId: "g",
  visible: true,
  createdAt: 0,
  source: { kind: "draw" },
  data: {
    type: "FeatureCollection",
    features: ["A", "B"].map((className, i) => ({
      type: "Feature",
      properties: { CLASS: className, NAME: `Owner ${className}`, LD_STYLE: "keep" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [i, 0],
            [i + 0.5, 0],
            [i + 0.5, 0.5],
            [i, 0.5],
            [i, 0],
          ],
        ],
      },
    })),
  },
  style: {
    ...defaultStyle(),
    opacity: 0.5,
    fillOpacity: 0.4,
    strokeOpacity: 0.8,
    labelEnabled: true,
    labelFields: ["NAME"],
    labelTemplate: "{NAME}",
    categorized: {
      enabled: true,
      field: "CLASS",
      rules: [
        { value: "A", label: "A", color: "#ff0000", visible: true },
        { value: "B", label: "B", color: "#0000ff", visible: true },
      ],
      fallbackColor: "#00ff00",
      fallbackVisible: false,
    },
  },
};
const matchValue = (value: unknown, key: string): number => {
  if (typeof value === "number") return value;
  const expr = value as unknown[];
  for (let i = 2; i < expr.length - 1; i += 2) if (expr[i] === key) return expr[i + 1] as number;
  return expr.at(-1) as number;
};
test("master opacity and fill opacity affect attribute colors, points, lines, extrusion and labels with no opacity floor", () => {
  for (const opacity of [0, 0.4, 1]) {
    const input = { ...layer, style: { ...layer.style, opacity } };
    const specs = buildLayerSpecs(input, { hasImage: () => true } as unknown as Map);
    const paint = (type: string) =>
      specs.find((item) => item.type === type)!.paint as Record<string, unknown>;
    assert.equal(matchValue(paint("fill")["fill-opacity"], "A"), opacity * 0.4);
    assert.equal(matchValue(paint("line")["line-opacity"], "A"), opacity * 0.8);
    assert.equal(matchValue(paint("circle")["circle-opacity"], "A"), opacity * 0.4);
    assert.equal(paint("fill-extrusion")["fill-extrusion-opacity"], opacity * 0.4);
    const labels = specs.find((item) => item.id === "label-test");
    assert.equal((labels?.paint as Record<string, unknown>)?.["text-opacity"], opacity);
    assert.equal(matchValue(paint("fill")["fill-opacity"], "unmatched"), 0);
  }
  assert.equal(layerOpacity({}), 1);
  assert.equal(layerOpacity({ opacity: -2 }), 0);
});
test("shared master opacity reaches nested categorized layers without replacing category rules", () => {
  const child = { ...layer, id: "child", groupId: "nested" };
  const updated = applyGroupStyle(
    [layer, child],
    [{ id: "nested", name: "Nested", parentId: "g", collapsed: true }],
    "g",
    { opacity: 0.25 },
  );
  updated.forEach((item) => {
    assert.equal(item.style.opacity, 0.25);
    assert.equal(item.style.categorized, layer.style.categorized);
  });
});
test("KML encodes ABGR alpha and per-feature category styles and label content", () => {
  assert.equal(kmlColor("#ff0000", 0.5), "800000ff");
  const kml = toKml(layer.data, layer.name, layer.style);
  assert.ok(kml.includes("330000ff"));
  assert.ok(kml.includes("33ff0000"));
  assert.ok(kml.includes("Owner A"));
  assert.ok(kml.includes("Owner B"));
  assert.equal((kml.match(/<Style>/g) || []).length, 2);
});
test("KMZ retains independent styles in multipart layer mode and bundles marker images", async () => {
  const icon = resolveExportStyle(layer.style, layer.data.features[0]!.properties);
  const prepared = {
    ...layer,
    exportIcons: { [iconKey(icon)]: "data:image/png;base64,iVBORw0KGgo=" },
  };
  const zip = await JSZip.loadAsync(await checkedLayersArchive([prepared], "kmz", "layers"));
  const kml = await zip.file("doc.kml")!.async("string");
  assert.equal((kml.match(/<Placemark>/g) || []).length, 2);
  assert.ok(kml.includes("330000ff"));
  assert.ok(kml.includes("33ff0000"));
  const hrefs = Array.from(kml.matchAll(/<href>([^<]+)<\/href>/g)).map((hit) => hit[1]!);
  assert.ok(hrefs.some((path) => Boolean(zip.file(path))));
  assert.ok(Object.keys(zip.files).some((path) => path.endsWith("styles.json")));
});
test("styled SHP carries SLD, correct DBF style keys and intact source attributes", async () => {
  const prepared = styledExportItems(layer, "features");
  assert.notEqual(prepared.styleField, "LD_STYLE");
  const zip = await JSZip.loadAsync(await checkedLayersArchive([layer], "shp", "features"));
  const sldPath = Object.keys(zip.files).find((path) => path.endsWith(".sld"))!;
  assert.ok(sldPath);
  const sld = await zip.file(sldPath)!.async("string");
  assert.ok(sld.includes("#ff0000"));
  assert.ok(sld.includes("#0000ff"));
  assert.ok(sld.includes('name="fill-opacity">0.2'));
  const dbfPath = sldPath.replace(/\.sld$/, ".dbf");
  const rows = parseDbf(
    await zip.file(dbfPath)!.async("arraybuffer"),
    new TextEncoder().encode("UTF-8").buffer,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!["LD_STYLE"], "keep");
  assert.ok(sld.includes(`<ogc:PropertyName>${prepared.styleField}</ogc:PropertyName>`));
  assert.deepEqual(
    rows.map((row) => row![prepared.styleField]),
    ["s0", "s1"],
  );
  assert.ok(sld.includes("LD_LABEL"));
  assert.equal(layer.data.features[0]!.properties!["LD_STYLE"], "keep");
});
