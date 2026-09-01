// Data-access layer over Supabase. Maps snake_case DB rows <-> our camelCase
// domain types, seeds demo data on first run, and exposes upsert/delete helpers.

import { supabase } from "./supabase";
import {
  clientsSeed,
  contactsSeed,
  projectsSeed,
  seedTasks,
  seedNotifications,
  type Task,
  type Client,
  type Project,
  type Contact,
  type UnmatchedEmail,
  type GranolaUnmatchedMeeting,
  type Notification,
  type ClientLink,
  type ClientNote,
  type VaultFolder,
  type Folder,
  type Stage,
  type NoteType,
  type Comment,
  type Message,
  type ScheduledMessage,
  type ScheduledMessageStatus,
  type MessageChannel,
  type MessageDirection,
  type TaskTemplate,
  type Playbook,
  type Priority,
  type TeamMessage,
  type DmMessage,
  titleCase,
  PRIORITY_META,
  TaskAction, TaskActionKind,
} from "./data";

/* eslint-disable @typescript-eslint/no-explicit-any */

export { titleCase };

// --- mappers ----------------------------------------------------------------

// playbook_last_progress_at deliberately NOT included here: clientToRow
// feeds the general-purpose upsertClient(), called on nearly every client
// edit — including it would 400 that entire write path until the migration
// runs (PostgREST rejects an upsert naming an unknown column). It's written
// only through its own narrow, dedicated touchPlaybookProgress() below,
// which only fires on an actual step completion.
// can_request_new_tasks IS included, and that's the same trade in reverse:
// it's an ordinary admin-editable setting, so it belongs on the normal edit
// path — which makes supabase/client-request-new-tasks.sql a migrate-before-
// deploy, exactly like can_message was. in_trial/trial_ends_at/does_a2p
// (supabase/client-trial-and-a2p.sql) are on that same normal edit path for
// the same reason, so that migration is also migrate-before-deploy.
const clientToRow = (c: Client) => ({ id: c.id, name: c.name, color: c.color, ghl_location_id: c.ghlLocationId, status: c.status ?? "claimed", type: c.type ?? "client", assigned_to: c.assignedTo ?? [], can_message: c.canMessage ?? [], linked_contact_id: c.linkedContactId ?? null, linked_contact_ids: c.linkedContactIds ?? [], reviewed_at: c.reviewedAt ?? null, share_token: c.shareToken ?? null, can_request_new_tasks: c.canRequestNewTasks === true, in_trial: c.inTrial === true, trial_ends_at: c.trialEndsAt ?? null, does_a2p: c.doesA2P === true, show_growth_plan: c.showGrowthPlan === true, portal_shows_all_tasks: c.portalShowsAllTasks === true });
export const rowToClient = (r: any): Client => ({ id: r.id, name: titleCase(r.name), color: r.color, ghlLocationId: r.ghl_location_id ?? "", status: (r.status as Client["status"]) ?? "claimed", type: (r.type as Client["type"]) ?? "client", assignedTo: r.assigned_to ?? [], canMessage: r.can_message ?? [], linkedContactId: r.linked_contact_id ?? null, linkedContactIds: r.linked_contact_ids ?? [], aiSummary: r.ai_summary ?? null, aiSummaryAt: r.ai_summary_at ?? null, reviewedAt: r.reviewed_at ?? null, shareToken: r.share_token ?? null, playbookLastProgressAt: r.playbook_last_progress_at ?? null, canRequestNewTasks: r.can_request_new_tasks === true, inTrial: r.in_trial === true, trialEndsAt: r.trial_ends_at ?? null, doesA2P: r.does_a2p === true, showGrowthPlan: r.show_growth_plan === true, portalShowsAllTasks: r.portal_shows_all_tasks === true });

const contactToRow = (c: Contact) => ({ id: c.id, client_id: c.clientId, name: c.name, email: c.email, phone: c.phone ?? null, ghl_contact_id: c.ghlContactId, company_name: c.company ?? null, city: c.city ?? null, state: c.state ?? null, saas_url: c.saasUrl ?? null });
export const rowToContact = (r: any): Contact => ({ id: r.id, clientId: r.client_id, name: titleCase(r.name), email: r.email ?? "", phone: r.phone ?? "", ghlContactId: r.ghl_contact_id ?? "", company: r.company_name ?? "", city: r.city ?? "", state: r.state ?? "", saasUrl: r.saas_url ?? "" });

const projectToRow = (p: Project) => ({ id: p.id, client_id: p.clientId, name: p.name, description: p.description, assigned_to: p.assignedTo ?? [], reviewed_at: p.reviewedAt ?? null, folder_id: p.folderId ?? null, position: p.position ?? 0, share_token: p.shareToken ?? null });
const rowToProject = (r: any): Project => ({ id: r.id, clientId: r.client_id, name: r.name, description: r.description ?? "", assignedTo: r.assigned_to ?? [], reviewedAt: r.reviewed_at ?? null, folderId: r.folder_id ?? null, position: r.position ?? 0, shareToken: r.share_token ?? null });
const folderToRow = (f: Folder) => ({ id: f.id, client_id: f.clientId, name: f.name, position: f.position, created_at: f.createdAt });
const rowToFolder = (r: any): Folder => ({ id: r.id, clientId: r.client_id, name: r.name, position: r.position ?? 0, createdAt: r.created_at });
const stageToRow = (s: Stage) => ({ id: s.id, project_id: s.projectId, name: s.name, position: s.position, is_done: s.isDone, created_at: s.createdAt });
const rowToStage = (r: any): Stage => ({ id: r.id, projectId: r.project_id, name: r.name, position: r.position ?? 0, isDone: r.is_done ?? false, createdAt: r.created_at });

