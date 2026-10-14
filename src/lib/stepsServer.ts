// Server only: the steps a review's news adds, whether or not anyone has the
// task open (Derek, 2026-10-11: "move the automatic steps server side").
//
// The task page adds the same steps while it is open (TaskDrawer's stage
// effect); both use the rules in data.ts, and each added step carries a key
// (addedFor) that stops a second copy, so whichever side gets there first wins
// and the other adds nothing. Nothing here ever sends anything to the client.
import { supabaseAdmin } from "./supabaseAdmin";
import {
  addApprovalStep, addReplyStep, datesForCurrentStep, clientEmailText, isJustThanks, addBusinessDaysIso, addChangesRound, addClientReviewStep, addTellClientStep, addWhatsNextStep, asksWhatsNext, carryForward, changesStepFor, changesTelling, currentStep, holdOnStep, stepForNewWork,
  isHandoffStep, isLongTitle, ownNewSteps, planSteps, releaseFromSteps, statusForStep, stepAfter, stepForReview, stepForWork, stepHolding, stepStage,
  todayPacific, withMeetingSteps, type DeliverableKey, type StepTodo, type Subtask, type TaskStatus,
} from "./data";
import { reviewFollowUpDays } from "./reviewReminders";

type ReviewKindKey = "doc" | "image" | "page" | "video";
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KIND_NAME: Record<ReviewKindKey, string> = { doc: "the document", image: "the image", page: "the HTML review", video: "the video" };

type TaskRow = { id: string; subtasks: Subtask[] | null; assignee_id: string | null; client_id: string; status: TaskStatus; due: string | null; follow_up_at: string | null; updated_at: string };

/** Reads the task, works out its new steps and writes them only if nobody
 *  changed the task in between (tries again a few times if they did). */
async function rewriteSteps(taskId: string, change: (row: TaskRow, firstName: string) => Promise<Subtask[] | null> | Subtask[] | null, followUpFromNew = false,
  extra?: () => Record<string, unknown> | null): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await supabaseAdmin.from("tasks").select("id, subtasks, assignee_id, client_id, status, due, follow_up_at, updated_at").eq("id", taskId).maybeSingle();
    if (!row) return false;
    const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", (row as TaskRow).client_id).maybeSingle();
    const firstName = String((client as { name?: string } | null)?.name ?? "the client").split(" ")[0];
    const changed = await change(row as TaskRow, firstName);
    if (!changed) return false;
    const next = ownNewSteps((row as TaskRow).subtasks ?? [], changed, (row as TaskRow).assignee_id);
    // A changes step just made: the task's follow up is its due date (Derek, 2026-10-11).
    const before = new Set(((row as TaskRow).subtasks ?? []).map((x) => x.id));
    const made = followUpFromNew ? next.find((x) => !before.has(x.id) && x.stage === "changes_requested" && x.due) : null;
    // The task's dates follow its current step, as in the app (data.ts).
    const r = row as TaskRow;
    const dates = datesForCurrentStep(r.subtasks ?? [], next, { assigneeId: r.assignee_id, due: r.due, followUpAt: r.follow_up_at });
    const { data: wrote } = await supabaseAdmin.from("tasks")
      .update({ subtasks: next, updated_by: null, ...(dates.due ? { due: dates.due } : {}), ...(dates.followUpAt ? { follow_up_at: dates.followUpAt } : {}), ...(made ? { follow_up_at: made.due } : {}), ...(extra?.() ?? {}) }).eq("id", taskId).eq("updated_at", (row as TaskRow).updated_at).select("id");
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
  // Each stamped with when it was written here, so a new round after the
  // step was cleared from Needs you brings it back (Derek, 2026-10-13).
  const now = new Date().toISOString();
  const todos: StepTodo[] = ((comments ?? []) as { id: string; body: string | null; author_id: string | null; completed_at: string | null }[])
    .filter((c) => c.author_id === null && !c.completed_at && (c.body ?? "").trim())
    .map((c) => ({ id: newId("td_"), title: (c.body ?? "").trim().slice(0, 300), done: false, fromClient: true, commentId: c.id, at: now }));
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
  // Their reply ends the wait on them: the task stops waiting and its status
  // follows the step that starts, as tickStep does.
  let status: TaskStatus | null = null;
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    // Any open step waiting on their reply, current or not: a changes step
    // their answer just made can sit in front of it.
    // Only a wait that has begun (or is the current step): a reply step later
    // in the plan, never started, is not finished by an answer to something
    // else (t_b3ucv3k1 "Review Ads").
    const cur = currentStep(list);
    const waiting = list.filter((x) => !x.done && x.finishWhen === "reply" && (!!x.startedAt || x.id === cur?.id)).map((x) => x.id);
    if (!waiting.length) return null;
    const now = new Date().toISOString();
    const done = list.map((x) => (waiting.includes(x.id) ? { ...x, done: true, doneAt: now, outcome: `${first} replied` } : x));
    // The next step starts, as it does when someone ticks one in the app.
    const next = planSteps(done).find((x) => !x.done);
    status = statusForStep(row.status, next ? stepStage(next, row.assignee_id) : "in_progress");
    if (next) return next.startedAt ? done : done.map((x) => (x.id === next.id ? { ...x, startedAt: now } : x));
    // Nothing after it: their answer is the owner's to act on, so a "what's
    // next?" step starts and the task shows under Needs you (Derek, 2026-10-13).
    const last = waiting[waiting.length - 1];
    if (done.some((x) => x.addedFor === `next:${last}`)) return done;
    const at = done.findIndex((x) => x.id === last);
    const out = [...done];
    out.splice(at + 1, 0, { id: newId("s_"), title: `${first} replied: what's next?`, done: false, addedFor: `next:${last}`, startedAt: now });
    return out;
  }, false, () => ({ waiting_on_client: false, ...(status ? { status } : {}) }));
}

