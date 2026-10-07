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
// Trash and read state for the Inbox. Must be added to the service account's
// domain-wide delegation in the Workspace Admin console, beside the two above.
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
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

/** What makes a sent email a reply in every inbox: the Message-ID it answers and
 *  the References chain before it (the client's mail app threads on these), plus
 *  the thread id in the sender's own mailbox (Gmail threads the Sent copy on it). */
export type ReplyHeaders = { messageId: string; references: string; threadId: string | null };

export async function sendGmailAs(
  fromEmail: string,
  // isHtml: the caller already has real HTML (the Journal's rich-text email
  // composer) — send msg.body as-is instead of escaping+linebreak-converting
  // it as plain text. Defaults false: the other callers here (password
  // reset, mention/notification emails) still pass a plain string.
  msg: { to: string; cc?: string[]; bcc?: string[]; subject?: string; body: string; isHtml?: boolean; fromName?: string; attachments?: { filename: string; mimeType: string; contentBase64: string }[]; replyTo?: ReplyHeaders | null },
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
    ...(msg.replyTo ? [
      `In-Reply-To: ${msg.replyTo.messageId}`,
      `References: ${[msg.replyTo.references, msg.replyTo.messageId].filter(Boolean).join(" ")}`,
    ] : []),
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
    body: JSON.stringify(msg.replyTo?.threadId ? { raw, threadId: msg.replyTo.threadId } : { raw }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail send failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json().catch(() => ({}));
  return { id: json.id ?? "", threadId: json.threadId ?? "" };
}

// The reply headers for one email, read from `mailbox` (Derek, 2026-09-11:
// replies should stay in the client's thread). A Gmail message id only exists in
// the mailbox it was read from, so a teammate replying to an email pulled from
// someone else's inbox falls back to the Message-ID header, which is the same
// everywhere: a search finds this mailbox's copy, and when there is none the
// header alone still threads the reply in the client's inbox.
export async function readReplyHeaders(mailbox: string, find: { gmailMessageId?: string | null; rfc822?: string | null }): Promise<ReplyHeaders | null> {
  if (!googleConfigured) return null;
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: mailbox });
  const { token } = await jwt.getAccessToken();
  if (!token) return null;
  const auth = { Authorization: `Bearer ${token}` };
  const read = async (id: string): Promise<ReplyHeaders | null> => {
    const res = await fetch(`${GMAIL_LIST}/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`, { headers: auth });
    if (!res.ok) return null;
    const m = await res.json().catch(() => null);
    const headers: any[] = m?.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name?.toLowerCase() === name)?.value ?? "";
    const messageId = h("message-id").trim();
    return messageId ? { messageId, references: h("references").trim(), threadId: m?.threadId ?? null } : null;
  };
  if (find.gmailMessageId) {
    const hit = await read(find.gmailMessageId);
    if (hit) return hit;
  }
  if (find.rfc822) {
    const bare = find.rfc822.trim().replace(/^<|>$/g, "");
    const res = await fetch(`${GMAIL_LIST}?q=${encodeURIComponent(`rfc822msgid:${bare}`)}&maxResults=1`, { headers: auth });
    const j = res.ok ? await res.json().catch(() => ({})) : {};
    const id: string | undefined = j.messages?.[0]?.id;
    const hit = id ? await read(id) : null;
    return hit ?? { messageId: `<${bare}>`, references: "", threadId: null };
  }
  return null;
}

export type InboundEmail = { gmailId: string; threadId: string; fromEmail: string; fromName: string; subject: string; body: string; internalDate: string; auto: boolean; rfc822: string; attachments?: GmailFile[];
  /** Everyone else it went to (To and CC, minus the mailbox itself), for Reply all. */
  others?: string[];
  /** Gmail's inbox tab. */
  tab?: "primary" | "updates" | "promotions" | "social" | "forums";
  /** Still unread in Gmail. Read there: the Inbox marks it read too. */
  unread?: boolean };

/** A file on an email, left in Gmail and fetched when someone opens it
 *  (api/inbox/attachment), so a photo shows as a preview in the Inbox
 *  (Derek, 2026-10-01: "show a preview if there are images"). */
