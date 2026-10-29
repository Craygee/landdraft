import { writeFile } from "node:fs/promises";
import { fetchTexasParcels } from "../src/lib/gis/texasParcels.ts";
const rows = [];
for (const [name, bbox] of [
  ["Austin", [-97.751, 30.265, -97.74, 30.275]],
  ["San Antonio", [-98.5, 29.42, -98.49, 29.43]],
  ["El Paso", [-106.49, 31.75, -106.48, 31.76]],
  ["Rural west Texas", [-104.7, 30.7, -104.69, 30.71]],
]) {
  const start = Date.now();
  const result = await fetchTexasParcels({ bbox, maxTotalFeatures: 40000 });
  const ids = result.data.features.map((f) => Number(f.properties.OBJECTID)).sort((a, b) => a - b);
  rows.push({ name, bbox, ids, ms: Date.now() - start, complete: result.complete });
  console.log(
    JSON.stringify({ name, count: ids.length, ms: Date.now() - start, complete: result.complete }),
  );
}
await writeFile(".data/texas-parcels/hosted-validation.json", JSON.stringify(rows));
