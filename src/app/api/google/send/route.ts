import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { appendSignatureHtml } from "@/lib/emailSignature";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";
import { TASK_FILES_BUCKET } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", zip: "application/zip",
};
const mimeFor = (name: string) => MIME_BY_EXT[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

// Send a client email through Google Workspace (Gmail API) AS the teammate who
// clicked send — the reliable per-person "from" path, since GHL's Conversations
// API ignores per-user senders. Same permission model as ../ghl/message: the
// caller can only ever impersonate their OWN @clickuplocal.com address, gated by
// requireUser + the per-client can_message roster. Returns 501 when Google isn't
// configured so the client falls back to the GHL sender instead of failing.

const SEND_DOMAIN = "clickuplocal.com";

// True only if `path` is an attachment this client legitimately owns. See the
// call site for why this gate exists. Rejects traversal outright — a stored
// path never contains ".." and Storage would resolve it against the bucket
// root, so treating it as untrusted is cheaper than reasoning about it.
async function pathBelongsToClient(path: string, clientId: string): Promise<boolean> {
  if (!path || path.includes("..")) return false;
  if (path.startsWith(`waiting/${clientId}/`) || path.startsWith(`extension/${clientId}/`)) return true;
  // Main-app task attachments: `<taskId>/<file>`, so the owning task decides.
  const taskId = path.split("/")[0];
  if (!taskId || taskId === "waiting" || taskId === "extension") return false;
  const { data: task } = await supabaseAdmin.from("tasks").select("client_id").eq("id", taskId).maybeSingle();
  return !!task && task.client_id === clientId;
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace sending is not configured." }, { status: 501 });

  const b = await req.json().catch(() => ({} as any));
  const { clientId, toEmail, subject, body, isHtml, cc, bcc, fromEmail, attachments } = b as {
    clientId?: string;
    toEmail?: string;
    subject?: string;
    body?: string;
    isHtml?: boolean; // the Journal's rich-text composer sends real HTML, not plain text
    cc?: string[];
    bcc?: string[];
    fromEmail?: string; // admin-only: send AS another teammate (a Workspace user)
    attachments?: { path: string; name: string }[];
  };

  if (!clientId || !toEmail?.trim() || !body?.trim())
    return NextResponse.json({ error: "Missing clientId, toEmail, or body." }, { status: 400 });

  // Choose the sending identity. Default = the caller (send-as-self). An admin
  // may pass fromEmail to send AS another Workspace teammate (the DWD can
  // impersonate anyone; only admins get that lever, and only for a domain
  // address). Everyone else is pinned to their own address.
  let sender = caller.email;
  if (fromEmail && fromEmail.toLowerCase() !== caller.email.toLowerCase()) {
    if (caller.role !== "admin" || !fromEmail.toLowerCase().endsWith(`@${SEND_DOMAIN}`))
      return NextResponse.json({ error: "You can only send as yourself." }, { status: 403 });
    sender = fromEmail;
  }
  // The sender must be a Workspace user on the sending domain — the security
  // boundary on domain-wide delegation. A non-domain account 501s → GHL fallback.
  if (!sender || !sender.toLowerCase().endsWith(`@${SEND_DOMAIN}`))
    return NextResponse.json({ error: "Your account isn't a Google Workspace sender." }, { status: 501 });

  // Same two-layer gate as ../ghl/message: global can_send_messages AND this
  // client's can_message roster. Admins pass implicitly.
  if (caller.role !== "admin") {
    if (!caller.canSendMessages) return NextResponse.json({ error: "You don't have permission to send messages. Ask an admin to enable it for you." }, { status: 403 });
    const { data: clientRow } = await supabaseAdmin.from("clients").select("can_message").eq("id", clientId).maybeSingle();
    const allowed = ((clientRow?.can_message as string[] | null) ?? []).includes(caller.memberId ?? "");
    if (!allowed) return NextResponse.json({ error: "You don't have permission to message this client. Ask an admin to enable it for you." }, { status: 403 });
  }

  const ccList = cc?.filter((e) => e?.trim());
  const bccList = bcc?.filter((e) => e?.trim());

  // Display name for the From header ("Derek Fox <derek@…>") — for the actual
  // sender (which may be another teammate when an admin sets fromEmail).
  // Signature belongs to the SENDING identity, not necessarily the caller —
  // an admin sending as another teammate signs off as that teammate.
  const { data: prof } = await supabaseAdmin.from("profiles").select("name, email_signature").ilike("email", sender).maybeSingle();
  const fromName = (prof?.name as string | null)?.trim() || undefined;
  const signature = ((prof?.email_signature as string | null) ?? "").trim();
  // The composers send real HTML; the plain-text branch is only for older/AI
  // callers, where googleMail escapes the whole body itself — so the
  // signature has to be appended as plain text there, not as markup.
  const bodyWithSignature = !signature ? body
    : isHtml ? appendSignatureHtml(body, signature)
    : `${body}\n\n${signature}`;

  // Fetch attachment bytes from the private task-files bucket and base64 them
  // for the MIME parts. Cap the combined size — Gmail rejects > ~25MB raw, and
  // base64 inflates ~33%, so hold well under that.
  const attParts: { filename: string; mimeType: string; contentBase64: string }[] = [];
  let totalBytes = 0;
  for (const a of attachments ?? []) {
    if (!a?.path) continue;
    // The path is caller-supplied and the download runs with the service-role
    // key, so it MUST be proven to belong to this client first — otherwise any
    // user who can message one client could name any path in the bucket and
    // have the server email them the bytes. The bucket has three legitimate
    // shapes: `waiting/<clientId>/…` and `extension/<clientId>/…` (namespaced
    // by client, so a prefix check settles it) and the main app's
    // `<taskId>/<file>` (not client-namespaced — resolve the task and compare
    // its client_id). Anything else is skipped rather than sent.
    if (!(await pathBelongsToClient(a.path, clientId))) continue;
    const { data: file, error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).download(a.path);
    if (error || !file) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    totalBytes += buf.byteLength;
    if (totalBytes > 18 * 1024 * 1024) return NextResponse.json({ error: "Attachments are too large to email (18MB max)." }, { status: 400 });
    attParts.push({ filename: a.name || a.path.split("/").pop() || "attachment", mimeType: mimeFor(a.name || a.path), contentBase64: buf.toString("base64") });
  }

  try {
    const { id, threadId } = await sendGmailAs(sender, {
      to: toEmail.trim(),
      cc: ccList?.length ? ccList : undefined,
      bcc: bccList?.length ? bccList : undefined,
      subject: (subject || "").slice(0, 200),
      body: bodyWithSignature,
      isHtml,
      fromName,
      attachments: attParts.length ? attParts : undefined,
    });
    return NextResponse.json({ ok: true, gmailMessageId: id, gmailThreadId: threadId, from: sender });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail send failed." }, { status: 502 });
  }
}
