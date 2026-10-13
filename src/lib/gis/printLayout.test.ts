import test from "node:test";
import assert from "node:assert/strict";

import { PRINT_PAPER_OPTIONS, printPageGeometry } from "./printLayout.ts";

test("Letter landscape uses an exact 11 by 8.5 inch page", () => {
  const page = printPageGeometry("letter", "landscape");

  assert.equal(page.widthInches, 11);
  assert.equal(page.heightInches, 8.5);
  assert.equal(page.widthPixels, 1056);
  assert.equal(page.heightPixels, 816);
  assert.equal(page.widthPoints, 792);
  assert.equal(page.heightPoints, 612);
  assert.equal(page.cssWidth, "11in");
  assert.equal(page.cssHeight, "8.5in");
});

test("paper picker provides common North American and ISO sheet sizes", () => {
  assert.deepEqual(
    PRINT_PAPER_OPTIONS.map((option) => option.value),
    ["letter", "legal", "tabloid", "a5", "a4", "a3"],
  );
  assert.match(
    PRINT_PAPER_OPTIONS.find((option) => option.value === "letter")?.label ?? "",
    /8.5 × 11 in/,
  );
  assert.equal(printPageGeometry("a5", "landscape").displayDimensions, "210 × 148 mm");
});