/** A long task name made short: the request becomes step 1's directions, a
 *  step of its own in front when the plan's first step is something else. The
 *  name changes in the same write, and only while it is still the request. */
export async function requestOntoStepOne(taskId: string, request: string, title: string, stepTitle: string): Promise<boolean> {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const notes = request.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  let stillLong = true;
  const ok = await rewriteSteps(taskId, async (row) => {
    const { data } = await supabaseAdmin.from("tasks").select("title").eq("id", taskId).maybeSingle();
    stillLong = String((data as { title?: string } | null)?.title ?? "").trim() === request;
    if (!stillLong) return null;
    const list = row.subtasks ?? [];
    const first = planSteps(list).find((x) => !x.done);
    const now = new Date().toISOString();
    if (first && !first.notes?.trim()) return list.map((x) => (x.id === first.id ? { ...x, notes } : x));
    const hasCurrent = list.some((x) => !x.done && x.startedAt);
    return [{ id: newId("s_"), title: stepTitle, done: false, notes, ...(hasCurrent ? {} : { startedAt: now }) }, ...list];
  }, false, () => ({ title }));
  if (ok) {
    await supabaseAdmin.rpc("append_comment", { task_id: taskId, comment: {
      id: "cm_" + crypto.randomUUID(), authorId: "u_derek", at: new Date().toISOString(), kind: "event",
      body: `shortened the name from the full request, which is now step 1's directions`,
    } });
  }
  return ok;
}

/** Each open step named with a whole request gets a short name, and the
 *  request goes on top of its directions. How many it renamed. */
export async function longStepsToDirections(taskId: string, nameFor: (request: string) => Promise<string>, onlyIds?: string[]): Promise<number> {
  const only = onlyIds ? new Set(onlyIds) : null;
  const { data } = await supabaseAdmin.from("tasks").select("subtasks").eq("id", taskId).maybeSingle();
  const long = (((data as { subtasks?: Subtask[] | null } | null)?.subtasks) ?? []).filter((x) => !x.done && !x.fromClient && isLongTitle(x.title) && (!only || only.has(x.id)));
  if (!long.length) return 0;
  const names = new Map(await Promise.all(long.map(async (x) => [x.title, await nameFor(x.title)] as const)));
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let count = 0;
  const ok = await rewriteSteps(taskId, (row) => {
    count = 0;
    const next = (row.subtasks ?? []).map((x) => {
      const name = !x.done && !x.fromClient && (!only || only.has(x.id)) ? names.get(x.title) : undefined;
      if (!name) return x;
      count++;
      const request = x.title.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
      return { ...x, title: name, notes: x.notes?.trim() ? `${request}${x.notes}` : request };
    });
    return count ? next : null;
  });
  if (ok) {
    await supabaseAdmin.rpc("append_comment", { task_id: taskId, comment: {
      id: "cm_" + crypto.randomUUID(), authorId: "u_derek", at: new Date().toISOString(), kind: "event",
      body: count === 1 ? "shortened a step's name; the full request is now its directions" : `shortened ${count} steps' names; each full request is now its directions`,
    } });
  }
  return ok ? count : 0;
}

/** Client work's Add, Meeting transcript: the meeting's two steps, dated to
 *  the task (or today when that has passed). Nothing when they are there. */
/** A step page's Transcript: this step waits on the meeting's transcript. */
export async function stepWaitsOnTranscript(taskId: string, stepId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row) => {
    const list = row.subtasks ?? [];
    const step = list.find((x) => x.id === stepId);
    if (!step || step.done || step.finishWhen === "transcript") return null;
    return list.map((x) => (x.id === stepId ? { ...x, finishWhen: "transcript" as const } : x));
  });
}

