import { createClient } from "@supabase/supabase-js";
import { Webhook } from "svix";

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 75 * 1024 * 1024;
const RESEND_API = "https://api.resend.com";

interface ResendAttachment {
  id: string;
  filename?: string;
  size?: number;
  content_type?: string;
  download_url?: string;
}

interface ResendReceivedEmail {
  id: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject?: string;
  message_id?: string;
  created_at?: string;
  text?: string | null;
  html?: string | null;
  raw?: { download_url?: string } | null;
}

interface ResendEvent {
  type: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    reply_to?: string[];
    subject?: string;
    message_id?: string;
    created_at?: string;
  };
}

interface AliasRow {
  id: string;
  owner_id: string;
  project_id: string | null;
  local_part: string;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const safeName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140) || "attachment";

const addresses = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const localPart = (address: string) => {
  const bracketed = address.match(/<([^>]+)>/)?.[1] ?? address;
  return bracketed.trim().toLowerCase().split("@")[0] ?? "";
};

const adminClient = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const namedKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const secretKey = namedKeys
    ? (JSON.parse(namedKeys) as Record<string, string>)["default"]
    : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secretKey) throw new Error("Supabase server credentials are unavailable");
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const resendFetch = async <T>(path: string, apiKey: string): Promise<T> => {
  const response = await fetch(`${RESEND_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "LandDraft-Inbound/1.0" },
  });
  if (!response.ok) throw new Error(`Resend API ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!webhookSecret || !resendApiKey)
    return json({ error: "Email intake is not configured" }, 503);

  const rawPayload = await request.text();
  let event: ResendEvent;
  try {
    event = new Webhook(webhookSecret).verify(rawPayload, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    }) as ResendEvent;
  } catch {
    return json({ error: "Invalid webhook signature" }, 400);
  }

  if (event.type !== "email.received") return json({ ignored: true });
  const providerEmailId = event.data?.email_id;
  if (!providerEmailId) return json({ error: "Missing received email ID" }, 400);

  const supabase = adminClient();
  const recipientLocalParts = [
    ...addresses(event.data?.to),
    ...addresses(event.data?.cc),
    ...addresses(event.data?.bcc),
  ]
    .map(localPart)
    .filter(Boolean);
  if (!recipientLocalParts.length) return json({ accepted: true, routed: false });

  const { data: aliases, error: aliasError } = await supabase
    .from("project_email_aliases")
    .select("id,owner_id,project_id,local_part")
    .eq("active", true)
    .in("local_part", recipientLocalParts)
    .limit(1);
  if (aliasError) throw aliasError;
  const alias = aliases?.[0] as AliasRow | undefined;
  if (!alias) return json({ accepted: true, routed: false });

  const { data: existing } = await supabase
    .from("project_inbound_emails")
    .select("id,status")
    .eq("provider_email_id", providerEmailId)
    .maybeSingle();
  if (existing) return json({ accepted: true, duplicate: true, id: existing.id });

  const { data: inserted, error: insertError } = await supabase
    .from("project_inbound_emails")
    .insert({
      owner_id: alias.owner_id,
      alias_id: alias.id,
      project_id: alias.project_id,
      provider_email_id: providerEmailId,
      message_id: event.data?.message_id ?? null,
      from_address: event.data?.from ?? "",
      to_addresses: addresses(event.data?.to),
      cc_addresses: addresses(event.data?.cc),
      bcc_addresses: addresses(event.data?.bcc),
      reply_to_addresses: addresses(event.data?.reply_to),
      subject: event.data?.subject ?? "(no subject)",
      received_at: event.data?.created_at ?? new Date().toISOString(),
      status: "processing",
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return json({ accepted: true, duplicate: true });
    throw insertError;
  }

  const emailId = inserted.id as string;
  const storageProject = alias.project_id ?? "inbox";
  const storagePrefix = `${alias.owner_id}/${storageProject}/documents/email/${emailId}`;
  const errors: string[] = [];
  let totalBytes = 0;

  try {
    const email = await resendFetch<ResendReceivedEmail>(
      `/emails/receiving/${encodeURIComponent(providerEmailId)}`,
      resendApiKey,
    );
    const messageBlob = new Blob(
      [
        JSON.stringify(
          {
            from: email.from,
            to: email.to,
            cc: email.cc,
            bcc: email.bcc,
            reply_to: email.reply_to,
            subject: email.subject,
            message_id: email.message_id,
            created_at: email.created_at,
            text: email.text,
            html: email.html,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const bodyPath = `${storagePrefix}/message.json`;
    const { error: bodyError } = await supabase.storage
      .from("project-assets")
      .upload(bodyPath, messageBlob, { contentType: "application/json", upsert: true });
    if (bodyError) errors.push(`Message archive: ${bodyError.message}`);

    let rawStoragePath: string | null = null;
    if (email.raw?.download_url) {
      const rawResponse = await fetch(email.raw.download_url);
      if (rawResponse.ok) {
        const rawBytes = await rawResponse.arrayBuffer();
        totalBytes += rawBytes.byteLength;
        if (totalBytes <= MAX_MESSAGE_BYTES) {
          rawStoragePath = `${storagePrefix}/original.eml`;
          const { error: rawError } = await supabase.storage
            .from("project-assets")
            .upload(rawStoragePath, rawBytes, {
              contentType: "message/rfc822",
              upsert: true,
            });
          if (rawError) {
            errors.push(`Original email: ${rawError.message}`);
            rawStoragePath = null;
          }
        } else errors.push("Original email exceeded the 75 MB message limit");
      } else errors.push(`Original email download failed (${rawResponse.status})`);
    }

    const attachmentList = await resendFetch<{ data?: ResendAttachment[] }>(
      `/emails/receiving/${encodeURIComponent(providerEmailId)}/attachments`,
      resendApiKey,
    );
    for (const attachment of attachmentList.data ?? []) {
      const size = attachment.size ?? 0;
      let status: "ready" | "skipped" | "error" = "ready";
      let errorMessage: string | null = null;
      let storagePath: string | null = null;
      if (!attachment.download_url) {
        status = "error";
        errorMessage = "Provider did not return a download URL";
      } else if (size > MAX_ATTACHMENT_BYTES || totalBytes + size > MAX_MESSAGE_BYTES) {
        status = "skipped";
        errorMessage = "Attachment exceeded the LandDraft intake limit";
      } else {
        try {
          const attachmentResponse = await fetch(attachment.download_url);
          if (!attachmentResponse.ok)
            throw new Error(`Download failed (${attachmentResponse.status})`);
          const attachmentBytes = await attachmentResponse.arrayBuffer();
          totalBytes += attachmentBytes.byteLength;
          storagePath = `${storagePrefix}/${attachment.id}-${safeName(attachment.filename ?? "attachment")}`;
          const { error: uploadError } = await supabase.storage
            .from("project-assets")
            .upload(storagePath, attachmentBytes, {
              contentType: attachment.content_type ?? "application/octet-stream",
              upsert: true,
            });
          if (uploadError) throw uploadError;
        } catch (error) {
          status = "error";
          errorMessage = error instanceof Error ? error.message : "Attachment could not be stored";
          storagePath = null;
          errors.push(`${attachment.filename ?? "Attachment"}: ${errorMessage}`);
        }
      }

      const { error: attachmentError } = await supabase.from("project_inbound_attachments").insert({
        email_id: emailId,
        owner_id: alias.owner_id,
        provider_attachment_id: attachment.id,
        file_name: attachment.filename ?? "attachment",
        content_type: attachment.content_type ?? "application/octet-stream",
        byte_size: size,
        storage_path: storagePath,
        status,
        error_message: errorMessage,
      });
      if (attachmentError) errors.push(attachmentError.message);
    }

    const { error: updateError } = await supabase
      .from("project_inbound_emails")
      .update({
        from_address: email.from ?? event.data?.from ?? "",
        to_addresses: addresses(email.to),
        cc_addresses: addresses(email.cc),
        bcc_addresses: addresses(email.bcc),
        reply_to_addresses: addresses(email.reply_to),
        subject: email.subject ?? event.data?.subject ?? "(no subject)",
        message_id: email.message_id ?? event.data?.message_id ?? null,
        received_at: email.created_at ?? event.data?.created_at ?? new Date().toISOString(),
        text_body: (email.text ?? "").slice(0, 200_000) || null,
        body_storage_path: bodyError ? null : bodyPath,
        raw_storage_path: rawStoragePath,
        status: errors.length ? "partial" : "ready",
        error_message: errors.length ? errors.join("; ").slice(0, 2_000) : null,
      })
      .eq("id", emailId);
    if (updateError) throw updateError;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inbound email processing failed";
    await supabase
      .from("project_inbound_emails")
      .update({ status: "error", error_message: message.slice(0, 2_000) })
      .eq("id", emailId);
    return json({ accepted: true, stored: false, id: emailId }, 500);
  }

  return json({ accepted: true, stored: true, id: emailId, warnings: errors.length });
});
