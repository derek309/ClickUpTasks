// Builds one client's reminder email from their tasks as they are now: how
// many things are waiting on them, by list, and their client portal link.
// Used by the 8 AM job and by Refresh in the Inbox (Derek, 2026-10-12: "when
// we edit the tasks how can we refresh the email?"). The wording is the same
// as Remind on the client page (portalReminders reminderEmail).
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { resolveContact } from "./sendMessageServer";
import { APP_URL } from "./appUrl";
import { draftLinkAsButton } from "./draftLink";
import { REMINDER_LINK_LABEL, reminderEmail, reminderGroups } from "./portalReminders";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type BuiltReminder =
  | { ok: true; email: { subject: string; body: string }; to: string; clientName: string; assignedTo: string[] | null }
  | { ok: false; reason: "no_client" | "no_email" | "nothing" };

export async function buildPortalReminder(clientId: string, o: { dry?: boolean } = {}): Promise<BuiltReminder> {
  const { data: client } = await supabaseAdmin.from("clients").select("id, name, share_token, assigned_to, deleted_at").eq("id", clientId).maybeSingle();
  if (!client || client.deleted_at) return { ok: false, reason: "no_client" };
  const contact = await resolveContact(clientId);
  if (!contact?.email) return { ok: false, reason: "no_email" };
  const { data: waiting } = await supabaseAdmin.from("tasks").select("project_id")
    .eq("client_id", clientId).eq("waiting_on_client", true).neq("status", "done").eq("is_private", false).eq("hidden_from_client", false).is("deleted_at", null).limit(500);
  const { data: lists } = await supabaseAdmin.from("projects").select("id, name, position").eq("client_id", clientId).is("deleted_at", null);
  const groups = reminderGroups(((waiting ?? []) as any[]).map((t) => ({ projectId: (t.project_id ?? null) as string | null })),
    ((lists ?? []) as any[]).map((l) => ({ id: l.id as string, name: String(l.name ?? ""), position: (l.position ?? null) as number | null })));
  if (!groups.length) return { ok: false, reason: "nothing" };
  const { data: person } = await supabaseAdmin.from("contacts").select("name").eq("id", contact.id).maybeSingle();
  const first = String((person as any)?.name ?? "").trim().split(/\s+/)[0] || null;
  // Their portal link, made the first time if they have none yet.
  let token = client.share_token as string | null;
  if (!token && !o.dry) {
    token = randomUUID().replace(/-/g, "");
    await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", clientId);
  }
  const link = { url: `${APP_URL}/waiting/${token ?? "<made when sent>"}`, label: REMINDER_LINK_LABEL };
  const email = reminderEmail({ firstName: first ? first[0].toUpperCase() + first.slice(1) : null, groups, link });
  if (!email) return { ok: false, reason: "nothing" };
  return { ok: true, email: { subject: email.subject, body: draftLinkAsButton(email.body, link) }, to: contact.email, clientName: client.name as string, assignedTo: client.assigned_to as string[] | null };
}
