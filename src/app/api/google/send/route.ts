import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
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
  const { data: prof } = await supabaseAdmin.from("profiles").select("name").ilike("email", sender).maybeSingle();
  const fromName = (prof?.name as string | null)?.trim() || undefined;

  // Fetch attachment bytes from the private task-files bucket and base64 them
  // for the MIME parts. Cap the combined size — Gmail rejects > ~25MB raw, and
  // base64 inflates ~33%, so hold well under that.
  const attParts: { filename: string; mimeType: string; contentBase64: string }[] = [];
  let totalBytes = 0;
  for (const a of attachments ?? []) {
    if (!a?.path) continue;
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
      body,
      isHtml,
      fromName,
      attachments: attParts.length ? attParts : undefined,
    });
    return NextResponse.json({ ok: true, gmailMessageId: id, gmailThreadId: threadId, from: sender });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail send failed." }, { status: 502 });
  }
}
