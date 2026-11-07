import { useEffect, useState } from "react";

/** Temporary readout for the iPad rotation cut-off, shown only with ?viewportdebug=1. */
function readViewport() {
  const rect = (selector: string) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "none";
  };
  const root = getComputedStyle(document.documentElement);
  const viewport = window.visualViewport;
  return [
    `inner ${window.innerWidth}x${window.innerHeight}`,
    `client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
    `visual ${viewport ? `${Math.round(viewport.width)}x${Math.round(viewport.height)}` : "none"} scale ${viewport?.scale ?? "?"}`,
    `offset ${viewport?.offsetLeft ?? "?"},${viewport?.offsetTop ?? "?"} scroll ${window.scrollX},${window.scrollY}`,
    `screen ${window.screen.width}x${window.screen.height} avail ${window.screen.availWidth}x${window.screen.availHeight}`,
    `angle ${window.screen.orientation?.angle ?? "?"} landscape ${window.matchMedia("(orientation: landscape)").matches}`,
    `dvw ${(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;width:100dvw;height:100dvh;visibility:hidden";
      document.body.append(probe);
      const box = probe.getBoundingClientRect();
      probe.remove();
      return `${Math.round(box.width)}x${Math.round(box.height)}`;
    })()}`,
    `live ${root.getPropertyValue("--app-live-width")} ${root.getPropertyValue("--app-live-height")}`,
    `html ${rect("html")} body ${rect("body")}`,
    `app ${rect(".app-viewport")} map ${rect(".maplibregl-map")}`,
    `canvas ${rect(".maplibregl-canvas")} dpr ${window.devicePixelRatio}`,
    `ua ${navigator.userAgent.slice(0, 90)}`,
  ];
}

export function ViewportDebug() {
  const [enabled, setEnabled] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    setEnabled(new URLSearchParams(window.location.search).get("viewportdebug") === "1");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setLines(readViewport()), 500);
    return () => window.clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;

  const resetViewportTag = () => {
    const tag = document.querySelector('meta[name="viewport"]');
    const content = tag?.getAttribute("content") ?? "";
    tag?.setAttribute("content", `${content}, maximum-scale=1`);
    window.setTimeout(() => tag?.setAttribute("content", content), 100);
    setNote("A: viewport tag reset");
  };

  const clearSizing = () => {
    const style = document.documentElement.style;
    for (const name of ["--app-live-width", "--app-live-height", "--app-viewport-height"]) {
      style.removeProperty(name);
    }
    setNote("B: measured sizes cleared");
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 90,
        left: 8,
        zIndex: 2147483647,
        width: 330,
        padding: 8,
        borderRadius: 8,
        background: "#111",
        color: "#fff",
        font: "11px/1.35 monospace",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {lines.join("\n")}
      {note ? `\n${note}` : ""}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button
          onClick={resetViewportTag}
          style={{ padding: "6px 10px", background: "#fff", color: "#111", borderRadius: 6 }}
        >
          Test A
        </button>
        <button
          onClick={clearSizing}
          style={{ padding: "6px 10px", background: "#fff", color: "#111", borderRadius: 6 }}
        >
          Test B
        </button>
      </div>
    </div>
  );
}
