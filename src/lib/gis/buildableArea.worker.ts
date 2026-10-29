import { calculateBuildable } from "./buildableArea";
import { terrainRules, terrainFailure } from "./buildableTerrain";
import { holdUnresolvedChecks } from "./buildableAutomation";
import type { BuildableInput } from "./buildableAreaModel";
import type { TerrainGrid } from "./buildableTerrainModel";
self.onmessage = (
  event: MessageEvent<{ input: BuildableInput; terrain?: TerrainGrid | { error: string } }>,
) => {
  try {
    let input = event.data.input;
    if (input.automation) {
      let generated = [] as ReturnType<typeof terrainRules>;
      if (input.automation.terrain.enabled) {
        try {
          if (!event.data.terrain || "error" in event.data.terrain)
            throw new Error(
              event.data.terrain && "error" in event.data.terrain
                ? event.data.terrain.error
                : "Terrain grid unavailable",
            );
          generated = terrainRules(input, event.data.terrain);
        } catch (error) {
          generated = [
            terrainFailure(
              input,
              error instanceof Error ? error.message : "Terrain analysis failed",
            ),
          ];
        }
      }
      input = holdUnresolvedChecks({
        ...input,
        rules: [...input.rules.filter((r) => r.generated !== "terrain"), ...generated],
      });
    }
    self.postMessage({ ok: true, input, result: calculateBuildable(input) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Geometry calculation failed.",
    });
  }
};
