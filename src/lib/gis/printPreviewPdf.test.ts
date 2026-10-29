import test from "node:test";
import assert from "node:assert/strict";
import { previewPdfGeometry } from "./printPreviewPdfModel.ts";
import { buildSingleImagePdf } from "./imagePdf.ts";
import { PRINT_PAPER_OPTIONS } from "./printLayout.ts";
test("preview PDFs preserve every paper size and orientation within mobile-safe image bounds", () => {
  for (const { value } of PRINT_PAPER_OPTIONS)
    for (const orientation of ["portrait", "landscape"] as const) {
      const g = previewPdfGeometry(value, orientation);
      assert.ok(g.rasterWidth * g.rasterHeight <= 3_000_000);
      assert.ok(Math.max(g.rasterWidth, g.rasterHeight) <= 4096);
      assert.ok(g.scale > 0 && g.scale <= 2);
      assert.ok(Math.abs(g.widthPoints / g.heightPoints - g.widthPixels / g.heightPixels) < 0.002);
    }
  const letter = previewPdfGeometry("letter", "landscape");
  assert.equal(letter.widthPoints, 792);
  assert.equal(letter.heightPoints, 612);
});
test("image PDF uses the chosen paper dimensions and valid byte offsets, not preview magnification", async () => {
  const bytes = new Uint8Array([255, 216, 255, 217]);
  for (const orientation of ["portrait", "landscape"] as const) {
    const g = previewPdfGeometry("letter", orientation);
    const pdf = await buildSingleImagePdf(
      bytes,
      g.rasterWidth,
      g.rasterHeight,
      g.widthPoints,
      g.heightPoints,
    ).arrayBuffer();
    const data = new Uint8Array(pdf);
    const text = new TextDecoder().decode(data);
    assert.ok(text.includes(`/MediaBox [0 0 ${g.widthPoints} ${g.heightPoints}]`));
    assert.ok(text.includes(`/Width ${g.rasterWidth} /Height ${g.rasterHeight}`));
    const offset = Number(/startxref\n(\d+)/.exec(text)![1]);
    assert.equal(new TextDecoder().decode(data.slice(offset, offset + 4)), "xref");
  }
});
