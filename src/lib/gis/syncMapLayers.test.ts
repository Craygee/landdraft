import assert from "node:assert/strict";
import test from "node:test";
import { syncMapLayers } from "./syncMapLayers.ts";
test("a broken overlay does not prevent parcels or later overlays from synchronizing", () => {
  const entries = ["broken", "parcels", "roads"].map((id) => ({ layer: { id } }));
  const drawn: string[] = [];
  const errors = syncMapLayers(entries, ({ layer }) => {
    if (layer.id === "broken") throw new Error("Invalid overlay source");
    drawn.push(layer.id);
  });
  assert.deepEqual(drawn, ["parcels", "roads"]);
  assert.deepEqual(errors, { broken: "Invalid overlay source" });
  assert.deepEqual(
    syncMapLayers(entries, () => {}),
    {},
  );
});