// `updatedBy` is DB-only metadata (Realtime echo-suppression signal) — it is
// not part of the domain Task type, so it's a separate write-time parameter
// rather than a Task field. See src/lib/realtime.ts for how it's consumed.
const taskToRow = (t: Task, updatedBy?: string | null) => ({
  id: t.id, project_id: t.projectId, client_id: t.clientId, title: t.title, description: t.description,
  status: t.status, priority: t.priority, assignee_id: t.assigneeId, waiting_on_client: t.waitingOnClient ?? false, contact_id: t.contactId, due: t.due,
  recurrence: t.recurrence, recurrence_interval: t.recurrenceInterval ?? null, recurrence_unit: t.recurrenceUnit ?? null,
  recurrence_days_of_month: t.recurrenceDaysOfMonth ?? null, follow_up_at: t.followUpAt ?? null, priority_auto: t.priorityAuto ?? false, size: t.size ?? null, recurrence_nth: t.recurrenceNth ?? null, recurrence_weekday: t.recurrenceWeekday ?? null,
  ghl_task_id: t.ghlTaskId, label_ids: t.labelIds, subtasks: t.subtasks,
  attachments: t.attachments, comments: t.comments, updated_by: updatedBy ?? null, is_private: t.private,
  stage_id: t.stageId ?? null, client_response: t.clientResponse ?? null, draft_email: t.draftEmail ?? null,
  playbook_step_key: t.playbookStepKey ?? null, created_by: t.createdBy ?? null, checkin_kind: t.checkinKind ?? null,
  // Derived from checklist-item assignees so RLS can let a delegatee see a
  // task delegated to them even when they don't own it or follow the client.
  delegated_to: [...new Set(t.subtasks.map((s) => s.assigneeId).filter((id): id is string => !!id && id !== t.assigneeId))],
});
// tasks.priority has no DB CHECK constraint (see supabase/schema.sql), so a
// row can in principle carry a stale/legacy value (e.g. a missed migration,
// or a future bug) outside the current Priority union — coerce it to "none"
// here rather than let PRIORITY_META[priority] throw wherever it's indexed.
const asPriority = (p: unknown): Priority => (typeof p === "string" && p in PRIORITY_META ? (p as Priority) : "none");

export const rowToTask = (r: any): Task => ({
  id: r.id, projectId: r.project_id, clientId: r.client_id, title: r.title, description: r.description ?? "",
  status: r.status, priority: asPriority(r.priority), assigneeId: r.assignee_id, waitingOnClient: r.waiting_on_client ?? false, contactId: r.contact_id, due: r.due,
  lastActivityAt: r.last_activity_at ?? null,
  recurrence: r.recurrence, recurrenceInterval: r.recurrence_interval ?? undefined, recurrenceUnit: r.recurrence_unit ?? undefined,
  recurrenceDaysOfMonth: r.recurrence_days_of_month ?? undefined, followUpAt: r.follow_up_at ?? null, priorityAuto: r.priority_auto ?? false, size: r.size ?? null, recurrenceNth: r.recurrence_nth ?? undefined, recurrenceWeekday: r.recurrence_weekday ?? undefined,
  ghlTaskId: r.ghl_task_id, labelIds: r.label_ids ?? [], subtasks: r.subtasks ?? [],
  attachments: r.attachments ?? [], comments: r.comments ?? [], createdAt: r.created_at ?? new Date().toISOString(),
  private: r.is_private ?? false,
  stageId: r.stage_id ?? null,
  clientResponse: r.client_response ?? null,
  draftEmail: r.draft_email ?? null,
  playbookStepKey: r.playbook_step_key ?? null,
  createdBy: r.created_by ?? null,
  checkinKind: r.checkin_kind ?? null,
});

const notifToRow = (n: Notification) => ({ id: n.id, recipient_id: n.recipientId, text: n.text, task_id: n.taskId, actor_id: n.actorId ?? null, client_id: n.clientId ?? null, project_id: n.projectId ?? null, at: n.at, read: n.read, kind: n.kind ?? "activity" });
export const rowToNotif = (r: any): Notification => ({ id: r.id, recipientId: r.recipient_id, text: r.text, taskId: r.task_id, actorId: r.actor_id ?? null, clientId: r.client_id ?? null, projectId: r.project_id ?? null, at: r.at ?? "", read: r.read, kind: r.kind ?? "activity" });

// Free text (link labels, note bodies) — no titleCase, unlike GHL-sourced names.
const clientLinkToRow = (l: ClientLink) => ({ id: l.id, client_id: l.clientId, group_label: l.groupLabel, label: l.label, url: l.url, position: l.position, color: l.color });
const rowToClientLink = (r: any): ClientLink => ({ id: r.id, clientId: r.client_id, groupLabel: r.group_label ?? "", label: r.label, url: r.url, position: r.position ?? 0, color: r.color || "#94a3b8" });

const clientNoteToRow = (n: ClientNote) => ({ id: n.id, client_id: n.clientId, project_id: n.projectId ?? null, type: n.type, body: n.body, author_id: n.authorId, created_at: n.at, attachments: n.attachments ?? [] });
export const rowToClientNote = (r: any): ClientNote => ({ id: r.id, clientId: r.client_id, projectId: r.project_id ?? null, type: (r.type as NoteType) ?? "note", body: r.body ?? "", authorId: r.author_id, at: r.created_at, attachments: r.attachments ?? [] });

