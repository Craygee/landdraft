import { useRef, useState, type ReactNode } from "react";
import { GripVertical, PanelLeftOpen, PanelRightOpen } from "lucide-react";

/** Only the grip starts a gesture, so dragging never steals map or button taps. */
export function DockableBar({
  children,
  className,
  label,
  centered = false,
  enabled = true,
}: {
  children: ReactNode;
  className: string;
  label: string;
  centered?: boolean;
  enabled?: boolean;
}) {
  const [side, setSide] = useState<"left" | "right" | null>(null);
  const [tabTop, setTabTop] = useState(160);
  const [delta, setDelta] = useState(0);
  const start = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  if (side && enabled)
    return (
      <button
        className={`fixed z-[65] rounded-xl border border-border bg-card px-2 py-3 text-primary shadow-float ${side === "left" ? "left-0" : "right-0"}`}
        style={{ top: tabTop, touchAction: "none" }}
        aria-label={`Restore ${label}`}
        title={`Restore ${label}`}
        onClick={() => setSide(null)}
        onPointerDown={(event) => {
          start.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          const distance = event.clientX - (start.current ?? event.clientX);
          if ((side === "left" && distance > 20) || (side === "right" && distance < -20))
            setSide(null);
          start.current = null;
        }}
      >
        {side === "left" ? (
          <PanelLeftOpen className="size-4" />
        ) : (
          <PanelRightOpen className="size-4" />
        )}
      </button>
    );
  return (
    <div
      ref={panel}
      className={className}
      style={{ transform: `${centered ? "translateX(-50%) " : ""}translateX(${delta}px)` }}
    >
      {enabled && (
        <button
          aria-label={`Drag ${label} to either edge to hide`}
          title="Drag to either side to tuck away"
          className="mx-auto flex h-5 w-12 cursor-ew-resize items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
          style={{ touchAction: "none" }}
          onPointerDown={(event) => {
            start.current = event.clientX;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (start.current !== null) setDelta(event.clientX - start.current);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDelta(0);
          }}
          onPointerUp={(event) => {
            const distance = event.clientX - (start.current ?? event.clientX);
            const rect = panel.current?.getBoundingClientRect();
            if (Math.abs(distance) > 70) {
              setTabTop(Math.max(80, Math.min(window.innerHeight - 140, rect?.top ?? 160)));
              setSide(distance < 0 ? "left" : "right");
            }
            start.current = null;
            setDelta(0);
          }}
        >
          <GripVertical className="size-4 rotate-90" />
        </button>
      )}
      {children}
    </div>
  );
}
