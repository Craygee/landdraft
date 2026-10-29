import { useState } from "react";
import { Building2, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMapRef } from "@/lib/gis/mapRef";
import { useWorkbench } from "@/lib/gis/store";

const modules = [
  {
    name: "Water & Hydrogeology",
    href: "/water",
    description: "Water research, wells, aquifers, and source-backed reports. Foundation preview.",
  },
  {
    name: "Weather & Meteorology",
    href: "/weather",
    description: "Weather visualization, observations, and source inspection.",
  },
  {
    name: "Storm Chaser",
    href: "/weather?view=storm-chaser",
    description: "Storm context, official warnings, and field-operation tools.",
  },
  {
    name: "Photography & Observation",
    href: "/weather?view=photography",
    description:
      "Observation planning and photography analysis; availability depends on supporting data.",
  },
  {
    name: "Pipeline Engineering",
    href: "/pipeline",
    description: "Route planning, hydraulic screening, quantities, and estimating.",
    edit: true,
  },
];

export function LandDraftTools() {
  const [open, setOpen] = useState(false);
  const { canEditProject } = useWorkbench();
  const { setAnalysisOpen, setAssistantOpen, setPrintOpen, setSiteDesignerOpen } = useMapRef();
  const actions = [
    {
      name: "Site Designer",
      description: "Place buildings, trees, ponds, utilities, and georeferenced design overlays.",
      run: () => setSiteDesignerOpen(true),
      edit: true,
      icon: <Building2 className="size-4" />,
    },
    {
      name: "LandDraft AI",
      edit: true,
      description: "Research, map queries, and project assistance.",
      run: () => setAssistantOpen(true),
    },
    {
      name: "Spatial Analysis",
      description: "Buffers, intersections, centroids, and derived layers.",
      run: () => setAnalysisOpen(true),
      edit: true,
    },
    {
      name: "Map & Report Composer",
      description: "Create printable maps with legends and attribution.",
      run: () => setPrintOpen(true),
    },
  ];
  const card =
    "block min-h-12 rounded-xl border border-border p-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-2 text-xs font-semibold hover:bg-accent"
          title="LandDraft custom tools and modules"
        >
          <Wrench className="size-4" /> LandDraft tools
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogTitle>LandDraft Custom Tools</DialogTitle>
        <DialogDescription>
          LandDraft-built workspaces and workflows. Public datasets, third-party services, and their
          licenses retain their original ownership and attribution.
        </DialogDescription>
        <section aria-label="Specialist modules" className="grid gap-2 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Specialist modules</h2>
          {modules
            .filter((tool) => !tool.edit || canEditProject)
            .map((tool) => (
              <a key={tool.name} href={tool.href} className={card}>
                <strong className="block text-sm">{tool.name}</strong>
                <span className="text-xs text-muted-foreground">{tool.description}</span>
              </a>
            ))}
        </section>
        <section aria-label="Project tools" className="grid gap-2 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Project tools</h2>
          {actions
            .filter((tool) => !tool.edit || canEditProject)
            .map((tool) => (
              <button
                key={tool.name}
                className={card}
                onClick={() => {
                  setOpen(false);
                  tool.run();
                }}
              >
                <strong className="flex items-center gap-1.5 text-sm">
                  {"icon" in tool ? tool.icon : null}
                  {tool.name}
                </strong>
                <span className="text-xs text-muted-foreground">{tool.description}</span>
              </button>
            ))}
        </section>
      </DialogContent>
    </Dialog>
  );
}
