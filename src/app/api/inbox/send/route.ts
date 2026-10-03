import { NextRequest, NextResponse } from "next/server";
import { requireUser, canCallerMessageClient, callerCanSeeTask } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendGmailAs, googleConfigured, readReplyHeaders } from "@/lib/googleMail";
import { appendSignatureHtml } from "@/lib/emailSignature";
import { sentRfc822 } from "@/lib/sendMessageServer";
import { tokenForLocation } from "@/lib/ghlTokens";
import { TASK_FILES_BUCKET } from "@/lib/db";
import { plainTextToHtml, looksLikeHtml, htmlToText } from "@/lib/data";
import { resolveTrackedClientId } from "@/lib/ghlConversationTask";
import { parseThreadKey, threadRows, canUseThread, ghlConversation, linkedTaskId, peerOf, GHL_SEND_TYPE, escapeLike } from "@/lib/inboxServer";
import { richToText } from "@/lib/inbox";
import { isClientVisible } from "@/lib/extensionApi";
import { contactHome } from "@/lib/ghlPerson";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Send from the Inbox (Derek, 2026-10-01: "we don't have to even go to gmail
// or ghl to send messages"). One route for every kind of conversation:
// - a Gmail conversation is answered from the caller's own Gmail, in the
//   thread, with their signature, CC, BCC and attachments;
// - a GoHighLevel conversation is answered on its own channel (text,
//   Facebook, Instagram, website chat, Google Business; a missed call by text);
// - with no conversation, a new email to any address.
// The sent message is stored here, on the conversation's task and client, so
// it shows in the Inbox and on the task without waiting for a poll.

const SEND_DOMAIN = "clickuplocal.com";
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", zip: "application/zip",
};
const mimeFor = (name: string) => MIME_BY_EXT[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
const cleanList = (l: unknown) => (Array.isArray(l) ? l : []).map((e) => String(e ?? "").trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 30);

type Body = {
  threadKey?: string | null; channel?: string; to?: string; cc?: string[]; bcc?: string[];
  /** A new text: the contact to text (their GoHighLevel contact). */
  contactId?: string;
  subject?: string; body?: string; attachments?: { path: string; name: string }[];
};

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!caller.canSendMessages) return NextResponse.json({ error: "You don't have permission to send messages. Ask an admin to enable it for you." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const text = (b.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  if (!b.threadKey && b.channel === "sms") return sendNewText(caller, b, text);
  const ref = b.threadKey ? parseThreadKey(b.threadKey) : null;
  if (b.threadKey && !ref) return NextResponse.json({ error: "Unknown conversation." }, { status: 400 });
  const rows = ref ? await threadRows(ref, caller) : [];
  if (ref && !rows.length) return NextResponse.json({ error: "That conversation is gone." }, { status: 404 });
  const conv = ref?.kind === "ghl" ? await ghlConversation(ref.id) : null;
  if (ref && !(await canUseThread(caller, ref, rows, conv))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });

  const peer = peerOf(rows, conv);
  // A client's conversation keeps the per-client messaging rule; a stranger's
  // is the caller's own mail or an unassigned lead.
  if (peer.clientId) {
    const denied = await canCallerMessageClient(caller, peer.clientId);
    if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  }
  const taskId = linkedTaskId(rows);

  // A task's own files, put in from Insert from task, when the caller can see that task.
  const seesTask = (id: string) => callerCanSeeTask(req, id);
  if (!ref || ref.kind === "gm") return sendEmail(caller, b, text, rows, peer, taskId, seesTask);
  // A GoHighLevel conversation with only email in it is answered by email,
  // from the caller's Gmail, rather than turned away.
  if (conv && !rows.some((r) => GHL_SEND_TYPE[r.channel as string]) && conv.email) {
    return sendEmail(caller, { ...b, to: (b.to ?? "").trim() || (conv.email as string) }, text, [], peer, taskId, seesTask);
  }
  return sendGhl(caller, b, text, rows, conv, peer, taskId);
}

async function sendEmail(caller: any, b: Body, text: string, rows: any[], peer: ReturnType<typeof peerOf>, taskId: string | null, seesTask: (id: string) => Promise<boolean>) {
  if (!googleConfigured) return NextResponse.json({ error: "Gmail sending is not configured." }, { status: 501 });
  const sender = caller.email as string;
  if (!sender.toLowerCase().endsWith(`@${SEND_DOMAIN}`)) return NextResponse.json({ error: "Your account isn't a Google Workspace sender." }, { status: 501 });
  const to = (b.to ?? "").trim() || peer.address || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ error: "Add who it goes to." }, { status: 400 });
  const cc = cleanList(b.cc), bcc = cleanList(b.bcc);

  // A new email to a known contact still belongs to their client.
  let contactId = peer.contactId, clientId = peer.clientId;
  if (!rows.length) {
    const { data: c } = await supabaseAdmin.from("contacts").select("id, client_id").ilike("email", escapeLike(to)).limit(1).maybeSingle();
    if (c) { contactId = c.id as string; clientId = c.client_id as string; }
    // The same per-client rule as replying in their conversation.
    if (clientId && clientId !== peer.clientId) {
      const denied = await canCallerMessageClient(caller, clientId);
      if (denied) return NextResponse.json({ error: denied }, { status: 403 });
    }
  }

  const { data: prof } = await supabaseAdmin.from("profiles").select("name, email_signature").eq("id", caller.id).maybeSingle();
  // The Inbox email box writes HTML (bold, lists, links); the rest is plain.
  const rich = looksLikeHtml(text);
  if (rich && !htmlToText(text).trim()) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  const html = appendSignatureHtml(rich ? text : plainTextToHtml(text), ((prof?.email_signature as string | null) ?? "").trim());

  const attParts: { filename: string; mimeType: string; contentBase64: string }[] = [];
  const stored: { id: string; name: string; kind: "doc" | "image" | "pdf"; size: string; path: string }[] = [];
  let total = 0;
  for (const a of (b.attachments ?? []).slice(0, 10)) {
    // Only files this person uploaded for the Inbox, or the client's own
    // when it is this conversation's client or one the caller can see.
    if (!a?.path || a.path.includes("..")) continue;
    const okPath = a.path.startsWith(`inbox/${caller.memberId}/`)
      || (!!clientId && a.path.startsWith(`messages/${clientId}/`)
        && (caller.role === "admin" || (clientId === peer.clientId && rows.length > 0) || (await isClientVisible(caller, clientId))))
      || (/^[\w-]{1,80}\/[^/]+$/.test(a.path) && (await seesTask(a.path.split("/")[0])));
    if (!okPath) continue;
    const { data: file } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).download(a.path);
    if (!file) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    total += buf.byteLength;
    if (total > 18 * 1024 * 1024) return NextResponse.json({ error: "Attachments are too large to email (18MB max)." }, { status: 400 });
    const name = a.name || a.path.split("/").pop() || "attachment";
    attParts.push({ filename: name, mimeType: mimeFor(name), contentBase64: buf.toString("base64") });
    const mime = mimeFor(name);
    stored.push({ id: "at_" + crypto.randomUUID(), name, kind: mime.startsWith("image/") ? "image" : mime === "application/pdf" ? "pdf" : "doc", size: `${Math.max(1, Math.round(buf.byteLength / 1024))} KB`, path: a.path });
  }

  // Answer the newest message the other person sent, so it threads.
  // Read from the mailbox the email is in: an admin answering a teammate's
  // email still threads it for the person receiving it.
  const answer = rows.find((r) => r.direction === "inbound") ?? rows[0];
  let headerMailbox = sender;
  if (answer?.mailbox_member_id && answer.mailbox_member_id !== caller.memberId) {
    const { data: owner } = await supabaseAdmin.from("profiles").select("email").eq("member_id", answer.mailbox_member_id).maybeSingle();
    if (owner?.email) headerMailbox = owner.email as string;
  }
  const headers = answer ? await readReplyHeaders(headerMailbox, { gmailMessageId: answer.gmail_message_id, rfc822: answer.rfc822_message_id }).catch(() => null) : null;
  // A thread id belongs to one mailbox, so it is only kept for the caller's own.
  const replyTo = headers && headerMailbox !== sender ? { ...headers, threadId: null } : headers;
  const firstSubject = [...rows].reverse().find((r) => r.subject)?.subject as string | undefined;
  const subject = (b.subject?.trim() || (firstSubject ? (/^re:/i.test(firstSubject) ? firstSubject : `Re: ${firstSubject}`) : "")).slice(0, 200);

  try {
    const { id, threadId } = await sendGmailAs(sender, {
      to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, subject, body: html, isHtml: true,
      fromName: (prof?.name as string | null)?.trim() || undefined, attachments: attParts.length ? attParts : undefined, replyTo,
    });
    const rfc822 = await sentRfc822(sender, id);
    const row = {
      id: "msg_" + crypto.randomUUID(), contact_id: contactId, client_id: clientId, task_id: taskId,
      channel: "email", direction: "outbound", subject: subject || null, body: rich ? richToText(text) : text,
      gmail_message_id: id, gmail_thread_id: threadId, rfc822_message_id: rfc822, created_by: caller.memberId,
      mailbox_member_id: caller.memberId, peer_name: peer.name, peer_address: to.toLowerCase(),
      cc, bcc, attachments: stored, read: true,
    };
    const { error } = await supabaseAdmin.from("messages").insert(row);
    if (error) console.error("[inbox/send] stored copy failed", error.message);
    return NextResponse.json({ ok: true, messageId: row.id, threadKey: `gm:${threadId}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail send failed." }, { status: 502 });
  }
}

async function sendGhl(caller: any, b: Body, text: string, rows: any[], conv: any, peer: ReturnType<typeof peerOf>, taskId: string | null) {
  if (!conv) return NextResponse.json({ error: "That conversation hasn't synced from GoHighLevel yet. Try again in a few minutes." }, { status: 404 });
  // The newest row on a channel that can be answered (a GoHighLevel
  // conversation can hold email too).
  const channel = (rows.find((r) => GHL_SEND_TYPE[r.channel as string])?.channel as string) ?? "sms";
  const type = GHL_SEND_TYPE[channel];
  if (!type) return NextResponse.json({ error: "Reply to this one from GoHighLevel." }, { status: 400 });
  const token = await tokenForLocation(conv.location_id as string);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token for this sub-account." }, { status: 501 });

  const { data: prof } = await supabaseAdmin.from("profiles").select("ghl_user_id").eq("id", caller.id).maybeSingle();
  const res = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ type, contactId: conv.ghl_contact_id, message: text, ...(prof?.ghl_user_id ? { userId: prof.ghl_user_id } : {}) }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    // Meta's rule, not ours: a business may only reply on Facebook or
    // Instagram within 24 hours of the person's last message.
    if (/24 hours/i.test(t)) return NextResponse.json({ error: `${channel === "ig" ? "Instagram" : "Facebook"} only allows a reply within 24 hours of their last message. Email or text them instead.` }, { status: 409 });
    return NextResponse.json({ error: `GoHighLevel didn't send it (${res.status}). ${t.slice(0, 200)}` }, { status: 502 });
  }
  const json: any = await res.json().catch(() => ({}));
  const ghlMessageId: string | null = json?.messageId ?? json?.message?.id ?? null;
  const row = {
    id: ghlMessageId ? `msg_ghl_${ghlMessageId}` : "msg_" + crypto.randomUUID(),
    contact_id: peer.contactId, client_id: peer.clientId, task_id: taskId,
    channel: channel === "call" ? "sms" : channel, direction: "outbound", subject: null, body: text,
    ghl_message_id: ghlMessageId, ghl_conversation_id: conv.id, created_by: caller.memberId,
    peer_name: peer.name, peer_address: peer.address, read: true,
  };
  const { error } = await supabaseAdmin.from("messages").insert(row);
  if (error) console.error("[inbox/send] stored copy failed", error.message);
  return NextResponse.json({ ok: true, messageId: row.id, threadKey: `ghl:${conv.id}` });
}

// A new text to any GoHighLevel contact, from New message. Sent from that
// contact's sub-account number; the reply comes back on the same conversation.
async function sendNewText(caller: any, b: Body, text: string) {
  const { data: contact } = await supabaseAdmin.from("contacts").select("id, name, phone, ghl_contact_id, client_id").eq("id", b.contactId ?? "-").maybeSingle();
  if (!contact?.ghl_contact_id) return NextResponse.json({ error: "Pick a contact from GoHighLevel to text." }, { status: 400 });
  if (!contact.phone) return NextResponse.json({ error: `${contact.name} has no phone number in GoHighLevel.` }, { status: 400 });
  const tracked = await resolveTrackedClientId(contact.id as string, (contact.client_id as string | null) ?? "");
  if (tracked && tracked.startsWith("cl_")) {
    const denied = await canCallerMessageClient(caller, tracked);
    if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  }
  const { data: sub } = await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", contact.client_id ?? "-").maybeSingle();
  let locationId = (sub?.ghl_location_id as string | undefined) || undefined;
  let token = locationId ? await tokenForLocation(locationId) : null;
  // A contact filed on their own client (not a sub-account): ask GoHighLevel where they live.
  if (!token) { const home = await contactHome(contact.ghl_contact_id as string); if (home) { locationId = home.locationId; token = home.token; } }
  if (!token) return NextResponse.json({ error: "No GoHighLevel token for that contact's sub-account." }, { status: 501 });
  const { data: prof } = await supabaseAdmin.from("profiles").select("ghl_user_id").eq("id", caller.id).maybeSingle();
  const res = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ type: "SMS", contactId: contact.ghl_contact_id, message: text, ...(prof?.ghl_user_id ? { userId: prof.ghl_user_id } : {}) }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return NextResponse.json({ error: `GoHighLevel didn't send it (${res.status}). ${t.slice(0, 200)}` }, { status: 502 });
  }
  const json: any = await res.json().catch(() => ({}));
  const ghlMessageId: string | null = json?.messageId ?? json?.message?.id ?? null;
  const convId: string | null = json?.conversationId ?? null;
  const row = {
    id: ghlMessageId ? `msg_ghl_${ghlMessageId}` : "msg_" + crypto.randomUUID(),
    contact_id: contact.id, client_id: tracked || contact.client_id, task_id: null,
    channel: "sms", direction: "outbound", subject: null, body: text,
    ghl_message_id: ghlMessageId, ghl_conversation_id: convId, created_by: caller.memberId,
    peer_name: contact.name, peer_address: contact.phone, read: true,
  };
  const { error } = await supabaseAdmin.from("messages").insert(row);
  if (error) console.error("[inbox/send] stored copy failed", error.message);
  return NextResponse.json({ ok: true, messageId: row.id, threadKey: convId ? `ghl:${convId}` : null });
}
