// ---------------------------------------------------------------------------
// Domain model for the GHL-connected task cockpit.
// Phase 0/prototype: seeded in-memory demo data. In Phase 1 this is backed by
// Supabase; Phase 2-3 sync clients/contacts/tasks with GoHighLevel sub-accounts.
// ---------------------------------------------------------------------------

/** Today's date in the user's local timezone (yyyy-mm-dd). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Evaluated at module load. All date-sensitive UI renders client-side after the
// Supabase fetch resolves, so server/client drift isn't visible in practice.
export const TODAY = todayIso();

/** yyyy-mm-dd for `iso` plus `days` days, via UTC date math to dodge DST. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
export const TOMORROW = addDaysIso(TODAY, 1);
/** yyyy-mm-dd of the Monday on or before `iso` (weeks start Monday) — the
 * anchor for the weekly Review reset: a client reviewed on/after this Monday
 * counts as "reviewed this week" and drops out of the Review tier until next
 * Monday. */
export function mostRecentMonday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun … 1=Mon
  const back = (dow + 6) % 7; // days since the most recent Monday
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}
export const THIS_MONDAY = mostRecentMonday(TODAY);
/** yyyy-mm-dd of the Saturday ending the current calendar week (weeks anchored
 * Sunday, matching the task-list's due grouping) — the boundary for the
 * "Due this week" urgency tier. */
export const THIS_WEEK_END = (() => {
  const [y, m, d] = TODAY.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  return addDaysIso(TODAY, 6 - dow);
})();
/** yyyy-mm-dd of the last day of the current month — the boundary for the
 * "Due this month" urgency tier (day 0 of next month = last day of this one). */
export const THIS_MONTH_END = (() => {
  const [y, m] = TODAY.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
})();
/** Whole days from `a` to `b` (positive if `b` is later) — via UTC date math
 * to dodge DST, matching addDaysIso. Used for bulk "shift all dates forward"
 * style operations, where one date's move determines the delta applied to
 * every other date. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const msPerDay = 86_400_000;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / msPerDay);
}

// Capitalize the first letter of each word (leaves existing caps + numbers
// alone) — GHL-sourced contact/client names commonly arrive all-lowercase.
// Lives here (not db.ts) so server routes can use it without pulling in
// db.ts's browser Supabase client; db.ts re-exports it for existing callers.
export const titleCase = (s: string) => (s || "").replace(/\b([a-z])/g, (m) => m.toUpperCase());

export type Role = "admin" | "va";

/** The logged-in identity, derived from a Supabase auth profile. */
export interface Me {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: Role;
  canSendMessages: boolean; // admins always true; VAs only when an admin grants it
}
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type Priority = "conversation" | "urgent" | "normal" | "none";
export type Recurrence = "none" | "daily" | "weekday" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "custom";
export const RECURRENCE_ORDER: Recurrence[] = ["none", "daily", "weekday", "weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"];
export type RecurrenceUnit = "day" | "week" | "month" | "day-of-month";
/** Parses free-typed "1, 15" style input into a clean, deduped, sorted list
 * of valid calendar days (1-31) — used by the custom-recurrence day-of-month
 * picker, where a comma-separated text field is simplest for entering an
 * arbitrary set of days without a 31-cell calendar-grid widget. */
export function parseDaysOfMonth(s: string): number[] {
  return [...new Set(s.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31))].sort((a, b) => a - b);
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: Role;
  avatarUrl?: string | null;
}

// Full client lifecycle funnel, replacing the earlier active/paused/archived
// set — that couldn't represent anything before "actively engaged" (lead,
// prospect, onboarding) or the difference between cancelling mid-engagement
// vs. simply wrapping up (cancelled vs. past client).
export type ClientStatus = "lead" | "prospect" | "onboarding" | "active_client" | "nurture" | "cancelled" | "past_client";
export const CLIENT_STATUS_META: Record<ClientStatus, { label: string; dot: string }> = {
  lead: { label: "Lead", dot: "#94a3b8" },
  prospect: { label: "Prospect", dot: "#3b82f6" },
  onboarding: { label: "Onboarding", dot: "#a855f7" },
  active_client: { label: "Active Client", dot: "#22c55e" },
  // "Nurture" = a good-standing client with nothing actively due; drives the
  // monthly Review/Check-in cadence (see clientUrgencyKey's review logic) so
  // the relationship doesn't go cold. Added without renaming the others, so
  // existing lead/prospect rows keep their meaning untouched.
  nurture: { label: "Nurture", dot: "#14b8a6" },
  cancelled: { label: "Cancelled", dot: "#ef4444" },
  past_client: { label: "Past Client", dot: "#64748b" },
};
export const CLIENT_STATUS_ORDER: ClientStatus[] = ["lead", "prospect", "onboarding", "active_client", "nurture", "cancelled", "past_client"];
/** How many days between automatic check-ins for a "nurture" client — surfaces
 * them in the Review tier once this long has passed since their last review.
 * Monthly for now (confirmed with Derek/Justin), tunable later. */
export const NURTURE_CHECK_IN_DAYS = 30;
/** `clients.status` is plain text with no DB-level CHECK constraint, so a
 * stored value can in principle predate a funnel change (as happened when
 * this went from active/paused/archived to the 6-stage funnel below) — fall
 * back instead of letting an unrecognized value throw on `.label`/`.dot`. */
