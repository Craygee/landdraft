import type { ProjectDocument } from "./types";

export function isPdfProjectDocument(document: Pick<ProjectDocument, "name" | "mimeType">) {
  const mimeType = document.mimeType.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType === "application/pdf" || document.name.trim().toLowerCase().endsWith(".pdf");
}
