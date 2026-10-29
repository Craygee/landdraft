export function wrapLegendText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line && measure(`${line} ${word}`) <= maxWidth) {
      line += ` ${word}`;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      if (line && measure(line + character) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Pack every entry; scale the entire legend rather than clipping or dropping rows. */
export function layoutPrintLegend(
  names: string[],
  maxWidth: number,
  maxHeight: number,
  measure: (text: string) => number,
  headings: boolean[] = [],
) {
  const rows = names.map((name) => ({ name, lines: wrapLegendText(name, 126, measure) }));
  let best = {
    columns: 1,
    width: 176,
    height: 34,
    scale: 0,
    entries: [] as { name: string; lines: string[]; x: number; y: number }[],
  };
  for (let columns = 1; columns <= Math.min(12, Math.max(1, rows.length)); columns++) {
    // Keep each heading with its complete group so column breaks never orphan labels.
    const blocks: number[][] = [];
    const grouped = headings.some(Boolean);
    rows.forEach((_, i) => {
      if (headings[i] || !blocks.length || !grouped) blocks.push([]);
      blocks[blocks.length - 1]!.push(i);
    });
    const heights = Array.from({ length: columns }, () => 30);
    const entries: { name: string; lines: string[]; x: number; y: number }[] = [];
    const target =
      rows.reduce((sum, row) => sum + Math.max(16, row.lines.length * 13) + 5, 0) / columns;
    let column = 0;
    blocks.forEach((block) => {
      const height = block.reduce(
        (sum, i) => sum + Math.max(16, rows[i]!.lines.length * 13) + 5,
        0,
      );
      if (column < columns - 1 && heights[column]! > 30 && heights[column]! - 30 + height > target)
        column++;
      block.forEach((i) => {
        const row = rows[i]!,
          y = heights[column]!;
        heights[column] = y + Math.max(16, row.lines.length * 13) + 5;
        entries.push({ ...row, x: column * 176 + 8, y });
      });
    });
    const width = columns * 176,
      height = Math.max(34, ...heights) + 3;
    const scale = Math.min(1, Math.max(1, maxWidth) / width, Math.max(1, maxHeight) / height);
    if (scale > best.scale) best = { columns, width, height, scale, entries };
  }
  return best;
}
