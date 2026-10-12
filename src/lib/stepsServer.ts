// Server only: the steps a review's news adds, whether or not anyone has the
// task open (Derek, 2026-10-11: "move the automatic steps server side").
//
// The task page adds the same steps while it is open (TaskDrawer's stage
// effect); both use the rules in data.ts, and each added step carries a key
// (addedFor) that stops a second copy, so whichever side gets there first wins
// and the other adds nothing. Nothing here ever sends anything to the client.
import { supabaseAdmin } from "./supabaseAdmin";
import {
  addApprovalStep, addBusinessDaysIso, addChangesRound, addClientReviewStep, addTellClientStep, addWhatsNextStep, asksWhatsNext, carryForward, changesStepFor, changesTelling, currentStep, holdOnStep,
  isHandoffStep, ownNewSteps, planSteps, statusForStep, stepAfter, stepForReview, stepHolding, stepStage,
  todayPacific, type DeliverableKey, type StepTodo, type Subtask, type TaskStatus,
} from "./data";
import { reviewFollowUpDays } from "./reviewReminders";

type ReviewKindKey = "doc" | "image" | "page" | "video";
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KIND_NAME: Record<ReviewKindKey, string> = { doc: "the document", image: "the image", page: "the page", video: "the video" };

type TaskRow = { id: string; subtasks: Subtask[] | null; assignee_id: string | null; client_id: string; status: TaskStatus; updated_at: string };

/** Reads the task, works out its new steps and writes them only if nobody
 *  changed the task in between (tries again a few times if they did). */
async function rewriteSteps(taskId: string, change: (row: TaskRow, firstName: string) => Promise<Subtask[] | null> | Subtask[] | null, followUpFromNew = false,
  extra?: () => Record<string, unknown> | null): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await supabaseAdmin.from("tasks").select("id, subtasks, assignee_id, client_id, status, updated_at").eq("id", taskId).maybeSingle();
    if (!row) return false;
    const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", (row as TaskRow).client_id).maybeSingle();
    const firstName = String((client as { name?: string } | null)?.name ?? "the client").split(" ")[0];
    const changed = await change(row as TaskRow, firstName);
    if (!changed) return false;
    const next = ownNewSteps((row as TaskRow).subtasks ?? [], changed, (row as TaskRow).assignee_id);
    // A changes step just made: the task's follow up is its due date (Derek, 2026-10-11).
    const before = new Set(((row as TaskRow).subtasks ?? []).map((x) => x.id));
    const made = followUpFromNew ? next.find((x) => !before.has(x.id) && x.stage === "changes_requested" && x.due) : null;
    const { data: wrote } = await supabaseAdmin.from("tasks")
      .update({ subtasks: next, updated_by: null, ...(made ? { follow_up_at: made.due } : {}), ...(extra?.() ?? {}) }).eq("id", taskId).eq("updated_at", (row as TaskRow).updated_at).select("id");
    if (wrote?.length) return true;
  }
  return false;
}

async function reviewName(taskId: string, kind: ReviewKindKey): Promise<string> {
  const { data } = await supabaseAdmin.from("task_documents").select("title").eq("task_id", taskId).eq("kind", kind).is("deleted_at", null).maybeSingle();
  return String((data as { title?: string } | null)?.title ?? "").trim() || KIND_NAME[kind];
}

/** A review went to the client: the step working on it is done and the
 *  client's waiting step starts, holding nothing of its own. */
export async function stepsOnReviewSent(taskId: string, kind: ReviewKindKey, reminderEveryDays = 1): Promise<boolean> {
  const name = await reviewName(taskId, kind);
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    const cur = currentStep(list);
    if (!cur || cur.onClient || isHandoffStep(cur, row.assignee_id)) return null;
    const due = addBusinessDaysIso(todayPacific(), reviewFollowUpDays(reminderEveryDays));
    return addClientReviewStep(list, cur.id, first, name, kind as DeliverableKey, due, () => newId("s_"));
  });
}

/** The client sent changes on a review: "Make <client>'s changes", their open
 *  comments as its to-dos. */