export function clientStatusMeta(status: string): { label: string; dot: string } {
  return CLIENT_STATUS_META[status as ClientStatus] ?? { label: status || "Unknown", dot: "#94a3b8" };
}

// Relationship type — separate axis from ClientStatus (which tracks the
// lifecycle of an *active engagement*). A GHL contact you've classified as a
// prospect/past client/vendor gets no sidebar/task presence (see the
// clientList filter in Cockpit.tsx); only 'client' does. The two root
// sub-account markers (c_agency/c_directory) are always 'client'.
export type ClientType = "client" | "prospect" | "past_client" | "vendor";
export const CLIENT_TYPE_META: Record<ClientType, { label: string; color: string }> = {
  client: { label: "Client", color: "#22c55e" },
  prospect: { label: "Prospect", color: "#3b82f6" },
  past_client: { label: "Past client", color: "#94a3b8" },
  vendor: { label: "Vendor", color: "#a855f7" },
};
export const CLIENT_TYPE_ORDER: ClientType[] = ["client", "prospect", "past_client", "vendor"];

/** A GHL sub-account. In our app this is a "Client". */
export interface Client {
  id: string;
  name: string;
  color: string;
  ghlLocationId: string;
  status: ClientStatus;
  type: ClientType;
  /** Roster ids "following" this client — lets a VA see it (and its
   * projects/tasks/links/notes/messages) before they have any task assigned
   * on it, not just an ownership label. */
  assignedTo: string[];
  /** Explicit link to a synced GHL Contact, for clients whose id isn't
   * itself "cl_" + a contact id (e.g. ClickUp-origin imports). When set, it
   * overrides the id-derived contact for Open-in-GHL and task import. */
  linkedContactId?: string | null;
  /** Cached AI relationship summary (Gemini) — regenerated on demand from
   * the AI tab, never automatically, so opening a task never spends money. */
  aiSummary?: string | null;
  aiSummaryAt?: string | null;
  /** Roster ids of VAs explicitly granted permission to send email/SMS as
   * this client (on top of profiles.can_send_messages, which must also be
   * true). NOT a visibility grant, unlike assignedTo — purely gates
   * /api/ghl/message. Optional (unlike assignedTo) so existing clientsSeed
   * literals don't need editing; treat as `?? []` everywhere it's read. */
  canMessage?: string[];
  /** A personal "check in on this again" reminder date, independent of any
   * task's due date — lets a client stay a real urgency signal (sidebar
   * sort, My Work) even when none of its tasks carry a due date. Plain ISO
   * string, matching tasks.due's exact type/comparison semantics. */
  followUpAt?: string | null;
  /** yyyy-mm-dd of the last time this client was reviewed — powers the
   * weekly/monthly Review tier reset (see clientUrgencyKey). */
  reviewedAt?: string | null;
}

/** A quick-access link on a client's page (live site, WP admin, etc.), stored
 * in its own `client_links` table so ordering/grouping can be edited freely. */
export interface ClientLink {
  id: string;
  clientId: string;
  groupLabel: string; // "" = ungrouped
  label: string;
  url: string;
  position: number;
  color: string;
}

// A fixed, visually-distinct palette for quick links — assigned at random on
// creation so a client's link bar reads at a glance instead of every chip
// looking identical, and re-pickable from the same set via a color selector.
export const LINK_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#d946ef", "#ec4899",
];
export const randomLinkColor = () => LINK_COLORS[Math.floor(Math.random() * LINK_COLORS.length)];

// Streamlined from an earlier 6-type set (meeting/content/contact/
// deliverable/note/ai_summary) — with the Journal now auto-capturing
// messages and task completions, the only real gap for a manually-written
// note is "things nothing else tracks," which these three cover without
// the ambiguity of the old set (nobody was ever sure whether something was
// "Content" or "Deliverable"). ai_summary stays as a system-only type (see
// MANUAL_NOTE_TYPES below), still written automatically by regenerateAiSummary.
export type NoteType = "meeting" | "decision" | "note" | "ai_summary";
export const NOTE_TYPE_META: Record<NoteType, { label: string; color: string }> = {
  meeting: { label: "Meeting", color: "#3b82f6" },
  decision: { label: "Decision", color: "#f59e0b" },
  note: { label: "Note", color: "#94a3b8" },
  ai_summary: { label: "AI Summary", color: "#8b5cf6" },
};
export const NOTE_TYPE_ORDER: NoteType[] = ["meeting", "decision", "note", "ai_summary"];
// Types offered when composing a new note — excludes ai_summary, which is
// only ever written by the AI-summary regenerate flow, not chosen by hand.
export const MANUAL_NOTE_TYPES: NoteType[] = ["meeting", "decision", "note"];
// Safe accessor for a note's display meta: historical notes tagged with a
// now-retired type (content/contact/deliverable, from before this
// streamline) fall back to Note's styling instead of crashing — no data
// migration needed to retire old types, they just stop being offered going
// forward and render as "Note" from here on.
export function noteTypeMeta(type: string): { label: string; color: string } {
  return NOTE_TYPE_META[type as NoteType] ?? NOTE_TYPE_META.note;
}

