import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultFeatureCalloutFields,
  featureCalloutLines,
  printableFeatureAttributes,
} from "./printCallouts.ts";

test("keeps printable public attributes and rejects internal or nested values", () => {
  assert.deepEqual(
    printableFeatureAttributes({
      NAME: "Station A",
      VOLTAGE: 345,
      ACTIVE: true,
      EMPTY: null,
      __label: "internal",
      nested: { unsafe: true },
    }),
    { NAME: "Station A", VOLTAGE: 345, ACTIVE: true, EMPTY: null },
  );
});

test("prefers descriptive feature fields", () => {
  assert.deepEqual(
    defaultFeatureCalloutFields({ OBJECTID: 9, VOLTAGE: 138, OWNER: "Utility", NAME: "Line 1" }),
    ["NAME", "OWNER", "OBJECTID", "VOLTAGE"],
  );
});

test("creates one printable line per selected attribute", () => {
  assert.deepEqual(
    featureCalloutLines("Feature details", { NAME: "Line 1", VOLTAGE: 138 }, ["NAME", "VOLTAGE"]),
    ["Feature details", "NAME: Line 1", "VOLTAGE: 138"],
  );
});