export async function stepsOnReviewChanges(taskId: string, kind: ReviewKindKey, documentId: string, version: number): Promise<boolean> {
  const { data: comments } = await supabaseAdmin.from("task_document_comments")
    .select("id, body, author_id, completed_at").eq("document_id", documentId);
  const todos: StepTodo[] = ((comments ?? []) as { id: string; body: string | null; author_id: string | null; completed_at: string | null }[])
    .filter((c) => c.author_id === null && !c.completed_at && (c.body ?? "").trim())
    .map((c) => ({ id: newId("td_"), title: (c.body ?? "").trim().slice(0, 300), done: false, fromClient: true, commentId: c.id }));
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    // A changes round already open for this review (a comment opened it, then
    // Send changes bumped the version): its new comments join that round
    // instead of a second one starting (audit 2026-10-11).
    const round = planSteps(list).find((x) => !x.done && new RegExp(`^${kind}:\\d+$`).test(x.addedFor ?? ""));
    if (round) {
      const have = new Set((round.todos ?? []).map((t) => t.commentId).filter(Boolean));
      const add = todos.filter((t) => !have.has(t.commentId));
      return add.length ? list.map((x) => (x.id === round.id ? { ...x, todos: [...(x.todos ?? []), ...add] } : x)) : null;
    }
    const step = stepForReview(list, kind as DeliverableKey, row.assignee_id);
    if (!step) return null;
    return addChangesRound(list, step.id, first, `${kind}:${version}`, () => newId("s_"), { review: kind as DeliverableKey, todos });
  }, true);
}

/** A review was approved, by the client or by us: the step working on it is
 *  done and the approval is recorded; the plan's next step starts, or it asks
 *  what's next. */
export async function stepsOnReviewApproved(taskId: string, kind: ReviewKindKey, version: number, byClient: boolean): Promise<boolean> {
  const name = await reviewName(taskId, kind);
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    const cur = stepForReview(list, kind as DeliverableKey, row.assignee_id);
    if (!cur) return null;
    const title = byClient ? `${first} approved ${name}` : `${name.charAt(0).toUpperCase()}${name.slice(1)} approved`;
    const made = addApprovalStep(list, cur.id, title, `ok:${kind}:${version}`, () => newId("s_"), undefined, byClient ? `${first} approved` : "Approved");
    if (!made) return null;
    const now = new Date().toISOString();
    // The plan's next step, not merely the next item in the list (a portal
    // request can sit between them).
    const next = made.hasNext ? stepAfter(made.list, made.approvalId) : null;
    return made.list.map((x) => (next && x.id === next.id && !x.startedAt ? { ...x, startedAt: now } : x));
  });
}

/** The client wrote back: a current step waiting on their reply ("Check in
 *  if they haven't replied") is done. */
export async function stepsOnClientReply(taskId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    // Any open step waiting on their reply, current or not: a changes step
    // their answer just made can sit in front of it.
    const waiting = list.filter((x) => !x.done && x.finishWhen === "reply").map((x) => x.id);
    if (!waiting.length) return null;
    const now = new Date().toISOString();
    return list.map((x) => (waiting.includes(x.id) ? { ...x, done: true, doneAt: now, outcome: `${first} replied` } : x));
  });
}

/** What the client sent from their portal goes on the open changes step,
 *  made in front of the current step when there is none (the task page's
 *  rule, now with nobody watching). Only on a task that has steps. */
export async function stepsOnClientChanges(taskId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    if (!planSteps(list).length) return null;
    const loose = list.filter((x) => x.fromClient && !x.stepId && !x.done).map((x) => x.id);
    if (!loose.length) return null;
    const { list: withStep, stepId } = changesStepFor(list, first, () => newId("s_"));
    return withStep.map((x) => (loose.includes(x.id) ? { ...x, stepId } : x));
  }, true);
}

/** The client commented on a review already approved (Derek, 2026-10-11: "the
 *  changes should come up as a checklist with the comments"): the comment is
 *  a to-do on the open changes step, made when there is none, and the review
 *  moves onto that step to be worked on. Ticking the to-do resolves the
 *  comment on their page. Once per comment. */
export async function stepsOnCommentAfterApproval(taskId: string, kind: ReviewKindKey, comment: { id: string; body: string }): Promise<boolean> {
  const text = comment.body.trim();
  if (!text) return false;
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    if (!planSteps(list).length) return null;
    if (list.some((x) => x.todos?.some((t) => t.commentId === comment.id))) return null;
    const { list: withStep, stepId } = changesStepFor(list, first, () => newId("s_"));
    const held = holdOnStep(withStep, stepId, kind);
    const todo: StepTodo = { id: newId("td_"), title: text.slice(0, 300), done: false, fromClient: true, commentId: comment.id };
    return held.map((x) => (x.id === stepId ? { ...x, todos: [...(x.todos ?? []), todo] } : x));
  }, true);
}

