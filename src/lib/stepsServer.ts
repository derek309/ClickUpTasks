// Server only: the steps a review's news adds, whether or not anyone has the
// task open (Derek, 2026-10-11: "move the automatic steps server side").
//
// The task page adds the same steps while it is open (TaskDrawer's stage
// effect); both use the rules in data.ts, and each added step carries a key
// (addedFor) that stops a second copy, so whichever side gets there first wins
// and the other adds nothing. Nothing here ever sends anything to the client.
import { supabaseAdmin } from "./supabaseAdmin";
import {
  addApprovalStep, addBusinessDaysIso, addChangesRound, addClientReviewStep, changesStepFor, currentStep, holdOnStep, isHandoffStep, planSteps,
  todayPacific, type DeliverableKey, type StepTodo, type Subtask,
} from "./data";
import { reviewFollowUpDays } from "./reviewReminders";

type ReviewKindKey = "doc" | "image" | "page" | "video";
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KIND_NAME: Record<ReviewKindKey, string> = { doc: "the document", image: "the image", page: "the page", video: "the video" };

type TaskRow = { id: string; subtasks: Subtask[] | null; assignee_id: string | null; client_id: string; updated_at: string };

/** Reads the task, works out its new steps and writes them only if nobody
 *  changed the task in between (tries again a few times if they did). */
async function rewriteSteps(taskId: string, change: (row: TaskRow, firstName: string) => Promise<Subtask[] | null> | Subtask[] | null): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await supabaseAdmin.from("tasks").select("id, subtasks, assignee_id, client_id, updated_at").eq("id", taskId).maybeSingle();
    if (!row) return false;
    const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", (row as TaskRow).client_id).maybeSingle();
    const firstName = String((client as { name?: string } | null)?.name ?? "the client").split(" ")[0];
    const next = await change(row as TaskRow, firstName);
    if (!next) return false;
    const { data: wrote } = await supabaseAdmin.from("tasks")
      .update({ subtasks: next, updated_by: null }).eq("id", taskId).eq("updated_at", (row as TaskRow).updated_at).select("id");
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
    const cur = currentStep(list);
    if (!cur) return null;
    return addChangesRound(list, cur.id, first, `${kind}:${version}`, () => newId("s_"), { review: kind as DeliverableKey, todos });
  });
}

/** A review was approved, by the client or by us: the step working on it is
 *  done and the approval is recorded; the plan's next step starts, or it asks
 *  what's next. */
export async function stepsOnReviewApproved(taskId: string, kind: ReviewKindKey, version: number, byClient: boolean): Promise<boolean> {
  const name = await reviewName(taskId, kind);
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    const cur = currentStep(list);
    if (!cur) return null;
    const title = byClient ? `${first} approved ${name}` : `${name.charAt(0).toUpperCase()}${name.slice(1)} approved`;
    const made = addApprovalStep(list, cur.id, title, `ok:${kind}:${version}`, () => newId("s_"), undefined, byClient ? `${first} approved` : "Approved");
    if (!made) return null;
    const now = new Date().toISOString();
    return made.list.map((x, i) => (made.hasNext && i === made.list.findIndex((y) => y.id === made.approvalId) + 1 && !x.startedAt ? { ...x, startedAt: now } : x));
  });
}

/** The client wrote back: a current step waiting on their reply ("Check in
 *  if they haven't replied") is done. */
export async function stepsOnClientReply(taskId: string): Promise<boolean> {
  return rewriteSteps(taskId, (row, first) => {
    const list = row.subtasks ?? [];
    const cur = currentStep(list);
    if (!cur || cur.finishWhen !== "reply") return null;
    const now = new Date().toISOString();
    return list.map((x) => (x.id === cur.id ? { ...x, done: true, doneAt: now, outcome: `${first} replied` } : x));
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
  });
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
  });
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
