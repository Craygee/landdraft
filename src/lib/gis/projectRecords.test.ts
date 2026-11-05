import assert from "node:assert/strict";
import test from "node:test";

import { isPdfProjectDocument } from "./projectDocument.ts";

test("recognizes note PDF attachments by MIME type or file extension", () => {
  assert.equal(isPdfProjectDocument({ name: "study", mimeType: "application/pdf" }), true);
  assert.equal(
    isPdfProjectDocument({ name: "report.PDF", mimeType: "application/octet-stream" }),
    true,
  );
  assert.equal(isPdfProjectDocument({ name: "drawing.png", mimeType: "image/png" }), false);
});