/** A comment was deleted: its to-do goes too, wherever it sits. */
export async function stepsOnCommentRemoved(taskId: string, commentId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row) => {
    const list = row.subtasks ?? [];
    if (!list.some((x) => x.todos?.some((t) => t.commentId === commentId))) return null;
    return list.map((x) => {
      if (!x.todos?.some((t) => t.commentId === commentId)) return x;
      const todos = x.todos.filter((t) => t.commentId !== commentId);
      return { ...x, todos: todos.length ? todos : undefined };
    });
  });
}

// ── Steps worked from outside the app (the MCP, Derek 2026-10-12: "do we need
// to update the MCP server for the new stuff"). The same rules as the task
// page's tick, so a step Claude ticks moves the plan on like one ticked in the app.

/** Ticks a step done (or reopens it) and says what happens next, in words for Claude. */
export async function tickStep(taskId: string, stepId: string, done: boolean): Promise<string> {
  const { data: docs } = await supabaseAdmin.from("task_documents").select("kind, status").eq("task_id", taskId).is("deleted_at", null);
  const finished = new Set(((docs ?? []) as { kind: string; status: string }[]).filter((d) => d.status === "approved" || d.status === "completed").map((d) => d.kind));
  let note = "";
  let status: TaskStatus | null = null;
  const ok = await rewriteSteps(taskId, (row, first) => {
    status = null;
    const list = row.subtasks ?? [];
    const s = list.find((x) => x.id === stepId);
    if (!s) { note = "That step is not on the task any more."; return null; }
    if (!done) {
      if (!s.done) { note = `"${s.title}" is already open.`; return null; }
      note = `"${s.title}" reopened.`;
      return list.map((x) => (x.id === stepId ? { ...x, done: false, doneAt: undefined, outcome: undefined } : x));
    }
    if (s.done) { note = `"${s.title}" was already done.`; return null; }
    if (s.onClient) { note = `"${s.title}" is the client's own step. It finishes when they answer the review; nothing was changed.`; return null; }
    const now = new Date().toISOString();
    // A portal request: done, nothing else moves.
    if (s.fromClient) { note = `"${s.title}" done.`; return list.map((x) => (x.id === stepId ? { ...x, done: true, doneAt: now } : x)); }
    // Changes done and no client review next: the next step is telling the client.
    if (!isHandoffStep(s, row.assignee_id) && changesTelling(list, stepId, row.assignee_id) === "add") {
      const told = addTellClientStep(list, stepId, first, () => newId("s_"), now);
      if (told) {
        status = statusForStep(row.status, "in_progress");
        note = `"${s.title}" done. Next step: "Let ${first} know the changes are done". Write that email with draft_email (it goes on that step); nothing is sent.`;
        return told;
      }
    }
    let next = list.map((x) => (x.id === stepId ? { ...x, done: true, doneAt: now, outcome: "Done" } : x));
    const after = stepAfter(next, stepId);
    if (after) {
      // Client work still under way moves on with the plan; finished work stays.
      const moving = carryForward(s.holds, (k) => finished.has(k)).filter((k) => !after.holds?.includes(k));
      next = next.map((x) => {
        if (x.id === stepId && moving.length) { const rest = (x.holds ?? []).filter((k) => !moving.includes(k as DeliverableKey)); return { ...x, holds: rest.length ? rest : undefined }; }
        if (x.id === after.id) return { ...x, startedAt: x.startedAt ?? now, ...(moving.length ? { holds: [...(x.holds ?? []), ...moving] } : {}) };
        return x;
      });
      status = statusForStep(row.status, stepStage(after, row.assignee_id));
      note = `"${s.title}" done. Next step: "${after.title}".`;
      return next;
    }
    const asked = addWhatsNextStep(next, stepId, () => newId("s_"), now);
    note = `"${s.title}" done. That was the last step${asked ? `, so the task now asks "${asked.find((x) => x.addedFor === `next:${stepId}`)?.title}"` : ""}. Add the next step with add_checklist_items, or set the task's status to done if it is finished.`;
    return asked ?? next;
  }, false, () => (status ? { status } : null));
  return ok || note ? note : "The step could not be saved. Try again.";
}

