import { NextRequest, NextResponse } from "next/server";
import { adminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";
import { teamTaskAccess } from "@/lib/taskDocumentServer";
import { claudeCloudReady, startClaudeCloud } from "@/lib/claudeCloud";
import { CLAUDE_ID, type Subtask } from "@/lib/data";

// POST { stepId }: a step given to Claude starts Claude working on it in the
// cloud (lib/claudeCloud), and the session's link goes on the step to watch.
// 501 not_set_up until the routine is configured: the step is still Claude's.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { id } = await params;
  const access = await teamTaskAccess(req, id);
  if (!access.ok) return access.res;
  // Not set up: said before anything else, whatever the step.
  if (!claudeCloudReady()) return NextResponse.json({ error: "not_set_up" }, { status: 501 });
  const { stepId } = (await req.json().catch(() => ({}))) as { stepId?: string };
  const { data: task } = await supabaseAdmin.from("tasks").select("title, subtasks").eq("id", id).maybeSingle();
  const step = ((task?.subtasks as Subtask[] | null) ?? []).find((s) => s.id === stepId);
  if (!task || !step) return NextResponse.json({ error: "No such step" }, { status: 404 });
  // Only a step that is Claude's and still open starts Claude.
  if (step.assigneeId !== CLAUDE_ID || step.done) return NextResponse.json({ error: "That step isn't open on Claude's list" }, { status: 409 });
  const r = await startClaudeCloud(`ClickUpTasks task ${id}, step ${step.id}: "${step.title}" on "${task.title}".`);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "not_set_up" ? 501 : 502 });
  // The link on the step, merged into the steps as they are now.
  const at = new Date().toISOString();
  const { data: cur } = await supabaseAdmin.from("tasks").select("subtasks").eq("id", id).maybeSingle();
  const list = ((cur?.subtasks as Subtask[] | null) ?? []).map((s) => (s.id === step.id ? { ...s, cloudSession: { url: r.url, at }, cloudError: undefined } : s));
  await supabaseAdmin.from("tasks").update({ subtasks: list, updated_by: null }).eq("id", id);
  await supabaseAdmin.rpc("append_comment", { task_id: id, comment: { id: "cm_" + crypto.randomUUID(), authorId: access.user.memberId ?? "u_derek", at, kind: "event", body: `started Claude on "${step.title}" in the cloud` } });
  return NextResponse.json({ ok: true, url: r.url });
}