const TAB_BY_LABEL: Record<string, "updates" | "promotions" | "social" | "forums"> = {
  CATEGORY_UPDATES: "updates", CATEGORY_PROMOTIONS: "promotions", CATEGORY_SOCIAL: "social", CATEGORY_FORUMS: "forums",
};
export const tabOf = (labels: unknown): "primary" | "updates" | "promotions" | "social" | "forums" => {
  for (const l of Array.isArray(labels) ? labels : []) if (TAB_BY_LABEL[l as string]) return TAB_BY_LABEL[l as string];
  return "primary";
};

export type GmailFile = { name: string; mimeType: string; bytes: number; gmailAttachmentId: string; inline: boolean };

export function gmailFiles(payload: any): GmailFile[] {
  const out: GmailFile[] = [];
  const walk = (part: any) => {
    if (!part) return;
    const id = part.body?.attachmentId;
    if (id && (part.filename || String(part.mimeType ?? "").startsWith("image/"))) {
      const headers: any[] = part.headers ?? [];
      // Shown inside the email itself (a Content-ID, and not sent as an
      // attachment): a signature's logo and social icons, even when the mail
      // program named it "image.png" (Derek, 2026-10-02: 14 of them on one email).
      const disposition = String(headers.find((x) => x.name?.toLowerCase() === "content-disposition")?.value ?? "").toLowerCase();
      const cid = String(headers.find((x) => x.name?.toLowerCase() === "content-id")?.value ?? "");
      const inline = !!cid && !disposition.startsWith("attachment");
      // Pasted into the email in Gmail (its Content-ID starts "ii_"): a
      // screenshot someone meant you to see, whatever its size (Derek,
      // 2026-10-06: a 53 KB Stripe screenshot was dropped as a "logo").
      const pasted = /^<?ii_/i.test(cid.trim());
      out.push({ name: part.filename || "image", mimeType: part.mimeType || "application/octet-stream", bytes: Number(part.body?.size) || 0, gmailAttachmentId: id, inline: inline && !pasted });
    }
    for (const p of part.parts ?? []) walk(p);
  };
  walk(payload);
  // A signature logo or tracking pixel is not something anyone sent you.
  return out.filter((f) => !(f.inline && f.bytes < 100_000)).slice(0, 20);
}

/** One file's bytes from a teammate's Gmail. */
export async function readGmailAttachment(mailbox: string, gmailMessageId: string, attachmentId: string): Promise<Buffer> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: mailbox });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const res = await fetch(`${GMAIL_LIST}/${encodeURIComponent(gmailMessageId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail attachment failed (${res.status})`);
  const data = String((await res.json())?.data ?? "");
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

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
      rfc822: h("message-id"),
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
/** Services that send a shared file on someone's behalf, from their own address. */
const FILE_SHARE_SENDER = /@(google\.com|docs\.google\.com|dropbox\.com|dropboxmail\.com|box\.com|wetransfer\.com|onedrive\.com|sharepointonline\.com)$/;

