import assert from "node:assert/strict";
import test from "node:test";
import { tooltipPosition } from "./tooltipPosition.ts";

test("long hover popups stay inside every viewport edge", () => {
  const viewport = { left: 0, top: 0, width: 390, height: 700 };
  for (const anchor of [
    { left: 0, right: 20, top: 0, bottom: 20 },
    { left: 370, right: 390, top: 670, bottom: 700 },
    { left: -100, right: 500, top: 300, bottom: 320 },
  ]) {
    const result = tooltipPosition(anchor, { width: 336, height: 180 }, viewport);
    assert.ok(result.x >= 12 && result.x + 336 <= 378);
    assert.ok(result.y >= 12 && result.y + 180 <= 688);
  }
});

test("placement respects the offset visual viewport when zoomed", () => {
  const result = tooltipPosition(
    { left: 500, right: 530, top: 800, bottom: 830 },
    { width: 200, height: 120 },
    { left: 200, top: 400, width: 300, height: 400 },
  );
  assert.deepEqual(result, { x: 288, y: 668 });
});
