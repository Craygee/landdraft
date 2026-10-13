import type { PrintComposition, PrintPaper } from "./types";

export const PRINT_DPI = 96;
const PDF_POINTS_PER_INCH = 72;

const PAPER_SPECS: Record<
  PrintPaper,
  { label: string; widthInches: number; heightInches: number; metric: boolean }
> = {
  letter: { label: "Letter", widthInches: 8.5, heightInches: 11, metric: false },
  legal: { label: "Legal", widthInches: 8.5, heightInches: 14, metric: false },
  tabloid: { label: "Tabloid", widthInches: 11, heightInches: 17, metric: false },
  a5: { label: "A5", widthInches: 148 / 25.4, heightInches: 210 / 25.4, metric: true },
  a4: { label: "A4", widthInches: 210 / 25.4, heightInches: 297 / 25.4, metric: true },
  a3: { label: "A3", widthInches: 297 / 25.4, heightInches: 420 / 25.4, metric: true },
};

export const PRINT_PAPER_OPTIONS = (Object.keys(PAPER_SPECS) as PrintPaper[]).map((value) => {
  const paper = PAPER_SPECS[value];
  const dimensions = paper.metric
    ? `${Math.round(paper.widthInches * 25.4)} × ${Math.round(paper.heightInches * 25.4)} mm`
    : `${paper.widthInches} × ${paper.heightInches} in`;
  return { value, label: `${paper.label} (${dimensions})` };
});

export function printPageGeometry(paper: PrintPaper, orientation: PrintComposition["orientation"]) {
  const spec = PAPER_SPECS[paper] ?? PAPER_SPECS.letter;
  const portrait = { widthInches: spec.widthInches, heightInches: spec.heightInches };
  const dimensions =
    orientation === "portrait"
      ? portrait
      : { widthInches: portrait.heightInches, heightInches: portrait.widthInches };
  const displayDimensions = spec.metric
    ? `${Math.round(dimensions.widthInches * 25.4)} × ${Math.round(dimensions.heightInches * 25.4)} mm`
    : `${dimensions.widthInches} × ${dimensions.heightInches} in`;

  return {
    ...dimensions,
    label: spec.label,
    widthPixels: Math.round(dimensions.widthInches * PRINT_DPI),
    heightPixels: Math.round(dimensions.heightInches * PRINT_DPI),
    widthPoints: dimensions.widthInches * PDF_POINTS_PER_INCH,
    heightPoints: dimensions.heightInches * PDF_POINTS_PER_INCH,
    cssWidth: `${dimensions.widthInches}in`,
    cssHeight: `${dimensions.heightInches}in`,
    displayDimensions,
  };
}