const teamMessageToRow = (m: TeamMessage) => ({ id: m.id, author_id: m.authorId, body: m.body, created_at: m.at, reply_to_id: m.replyToId ?? null, attachments: m.attachments ?? [], pinned: m.pinned ?? false, pinned_by: m.pinnedBy ?? null, pinned_at: m.pinnedAt ?? null });
export const rowToTeamMessage = (r: any): TeamMessage => ({ id: r.id, authorId: r.author_id, body: r.body ?? "", at: r.created_at, replyToId: r.reply_to_id ?? null, attachments: r.attachments ?? [], pinned: r.pinned ?? false, pinnedBy: r.pinned_by ?? null, pinnedAt: r.pinned_at ?? null });
const dmMessageToRow = (m: DmMessage) => ({ id: m.id, conversation_id: m.conversationId, author_id: m.authorId, recipient_id: m.recipientId, body: m.body, created_at: m.at, reply_to_id: m.replyToId ?? null, attachments: m.attachments ?? [], pinned: m.pinned ?? false, pinned_by: m.pinnedBy ?? null, pinned_at: m.pinnedAt ?? null });
export const rowToDmMessage = (r: any): DmMessage => ({ id: r.id, conversationId: r.conversation_id, authorId: r.author_id, recipientId: r.recipient_id, body: r.body ?? "", at: r.created_at, replyToId: r.reply_to_id ?? null, attachments: r.attachments ?? [], pinned: r.pinned ?? false, pinnedBy: r.pinned_by ?? null, pinnedAt: r.pinned_at ?? null });

const vaultFolderToRow = (f: VaultFolder) => ({ id: f.id, client_id: f.clientId, project_id: f.projectId, name: f.name, created_at: f.createdAt });
const rowToVaultFolder = (r: any): VaultFolder => ({ id: r.id, clientId: r.client_id, projectId: r.project_id ?? null, name: r.name, createdAt: r.created_at });

const taskTemplateToRow = (t: TaskTemplate) => ({ id: t.id, name: t.name, checklist_items: t.checklistItems });
const rowToTaskTemplate = (r: any): TaskTemplate => ({ id: r.id, name: r.name, checklistItems: r.checklist_items ?? [] });

const playbookToRow = (p: Playbook) => ({ id: p.id, name: p.name, tasks: p.tasks });
const rowToPlaybook = (r: any): Playbook => ({ id: r.id, name: r.name, tasks: r.tasks ?? [] });

const messageToRow = (m: Message) => ({
  id: m.id, contact_id: m.contactId, client_id: m.clientId, task_id: m.taskId ?? null, channel: m.channel, direction: m.direction,
  subject: m.subject, body: m.body, ghl_message_id: m.ghlMessageId, gmail_message_id: m.gmailMessageId ?? null, gmail_thread_id: m.gmailThreadId ?? null, created_by: m.createdBy, read: m.read,
  attachments: m.attachments, cc: m.cc, bcc: m.bcc,
});
const taskActionToRow = (a: TaskAction) => ({
  id: a.id, task_id: a.taskId, kind: a.kind, author_id: a.authorId, body: a.body, at: a.at,
  next_step: a.nextStep, next_step_due: a.nextStepDue, next_step_done_at: a.nextStepDoneAt,
});
export const rowToTaskAction = (r: any): TaskAction => ({
  id: r.id, taskId: r.task_id, kind: r.kind as TaskActionKind, authorId: r.author_id ?? null,
  body: r.body ?? "", at: r.at, nextStep: r.next_step ?? null, nextStepDue: r.next_step_due ?? null,
  nextStepDoneAt: r.next_step_done_at ?? null,
});

export const rowToMessage = (r: any): Message => ({
  id: r.id, contactId: r.contact_id, clientId: r.client_id, taskId: r.task_id ?? null, channel: (r.channel as MessageChannel) ?? "email",
  direction: r.direction as MessageDirection, subject: r.subject ?? null, body: r.body ?? "",
  ghlMessageId: r.ghl_message_id ?? null, gmailMessageId: r.gmail_message_id ?? null, gmailThreadId: r.gmail_thread_id ?? null, createdBy: r.created_by ?? null, at: r.created_at,
  read: r.read ?? true, attachments: r.attachments ?? [], cc: r.cc ?? [], bcc: r.bcc ?? [],
});

// Row shape returned by GET /api/messages/schedule (raw column names, not
// through supabase-js) — same snake->camel mapping idiom as rowToMessage.
export const rowToScheduledMessage = (r: any): ScheduledMessage => ({
  id: r.id, clientId: r.client_id, taskId: r.task_id ?? null, channel: (r.channel as MessageChannel) ?? "email",
  subject: r.subject ?? null, body: r.body ?? "", cc: r.cc ?? [], bcc: r.bcc ?? [], fromEmail: r.from_email ?? null,
  attachments: r.attachments ?? [], scheduledAt: r.scheduled_at, status: (r.status as ScheduledMessageStatus) ?? "pending",
  error: r.error ?? null, createdBy: r.created_by, sentMessageId: r.sent_message_id ?? null, createdAt: r.created_at,
});

// --- load + seed ------------------------------------------------------------

