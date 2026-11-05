import {
  deletePrivateProjectFiles,
  downloadPrivateProjectFile,
  uploadPrivateProjectFile,
} from "@/lib/cloud";
import type { EmailDocumentDetails, ProjectDocument } from "./types";
import { isPdfProjectDocument } from "./projectDocument";
export { isPdfProjectDocument } from "./projectDocument";

const safeName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140) || "document";

export async function uploadProjectAsset(input: {
  userId: string;
  projectId: string;
  folderId: string;
  fileName: string;
  data: Blob;
  source: ProjectDocument["source"];
  uploadedBy: string;
  layerId?: string;
  layerNoteId?: string;
  projectNoteId?: string;
  email?: EmailDocumentDetails;
}): Promise<ProjectDocument> {
  const id = window.crypto.randomUUID();
  const storagePath = `${input.userId}/${input.projectId}/documents/${safeName(input.folderId)}/${id}-${safeName(input.fileName)}`;
  await uploadPrivateProjectFile(storagePath, input.data);
  return {
    id,
    name: input.fileName,
    storagePath,
    mimeType: input.data.type || "application/octet-stream",
    size: input.data.size,
    folderId: input.folderId,
    source: input.source,
    createdAt: Date.now(),
    uploadedBy: input.uploadedBy,
    includeInPacket: true,
    ...(input.layerId ? { layerId: input.layerId } : {}),
    ...(input.layerNoteId ? { layerNoteId: input.layerNoteId } : {}),
    ...(input.projectNoteId ? { projectNoteId: input.projectNoteId } : {}),
    ...(input.email ? { email: input.email } : {}),
  };
}

export async function projectAssetBlob(document: ProjectDocument): Promise<Blob> {
  const bytes = await downloadPrivateProjectFile(document.storagePath);
  return new Blob([bytes], {
    type: isPdfProjectDocument(document)
      ? "application/pdf"
      : document.mimeType || "application/octet-stream",
  });
}

export async function downloadProjectAsset(document: ProjectDocument): Promise<void> {
  const blob = await projectAssetBlob(document);
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = document.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export async function deleteProjectAsset(document: ProjectDocument): Promise<void> {
  await deletePrivateProjectFiles([document.storagePath]);
}

export async function parseEmailFile(file: File): Promise<EmailDocumentDetails | undefined> {
  if (!file.name.toLowerCase().endsWith(".eml") && file.type !== "message/rfc822") return undefined;
  const raw = await file.text();
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  const splitAt = unfolded.search(/\r?\n\r?\n/);
  const headerText = splitAt >= 0 ? unfolded.slice(0, splitAt) : unfolded;
  const body = splitAt >= 0 ? unfolded.slice(splitAt).trim() : "";
  const header = (name: string) =>
    headerText.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim();
  const plainPreview = body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4_000);
  const from = header("From");
  const to = header("To");
  const sentAt = header("Date");
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    subject: header("Subject") || file.name,
    ...(sentAt ? { sentAt } : {}),
    preview: plainPreview,
  };
}

const decodeMimeFileName = (value: string) => {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  const encoded = cleaned.match(/^UTF-8''(.+)$/i)?.[1];
  if (!encoded) return cleaned;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

const base64Bytes = (value: string) => {
  const decoded = window.atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
};

const quotedPrintableBytes = (value: string) => {
  const decoded = value
    .replace(/=\r?\n/g, "")
    .replace(/=([A-F0-9]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

/** Extract common MIME attachments from an exported .eml without uploading email content elsewhere. */
export async function extractEmailAttachments(file: File): Promise<File[]> {
  if (!file.name.toLowerCase().endsWith(".eml") && file.type !== "message/rfc822") return [];
  const raw = await file.text();
  const boundary = raw
    .match(/boundary\s*=\s*(?:"([^"]+)"|([^;\r\n]+))/i)
    ?.slice(1)
    .find(Boolean)
    ?.trim();
  if (!boundary) return [];
  const attachments: File[] = [];
  for (const part of raw.split(`--${boundary}`)) {
    const divider = part.search(/\r?\n\r?\n/);
    if (divider < 0) continue;
    const headers = part.slice(0, divider);
    const disposition = headers.match(/Content-Disposition:\s*([^\r\n]+)/i)?.[1] ?? "";
    const fileNameValue =
      disposition.match(/filename\*?\s*=\s*("[^"]+"|'[^']+'|[^;\r\n]+)/i)?.[1] ??
      headers.match(/name\*?\s*=\s*("[^"]+"|'[^']+'|[^;\r\n]+)/i)?.[1];
    if (!fileNameValue || !/attachment|filename/i.test(`${disposition} ${headers}`)) continue;
    const fileName = decodeMimeFileName(fileNameValue);
    const mimeType =
      headers.match(/Content-Type:\s*([^;\r\n]+)/i)?.[1]?.trim() || "application/octet-stream";
    const encoding = headers
      .match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1]
      ?.trim()
      .toLowerCase();
    const body = part
      .slice(divider)
      .replace(/^\r?\n\r?\n/, "")
      .replace(/\r?\n$/, "");
    try {
      const bytes =
        encoding === "base64"
          ? base64Bytes(body)
          : encoding === "quoted-printable"
            ? quotedPrintableBytes(body)
            : new TextEncoder().encode(body);
      attachments.push(new File([bytes], fileName, { type: mimeType }));
    } catch {
      // Keep the original .eml even when an unusual attachment encoding cannot be decoded.
    }
  }
  return attachments;
}
