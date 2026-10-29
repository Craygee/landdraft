const RESEND_EMAILS_API = "https://api.resend.com/emails";
const DEFAULT_SITE_URL = "https://landdraft.net/";
const DEFAULT_FROM_EMAIL = "LandDraft <accounts@notify.landdraft.net>";

type ShareRole = "viewer" | "editor" | "admin";

interface InviteRequest {
  shareId?: string;
  email?: string;
  role?: ShareRole;
}

interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

interface ShareRow {
  id: string;
  name: string;
}

interface MemberRow {
  id: string;
  share_id: string;
  user_id: string | null;
  invited_email: string;
  role: ShareRole;
  active: boolean;
  accepted_at: string | null;
}

const roleNames: Record<ShareRole, string> = {
  viewer: "View only",
  editor: "Editor copy",
  admin: "Administrator",
};

const roleDescriptions: Record<ShareRole, string> = {
  viewer: "You can explore the shared map, switch layers, inspect attributes, and print it.",
  editor: "You can create a separate editable copy for the map administrator to review.",
  admin: "You can directly edit the shared project and manage its sharing settings.",
};

const corsOrigin = (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  return origin === "https://landdraft.net" ||
    origin.endsWith(".lovable.app") ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? origin
    : "https://landdraft.net";
};

const headers = (request: Request) => ({
  "Access-Control-Allow-Origin": corsOrigin(request),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  Vary: "Origin",
});

const json = (request: Request, body: unknown, status = 200) =>
  Response.json(body, { status, headers: headers(request) });

const readPublicKey = () => {
  const direct = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (direct) return direct;
  const keys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!keys) return "";
  try {
    return (JSON.parse(keys) as Record<string, string>)["default"] ?? "";
  } catch {
    return "";
  }
};

const responseError = async (response: Response) => {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const value = body["message"] ?? body["error_description"] ?? body["error"] ?? body["msg"];
    return typeof value === "string" ? value : fallback;
  } catch {
    return fallback;
  }
};

const authenticate = async (
  request: Request,
  supabaseUrl: string,
  publicKey: string,
): Promise<AuthUser | null> => {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !supabaseUrl || !publicKey) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, authorization },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as AuthUser;
  return user.id ? user : null;
};

const authenticatedRequest = (
  request: Request,
  publicKey: string,
  headers: Record<string, string> = {},
) => ({
  ...headers,
  apikey: publicKey,
  authorization: request.headers.get("authorization") ?? "",
  "Content-Type": "application/json",
});

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );

const inviterName = (user: AuthUser) => {
  const metadataName = user.user_metadata?.["full_name"] ?? user.user_metadata?.["name"];
  return typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim().slice(0, 120)
    : user.email?.trim() || "A LandDraft user";
};