/** A freeform, typed log entry on a client — a shared wiki/log, not a task
 * comment thread. Lives in its own `client_notes` table so a VA can be
 * granted write access to their own notes without touching client metadata. */
export interface ClientNote {
  id: string;
  clientId: string;
  projectId?: string | null; // set = scoped to one project's Chat tab; unset = client-wide
  type: NoteType;
  body: string;
  authorId: string | null;
  at: string; // ISO
  attachments?: Attachment[]; // images pasted/attached into the chat message
}

/** A GHL contact inside a sub-account. Tasks link to one of these. */
export interface Contact {
  id: string;
  clientId: string;
  name: string;
  email: string;
  phone?: string; // GHL phone — shown as the SMS send target in the task drawer
  ghlContactId: string;
  company?: string; // GHL companyName — shown alongside the name in search
  city?: string; // GHL address fields — power the territory dashboard's city/state match
  state?: string;
}

/** A city+state assigned to one ambassador (existing team member) for the
 * territory dashboard. "Claimed" vs "unclaimed" contacts within a territory
 * are derived at query time (does a `clients` row already exist for this
 * contact?) rather than stored here — reuses the existing client status
 * funnel instead of a second, parallel pipeline state. */
export interface Territory {
  id: string;
  name: string;
  city: string;
  state: string;
  assignedTo: string[]; // roster ids of the assigned ambassadors (one or more; [] = unassigned)
}

// A reusable checklist, applied either to quick-populate a new task (title
// defaults to the template name) or to append the checklist onto an
// existing task's subtasks.
export interface TaskTemplate {
  id: string;
  name: string;
  checklistItems: string[];
}

// GHL contacts store state inconsistently — full name ("California"), abbreviation
// ("CA"), or mixed case ("Ca") all show up for the same state in practice. Territory
// matching needs both sides normalized to the 2-letter form or a typed "CA" silently
// misses every contact GHL returned as "California".
const US_STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
export function normalizeState(state: string): string {
  const s = state.trim().toLowerCase();
  return (US_STATE_ABBR[s] ?? state.trim()).toUpperCase();
}

export type MessageChannel = "email" | "sms";
export type MessageDirection = "outbound" | "inbound";

/** A single email/SMS with a Contact, sent or received via GoHighLevel's
 * Conversations API. Belongs to the Contact first — a contact can have many
 * tasks, and the conversation is with the person — but is also optionally
 * scoped to the one Task it's most associated with via taskId (set when
 * composed from a task, or when it's an inbound reply matched to that
 * contact's open Conversation task), which is what the task drawer's
 * Activity feed filters by. Outbound rows are inserted by the client right
 * after a successful send; inbound rows are inserted by the GHL webhook
 * (src/app/api/ghl/webhook/route.ts) using the service-role client, so they
 * bypass RLS like the existing task-sync path. */
export interface Message {
  id: string;
  contactId: string;
  clientId: string;
  /** Null for client-level Chat-tab sends (no task context) and for
   * historical rows inserted before this field existed — never backfilled,
   * see supabase/message-task-scope.sql. */
  taskId?: string | null;
  channel: MessageChannel;
  direction: MessageDirection;
  subject: string | null;
  body: string;
  ghlMessageId: string | null;
  /** Gmail message id when this email was sent through Google Workspace (the
   * per-teammate "from" path) rather than GHL — see supabase/gmail-message-id.sql
   * and src/lib/googleMail.ts. Null for GHL sends and inbound rows. */
  gmailMessageId?: string | null;
  createdBy: string | null; // roster id for outbound; null for inbound
  at: string; // ISO
  /** Shared team-wide, not per-user (one flag per message). Outbound rows are
   * inserted already read; inbound rows start unread until someone opens that
   * conversation — see the Conversations inbox in Cockpit.tsx. */
  read: boolean;
  attachments: Attachment[];
  cc: string[];  // email addresses — email channel only
  bcc: string[];
}

/** An inbound email pulled from Gmail whose sender isn't a known contact —
 * parked for triage in the Inbox so the team can read it and either add the
 * sender as a client or dismiss it. Deleted once acted on. */
export interface UnmatchedEmail {
  id: string;        // the Gmail message id
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
  at: string;        // ISO timestamp
}

/** A Folder groups Lists (projects) within a space (client or workspace).
 * Folder → List → Task. A project with folderId === null is a standalone
 * list. GHL has no concept of this — it's our own organizing layer. */
export interface Folder {
  id: string;
  clientId: string;
  name: string;
  position: number;
  createdAt: string;
}

/** Our own grouping layer — GHL has no concept of this. A Project holds tasks
 * directly, so it IS a "List"; it optionally sits inside a Folder. */
