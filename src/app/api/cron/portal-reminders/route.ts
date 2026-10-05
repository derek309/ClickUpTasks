import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { resolveNotifyRecipient } from "@/lib/waitingNotify";
import { resolveContact } from "@/lib/sendMessageServer";
import { APP_URL } from "@/lib/appUrl";
import { todayPacific } from "@/lib/data";
import { isReminderHour, portalReminderEmail, PORTAL_REMINDER_PREFIX } from "@/lib/portalReminders";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Monday and Wednesday at 8 AM (Derek, 2026-10-05: "remind them what we need
// from them and what's outstanding"). Each client with something waiting on
// them gets one email from the person who looks after them: what we need, with
// the dates, what we're working on (when their portal shows it), and a button
// to their tasks page. Queued through scheduled_messages like the review
// reminders, so it retries, signs as the sender and lands in the conversation.
// Clients with nothing waiting on them get nothing.
//
// vercel.json runs it at 15:00 and 16:00 UTC on Mondays and Wednesdays; it only
// sends in the one that is 8 AM in California. An admin can POST ?dry=1 to see
// the emails without sending, and ?force=1 to send outside the hour.

export const maxDuration = 60;
export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const nowMs = Date.now();
  if (!dry && !force && !isReminderHour(nowMs)) return NextResponse.json({ ok: true, skipped: "not 8 AM on a Monday or Wednesday in California" });
  const monday = new Date(nowMs).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }) === "Mon";
  const today = todayPacific();

  // Open, shared tasks waiting on a client: who gets an email at all.
  const { data: waiting, error } = await supabaseAdmin.from("tasks").select("id, client_id, title, due")
    .eq("waiting_on_client", true).neq("status", "done").eq("is_private", false).is("deleted_at", null).like("client_id", "cl_%").limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const byClient = new Map<string, { title: string; due: string | null }[]>();
  for (const t of (waiting ?? []) as any[]) byClient.set(t.client_id, [...(byClient.get(t.client_id) ?? []), { title: t.title, due: t.due ?? null }]);

  const startOfDay = new Date(`${today}T00:00:00-08:00`).toISOString();
  const tally = { clients: byClient.size, queued: 0, nothingSent: 0, noEmail: 0, noSender: 0, alreadyToday: 0 };
  const previews: { client: string; to: string; subject: string }[] = [];
  for (const [clientId, needs] of byClient) {
    if (clientId === "cl_workspace") continue;
    const { data: client } = await supabaseAdmin.from("clients").select("id, name, share_token, assigned_to, portal_shows_all_tasks, deleted_at").eq("id", clientId).maybeSingle();
    if (!client || client.deleted_at) continue;
    const contact = await resolveContact(clientId);
    if (!contact?.email) { tally.noEmail++; continue; }
    const owner = await resolveNotifyRecipient(client.assigned_to as string[] | null);
    if (!owner) { tally.noSender++; continue; }
    // Once a day at most, whoever runs it.
    const { data: sent } = await supabaseAdmin.from("scheduled_messages").select("id").like("id", `${PORTAL_REMINDER_PREFIX}%`).eq("client_id", clientId).gte("scheduled_at", startOfDay).limit(1);
    if (sent?.length) { tally.alreadyToday++; continue; }

    const { data: working } = client.portal_shows_all_tasks
      ? await supabaseAdmin.from("tasks").select("title, due").eq("client_id", clientId).eq("waiting_on_client", false).neq("status", "done").eq("is_private", false).is("deleted_at", null).order("due", { ascending: true, nullsFirst: false }).limit(20)
      : { data: [] as any[] };
    const { data: person } = await supabaseAdmin.from("contacts").select("name").eq("id", contact.id).maybeSingle();
    const firstName = String((person as any)?.name ?? "").trim().split(/\s+/)[0] || null;
    // Their portal link, made the first time if they have none yet.
    let token = client.share_token as string | null;
    if (!token && !dry) {
      token = randomUUID().replace(/-/g, "");
      await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", clientId);
    }
    const email = portalReminderEmail({
      firstName: firstName ? firstName[0].toUpperCase() + firstName.slice(1) : null,
      needs: [...needs].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
      working: ((working ?? []) as any[]).map((t) => ({ title: t.title, due: t.due ?? null })),
      showWorking: client.portal_shows_all_tasks === true, portalUrl: `${APP_URL}/waiting/${token ?? "<made when sent>"}`, monday, today,
    });
    if (!email) { tally.nothingSent++; continue; }
    if (dry) { previews.push({ client: client.name as string, to: contact.email, subject: email.subject }); continue; }
    const { error: qErr } = await supabaseAdmin.from("scheduled_messages").insert({
      id: PORTAL_REMINDER_PREFIX + randomUUID(), client_id: clientId, task_id: null, channel: "email",
      subject: email.subject, body: email.body, scheduled_at: new Date(nowMs).toISOString(), status: "pending", created_by: owner,
    });
    if (!qErr) tally.queued++;
  }
  const out = { ok: true, dry, ...tally, ...(dry ? { previews } : {}) };
  console.log("[cron/portal-reminders]", JSON.stringify({ ...out, previews: undefined }));
  return NextResponse.json(out);
}