export async function ensureMeetingSteps(taskId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row, first) => {
    const today = todayPacific();
    return (row.subtasks ?? []).some((x) => !x.done && x.finishWhen === "transcript") ? null
      : withMeetingSteps(row.subtasks ?? [], first, row.due && row.due >= today ? row.due : today, () => newId("s_"));
  });
}

/** The meeting's transcript came in from Granola: the open "Add the meeting
 *  transcript" step holds the file and is done, and the meeting step before
 *  it too (Derek, 2026-10-12). */
export async function stepsOnMeetingTranscript(taskId: string, attachmentId: string, stepId?: string): Promise<boolean> {
  return rewriteSteps(taskId, (row) => {
    const list = row.subtasks ?? [];
    const step = list.find((x) => (stepId ? x.id === stepId : !x.done && x.finishWhen === "transcript"));
    if (!step) return null;
    const now = new Date().toISOString();
    return list.map((x) => {
      if (x.id === step.id) return { ...x, done: true, doneAt: x.doneAt ?? now, finishWhen: undefined, outcome: "Transcript from Granola", holds: [...(x.holds ?? []), `att:${attachmentId}`] };
      if (!x.done && x.finishWhen === "transcript") return { ...x, done: true, doneAt: now, outcome: "Transcript from Granola" };
      if (!x.done && x.addedFor === "meeting") return { ...x, done: true, doneAt: now, outcome: "Met" };
      return x;
    });
  });
}

/** What the client sent from their portal goes on the open changes step,
 *  made in front of the current step when there is none (the task page's
 *  rule, now with nobody watching). A task with no steps gets one too. */
export async function stepsOnClientChanges(taskId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    // A task with no steps gets one too (Derek, 2026-10-13).
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
    const todo: StepTodo = { id: newId("td_"), title: text.slice(0, 300), done: false, fromClient: true, commentId: comment.id, at: new Date().toISOString() };
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
      // Client work still under way moves on with the plan, to the next
      // review step when there is one (stepForWork); finished work stays.
      const to = stepForWork(next, stepId, after) ?? after;
      const moving = carryForward(s.holds, (k) => finished.has(k)).filter((k) => !to.holds?.includes(k));
      next = next.map((x) => {
        if (x.id === stepId && moving.length) { const rest = (x.holds ?? []).filter((k) => !moving.includes(k as DeliverableKey)); return { ...x, holds: rest.length ? rest : undefined }; }
        if (x.id !== after.id && x.id !== to.id) return x;
        return { ...x, ...(x.id === after.id ? { startedAt: x.startedAt ?? now } : {}), ...(x.id === to.id && moving.length ? { holds: [...(x.holds ?? []), ...moving] } : {}) };
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
 *  named (moved there from any step holding it: replace with a step, seen
 *  2026-10-12 on t_mv5ma65g8), when the current step is already about emailing
 *  them, or when the plan is asking what's next (that step takes the email's
 *  name). With no step named, a step already holding a draft keeps it. A named
 *  step that matches none or several changes nothing and says so. Tasks without
 *  steps are left alone. The step's title (on), or why it stayed (note). */
export async function holdDraftOnStep(taskId: string, subject: string, stepRef?: string): Promise<{ on: string | null; note?: string }> {
  let on: string | null = null;
  let note: string | undefined;
  await rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    const plan = planSteps(list);
    if (!plan.length) return null;
    const title = `Email ${first}${subject.trim() ? `: ${subject.trim().slice(0, 80)}` : ""}`;
    const held = stepHolding(list, "email");
    const ref = stepRef?.trim();
    if (ref) {
      const named = matchStep(plan, ref);
      if (typeof named === "string") { note = named; on = held?.title ?? null; return null; }
      if (asksWhatsNext(named)) {
        on = title;
        return holdOnStep(list.map((x) => (x.id === named.id ? { ...x, title, makes: "email" as const } : x)), named.id, "email");
      }
      on = named.title;
      return held?.id === named.id ? null : holdOnStep(list, named.id, "email");
    }
    if (held) { on = held.title; return null; }
    const cur = currentStep(list);
    if (cur && !cur.onClient && (cur.makes === "email" || /^(email|let) /i.test(cur.title))) { on = cur.title; return holdOnStep(list, cur.id, "email"); }
    if (cur && asksWhatsNext(cur)) {
      on = title;
      return holdOnStep(list.map((x) => (x.id === cur.id ? { ...x, title, makes: "email" as const } : x)), cur.id, "email");
    }
    // Its own step, right after the current one: the email follows the work
    // under way (Derek, 2026-10-12: research was step 1, its email step 2).
    const id = newId("s_");
    const step: Subtask = { id, title, done: false, makes: "email" };
    const at = cur ? list.findIndex((x) => x.id === cur.id) + 1 : list.length;
    const next = [...list];
    next.splice(at, 0, step);
    on = title;
    return holdOnStep(next, id, "email");
  });
  return { on, note };
}