export interface Project {
  id: string;
  clientId: string;
  name: string;
  description: string;
  /** Folder this list belongs to, or null/undefined = standalone list. */
  folderId?: string | null;
  /** Sort position within its folder bucket (or the standalone bucket). */
  position?: number;
  /** Roster ids "following" this project — same concept as Client.assignedTo,
   * scoped to just this project rather than the whole client. Drives the
   * "My Work" tab's assigned-or-following filter; not an RLS/visibility
   * change (a project's own client-level following already covers that). */
  assignedTo?: string[];
  /** Same concept as Client.followUpAt, scoped to just this project — kept
   * fully independent (no rollup into the parent client's urgency). */
  followUpAt?: string | null;
  /** Last-reviewed date (yyyy-mm-dd) for the weekly Review tier. */
  reviewedAt?: string | null;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Attachment {
  id: string;
  name: string;
  kind: "pdf" | "image" | "doc" | "sheet" | "link";
  size: string;
  path?: string; // Supabase Storage object path; absent = metadata-only (not stored)
  url?: string; // for kind "link" — a drive/website URL rather than a stored file
  /** Which Vault folder this attachment has been filed into, if any — see
   * VaultFolder. Unset = "Unfiled". Purely organizational, doesn't move the
   * underlying file; the attachment still lives on whichever task/comment/
   * note it was originally attached to. */
  folderId?: string;
}

/** A named group in the Vault tab for organizing a client's photos/files.
 * Client-scoped (visible across all of that client's projects) — projectId
 * is reserved for future narrowing, unused in v1. */
export interface VaultFolder {
  id: string;
  clientId: string;
  projectId: string | null;
  name: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  authorId: string;
  body: string;
  at: string;
  /** "event" = system-logged field change (status/assignee/due/priority), rendered
   * as a compact line in the Activity feed instead of a chat bubble; excluded from
   * comment counts. Absent/"comment" = a real user comment. */
  kind?: "comment" | "event";
  attachments?: Attachment[]; // images pasted/attached into the comment
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  assigneeId?: string | null;
  due?: string | null; // ISO yyyy-mm-dd
  /** Delegation instructions — what the assignee is being asked to do. Only
   * meaningful when assigneeId is set (an assigned checklist item = a
   * delegation of one step of the parent task). */
  note?: string;
}

export interface Task {
  id: string;
  projectId: string;
  clientId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  /** "Assigned to the client" — we're waiting on the client for this, so it's
   * not a team member's action item. Set from the assignee picker; when true
   * the row shows a "Waiting on client" pill and the task drops out of anyone's
   * My Work (it still shows on the client's own task list and keeps the client
   * visible on the Dashboard). */
  waitingOnClient?: boolean;
  contactId: string | null;
  due: string | null; // ISO yyyy-mm-dd
  recurrence: Recurrence;
  /** Only meaningful when recurrence === "custom" — "every N days/weeks/months". */
  recurrenceInterval?: number;
  recurrenceUnit?: RecurrenceUnit;
  /** Only meaningful when recurrence === "custom" && recurrenceUnit === "day-of-month"
   * — recur on these specific calendar days each month (e.g. [1, 15]) instead
   * of "every N units". recurrenceInterval is ignored in this mode. */
  recurrenceDaysOfMonth?: number[];
  labelIds: string[];
  ghlTaskId: string | null;
  /** A private task is visible only to its own assignee, enforced by RLS —
   * not even admins can see one. Always lives under the shared "Personal"
   * pseudo-client/project (see PERSONAL_CLIENT_ID) rather than a real GHL
   * contact, so it never has anything to sync or show up in client views. */
  private: boolean;
  subtasks: Subtask[];
  attachments: Attachment[];
  comments: Comment[];
  createdAt: string; // ISO — set by the DB; never overwritten on upsert
  /** Custom Kanban column (see Stage below), or null/undefined for a project
   * with no custom stages defined — those keep today's fixed status board. */
  stageId?: string | null;
}

/** A custom Kanban-style column for one project's own task board (e.g.
 * "Backlog / Designing / In Review / Shipped") — layered ON TOP OF the
 * existing status funnel (todo/in_progress/review/done), not a replacement:
 * isDone syncs a task's status when it moves in/out of a stage flagged
 * done, so urgency scoring, GHL sync, MCP, recurrence-on-complete, and
 * completion detection (isCompletionEvent) all keep working unmodified. A
 * project with no stages defined just keeps the fixed 4-column board. */
export interface Stage {
  id: string;
  projectId: string;
  name: string;
  position: number;
  isDone: boolean;
  createdAt: string;
}

// A single shared client/project pair every private task lives under —
// deliberately not "cl_"-prefixed, so it's automatically excluded from the
// client sidebar, "My Clients", and "All tasks" (all of which filter on that
// prefix). RLS is what actually keeps a private task hidden from everyone
// but its assignee, regardless of the fact this id is shared across users.
export const PERSONAL_CLIENT_ID = "personal";
export const PERSONAL_PROJECT_ID = "personal_project";
// Contact-less container for internal/agency work — its projects are
// standalone "lists" with no GHL contact, so they never sync. Shown as its
// own sidebar section above Clients, not in the client list.
export const WORKSPACE_CLIENT_ID = "cl_workspace";

export const STATUS_META: Record<TaskStatus, { label: string; dot: string; chip: string }> = {
  todo: { label: "To do", dot: "#94a3b8", chip: "#f1f5f9" },
  in_progress: { label: "In progress", dot: "#3b82f6", chip: "#eff6ff" },
  review: { label: "Review", dot: "#f59e0b", chip: "#fffbeb" },
  done: { label: "Done", dot: "#22c55e", chip: "#f0fdf4" },
};
export const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "done"];

