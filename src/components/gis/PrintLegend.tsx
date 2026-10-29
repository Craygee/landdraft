import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GisLayer, LayerGroup } from "@/lib/gis/types";
import { layoutPrintLegend } from "@/lib/gis/printLegendLayout";
import { LegendSwatch } from "./LegendSwatch";

import { printLegendRows } from "@/lib/gis/printLegendGroups";

type Size = { width: number; height: number };
export function PrintLegend({
  layers,
  names,
  onSize,
  groups,
  grouped,
}: {
  layers: GisLayer[];
  names: string[];
  groups: LayerGroup[];
  grouped: boolean;
  onSize: (size: Size) => void;
}) {
  const rows = useMemo(
    () => printLegendRows(layers, names, groups, grouped),
    [layers, names, groups, grouped],
  );
  const rowNames = useMemo(() => rows.map((row) => row.name), [rows]);
  const headings = useMemo(() => rows.map((row) => row.layerIndex === null), [rows]);
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() =>
    layoutPrintLegend(rowNames, 176, 1000, (s) => s.length * 6, headings),
  );
  useLayoutEffect(() => {
    const frame = ref.current?.closest("[data-print-map-frame]") as HTMLElement | null;
    if (!frame) return;
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = "10px Arial, sans-serif";
    const update = () => {
      const next = layoutPrintLegend(
        rowNames,
        Math.max(1, frame.clientWidth - 20),
        Math.max(1, frame.clientHeight - 90),
        (s) => ctx?.measureText(s).width ?? s.length * 6,
        headings,
      );
      setLayout(next);
      onSize({ width: next.width * next.scale, height: next.height * next.scale });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [rowNames, headings, onSize]);
  return (
    <div
      ref={ref}
      data-print-legend
      style={{ width: layout.width * layout.scale, height: layout.height * layout.scale }}
    >
      <div
        className="relative rounded-md border border-slate-300 bg-white/95 shadow"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `scale(${layout.scale})`,
          transformOrigin: "top left",
          font: "10px Arial, sans-serif",
          boxSizing: "border-box",
        }}
      >
        <strong style={{ position: "absolute", left: 8, top: 8 }}>Legend</strong>
        {layout.entries.map((entry, i) => {
          const row = rows[i];
          if (!row) return null;
          const layer = row.layerIndex === null ? null : layers[row.layerIndex];
          return (
            <div
              key={row.id}
              className="absolute flex items-start"
              style={{ left: entry.x, top: entry.y, width: 160, gap: 4 }}
            >
              {layer && <LegendSwatch layer={layer} />}
              <span
                style={{
                  width: 126,
                  lineHeight: "13px",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontWeight: layer ? 400 : 700,
                }}
              >
                {entry.lines.join("\n")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