/** Takes a task's draft email off whichever step holds it (the draft itself
 *  is cleared by the caller). A step made only for the email and not yet
 *  done goes with it. Whether any step changed. */
export async function releaseDraftFromSteps(taskId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row) => {
    const list = row.subtasks ?? [];
    const held = stepHolding(list, "email");
    if (!held) return null;
    const madeForIt = !held.done && !held.addedFor && held.makes === "email" && /^Email /.test(held.title) && !(held.todos ?? []).length && (held.holds ?? []).length === 1;
    return madeForIt ? list.filter((x) => x.id !== held.id) : releaseFromSteps(list, "email");
  });
}

/** A step by id, then by its whole title, then by a piece of its title that
 *  only one step has ("what's next?" finds "Rebuild the page: what's next?",
 *  not "Rebuild the page"). Else why not, as a sentence. */
export function matchStep<T extends Pick<Subtask, "id" | "title">>(plan: T[], ref: string): T | string {
  const want = ref.trim().toLowerCase();
  const byId = plan.find((x) => x.id === ref.trim());
  if (byId) return byId;
  const whole = plan.filter((x) => x.title.trim().toLowerCase() === want);
  if (whole.length === 1) return whole[0];
  const part = plan.filter((x) => x.title.toLowerCase().includes(want));
  if (part.length === 1) return part[0];
  const list = (whole.length ? whole : part).map((x) => `"${x.title.slice(0, 60)}" [${x.id}]`).join("; ");
  return part.length ? `"${ref}" matches ${part.length} steps, so the draft was not moved. Use the id: ${list}.` : `No step matching "${ref}", so the draft was not moved. get_task lists the steps.`;
}

/** A client's email on a task becomes a step to answer it (Derek, 2026-10-12).
 *  always: linked or added on purpose from the Inbox, so it is a step even on
 *  a task without steps and even when short. Otherwise (it arrived on a thread
 *  already linked) only on a task with steps, and not for a plain "thanks". */
export async function stepsOnClientEmail(taskId: string, m: { id: string; subject: string | null; body: string; at: string; from: string | null; fileKey?: string }, always = false): Promise<boolean> {
  const text = clientEmailText(m.body ?? "", m.from);
  if (!always && isJustThanks(text)) return false;
  let status: TaskStatus | null = null;
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    if (!always && !planSteps(list).length) return null;
    const who = (m.from ?? "").replace(/\s*\(via [^)]*\)\s*$/i, "").trim().split(/\s+/)[0] || first;
    const made = addReplyStep(list, { messageId: m.id, from: (m.from ?? "").trim() || first, subject: (m.subject ?? "").trim(), body: text.slice(0, 6000), at: m.at, ...(m.fileKey ? { fileKey: m.fileKey } : {}) }, who, () => newId("s_"));
    status = made ? statusForStep(row.status, "in_progress") : null;
    return made;
  }, false, () => (status ? { status } : null));
}

/** Client work Claude made or changed over the MCP goes on a step (Derek,
 *  2026-10-13: the October Newsletter's page and the October Blog documents
 *  sat "Not on a step"): the step named, else where stepForNewWork puts it.
 *  Work a step already holds stays where it is unless a step is named. Tasks
 *  without open steps are left alone. The step's title, or a sentence saying
 *  why nothing moved. */
export async function holdMadeWork(taskId: string, key: DeliverableKey, claudeId: string, stepRef?: string): Promise<{ on: string | null; note?: string }> {
  let on: string | null = null;
  let note: string | undefined;
  const { data: doc } = key === "email" ? { data: null } : await supabaseAdmin.from("task_documents").select("status").eq("task_id", taskId).eq("kind", key).is("deleted_at", null).maybeSingle();
  const status = (doc as { status?: string } | null)?.status;
  const finished = status === "approved" || status === "completed";
  await rewriteSteps(taskId, (row) => {
    const list = row.subtasks ?? [];
    const plan = planSteps(list);
    if (!plan.length) return null;
    let stepId: string | undefined;
    const ref = stepRef?.trim();
    if (ref) {
      const named = matchStep(plan, ref);
      if (typeof named === "string") { note = named; return null; }
      stepId = named.id;
    }
    const held = stepHolding(list, key);
    if (held && (!stepId || held.id === stepId)) { on = held.title; return null; }
    const place = stepForNewWork(list, key, { claudeId, stepId, finished });
    if (!place) return null;
    on = list.find((x) => x.id === place.holdOn)?.title ?? null;
    return holdOnStep(list, place.holdOn, key).map((x) => (x.id === place.madeOn && !x.madeHere?.includes(key) ? { ...x, madeHere: [...(x.madeHere ?? []), key] } : x));
  });
  return { on, note };
}