// Parses describeFieldChange's (Cockpit.tsx) event strings into a structured
// before/after pair — used by TaskDrawer's Activity diff cards and by the
// Client Journal feed's completion detection, without a schema change:
// events are still stored as plain text in task.comments, this just
// recognizes the handful of phrasings that function produces. Anything that
// doesn't match (e.g. future event copy) falls back to null.
export function parseEventDiff(body: string): { field: string; from: string | null; to: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /^changed (.+?) from (.+) to (.+)$/.exec(body))) return { field: m[1], from: m[2], to: m[3] };
  if ((m = /^reassigned from (.+) to (.+)$/.exec(body))) return { field: "assignee", from: m[1], to: m[2] };
  if ((m = /^assigned to (.+)$/.exec(body))) return { field: "assignee", from: null, to: m[1] };
  if ((m = /^unassigned \(was (.+)\)$/.exec(body))) return { field: "assignee", from: m[1], to: "Unassigned" };
  if ((m = /^set due date to (.+)$/.exec(body))) return { field: "due date", from: null, to: m[1] };
  if ((m = /^cleared the due date \(was (.+)\)$/.exec(body))) return { field: "due date", from: m[1], to: "No date" };
  return null;
}
export function isCompletionEvent(body: string): boolean {
  const d = parseEventDiff(body);
  return d?.field === "status" && d.to === STATUS_META.done.label;
}

// The "conversation" value (label shown as "Interaction" — a message, call,
// or meeting, not just a text thread) is auto-created only (an open GHL
// inbound message/call, or an upcoming synced appointment) — it's excluded
// from the manual priority pickers unless it's already the task's current
// value, see GroupedList/TaskDrawer. It always ranks above Urgent so live
// client activity surfaces before anything else. The underlying value stays
// "conversation" (not renamed) — it's load-bearing across the DB, the MCP
// tool schema, and the Python importer; only the display label changed.
export const PRIORITY_META: Record<Priority, { label: string; color: string; rank: number }> = {
  conversation: { label: "Interaction", color: "#8b5cf6", rank: 3 },
  urgent: { label: "Urgent", color: "#ef4444", rank: 2 },
  normal: { label: "Normal", color: "#3b82f6", rank: 1 },
  none: { label: "No priority", color: "#cbd5e1", rank: 0 },
};
export const PRIORITY_ORDER: Priority[] = ["conversation", "urgent", "normal", "none"];

// Single source of truth for "conversation is auto-assigned only" — used by
// every manual priority-setting surface (pickers, quick-add, drag-and-drop)
// so a future one can't forget the guard.
export const isManuallyAssignable = (p: Priority): boolean => p !== "conversation";
// A priority picker's option list: every manually-assignable tier, plus the
// current value even if it's Conversation (so an existing auto-created task
// can still show/reselect its own tier, just not switch *into* it).
export const manualPriorityOptions = (current: Priority): Priority[] =>
  PRIORITY_ORDER.filter((p) => isManuallyAssignable(p) || p === current);

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: "Does not repeat",
  daily: "Every day",
  weekday: "Every weekday",
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
  custom: "Custom…",
};
// "day-of-month" never reaches this table (describeRecurrence branches on it
// before UNIT_LABEL is consulted) — present only so the Record type is total.
const UNIT_LABEL: Record<RecurrenceUnit, [string, string]> = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"], "day-of-month": ["day", "days"] };
// RECURRENCE_LABEL's "custom" entry is just the picker option text — this
// resolves the actual "every N units" wording once a task's interval/unit
// are set, for display in the drawer and list row.
export function describeRecurrence(rec: Recurrence, interval?: number, unit?: RecurrenceUnit, daysOfMonth?: number[]): string {
  if (rec !== "custom") return RECURRENCE_LABEL[rec];
  if (unit === "day-of-month") {
    const days = daysOfMonth ?? [];
    if (days.length === 0) return "Monthly on selected day(s)";
    return `Monthly on the ${days.map(ordinal).join(", ")}`;
  }
  const n = interval && interval > 0 ? interval : 1;
  const u = unit ?? "week";
  const [sing, plur] = UNIT_LABEL[u];
  return n === 1 ? `Every ${sing}` : `Every ${n} ${plur}`;
}

// --- Team -------------------------------------------------------------------

// The live roster. Starts with just the founder; replaced at app load with the
// real signed-up team from the `profiles` table (see setUsers/Cockpit). The
// array is mutated in place so every module holding a reference sees updates.
export const users: User[] = [
  { id: "u_derek", name: "Derek Fox", initials: "DF", color: "#a855f7", role: "admin" },
  { id: "u_claude", name: "Claude", initials: "AI", color: "#f97316", role: "va" },
];
// Synthetic, non-account roster entries (currently just Claude, the MCP
// server's identity for notes/comments it posts) — never a real Supabase
// auth user, so setUsers() below must keep it across every real-roster
// refresh instead of letting the fetched profiles list wipe it out.
const PROTECTED_USER_IDS = new Set(["u_claude"]);

export function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Replace the roster with the real team (from profiles). */
export function setUsers(list: User[]) {
  if (list.length === 0) return; // keep the founder fallback if fetch fails
  const preserved = users.filter((u) => PROTECTED_USER_IDS.has(u.id) && !list.some((l) => l.id === u.id));
  users.splice(0, users.length, ...list, ...preserved);
}