export async function seedIfEmpty(): Promise<void> {
  const { count, error } = await supabase.from("clients").select("*", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) return;
  await supabase.from("clients").insert(clientsSeed.map(clientToRow));
  await supabase.from("contacts").insert(contactsSeed.map(contactToRow));
  await supabase.from("projects").insert(projectsSeed.map(projectToRow));
  // NOT `.map(taskToRow)` directly — Array.map invokes its callback with
  // (element, index, array), and taskToRow's 2nd param is now `updatedBy`,
  // so a bare `.map(taskToRow)` would pass the array index as updatedBy.
  await supabase.from("tasks").insert(seedTasks.map((t) => taskToRow(t)));
  await supabase.from("notifications").insert(seedNotifications.map(notifToRow));
}

// PostgREST caps a single response at 1000 rows (Supabase's default
// db-max-rows) regardless of how many actually match — a plain .select("*")
// silently truncates past that, no error. With 3,500+ contacts (and tasks
// headed the same way once every ClickUpLocal client is migrated in), that
// silently hid ~2,500 contacts from search/add entirely. Pages through with
// .range() until a page comes back short.
// One shared ceiling on how many row-fetches are in the air at once, across
// every table, not per table.
//
// Firing every page at once looked like the fast option and became the reason
// the app stopped loading on 2026-08-13: a single page of tasks runs in about
// 280ms, but fetchAll pages 18 tables concurrently and tasks alone was 29
// pages, so ~45 requests landed together, starved each other, and each one
// then blew the statement timeout. Postgres was never slow; it was being
// asked 45 things at the same instant. A per-table limit would not have fixed
// that, because the fan-out is across tables too.
//
// Six is chosen to keep the wall clock close to the unbounded version (29
// pages over 6 lanes is about 1.4s) while never presenting the database with
// a burst it has to fight itself over.
const MAX_INFLIGHT_ROW_FETCHES = 6;
let inFlight = 0;
const waiting: (() => void)[] = [];
function withSlot<T>(run: () => PromiseLike<T>): Promise<T> {
  const start = async (): Promise<T> => {
    inFlight++;
    try {
      return await run();
    } finally {
      inFlight--;
      // Hand the slot to the next waiter rather than letting everyone wake at
      // once, which would just recreate the stampede one step later.
      waiting.shift()?.();
    }
  };
  if (inFlight < MAX_INFLIGHT_ROW_FETCHES) return start();
  return new Promise<void>((resolve) => waiting.push(resolve)).then(start);
}

// Soft-deleted rows (see soft-delete.sql) stay in clients/projects/tasks for
// 30 days so Trash can restore them — the live app must never see them,
// so every fetch of those three tables passes excludeDeleted.
async function fetchAllRows(table: string, orderCol?: string, ascending = true, excludeDeleted = false) {
  const PAGE_SIZE = 1000;
  // Paging without a deterministic total order is how you silently drop or
  // duplicate rows: Postgres makes no ordering promise between the separate
  // requests, so page 2's offset can land anywhere relative to page 1. An
  // explicit orderCol isn't enough on its own either — created_at ties are
  // common — so always break ties on the primary key.
  const fetchPage = (from: number) => {
    let q = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (excludeDeleted) q = q.is("deleted_at", null);
    if (orderCol) q = q.order(orderCol, { ascending });
    return q.order("id", { ascending: true });
  };
  // A big table (tasks: 28k+ rows as of Aug 2026) used to mean one 1000-row
  // request at a time, sequentially — 29+ round trips end to end just to
  // page through it, easily tens of seconds before the app's very first
  // paint, and it only gets worse as the table grows. Ask for an exact count
  // first (cheap: head:true returns no rows, just the number), then fetch the
  // pages that count says we need concurrently, but through the shared slot
  // limiter above rather than all at once.
  //
  // The count query itself can fail independently of the actual data being
  // fetchable — e.g. an inefficient RLS policy makes a COUNT(*) with
  // per-row auth checks slow enough to hit a statement timeout on a large
  // table, which Supabase reports back as a 503, even though the same table
  // pages through fine via .range(). Treating that as a hard failure meant a
  // single slow COUNT could blank out an entire table's data (and looked
  // exactly like a slow/laggy app, since fetchAll's Promise.all wouldn't
  // resolve any faster than its slowest failing table). A failed count now
  // just falls back to unknown-size paging — fire one page, then let the
  // existing safety-tail loop below keep going until a short page — instead
  // of failing the whole table.
  const { count, error: countError } = await withSlot(() => {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (excludeDeleted) q = q.is("deleted_at", null);
    return q;
  });
  const knownPages = countError ? 1 : Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const firstResults = await Promise.all(
    Array.from({ length: knownPages }, (_, i) => withSlot(() => fetchPage(i * PAGE_SIZE))));
  for (const r of firstResults) if (r.error) return { data: null as any[] | null, error: r.error };
  const all: any[] = firstResults.flatMap((r) => r.data ?? []);
  // Safety tail: the count above can go stale if rows were inserted between
  // it and the page fetches — same termination rule the original
  // sequential-only version always used (keep going while the last page
  // came back completely full), so a table that grew mid-fetch still never
  // silently loses its newest rows. In the overwhelmingly common case
  // (nothing inserted in the ~1 second this all takes) this loop runs zero
  // or one extra time, not dozens.
  let lastPageLen = firstResults[firstResults.length - 1]?.data?.length ?? 0;
  let from = knownPages * PAGE_SIZE;
  while (lastPageLen === PAGE_SIZE) {
    const { data, error } = await withSlot(() => fetchPage(from));
    if (error) return { data: null as any[] | null, error };
    all.push(...(data ?? []));
    lastPageLen = data?.length ?? 0;
    from += PAGE_SIZE;
  }
  return { data: all, error: null as null | { message: string } };
}

