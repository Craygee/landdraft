import { CircleCheck } from "lucide-react";
import { useWorkbench } from "@/lib/gis/store";

/** Presence on this map, independently of connection health or viewport coverage. */
export function PublicLayerAddedBadge({
  catalogId,
  accountServiceId,
}: {
  catalogId?: string;
  accountServiceId?: string;
}) {
  const wb = useWorkbench();
  const matches = wb.displayLayers.filter(
    ({ source }) =>
      (source.kind === "remote" || source.kind === "import") &&
      ((catalogId && source.catalogId === catalogId) ||
        (accountServiceId &&
          source.kind === "remote" &&
          source.accountServiceId === accountServiceId)),
  );
  if (!matches.length) return null;
  const visible = matches.filter((layer) => layer.visible).length;
  return (
    <span
      className="my-1 inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
      title={matches
        .map((layer) => `${layer.name} (${layer.visible ? "visible" : "hidden"})`)
        .join("; ")}
    >
      <CircleCheck size={13} className="shrink-0" aria-hidden="true" />
      Added to map{matches.length > 1 ? ` · ${matches.length} layers` : ""} ·{" "}
      {visible ? (visible === matches.length ? "visible" : `${visible} visible`) : "hidden"}
    </span>
  );
}
