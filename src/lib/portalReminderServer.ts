// Builds one client's reminder email from their tasks as they are now: what is
// waiting on them this week (or whose follow up has come round) and, when their
// portal shows it, what we are working on. Used by the 8 AM job and by Refresh
// in the Inbox (Derek, 2026-10-12: "when we edit the tasks how can we refresh
// the email?").
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { resolveContact } from "./sendMessageServer";
import { APP_URL } from "./appUrl";
import { portalReminderEmail, thisWeek } from "./portalReminders";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type BuiltReminder =
  | { ok: true; email: { subject: string; body: string }; to: string; clientName: string; assignedTo: string[] | null }
  | { ok: false; reason: "no_client" | "no_email" | "nothing" };

export async function buildPortalReminder(clientId: string, o: { today: string; monday: boolean; dry?: boolean }): Promise<BuiltReminder> {
  const { data: client } = await supabaseAdmin.from("clients").select("id, name, share_token, assigned_to, portal_shows_all_tasks, deleted_at").eq("id", clientId).maybeSingle();
  if (!client || client.deleted_at) return { ok: false, reason: "no_client" };
  const contact = await resolveContact(clientId);
  if (!contact?.email) return { ok: false, reason: "no_email" };
  const { data: waiting } = await supabaseAdmin.from("tasks").select("title, due, follow_up_at")
    .eq("client_id", clientId).eq("waiting_on_client", true).neq("status", "done").eq("is_private", false).eq("hidden_from_client", false).is("deleted_at", null).limit(200);
  const everything = ((waiting ?? []) as any[])
    .map((t) => ({ title: t.title as string, due: (t.due ?? null) as string | null, followUpAt: (t.follow_up_at ?? null) as string | null }));
  // This week's decide whether an email goes; the counts in it cover all.
  const needs = everything
    .filter((t) => thisWeek([t], o.today).length || (!!t.followUpAt && t.followUpAt <= o.today))
    .map(({ title, due }) => ({ title, due }));
  const { data: working } = client.portal_shows_all_tasks
    ? await supabaseAdmin.from("tasks").select("title, due").eq("client_id", clientId).eq("waiting_on_client", false).neq("status", "done").eq("is_private", false).eq("hidden_from_client", false).is("deleted_at", null).order("due", { ascending: true, nullsFirst: false }).limit(20)
    : { data: [] as any[] };
  const { data: person } = await supabaseAdmin.from("contacts").select("name").eq("id", contact.id).maybeSingle();
  const firstName = String((person as any)?.name ?? "").trim().split(/\s+/)[0] || null;
  // Their portal link, made the first time if they have none yet.
  let token = client.share_token as string | null;
  if (!token && !o.dry) {
    token = randomUUID().replace(/-/g, "");
    await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", clientId);
  }
  const email = portalReminderEmail({
    firstName: firstName ? firstName[0].toUpperCase() + firstName.slice(1) : null,
    needs: [...needs].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
    all: everything.map(({ title, due }) => ({ title, due })),
    working: thisWeek(((working ?? []) as any[]).map((t) => ({ title: t.title, due: t.due ?? null })), o.today),
    showWorking: client.portal_shows_all_tasks === true, portalUrl: `${APP_URL}/waiting/${token ?? "<made when sent>"}`, monday: o.monday, today: o.today,
  });
  if (!email) return { ok: false, reason: "nothing" };
  return { ok: true, email, to: contact.email, clientName: client.name as string, assignedTo: client.assigned_to as string[] | null };
}
