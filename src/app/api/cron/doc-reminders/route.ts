import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { linkState } from "@/lib/taskDocumentServer";
import { resolveNotifyRecipient } from "@/lib/waitingNotify";
import { draftLinkHtml, escapeHtml } from "@/lib/draftLink";
import type { EmailDraft } from "@/lib/data";

// Daily: a client document sent for review with no answer after three days gets
// a "just checking in" draft email staged on its task, and the task owner a bell
// (Derek, 2026-09-11). Nothing sends; a person reviews the draft and clicks Send.
// Once per send: a new version sent to the client starts the clock again.
// Skipped when the task already has a draft email (never overwritten), the task
// is done, private or deleted, or the document has no live link.
// Same cron auth as purge-trash and send-scheduled. Scheduled in vercel.json.

export const maxDuration = 60;

const APP_URL = "https://clickuptasks.vercel.app";
const WAIT_MS = 3 * 86_400_000;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });

  const authHeader = req.headers.get("authorization") ?? "";
  const cronOk = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const secretOk = !!process.env.GHL_WEBHOOK_SECRET && req.nextUrl.searchParams.get("secret") === process.env.GHL_WEBHOOK_SECRET;
  if (!cronOk && !secretOk) {
    const caller = await requireUser(req);
    if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Waiting on the client: with_client and not approved. A stage picked by hand
  // is checked against the versions below, so only a real send counts.
  const { data: docs, error } = await supabaseAdmin.from("task_documents")
    .select("id, task_id, title, reminder_drafted_at")
    .is("deleted_at", null).is("approved_at", null).eq("status", "with_client")
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const now = Date.now();
  let drafted = 0;
  for (const doc of docs ?? []) {
    const { data: latest } = await supabaseAdmin.from("task_document_versions")
      .select("kind, created_at").eq("document_id", doc.id).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!latest || latest.kind !== "sent") continue;
    const sentAt = new Date(latest.created_at as string).getTime();
    if (now - sentAt < WAIT_MS) continue;
    if (doc.reminder_drafted_at && new Date(doc.reminder_drafted_at as string).getTime() > sentAt) continue;

    const { data: task } = await supabaseAdmin.from("tasks")
      .select("id, title, status, is_private, deleted_at, draft_email, assignee_id, client_id, project_id").eq("id", doc.task_id).maybeSingle();
    if (!task || task.deleted_at || task.is_private || task.status === "done" || task.draft_email) continue;
    const link = await linkState(doc.id as string, APP_URL);
    if (!link.live || !link.url) continue;

    const name = ((doc.title as string | null) ?? "").trim() || (task.title as string);
    const days = Math.floor((now - sentAt) / 86_400_000);
    const button = { url: link.url, label: `Open "${name}" to review` };
    const at = new Date(now).toISOString();
    const draft: EmailDraft = {
      subject: `Checking in: ${name}`,
      body: `<p>Hi,</p><p>Just checking in on "${escapeHtml(name)}". When you have a moment, take a look and approve it, or send any changes you would like.</p>${draftLinkHtml(button)}<p>Thanks!</p>`,
      link: button,
      aiContext: `A friendly check in. We sent the client the document "${name}" to review ${days} days ago and have not heard back. Ask them to review it and approve it, or send any changes.`,
      createdAt: at, updatedAt: at,
    };
    // Only onto a task with no draft email, checked again in the write itself.
    // updated_by null is what makes an open drawer pick the draft up live.
    const { data: staged } = await supabaseAdmin.from("tasks")
      .update({ draft_email: draft, updated_by: null }).eq("id", task.id).is("draft_email", null).select("id");
    if (!staged?.length) continue;
    await supabaseAdmin.from("task_documents").update({ reminder_drafted_at: at }).eq("id", doc.id);

    let recipient = task.assignee_id as string | null;
    if (!recipient) {
      const { data: client } = await supabaseAdmin.from("clients").select("assigned_to").eq("id", task.client_id).maybeSingle();
      recipient = await resolveNotifyRecipient(client?.assigned_to as string[] | null);
    }
    if (recipient) {
      await supabaseAdmin.from("notifications").insert({
        id: "n_" + randomUUID(), recipient_id: recipient,
        text: `No approval yet on "${name}" after ${days} days. A check in email is ready to review on the task.`,
        task_id: task.id, actor_id: null, client_id: task.client_id, project_id: task.project_id,
        at, read: false, kind: "activity",
      });
    }
    drafted++;
  }
  return NextResponse.json({ ok: true, checked: (docs ?? []).length, drafted });
}
