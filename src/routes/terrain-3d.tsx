import { lazy, Suspense } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { LandDraftMark } from "@/components/brand/LandDraftMark";
import { AuthGate } from "@/lib/auth";
import { WorkbenchProvider } from "@/lib/gis/store";
import { MapRefProvider } from "@/lib/gis/mapRef";
import { RemoteLayerManager } from "@/components/gis/RemoteLayerManager";

const Terrain3DWorkspace = lazy(() =>
  import("@/components/terrain3d/Terrain3DWorkspace").then((module) => ({
    default: module.Terrain3DWorkspace,
  })),
);

export const Route = createFileRoute("/terrain-3d")({
  head: () => ({
    meta: [
      { title: "Terrain & Site Context 3D — LandDraft" },
      {
        name: "description",
        content:
          "Optional interactive 3D terrain, topography, wetlands and project-context screening workspace.",
      },
    ],
  }),
  component: Terrain3DRoute,
});

function Loading() {
  return (
    <div className="app-viewport flex items-center justify-center bg-background">
      <div className="text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <LandDraftMark className="size-6" />
        </span>
        <p className="mt-3 text-sm font-semibold">Opening Terrain 3D</p>
        <p className="text-xs text-muted-foreground">Preparing the bounded terrain workspace…</p>
      </div>
    </div>
  );
}

function Terrain3DRoute() {
  return (
    <ClientOnly fallback={<Loading />}>
      <AuthGate>
        <WorkbenchProvider>
          <MapRefProvider>
            <Suspense fallback={<Loading />}>
              <Terrain3DWorkspace />
              <RemoteLayerManager />
              <Toaster />
            </Suspense>
          </MapRefProvider>
        </WorkbenchProvider>
      </AuthGate>
    </ClientOnly>
  );
}
