import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInPointIcon,
  defaultPointIconForLayer,
  normalizePointIconPreferences,
  pointIconTypes,
} from "./defaultPointIcons.ts";
import { markerIcons } from "./markerIcons.ts";

test("every type maps to an existing icon", () => {
  for (const type of pointIconTypes) assert.ok(builtInPointIcon(type.id), type.id);
  assert.equal(new Set(pointIconTypes.map((t) => t.id)).size, pointIconTypes.length);
  assert.ok(markerIcons.length > 0);
});

test("names pick fitting icons", () => {
  const icon = (id: string) => markerIcons.find((i) => i.id === id)!.symbol;
  assert.equal(defaultPointIconForLayer("Groundwater Wells"), icon("well"));
  assert.equal(defaultPointIconForLayer("West Virginia Oil & Gas Wells — WVDEP"), icon("oil"));
  assert.equal(defaultPointIconForLayer("Wind Turbine Locations"), icon("wind"));
  assert.equal(defaultPointIconForLayer("Large-Scale Solar Facilities"), icon("solar"));
  assert.equal(defaultPointIconForLayer("Substations"), icon("substation"));
  assert.equal(defaultPointIconForLayer("My Dam inspection"), icon("dam"));
  assert.equal(defaultPointIconForLayer("Random notes"), "");
});

test("account override wins, empty override means plain circle", () => {
  assert.equal(defaultPointIconForLayer("Water wells", { well: "★" }), "★");
  assert.equal(defaultPointIconForLayer("Water wells", { well: "" }), "");
  assert.equal(defaultPointIconForLayer("Water wells", { dam: "★" }), "◉");
});

test("preferences are sanitised", () => {
  assert.deepEqual(normalizePointIconPreferences({ well: "★", bogus: "x", dam: 5 }), { well: "★" });
  assert.deepEqual(normalizePointIconPreferences(null), {});
});

test("new point layers get a suggested icon unless one was chosen", async () => {
  const { suggestedPointIconStyle } = await import("./defaultPointIcons.ts");
  const point = { type: "Point" };
  const layer = (over: object = {}) => ({
    name: "Groundwater Wells",
    data: { features: [{ geometry: point }] },
    source: { kind: "import" },
    ...over,
  });
  assert.deepEqual(suggestedPointIconStyle(layer()), { pointIcon: "◉" });
  assert.deepEqual(suggestedPointIconStyle(layer({ style: { pointIcon: "★" } })), {});
  assert.deepEqual(
    suggestedPointIconStyle(layer({ data: { features: [{ geometry: { type: "Polygon" } }] } })),
    {},
  );
  assert.deepEqual(suggestedPointIconStyle(layer({ source: { kind: "derived" } })), {});
  assert.deepEqual(
    suggestedPointIconStyle(
      layer({ data: { features: [] }, source: { kind: "remote" } }),
      {},
      "point",
    ),
    { pointIcon: "◉" },
  );
  assert.deepEqual(suggestedPointIconStyle(layer(), { well: "★" }), { pointIcon: "★" });
});
