import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fetchTexasParcels } from "../src/lib/gis/texasParcels.ts";
const rows = JSON.parse(await readFile(".data/texas-parcels/validation-areas.json", "utf8"));
const results = [];
for (const area of rows) {
  const start = Date.now();
  const result = await fetchTexasParcels({ bbox: area.bbox, maxTotalFeatures: 40000 });
  const ids = result.data.features.map((f) => Number(f.properties.OBJECTID)).sort((a, b) => a - b);
  const outcome = {
    name: area.name,
    count: ids.length,
    expected: area.ids.length,
    ms: Date.now() - start,
    complete: result.complete,
  };
  console.log(JSON.stringify(outcome));
  results.push(outcome);
  assert.deepEqual(
    ids,
    area.ids.sort((a, b) => a - b),
    `${area.name}: hosted index differs from source geometry scan`,
  );
}
await writeFile(".data/texas-parcels/validation-results.json", JSON.stringify(results, null, 2));
