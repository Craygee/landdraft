import { lazy, Suspense } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { LandDraftMark } from "@/components/brand/LandDraftMark";
import { AuthGate } from "@/lib/auth";
import { WorkbenchProvider } from "@/lib/gis/store";

const StudyReportWorkspace = lazy(() =>
  import("@/components/studyReport/StudyReportWorkspace").then((module) => ({
    default: module.StudyReportWorkspace,
  })),
);

export const Route = createFileRoute("/study-report")({
  head: () => ({
    meta: [
      { title: "Study Area Report — LandDraft" },
      {
        name: "description",
        content:
          "Optional source-attributed study-area analysis, mapped figures and editable report workspace.",
      },
    ],
  }),
  component: StudyReportRoute,
});

function Loading() {
  return (
    <div className="app-viewport flex items-center justify-center bg-background">
      <div className="text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <LandDraftMark className="size-6" />
        </span>
        <p className="mt-3 text-sm font-semibold">Opening Study Area Report</p>
        <p className="text-xs text-muted-foreground">
          Preparing project evidence and report tools…
        </p>
      </div>
    </div>
  );
}

function StudyReportRoute() {
  return (
    <ClientOnly fallback={<Loading />}>
      <AuthGate>
        <WorkbenchProvider>
          <Suspense fallback={<Loading />}>
            <StudyReportWorkspace />
            <Toaster />
          </Suspense>
        </WorkbenchProvider>
      </AuthGate>
    </ClientOnly>
  );
}
