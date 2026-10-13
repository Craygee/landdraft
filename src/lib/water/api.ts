import { createServerFn } from "@tanstack/react-start";
import { validateWaterArea } from "./model";
import type { WaterSourceId } from "./types";

export const analyzeWaterSource = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = input as { sourceId?: string; area?: unknown; accessToken?: string };
    if (
      !v ||
      ![
        "usgs-sites",
        "twdb-wells",
        "twdb-well-reports",
        "usgs-measurements",
        "twdb-aquifers",
        "twdb-minor-aquifers",
      ].includes(v.sourceId ?? "")
    )
      throw new Error("Unknown water source");
    if (typeof v.accessToken !== "string" || v.accessToken.length > 8192)
      throw new Error("Sign in to analyze water.");
    return {
      sourceId: v.sourceId as WaterSourceId,
      area: validateWaterArea(v.area),
      accessToken: v.accessToken,
    };
  })
  .handler(async ({ data }) => {
    const { fetchWaterSource } = await import("./gateway.server");
    const { requireWaterAccess } = await import("./access.server");
    await requireWaterAccess(data.accessToken);
    return JSON.stringify(await fetchWaterSource(data.sourceId, data.area));
  });