export async function fetchAll() {
  const [c, ct, p, t, n, cl, cn, m, tt, vf, fd, um, sg, tm, pb, dm, gu] = await Promise.all([
    fetchAllRows("clients", "created_at", true, true),
    fetchAllRows("contacts"),
    fetchAllRows("projects", undefined, true, true),
    fetchAllRows("tasks", "created_at", true, true),
    fetchAllRows("notifications", "created_at", false),
    // Fetched separately from the hard-fail set below: these tables ship via a
    // manually-run migration (client-links-notes.sql / messages.sql),
    // so a not-yet-run migration must degrade to "nothing yet", not break the app.
    fetchAllRows("client_links", "position"),
    fetchAllRows("client_notes", "created_at", false),
    fetchAllRows("messages", "created_at"),
    fetchAllRows("task_templates", "created_at"),
    fetchAllRows("vault_folders", "created_at"),
    fetchAllRows("folders", "position"),
    fetchAllRows("inbound_unmatched", "created_at", false),
    fetchAllRows("stages", "position"),
    fetchAllRows("team_messages", "created_at", false),
    fetchAllRows("playbooks", "created_at"),
    fetchAllRows("dm_messages", "created_at", false),
    fetchAllRows("granola_unmatched", "created_at", false),
  ]);
  // NB: `projects` stays in the hard-fail set — its new folder_id/position
  // columns are read via `select *`, which tolerates their absence pre-migration
  // (rowToProject defaults them), so we never order projects by position here.
  const err = c.error || ct.error || p.error || t.error || n.error;
  if (err) throw err;
  if (cl.error) console.warn("[db] client_links unavailable — run supabase/client-links-notes.sql", cl.error.message);
  if (cn.error) console.warn("[db] client_notes unavailable — run supabase/client-links-notes.sql", cn.error.message);
  if (m.error) console.warn("[db] messages unavailable — run supabase/messages.sql", m.error.message);
  if (tt.error) console.warn("[db] task_templates unavailable — run supabase/task-templates.sql", tt.error.message);
  if (vf.error) console.warn("[db] vault_folders unavailable — run supabase/vault-folders.sql", vf.error.message);
  if (fd.error) console.warn("[db] folders unavailable — run supabase/folders.sql", fd.error.message);
  if (um.error) console.warn("[db] inbound_unmatched unavailable — run supabase/inbound-unmatched.sql", um.error.message);
  if (sg.error) console.warn("[db] stages unavailable — run supabase/stages.sql", sg.error.message);
  if (tm.error) console.warn("[db] team_messages unavailable — run supabase/team-chat.sql", tm.error.message);
  if (pb.error) console.warn("[db] playbooks unavailable — run supabase/playbooks.sql", pb.error.message);
  if (dm.error) console.warn("[db] dm_messages unavailable — run supabase/dm-chat.sql", dm.error.message);
  if (gu.error) console.warn("[db] granola_unmatched unavailable — run supabase/granola-sync.sql", gu.error.message);
  return {
    clients: (c.data ?? []).map(rowToClient),
    contacts: (ct.data ?? []).map(rowToContact),
    projects: (p.data ?? []).map(rowToProject),
    tasks: (t.data ?? []).map(rowToTask),
    notifications: (n.data ?? []).map(rowToNotif),
    clientLinks: cl.error ? [] : (cl.data ?? []).map(rowToClientLink),
    clientNotes: cn.error ? [] : (cn.data ?? []).map(rowToClientNote),
    messages: m.error ? [] : (m.data ?? []).map(rowToMessage),
    taskTemplates: tt.error ? [] : (tt.data ?? []).map(rowToTaskTemplate),
    vaultFolders: vf.error ? [] : (vf.data ?? []).map(rowToVaultFolder),
    folders: fd.error ? [] : (fd.data ?? []).map(rowToFolder),
    unmatchedEmails: um.error ? [] : (um.data ?? []).filter((r: any) => !r.handled).map(rowToUnmatched),
    stages: sg.error ? [] : (sg.data ?? []).map(rowToStage),
    teamMessages: tm.error ? [] : (tm.data ?? []).map(rowToTeamMessage),
    playbooks: pb.error ? [] : (pb.data ?? []).map(rowToPlaybook),
    dmMessages: dm.error ? [] : (dm.data ?? []).map(rowToDmMessage),
    granolaUnmatched: gu.error ? [] : (gu.data ?? []).filter((r: any) => !r.handled).map(rowToGranolaUnmatched),
  };
}

export const rowToUnmatched = (r: any): UnmatchedEmail => ({ id: r.id, fromEmail: r.from_email ?? "", fromName: r.from_name ?? "", subject: r.subject ?? "", body: r.body ?? "", at: r.at ?? r.created_at ?? "" });
// Acted-on rows are marked handled, not deleted, so a re-poll within the
// 2-day Gmail window can't re-surface them.
export const markUnmatchedHandledDb = (id: string) => supabase.from("inbound_unmatched").update({ handled: true }).eq("id", id).then(logErr);
export async function fetchUnmatchedDb(): Promise<UnmatchedEmail[]> {
  const { data, error } = await supabase.from("inbound_unmatched").select("*").eq("handled", false).order("created_at", { ascending: false });
  return error ? [] : (data ?? []).map(rowToUnmatched);
}

