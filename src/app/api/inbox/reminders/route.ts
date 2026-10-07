import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveContact, sendScheduledMessageNow } from "@/lib/sendMessageServer";
import { REVIEW_STATUS } from "@/lib/portalReminders";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Reminder emails going out (Derek, 2026-10-07: "we have to review the
// reminder emails before they go out ... if there's something wrong, we can
// adjust it before we send it"). The Monday and Wednesday client reminders and
// the document review nudges queue at REVIEW_STATUS, which the 15 minute
// sender never picks up. The top of the Inbox lists them here.
//
// GET                                   the reminders waiting to be read
// POST { id, action: "save", subject, body }   change the words
// POST { id, action: "send" }           send it now, in the sender's name
// POST { id, action: "drop" }           don't send it
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
  const b = (await req.json().catch(() => ({}))) as { id?: string; action?: string; subject?: string; body?: string };
  if (!b.id) return NextResponse.json({ error: "Which reminder?" }, { status: 400 });

  if (b.action === "save") {
    const subject = (b.subject ?? "").trim().slice(0, 200);
    if (!subject || !(b.body ?? "").trim()) return NextResponse.json({ error: "It needs a subject and some words." }, { status: 400 });
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ subject, body: b.body }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
  }
  if (b.action === "drop") {
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ status: "canceled" }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
  }
  if (b.action === "send") {
    // Claimed first, so two people pressing Send at once send it once.
    const { data: claimed } = await supabaseAdmin.from("scheduled_messages").update({ status: "sending" }).eq("id", b.id).eq("status", REVIEW_STATUS).select(COLS);
    const row = (claimed ?? [])[0] as any;
    if (!row) return NextResponse.json({ error: "It was already sent or dropped." }, { status: 409 });
    const result = await sendScheduledMessageNow({
      id: row.id, clientId: row.client_id, taskId: row.task_id, channel: row.channel,
      subject: row.subject, body: row.body ?? "", cc: row.cc ?? [], bcc: row.bcc ?? [],
      fromEmail: row.from_email, attachments: row.attachments ?? [], createdBy: row.created_by,
      replyToMessageId: row.reply_to_message_id,
    });
    if (!result.ok) {
      // Back to waiting, so it can be fixed and sent again.
      await supabaseAdmin.from("scheduled_messages").update({ status: REVIEW_STATUS, error: result.error }).eq("id", row.id);
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    await supabaseAdmin.from("scheduled_messages").update({ status: "sent", sent_message_id: result.messageId, scheduled_at: new Date().toISOString() }).eq("id", row.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