/** Ticks one of a step's to-dos; one that came from a client's comment
 *  resolves that comment on their page, as in the app. */
export async function tickTodo(taskId: string, ref: string, done: boolean, actorLabel: string): Promise<string> {
  let note = "";
  let commentId: string | null = null;
  await rewriteSteps(taskId, (row) => {
    const list = row.subtasks ?? [];
    const want = ref.trim().toLowerCase();
    const hits = list.flatMap((x) => (x.todos ?? []).map((t) => ({ step: x, t })))
      .filter(({ t }) => t.id === ref.trim() || t.title.toLowerCase().includes(want));
    const exact = hits.filter(({ t }) => t.id === ref.trim());
    const pick = exact.length ? exact : hits;
    if (!pick.length) { note = `No to-do matching "${ref}".`; return null; }
    if (pick.length > 1) { note = `"${ref}" matches ${pick.length} to-dos, use the id: ${pick.map(({ t }) => `${t.title.slice(0, 60)} [${t.id}]`).join("; ")}.`; return null; }
    const { step, t } = pick[0];
    commentId = t.commentId ?? null;
    if (t.done === done) { note = `"${t.title}" was already ${done ? "done" : "open"}.`; return null; }
    note = `To-do "${t.title.slice(0, 80)}" on "${step.title}" → ${done ? "done" : "open"}.`;
    return list.map((x) => (x.id === step.id ? { ...x, todos: (x.todos ?? []).map((y) => (y.id === t.id ? { ...y, done } : y)) } : x));
  });
  if (commentId) {
    const { data: c } = await supabaseAdmin.from("task_document_comments").select("id, document_id").eq("id", commentId).maybeSingle();
    const docId = (c as { document_id?: string } | null)?.document_id;
    const { data: doc } = docId ? await supabaseAdmin.from("task_documents").select("id").eq("id", docId).eq("task_id", taskId).maybeSingle() : { data: null };
    if (doc) {
      const now = new Date().toISOString();
      await supabaseAdmin.from("task_document_comments").update({ completed_at: done ? now : null, completed_by_label: done ? actorLabel : null }).eq("id", commentId);
      note += done ? " Its comment is resolved on the client's page." : " Its comment is open again on the client's page.";
    }
  }
  return note;
}

/** A draft email written from outside gets its own step (Derek, 2026-10-12:
 *  "sending an email kind of needs its own step"): "Email <client>: <subject>",
 *  made the current step. It goes on an existing step instead when one is
 *  named, when the current step is already about emailing them, or when the
 *  plan is asking what's next (that step takes the email's name). A step
 *  already holding a draft keeps it. Tasks without steps are left alone.
 *  The step's title, or null. */
export async function holdDraftOnStep(taskId: string, subject: string, stepRef?: string): Promise<string | null> {
  let on: string | null = null;
  await rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    const plan = planSteps(list);
    if (!plan.length) return null;
    const held = stepHolding(list, "email");
    if (held) { on = held.title; return null; }
    const ref = stepRef?.trim();
    const named = ref ? plan.find((x) => x.id === ref) ?? (() => { const h = plan.filter((x) => x.title.toLowerCase().includes(ref.toLowerCase())); return h.length === 1 ? h[0] : null; })() : null;
    if (named) { on = named.title; return holdOnStep(list, named.id, "email"); }
    const cur = currentStep(list);
    const title = `Email ${first}${subject.trim() ? `: ${subject.trim().slice(0, 80)}` : ""}`;
    if (cur && !cur.onClient && (cur.makes === "email" || /^(email|let) /i.test(cur.title))) { on = cur.title; return holdOnStep(list, cur.id, "email"); }
    if (cur && asksWhatsNext(cur)) {
      on = title;
      return holdOnStep(list.map((x) => (x.id === cur.id ? { ...x, title, makes: "email" as const } : x)), cur.id, "email");
    }
    // Its own step, in front of the current one so it is what's next to do.
    const id = newId("s_");
    const step: Subtask = { id, title, done: false, makes: "email", startedAt: new Date().toISOString() };
    const at = cur ? list.findIndex((x) => x.id === cur.id) : list.length;
    const next = [...list];
    next.splice(at, 0, step);
    on = title;
    return holdOnStep(next, id, "email");
  });
  return on;
}