// Twin of rowToUnmatched/markUnmatchedHandledDb/fetchUnmatchedDb for Granola
// meetings whose attendees didn't match a known contact (granola-sync.sql).
export const rowToGranolaUnmatched = (r: any): GranolaUnmatchedMeeting => ({
  id: r.id, granolaNoteId: r.granola_note_id, title: r.title ?? null, attendees: r.attendees ?? [],
  summary: r.summary ?? null, webUrl: r.web_url ?? null, occurredAt: r.occurred_at ?? null, handled: r.handled ?? false,
});
export const markGranolaUnmatchedHandledDb = (id: string) => supabase.from("granola_unmatched").update({ handled: true }).eq("id", id).then(logErr);
export async function fetchGranolaUnmatchedDb(): Promise<GranolaUnmatchedMeeting[]> {
  const { data, error } = await supabase.from("granola_unmatched").select("*").eq("handled", false).order("created_at", { ascending: false });
  return error ? [] : (data ?? []).map(rowToGranolaUnmatched);
}
// Backfills the ledger once an unmatched meeting is manually assigned to a
// client, so it reads the same as one the automatic matcher found.
export const linkGranolaSyncedNoteDb = (granolaNoteId: string, clientId: string, clientNoteId: string) =>
  supabase.from("granola_synced_notes").update({ client_id: clientId, client_note_id: clientNoteId }).eq("granola_note_id", granolaNoteId).then(logErr);

export const upsertContact = (c: Contact) => supabase.from("contacts").upsert(contactToRow(c)).then(logErr);

export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await fetchAllRows("contacts");
  if (error) throw error;
  return (data ?? []).map(rowToContact);
}

// --- mutations (fire-and-forget from the UI; errors surface via console) -----

export const upsertTask = (t: Task, updatedBy?: string | null) => supabase.from("tasks").upsert(taskToRow(t, updatedBy)).then(logErr);
// One request for many new/updated tasks at once — used by reconcilePlaybookTasks
// (up to 18 rows per client) instead of N separate round trips.
export const bulkUpsertTasks = (ts: Task[]) => (ts.length ? supabase.from("tasks").upsert(ts.map((t) => taskToRow(t))).then(logErr) : Promise.resolve());

// Atomic JSONB array-append (see supabase/realtime.sql append_comment) —
// avoids the read-then-full-row-replace race that a plain upsertTask() would
// have if two teammates comment on the same task within the same window.
export const appendCommentDb = (taskId: string, comment: Comment) => supabase.rpc("append_comment", { task_id: taskId, comment }).then(logErr);
// Soft delete — see soft-delete.sql. Sets deleted_at instead of removing the
// row; fetchAll's excludeDeleted filter is what actually hides it from the
// live app. Restored via restoreTaskDb, purged for good after 30 days by
// the /api/cron/purge-trash sweep (trashCleanupServer.ts), or immediately
// via hardDeleteTaskDb from the Trash panel's "Delete forever".
export const deleteTaskDb = (id: string) => supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id).then(logErr);
export const restoreTaskDb = (id: string) => supabase.from("tasks").update({ deleted_at: null }).eq("id", id).then(logErr);
export const hardDeleteTaskDb = (id: string) => supabase.from("tasks").delete().eq("id", id).then(logErr);
export const upsertClient = (c: Client) => supabase.from("clients").upsert(clientToRow(c)).then(logErr);
// Bumped whenever a Playbook step completes (patchTask here; the owner
// toggle route has its own server-side twin) — see playbookLastProgressAt's
// doc comment on Client and playbookCheckinsServer.ts's stall check.
export const touchPlaybookProgress = (clientId: string) => supabase.from("clients").update({ playbook_last_progress_at: new Date().toISOString() }).eq("id", clientId).then(logErr);
// One request for many new clients at once instead of N separate round trips.
export const bulkUpsertClients = (cs: Client[]) => (cs.length ? supabase.from("clients").upsert(cs.map(clientToRow)).then(logErr) : Promise.resolve());
export const upsertProject = (p: Project) => supabase.from("projects").upsert(projectToRow(p)).then(logErr);
// Soft delete, cascading to this project's own not-yet-deleted tasks (parity
// with the old ON DELETE CASCADE — a project's tasks disappear with it, and
// come back with it via restoreProjectDb). See deleteTaskDb's comment.
export const deleteProjectDb = async (id: string) => {
  const deletedAt = new Date().toISOString();
  await supabase.from("tasks").update({ deleted_at: deletedAt }).eq("project_id", id).is("deleted_at", null).then(logErr);
  return supabase.from("projects").update({ deleted_at: deletedAt }).eq("id", id).then(logErr);
};
export const restoreProjectDb = async (id: string) => {
  await supabase.from("tasks").update({ deleted_at: null }).eq("project_id", id).then(logErr);
  return supabase.from("projects").update({ deleted_at: null }).eq("id", id).then(logErr);
};
export const hardDeleteProjectDb = (id: string) => supabase.from("projects").delete().eq("id", id).then(logErr);
// Cascades to this client's own not-yet-deleted projects AND tasks — a
// client's whole tree goes to Trash together and comes back together.
export const deleteClientDb = async (id: string) => {
  const deletedAt = new Date().toISOString();
  await supabase.from("tasks").update({ deleted_at: deletedAt }).eq("client_id", id).is("deleted_at", null).then(logErr);
  await supabase.from("projects").update({ deleted_at: deletedAt }).eq("client_id", id).is("deleted_at", null).then(logErr);
  return supabase.from("clients").update({ deleted_at: deletedAt }).eq("id", id).then(logErr);
};
export const restoreClientDb = async (id: string) => {
  await supabase.from("tasks").update({ deleted_at: null }).eq("client_id", id).then(logErr);
  await supabase.from("projects").update({ deleted_at: null }).eq("client_id", id).then(logErr);
  return supabase.from("clients").update({ deleted_at: null }).eq("id", id).then(logErr);
};
export const hardDeleteClientDb = (id: string) => supabase.from("clients").delete().eq("id", id).then(logErr);

