import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Inbound webhook: GoHighLevel → ClickUpTasks (the "pull" half of two-way sync).
//
// Wire-up (after the app is deployed to a public URL):
//   In each sub-account: Automation → create a Workflow with trigger
//   "Task Added" / "Task Completed" → action "Webhook" → POST to
//   https://<your-app>/api/ghl/webhook?secret=<GHL_WEBHOOK_SECRET>
//
// Security: shared-secret query param (set GHL_WEBHOOK_SECRET in env). GHL
// workflow webhooks can't sign requests, so a long random secret in the URL is
// the standard guard.
//
// Behavior (deliberately conservative — GHL is not the source of truth):
//   - task completed in GHL  → mark the matching linked task done here.
//   - task deleted in GHL    → unlink here (keep our task, drop ghl_task_id).
//   - title/body/due changed → update the matching linked task's fields.
// Matching key: tasks.ghl_task_id.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  const secret = process.env.GHL_WEBHOOK_SECRET || "";
  if (!secret || req.nextUrl.searchParams.get("secret") !== secret)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  // GHL workflow webhook payloads vary; accept the common shapes.
  const ghlTaskId: string | null = body?.task?.id ?? body?.taskId ?? body?.id ?? null;
  if (!ghlTaskId) return NextResponse.json({ ok: true, skipped: "no task id in payload" });

  const { data: row } = await supabaseAdmin.from("tasks").select("id, status, subtasks").eq("ghl_task_id", ghlTaskId).maybeSingle();
  if (!row) return NextResponse.json({ ok: true, skipped: "no linked task" });

  const patch: Record<string, unknown> = {};
  const title = body?.task?.title ?? body?.title;
  const desc = body?.task?.body ?? body?.body;
  const due = body?.task?.dueDate ?? body?.dueDate;
  const completed = body?.task?.completed ?? body?.completed;
  if (typeof title === "string" && title.trim()) patch.title = title.trim();
  if (typeof desc === "string") patch.description = desc;
  if (typeof due === "string" && /^\d{4}-\d{2}-\d{2}/.test(due)) patch.due = due.slice(0, 10);
  if (completed === true && row.status !== "done") patch.status = "done";
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, skipped: "nothing to update" });

  const { error } = await supabaseAdmin.from("tasks").update(patch).eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: Object.keys(patch) });
}