/** One Gmail message (format=full) as an Inbox email; null without a sender. */
function parseInbound(m: any, userEmail: string): InboundEmail | null {
    const headers: any[] = m.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name?.toLowerCase() === name)?.value ?? "";
    const fromRaw = h("from");
    const match = fromRaw.match(/(?:"?([^"<]*)"?\s*)?<?([^<>@\s]+@[^<>\s]+)>?/);
    let fromName = (match?.[1] ?? "").trim();
    let fromEmail = (match?.[2] ?? "").trim().toLowerCase();
    if (!fromEmail) return null;
    // A file shared through Google Drive, Dropbox and the like comes from the
    // service's own address with the person in Reply-To: it is from them
    // (Derek, 2026-10-06: Pamela's video read as a stranger).
    const shared = FILE_SHARE_SENDER.test(fromEmail) && h("reply-to").match(/[^<>@\s,"]+@[^<>\s,"]+/)?.[0]?.toLowerCase();
    if (shared && shared !== fromEmail) { fromEmail = shared; fromName = fromName.replace(/\s*\(via [^)]*\)\s*$/i, "").trim(); }
    // Bulk / automated mail (newsletters, notifications, no-reply senders) sets
    // these headers or uses a machine local-part — real person-to-person email
    // doesn't. Used to keep the "unknown sender → Inbox" path from flooding.
    const precedence = h("precedence").toLowerCase();
    const autoSubmitted = h("auto-submitted").toLowerCase();
    const fromLocal = fromEmail.split("@")[0];
    const auto = !shared && (!!h("list-unsubscribe")
      || ["bulk", "list", "junk", "auto_reply"].includes(precedence)
      || (!!autoSubmitted && autoSubmitted !== "no")
      || /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce|notif|newsletter|mailer|updates?|news|marketing|billing|alerts?)\b|[-.]?(no-?reply|noreply)/.test(fromLocal));
    return {
      gmailId: m.id, threadId: m.threadId ?? "", fromEmail, fromName,
      subject: h("subject"), body: extractBody(m.payload, m.snippet ?? ""),
      internalDate: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
      auto,
      rfc822: h("message-id"),
      attachments: gmailFiles(m.payload),
      unread: Array.isArray(m.labelIds) ? m.labelIds.includes("UNREAD") : undefined,
      // Gmail's tab for it: anything but Primary goes to the Inbox's Updates folder.
      tab: tabOf(m.labelIds),
      others: [...new Set([...`${h("to")},${h("cc")}`.matchAll(/[^<>@\s,"]+@[^<>\s,"]+/g)].map((x) => x[0].toLowerCase()))]
        .filter((a) => a !== userEmail.toLowerCase() && a !== fromEmail).slice(0, 20),
    };
}

/** The newest inbox message of each thread, read the same way as
 *  readInboundGmail. For the mirror (Derek, 2026-10-07: "sync Gmail to CUL
 *  Tasks, let's stop trying to filter"): a thread in Gmail's inbox the app has
 *  never seen, such as snoozed mail coming back, however old. */
export async function readInboxThreadsLatest(userEmail: string, threadIds: string[]): Promise<InboundEmail[]> {
  if (!googleConfigured || !threadIds.length) return [];
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: userEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const out: InboundEmail[] = [];
  for (let i = 0; i < threadIds.length; i += 8) {
    const batch = await Promise.all(threadIds.slice(i, i + 8).map(async (id) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=full`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      const t = r?.ok ? await r.json().catch(() => null) : null;
      const msgs: any[] = t?.messages ?? [];
      const inInbox = msgs.filter((m) => Array.isArray(m.labelIds) && m.labelIds.includes("INBOX"));
      const pick = inInbox.length ? inInbox : msgs;
      const m = pick[pick.length - 1];
      return m ? parseInbound(m, userEmail) : null;
    }));
    for (const em of batch) if (em) out.push(em);
  }
  return out;
}

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
  // Eight at a time: reading every tab is more mail per run than Primary alone.
  const full: any[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      const r = await fetch(`${GMAIL_LIST}/${id}?format=full`, { headers: auth }).catch(() => null);
      return r?.ok ? r.json().catch(() => null) : null;
    }));
    full.push(...batch);
  }
  for (const m of full) {
    const em = m ? parseInbound(m, userEmail) : null;
    if (em) out.push(em);
  }
  return out;
}

export type SentEmail = { gmailId: string; threadId: string; toEmails: string[]; subject: string; body: string; internalDate: string; rfc822: string; attachments?: GmailFile[] };

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
      rfc822: h("message-id"),
      attachments: gmailFiles(m.payload),
    });
  }
  return out;
}

/** The conversation ids a Gmail search finds (ids only, so it's one cheap call
 *  a page). Up to `pages` pages of 500. For telling which Inbox emails were
 *  archived or deleted in Gmail (Derek, 2026-10-05). */
export async function gmailThreadIds(userEmail: string, query: string, pages = 3): Promise<Set<string>> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: userEmail });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const ids = new Set<string>();
  let pageToken = "";
  for (let i = 0; i < pages; i++) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Gmail thread list failed (${res.status})`);
    const j = await res.json().catch(() => ({}));
    for (const t of j.threads ?? []) if (t?.id) ids.add(String(t.id));
    pageToken = j.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return ids;
}

/** Move a conversation to Gmail's Trash, or back out of it. Throws when the
 *  service account lacks gmail.modify (the Inbox then says so). */
export async function trashGmailThread(mailbox: string, threadId: string, restore = false): Promise<void> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_MODIFY_SCOPE], subject: mailbox });
  const { token } = await jwt.getAccessToken().catch(() => ({ token: null as string | null }));
  if (!token) throw new Error("Gmail permission to move mail to Trash isn't set up yet.");
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/${restore ? "untrash" : "trash"}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail ${restore ? "restore" : "trash"} failed (${res.status})`);
}

/** Read state and archive for a conversation in Gmail, kept in step with the
 *  Inbox: read removes UNREAD, unread adds it, archive removes INBOX and
 *  unarchive puts it back. Needs gmail.modify (granted 2026-10-01). */
export async function setGmailThreadLabels(mailbox: string, threadId: string, change: "read" | "unread" | "archive" | "unarchive" | "star" | "unstar"): Promise<void> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_MODIFY_SCOPE], subject: mailbox });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const body = change === "read" ? { removeLabelIds: ["UNREAD"] }
    : change === "unread" ? { addLabelIds: ["UNREAD"] }
    : change === "archive" ? { removeLabelIds: ["INBOX", "UNREAD"] }
    : change === "star" ? { addLabelIds: ["STARRED"] }
    : change === "unstar" ? { removeLabelIds: ["STARRED"] }
    : { addLabelIds: ["INBOX"] };
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gmail ${change} failed (${res.status})`);
}

