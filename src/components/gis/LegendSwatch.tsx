import { pointSymbolOpacity } from "@/lib/gis/iconOpacity";
import { useId } from "react";

import { legendDashArray, legendSymbolForLayer } from "@/lib/gis/legendSymbol";
import type { GisLayer } from "@/lib/gis/types";

export function LegendSwatch({ layer, scale = 1 }: { layer: GisLayer; scale?: number }) {
  const symbol = legendSymbolForLayer(layer);
  const id = useId().replace(/:/g, "");
  const width = Math.max(24, Math.round(30 * scale));
  const height = Math.max(13, Math.round(16 * scale));
  const dash = legendDashArray(symbol.strokePattern, scale).join(" ") || undefined;
  const lineWidth = Math.max(1.2, Math.min(5, symbol.strokeWidth * scale));
  const patternId = `legend-pattern-${id}`;

  if (symbol.kind === "point") {
    return (
      <span
        aria-hidden="true"
        className="relative inline-flex shrink-0 items-center justify-center rounded-sm border border-slate-300 bg-white"
        style={{ width, height }}
      >
        {symbol.markerIcon ? (
          <span
            className="flex items-center justify-center leading-none"
            style={{
              color: symbol.markerColor,
              opacity: symbol.markerOpacity,
              fontSize: `${Math.min(height - 2, Math.max(9, symbol.markerSize * 0.7 * scale))}px`,
            }}
          >
            {symbol.markerIcon}
          </span>
        ) : (
          <span
            className="rounded-full"
            style={{
              width: Math.max(7, Math.min(height - 3, symbol.markerSize * scale)),
              height: Math.max(7, Math.min(height - 3, symbol.markerSize * scale)),
              backgroundColor: symbol.fillColor,
              opacity: symbol.fillOpacity * pointSymbolOpacity(layer.style),
              border: `${Math.max(1, lineWidth / 2)}px solid ${symbol.strokeColor}`,
            }}
          />
        )}
      </span>
    );
  }

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 30 16"
      className="shrink-0 overflow-visible rounded-sm"
    >
      <defs>
        <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse">
          {symbol.fillPattern === "diagonal" && (
            <path d="M-1 6L6-1M3 7L7 3" stroke={symbol.strokeColor} strokeWidth="1" />
          )}
          {symbol.fillPattern === "horizontal" && (
            <path d="M0 1.5H6M0 4.5H6" stroke={symbol.strokeColor} strokeWidth="0.8" />
          )}
          {symbol.fillPattern === "vertical" && (
            <path d="M1.5 0V6M4.5 0V6" stroke={symbol.strokeColor} strokeWidth="0.8" />
          )}
          {symbol.fillPattern === "crosshatch" && (
            <path
              d="M0 1.5H6M0 4.5H6M1.5 0V6M4.5 0V6"
              stroke={symbol.strokeColor}
              strokeWidth="0.7"
            />
          )}
          {symbol.fillPattern === "dotted" && (
            <circle cx="1.5" cy="1.5" r="0.8" fill={symbol.strokeColor} />
          )}
        </pattern>
      </defs>
      <rect x="0.5" y="0.5" width="29" height="15" rx="2" fill="white" stroke="#cbd5e1" />
      {symbol.kind === "image" ? (
        <>
          <rect x="3" y="3" width="24" height="10" fill={symbol.fillColor} opacity="0.35" />
          <path
            d="M3 11L10 6L15 10L20 5L27 11"
            fill="none"
            stroke={symbol.strokeColor}
            strokeWidth="1.2"
          />
        </>
      ) : symbol.kind === "polygon" ? (
        <>
          <rect
            x="3"
            y="3"
            width="24"
            height="10"
            fill={symbol.fillColor}
            fillOpacity={Math.max(0.12, symbol.fillOpacity)}
            stroke={symbol.strokeColor}
            strokeOpacity={symbol.strokeOpacity}
            strokeWidth={Math.max(0.8, lineWidth / 2)}
            strokeDasharray={dash}
          />
          {symbol.fillPattern !== "solid" && (
            <rect x="3" y="3" width="24" height="10" fill={`url(#${patternId})`} />
          )}
        </>
      ) : symbol.kind === "pipeline" ? (
        <>
          <path
            d="M3 8H27"
            stroke="#334155"
            strokeWidth={Math.max(4.5, lineWidth + 2.5)}
            strokeLinecap="round"
          />
          <path
            d="M3 8H27"
            stroke={symbol.strokeColor}
            strokeOpacity={symbol.strokeOpacity}
            strokeWidth={Math.max(1.8, lineWidth)}
            strokeDasharray={dash}
            strokeLinecap="round"
          />
          <path d="M15 4.5V11.5" stroke="#334155" strokeWidth="1" />
        </>
      ) : (
        <path
          d="M3 8H27"
          stroke={symbol.strokeColor}
          strokeOpacity={symbol.strokeOpacity}
          strokeWidth={lineWidth}
          strokeDasharray={dash}
          strokeLinecap={symbol.strokePattern === "dotted" ? "round" : "butt"}
        />
      )}
    </svg>
  );
}
