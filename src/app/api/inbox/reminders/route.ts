import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveContact } from "@/lib/sendMessageServer";
import { sendReviewedReminder } from "@/lib/clientRequestsServer";
import { PORTAL_REMINDER_PREFIX, REVIEW_STATUS } from "@/lib/portalReminders";
import { buildPortalReminder } from "@/lib/portalReminderServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Reminder emails going out (Derek, 2026-10-07: "we have to review the
// reminder emails before they go out ... if there's something wrong, we can
// adjust it before we send it"). The 8 AM client reminders and
// the document review nudges queue at REVIEW_STATUS, which the 15 minute
// sender never picks up. The top of the Inbox lists them here.
//
// GET                                   the reminders waiting to be read
// POST { id, action: "save", subject, body }   change the words
// POST { id, action: "send" }           send it now, in the sender's name
// POST { id, action: "drop" }           don't send it
// POST { id, action: "schedule", at }   send it later (Derek, 2026-10-08: "I want this one to go tomorrow")
// POST { id, action: "refresh" }        a client reminder rebuilt from their tasks as they are now (Derek, 2026-10-12)
//
// Admins only: these go to clients in a teammate's name.

const COLS = "id, client_id, task_id, channel, subject, body, cc, bcc, from_email, attachments, created_by, reply_to_message_id, scheduled_at";

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("scheduled_messages").select(COLS).eq("status", REVIEW_STATUS).order("scheduled_at", { ascending: true }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as any[];
  const clientIds = [...new Set(rows.map((r) => r.client_id as string))];
  const { data: clients } = clientIds.length ? await supabaseAdmin.from("clients").select("id, name").in("id", clientIds) : { data: [] as any[] };
  const nameOf = new Map((clients ?? []).map((c: any) => [c.id as string, c.name as string]));
  const toOf = new Map<string, string | null>();
  for (const id of clientIds) toOf.set(id, (await resolveContact(id).catch(() => null))?.email ?? null);
  return NextResponse.json({
    reminders: rows.map((r) => ({
      id: r.id, clientId: r.client_id, clientName: nameOf.get(r.client_id) ?? "A client", to: toOf.get(r.client_id) ?? null,
      taskId: r.task_id, subject: r.subject ?? "", body: r.body ?? "", from: r.created_by, at: r.scheduled_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; action?: string; subject?: string; body?: string; at?: string };
  if (!b.id) return NextResponse.json({ error: "Which reminder?" }, { status: 400 });

  if (b.action === "save") {
    const subject = (b.subject ?? "").trim().slice(0, 200);
    if (!subject || !(b.body ?? "").trim()) return NextResponse.json({ error: "It needs a subject and some words." }, { status: 400 });
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ subject, body: b.body }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
  }
  if (b.action === "refresh") {
    // Only the client reminders are built from their tasks; a review nudge has nothing to rebuild.
    if (!b.id.startsWith(PORTAL_REMINDER_PREFIX)) return NextResponse.json({ error: "Only a client reminder can be refreshed." }, { status: 400 });
    const { data: row } = await supabaseAdmin.from("scheduled_messages").select("client_id, body").eq("id", b.id).eq("status", REVIEW_STATUS).maybeSingle();
    if (!row) return NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
    const built = await buildPortalReminder((row as any).client_id);
    if (!built.ok) return NextResponse.json({ error: built.reason === "nothing" ? "Nothing is waiting on them any more. Use Don't send." : built.reason === "no_email" ? "They have no email on file." : "That client is gone." }, { status: 409 });
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ subject: built.email.subject, body: built.email.body }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true, subject: built.email.subject, body: built.email.body }) : NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
  }
  if (b.action === "schedule") {
    // Handed to the 15 minute sender, which sends it in the author's name then.
    const at = typeof b.at === "string" ? Date.parse(b.at) : NaN;
    if (!Number.isFinite(at) || at < Date.now() + 60_000) return NextResponse.json({ error: "Pick a time later than now." }, { status: 400 });
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ status: "pending", scheduled_at: new Date(at).toISOString() }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
  }
  if (b.action === "drop") {
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ status: "canceled" }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
  }
  if (b.action === "send") {
    // The same send as Approve in Reminders: claimed first, in the sender's
    // name, a request reminder in its step's thread (lib/clientRequestsServer).
    const r = await sendReviewedReminder(b.id);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