const subjectText = (value: string) =>
  value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 160);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: headers(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const publicKey = readPublicKey();
    const user = await authenticate(request, supabaseUrl, publicKey);
    if (!user) return json(request, { error: "Sign in again before sharing a map" }, 401);

    const body = (await request.json()) as InviteRequest;
    const shareId = body.shareId?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const role = body.role;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shareId))
      return json(request, { error: "Choose a valid shared map" }, 400);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json(request, { error: "Enter a valid email address" }, 400);
    if (role !== "viewer" && role !== "editor" && role !== "admin")
      return json(request, { error: "Choose a valid sharing role" }, 400);

    const requestHeaders = authenticatedRequest(request, publicKey);
    const shareResponse = await fetch(
      `${supabaseUrl}/rest/v1/project_shares?select=id,name&id=eq.${encodeURIComponent(shareId)}&active=eq.true&limit=1`,
      { headers: requestHeaders },
    );
    if (!shareResponse.ok)
      return json(request, { error: await responseError(shareResponse) }, shareResponse.status);
    const share = ((await shareResponse.json()) as ShareRow[])[0];
    if (!share) return json(request, { error: "This shared map is unavailable" }, 404);

    const memberResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/invite_share_member`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ p_share_id: shareId, p_email: email, p_role: role }),
    });
    if (!memberResponse.ok)
      return json(request, { error: await responseError(memberResponse) }, memberResponse.status);
    const member = ((await memberResponse.json()) as MemberRow[])[0];
    if (!member) return json(request, { error: "Access could not be granted" }, 500);

    const resendApiKey = Deno.env.get("RESEND_API_KEY")?.trim() ?? "";
    if (!resendApiKey)
      return json(request, {
        member,
        emailSent: false,
        warning: "Access was granted, but outbound invitation email is not configured.",
      });

    const inviteUrl = new URL(Deno.env.get("LANDDRAFT_SITE_URL")?.trim() || DEFAULT_SITE_URL);
    inviteUrl.searchParams.set("share", shareId);
    const sender = inviterName(user);
    const escapedSender = escapeHtml(sender);
    const escapedMap = escapeHtml(share.name);
    const escapedRole = escapeHtml(roleNames[role]);
    const escapedDescription = escapeHtml(roleDescriptions[role]);
    const escapedUrl = escapeHtml(inviteUrl.toString());
    const logoUrl = new URL("/landdraft-icon-192.png", inviteUrl.origin).toString();
    const escapedLogoUrl = escapeHtml(logoUrl);
    const escapedEmail = escapeHtml(email);
    const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || DEFAULT_FROM_EMAIL;
    const emailResponse = await fetch(RESEND_EMAILS_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "LandDraft-Share/1.0",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `${subjectText(sender)} shared “${subjectText(share.name)}” with you in LandDraft`,
        text: `LANDDRAFT\nPrivate map invitation\n\n${sender} shared “${share.name}” with you.\nAccess: ${roleNames[role]}\n\n${roleDescriptions[role]}\n\nOPEN SHARED MAP\n${inviteUrl.toString()}\n\nFor security, access is tied to ${email}. Sign in to LandDraft with that email address. The link does not grant access to anyone else.\n\nLandDraft — Map, measure and shape the land\nhttps://landdraft.net`,
        html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>LandDraft map invitation</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { padding: 18px 10px !important; }
        .email-card { border-radius: 16px !important; }
        .email-content { padding: 28px 22px !important; }
        .email-header { padding: 22px !important; }
        .email-title { font-size: 27px !important; }
        .email-button { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f0e3;color:#173328;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapedSender} shared “${escapedMap}” with you in LandDraft.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4f0e3;">
      <tr>
        <td class="email-shell" align="center" style="padding:40px 18px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="email-card" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #d9ddcf;border-radius:22px;overflow:hidden;box-shadow:0 8px 28px rgba(23,51,40,0.08);">
            <tr>
              <td class="email-header" style="padding:24px 32px;background-color:#227448;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="52" valign="middle" style="width:52px;">
                      <img src="${escapedLogoUrl}" width="46" height="46" alt="LandDraft logo" style="display:block;width:46px;height:46px;border:0;border-radius:12px;">
                    </td>
                    <td valign="middle" style="padding-left:13px;">
                      <div style="font-size:24px;line-height:28px;font-weight:700;letter-spacing:-0.4px;color:#ffffff;">LandDraft</div>
                      <div style="padding-top:2px;font-size:10px;line-height:14px;font-weight:700;letter-spacing:1.15px;color:#e4f1e8;">MAP, MEASURE AND SHAPE THE LAND</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-content" style="padding:38px 36px 34px;">
                <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.4px;color:#227448;">PRIVATE MAP INVITATION</div>
                <h1 class="email-title" style="margin:10px 0 12px;font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.55px;color:#173328;">A map has been shared with you</h1>
                <p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#52645b;"><strong style="color:#173328;">${escapedSender}</strong> invited you to collaborate on:</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-bottom:26px;background-color:#f8f6ed;border:1px solid #e0e2d6;border-radius:14px;">
                  <tr>
                    <td style="padding:20px 20px 18px;">
                      <div style="font-size:11px;line-height:15px;font-weight:700;letter-spacing:0.9px;color:#6a786f;">SHARED MAP</div>
                      <div style="padding-top:5px;font-size:21px;line-height:29px;font-weight:700;color:#173328;">${escapedMap}</div>
                      <div style="padding-top:13px;">
                        <span style="display:inline-block;padding:6px 10px;background-color:#e2f0e5;border:1px solid #bad4c1;border-radius:999px;font-size:12px;line-height:16px;font-weight:700;color:#1d633e;">${escapedRole}</span>
                      </div>
                      <p style="margin:13px 0 0;font-size:14px;line-height:22px;color:#52645b;">${escapedDescription}</p>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
                  <tr>
                    <td align="center" bgcolor="#227448" style="border-radius:12px;">
                      <a class="email-button" href="${escapedUrl}" target="_blank" style="display:inline-block;padding:14px 23px;border:1px solid #227448;border-radius:12px;background-color:#227448;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">Open shared map&nbsp;&nbsp;&rarr;</a>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f1f6f2;border-left:4px solid #80aa8d;border-radius:8px;">
                  <tr>
                    <td style="padding:13px 15px;font-size:13px;line-height:20px;color:#52645b;">
                      <strong style="color:#173328;">Your access is protected.</strong> Sign in with <strong style="color:#173328;">${escapedEmail}</strong>. This link does not give access to anyone who has not been invited.
                    </td>
                  </tr>
                </table>

                <p style="margin:25px 0 6px;font-size:12px;line-height:18px;color:#77837c;">If the button does not work, copy and paste this address into your browser:</p>
                <p style="margin:0;font-size:12px;line-height:18px;word-break:break-all;"><a href="${escapedUrl}" style="color:#227448;text-decoration:underline;">${escapedUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:21px 30px;background-color:#173328;text-align:center;">
                <p style="margin:0 0 5px;font-size:12px;line-height:18px;color:#d9e4dd;">LandDraft &middot; Map, measure and shape the land</p>
                <p style="margin:0;font-size:11px;line-height:17px;color:#9eb0a6;">You received this email because ${escapedSender} invited ${escapedEmail} to a private LandDraft map.</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px auto 0;max-width:560px;font-size:11px;line-height:17px;text-align:center;color:#77837c;">If you were not expecting this invitation, you can safely ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
      }),
    });
    if (!emailResponse.ok)
      return json(request, {
        member,
        emailSent: false,
        warning: `Access was granted, but Resend could not deliver the invitation (${emailResponse.status}).`,
      });
    const emailResult = (await emailResponse.json()) as { id?: string };
    return json(request, { member, emailSent: true, messageId: emailResult.id ?? null });
  } catch (error) {
    console.error("Share invitation failed", error);
    return json(
      request,
      { error: error instanceof Error ? error.message : "The invitation could not be sent" },
      500,
    );
  }
});
