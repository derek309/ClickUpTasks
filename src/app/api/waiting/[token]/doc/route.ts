import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { resolveWaitingToken } from "@/lib/waitingToken";
import { createReview } from "@/lib/reviewService";
import { linkState, mintDocLink, reviewTask, NO_STORE } from "@/lib/taskDocumentServer";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "@/lib/waitingNotify";

// The client adds a doc to one of their tasks, or opens the one it has (Derek,
// 2026-10-05: "a doc lives on a task, like attachments and links"). It is the
// task's client document, the same one client reviews use, so the team works
// in it from the task. Public, token gated: the task must be this client's (and
// this list's, for a list link), shared, and not private. Hands back the
// document's private link, made the first time.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimit(req, token, "request");
  if (limited) return limited;
  const scope = await resolveWaitingToken(token);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = (await req.json().catch(() => null)) as { taskId?: string; kind?: string } | null;
  const taskId = typeof payload?.taskId === "string" ? payload.taskId : "";
  // An image, page or video review is opened, never made, from here.
  const kind = payload?.kind === "image" || payload?.kind === "page" || payload?.kind === "video" ? payload.kind : "doc";
  let q = supabaseAdmin.from("tasks").select("id, title, client_id, project_id, status").eq("id", taskId).eq("client_id", scope.clientId).eq("is_private", false).is("deleted_at", null);
  if (scope.projectId) q = q.eq("project_id", scope.projectId);
  const { data: task } = await q.maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (kind !== "doc") {
    const { data: rev } = await supabaseAdmin.from("task_documents").select("id, status").eq("task_id", task.id as string).eq("kind", kind).is("deleted_at", null).maybeSingle();
    if (!rev || rev.status === "draft") return NextResponse.json({ error: "Not found" }, { status: 404 });
    const okTask = await reviewTask(task.id as string);
    if (!okTask.ok) return NextResponse.json({ error: okTask.error }, { status: okTask.status });
    const origin = req.nextUrl.origin;
    const st = await linkState(rev.id as string, origin);
    const url = st.live && st.url ? st.url : await mintDocLink(rev.id as string, okTask.task, { memberId: null }, origin);
    return NextResponse.json({ url, created: false }, { headers: NO_STORE });
  }
  if (task.status === "done") return NextResponse.json({ error: "This task is finished. Start a new task for something new." }, { status: 400 });
  const ok = await reviewTask(task.id as string);
  if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: ok.status });

  // The client is nobody's member: the document is stamped as theirs by its link.
  const actor = { id: "client", memberId: null, admin: false, label: async () => scope.clientName };
  const made = await createReview(ok.task, "doc", actor);
  if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status });
  const docId = made.document.id as string;
  if (made.created) {
    // Theirs to write in from the start, and the team hears it was started.
    await supabaseAdmin.from("task_documents").update({ status: "with_client", title: task.title }).eq("id", docId);
    const assignee = await resolveNotifyRecipient(scope.assignedTo);
    if (assignee) {
      await notifyTeamOfClientActivity({
        notifyRecipient: assignee, clientId: scope.clientId, taskId: task.id as string, projectId: (task.project_id as string | null) ?? null,
        clientName: scope.clientName, taskTitle: task.title as string,
        notifText: `${scope.clientName} started a doc on "${task.title}".`, previewText: null, kind: "message",
      }).catch(() => {});
    }
  }
  const origin = req.nextUrl.origin;
  const state = await linkState(docId, origin);
  const url = state.live && state.url ? state.url : await mintDocLink(docId, ok.task, { memberId: null }, origin);
  return NextResponse.json({ url, created: made.created }, { headers: NO_STORE });
}