// --- Labels -----------------------------------------------------------------

export const labels: Label[] = [
  { id: "l_design", name: "design", color: "#8b5cf6" },
  { id: "l_copy", name: "copy", color: "#0ea5e9" },
  { id: "l_dev", name: "dev", color: "#14b8a6" },
  { id: "l_waiting", name: "waiting on client", color: "#f59e0b" },
  { id: "l_content", name: "content", color: "#ec4899" },
];

// --- Clients (GHL sub-accounts) --------------------------------------------

export const clientsSeed: Client[] = [
  { id: "c_bright", name: "Bright Dental", color: "#0ea5e9", ghlLocationId: "loc_8f21ac", status: "active_client", type: "client", assignedTo: [] },
  { id: "c_peak", name: "Peak Fitness Co.", color: "#f59e0b", ghlLocationId: "loc_2b77de", status: "active_client", type: "client", assignedTo: [] },
  { id: "c_harbor", name: "Harbor Law Group", color: "#8b5cf6", ghlLocationId: "loc_5c09fb", status: "active_client", type: "client", assignedTo: [] },
];

// --- Contacts (GHL contacts) -----------------------------------------------

export const contactsSeed: Contact[] = [
  { id: "ct_1", clientId: "c_bright", name: "Dr. Nina Patel", email: "nina@brightdental.com", ghlContactId: "ghl_ct_1" },
  { id: "ct_2", clientId: "c_bright", name: "Front Desk — Robin", email: "robin@brightdental.com", ghlContactId: "ghl_ct_2" },
  { id: "ct_3", clientId: "c_peak", name: "Marcus Lee", email: "marcus@peakfitness.co", ghlContactId: "ghl_ct_3" },
  { id: "ct_4", clientId: "c_peak", name: "Sasha Kim", email: "sasha@peakfitness.co", ghlContactId: "ghl_ct_4" },
  { id: "ct_5", clientId: "c_harbor", name: "Paul Grant", email: "paul@harborlaw.com", ghlContactId: "ghl_ct_5" },
  { id: "ct_6", clientId: "c_harbor", name: "Intake — Lydia", email: "intake@harborlaw.com", ghlContactId: "ghl_ct_6" },
];

// --- Projects (our grouping layer) -----------------------------------------

export const projectsSeed: Project[] = [
  { id: "p_bright_onboard", clientId: "c_bright", name: "New Patient Funnel", description: "Landing page + intake automation" },
  { id: "p_bright_reviews", clientId: "c_bright", name: "Reviews & Reputation", description: "Google review request campaign" },
  { id: "p_peak_launch", clientId: "c_peak", name: "Summer Challenge Launch", description: "6-week challenge promo + signups" },
  { id: "p_harbor_intake", clientId: "c_harbor", name: "Intake Automation", description: "Case intake workflow + follow-up" },
];

// --- Tasks ------------------------------------------------------------------

