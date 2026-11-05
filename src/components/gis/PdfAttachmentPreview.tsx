import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Eye, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  downloadProjectAsset,
  isPdfProjectDocument,
  projectAssetBlob,
} from "@/lib/gis/projectRecords";
import type { ProjectDocument } from "@/lib/gis/types";
import { cn } from "@/lib/utils";

export function PdfAttachmentPreview({
  attachment,
  compact = false,
}: {
  attachment: ProjectDocument;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  if (!isPdfProjectDocument(attachment)) return null;

  const preview = async () => {
    setOpen(true);
    setError("");
    if (url) return;
    setLoading(true);
    try {
      const blob = await projectAssetBlob(attachment);
      setUrl(URL.createObjectURL(blob));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The PDF could not be loaded";
      setError(message);
      toast.error("PDF preview unavailable", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void preview()}
        className={cn("rounded-md hover:bg-accent", compact ? "p-0.5" : "p-1")}
        aria-label={`Preview ${attachment.name}`}
        title="Preview PDF"
      >
        <Eye className={compact ? "size-2.5" : "size-3"} />
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-2 sm:p-5"
            role="dialog"
            aria-modal="true"
            aria-label={`PDF preview: ${attachment.name}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section className="flex h-[min(94dvh,70rem)] w-[min(96vw,75rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
              <header className="flex min-h-12 items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{attachment.name}</p>
                  <p className="text-[10px] text-muted-foreground">Secure project PDF preview</p>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadProjectAsset(attachment)}
                  className="flex min-h-9 items-center gap-1.5 rounded-xl bg-secondary px-3 text-xs font-semibold hover:bg-accent"
                >
                  <Download className="size-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex size-9 items-center justify-center rounded-xl hover:bg-accent"
                  aria-label="Close PDF preview"
                >
                  <X className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 bg-secondary/50">
                {loading && (
                  <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" /> Loading PDF…
                  </div>
                )}
                {!loading && error && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm font-semibold">This PDF could not be previewed.</p>
                    <p className="max-w-lg text-xs text-muted-foreground">{error}</p>
                    <button
                      type="button"
                      onClick={() => void downloadProjectAsset(attachment)}
                      className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                    >
                      Download PDF
                    </button>
                  </div>
                )}
                {!loading && !error && url && (
                  <iframe
                    src={`${url}#view=FitH`}
                    title={`PDF preview: ${attachment.name}`}
                    className="h-full w-full border-0"
                  />
                )}
              </div>
            </section>
          </div>,
          window.document.body,
        )}
    </>
  );
}
