import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, ListTree, X } from "lucide-react";

import { useWorkbench } from "@/lib/gis/store";

function featureName(properties: Record<string, unknown>, fallback: string): string {
  for (const key of ["NAME", "name", "TITLE", "title", "OWNER_NAME", "Prop_ID", "GEO_ID"]) {
    const value = properties[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return fallback;
}

function formatPrimitive(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "Unavailable";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number")
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  if (typeof value === "string") return value || "Empty string";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isAttachment(value: unknown): value is {
  name?: string;
  type?: string;
  size?: number;
  addedAt?: string;
  dataUrl?: string;
} {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function AttributeValue({ name, value }: { name: string; value: unknown }) {
  if (name === "ATTACHMENTS" && Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">No attachments</span>;
    return (
      <div className="space-y-1.5">
        {value.map((item, index) => {
          if (!isAttachment(item)) return <pre key={index}>{formatPrimitive(item)}</pre>;
          return (
            <div
              key={`${item.name ?? "attachment"}-${index}`}
              className="rounded-lg bg-background p-2"
            >
              <div className="font-medium">{item.name || `Attachment ${index + 1}`}</div>
              <div className="text-[10px] text-muted-foreground">
                {[item.type, item.size ? `${Math.ceil(item.size / 1024)} KB` : null, item.addedAt]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {item.dataUrl && (
                <a
                  href={item.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                >
                  Open attachment <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const formatted = formatPrimitive(value);
  return typeof value === "object" && value !== null ? (
    <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">
      {formatted}
    </pre>
  ) : (
    <span className="break-words">{formatted}</span>
  );
}

export function FeatureAttributesWindow() {
  const wb = useWorkbench();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filter, setFilter] = useState("");

  const selected = useMemo(
    () =>
      wb.selectedFeatures.flatMap((selection) => {
        const layer = wb.displayLayers.find((item) => item.id === selection.layerId);
        const feature = layer?.data.features[selection.index];
        return layer && feature ? [{ selection, layer, feature }] : [];
      }),
    [wb.displayLayers, wb.selectedFeatures],
  );
  const selectionKey = wb.selectedFeatures
    .map((selection) => `${selection.layerId}:${selection.index}`)
    .join("|");

  useEffect(() => {
    if (!selectionKey) {
      setOpen(false);
      return;
    }
    setActiveIndex(0);
    setFilter("");
    setOpen(true);
  }, [selectionKey]);

  useEffect(() => {
    if (activeIndex >= selected.length) setActiveIndex(Math.max(0, selected.length - 1));
  }, [activeIndex, selected.length]);

  useEffect(() => {
    const reopen = () => {
      if (selected.length) setOpen(true);
    };
    window.addEventListener("landdraft:open-feature-attributes", reopen);
    return () => window.removeEventListener("landdraft:open-feature-attributes", reopen);
  }, [selected.length]);

  if (!open || !selected.length || typeof document === "undefined") return null;
  const current = selected[activeIndex] ?? selected[0]!;
  const properties = (current.feature.properties ?? {}) as Record<string, unknown>;
  const normalizedFilter = filter.trim().toLowerCase();
  const entries = Object.entries(properties).filter(([key, value]) => {
    if (!normalizedFilter) return true;
    return `${key} ${formatPrimitive(value)}`.toLowerCase().includes(normalizedFilter);
  });
  const geometryType = current.feature.geometry?.type ?? "No geometry";

  return createPortal(
    <section
      className="panel-surface fixed inset-x-3 top-[max(4.5rem,calc(env(safe-area-inset-top)+4rem))] z-[70] flex max-h-[min(70dvh,620px)] flex-col overflow-hidden rounded-2xl shadow-float sm:inset-x-auto sm:right-4 sm:top-20 sm:w-[min(430px,calc(100vw-2rem))]"
      aria-label="Selected map item attributes"
      role="dialog"
      aria-modal="false"
    >
      <header className="flex items-start gap-2 border-b border-border bg-card px-3 py-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ListTree className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {featureName(properties, `Feature ${current.selection.index + 1}`)}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {current.layer.name} · {geometryType} · {Object.keys(properties).length} attributes
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 hover:bg-accent"
          aria-label="Close full attributes"
          title="Close the full attribute window"
        >
          <X className="size-4" />
        </button>
      </header>

      {selected.length > 1 && (
        <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-3 py-2 text-[11px]">
          <button
            type="button"
            onClick={() =>
              setActiveIndex((value) => (value - 1 + selected.length) % selected.length)
            }
            className="rounded-lg p-1 hover:bg-accent"
            aria-label="Previous selected feature"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="font-semibold">
            Selected item {activeIndex + 1} of {selected.length}
          </span>
          <button
            type="button"
            onClick={() => setActiveIndex((value) => (value + 1) % selected.length)}
            className="rounded-lg p-1 hover:bg-accent"
            aria-label="Next selected feature"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      <div className="border-b border-border bg-card px-3 py-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter attribute names or values"
          aria-label="Filter full attributes"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length ? (
          <dl className="space-y-2">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-xl border border-border bg-card px-3 py-2">
                <dt className="break-all text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {key}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed">
                  <AttributeValue name={key} value={value} />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
            {Object.keys(properties).length
              ? "No attributes match this filter."
              : "This map item has no source attributes."}
          </div>
        )}
      </div>
    </section>,
    document.body,
  );
}