export const seedTasks: Task[] = [
  {
    id: "t_1",
    private: false,
    createdAt: TODAY,
    projectId: "p_bright_onboard",
    clientId: "c_bright",
    title: "Build new-patient landing page",
    description: "Draft copy, hero image, and the GHL form embed for the new patient offer. Match brand colors from the style guide.",
    status: "in_progress",
    priority: "urgent",
    assigneeId: "u_maria",
    contactId: "ct_1",
    due: "2026-07-10",
    recurrence: "none",
    labelIds: ["l_design", "l_copy"],
    ghlTaskId: "ghl_tsk_9a1",
    subtasks: [
      { id: "s_1", title: "Write hero headline", done: true },
      { id: "s_2", title: "Pick hero image", done: true },
      { id: "s_3", title: "Embed GHL intake form", done: false },
      { id: "s_4", title: "Mobile QA", done: false },
    ],
    attachments: [
      { id: "a_1", name: "brand-style-guide.pdf", kind: "pdf", size: "2.4 MB" },
      { id: "a_2", name: "hero-mockup.png", kind: "image", size: "880 KB" },
    ],
    comments: [
      { id: "cm_1", authorId: "u_derek", body: "Nina wants the $99 exam offer front and center.", at: "2d ago" },
      { id: "cm_2", authorId: "u_maria", body: "On it — first draft up by tomorrow.", at: "1d ago" },
    ],
  },
  {
    id: "t_2",
    private: false,
    createdAt: TODAY,
    projectId: "p_bright_onboard",
    clientId: "c_bright",
    title: "Wire intake form → GHL automation",
    description: "Connect the form submission to the new-patient workflow so contacts get tagged and enter the nurture sequence.",
    status: "todo",
    priority: "normal",
    assigneeId: "u_james",
    contactId: "ct_2",
    due: "2026-07-12",
    recurrence: "none",
    labelIds: ["l_dev"],
    ghlTaskId: null,
    subtasks: [],
    attachments: [],
    comments: [],
  },
  {
    id: "t_3",
    private: false,
    createdAt: TODAY,
    projectId: "p_bright_reviews",
    clientId: "c_bright",
    title: "Set up review request SMS",
    description: "Draft the review-request text and schedule it to fire 3 days post-appointment.",
    status: "review",
    priority: "normal",
    assigneeId: "u_maria",
    contactId: "ct_1",
    due: "2026-07-09",
    recurrence: "weekly",
    labelIds: ["l_copy", "l_content"],
    ghlTaskId: "ghl_tsk_4c2",
    subtasks: [
      { id: "s_5", title: "Draft SMS copy", done: true },
      { id: "s_6", title: "Set 3-day delay trigger", done: false },
    ],
    attachments: [{ id: "a_3", name: "review-copy.doc", kind: "doc", size: "44 KB" }],
    comments: [{ id: "cm_3", authorId: "u_derek", body: "Keep it warm, not salesy.", at: "5h ago" }],
  },
  {
    id: "t_4",
    private: false,
    createdAt: TODAY,
    projectId: "p_peak_launch",
    clientId: "c_peak",
    title: "Design challenge signup page",
    description: "6-week summer challenge — signup page with countdown and price tiers.",
    status: "in_progress",
    priority: "urgent",
    assigneeId: "u_ana",
    contactId: "ct_3",
    due: "2026-07-06",
    recurrence: "none",
    labelIds: ["l_design"],
    ghlTaskId: "ghl_tsk_7d3",
    subtasks: [
      { id: "s_7", title: "Countdown timer", done: true },
      { id: "s_8", title: "3-tier pricing block", done: true },
      { id: "s_9", title: "Connect signup to GHL", done: false },
    ],
    attachments: [{ id: "a_4", name: "pricing-tiers.sheet", kind: "sheet", size: "18 KB" }],
    comments: [{ id: "cm_4", authorId: "u_ana", body: "Marcus approved the 3-tier pricing.", at: "6h ago" }],
  },
  {
    id: "t_5",
    private: false,
    createdAt: TODAY,
    projectId: "p_peak_launch",
    clientId: "c_peak",
    title: "Build email nurture (5 emails)",
    description: "Pre-launch nurture sequence for the challenge waitlist.",
    status: "todo",
    priority: "normal",
    assigneeId: "u_maria",
    contactId: "ct_4",
    due: "2026-07-15",
    recurrence: "none",
    labelIds: ["l_copy"],
    ghlTaskId: null,
    subtasks: [],
    attachments: [],
    comments: [],
  },
  {
    id: "t_6",
    private: false,
    createdAt: TODAY,
    projectId: "p_harbor_intake",
    clientId: "c_harbor",
    title: "Map intake questions to custom fields",
    description: "Turn the paper intake form into GHL custom fields and a clean intake workflow.",
    status: "done",
    priority: "normal",
    assigneeId: "u_james",
    contactId: "ct_6",
    due: "2026-07-03",
    recurrence: "none",
    labelIds: ["l_dev"],
    ghlTaskId: "ghl_tsk_1e4",
    subtasks: [
      { id: "s_10", title: "List all intake fields", done: true },
      { id: "s_11", title: "Create custom fields in GHL", done: true },
    ],
    attachments: [{ id: "a_5", name: "intake-form.pdf", kind: "pdf", size: "1.1 MB" }],
    comments: [{ id: "cm_5", authorId: "u_james", body: "Done — 22 fields mapped, Paul reviewed.", at: "3d ago" }],
  },
  {
    id: "t_7",
    private: false,
    createdAt: TODAY,
    projectId: "p_harbor_intake",
    clientId: "c_harbor",
    title: "Build 48-hour follow-up sequence",
    description: "If a lead doesn't book a consult within 48h, trigger a follow-up call task + SMS.",
    status: "in_progress",
    priority: "urgent",
    assigneeId: "u_james",
    contactId: "ct_5",
    due: "2026-07-13",
    recurrence: "none",
    labelIds: ["l_dev", "l_waiting"],
    ghlTaskId: "ghl_tsk_6f5",
    subtasks: [],
    attachments: [],
    comments: [{ id: "cm_6", authorId: "u_derek", body: "Paul is picky about tone — keep it professional.", at: "1d ago" }],
  },
];

// --- Date helpers -----------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDue(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}
export function isOverdue(iso: string | null): boolean {
  return !!iso && iso < TODAY;
}

/** "2m ago" / "3h ago" / "4d ago" from an ISO timestamp. Non-ISO input (legacy
 *  seeded strings like "just now") is returned unchanged. */
export function timeAgo(at: string): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return at;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

/** Converts stored rich-text HTML (task.description) to a plain-text
 *  approximation for consumers that can't render markup — the GHL task
 *  sync body and the "Copy for Claude" brief. Browser-only (real DOM text
 *  extraction beats a regex); server-side callers get a best-effort tag
 *  strip instead. Never appended to the document, so this carries no XSS
 *  risk despite using innerHTML — it's read-only text extraction. */
