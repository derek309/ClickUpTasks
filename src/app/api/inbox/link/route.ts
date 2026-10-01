import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isClientVisible } from "@/lib/extensionApi";
import { parseThreadKey, threadRows, canUseThread } from "@/lib/inboxServer";

// Link an Inbox conversation to a task, or unlink it (taskId null). Every
// message in the conversation gets the task, and the ingest paths already
// file each later message on the task its conversation last had, so the
// client's next reply lands there by itself (Derek, 2026-10-01: this replaces
// "Reply to X" tasks).
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; taskId?: string | null };
  const ref = parseThreadKey(b.threadKey);
  if (!ref) return NextResponse.json({ error: "Unknown conversation." }, { status: 400 });
  const rows = await threadRows(ref, caller);
  if (!rows.length || !(await canUseThread(caller, ref, rows))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });

  const taskId = typeof b.taskId === "string" && b.taskId ? b.taskId : null;
  if (taskId) {
    const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, assignee_id, deleted_at").eq("id", taskId).maybeSingle();
    if (!task || task.deleted_at) return NextResponse.json({ error: "That task is gone." }, { status: 404 });
    const mine = task.assignee_id && task.assignee_id === caller.memberId;
    if (caller.role !== "admin" && !mine && !(task.client_id && (await isClientVisible(caller, task.client_id as string))))
      return NextResponse.json({ error: "You can't link to that task." }, { status: 403 });
  }

  const ids = rows.map((r) => r.id as string);
  const { error } = await supabaseAdmin.from("messages").update({ task_id: taskId }).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, linked: ids.length, taskId });
}
