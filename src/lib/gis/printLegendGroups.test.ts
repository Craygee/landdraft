import test from "node:test";
import assert from "node:assert/strict";
import { printLegendRows } from "./printLegendGroups.ts";
import { layoutPrintLegend } from "./printLegendLayout.ts";
const groups = [
  { id: "a", name: "Infrastructure", collapsed: true },
  { id: "b", name: "Energy", parentId: "a", collapsed: false },
  { id: "empty", name: "Hidden empty group", collapsed: false },
];
const layers = [
  { id: "one", groupId: "b", name: "Pipeline" },
  { id: "two", groupId: "a", name: "Road" },
  { id: "three", groupId: "b", name: "Transmission" },
  { id: "four", groupId: "missing", name: "Other" },
];
test("print legend groups preserve every included layer, custom names and nested headings", () => {
  const rows = printLegendRows(layers, ["Gas", "Road", "Electric", "Other"], groups, true);
  assert.deepEqual(
    rows.map((row) => row.name),
    [
      "Infrastructure / Energy",
      "Gas",
      "Electric",
      "Infrastructure",
      "Road",
      "Ungrouped layers",
      "Other",
    ],
  );
  assert.deepEqual(
    rows.filter((row) => row.layerIndex !== null).map((row) => row.layerIndex),
    [0, 2, 1, 3],
  );
  assert.deepEqual(
    printLegendRows(layers, [], groups, false).map((row) => row.id),
    layers.map((layer) => layer.id),
  );
  assert.deepEqual(printLegendRows([], [], groups, true), []);
});
test("group headings and all child layers stay in the same print column without clipping", () => {
  const rows = printLegendRows(layers, [], groups, true);
  const layout = layoutPrintLegend(
    rows.map((row) => row.name),
    400,
    100,
    (text) => text.length * 6,
    rows.map((row) => row.layerIndex === null),
  );
  let headingX = 0;
  layout.entries.forEach((entry, index) => {
    if (rows[index]!.layerIndex === null) headingX = entry.x;
    else assert.equal(entry.x, headingX);
    assert.ok(entry.y + Math.max(16, entry.lines.length * 13) <= layout.height);
  });
  assert.equal(layout.entries.length, rows.length);
  assert.ok(layout.width * layout.scale <= 400 + 1e-8);
  assert.ok(layout.height * layout.scale <= 100 + 1e-8);
});
test("unknown or cyclic group references never drop layers or loop", () => {
  const cyclic = [...groups, { id: "loop", name: "Loop", parentId: "loop", collapsed: false }];
  const rows = printLegendRows([{ id: "x", name: "X", groupId: "loop" }], [], cyclic, true);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.name, "Loop");
});