export interface TrashEntry { id: string; name: string; deletedAt: string }
// Trash panel's data source — deliberately not routed through
// rowToTask/rowToProject/rowToClient (which the live app's excludeDeleted
// fetches already cover): this only ever needs an id/name/deletedAt to list
// and act on, not the full row shape.
export async function fetchTrash(): Promise<{ clients: TrashEntry[]; projects: TrashEntry[]; tasks: TrashEntry[] }> {
  const [c, p, t] = await Promise.all([
    supabase.from("clients").select("id,name,deleted_at").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
    supabase.from("projects").select("id,name,deleted_at").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
    supabase.from("tasks").select("id,title,deleted_at").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
  ]);
  const toEntry = (r: { id: string; deleted_at: string; name?: string; title?: string }): TrashEntry =>
    ({ id: r.id, name: r.name ?? r.title ?? "(untitled)", deletedAt: r.deleted_at });
  return {
    clients: (c.data ?? []).map(toEntry),
    projects: (p.data ?? []).map(toEntry),
    tasks: (t.data ?? []).map(toEntry),
  };
}
// The daily 30-day sweep itself runs server-side with the service-role key
// (see trashCleanupServer.ts / /api/cron/purge-trash) — a browser-side bulk
// DELETE across every expired row regardless of owner isn't something the
// anon-key client here should be trusted to do.
// Atomic client merge (see supabase/client-merge.sql) — repoints every table
// off the source client, absorbs its contact-routing identity, deletes the
// source. Awaited (not fire-and-forget) so the caller can refetch on success.
export const mergeClientsDb = (sourceId: string, targetId: string) =>
  supabase.rpc("merge_clients", { source_id: sourceId, target_id: targetId });
export const insertNotif = (n: Notification) => supabase.from("notifications").insert(notifToRow(n)).then(logErr);
export const markNotifsReadDb = (recipientId: string) => supabase.from("notifications").update({ read: true }).eq("recipient_id", recipientId).then(logErr);
export const markNotifReadDb = (id: string) => supabase.from("notifications").update({ read: true }).eq("id", id).then(logErr);
export const upsertClientLink = (l: ClientLink) => supabase.from("client_links").upsert(clientLinkToRow(l)).then(logErr);
export const deleteClientLinkDb = (id: string) => supabase.from("client_links").delete().eq("id", id).then(logErr);
export const upsertClientNote = (n: ClientNote) => supabase.from("client_notes").upsert(clientNoteToRow(n)).then(logErr);

export const upsertTaskTemplate = (t: TaskTemplate) => supabase.from("task_templates").upsert(taskTemplateToRow(t)).then(logErr);
export const deleteTaskTemplateDb = (id: string) => supabase.from("task_templates").delete().eq("id", id).then(logErr);
export const upsertPlaybook = (p: Playbook) => supabase.from("playbooks").upsert(playbookToRow(p)).then(logErr);
export const deletePlaybookDb = (id: string) => supabase.from("playbooks").delete().eq("id", id).then(logErr);
export const deleteClientNoteDb = (id: string) => supabase.from("client_notes").delete().eq("id", id).then(logErr);
export const insertTeamMessage = (m: TeamMessage) => supabase.from("team_messages").insert(teamMessageToRow(m)).then(logErr);
export const deleteTeamMessageDb = (id: string) => supabase.from("team_messages").delete().eq("id", id).then(logErr);
// Narrow patch, not a full-row upsert — pin toggle is the only in-place edit
// a chat message supports (see chat-reply-attachments-pins.sql's update policy).
export const updateTeamMessageDb = (id: string, patch: { pinned: boolean; pinnedBy: string | null; pinnedAt: string | null }) =>
  supabase.from("team_messages").update({ pinned: patch.pinned, pinned_by: patch.pinnedBy, pinned_at: patch.pinnedAt }).eq("id", id).then(logErr);
export const insertDmMessage = (m: DmMessage) => supabase.from("dm_messages").insert(dmMessageToRow(m)).then(logErr);
export const deleteDmMessageDb = (id: string) => supabase.from("dm_messages").delete().eq("id", id).then(logErr);
export const updateDmMessageDb = (id: string, patch: { pinned: boolean; pinnedBy: string | null; pinnedAt: string | null }) =>
  supabase.from("dm_messages").update({ pinned: patch.pinned, pinned_by: patch.pinnedBy, pinned_at: patch.pinnedAt }).eq("id", id).then(logErr);
