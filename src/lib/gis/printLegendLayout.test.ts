import test from "node:test";
import assert from "node:assert/strict";
import { layoutPrintLegend, wrapLegendText } from "./printLegendLayout.ts";
const measure = (s: string) => s.length * 6;
test("print legends retain all rows, wrapping names instead of ellipsizing", () => {
  const names = Array.from({ length: 80 }, (_, i) => `Layer ${i} with a long full property name`);
  const layout = layoutPrintLegend(names, 500, 600, measure);
  assert.deepEqual(
    layout.entries.map((e) => e.name),
    names,
  );
  assert.ok(layout.columns > 1);
  assert.ok(layout.width * layout.scale <= 500 + 1e-8);
  assert.ok(layout.height * layout.scale <= 600 + 1e-8);
  for (const e of layout.entries)
    assert.ok(e.y + Math.max(16, e.lines.length * 13) <= layout.height);
});
test("long unbroken names fit the text column without lost characters", () => {
  const name = "A".repeat(180),
    lines = wrapLegendText(name, 126, measure);
  assert.equal(lines.join(""), name);
  assert.ok(lines.every((s) => measure(s) <= 126));
});
test("small and empty print frames never drop entries or produce invalid sizes", () => {
  for (const count of [0, 1, 22, 23, 200]) {
    const p = layoutPrintLegend(
      Array.from({ length: count }, (_, i) => `Layer ${i}`),
      100,
      150,
      measure,
    );
    assert.equal(p.entries.length, count);
    assert.ok(p.scale > 0 && Number.isFinite(p.scale));
    assert.ok(p.width * p.scale <= 100 + 1e-8);
    assert.ok(p.height * p.scale <= 150 + 1e-8);
  }
});
