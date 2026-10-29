import "./lib/error-capture";
import { accessMiddleware } from "./lib/access.server";

import { LANDDRAFT_APP_CHANNEL } from "./lib/appVersion";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { runWithWeatherContext } from "./lib/weather/runtimeContext.server";
import { handleNativeRadarProxy } from "./lib/weather/nativeRadar.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function applyEnvironmentHeaders(response: Response): Response {
  if (LANDDRAFT_APP_CHANNEL !== "test") return response;

  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return runWithWeatherContext(env, request, async () => {
      try {
        const access = await accessMiddleware(request, {
          enabled: import.meta.env["VITE_LANDDRAFT_ACCESS_ENFORCEMENT"] === "true",
          url: import.meta.env["VITE_SUPABASE_URL"],
          key:
            import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
            import.meta.env["VITE_SUPABASE_ANON_KEY"],
        });
        if (access) return access;
        if (new URL(request.url).pathname === "/api/weather/point") {
          const { handleWeatherPointRequest } = await import("./lib/weather/pointRequest.server");
          const response = await handleWeatherPointRequest(request);
          if (response) return applyEnvironmentHeaders(response);
        }
        if (new URL(request.url).pathname === "/api/analysis/buildable-terrain") {
          const { handleBuildableTerrainRequest } =
            await import("./lib/gis/buildableTerrain.server");
          const response = await handleBuildableTerrainRequest(request);
          if (response) return applyEnvironmentHeaders(response);
        }
        if (new URL(request.url).pathname === "/api/pipeline/elevation") {
          const { handlePipelineElevationRequest } = await import("./lib/pipeline/terrain.server");
          const response = await handlePipelineElevationRequest(request);
          if (response) return applyEnvironmentHeaders(response);
        }
        if (new URL(request.url).pathname === "/api/public-data/census-state-boundaries") {
          const { handlePublicDataDownload } = await import("./lib/gis/publicData.server");
          const response = await handlePublicDataDownload(request);
          if (response) return applyEnvironmentHeaders(response);
        }
        const nativeRadar = await handleNativeRadarProxy(request, env);
        if (nativeRadar) return applyEnvironmentHeaders(nativeRadar);
        if (new URL(request.url).pathname.startsWith("/api/weather/xweather/"))
          return new Response("External weather provider connections have been removed.", {
            status: 410,
          });
        const handler = await getServerEntry();
        const response = await handler.fetch(request, env, ctx);
        return applyEnvironmentHeaders(await normalizeCatastrophicSsrResponse(response));
      } catch (error) {
        console.error(error);
        return applyEnvironmentHeaders(
          new Response(renderErrorPage(), {
            status: 500,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
      }
    });
  },
};
