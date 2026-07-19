// Send email through Google Workspace (Gmail API) using a domain-wide
// delegation (DWD) service account that impersonates the sending teammate.
// This is how the app sends client email genuinely "from" the person
// (derek@clickuplocal.com) instead of GHL's sub-account default — GHL's
// Conversations API ignores per-user "from", confirmed by live tests.
//
// Server-only: never import this client-side (it reads the service-account
// private key). One service account, authorized once in the Workspace Admin
// console for the gmail.send scope, can impersonate any @clickuplocal.com user.
import { JWT } from "google-auth-library";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SA_EMAIL = process.env.GOOGLE_SA_CLIENT_EMAIL;
// Private keys pasted into an env var keep literal "\n"; restore real newlines.
const SA_KEY = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");

// Guard mirrored on `adminConfigured` (supabaseAdmin.ts) — routes 501 when unset
// so the app degrades to the GHL sender instead of erroring.
export const googleConfigured = Boolean(SA_EMAIL && SA_KEY);

const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_LIST = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Same plain-text→HTML transform the GHL email path uses, so line breaks survive.
const bodyToHtml = (s: string) => escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");

// RFC 2047 encoded-word for a header value that isn't plain ASCII (e.g. a
// subject with an emoji or accented name).
const encodeHeader = (s: string) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Send an email as `fromEmail`. Returns Gmail's message + thread ids. Throws on
// any failure (missing config, token error, non-2xx from Gmail) — callers map
// that to a 501/502 and can fall back to the GHL path.
// "Derek Fox <derek@clickuplocal.com>" — quote/encode the display name so a
// comma or non-ASCII char can't break the header.
const formatFrom = (email: string, name?: string) => {
  const n = name?.trim();
  if (!n) return email;
  const phrase = /^[\x20-\x7e]*$/.test(n)
    ? (/[",<>@]/.test(n) ? `"${n.replace(/"/g, '\\"')}"` : n)
    : encodeHeader(n);
  return `${phrase} <${email}>`;
};

export async function sendGmailAs(
  fromEmail: string,
  msg: { to: string; cc?: string[]; bcc?: string[]; subject?: string; body: string; fromName?: string },
): Promise<{ id: string; threadId: string }> {
  if (!googleConfigured) throw new Error("Google Workspace sending is not configured.");

  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_SCOPE], subject: fromEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");

  const headerLines = [
    `From: ${formatFrom(fromEmail, msg.fromName)}`,
    `To: ${msg.to}`,
    ...(msg.cc?.length ? [`Cc: ${msg.cc.join(", ")}`] : []),
    ...(msg.bcc?.length ? [`Bcc: ${msg.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(msg.subject || "")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  const raw = b64url(Buffer.from(headerLines.join("\r\n") + "\r\n\r\n" + bodyToHtml(msg.body), "utf8"));

  const res = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail send failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json().catch(() => ({}));
  return { id: json.id ?? "", threadId: json.threadId ?? "" };
}

export type InboundEmail = { gmailId: string; threadId: string; fromEmail: string; fromName: string; subject: string; body: string; internalDate: string; auto: boolean };

// Walk a Gmail message payload for the best text body — prefer text/plain,
// fall back to the first text/html (stripped), then the snippet.
function extractBody(payload: any, snippet: string): string {
  const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  const walk = (part: any, want: string): string | null => {
    if (!part) return null;
    if (part.mimeType === want && part.body?.data) return decode(part.body.data);
    for (const p of part.parts ?? []) { const r = walk(p, want); if (r) return r; }
    return null;
  };
  const plain = walk(payload, "text/plain");
  if (plain) return plain.trim();
  const html = walk(payload, "text/html");
  if (html) return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  return snippet;
}

// Read recent inbound email for a teammate (impersonated via DWD, gmail.readonly
// scope). Used to pull client replies that came back through Gmail directly
// (bypassing GHL) so they still land in the app. `query` is a Gmail search
// string, e.g. "in:inbox newer_than:2d -from:me category:primary".
export async function readInboundGmail(userEmail: string, query: string, max = 25): Promise<InboundEmail[]> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: userEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const auth = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(`${GMAIL_LIST}?q=${encodeURIComponent(query)}&maxResults=${max}`, { headers: auth });
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status}): ${(await listRes.text().catch(() => "")).slice(0, 200)}`);
  const listJson = await listRes.json().catch(() => ({}));
  const ids: string[] = (listJson.messages ?? []).map((m: any) => m.id).filter(Boolean);

  const out: InboundEmail[] = [];
  for (const id of ids) {
    const mRes = await fetch(`${GMAIL_LIST}/${id}?format=full`, { headers: auth });
    if (!mRes.ok) continue;
    const m = await mRes.json().catch(() => null);
    if (!m) continue;
    const headers: any[] = m.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name?.toLowerCase() === name)?.value ?? "";
    const fromRaw = h("from");
    const match = fromRaw.match(/(?:"?([^"<]*)"?\s*)?<?([^<>@\s]+@[^<>\s]+)>?/);
    const fromName = (match?.[1] ?? "").trim();
    const fromEmail = (match?.[2] ?? "").trim().toLowerCase();
    if (!fromEmail) continue;
    // Bulk / automated mail (newsletters, notifications, no-reply senders) sets
    // these headers or uses a machine local-part — real person-to-person email
    // doesn't. Used to keep the "unknown sender → Inbox" path from flooding.
    const precedence = h("precedence").toLowerCase();
    const autoSubmitted = h("auto-submitted").toLowerCase();
    const fromLocal = fromEmail.split("@")[0];
    const auto = !!h("list-unsubscribe")
      || ["bulk", "list", "junk", "auto_reply"].includes(precedence)
      || (!!autoSubmitted && autoSubmitted !== "no")
      || /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce|notif|newsletter|mailer|updates?|news|marketing|billing|alerts?)\b|[-.]?(no-?reply|noreply)/.test(fromLocal);
    out.push({
      gmailId: m.id, threadId: m.threadId ?? "", fromEmail, fromName,
      subject: h("subject"), body: extractBody(m.payload, m.snippet ?? ""),
      internalDate: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
      auto,
    });
  }
  return out;
}
