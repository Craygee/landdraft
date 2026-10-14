import assert from "node:assert/strict";
import test from "node:test";
import {
  attributeRowsToTsv,
  compareAttributeValues,
  matchesAttributeFilter,
  parseAttributeValue,
  parseEditedAttributeValue,
} from "./attributeTable.ts";

test("attribute filters preserve NULL semantics and support numeric comparisons", () => {
  assert.equal(
    matchesAttributeFilter(
      { status: null },
      { id: "1", field: "status", operator: "empty", value: "" },
    ),
    true,
  );
  assert.equal(
    matchesAttributeFilter(
      { depth: 425 },
      { id: "2", field: "depth", operator: "greater_equal", value: "400" },
    ),
    true,
  );
  assert.equal(
    matchesAttributeFilter(
      { county: "Reeves" },
      { id: "3", field: "county", operator: "not_contains", value: "ward" },
    ),
    true,
  );
});

test("attribute sorting is numeric when both values are numeric and leaves missing values last", () => {
  assert.equal(compareAttributeValues("10", "2") > 0, true);
  assert.equal(compareAttributeValues(null, "value") > 0, true);
  assert.equal(compareAttributeValues(null, "value", "desc") > 0, true);
  assert.equal(compareAttributeValues("10", "2", "desc") < 0, true);
  assert.equal(compareAttributeValues("Alpha", "beta") < 0, true);
});

test("typed bulk and cell values retain numbers, booleans, text, and NULL", () => {
  assert.equal(parseAttributeValue("17.5", "number"), 17.5);
  assert.equal(parseAttributeValue("true", "boolean"), true);
  assert.equal(parseAttributeValue("", "null"), null);
  assert.equal(parseEditedAttributeValue("22", 10), 22);
  assert.equal(parseEditedAttributeValue("false", true), false);
  assert.equal(parseEditedAttributeValue("", 10), null);
  assert.throws(() => parseEditedAttributeValue("not-a-number", 10));
});

test("copied rows are tab-separated and flatten multiline values", () => {
  const output = attributeRowsToTsv(
    [{ index: 2, properties: { name: "Well\nA", depth: 300 } }],
    ["name", "depth"],
  );
  assert.equal(output, "Feature\tname\tdepth\n3\tWell A\t300");
});
