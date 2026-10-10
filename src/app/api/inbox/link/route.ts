import { NextRequest, NextResponse } from "next/server";
import { requireUser, type AuthedUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isClientVisible } from "@/lib/extensionApi";
import { parseThreadKey, threadRows, canUseThread } from "@/lib/inboxServer";
import { copyThreadFilesToTask, copySoon } from "@/lib/emailFilesServer";

// Link an Inbox conversation to a task, or unlink it (taskId null). Every
// message in the conversation gets the task, and the ingest paths already
// file each later message on the task its conversation last had, so the
// client's next reply lands there by itself (Derek, 2026-10-01: this replaces
// "Reply to X" tasks).
//
// More than one task (Derek, 2026-10-07: a client replies on the same email
// with more to do): { add: true } keeps the main task on the messages and puts
// this one in inbox_task_links; { removeTaskId } takes one off, and taking the
// main one off makes the newest of the others the main task.
// GET ?threadKey= lists the other tasks, newest first.

async function canLinkTask(caller: AuthedUser, taskId: string): Promise<string | null> {
  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, assignee_id, deleted_at").eq("id", taskId).maybeSingle();
  if (!task || task.deleted_at) return "That task is gone.";
  const mine = task.assignee_id && task.assignee_id === caller.memberId;
  if (caller.role !== "admin" && !mine && !(task.client_id && (await isClientVisible(caller, task.client_id as string))))
    return "You can't link to that task.";
  return null;
}

// Every file already sent in the conversation goes onto the task it is linked
// to (Derek, 2026-10-09), after the response. Never fails the link.
async function filesToTask(messageIds: string[], taskId: string) {
  try { await copySoon(`link ${taskId}`, () => copyThreadFilesToTask(supabaseAdmin, messageIds, taskId)); }
  catch (e) { console.error("[inbox/link] files to task", e); }
}

async function extraTaskIds(threadKey: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("inbox_task_links").select("task_id").eq("thread_key", threadKey).order("created_at", { ascending: false });
  return (data ?? []).map((r) => r.task_id as string);
}

// Linking brings the conversation's earlier files onto the task, after the
// response; that can take a while for a long thread (Fable audit 2026-10-10).
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const threadKey = req.nextUrl.searchParams.get("threadKey") ?? "";
  const ref = parseThreadKey(threadKey);
  if (!ref) return NextResponse.json({ error: "Unknown conversation." }, { status: 400 });
  const rows = await threadRows(ref, caller);
  if (!rows.length || !(await canUseThread(caller, ref, rows))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });
  return NextResponse.json({ taskIds: await extraTaskIds(threadKey) });
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; taskId?: string | null; add?: boolean; removeTaskId?: string };
  const ref = parseThreadKey(b.threadKey);
  if (!ref) return NextResponse.json({ error: "Unknown conversation." }, { status: 400 });
  const threadKey = b.threadKey as string;
  const rows = await threadRows(ref, caller);
  if (!rows.length || !(await canUseThread(caller, ref, rows))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });
  const ids = rows.map((r) => r.id as string);
  const main = (rows.find((r) => r.task_id)?.task_id as string | undefined) ?? null;

  // Take one task off.
  if (typeof b.removeTaskId === "string" && b.removeTaskId) {
    const gone = b.removeTaskId;
    await supabaseAdmin.from("inbox_task_links").delete().eq("thread_key", threadKey).eq("task_id", gone);
    let next = main;
    if (gone === main) {
      next = (await extraTaskIds(threadKey))[0] ?? null;
      if (next) await supabaseAdmin.from("inbox_task_links").delete().eq("thread_key", threadKey).eq("task_id", next);
      const { error } = await supabaseAdmin.from("messages").update({ task_id: next }).in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, taskId: next, taskIds: await extraTaskIds(threadKey) });
  }

  const taskId = typeof b.taskId === "string" && b.taskId ? b.taskId : null;
  if (taskId) {
    const refused = await canLinkTask(caller, taskId);
    if (refused) return NextResponse.json({ error: refused }, { status: refused === "That task is gone." ? 404 : 403 });
  }

  // Another task beside the main one. With no main task yet it becomes the main.
  if (b.add && taskId && main && main !== taskId) {
    const { error } = await supabaseAdmin.from("inbox_task_links")
      .upsert({ thread_key: threadKey, task_id: taskId, linked_by: caller.memberId }, { onConflict: "thread_key,task_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await filesToTask(ids, taskId);
    return NextResponse.json({ ok: true, taskId: main, taskIds: await extraTaskIds(threadKey) });
  }

  const { error } = await supabaseAdmin.from("messages").update({ task_id: taskId }).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Unlinking everything clears the others too; the main task is never also an "other".
  if (!taskId) await supabaseAdmin.from("inbox_task_links").delete().eq("thread_key", threadKey);
  else {
    await supabaseAdmin.from("inbox_task_links").delete().eq("thread_key", threadKey).eq("task_id", taskId);
    await filesToTask(ids, taskId);
  }
  return NextResponse.json({ ok: true, linked: ids.length, taskId, taskIds: await extraTaskIds(threadKey) });
}
