import { X, NotebookPen } from "lucide-react";
import { useWorkbench } from "@/lib/gis/store";
import { useMapRef } from "@/lib/gis/mapRef";
export function SharedNotesPanel() {
  const wb = useWorkbench();
  const { setRecordsOpen } = useMapRef();
  if (wb.canEditProject || !wb.canViewNotes) return null;
  const notes = [
    ...wb.records.notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      scope: "Project",
      date: n.updatedAt,
    })),
    ...wb.records.layerNotes.map((n) => ({
      id: n.id,
      title: n.subject,
      body: n.body,
      scope: wb.layers.find((l) => l.id === n.layerId)?.name ?? "Layer",
      date: n.updatedAt,
    })),
  ];
  return (
    <section
      role="dialog"
      aria-label="Shared project and layer notes"
      className="panel-surface fixed inset-x-3 top-[max(4.5rem,env(safe-area-inset-top))] z-[95] mx-auto flex max-h-[80dvh] max-w-xl flex-col overflow-hidden rounded-2xl"
    >
      <header className="flex items-center gap-2 border-b p-4">
        <NotebookPen className="size-4" />
        <h2 className="flex-1 font-semibold">Shared notes · read only</h2>
        <button
          aria-label="Close shared notes"
          onClick={() => setRecordsOpen(false)}
          className="p-2"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="space-y-3 overflow-y-auto p-4">
        {!notes.length && (
          <p className="text-sm text-muted-foreground">No project or layer notes were included.</p>
        )}
        {notes.map((note) => (
          <article key={note.id} className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">
              {note.scope} · {new Date(note.date).toLocaleString()}
            </p>
            <h3 className="mt-1 font-semibold">{note.title}</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{note.body}</p>
          </article>
        ))}
        {wb.records.summary && (
          <article className="rounded-xl border p-3">
            <h3 className="font-semibold">Project summary</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{wb.records.summary}</p>
          </article>
        )}
      </div>
    </section>
  );
}