/** An email as it was sent: its HTML, with photos it carries inline
 *  ("cid:" images) turned into data URIs so they show. Null when it has no
 *  HTML part (a plain text email). For the Inbox's reading view (Derek,
 *  2026-10-01: "show it like Gmail"). */
export async function readGmailHtml(mailbox: string, gmailMessageId: string): Promise<string | null> {
  if (!googleConfigured) throw new Error("Google Workspace is not configured.");
  const jwt = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: [GMAIL_READ_SCOPE], subject: mailbox });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google access token.");
  const auth = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${GMAIL_LIST}/${encodeURIComponent(gmailMessageId)}?format=full`, { headers: auth });
  if (!res.ok) throw new Error(`Gmail read failed (${res.status})`);
  const m = await res.json();
  const b64 = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  let html: string | null = null;
  const inline: { cid: string; mime: string; data?: string; attachmentId?: string; size: number }[] = [];
  const walk = (part: any) => {
    if (!part) return;
    if (!html && part.mimeType === "text/html" && part.body?.data) html = b64(part.body.data).toString("utf8");
    const cid = (part.headers ?? []).find((h: any) => h.name?.toLowerCase() === "content-id")?.value?.replace(/[<>]/g, "");
    if (cid && String(part.mimeType ?? "").startsWith("image/")) inline.push({ cid, mime: part.mimeType, data: part.body?.data, attachmentId: part.body?.attachmentId, size: Number(part.body?.size) || 0 });
    for (const p of part.parts ?? []) walk(p);
  };
  walk(m.payload);
  if (!html) return null;
  let out: string = html;
  let budget = 4_000_000;
  for (const img of inline.slice(0, 12)) {
    if (img.size > budget) continue;
    let data = img.data;
    if (!data && img.attachmentId) {
      const a = await fetch(`${GMAIL_LIST}/${encodeURIComponent(gmailMessageId)}/attachments/${encodeURIComponent(img.attachmentId)}`, { headers: auth });
      if (a.ok) data = (await a.json())?.data;
    }
    if (!data) continue;
    budget -= img.size;
    const uri = `data:${img.mime};base64,${b64(data).toString("base64")}`;
    out = out.split(`cid:${img.cid}`).join(uri);
  }
  return out;
}
