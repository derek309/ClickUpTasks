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
  // isHtml: the caller already has real HTML (the Journal's rich-text email
  // composer) — send msg.body as-is instead of escaping+linebreak-converting
  // it as plain text. Defaults false: the other callers here (password
  // reset, mention/notification emails) still pass a plain string.
  msg: { to: string; cc?: string[]; bcc?: string[]; subject?: string; body: string; isHtml?: boolean; fromName?: string; attachments?: { filename: string; mimeType: string; contentBase64: string }[] },
): Promise<{ id: string; threadId: string }> {
  if (!googleConfigured) throw new Error("Google Workspace sending is not configured.");

  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_SCOPE], subject: fromEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");

  const commonHeaders = [
    `From: ${formatFrom(fromEmail, msg.fromName)}`,
    `To: ${msg.to}`,
    ...(msg.cc?.length ? [`Cc: ${msg.cc.join(", ")}`] : []),
    ...(msg.bcc?.length ? [`Bcc: ${msg.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(msg.subject || "")}`,
    "MIME-Version: 1.0",
  ];

  const html = msg.isHtml ? msg.body : bodyToHtml(msg.body);
  let mime: string;
  const atts = msg.attachments ?? [];
  if (atts.length === 0) {
    mime = [...commonHeaders, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", html].join("\r\n");
  } else {
    // multipart/mixed: the HTML body, then each attachment as a base64 part.
    const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
    const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
    const parts = [
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      ...atts.flatMap((a) => [
        `--${boundary}`,
        `Content-Type: ${a.mimeType || "application/octet-stream"}; name="${a.filename.replace(/"/g, "")}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`,
        "",
        wrap76(a.contentBase64),
      ]),
      `--${boundary}--`,
    ];
    mime = [...commonHeaders, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
  }
  const raw = b64url(Buffer.from(mime, "utf8"));

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

// Resolve one Gmail thread from whatever the browser could tell us about it.
//
// The Clipper scrapes a rendered Gmail page, so what it can offer varies. In
// order of how much we trust it:
//
//   messageId  Gmail's own DOM carries data-legacy-message-id, which IS the
//              API message id. One call turns it into a thread id.
//   rfc822     The Message-ID header, which Gmail indexes as rfc822msgid.
//              Exact, and works even from a forwarded copy.
//   search     from/subject, newest first. A guess, and the only one that can
//              pick the wrong thread when a subject repeats — so it is last
//              and it says so in the result.
//
// Returns the thread id plus how it was found, because "we searched for it"
// and "we read its id" deserve different confidence at the call site.
export type ThreadLookup = { threadId: string; messageId: string; subject: string; via: "messageId" | "rfc822" | "search" };

export async function resolveGmailThread(userEmail: string, hint: {
  messageId?: string | null; rfc822?: string | null; fromEmail?: string | null; subject?: string | null;
}): Promise<ThreadLookup | null> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: userEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const auth = { Authorization: `Bearer ${token}` };

  const readMessage = async (id: string, via: ThreadLookup["via"]): Promise<ThreadLookup | null> => {
    const res = await fetch(`${GMAIL_LIST}/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject`, { headers: auth });
    if (!res.ok) return null;
    const m = await res.json().catch(() => null);
    if (!m?.threadId) return null;
    const headers: any[] = m.payload?.headers ?? [];
    const subject = headers.find((x) => x.name?.toLowerCase() === "subject")?.value ?? "";
    return { threadId: m.threadId, messageId: m.id ?? id, subject, via };
  };
  const searchOne = async (q: string, via: ThreadLookup["via"]): Promise<ThreadLookup | null> => {
    const res = await fetch(`${GMAIL_LIST}?q=${encodeURIComponent(q)}&maxResults=1`, { headers: auth });
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({}));
    const id: string | undefined = j.messages?.[0]?.id;
    return id ? readMessage(id, via) : null;
  };

  // A DOM id is only a claim until Gmail confirms it, so this is still a
  // fetch rather than something we write straight to the database.
  if (hint.messageId) {
    const hit = await readMessage(hint.messageId, "messageId");
    if (hit) return hit;
  }
  if (hint.rfc822) {
    const bare = hint.rfc822.replace(/^<|>$/g, "");
    const hit = await searchOne(`rfc822msgid:${bare}`, "rfc822");
    if (hit) return hit;
  }
  if (hint.subject) {
    // Quoted so a subject with its own colons or operators is matched as
    // text rather than parsed as more search syntax.
    const parts = [`subject:"${hint.subject.replace(/"/g, "")}"`];
    if (hint.fromEmail) parts.push(`from:${hint.fromEmail}`);
    return searchOne(parts.join(" "), "search");
  }
  return null;
}

// Every message in one thread, oldest first, with enough to render it in the
// task feed. Used when a thread is first attached to a task, so the task
// shows the conversation so far rather than only whatever arrives next.
export type ThreadEmail = InboundEmail & { toEmails: string[]; outbound: boolean };

export async function readGmailThread(userEmail: string, threadId: string, max = 40): Promise<ThreadEmail[]> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: userEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const auth = { Authorization: `Bearer ${token}` };

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, { headers: auth });
  if (!res.ok) throw new Error(`Gmail thread read failed (${res.status})`);
  const json = await res.json().catch(() => null);
  const msgs: any[] = (json?.messages ?? []).slice(0, max);

  const me = userEmail.toLowerCase();
  return msgs.map((m) => {
    const headers: any[] = m.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name?.toLowerCase() === name)?.value ?? "";
    const fromRaw = h("from");
    const fromEmail = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim().toLowerCase();
    const fromName = fromRaw.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
    const toEmails = [...h("to").matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((x) => x[0].toLowerCase());
    return {
      gmailId: m.id, threadId: m.threadId ?? threadId, fromEmail, fromName,
      subject: h("subject"), body: extractBody(m.payload, m.snippet ?? ""),
      internalDate: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
      auto: false,
      toEmails,
      // Sent by the teammate whose mailbox we are reading, so it renders as
      // outbound rather than as the client writing to themselves.
      outbound: fromEmail === me,
    };
  });
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

export type SentEmail = { gmailId: string; threadId: string; toEmails: string[]; subject: string; body: string; internalDate: string };

// Read recent SENT email for a teammate (same DWD impersonation/scope as
// readInboundGmail) — a reply they sent directly from their own Gmail
// (bypassing the in-app "send as" composer), so it still lands in the
// Journal. Deliberately a separate function, not a parameterized mode on
// readInboundGmail: for sent mail the teammate IS the From address (useless
// to match on) and the client is in `To` instead, and the bulk/automated-mail
// `auto` heuristic is meaningless for mail you sent yourself — different
// enough logic that forking reads cleaner than branching one function two ways.
export async function readSentGmail(userEmail: string, query: string, max = 25): Promise<SentEmail[]> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: userEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const auth = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(`${GMAIL_LIST}?q=${encodeURIComponent(query)}&maxResults=${max}`, { headers: auth });
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status}): ${(await listRes.text().catch(() => "")).slice(0, 200)}`);
  const listJson = await listRes.json().catch(() => ({}));
  const ids: string[] = (listJson.messages ?? []).map((m: any) => m.id).filter(Boolean);

  const out: SentEmail[] = [];
  for (const id of ids) {
    const mRes = await fetch(`${GMAIL_LIST}/${id}?format=full`, { headers: auth });
    if (!mRes.ok) continue;
    const m = await mRes.json().catch(() => null);
    if (!m) continue;
    const headers: any[] = m.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name?.toLowerCase() === name)?.value ?? "";
    // A To header can list multiple recipients — extract every email address
    // (not just the first, unlike From above) so a reply-all still matches
    // whichever recipient turns out to be a known contact.
    const toRaw = h("to");
    const toEmails = [...toRaw.matchAll(/[^<>@\s,]+@[^<>\s,]+/g)].map((mm) => mm[0].trim().toLowerCase());
    if (!toEmails.length) continue;
    out.push({
      gmailId: m.id, threadId: m.threadId ?? "", toEmails,
      subject: h("subject"), body: extractBody(m.payload, m.snippet ?? ""),
      internalDate: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
    });
  }
  return out;
}
