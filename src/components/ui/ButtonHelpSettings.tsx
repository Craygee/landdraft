import { MessageSquareText } from "lucide-react";

import { useButtonHelp } from "./ButtonHelpProvider";

export function ButtonHelpSettings({ compact = false }: { compact?: boolean }) {
  const { enabled, delayMs, setEnabled, setDelayMs } = useButtonHelp();

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <strong className="block font-semibold">Delayed button descriptions</strong>
          <span className="block text-[10px] leading-snug text-muted-foreground">
            Rest the pointer on a button to see what it does. Descriptions never intercept clicks.
          </span>
        </span>
      </label>
      {enabled && (
        <label
          className={
            compact
              ? "mt-3 flex items-center justify-between gap-3"
              : "mt-3 grid grid-cols-[1fr_auto] items-center gap-3"
          }
        >
          <span className="text-[10px] font-medium text-muted-foreground">Description delay</span>
          <select
            value={delayMs}
            onChange={(event) => setDelayMs(Number(event.target.value))}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
            aria-label="Button description delay"
          >
            <option value={600}>0.6 seconds</option>
            <option value={1000}>1 second</option>
            <option value={1500}>1.5 seconds</option>
          </select>
        </label>
      )}
    </div>
  );
}