export function htmlToText(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("p, li, h1, h2, h3, blockquote, br").forEach((el) => el.after(document.createTextNode("\n")));
  return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

export type ClientHealth = "danger" | "stale" | "calm";
export const HEALTH_META: Record<ClientHealth, { label: string; dot: string }> = {
  danger: { label: "Overdue work", dot: "#ef4444" },
  stale: { label: "No recent activity", dot: "#f59e0b" },
  calm: { label: "On track", dot: "#22c55e" },
};

/** Auto-derived, never stored: danger if anything overdue, stale if the
 * client's tasks have had no activity (creation or a comment/event) in 30+
 * days, calm otherwise. "Activity" already includes the kind:"event" entries
 * patchTask logs on every status/assignee/due/priority change. */
export function clientHealth(clientId: string, tasks: Task[]): ClientHealth {
  const ts = tasks.filter((t) => t.clientId === clientId);
  if (ts.some((t) => t.status !== "done" && isOverdue(t.due))) return "danger";
  if (ts.length === 0) return "calm";
  const signals = ts.flatMap((t) => [Date.parse(t.createdAt), ...t.comments.map((c) => Date.parse(c.at))]).filter((n) => !Number.isNaN(n));
  const last = signals.length ? Math.max(...signals) : -Infinity;
  return (Date.now() - last) / 86_400_000 > 30 ? "stale" : "calm";
}

// Last valid day of the given UTC year/month (0-indexed month), for clamping
// a target day-of-month that doesn't exist in a shorter month (e.g. day 31
// requested against February).
function lastDayOfUtcMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
/** Advance an ISO due date by one recurrence step (deterministic — no now()). */
export function advanceDue(iso: string | null, rec: Recurrence, interval?: number, unit?: RecurrenceUnit, daysOfMonth?: number[]): string | null {
  if (!iso || rec === "none") return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (rec === "daily") dt.setUTCDate(dt.getUTCDate() + 1);
  else if (rec === "weekday") { do { dt.setUTCDate(dt.getUTCDate() + 1); } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6); }
  else if (rec === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (rec === "biweekly") dt.setUTCDate(dt.getUTCDate() + 14);
  else if (rec === "monthly") dt.setUTCMonth(dt.getUTCMonth() + 1);
  else if (rec === "quarterly") dt.setUTCMonth(dt.getUTCMonth() + 3);
  else if (rec === "yearly") dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else if (rec === "custom" && unit === "day-of-month") {
    const days = [...new Set((daysOfMonth ?? []).filter((n) => n >= 1 && n <= 31))].sort((a, b) => a - b);
    if (days.length === 0) { dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() + 1); }
    else {
      const next = days.find((day) => day > dt.getUTCDate());
      if (next !== undefined) {
        dt.setUTCDate(Math.min(next, lastDayOfUtcMonth(dt.getUTCFullYear(), dt.getUTCMonth())));
      } else {
        // Reset to day 1 before advancing the month — otherwise a stale
        // day-of-month near 31 can overflow setUTCMonth into the WRONG
        // target month (e.g. Jan 31 + 1 month silently becomes March, not
        // February), which then throws off the clamp below too.
        dt.setUTCDate(1);
        dt.setUTCMonth(dt.getUTCMonth() + 1);
        dt.setUTCDate(Math.min(days[0], lastDayOfUtcMonth(dt.getUTCFullYear(), dt.getUTCMonth())));
      }
    }
  }
  else if (rec === "custom") {
    const n = interval && interval > 0 ? interval : 1;
    const u = unit ?? "week";
    if (u === "day") dt.setUTCDate(dt.getUTCDate() + n);
    else if (u === "week") dt.setUTCDate(dt.getUTCDate() + n * 7);
    else dt.setUTCMonth(dt.getUTCMonth() + n);
  }
  return dt.toISOString().slice(0, 10);
}

// --- Notifications ----------------------------------------------------------

/** "message" — a direct human communication (an @mention or comment someone
 * wrote to you). "activity" — an automatic side-effect notice from normal
 * task work (assignment, status/due-date change, checklist completion).
 * Lets the Inbox filter the two apart; missing on older rows, treated as
 * "activity" (the more common case) via `?? "activity"` wherever read. */
export type NotificationKind = "message" | "activity";
export interface Notification {
  id: string;
  recipientId: string;
  text: string;
  taskId: string | null;
  actorId?: string | null; // who triggered it — powers the Inbox sender avatar
  clientId?: string | null; // set on notifications with no taskId (e.g. chat mentions), so Inbox can still deep-link somewhere
  projectId?: string | null;
  at: string;
  read: boolean;
  kind?: NotificationKind;
}

export const seedNotifications: Notification[] = [
  { id: "n_1", recipientId: "u_derek", text: "Maria Santos commented on “Build new-patient landing page”", taskId: "t_1", at: "1d ago", read: false },
  { id: "n_2", recipientId: "u_derek", text: "James Okoro completed “Map intake questions to custom fields”", taskId: "t_6", at: "3d ago", read: true },
];

/** One message in the workspace-wide Team Chat — internal team talk that
 * isn't tied to any client or project (see supabase/team-chat.sql). Deliberately
 * not modeled on ClientNote/Message: no clientId/projectId, no channel, no
 * attachments in v1 — a plain flat feed for "who's covering X today"-style talk. */
export interface TeamMessage {
  id: string;
  authorId: string;
  body: string;
  at: string;
}

// --- Lookups (bound at runtime to live state via the helpers below) ---------

export const userById = (id: string | null) => users.find((u) => u.id === id) ?? null;
export const labelById = (id: string) => labels.find((l) => l.id === id) ?? null;