export const upsertVaultFolder = (f: VaultFolder) => supabase.from("vault_folders").upsert(vaultFolderToRow(f)).then(logErr);
export const deleteVaultFolderDb = (id: string) => supabase.from("vault_folders").delete().eq("id", id).then(logErr);
export const upsertFolder = (f: Folder) => supabase.from("folders").upsert(folderToRow(f)).then(logErr);
export const deleteFolderDb = (id: string) => supabase.from("folders").delete().eq("id", id).then(logErr);
export const upsertStage = (s: Stage) => supabase.from("stages").upsert(stageToRow(s)).then(logErr);
export const deleteStageDb = (id: string) => supabase.from("stages").delete().eq("id", id).then(logErr);
// Messages are insert-once from this call's perspective (never upserted) —
// editing an existing row is a separate, admin-only path (see
// src/app/api/messages/edit/route.ts), not this function. The caller awaits
// the GHL send first (see Cockpit.tsx sendMessage) and only inserts an
// outbound row after a confirmed success; this call itself is still
// fire-and-forget from the UI's perspective, same as every other mutation here.
// Insert-once, like messages: an action records something that already
// happened, so there is nothing to re-save. The single exception is ticking
// its next step done, which is the narrow update below.
export const insertTaskAction = (a: TaskAction) => supabase.from("task_actions").insert(taskActionToRow(a)).then(logErr);
export const setNextStepDoneDb = (id: string, doneAt: string | null) =>
  supabase.from("task_actions").update({ next_step_done_at: doneAt }).eq("id", id).then(logErr);
export const deleteTaskActionDb = (id: string) => supabase.from("task_actions").delete().eq("id", id).then(logErr);
// Loaded per task rather than all at once. Unlike tasks or clients this grows
// without bound and only one task's worth is ever on screen, so pulling the
// whole table into the client at boot would cost more every week.
export const fetchTaskActions = async (taskId: string): Promise<TaskAction[]> => {
  const { data, error } = await supabase.from("task_actions").select("*").eq("task_id", taskId).order("at", { ascending: false });
  if (error) { logErr({ error }); return []; }
  return (data ?? []).map(rowToTaskAction);
};

export const insertMessage = (m: Message) => supabase.from("messages").insert(messageToRow(m)).then(logErr);
// One write per opened conversation, not per message — flips every unread
// inbound row for that contact in a single UPDATE.
export const markMessagesReadDb = (contactId: string) =>
  supabase.from("messages").update({ read: true }).eq("contact_id", contactId).eq("read", false).then(logErr);
// Narrower than markMessagesReadDb above — one task's messages on one
// channel, for the TaskDrawer's per-tab unread dot (Chat/Email/SMS), which
// needs to clear just the tab you opened, not every message for the contact.
export const markTaskChannelReadDb = (taskId: string, channel: MessageChannel) =>
  supabase.from("messages").update({ read: true }).eq("task_id", taskId).eq("channel", channel).eq("read", false).then(logErr);
// Admin-only per messages_delete RLS (see supabase/message-delete-policy.sql)
// — a wrongly sent client-facing email/sms/chat message, not something any
// assignee should be able to erase on their own.
export const deleteMessageDb = (id: string) => supabase.from("messages").delete().eq("id", id).then(logErr);

// Re-scopes every message on a Conversation task to a different task —
// the write side of "merge this conversation into an existing task" (see
// Cockpit.tsx's mergeConversationIntoTask).
export const reassignMessagesTaskDb = (fromTaskId: string, toTaskId: string) =>
  supabase.from("messages").update({ task_id: toTaskId }).eq("task_id", fromTaskId).then(logErr);

// Every upsert/delete above is fire-and-forget from the UI's perspective — this
// is the single choke point where a failed save gets surfaced. Dispatches a
// DOM event rather than importing a toast function so db.ts stays UI-agnostic;
// Cockpit listens once and turns it into a visible toast.
function logErr({ error }: { error: any }) {
  if (error) {
    console.error("[db]", error.message);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("cut:save-error", { detail: error.message }));
  }
}

// --- file storage (Supabase Storage) ----------------------------------------
// Task attachments live in a private `task-files` bucket, keyed by task id.
// Uploads run under the signed-in user; downloads use short-lived signed URLs.
export const TASK_FILES_BUCKET = "task-files";

export async function uploadTaskFile(path: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.storage.from(TASK_FILES_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signedUrlForFile(path: string, expirySeconds = 60 * 10): Promise<string | null> {
  const { data } = await supabase.storage.from(TASK_FILES_BUCKET).createSignedUrl(path, expirySeconds);
  return data?.signedUrl ?? null;
}

// Same signed URL, but with Storage's own `download` option — the response
// comes back with Content-Disposition: attachment, so opening it actually
// saves the file instead of rendering it inline (what happens to any image
// today, and to a PDF in most browsers). Doing this server-side, not with an
// HTML `download` attribute, because that attribute is silently ignored on a
// cross-origin URL like a Supabase signed URL — the browser just navigates
// to it instead.
export async function downloadUrlForFile(path: string, filename: string, expirySeconds = 60 * 10): Promise<string | null> {
  const { data } = await supabase.storage.from(TASK_FILES_BUCKET).createSignedUrl(path, expirySeconds, { download: filename });
  return data?.signedUrl ?? null;
}

export async function deleteTaskFile(path: string): Promise<void> {
  await supabase.storage.from(TASK_FILES_BUCKET).remove([path]).then(logErr);
}

// Shared, admin-controlled app settings (see supabase/app-settings.sql) — a
// small key/value table for on/off switches meant to be the same for the
// whole team, not per-browser (localStorage) or per-user (a profiles
// column). Starts with just "dm_enabled". Fails soft to `fallback` (no error
// toast) if the migration hasn't run yet or the row doesn't exist, so an
// unmigrated environment just keeps today's behavior instead of breaking.
export async function fetchAppSetting(key: string, fallback: boolean): Promise<boolean> {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return !!data.value;
}
export const upsertAppSetting = (key: string, value: boolean) =>
  supabase.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }).then(logErr);
