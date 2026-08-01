import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser, canCallerMessageClient } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Queue for scheduled outgoing SMS/email — see supabase/scheduled-messages.sql
// and src/lib/sendMessageServer.ts (the cron that actually fires these).
// Same gating as /api/ghl/message and /api/google/send: a non-admin needs
// both the global send grant and this client's can_message roster.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required." }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("scheduled_messages")
    .select("id, client_id, task_id, channel, subject, body, cc, bcc, from_email, attachments, scheduled_at, status, error, created_by, sent_message_id, created_at")
    .eq("client_id", clientId)
    .order("scheduled_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ scheduled: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const { clientId, taskId, channel, subject, body, cc, bcc, fromEmail, attachments, scheduledAt } = b as {
    clientId?: string; taskId?: string | null; channel?: string; subject?: string; body?: string;
    cc?: string[]; bcc?: string[]; fromEmail?: string; attachments?: { path: string; name: string }[]; scheduledAt?: string;
  };
  if (!clientId || !body?.trim() || !scheduledAt) return NextResponse.json({ error: "Missing clientId, body, or scheduledAt." }, { status: 400 });
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) return NextResponse.json({ error: "scheduledAt must be a valid future time." }, { status: 400 });

  const denied = await canCallerMessageClient(caller, clientId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!caller.memberId) return NextResponse.json({ error: "Your account isn't linked to a roster member yet." }, { status: 403 });
  if (fromEmail && caller.role !== "admin") return NextResponse.json({ error: "Only an admin can send as another teammate." }, { status: 403 });

  const id = "sm_" + randomUUID();
  const { error } = await supabaseAdmin.from("scheduled_messages").insert({
    id, client_id: clientId, task_id: taskId ?? null, channel: channel === "sms" ? "sms" : "email",
    subject: subject?.trim() || null, body, cc: cc?.filter((e) => e?.trim()) ?? [], bcc: bcc?.filter((e) => e?.trim()) ?? [],
    from_email: fromEmail?.trim() || null, attachments: attachments ?? [], scheduled_at: when.toISOString(),
    status: "pending", created_by: caller.memberId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id, ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Missing scheduled message id." }, { status: 400 });

  const { data: row } = await supabaseAdmin.from("scheduled_messages").select("client_id, status").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (row.status !== "pending") return NextResponse.json({ error: "This has already fired or been canceled." }, { status: 409 });
  const denied = await canCallerMessageClient(caller, row.client_id as string);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const { error } = await supabaseAdmin.from("scheduled_messages").update({ status: "canceled" }).eq("id", id).eq("status", "pending");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
