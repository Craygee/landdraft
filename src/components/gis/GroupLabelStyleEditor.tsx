import type { GisLayer, LayerStyle, LabelPlacement } from "@/lib/gis/types";

const fonts = [
  "Open Sans Regular",
  "Open Sans Semibold",
  "Open Sans Bold",
  "Noto Sans Regular",
  "Noto Sans Italic",
  "Noto Sans Bold",
];
const placements: { value: LabelPlacement; label: string }[] = [
  { value: "auto", label: "Automatic (by geometry)" },
  { value: "center", label: "Center" },
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "follow-line", label: "Follow line features" },
  { value: "horizontal", label: "Horizontal on lines" },
];

export function GroupLabelStyleEditor({
  layers,
  onChange,
}: {
  layers: GisLayer[];
  onChange: (patch: Partial<LayerStyle>) => void;
}) {
  const style = layers[0]?.style;
  if (!style) return null;
  const mixed = (key: keyof LayerStyle) => layers.some((layer) => layer.style[key] !== style[key]);
  const booleanControl = (
    key: "labelEnabled" | "labelScaleWithZoom" | "labelAllowOverlap",
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-[10px]">
      <input
        type="checkbox"
        checked={mixed(key) ? false : Boolean(style[key])}
        ref={(input) => {
          if (input) input.indeterminate = mixed(key);
        }}
        onChange={(event) =>
          onChange(
            key === "labelAllowOverlap"
              ? {
                  labelAllowOverlap: event.target.checked,
                  labelCollisionMode: event.target.checked ? "always" : "avoid",
                }
              : { [key]: event.target.checked },
          )
        }
        className="accent-primary"
      />
      {label}
      {mixed(key) ? " (mixed)" : ""}
    </label>
  );
  const rangeControl = (
    key:
      | "labelSize"
      | "labelOpacity"
      | "labelHaloWidth"
      | "labelMinZoom"
      | "labelMaxZoom"
      | "labelMaxWidth"
      | "labelLineSpacing",
    label: string,
    min: number,
    max: number,
    step: number,
    unit = "",
  ) => (
    <label className="block text-[10px] text-muted-foreground">
      {label}: {mixed(key) ? "Mixed" : `${Number(style[key].toFixed(2))}${unit}`}
      <input
        aria-label={`Group ${label.toLowerCase()}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={style[key]}
        onChange={(event) => onChange({ [key]: Number(event.target.value) })}
        className="w-full accent-primary"
      />
    </label>
  );
  return (
    <details className="rounded-lg border border-border bg-card/70" open>
      <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold">
        Label style — all sublayers
      </summary>
      <div className="space-y-2 border-t border-border p-2">
        <p className="text-[9px] text-muted-foreground">
          Changes apply immediately to every layer in this group and its subgroups, including hidden
          layers. Each layer keeps its own label fields, text and layer-name setting. Mixed values
          change only when you edit that control.
        </p>
        {booleanControl("labelEnabled", "Show labels")}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-muted-foreground">
            Font
            <select
              aria-label="Group label font"
              value={mixed("labelFont") ? "" : style.labelFont}
              onChange={(event) => onChange({ labelFont: event.target.value })}
              className="mt-1 w-full rounded border border-border bg-card px-1 py-1 text-[10px]"
            >
              {mixed("labelFont") && (
                <option value="" disabled>
                  Mixed
                </option>
              )}
              {!fonts.includes(style.labelFont) && (
                <option value={style.labelFont}>{style.labelFont}</option>
              )}
              {fonts.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted-foreground">
            Position
            <select
              aria-label="Group label position"
              value={mixed("labelPlacement") ? "" : style.labelPlacement}
              onChange={(event) =>
                onChange({ labelPlacement: event.target.value as LabelPlacement })
              }
              className="mt-1 w-full rounded border border-border bg-card px-1 py-1 text-[10px]"
            >
              {mixed("labelPlacement") && (
                <option value="" disabled>
                  Mixed
                </option>
              )}
              {placements.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rangeControl("labelSize", "Label size", 5, 36, 1, "px")}
        {booleanControl("labelScaleWithZoom", "Resize labels as the map zooms")}
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["labelColor", "Text color"],
              ["labelHaloColor", "Halo color"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-[10px] text-muted-foreground">
              {label}
              {mixed(key) ? " (mixed)" : ""}
              <input
                aria-label={`Group label ${label.toLowerCase()}`}
                type="color"
                value={style[key]}
                onChange={(event) => onChange({ [key]: event.target.value })}
                className="mt-1 h-8 w-full rounded border border-border bg-card"
              />
            </label>
          ))}
          {rangeControl("labelOpacity", "Label opacity", 0, 1, 0.05)}
          {rangeControl("labelHaloWidth", "Halo width", 0, 5, 0.2, "px")}
          {rangeControl("labelMinZoom", "Start zoom", 0, 23, 1)}
          {rangeControl("labelMaxZoom", "End zoom", 1, 24, 1)}
          {rangeControl("labelMaxWidth", "Wrap width", 4, 30, 1)}
          {rangeControl("labelLineSpacing", "Line spacing", 0.8, 2, 0.1)}
        </div>
        {booleanControl("labelAllowOverlap", "Allow overlapping labels")}
        <p className="text-[9px] text-muted-foreground">
          Automatic keeps line labels following their lines. Showing labels requires label fields or
          layer-name labeling to be configured on each layer.
        </p>
      </div>
    </details>
  );
}
