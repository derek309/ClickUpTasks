import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { REVIEW_STATUS } from "@/lib/portalReminders";
import { remindersOverview, sendReviewedReminder } from "@/lib/clientRequestsServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Reminders (Derek and Justin, 2026-10-15): every reminder to a client in
// one place, under Inbox in the sidebar. Nothing goes out unseen
// (REMINDERS_REVIEW_ALL): each waits here for Approve.
//
// GET                          { toReview, comingUp, sent }
// GET ?count=1                 { toReview: n } for the sidebar's badge
// GET ?client=<id>             sent narrowed to one client
// POST { id, action: "approve" }            send it now, in its sender's name
// POST { id, action: "skip" }               don't send it
// POST { id, action: "save", subject, body }  change the words
// POST { clientId, action: "approve_all" }  send every one waiting for that client
//
// Admins only: these go to clients in a teammate's name.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (req.nextUrl.searchParams.get("count") === "1") {
    const { count } = await supabaseAdmin.from("scheduled_messages").select("id", { count: "exact", head: true }).eq("status", REVIEW_STATUS);
    return NextResponse.json({ toReview: count ?? 0 });
  }
  const out = await remindersOverview({ sentClientId: req.nextUrl.searchParams.get("client") });
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; clientId?: string; action?: string; subject?: string; body?: string };
  if (b.action === "approve_all") {
    if (!b.clientId) return NextResponse.json({ error: "Which client?" }, { status: 400 });
    const { data } = await supabaseAdmin.from("scheduled_messages").select("id").eq("client_id", b.clientId).eq("status", REVIEW_STATUS).order("scheduled_at", { ascending: true }).limit(20);
    let sent = 0;
    const errors: string[] = [];
    for (const r of (data ?? []) as any[]) {
      const res = await sendReviewedReminder(r.id);
      if (res.ok) sent++; else errors.push(res.error);
    }
    return errors.length && !sent ? NextResponse.json({ error: errors[0] }, { status: 502 }) : NextResponse.json({ ok: true, sent, failed: errors.length });
  }
  if (!b.id) return NextResponse.json({ error: "Which reminder?" }, { status: 400 });
  if (b.action === "approve") {
    const r = await sendReviewedReminder(b.id);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  }
  if (b.action === "skip") {
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ status: "canceled" }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "It was already sent or skipped." }, { status: 409 });
  }
  if (b.action === "save") {
    const subject = (b.subject ?? "").trim().slice(0, 200);
    if (!subject || !(b.body ?? "").trim()) return NextResponse.json({ error: "It needs a subject and some words." }, { status: 400 });
    const { data } = await supabaseAdmin.from("scheduled_messages").update({ subject, body: b.body }).eq("id", b.id).eq("status", REVIEW_STATUS).select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "It was already sent or skipped." }, { status: 409 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
