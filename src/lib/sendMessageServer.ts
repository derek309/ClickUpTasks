// SERVER-ONLY twin of Cockpit.tsx's sendMessage() — same Google-first/GHL-
// fallback branching, but callable with no React state and no user session
// (a cron firing a scheduled send has neither). Mirrors the exact two send
// paths already used for "send now": Gmail via sendGmailAs (per-teammate
// "from") when the channel is email and the client has a linked contact
// email, else GoHighLevel's Conversations API. On success, inserts the
// `messages` row itself (see supabase/messages.sql), same shape as the
// client-side sendMessage()/ingestOutboundMessage.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { sendGmailAs, googleConfigured } from "./googleMail";
import { tokenForLocation } from "./ghlTokens";
import { TASK_FILES_BUCKET } from "./db";

const GHL = "https://services.leadconnectorhq.com";
const SEND_DOMAIN = "clickuplocal.com";
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", zip: "application/zip",
};
const mimeFor = (name: string) => MIME_BY_EXT[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

// Same ownership check as google/send/route.ts's pathBelongsToClient — a
// scheduled send's attachment paths are stored server-side (not re-verified
// at schedule time against the caller's session), so this still must be
// proven at fire time, not trusted from the row.
async function pathBelongsToClient(path: string, clientId: string): Promise<boolean> {
  if (!path || path.includes("..")) return false;
  if (path.startsWith(`waiting/${clientId}/`) || path.startsWith(`extension/${clientId}/`)) return true;
  const taskId = path.split("/")[0];
  if (!taskId || taskId === "waiting" || taskId === "extension") return false;
  const { data: task } = await supabaseAdmin.from("tasks").select("client_id").eq("id", taskId).maybeSingle();
  return !!task && task.client_id === clientId;
}

// Same linked-contact resolution as Cockpit.tsx's contactForClient: an
// explicit link wins, otherwise fall back to the id-derived contact.
async function resolveContact(clientId: string): Promise<{ id: string; email: string | null; phone: string | null; ghlContactId: string | null; subAccountClientId: string } | null> {
  const { data: client } = await supabaseAdmin.from("clients").select("linked_contact_id").eq("id", clientId).maybeSingle();
  const contactId = (client?.linked_contact_id as string | null) || (clientId.startsWith("cl_") ? clientId.slice(3) : null);
  if (!contactId) return null;
  const { data: contact } = await supabaseAdmin.from("contacts").select("id, email, phone, ghl_contact_id, client_id").eq("id", contactId).maybeSingle();
  if (!contact) return null;
  // The sub-account owning THIS CONTACT (contact.client_id) — not necessarily
  // the same as the app-side clientId passed in, when linked_contact_id
  // points at a contact under a different sub-account. Mirrors Cockpit.tsx's
  // ghlTargetForContact, which resolves the location off contact.clientId too.
  return { id: contact.id, email: contact.email ?? null, phone: contact.phone ?? null, ghlContactId: contact.ghl_contact_id ?? null, subAccountClientId: contact.client_id };
}

export type ScheduledSendInput = {
  id: string;
  clientId: string;
  taskId: string | null;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  cc: string[];
  bcc: string[];
  fromEmail?: string | null;
  attachments: { path?: string; name?: string; id?: string }[];
  createdBy: string; // roster member id — the schedule's author, sent-as identity
};

export async function sendScheduledMessageNow(input: ScheduledSendInput): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const contact = await resolveContact(input.clientId);
  if (!contact) return { ok: false, error: "This client isn't linked to a GHL contact." };

  const { data: authorProfile } = await supabaseAdmin.from("profiles").select("email, name").eq("member_id", input.createdBy).maybeSingle();
  const authorEmail = (authorProfile?.email as string | null) ?? null;
  const sender = (input.fromEmail?.trim() || authorEmail || "").trim();

  if (input.channel === "email" && contact.email && googleConfigured && sender.toLowerCase().endsWith(`@${SEND_DOMAIN}`)) {
    const attParts: { filename: string; mimeType: string; contentBase64: string }[] = [];
    let totalBytes = 0;
    let attachmentFailed = false;
    for (const a of input.attachments) {
      if (!a?.path) continue;
      if (!(await pathBelongsToClient(a.path, input.clientId))) { attachmentFailed = true; break; }
      const { data: file, error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).download(a.path);
      if (error || !file) { attachmentFailed = true; break; }
      const buf = Buffer.from(await file.arrayBuffer());
      totalBytes += buf.byteLength;
      if (totalBytes > 18 * 1024 * 1024) { attachmentFailed = true; break; }
      attParts.push({ filename: a.name || a.path.split("/").pop() || "attachment", mimeType: mimeFor(a.name || a.path), contentBase64: buf.toString("base64") });
    }
    if (!attachmentFailed) {
      try {
        const { id: gmailMessageId } = await sendGmailAs(sender, {
          to: contact.email, cc: input.cc.length ? input.cc : undefined, bcc: input.bcc.length ? input.bcc : undefined,
          subject: (input.subject || "").slice(0, 200), body: input.body, isHtml: true,
          fromName: (authorProfile?.name as string | null)?.trim() || undefined,
          attachments: attParts.length ? attParts : undefined,
        });
        return insertSentMessage(input, contact.id, null, gmailMessageId);
      } catch (e) {
        // Fall through to GHL below rather than failing the whole send.
        console.warn("[sendScheduledMessageNow] Gmail send failed, falling back to GHL:", e instanceof Error ? e.message : e);
      }
    }
  }

  // GHL fallback (or SMS, always GHL) — needs the sub-account's location.
  const { data: subClient } = await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", contact.subAccountClientId).maybeSingle();
  const locationId = (subClient?.ghl_location_id as string | null) ?? null;
  if (!contact.ghlContactId || !locationId) return { ok: false, error: "No GoHighLevel connection for this client's sub-account." };
  const token = await tokenForLocation(locationId);
  if (!token) return { ok: false, error: "No GoHighLevel token configured for this sub-account." };

  const attachmentUrls: string[] = [];
  for (const a of input.attachments) {
    if (!a?.path) continue;
    const { data } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUrl(a.path, 60 * 60);
    if (data?.signedUrl) attachmentUrls.push(data.signedUrl);
  }
  const emailHtml = escapeHtml(input.body).replace(/\r\n|\r|\n/g, "<br>");
  const payload = input.channel === "sms"
    ? { type: "SMS", contactId: contact.ghlContactId, message: input.body, ...(attachmentUrls.length ? { attachments: attachmentUrls } : {}) }
    : { type: "Email", contactId: contact.ghlContactId, subject: (input.subject || "").slice(0, 200), html: emailHtml,
        ...(input.cc.length ? { emailCc: input.cc } : {}), ...(input.bcc.length ? { emailBcc: input.bcc } : {}),
        ...(attachmentUrls.length ? { attachments: attachmentUrls } : {}) };

  try {
    const res = await fetch(`${GHL}/conversations/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { const text = await res.text().catch(() => ""); return { ok: false, error: `GoHighLevel API ${res.status}: ${text.slice(0, 240)}` }; }
    const json = await res.json().catch(() => ({}));
    const ghlMessageId: string | null = json?.messageId ?? json?.message?.id ?? json?.conversationId ?? json?.id ?? null;
    return insertSentMessage(input, contact.id, ghlMessageId, null);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "GoHighLevel request failed." };
  }
}

async function insertSentMessage(input: ScheduledSendInput, contactId: string, ghlMessageId: string | null, gmailMessageId: string | null): Promise<{ ok: true; messageId: string }> {
  const messageId = "msg_" + randomUUID();
  await supabaseAdmin.from("messages").insert({
    id: messageId, contact_id: contactId, client_id: input.clientId, task_id: input.taskId, channel: input.channel, direction: "outbound",
    subject: input.subject, body: input.body, ghl_message_id: ghlMessageId, gmail_message_id: gmailMessageId,
    created_by: input.createdBy, read: true, attachments: input.attachments, cc: input.cc, bcc: input.bcc,
  });
  return { ok: true, messageId };
}
