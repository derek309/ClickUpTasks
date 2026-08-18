import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { todayIso, advanceDue, type Recurrence, type RecurrenceUnit, type Subtask } from "@/lib/data";
import { rateLimit } from "@/lib/rateLimit";
import { resolveNotifyRecipient } from "@/lib/waitingNotify";
import { resolveWaitingToken } from "@/lib/waitingToken";

// Public, token-gated — lets the client set a task's review outcome directly
// (Aug 3 Derek/Justin call: "needs changes" or "approved," right in the chat,
// instead of writing a message and waiting on the team to reclassify it).
// "review" joined them as the client-facing "Needs attention": softer than
// asking for specific changes, it just puts the task back in front of the
// team. It reuses the existing internal Review status (STATUS_META.review),
// so the board needs no new column or code to show it.
// Only these three values are ever accepted from an unauthenticated caller —
// every other TaskStatus stays internal-only.
const ALLOWED_STATUSES = new Set(["changes_requested", "review", "done"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimit(req, token, "status");
  if (limited) return limited;

  const scope = await resolveWaitingToken(token);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await req.json().catch(() => null) as { taskId?: string; status?: string } | null;
  const taskId = payload?.taskId;
  const status = payload?.status;
  if (!taskId || !status || !ALLOWED_STATUSES.has(status)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("*").eq("id", taskId).eq("is_private", false).maybeSingle();
  if (!task || task.client_id !== scope.clientId || (scope.projectId && task.project_id !== scope.projectId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.status === "done") return NextResponse.json({ error: "This item has already been completed." }, { status: 400 });

  const notifyRecipient = await resolveNotifyRecipient(scope.assignedTo);
  const patch: Record<string, unknown> = { status };
  // Same "answering the call" reasoning as respond/route.ts — setting a
  // status is itself a response, so a task that was waiting on the client
  // reopens for the team the same way replying to it would.
  if (task.waiting_on_client === true) {
    patch.waiting_on_client = false;
    patch.assignee_id = notifyRecipient;
    patch.due = todayIso();
  }

  const { error } = await supabaseAdmin.from("tasks").update({ ...patch, updated_by: null }).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Same recurrence-on-complete rule the internal app applies (Cockpit.tsx's
  // patchTask) — a client approving a recurring task from this public page
  // is still "marking it done," so it needs the same next-occurrence clone,
  // not just a status flip. This route is the task's completion path for
  // client-approved work, so skipping it here would silently stop recurring
  // client-review tasks from ever recreating themselves.
  if (status === "done" && task.recurrence && task.recurrence !== "none") {
    const nextDue = advanceDue(task.due as string | null, task.recurrence as Recurrence, task.recurrence_interval as number | undefined, task.recurrence_unit as RecurrenceUnit | undefined, task.recurrence_days_of_month as number[] | undefined);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { created_at, ...rest } = task;
    const clone = {
      ...rest,
      id: "t_" + randomUUID().replace(/-/g, ""),
      status: "todo",
      due: nextDue,
      subtasks: ((task.subtasks as Subtask[] | null) ?? []).map((s) => ({ ...s, id: "s_" + randomUUID().replace(/-/g, ""), done: false })),
      comments: [],
      client_response: null,
      ghl_task_id: null,
      updated_by: null,
    };
    await supabaseAdmin.from("tasks").insert(clone);
  }

  if (notifyRecipient) {
    // Bell only, no companion email. Setting a review outcome is a status
    // event — the board already shows it, and it fired on every approval,
    // which is noise. A client actually WRITING something still emails (see
    // waiting/[token]/messages and waiting/[token]/respond, both untouched).
    //
    // Written inline rather than through notifyTeamOfClientActivity because
    // that helper always sends its email, and sends it under the subject
    // `X replied on "<task>"` — wording that was wrong here in the first
    // place: nobody replied, a status was set. The bell text below says what
    // actually happened. Reverting is a one-line swap back to the helper.
    await supabaseAdmin.from("notifications").insert({
      id: "n_" + randomUUID(),
      recipient_id: notifyRecipient,
      text: status === "done"
        ? `${scope.clientName} approved "${task.title}".`
        : status === "review"
          ? `${scope.clientName} flagged "${task.title}" for a closer look.`
          : `${scope.clientName} requested changes on "${task.title}".`,
      task_id: taskId,
      actor_id: null,
      client_id: scope.clientId,
      project_id: task.project_id ?? null,
      at: new Date().toISOString(),
      read: false,
      kind: "activity",
    });
  }

  return NextResponse.json({ ok: true });
}
