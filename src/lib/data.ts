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
// Skips weekends. "Check back in 3 days" from a Thursday lands on a Sunday,
// which is not a day anyone checks anything, so the client gets an extra two
// days of silence and the task sits in Sunday's bucket looking overdue by
// Monday morning.
export function addBusinessDaysIso(iso: string, days: number): string {
  let out = iso;
  let left = days;
  while (left > 0) {
    out = addDaysIso(out, 1);
    const dow = new Date(`${out}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return out;
}

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
/** yyyy-mm-dd of the Saturday ending next calendar week — one week past
 * THIS_WEEK_END — the boundary for the "Due next week" urgency tier. */
export const NEXT_WEEK_END = addDaysIso(THIS_WEEK_END, 7);
/** yyyy-mm-dd of the last day of the current month — the boundary for the
 * "Due this month" urgency tier (day 0 of next month = last day of this one). */
export const THIS_MONTH_END = (() => {
  const [y, m] = TODAY.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
})();
/** The urgency buckets a dated row falls into, used by My Work's task list
 * (Cockpit.tsx buildGroups) so "what needs me today" reads consistently.
 * Order is the render order; "month" sits between next week and later so a
 * longer-dated follow-up still lands somewhere meaningful instead of all-of-it in
 * "Later." */
export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "nextWeek" | "month" | "later" | "none";
export const DUE_BUCKETS: { key: DueBucket; label: string; color: string }[] = [
  { key: "overdue", label: "Overdue", color: "#ef4444" },
  { key: "today", label: "Today", color: "#f59e0b" },
  { key: "tomorrow", label: "Tomorrow", color: "#eab308" },
  { key: "week", label: "This week", color: "#3b82f6" },
  { key: "nextWeek", label: "Next week", color: "#6366f1" },
  { key: "month", label: "This month", color: "#8b5cf6" },
  { key: "later", label: "Later", color: "#94a3b8" },
  { key: "none", label: "No date", color: "#cbd5e1" },
];
// Buckets that start collapsed when a list is grouped by due date. Overdue,
// Today, Tomorrow and This week are the horizon you act on; everything past
// that is reference you open when you want it, and left expanded it buried
// the near stuff under a hundred rows of "No date" (Derek: "close by default
// next week, later and no date, leave today, tomorrow, this week open").
export const COLLAPSED_DUE_BUCKETS: ReadonlySet<string> = new Set(["nextWeek", "month", "later", "none"]);

/** Which bucket a yyyy-mm-dd date falls into, relative to TODAY. `isDone`
 * suppresses the overdue bucket — a finished task that happened to be late
 * isn't something that still needs doing. */
export function dueBucketOf(due: string | null | undefined, isDone = false): DueBucket {
  if (!due) return "none";
  if (due < TODAY && !isDone) return "overdue";
  if (due === TODAY) return "today";
  if (due === TOMORROW) return "tomorrow";
  if (due <= THIS_WEEK_END) return "week";
  if (due <= NEXT_WEEK_END) return "nextWeek";
  if (due <= THIS_MONTH_END) return "month";
  return "later";
}

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

// First letter of the first two words ("Amanda Standley" -> "AS"), or the
// first two characters of a one-word name — same shape as a User's own
// `initials` field, just derived on the fly since Client has no such field
// (258 GHL-sourced names, not worth hand-maintaining).
export function clientInitials(name: string): string {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

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
export type TaskStatus = "todo" | "get_started" | "in_progress" | "review" | "changes_requested" | "waiting" | "approved" | "done";
export type Priority = "client_request" | "conversation" | "urgent" | "normal" | "none";
export type Recurrence = "none" | "daily" | "weekday" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "custom";
export const RECURRENCE_ORDER: Recurrence[] = ["none", "daily", "weekday", "weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"];
export type RecurrenceUnit = "day" | "week" | "month" | "day-of-month" | "nth-weekday";
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
// interview captures the pitch (Aug 3 Derek/Justin call): a phone/Zoom
// interview doubles as verification, then an in-person follow-up finalizes
// the profile before onboarding starts — one stage covers both, the two
// steps live as checklist detail underneath it, not as separate stages.
export type ClientStatus = "claimed" | "interview" | "onboarding" | "active_client" | "nurture" | "cancelled" | "past_client";
export const CLIENT_STATUS_META: Record<ClientStatus, { label: string; dot: string }> = {
  // Lead and Prospect used to be separate stages here, but nothing in the
  // app ever treated them differently and they don't correspond to any real
  // step in moving a business through the pipeline — merged into one
  // (Derek, Aug 4). Matches the Businesses page's own "Claimed" funnel-stage
  // key exactly, so it no longer needs a lead/prospect special case.
  claimed: { label: "Claimed", dot: "#94a3b8" },
  interview: { label: "Interview", dot: "#06b6d4" },
  onboarding: { label: "Listing Launch", dot: "#a855f7" },
  active_client: { label: "Active Client", dot: "#22c55e" },
  // "Nurture" = a good-standing client with nothing actively due; drives the
  // monthly Review/Check-in cadence (see clientUrgencyKey's review logic) so
  // the relationship doesn't go cold. Added without renaming the others, so
  // existing lead/prospect rows keep their meaning untouched.
  nurture: { label: "Nurture", dot: "#14b8a6" },
  cancelled: { label: "Cancelled", dot: "#ef4444" },
  past_client: { label: "Past Client", dot: "#64748b" },
};
export const CLIENT_STATUS_ORDER: ClientStatus[] = ["claimed", "interview", "onboarding", "active_client", "nurture", "cancelled", "past_client"];
/** How many days between automatic check-ins for a "nurture" client — surfaces
 * them in the Review tier once this long has passed since their last review.
 * Monthly for now (confirmed with Derek/Justin), tunable later. */
export const NURTURE_CHECK_IN_DAYS = 30;
/** How many days without a Sales/Playbook step completing before a business
 * counts as "stalled" — the Playbook stall-check cron
 * (playbookCheckinsServer.ts) and the Businesses page's Priority sort both
 * read this single constant, so the daily nudge and the dashboard's ranking
 * always agree on what "stuck" means. */
export const STEP_STALL_DAYS = 14;
// A Conversation task's priority, read straight off its own title rather
// than a second signal-type field nobody would keep in sync with it — every
// engagement signal names exactly what happened (see upsertConversationTask's
// callers across the webhook/sync-appointments routes). Read by
// ghlConversationTask.ts to decide whether a
// later, stronger signal should upgrade an already-open task's title —
// without this shared source of truth, a business that opened an invite
// email and later claimed their listing would keep showing "Opened the
// invite email" forever, since bumping an open task only ever touched its
// due date). First matching pattern wins; ordered highest value (closest to
// closing) to lowest (barely engaged). Derek, 2026-08-09: "open would be the
// least valuable, claimed or booked would be the most."
export const CONVERSATION_SIGNAL_RANK: { test: RegExp; rank: number }[] = [
  { test: /Claimed their listing/, rank: 10 }, // the strongest signal on the ladder — a real conversion
  { test: /^Meeting with/, rank: 10 }, // booked an appointment
  { test: /^Reply to /, rank: 9 }, // a real inbound message/call — they're talking to us right now
  { test: /Approved being featured/, rank: 9 }, // already claimed, said yes
  { test: /Nearly booked/, rank: 9 }, // answered every question, one click from picking a time
  { test: /Answered the invite questions/, rank: 8 }, // finished the interview chat
  { test: /Submitted info from the invite/, rank: 7 }, // completed the claim funnel, needs a verification call
  { test: /didn't finish, follow up/, rank: 6 }, // started the interview chat but dropped off early (info/questions only)
  { test: /Clicked interested on the invite/, rank: 5 },
  { test: /Clicked the invite email/, rank: 4 },
  { test: /Opened the invite email/, rank: 2 }, // the least valuable signal — merely opened, hasn't acted
];
export function conversationSignalRank(title: string | null | undefined): number {
  if (!title) return 0;
  return CONVERSATION_SIGNAL_RANK.find((s) => s.test.test(title))?.rank ?? 5; // unrecognized title = treat as mid-value
}
/** How long a newly won business's trial runs, in days — the window that
 * opens the moment the deal actually closes (card on file), and the source
 * of Client.trialEndsAt. One constant so the length is changed in one
 * place if the offer ever changes. */
export const TRIAL_DAYS = 14;
/** `clients.status` is plain text with no DB-level CHECK constraint, so a
 * stored value can in principle predate a funnel change (as happened when
 * this went from active/paused/archived to the 6-stage funnel below, and
 * again when lead/prospect merged into claimed) — fall back instead of
 * letting an unrecognized value throw on `.label`/`.dot`. Old rows still
 * literally storing "lead"/"prospect" map straight to Claimed rather than
 * falling through to the generic Unknown fallback. */
export function clientStatusMeta(status: string): { label: string; dot: string } {
  if (status === "lead" || status === "prospect") return CLIENT_STATUS_META.claimed;
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
  /** Every OTHER contact whose future inbound should route to this client —
   * accumulated when duplicate clients are merged in (a business that lived in
   * both the agency and directory GHL sub-accounts). Also the "this client is
   * in more than one account" marker. Optional/`?? []` everywhere it's read. */
  linkedContactIds?: string[];
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
  /** yyyy-mm-dd of the last time this client was reviewed — powers the
   * weekly/monthly Review tier reset (see clientUrgencyKey). */
  reviewedAt?: string | null;
  /** Last time a Playbook (Owner Growth Plan) step was completed for this
   * client, by either the owner (toggle webhook) or the team (patchTask) —
   * lets the daily stall-check cron (playbookCheckinsServer.ts) tell "quiet
   * because it's done" apart from "quiet because it's stuck." */
  playbookLastProgressAt?: string | null;
  /** Unguessable token backing this client's public "what we're waiting on
   * you for" page (/waiting/[token], see supabase/client-share-token.sql) —
   * lazily generated the first time "Copy client link" is clicked, then
   * reused (not a login credential, so it's fine to store retrievably —
   * more like a Google Docs share link than an API key). Grants read-only
   * visibility into that one client's open waitingOnClient tasks only. */
  shareToken?: string | null;
  /** Whether this client may raise brand-new tasks from that public page's
   * "Add Something" composer (see /api/waiting/[token]/request), as opposed
   * to only replying on work we already put in front of them. Off unless an
   * admin turns it on, so the open request box is something we hand out
   * deliberately rather than the default for everyone holding a link. The
   * request route re-checks this server-side — hiding the button is the
   * courtesy, the column is the gate. Optional (like canMessage) so existing
   * clientsSeed literals don't need editing; read as `=== true` everywhere. */
  canRequestNewTasks?: boolean;
  /** Whether this business is inside its 14-day trial, and the day that
   * window closes. Deliberately a SEPARATE axis from `status`: status is a
   * fulfillment stage (where the work has got to), while this is a sales
   * moment (the deal actually closed, card on file, clock running). Before
   * this existed a won-but-still-in-trial business and a long-settled one
   * were indistinguishable, because "onboarding"/"active_client" only ever
   * described delivery. Set once, at the transition that promotes a prospect
   * onto the roster (see setClientStatus in Cockpit.tsx) — never re-stamped
   * by a later save, so the window can't silently slide forward.
   * trialEndsAt is a plain ISO date string, same type/comparison semantics as
   * tasks.due. */
  inTrial?: boolean;
  trialEndsAt?: string | null;
  /** Whether this business actually does SMS marketing, which is what gates
   * creating the A2P registration steps and the dedicated email domain step
   * at all (see reconcilePlaybookTasks). Plenty of businesses never text
   * their list, and handing every one of them five setup tasks they'll never
   * do buries the steps that matter. Off unless someone says otherwise, so
   * the extra work is opted into rather than issued by default. Optional
   * (like canMessage) so existing clientsSeed literals don't need editing;
   * read as `=== true` everywhere. */
  doesA2P?: boolean;
  /** Whether the public /waiting/[token] page shows the "Your growth plan"
   * progress card at all. Off unless an admin turns it on — not every client
   * should see internal Playbook framing on their link, so this is opted in
   * per client rather than shown by default. Optional (like canMessage) so
   * existing clientsSeed literals don't need editing; read as `=== true`
   * everywhere. */
  showGrowthPlan?: boolean;
  /** Portal shows every non-private task on the account, not just the ones
   *  waiting on the client. Off by default — see supabase/portal-all-tasks.sql. */
  portalShowsAllTasks?: boolean;
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
  /** Mirrored from the GoHighLevel contact custom field "SaaS"
   *  (fieldKey contact.saas). Cached so a list can show it without a GHL
   *  round trip per row; GoHighLevel stays the source of truth. */
  saasUrl?: string;
}

// A reusable checklist, applied either to quick-populate a new task (title
// defaults to the template name) or to append the checklist onto an
// existing task's subtasks.
export interface TaskTemplate {
  id: string;
  name: string;
  checklistItems: string[];
}

// A playbook is several separate tasks loaded onto a client at once — e.g.
// "Prospect" (a first-touch sequence) or "Claimed" (an onboarding kickoff
// list) — distinct from TaskTemplate above, which populates one task's own
// checklist. Loaded manually today ("Load…" in Settings); the plan is to
// eventually trigger a playbook automatically when a client enters a given
// stage, but that trigger doesn't exist yet — this is the authoring +
// manual-load half only.
export interface PlaybookTask {
  title: string;
  /** Days from when the playbook is loaded; null/omitted = no due date. */
  dueOffsetDays?: number | null;
  priority?: Priority;
}
export interface Playbook {
  id: string;
  name: string;
  tasks: PlaybookTask[];
}

// The Owner Growth Plan — a fixed, code-defined 18-step journey every
// business works through (claim listing → ... → paid ads), grouped into 6
// phases. Order matters: playbookCompletion()'s "next" step is just the
// first one in this array a business hasn't finished. NOT the same thing as
// Playbook/PlaybookTask above (an admin-authored, reusable task-bundle
// template) — this catalog is the single source of truth for the *content*
// (label/phase/order) of each step; reconcilePlaybookTasks() (Cockpit.tsx)
// keeps every client's real Task rows (Task.playbookStepKey) in sync with
// whatever's defined here, so editing a step's wording here is the only way
// it ever changes — no client ever has its own frozen copy. Content mirrors
// THE-OWNER-GROWTH-PLAN-DRAFT.md's step order, except the "package" phase
// (interview_chat/claim_listing/blog_written/posted_on_social/newsletter_spotlight)
// prepended 2026-08-04, which supersedes the old Sales checklist rather than
// coming from that doc — see Business Journal/2026-08.md, Aug 4 entry.
export type PlaybookPhase = { key: string; label: string };
export const PLAYBOOK_PHASES: PlaybookPhase[] = [
  // The canonical sales pipeline (SALES_STAGE_STEPS below), rendered first
  // because it's how a business arrives, not optional side work — hence a
  // real entry here rather than the standalone-PlaybookPhase treatment the
  // A2P/email-domain/ongoing side quests get. Its steps deliberately live in
  // their own catalog and NOT in PLAYBOOK_STEPS: the growth plan's "X of 25"
  // is a real owner-facing number for owner work, and a rep's pipeline
  // stages aren't owner work. See SALES_STAGE_STEPS for the full reasoning.
  { key: "sales", label: "Win the business" },
  { key: "package", label: "Your free marketing package" },
  { key: "map", label: "Get on the map" },
  { key: "reputation", label: "Jumpstart your reputation" },
  { key: "list", label: "Build your list" },
  { key: "everywhere", label: "Be everywhere they look" },
  { key: "campaigns", label: "Campaign Builder" },
  { key: "grow", label: "Grow & compound" },
];
export type ScoreImpact = "low" | "medium" | "high"; // ⚡ / ⚡⚡ / ⚡⚡⚡ in the source doc
/** All content beyond key/phase/label is pure reference material for the
 * read-only guide panel in TaskDrawer.tsx (gated on Task.playbookStepKey,
 * looked up via PLAYBOOK_STEP_BY_KEY below) — never stored on the Task row,
 * so it can't drift per client and needs no reconciliation when the wording
 * changes here. commonMistake/weGive/youGet are optional, not empty strings,
 * where the source doc genuinely doesn't call one out for that step. */
export type PlaybookStepDef = {
  key: string; phase: string; label: string;
  timeEstimate: string;
  whyItMatters: string;
  howTo: string[];
  commonMistake?: string;
  weGive?: string;
  youGet?: string;
  scoreImpact: ScoreImpact;
  /** Created with recurrence: "monthly" instead of "none" (reconcilePlaybookTasks) —
   * for standing ambassador duties (the monthly report), not one-time owner actions. */
  recurring?: boolean;
  /** Which of the 4 owner-facing dashboard progress bars this counts toward
   * (branding/reputation/presence/income) — orthogonal to phase, which is
   * the internal ambassador ordering. Read by playbookCompletionByCategory(). */
  category: "branding" | "reputation" | "presence" | "income";
};
export const PLAYBOOK_STEPS: PlaybookStepDef[] = [
  {
    key: "interview_chat", phase: "package", label: "Complete the interview chat", category: "branding",
    timeEstimate: "~10 min",
    whyItMatters: "This is where we get to know your business: how you started, what you're known for, what's coming up. Everything else in your free package, the blog post, the social posts, the newsletter spotlight, gets written from your real answers instead of a generic template.",
    howTo: [
      "Answer the chat's questions.",
      "Book your short phone interview at the end so we can go deeper live.",
      "Review and prepare for the interview — here's what we'll ask: how the business got started, what makes it different, your favorite product or service, any community involvement or sponsorships, what's new or coming up, and anything else you want customers to know.",
    ],
    commonMistake: "Rushing through with one word answers. The more specific you are, the better your blog post and spotlight turn out.",
    weGive: "We turn your answers into a written blog post, social posts, and a newsletter spotlight, no extra work from you.",
    youGet: "Real content about your business, written for you, from a 15-minute conversation.",
    scoreImpact: "medium",
  },
  {
    key: "attend_interview", phase: "package", label: "Attend your Business Interview", category: "branding",
    timeEstimate: "~15 min",
    whyItMatters: "This is the live conversation that turns your written answers into a real story — we go deeper than the chat can on its own, and it's where we confirm the details that make your article and social posts sound like you, not a form.",
    howTo: [
      "Book a time that works after you finish the interview chat.",
      "Be ready to talk for about 15 minutes — no extra prep needed beyond finishing the chat.",
      "We'll ask about how the business started, what makes it different, and what's new or coming up.",
    ],
    commonMistake: "Skipping this because the chat felt like enough. The phone call is where the best quotes and details usually come out.",
    weGive: "A real conversation with someone who's going to write about your business.",
    youGet: "A better, more personal article and social posts, straight from your own voice.",
    scoreImpact: "medium",
  },
  {
    key: "claim_listing", phase: "package", label: "Claim Your ClickUpLocal Listing", category: "presence",
    timeEstimate: "~5 min",
    whyItMatters: "Claiming is free and unlocks your My Business dashboard, where everything else lives. Your Score was already calculated when we built your profile — claiming lets you access the marketing tools to improve it.",
    howTo: [
      "Find your business (or add it if it's not there) using one of the options below.",
      "Search for your business at clickuplocal.com, open your listing, and click \"Claim this business, it's free.\"",
      "Or go to clickuplocal.com/businesses and click \"Claim My Free Listing.\"",
      "Follow the quick steps to confirm you're the owner.",
    ],
    commonMistake: "Thinking you have to pay to claim — you don't. Free gets you a verified listing, Google Business Profile setup, and automated review requests at no cost.",
    weGive: "We unlock your dashboard and stamp you as a verified local owner.",
    youGet: "Your business dashboard, unlocked and ready to go.",
    scoreImpact: "low",
  },
  {
    key: "blog_written", phase: "package", label: "Custom Article Written About Your Business", category: "branding",
    timeEstimate: "Done for you",
    whyItMatters: "A real article about your business gives you a piece of content you can point people to, and it's one more page that helps you get found.",
    howTo: [
      "Nothing to do here — we write it from your interview and other information to tell your business's story.",
      "Once it's live we'll send it to you to review and share.",
    ],
    weGive: "A custom-written article about your business, published on the ClickUpLocal site and shared to the community through social media and our weekly newsletter.",
    youGet: "Free content you can share on your own site and socials.",
    scoreImpact: "low",
  },
  {
    key: "posted_on_social", phase: "package", label: "Posted on ClickUpLocal social", category: "branding",
    timeEstimate: "Done for you",
    whyItMatters: "Gets your business in front of the ClickUpLocal audience on social media, not just the directory.",
    howTo: [
      "Nothing to do here — we post it for you using your blog post and photos.",
    ],
    weGive: "A social post about your business on our channels.",
    youGet: "Free exposure to residents who follow us on social.",
    scoreImpact: "low",
  },
  {
    key: "newsletter_spotlight", phase: "package", label: "Featured in the newsletter spotlight", category: "presence",
    timeEstimate: "Done for you",
    whyItMatters: "The newsletter goes straight to residents' inboxes — the spotlight is the single most visible placement in it.",
    howTo: [
      "Nothing to do here — we queue you for the next available spotlight.",
    ],
    weGive: "A featured spotlight write up in the weekly newsletter.",
    youGet: "Direct visibility to every resident on the list.",
    scoreImpact: "medium",
  },
  {
    // Was three separate steps (upload_photos, complete_listing,
    // add_social_links) — combined 2026-08-09 per Derek: uploading photos and
    // adding social links are part of completing the listing, not their own
    // errands. Kept the complete_listing key (not a new one) so any client
    // that already has that task in progress just gets retitled, not
    // duplicated. reconcilePlaybookTasks never deletes orphaned rows, so a
    // client who already finished upload_photos/add_social_links separately
    // keeps those two done tasks sitting inert — harmless, just no longer
    // counted — while this combined step tracks completion going forward.
    key: "complete_listing", phase: "map", label: "Complete business listing", category: "branding",
    timeEstimate: "~15 min (logo, photos, details, and socials in one pass)",
    whyItMatters: "A complete page with great photos gets found more, ranks higher, and just looks good. It'll also give a little boost to your Score.",
    howTo: [
      "Log in to your ClickUpLocal.com Business: Dashboard → My Business → Manage Listing.",
      "Add your logo and 5–10 photos (storefront, inside, your products, your team — show off!).",
      "Fill in every box: name, category, description, services, hours, phone, website, address.",
      "Drop in your social media links.",
      "Save it and admire your handiwork.",
    ],
    commonMistake: "Leaving it half-empty with no photos. A blank page is a closed door. A full, friendly one is a \"come on in!\"",
    weGive: "We polish your page so it shows up in Google and AI search, and your Score keeps climbing from here.",
    youGet: "A listing that looks alive, gets found, and gets chosen.",
    scoreImpact: "high",
  },
  {
    key: "first_offer", phase: "map", label: "Create an offer they can't scroll past", category: "income",
    timeEstimate: "~10 min",
    whyItMatters: "An offer is what turns a browser into a customer walking through your door, and every time someone claims one, you get a new customer's info to keep. The best news is we'll promote your offer with you. Not a discount person? Totally fine — your offer can be a freebie, a bonus, an upgrade, a bundle, priority booking, or a VIP perk. The only rule: make it good enough that a local sees it and goes \"ooh, I want that.\" A meh offer gets ignored, a juicy one fills your shop.",
    howTo: [
      "Log in to your business on ClickUpLocal.com: Dashboard → My Business.",
      "Go to Offers → Create Offer.",
      "Stuck for ideas? Tap the offer helper — it suggests offers that fit your kind of business.",
      "Give it a punchy title, add any fine print, and set an end date (residents get 14 days to redeem after claiming).",
      "Hit Publish, then set a \"comeback\" offer to pull them back for round two.",
    ],
    commonMistake: "Too small to matter, or so big it hurts. Get someone off the couch, but make it pencil out.",
    weGive: "We push your offer to residents, put it in the newsletter, on social, and in the app. Every redemption auto-adds a new contact to your list.",
    youGet: "Foot traffic now + a new owned customer per redemption.",
    scoreImpact: "medium",
  },
  {
    key: "add_events", phase: "map", label: "Add Your Events", category: "income",
    timeEstimate: "~5 min each",
    whyItMatters: "Class, tasting, live music, big sale, workshop? Add it! Events give people a reason to come in right now — and we can spin any of them into ready-made marketing later.",
    howTo: [
      "Log in to your business on ClickUpLocal.com: Dashboard → My Business.",
      "Go to Events → Add Event.",
      "Add the event title, date/time, a short description, and a photo.",
      "Publish — and load in all your upcoming events while you're here.",
    ],
    weGive: "We promote your events in the directory, newsletter, and social, and let you turn any event into a full campaign later.",
    youGet: "More reasons for residents to show up, promoted for you.",
    scoreImpact: "low",
  },
  {
    key: "connect_gbp", phase: "reputation", label: "Connect Google Business Profile", category: "reputation",
    timeEstimate: "~5 min",
    whyItMatters: "Google is where customer reviews matter most, and where we suggest you ask new and existing customers to leave you a review. Nothing else in reputation works until this is connected.",
    howTo: [
      "Log in to the Reputation Manager at ClickUpLocal.com: Dashboard → My Business → Reputation.",
      "Click Settings → Integrations.",
      "Click Google Business Profile → Connect.",
      "Sign in with the account that owns/manages your Google Business Profile listing → Allow.",
      "Make sure it says Connected.",
    ],
    commonMistake: "Signing in with the wrong Google account — it must own/manage the Google Business Profile listing. No Google page yet? No sweat, we'll help you start one, just reach out.",
    weGive: "We get everything ready to auto-reply to your reviews — even the ancient ones.",
    youGet: "The connection that powers your whole reputation engine.",
    scoreImpact: "medium",
  },
  {
    key: "review_engine", phase: "reputation", label: "Turn on your review engine", category: "reputation",
    timeEstimate: "~10 min",
    whyItMatters: "This is the magic switch. Reviews start coming in on their own, and our AI replies to each one sounding just like you. Reviews are the #1 thing people check before choosing a local business, and responding to every review, good and bad, signals you care, builds trust, and lifts your Google ranking. (Industry research puts each extra Google star at roughly 5–9% more revenue.) Doing this by hand is a grind — this automates all of it.",
    howTo: [
      "Review link: in Reputation → Settings, pick Google Business Profile (already connected — nothing to paste).",
      "Turn on review requests by text and email, add a review QR code for your counter, and flip on the spam filter.",
      "Reviews AI: choose Auto Responses so replies send themselves, and add a short wait time so they feel human.",
      "Catch up on old reviews: find \"Respond to Reviews – Drip Mode\" → Create a New Campaign. Name it, choose how far back to go, set Daily, and pick a chill pace (like 10 a day). Pick your helper → Create.",
    ],
    commonMistake: "Replies-per-day too high on the requests side. Keep that number low — a steady drip looks way more genuine than 200 replies at 3pm on a Tuesday.",
    weGive: "We keep reviews coming and reply to every new one and every old one automatically, in your voice, around the clock. Want us to just set the whole thing up for you? Say the word.",
    youGet: "A reputation that works 24/7 without you touching it.",
    scoreImpact: "high",
  },
  {
    key: "ai_respond_past_reviews", phase: "reputation", label: "Turn on AI responses to past reviews", category: "reputation",
    timeEstimate: "~3 min",
    whyItMatters: "A separate, one-time action from turning on requests for new reviews — this responds to every review your business already has, so nothing from before you joined sits unanswered.",
    howTo: [
      "Under \"Respond to Reviews – Drip Mode,\" click + Create a New Campaign.",
      "Name it, set the review date range (how far back), Frequency: Daily, and a natural replies-per-day pace (e.g. 10/day).",
      "Optional time window (e.g. 9–5 local), select an AI Agent, and Create Drip Campaign.",
    ],
    commonMistake: "Assuming turning on the review engine already covers this — it doesn't. Skipping this step leaves every past review unanswered.",
    weGive: "We respond to every past review automatically, in your voice, at a natural pace.",
    youGet: "A clean slate — nothing left unanswered from before you joined.",
    scoreImpact: "medium",
  },
  {
    key: "first_review_request", phase: "reputation", label: "Send first review request", category: "reputation",
    timeEstimate: "~2 min",
    whyItMatters: "A quick way to prove the review engine actually works before you rely on it for everyone. To text, you first need a business number with A2P completed (see the A2P side quest) — email works right away.",
    howTo: [
      "Go to Reputation → Requests → Send a request.",
      "Enter a happy customer's name + phone (or email).",
      "Click Send.",
    ],
    commonMistake: "Sending to someone who wasn't thrilled — pick a customer who loves you.",
    weGive: "We auto-respond to the review the moment it lands and notify you.",
    youGet: "Proof the engine works, immediately.",
    scoreImpact: "low",
  },
  {
    key: "reviews_widget", phase: "reputation", label: "Add reviews widget to website", category: "reputation",
    timeEstimate: "~5 min",
    whyItMatters: "Fresh reviews on your own site are social proof right where people decide — and they update themselves.",
    howTo: [
      "Go to Reputation → Widgets.",
      "Pick a reviews widget.",
      "Copy the embed onto your site (or we place it on your Smart Website).",
    ],
    weGive: "We keep it updating automatically as new reviews land.",
    youGet: "Your best reviews selling for you on every page.",
    scoreImpact: "low",
  },
  {
    key: "import_contacts", phase: "list", label: "Import contacts", category: "income",
    timeEstimate: "~10 min (established shortcut: your biggest instant win — you already have the list)",
    whyItMatters: "The people who already know you are your cheapest, highest-converting customers — but you can only market to the ones whose name, phone, and email you own. A big owned list is free marketing forever that no platform can take.",
    howTo: [
      "Export your customers (POS, email tool, phone) to a CSV.",
      "Delete every column except three: name, phone, email (extra columns cause errors — the #1 fix).",
      "Format phones with country code (+1 + 10 digits).",
      "Go to Contacts → Import, upload, map columns, Import, and confirm the count.",
    ],
    commonMistake: "Leaving extra columns in the CSV beyond name, phone, and email — the #1 cause of import errors.",
    weGive: "We send your \"You're on ClickUpLocal\" launch announcement to your whole list — from you — driving them to your offer.",
    youGet: "Your existing customers reactivated on day one.",
    scoreImpact: "medium",
  },
  {
    key: "ongoing_capture", phase: "list", label: "Set up ongoing capture (QR/table tents)", category: "income",
    timeEstimate: "Varies",
    whyItMatters: "This is the joint marketing effort between you and ClickUpLocal — you capture the customer in person, we market to them forever after.",
    howTo: [
      "Use our built-in QR code creator to make a code that points to your ClickUpLocal offer.",
      "Put it on table tents, counter signs, receipts, your window, WiFi login — anywhere a customer is in front of you.",
      "Point it at your ClickUpLocal offer (not just \"follow us\") — everyone who claims it lands in your list and rides along with our ongoing town marketing.",
    ],
    weGive: "We wire every claimed offer to auto-add the contact and market to them on repeat.",
    youGet: "To never lose a customer's name + number again.",
    scoreImpact: "medium",
  },
  {
    key: "smart_website", phase: "everywhere", label: "Get Smart Website", category: "branding",
    timeEstimate: "~20–45 min to set up",
    whyItMatters: "Your Smart Website is your listing, your website, and your marketing hub in one — the \"business brain\" that gets you found in Google (SEO), AI answers (AEO), and local/AI search (GEO).",
    howTo: [
      "Go to Sites and tell us your path: (A) no website, or ready to replace it — we build one from a template, fast and included; or (B) keep your current site and want it smart — we transfer and rebuild it (additional build fee).",
      "Provide branding + confirm content (services, about, hours, service area, photos).",
      "Review the preview (desktop + mobile).",
      "Publish + connect your domain.",
    ],
    weGive: "We build, host, and maintain it for you — you never touch code.",
    youGet: "One site that's your website + listing + marketing hub, wired together; found everywhere (SEO, AEO, GEO); no separate hosting bill (Path A).",
    scoreImpact: "high",
  },
  {
    key: "optimize_gbp_nap", phase: "everywhere", label: "Optimize Google profile + NAP", category: "branding",
    timeEstimate: "~15 min",
    whyItMatters: "A fully complete Google Business Profile is required to truly be found — incomplete profiles get buried. Your NAP (Name, Address, Phone) must be identical everywhere — when it doesn't match, Google and AI stop trusting you and rank you lower.",
    howTo: [
      "Go to Reputation → GBP Optimization and run the optimizer.",
      "Set your primary category accurately + relevant additional categories.",
      "Fill in services/products + your business description.",
      "Confirm hours, phone, website, address; add strong photos.",
      "Turn on messaging.",
      "Confirm your NAP matches across website, Google, and listing.",
    ],
    commonMistake: "Vague/wrong categories or a half-finished profile — pick the most specific accurate primary category and complete every field.",
    weGive: "We keep you accurate + consistent across the web (Listings Sync) so search + AI trust and surface you.",
    youGet: "To show up correctly everywhere someone — or some AI — looks.",
    scoreImpact: "high",
  },
  {
    key: "campaign_start", phase: "campaigns", label: "Start a campaign", category: "income",
    timeEstimate: "A couple minutes",
    whyItMatters: "One offer or event becomes the seed for a full week of marketing — you don't start from a blank page.",
    howTo: [
      "Open My Business → Marketing → Campaign Builder.",
      "Click + Create new campaign.",
      "Choose from Your offers or Your events.",
      "Click Start my campaign.",
    ],
    weGive: "We already stocked your offers + events, so there's always something ready to build from.",
    youGet: "A campaign started from content you already have.",
    scoreImpact: "low",
  },
  {
    key: "campaign_answer", phase: "campaigns", label: "Answer the campaign question", category: "income",
    timeEstimate: "A minute or two",
    whyItMatters: "Your answer + your profile + the offer is what makes the generated campaign sound like you, not a generic template.",
    howTo: [
      "The builder asks one real question customers ask (never a repeat).",
      "Type your answer in your own words.",
      "Click Generate my campaign.",
    ],
    weGive: "Once you answer, the AI drafts all five pieces from your profile, the offer, and your own words.",
    youGet: "A campaign that sounds like you, not a robot.",
    scoreImpact: "low",
  },
  {
    key: "campaign_review", phase: "campaigns", label: "Review the five pieces", category: "income",
    timeEstimate: "~5 min",
    whyItMatters: "Skimming the five pieces before they go out keeps everything in your voice and catches anything off before customers see it.",
    howTo: [
      "Review the five pieces, generated one at a time (blog first): blog post, social post, email, text, and Facebook ad.",
      "Use Regenerate, Copy, or Save to vault on each — Save to vault leaves a permanent copy in your Emails / Social / Facebook / Text tabs.",
    ],
    commonMistake: "Treating drafts as final — skim and tweak to your voice first.",
    weGive: "Every piece comes pre-written and ready to tweak — no blank page for any of the five.",
    youGet: "Five ready-to-use marketing pieces, tuned to your voice before anything goes out.",
    scoreImpact: "low",
  },
  {
    key: "campaign_publish", phase: "campaigns", label: "Publish + send campaign", category: "income",
    timeEstimate: "~5 min your side",
    whyItMatters: "This is where the campaign actually reaches customers — the FAQ answer alone gets displayed on your Smart Website and your listing, answering customers before they even ask.",
    howTo: [
      "Blog → saved as a draft → publish it (or we do).",
      "FAQ answer → displayed on your Smart Website and your listing automatically.",
      "Social / Email / Text / Facebook → Copy or Save to vault, then post/send (first-name merge tags ready).",
    ],
    weGive: "Hand the finished campaign over and we publish the blog, schedule the social, send the email + text, and launch the Facebook ad for you.",
    youGet: "A full multi-channel campaign from about five minutes of your time.",
    scoreImpact: "medium",
  },
  {
    key: "video_testimonials", phase: "grow", label: "Collect video testimonials", category: "reputation",
    timeEstimate: "~15 min",
    whyItMatters: "Nothing sells a local business like a real neighbor on camera. Collect a new one regularly, not just once.",
    howTo: [
      "Go to Reputation → Video Testimonials.",
      "Send the capture link (or record on a phone).",
      "Approve it. Ask a great customer every week or two.",
    ],
    weGive: "We feature them on your listing, Smart Website, social, and in your ads.",
    youGet: "Your most powerful next-sale tool, refreshed over time.",
    scoreImpact: "medium",
  },
  {
    key: "paid_ads", phase: "grow", label: "Run paid ads (optional)", category: "income",
    timeEstimate: "~15 min to start",
    whyItMatters: "Optional — turn ads on only once the basics are paying off. They bring in new customers faster than organic alone.",
    howTo: [
      "We run your ads through the ClickUpLocal Ads Manager, driving new contacts to your best offer.",
      "Set a monthly budget + confirm payment.",
    ],
    weGive: "We build and manage the campaign for you. Add-on: want a pro-built ad? We'll create, write, and design the creative for an additional fee.",
    youGet: "New customers faster than organic alone.",
    scoreImpact: "low",
  },
  {
    key: "ask_referral", phase: "grow", label: "Ask for a referral", category: "income",
    timeEstimate: "~2 min",
    whyItMatters: "Referrals are the natural close of a strong month — a neighbor who just heard your own results is the warmest possible source of the next local business.",
    howTo: [
      "At your happiest moment (a strong month, a big win), ask if there's a local business you'd want to see get the same results.",
      "Refer a business that signs up → you get one free month, no limit on how many times.",
    ],
    weGive: "We track every referral and apply the free month automatically.",
    youGet: "A free month for every local business you send our way, no cap.",
    scoreImpact: "low",
  },
];

// The sales pipeline, as the first phase of the Playbook. Replaced
// 2026-08-09 (Derek): the old 8-stage version below was built from the
// canonical 02-SOP-Sales-Process.md doc; these 6 are the ones Derek named in
// ClickUpTasks (t_msg8lo6y4/t_yfpkk91z) and confirmed as a full replace, not
// an insert alongside the old 8. sales_site_visit/sales_delivery/
// sales_approval are newly authored — no source doc to draw from yet, worth
// a skim against 02-SOP-Sales-Process.md next time it's touched. Exit ramps
// off the path (Nurture/Lost) still live in ClientStatus ("nurture" /
// "cancelled"), not here — same as before.
//
// Its own catalog rather than six more entries in PLAYBOOK_STEPS, for the
// same reason the side quests are separate but with the opposite ordering:
// PLAYBOOK_STEPS is the OWNER's growth plan, counted as "X of 25" on the
// owner-facing dashboard (playbookCompletion) and enumerated wholesale to
// the business's own /my-business/ page (PLAYBOOK_ALL_STEPS, via
// api/external/playbook). These six are the REP's pipeline — an owner has
// no business reading "Sales pitch" on their own dashboard, and folding them
// in would silently restate every owner's progress as X of 31.
// So: its own phase in PLAYBOOK_PHASES (it's core to the funnel, and renders
// first), real Task rows like everything else (playbookStepsForClient), and
// resolvable in PLAYBOOK_STEP_BY_KEY so the guide panel works — but out of
// PLAYBOOK_ALL_STEPS, which stays the owner-facing catalog.
//
// Two fields are read slightly differently here than in the growth plan,
// since the audience is the rep working the deal rather than the owner:
// weGive is what ClickUpLocal has already done for you by this stage, youGet
// is what clearing the stage gets you. scoreImpact is how far the stage
// moves the DEAL, not the owner's ClickUpLocal Score (these stages don't
// touch it) — it's the guide panel's ⚡ weight either way. category is
// required by PlaybookStepDef but inert for this catalog: every stage is a
// step toward revenue, and none of them feed the owner's four category bars
// (playbookCompletionByCategory reads PLAYBOOK_ALL_STEPS, which excludes
// these), so all six are simply "income" rather than arbitrarily split.
//
// Nothing advances these automatically yet except a claim (see the
// listing-claimed webhook, which fires sales_invite) — the rest are still a
// checkbox in a collapsed accordion section, checked off by hand.
export const SALES_STAGE_STEPS: PlaybookStepDef[] = [
  {
    key: "sales_invite", phase: "sales", label: "Invite", category: "income",
    timeEstimate: "~10 min to start",
    whyItMatters: "The first real touch, the invite email, the text, the call, or the walk in, is what turns a name in the territory into a business someone is working. Their listing and Score are already live before you ever say hello, so you always open with something already done for them. This stage covers everything from outreach through them claiming their free listing.",
    howTo: [
      "Start the outreach sequence from the Businesses page (invite, call, or visit).",
      "Log every touch so whoever picks this up next can see what has already been tried.",
      "Walk them through claiming their listing, or claim it with them while you have them on the phone.",
    ],
    commonMistake: "One touch and moving on. Most owners answer on the third or fourth try, not the first.",
    weGive: "We build the listing and calculate the Score before anyone reaches out, and send the invite and keep the sequence running so no business quietly falls off the list.",
    youGet: "A claimed listing and a business you're actually working, not just a name on a list.",
    scoreImpact: "medium",
  },
  {
    key: "sales_interview_appointment", phase: "sales", label: "Interview Appointment", category: "income",
    timeEstimate: "~5 min to book, ~20 min on the call",
    whyItMatters: "The interview is a real business conversation that doubles as proof they are who they say they are. It's also where you learn enough about the business to make the pitch obvious later, and where you gather the details their free content gets built from.",
    howTo: [
      "Book the phone interview while you still have them on the line.",
      "Ask about the business itself: how it started, what they're known for, what's coming up.",
      "Confirm the listing is still hidden, and set expectations for the site visit before you hang up.",
    ],
    commonMistake: "Treating it as a formality. Everything you learn here is what makes the pitch feel personal instead of scripted.",
    weGive: "We turn the interview answers into their blog post, social post, and newsletter spotlight, so the call pays for itself either way.",
    youGet: "Everything you need to make the pitch about them.",
    scoreImpact: "medium",
  },
  {
    key: "sales_site_visit", phase: "sales", label: "Site visit / image & video gathering", category: "income",
    timeEstimate: "~30 min",
    whyItMatters: "Real photos and video of the actual business are what make their listing, blog post, and social content look like them instead of a stock template. This is the in-person step that turns an interview into something visual.",
    howTo: [
      "Schedule a short visit to the business.",
      "Shoot photos of the storefront, interior, products, and team, plus a short video if they're up for it.",
      "Grab anything else worth having: logo files, menu, existing marketing pieces.",
    ],
    commonMistake: "Skipping the visit and using whatever photos they already have online. A quick in-person visit almost always beats what's already public.",
    weGive: "We build all of it, the blog post, social posts, and listing, around whatever you bring back.",
    youGet: "Real photo and video content their package actually deserves.",
    scoreImpact: "medium",
  },
  {
    key: "sales_delivery", phase: "sales", label: "Delivery", category: "income",
    timeEstimate: "~20 min",
    whyItMatters: "This is the moment the free package stops being a promise and becomes something real they can see: the listing, the blog post, the social posts, the newsletter spotlight, all built and ready to show.",
    howTo: [
      "Package up what's been built: listing, blog post, social posts, newsletter spotlight.",
      "Walk them through it live if you can, or send it with a short summary.",
      "Ask what they think before you move on. This is the reaction that sets up the pitch.",
    ],
    commonMistake: "Delivering it and moving straight to the ask. Give them a real moment to react to their own content first.",
    weGive: "We build the entire package before this call happens, so there's nothing left for you to produce.",
    youGet: "A finished, real product to show, not a pitch deck of promises.",
    scoreImpact: "high",
  },
  {
    key: "sales_approval", phase: "sales", label: "Approval", category: "income",
    timeEstimate: "~10 min",
    whyItMatters: "Getting a yes on the free package, out loud, is the last checkpoint before the listing goes live and the pitch happens. It's also the moment you find out if anything needs fixing before you publish.",
    howTo: [
      "Confirm they're happy with the listing, blog post, and social content.",
      "Make any small edits they ask for before publishing.",
      "Get a clear yes to going live before you schedule the pitch.",
    ],
    commonMistake: "Publishing before you have a real yes. A quiet assumption isn't approval.",
    weGive: "We make the edits fast, so approval doesn't stall the pitch.",
    youGet: "A business that's already said yes once before you ask for the sale.",
    scoreImpact: "medium",
  },
  {
    key: "sales_pitch", phase: "sales", label: "Sales pitch", category: "income",
    timeEstimate: "~45 min, in person or on Zoom",
    whyItMatters: "This is the close. You publish the listing live in front of them, they watch their own business go public, and the card goes on file. The trial starts the moment that happens, so this one stage is where a prospect becomes a business we are responsible for.",
    howTo: [
      "Meet in person if you can, Zoom if you cannot.",
      "Publish the listing live while they watch, so the value is something they see rather than something they are told.",
      "Take the card on file and start the 14 day trial.",
      "Set expectations for the first two weeks before you leave.",
    ],
    commonMistake: "Publishing before the meeting. The live moment is the close, and spending it early leaves you pitching a feature list.",
    weGive: "We have the listing, the offer, the blog post, and the spotlight all staged and ready the second you hit publish.",
    youGet: "A close built on something real happening in the room.",
    scoreImpact: "high",
  },
];

// Which sales stages a ClientStatus transition implies are already done,
// walking SALES_STAGE_STEPS forward from the start. Shared source of truth
// for Cockpit.tsx's cascadeSalesStageCompletion (fires on a Stage dropdown
// change or on opening a client's page) and any server-side/one-off script
// that needs the identical mapping — duplicating this in two places risked
// exactly the kind of drift this reconciliation exists to prevent.
// nurture/cancelled/past_client aren't listed — they're exit ramps, not
// forward progress, and imply nothing about the sales pipeline.
export const SALES_STAGE_ORDER: string[] = SALES_STAGE_STEPS.map((s) => s.key);
export const STATUS_IMPLIES_SALES_STAGE: Partial<Record<ClientStatus, string>> = {
  claimed: "sales_invite",
  interview: "sales_interview_appointment",
  onboarding: "sales_delivery",
  active_client: "sales_pitch",
};

// A2P (texting registration) — real, trackable steps, but deliberately a
// SEPARATE catalog from PLAYBOOK_STEPS, not a 7th phase: the source doc
// frames it as "not part of the main path, do it early" (folding it into the
// phase loop would put it last, the opposite of that), the app's "X of 25"
// progress math is a real doc-verified number that shouldn't silently become
// 22, and the source material never Score-weights A2P the way the main 18
// are. Still real Task rows via reconcilePlaybookTasks — just excluded from
// playbookCompletion()'s total and rendered as its own group (Cockpit.tsx),
// positioned right after Phase 1 to match "do it early."
export const PLAYBOOK_A2P_PHASE: PlaybookPhase = { key: "a2p", label: "Turn on texting (A2P) — side quest" };
export const PLAYBOOK_A2P_STEPS: PlaybookStepDef[] = [
  {
    key: "a2p_get_number", phase: "a2p", label: "Get a marketing phone number", category: "presence",
    timeEstimate: "~5 min",
    whyItMatters: "You need a number before you can register for A2P — this is the first domino. To send review requests and campaigns by text, your business has to be registered (a phone-carrier requirement, not a ClickUpLocal one).",
    howTo: ["Go to Settings → Phone Numbers → Add a Number.", "Pick a local number."],
    youGet: "A dedicated marketing number, ready to register.",
    weGive: "Prefer to skip the whole thing? Our team will do the entire A2P setup for $97 — phone number, business details, and registration, all completed and approved.",
    scoreImpact: "low",
  },
  {
    key: "a2p_business_profile", phase: "a2p", label: "Complete business profile details", category: "presence",
    timeEstimate: "~10 min",
    whyItMatters: "Registration is rejected without these — legal name, address, EIN, website, and contact all have to be on file first.",
    howTo: ["Go to Settings → Business Profile.", "Fill in your legal business name, address, EIN, website, and contact info."],
    youGet: "A complete business profile that won't get your registration bounced.",
    weGive: "Prefer to skip the whole thing? Our team will do the entire A2P setup for $97.",
    scoreImpact: "low",
  },
  {
    key: "a2p_register", phase: "a2p", label: "Register for A2P", category: "presence",
    timeEstimate: "A few minutes to submit",
    whyItMatters: "This is the actual carrier registration — a phone-carrier requirement (not a ClickUpLocal one) that has to clear before texting works.",
    howTo: [
      "Go to Settings → Trust Center.",
      "Submit your business + campaign registration.",
      "Easiest approval: use the in-dashboard chat widget — message us right there and we'll walk your registration through.",
    ],
    youGet: "A submitted registration, one step from approval.",
    weGive: "Prefer to skip the whole thing? Our team will do the entire A2P setup for $97.",
    scoreImpact: "low",
  },
  {
    key: "a2p_wait_approval", phase: "a2p", label: "Wait for approval", category: "presence",
    timeEstimate: "A few days",
    whyItMatters: "Approval takes a few days — email keeps working meanwhile, so nothing stalls while you wait.",
    howTo: ["Wait for carrier approval (typically a few days).", "Once approved, texting switches on across your review requests and campaigns."],
    youGet: "Texting turned on across requests + campaigns — including the review drip, which needs A2P.",
    scoreImpact: "low",
  },
];

// Second side quest — same "separate catalog, not a phase" reasoning as A2P:
// the source doc lists it as its own optional side quest alongside A2P, not
// part of the main path.
export const PLAYBOOK_EMAIL_DOMAIN_PHASE: PlaybookPhase = { key: "email_domain", label: "Set up dedicated email domain — side quest" };
export const PLAYBOOK_EMAIL_DOMAIN_STEPS: PlaybookStepDef[] = [
  {
    key: "email_domain_setup", phase: "email_domain", label: "Set up a dedicated email domain", category: "presence",
    timeEstimate: "~10 min (DNS records)",
    whyItMatters: "Improves your email deliverability so newsletters and review requests land in the inbox instead of spam.",
    howTo: [
      "Go to Settings → Email Services → Dedicated Domain.",
      "Add the DNS records shown (your domain provider, or we can help).",
    ],
    weGive: "We can add the DNS records for you if you'd rather hand it off.",
    youGet: "Newsletters and requests that actually land in the inbox.",
    scoreImpact: "low",
  },
];

// The standing ambassador-side retention task — NOT a one-time owner action
// like the rest of the catalog, so it's created with recurrence: "monthly"
// (see reconcilePlaybookTasks) instead of "none". Excluded from
// playbookCompletion()'s "X of 25" the same way A2P/email-domain are, just by
// virtue of living outside PLAYBOOK_STEPS.
export const PLAYBOOK_ONGOING_PHASE: PlaybookPhase = { key: "ongoing", label: "Monthly retention (ambassador)" };
export const PLAYBOOK_ONGOING_STEPS: PlaybookStepDef[] = [
  {
    key: "monthly_proof_report", phase: "ongoing", label: "Send monthly proof-of-results report", category: "income",
    timeEstimate: "Recurring, monthly",
    whyItMatters: "The single most important recurring retention task — a business that sees a clear win in their inbox every month builds a habit of expecting value from us, which is exactly what makes renewal automatic. A skipped month is itself an at-risk signal.",
    howTo: [
      "Lead with the growing owned-contact count as the headline ROI (\"You now own 118 contacts, up 43 this month\").",
      "Offers claimed and redeemed, translated to tracked dollars.",
      "Reviews gained and AI Score movement (before to after).",
      "Where they rank locally now versus when they started.",
      "One clear next step for the coming month.",
    ],
    commonMistake: "Letting it slide because nothing urgent is happening — a skipped report is itself the first step toward a business going dark and churning.",
    weGive: "We auto-draft it every month so it never depends on anyone remembering.",
    youGet: "A business that renews on its own because the value is undeniable, every month.",
    scoreImpact: "high",
    recurring: true,
  },
];

/** Every OWNER-facing catalog, combined — the growth plan plus its side
 * quests. This is what the business's own /my-business/ dashboard reads
 * (api/external/playbook) and what the four owner category bars tally
 * (playbookCompletionByCategory), so SALES_STAGE_STEPS is deliberately NOT
 * in here: those are the rep's pipeline stages, not the owner's work. */
export const PLAYBOOK_ALL_STEPS: PlaybookStepDef[] = [
  ...PLAYBOOK_STEPS, ...PLAYBOOK_A2P_STEPS, ...PLAYBOOK_EMAIL_DOMAIN_STEPS, ...PLAYBOOK_ONGOING_STEPS,
];
/** Lookup for a task's playbookStepKey regardless of which catalog it came
 * from — including the sales stages, since they're real step-tasks too and
 * need their guide panel (TaskDrawer.tsx) and youGet row hint
 * (GroupedList.tsx) to resolve like any other step. Strictly a superset of
 * PLAYBOOK_ALL_STEPS: resolving a key is not the same as publishing it to
 * the owner, which is what PLAYBOOK_ALL_STEPS alone governs. */
export const PLAYBOOK_STEP_BY_KEY: Map<string, PlaybookStepDef> = new Map(
  [...SALES_STAGE_STEPS, ...PLAYBOOK_ALL_STEPS].map((s) => [s.key, s])
);

/** Which steps a given business actually gets REAL task rows for. Distinct
 * from PLAYBOOK_STEP_BY_KEY, which stays the full lookup so a task created
 * under an older rule still resolves its guide panel. The A2P registration
 * and dedicated email domain steps only apply to a business that texts its
 * list (Client.doesA2P) — everything else is universal. Shared by both
 * reconcilers (Cockpit.tsx's and playbookReconcileServer.ts's) so the two
 * can't drift on what a business is owed.
 *
 * The sales stages lead, matching the render order, and are created for
 * every client unconditionally rather than gated on Client.type. A prospect
 * obviously needs them; a business that has already converted keeps them
 * because the record of how it got here shouldn't vanish the moment it does,
 * and because every one of them is checked off by then anyway, so the phase
 * simply reads as finished. Gating would also mean a business promoted
 * before these existed could never get them at all, since reconcile only
 * ever adds. */
export function playbookStepsForClient(doesA2P: boolean): PlaybookStepDef[] {
  const growthPlan = doesA2P ? PLAYBOOK_ALL_STEPS : [...PLAYBOOK_STEPS, ...PLAYBOOK_ONGOING_STEPS];
  return [...SALES_STAGE_STEPS, ...growthPlan];
}

// Non-task, purely informational content from the source doc — rendered as
// read-only banners around the Playbook task list (Cockpit.tsx), never
// tracked as completable steps.
export const PLAYBOOK_INTRO = {
  title: "We go first",
  body: "The give-first move. Nothing to do yet — this is what's already waiting for you.",
  items: [
    "We already built your listing in the directory and calculated your ClickUpLocal Score when we created your profile.",
    "We've run a marketing audit (website, reviews, citations, SEO, social) and a competitor comparison.",
  ],
  youGet: "A running start — you're claiming work we already did.",
};
export const PLAYBOOK_MILESTONE = {
  title: "Foundation complete — your first big win",
  intro: "You just finished the four steps that make you real in town: claimed, complete, an offer, and your events — in about 30 minutes.",
  items: [
    "The Verified Local Business badge goes on your listing.",
    "You're live — go see your listing. Your complete listing, with your offer right on it, is now public in the directory.",
    "We start actively promoting you to the whole town — booked into the newsletter, our social, and the app, with a preview of your feature.",
    "A featured post, on us — we automatically publish a social post introducing you to the community.",
    "We want to tell your story — we'll write an article featuring your business; just book a quick interview and we'll handle the rest.",
    "You've set your biggest Score drivers in motion — your Score keeps climbing from here as reviews and engagement roll in.",
  ],
};
export const PLAYBOOK_ALWAYS_RUNNING: string[] = [
  "Town promotion — newsletter, our social channels, and the app residents use to find local businesses.",
  "Ongoing AI social — scheduled posts beyond the one-off Campaign Builder posts.",
  "Review drip — automated review requests to new + past customers, forever (needs A2P).",
  "Comeback + loyalty — post-redemption thank-you → review ask → comeback offer, automatically.",
  "Seasonal + birthday — a 12-month offer calendar and birthday offers that run on their own.",
];
export const PLAYBOOK_FINISH_LINE =
  "When the plan is complete, you're the go-to business in town: found everywhere, chosen for your reputation, marketing that runs itself, and a customer list that's yours forever. Your ClickUpLocal Score is as high as your effort makes it — and it keeps climbing. What's next: you've mastered the foundation. Guide 2 unlocks the advanced tools for businesses like yours — online booking, an AI assistant, memberships & loyalty, and more. We'll invite you when you're ready.";

/** Reads completion straight off real Task rows (Task.playbookStepKey) — no
 * separate progress table. `total` is always the *current* catalog length,
 * not however many step-tasks happen to exist yet for this client, so the
 * fraction stays honest even before reconcilePlaybookTasks() has caught a
 * client up to a newly-added step. Counts PLAYBOOK_STEPS only — the side
 * quests and the sales stages both have their own step-tasks and both stay
 * out of this number, so "X of 25" keeps meaning owner growth plan work. */
/** Deterministic id for a client's one Playbook project — found by id, never
 * by name, so it can't collide with an ambassador's own manually-named list. */
export const playbookProjectId = (clientId: string) => "p_playbook_" + clientId;
export function playbookCompletion(clientId: string, tasks: Task[]) {
  const stepTasks = tasks.filter((t) => t.clientId === clientId && t.playbookStepKey);
  const done = new Set(stepTasks.filter((t) => t.status === "done").map((t) => t.playbookStepKey as string));
  const total = PLAYBOOK_STEPS.length;
  const next = PLAYBOOK_STEPS.find((s) => !done.has(s.key)) ?? null;
  return { done, doneCount: done.size, total, pct: Math.round((done.size / total) * 100), next };
}

/** Owner-facing dashboard progress bars (branding/reputation/presence/income) —
 * unlike playbookCompletion()'s "X of 25" (which only counts PLAYBOOK_STEPS,
 * the main path), this tallies every entry in PLAYBOOK_ALL_STEPS, since a
 * category bar shouldn't silently exclude an owner's A2P/email-domain/ongoing
 * progress just because those steps live outside the main phase ordering. */
export function playbookCompletionByCategory(clientId: string, tasks: Task[]) {
  const stepTasks = tasks.filter((t) => t.clientId === clientId && t.playbookStepKey);
  const done = new Set(stepTasks.filter((t) => t.status === "done").map((t) => t.playbookStepKey as string));
  const categories: Record<PlaybookStepDef["category"], { done: number; total: number }> = {
    branding: { done: 0, total: 0 },
    reputation: { done: 0, total: 0 },
    presence: { done: 0, total: 0 },
    income: { done: 0, total: 0 },
  };
  for (const step of PLAYBOOK_ALL_STEPS) {
    const bucket = categories[step.category];
    bucket.total += 1;
    if (done.has(step.key)) bucket.done += 1;
  }
  return categories;
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

export type MessageChannel = "email" | "sms" | "call" | "chat";
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
  /** Gmail conversation id for this message's thread — set alongside
   * gmailMessageId on Gmail sends/reads. Used to match an inbound reply back
   * to the specific task an outbound message was sent from; see
   * supabase/message-gmail-thread-id.sql and resolveTaskForThread in
   * src/lib/inboundIngest.ts. */
  gmailThreadId?: string | null;
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

/** A composed SMS/email held for a future send time — see
 * supabase/scheduled-messages.sql and src/lib/sendMessageServer.ts (the cron
 * that fires these). On success it becomes a real Message row; this is only
 * the pending queue up to that point, fetched/created via /api/messages/schedule. */
export type ScheduledMessageStatus = "pending" | "sent" | "failed" | "canceled";
export interface ScheduledMessage {
  id: string;
  clientId: string;
  taskId: string | null;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  cc: string[];
  bcc: string[];
  fromEmail?: string | null;
  attachments: Attachment[];
  scheduledAt: string; // ISO
  status: ScheduledMessageStatus;
  error?: string | null;
  createdBy: string;
  sentMessageId?: string | null;
  createdAt: string;
}

/** A synced Granola meeting whose attendees didn't match any known contact —
 * parked for triage in the Inbox (same shape/pattern as UnmatchedEmail) so
 * the team can either assign it to an existing client's Journal or dismiss
 * it. See supabase/granola-sync.sql and src/lib/granolaSyncServer.ts. */
export interface GranolaUnmatchedMeeting {
  id: string;
  granolaNoteId: string;
  title: string | null;
  attendees: { email: string }[];
  summary: string | null;
  webUrl: string | null;
  occurredAt: string | null;
  handled: boolean;
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
  /** Last-reviewed date (yyyy-mm-dd) for the weekly Review tier. */
  reviewedAt?: string | null;
  /** Public share token for this ONE list — see supabase/project-share-token.sql.
   * Unlike Client.shareToken's ?project= param (a starting view you can navigate
   * away from), a project token scopes every /api/waiting/[token]/* query to
   * this project_id, so there is nothing else in the response to reach. */
  shareToken?: string | null;
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
  /** Manual drag-to-reorder position within its Vault kind-group (Photos,
   * Screenshots, PDFs, etc). Unset = falls to the end, after any positioned
   * items, in original (added) order. Purely organizational, same spirit as
   * folderId — doesn't move the underlying file. */
  position?: number;
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
  /** The client's own reply, submitted through the public /waiting/[token]
   * page — a single overwritable field (not a growing thread), so the
   * client can revise it right up until the team marks the task done.
   * Submitting while waitingOnClient is true clears that flag, reassigns,
   * and bumps due to today (see /api/waiting/[token]/respond); editing an
   * already-submitted response afterward just updates this field in place. */
  clientResponse?: { body: string; attachments: Attachment[]; submittedAt: string } | null;
  /** An outbound email Claude (via the MCP server's draft_email tool)
   * prepared on this task for a human to review before it goes out — never
   * sent automatically. Single overwritable field like clientResponse
   * above: a second draft_email call just replaces the pending one rather
   * than stacking drafts. Body is HTML (paragraph-wrapped plain text from
   * Claude), so it loads straight into the same RichTextEditor the Journal
   * composer uses. Cleared (set null) once sent or explicitly discarded. */
  draftEmail?: { subject: string; body: string; createdAt: string } | null;
  contactId: string | null;
  due: string | null; // ISO yyyy-mm-dd
  /** Full-precision "last touched," written only by upsertConversationTask
   * (ghlConversationTask.ts) — due (date-only) already served this purpose
   * for Follow Up's sort, but couldn't distinguish two tasks touched the
   * same day. Null on any task upsertConversationTask has never bumped. */
  lastActivityAt?: string | null;
  recurrence: Recurrence;
  /** Only meaningful when recurrence === "custom" — "every N days/weeks/months". */
  recurrenceInterval?: number;
  recurrenceUnit?: RecurrenceUnit;
  /** Only meaningful when recurrence === "custom" && recurrenceUnit === "day-of-month"
   * — recur on these specific calendar days each month (e.g. [1, 15]) instead
   * of "every N units". recurrenceInterval is ignored in this mode. */
  recurrenceDaysOfMonth?: number[];
  /** Only meaningful when recurrence === "custom" && recurrenceUnit === "nth-weekday".
   *  Which occurrence in the month: 1..4, or -1 for the last one. "3rd Monday"
   *  is nth 3 + weekday 1. Deliberately no 5th: most months don't have one, so
   *  offering it would silently skip months (Derek asked for "3rd Monday"). */
  /** When this should come back to your attention, as distinct from `due`,
   *  which is what was promised. While it's in the future the task is
   *  "snoozed": quiet in the list, out of the way on My Work, no late
   *  styling. See supabase/task-follow-up.sql. */
  followUpAt?: string | null;
  /** Priority still follows the due date. Cleared the moment someone sets one by hand. */
  priorityAuto?: boolean;
  /** Rough size, for filling a day. Null means nobody has said. */
  size?: TaskSize | null;
  recurrenceNth?: number;
  /** 0 = Sunday .. 6 = Saturday, matching Date#getUTCDay. */
  recurrenceWeekday?: number;
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
  /** Set when this task IS one of the fixed Owner Growth Plan steps (matches
   * a PLAYBOOK_STEPS or PLAYBOOK_A2P_STEPS key — look up either via
   * PLAYBOOK_STEP_BY_KEY) — reconcilePlaybookTasks() keeps its title synced
   * to the catalog and it can't be deleted or retitled by hand (see
   * TaskDrawer.tsx). Also the stable join key a future sync with the
   * customer-facing Playbook (on the business's public listing) will match
   * against — never match on the editable title. */
  playbookStepKey?: string | null;
  /** Who (or what) created this task — a roster member id, "u_claude" (fully
   * automated system creation, matching the sentinel already used for
   * automated comments), "client" (raised from the public waiting page), or
   * null (legacy row, or a path that predates this field). Recurrence clones
   * propagate the original creator rather than stamping a new one. */
  createdBy?: string | null;
  /** Set when this task is an auto-generated recurring reminder — a
   * SEPARATE marker from playbookStepKey/other identity fields, since a
   * check-in must stay a normal, fully-editable/deletable task, not a
   * locked system step. See src/lib/playbookCheckinsServer.ts and the
   * owner-toggle route's progress trigger. */
  checkinKind?: "playbook_stalled" | "playbook_progress" | null;
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
  // Not started, and the date is close enough that it needs to be. Amber
  // rather than red: it is a nudge, not a failure.
  get_started: { label: "Get started", dot: "#f97316", chip: "#fff7ed" },
  in_progress: { label: "Progress", dot: "#3b82f6", chip: "#eff6ff" },
  review: { label: "Review", dot: "#f59e0b", chip: "#fffbeb" },
  changes_requested: { label: "Changes", dot: "#ef4444", chip: "#fef2f2" },
  waiting: { label: "Waiting", dot: "#14b8a6", chip: "#f0fdfa" },
  // The client said go. Deliberately not Done: their yes and your delivery
  // are two different events, and collapsing them loses the gap between them.
  approved: { label: "Approved", dot: "#8b5cf6", chip: "#f5f3ff" },
  done: { label: "Done", dot: "#22c55e", chip: "#f0fdf4" },
};
export const STATUS_ORDER: TaskStatus[] = ["todo", "get_started", "in_progress", "review", "changes_requested", "waiting", "approved", "done"];

// Status "waiting" and Task.waitingOnClient must always move together — this
// is the one place that rule lives. Every mutation path (update/patchTask
// client-side, the public /waiting/[token]/respond route server-side) must
// run its patch through this before writing, so the "⏳ Waiting on client"
// assignee option, the public client-response page, and the Waiting column
// never drift out of agreement with each other.
export function applyWaitingStatusSync(before: { status: TaskStatus; waitingOnClient?: boolean }, patch: Partial<Task>): Partial<Task> {
  const out: Partial<Task> = {};
  if (patch.status === "waiting") {
    out.waitingOnClient = true;
    if (patch.assigneeId === undefined) out.assigneeId = null;
  } else if (patch.status !== undefined && before.status === "waiting") {
    out.waitingOnClient = false;
  } else if (patch.waitingOnClient === true && patch.status === undefined) {
    out.status = "waiting";
    if (patch.assigneeId === undefined) out.assigneeId = null;
  } else if (patch.waitingOnClient === false && patch.status === undefined && before.status === "waiting") {
    out.status = "review";
  }
  return out;
}

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
// "client_request" is the same shape of thing one tier higher: set only by
// the public client link when a client raises a task themselves (see
// /api/waiting/[token]/request). It ranks above everything so a request the
// client is waiting on can't sink in among our own work (Derek: "they need
// to be sorted out so they don't just mix in with everything we're working
// on") — those tasks used to land as "No priority", i.e. dead last.
export const PRIORITY_META: Record<Priority, { label: string; color: string; rank: number }> = {
  client_request: { label: "Client request", color: "#f97316", rank: 4 },
  conversation: { label: "Interaction", color: "#8b5cf6", rank: 3 },
  urgent: { label: "Urgent", color: "#ef4444", rank: 2 },
  normal: { label: "Normal", color: "#3b82f6", rank: 1 },
  none: { label: "No priority", color: "#cbd5e1", rank: 0 },
};
export const PRIORITY_ORDER: Priority[] = ["client_request", "conversation", "urgent", "normal", "none"];

// Single source of truth for "this tier is auto-assigned only" — used by
// every manual priority-setting surface (pickers, quick-add, drag-and-drop)
// so a future one can't forget the guard. Both auto tiers mean "something
// happened", so letting someone hand-pick one would be a lie about origin.
export const isManuallyAssignable = (p: Priority): boolean => p !== "conversation" && p !== "client_request";
// A priority picker's option list: every manually-assignable tier, plus the
// current value even if it's Conversation (so an existing auto-created task
// can still show/reselect its own tier, just not switch *into* it).
// Priority as the due date implies it (Derek: "move the priorities from none,
// normal and urgent based on when they are due").
//
// Replaces the Start now / Wrap up chip, which ended up on nearly every open
// row and so distinguished nothing. Priority is a field that already exists,
// already sorts, already groups and already has a colour on the row, so
// putting the answer there costs no new furniture.
export function derivedPriority(due: string | null, today: string = TODAY): Priority {
  if (!due) return "none";
  const left = daysUntilDue(due, today);
  if (left === null) return "none";
  return left <= 3 ? "urgent" : "normal";
}

// What a task's priority actually is right now.
//
// Auto only while priorityAuto holds. Setting a priority by hand clears the
// flag and the choice sticks, so the app never argues with a decision someone
// made deliberately.
//
// client_request and conversation are never derived: they are assigned by the
// system to mark where a task came from, and a due date says nothing about
// that.
export function effectivePriority(task: { priority: Priority; due: string | null; priorityAuto?: boolean }, today: string = TODAY): Priority {
  if (!task.priorityAuto) return task.priority;
  if (task.priority === "client_request" || task.priority === "conversation") return task.priority;
  return derivedPriority(task.due, today);
}

// How close counts as "get started". The same three days that turn a task
// urgent, so the stage and the priority never disagree about the same date.
export const GET_STARTED_DAYS = 3;

// A task's stage as it should read right now.
//
// An untouched task whose date is closing in shows as Get started rather than
// To do. Derived rather than written, for the same reason the priority is:
// nothing has to sweep the table, it is right the moment a date moves, and it
// cannot race between two people with the app open.
//
// Only ever promotes To do. Every later stage means someone has picked the
// work up, and telling them to get started would be wrong. Moving a task back
// to To do while its date is still close shows Get started again, which is
// correct: To do and Get started are both "not started", and the only thing
// separating them is how near the date is.
export function effectiveStatus(task: { status: TaskStatus; due: string | null; followUpAt?: string | null }, today: string = TODAY): TaskStatus {
  if (task.status !== "todo") return task.status;
  // Parked work is not late to start; it is waiting on purpose.
  if (isSnoozed(task, today)) return "todo";
  const date = effectiveDueDate(task);
  if (!date) return "todo";
  const left = daysUntilDue(date, today);
  return left !== null && left <= GET_STARTED_DAYS ? "get_started" : "todo";
}

// How big a task is, for filling a day. Not time tracking.
//
// Five buckets, not a number: nobody types "2.5" honestly on a Tuesday
// afternoon, and the only decision being made is whether three of these fit
// today. "hour" exists because the gap from 15 minutes to half a day was a
// cliff, and most real work lands in it.
export type TaskSize = "quick" | "hour" | "half" | "full" | "multi";

export const SIZE_META: Record<TaskSize, { label: string; hint: string; hours: number }> = {
  quick: { label: "Quick", hint: "15 min", hours: 0.25 },
  hour: { label: "An hour", hint: "1 h", hours: 1 },
  half: { label: "Half day", hint: "3 h", hours: 3 },
  full: { label: "Full day", hint: "6 h", hours: 6 },
  // Counted as a full day per day it appears in: a multi-day task fills every
  // day it touches, so treating it as one 6 hour block would let the rest of
  // the week look free when it is not.
  multi: { label: "Multi-day", hint: "2 d+", hours: 6 },
};
export const SIZE_ORDER: TaskSize[] = ["quick", "hour", "half", "full", "multi"];

// A task nobody has sized still has to occupy the day, or the plan quietly
// promises time that does not exist. Half a day is the honest middle: it is
// wrong in both directions rather than optimistic in one.
export const UNSIZED_HOURS = 3;

export function taskHours(task: { size?: TaskSize | null }): number {
  return task.size ? SIZE_META[task.size].hours : UNSIZED_HOURS;
}

// Fills a day with the work its dates demand, and says where it runs out.
//
// The cut-off is the whole point. Everything past it is what you are not
// doing today, said now rather than discovered at six o'clock. So a task that
// does not fit is still returned, marked, rather than hidden.
//
// One task larger than the whole day (a Multi-day, or a Full day against a
// short working day) always takes the first slot rather than being ruled out
// for not fitting. Otherwise the biggest, most urgent thing on the list is
// the one thing the plan never shows you.
export type PlannedTask<T> = { task: T; hours: number; fits: boolean };
export function fillDay<T extends { size?: TaskSize | null }>(
  ordered: T[],
  budgetHours: number,
): { planned: PlannedTask<T>[]; usedHours: number; overflowAt: number | null } {
  const planned: PlannedTask<T>[] = [];
  let used = 0;
  let overflowAt: number | null = null;
  for (const task of ordered) {
    const hours = taskHours(task);
    const first = planned.length === 0;
    const fits = first || used + hours <= budgetHours;
    if (fits) used += hours;
    else if (overflowAt === null) overflowAt = planned.length;
    planned.push({ task, hours, fits });
  }
  return { planned, usedHours: used, overflowAt };
}

// Lays open work across the next few working days.
//
// Nothing is stored: the plan is a reading of the tasks and their dates, so
// it is right the moment anything moves and there is no second copy to fall
// out of step. Weekends are skipped rather than filled, and whatever does not
// fit in a day rolls to the next.
//
// The order is the order the dates demand, decided by the caller. This only
// answers "given that order, what actually fits".
export type PlanDay<T> = { date: string; planned: PlannedTask<T>[]; usedHours: number; budgetHours: number };
// `unplanned` is everything the horizon could not reach. Returned, not
// dropped: with 92 open tasks, a five day plan holds about ten of them, and
// silently losing the other eighty makes a working plan look broken.
export type Plan<T> = { days: PlanDay<T>[]; unplanned: T[] };
export function buildPlan<T extends { size?: TaskSize | null }>(
  ordered: T[],
  budgetHours: number,
  days: number,
  today: string = TODAY,
): Plan<T> {
  const out: PlanDay<T>[] = [];
  const queue = [...ordered];
  let date = today;
  // If today is a weekend, start on Monday rather than planning a day nobody
  // is working.
  while (isWeekend(date)) date = addDaysIso(date, 1);
  while (out.length < days) {
    const { planned, usedHours } = fillDay(queue, budgetHours);
    const taken = planned.filter((p) => p.fits);
    out.push({ date, planned: taken, usedHours, budgetHours });
    queue.splice(0, taken.length);
    if (queue.length === 0 && out.length >= 1) {
      // Still pad out the requested days, so an empty Thursday reads as free
      // rather than simply missing.
      while (out.length < days) {
        date = addDaysIso(date, 1);
        while (isWeekend(date)) date = addDaysIso(date, 1);
        out.push({ date, planned: [], usedHours: 0, budgetHours });
      }
      break;
    }
    date = addDaysIso(date, 1);
    while (isWeekend(date)) date = addDaysIso(date, 1);
  }
  return { days: out, unplanned: queue };
}

export function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

// Personal work, by either of the two ways it is marked.
//
// The private flag is the one the Personal view uses, but not everything in
// the Personal client carries it: "Open a high yield savings account" sits in
// client "personal" with private false. Checking one and not the other let
// half the admin backlog through into the work plan.
export function isPersonalTask(task: { private?: boolean; clientId: string }): boolean {
  return !!task.private || task.clientId === "personal";
}

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
// "day-of-month" and "nth-weekday" never reach this table (describeRecurrence
// branches on both before UNIT_LABEL is consulted) — present only so the
// Record type is total.
const UNIT_LABEL: Record<RecurrenceUnit, [string, string]> = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"], "day-of-month": ["day", "days"], "nth-weekday": ["month", "months"] };
// RECURRENCE_LABEL's "custom" entry is just the picker option text — this
// resolves the actual "every N units" wording once a task's interval/unit
// are set, for display in the drawer and list row.
export const WEEKDAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const NTH_LABEL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", [-1]: "last" };

/** The day-of-month for the nth given weekday of a month, or null when that
 *  occurrence doesn't exist (a 5th Monday in a month that hasn't got one).
 *  nth of -1 means the last one, which every month has. UTC throughout, to
 *  match how every other date in this file is handled — a local-time version
 *  would land on the wrong day for anyone west of Greenwich. */
export function nthWeekdayOfMonth(year: number, monthIdx: number, weekday: number, nth: number): number | null {
  if (nth === -1) {
    const last = lastDayOfUtcMonth(year, monthIdx);
    const lastDow = new Date(Date.UTC(year, monthIdx, last)).getUTCDay();
    return last - ((lastDow - weekday + 7) % 7);
  }
  const firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
  return day <= lastDayOfUtcMonth(year, monthIdx) ? day : null;
}

export function describeRecurrence(rec: Recurrence, interval?: number, unit?: RecurrenceUnit, daysOfMonth?: number[], nth?: number, weekday?: number): string {
  if (rec !== "custom") return RECURRENCE_LABEL[rec];
  if (unit === "nth-weekday") {
    const n = NTH_LABEL[nth ?? 1] ?? "1st";
    return `Monthly on the ${n} ${WEEKDAY_LABEL[weekday ?? 1]}`;
  }
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
];

// --- @mentions --------------------------------------------------------------
// One definition of "what counts as a mention", shared by every composer that
// offers the picker (task comments, Client Journal, Team Chat) and by every
// notifier that scans a sent body for one. They used to be six separate
// inline regexes that had already drifted: Team Chat guarded against email
// addresses opening the picker and matched names case-insensitively on a word
// boundary, task comments did neither — so "@michaella" notified nobody and
// "derek@" popped the picker mid-address.

/** The half-typed "@quer" at the very end of a draft, or null. The @ must
 *  start the draft or follow whitespace so an email address never triggers
 *  the picker (and never gets its Enter key hijacked into a completion). */
export function mentionQuery(text: string): string | null {
  const m = /(^|\s)@([\w]*)$/.exec(text);
  return m ? m[2] : null;
}

/** Teammates matching the half-typed query, or [] when there's no query. */
export function mentionCandidates(text: string, roster: User[] = users, excludeId?: string): User[] {
  const q = mentionQuery(text);
  if (q === null) return [];
  return roster.filter((u) => u.id !== excludeId && u.name.toLowerCase().includes(q.toLowerCase()));
}

/** Complete the half-typed mention with a full name, keeping the whitespace
 *  that preceded the @ and leaving a trailing space to keep typing after. */
export function applyMention(text: string, name: string): string {
  return text.replace(/(^|\s)@([\w]*)$/, (_m, pre: string) => `${pre}@${name} `);
}

/** Does a sent body actually mention this person? Word-boundary, not bare
 *  substring, so "@Samantha" doesn't also notify a "Sam" on the roster.
 *  Case-insensitive so a hand-typed "@derek fox" still lands; the picker
 *  inserts the exact name anyway. A bare first name never matches — that's
 *  what the picker is for. */
export function mentionsUser(body: string, name: string): boolean {
  const lower = body.toLowerCase();
  const at = "@" + name.toLowerCase();
  for (let from = lower.indexOf(at); from !== -1; from = lower.indexOf(at, from + 1)) {
    const after = lower[from + at.length];
    if (after === undefined || !/[\w]/.test(after)) return true;
  }
  return false;
}

export function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Replace the roster with the real team (from profiles). */
export function setUsers(list: User[]) {
  if (list.length === 0) return; // keep the founder fallback if fetch fails
  users.splice(0, users.length, ...list);
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
/** Whole days from today to a due date. Positive is future, 0 is today,
 *  negative is overdue. Date-only maths in UTC so it can't drift by one
 *  either side of midnight the way a local-time subtraction does. */
export function daysUntilDue(iso: string | null, today: string = TODAY): number | null {
  if (!iso) return null;
  const toUtc = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
  const a = toUtc(iso), b = toUtc(today);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/** The short "how long have I got" label that rides beside a due date
 *  (Derek: "say hey you have this many days to get this done"). Deliberately
 *  terse — it sits in a 96px column beside the date itself, so it adds the
 *  urgency the date alone doesn't carry rather than repeating it. */
export function dueCountdown(iso: string | null, today: string = TODAY): string {
  const n = daysUntilDue(iso, today);
  if (n === null) return "";
  if (n < 0) return `${Math.abs(n)}d late`;
  if (n === 0) return "due today";
  if (n === 1) return "1 day left";
  // Past a couple of months, switch to months (Derek: "make the countdown
  // show further out than 14 days"). No cutoff any more — a date always says
  // how far off it is — but "213 days left" is a number nobody reads as a
  // quantity, and at that range it would sit next to "2 days left" competing
  // for the same attention. Coarser units keep it short and keep the near
  // ones standing out.
  if (n <= 60) return `${n} days left`;
  const months = Math.round(n / 30);
  return `${months} months left`;
}

/** How much of the created-to-due window has been used up, 0 to 1, or null
 *  when there's no due date to measure against. A window that is zero days or
 *  inverted (a due date set before the task existed, which really happens)
 *  counts as fully burnt rather than dividing by zero. */
export function windowBurn(createdAt: string, due: string | null, today: string = TODAY): number | null {
  if (!due) return null;
  const created = createdAt.slice(0, 10);
  const total = daysUntilDue(due, created);
  const gone = daysUntilDue(today, created);
  if (total === null || gone === null) return null;
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, gone / total));
}

/** "Do I need to touch this now?" — the honest version of the question, built
 *  from what's already recorded rather than from an effort estimate nobody
 *  fills in (Derek: "the hard part is between the create date and the due
 *  date, how do we know when to work on it").
 *
 *  The third fact, alongside created and due, is whether anyone has STARTED.
 *  A task 25 days into a 30-day window still sitting in To do is the one
 *  shouting; the same task marked Progress is fine and stays quiet. So this
 *  only ever fires on work that hasn't been picked up.
 *
 *  BURN_THRESHOLD at 0.7: late enough that ignoring it is a real risk, early
 *  enough that there's still time to act. Below that, a countdown is enough. */
export const BURN_THRESHOLD = 0.7;
export function startSignal(
  task: { createdAt: string; due: string | null; status: TaskStatus; followUpAt?: string | null },
  today: string = TODAY,
): { level: "none" | "start" | "wrap" | "late"; label: string } {
  const NONE = { level: "none" as const, label: "" };
  if (task.status === "done") return NONE;
  if (!task.due) return NONE;              // nothing to be late for
  if (isSnoozed(task, today)) return NONE; // waiting on someone else until then
  // Waiting is deliberately silent. You are blocked on someone else, so
  // neither "start" nor "wrap up" is advice you can act on; the follow-up date
  // is the tool for that stage.
  if (task.status === "waiting") return NONE;
  const left = daysUntilDue(task.due, today);
  if (left === null) return NONE;
  const burn = windowBurn(task.createdAt, task.due, today);
  const burning = burn !== null && burn >= BURN_THRESHOLD;

  if (task.status === "todo") {
    if (left < 0) return { level: "late", label: "Not started" };
    if (burning) return { level: "start", label: "Start now" };
    return NONE;
  }

  // In progress, review and changes requested: work is underway, so the useful
  // warning is that the runway is nearly gone. Past due gets no chip here on
  // purpose. "Overdue" would only repeat what the due chip already says in
  // red, whereas "Not started" above earns its place by pairing lateness with
  // a stage that says nobody has picked it up.
  if (left >= 0 && burning) return { level: "wrap", label: "Wrap up" };
  return NONE;
}

/** Waiting on someone else until a chosen day. A follow-up date in the past
 *  is not a snooze — that's the day it came back. */
// One thing a person did to a task, and the commitment it left behind.
//
// Separate from Comment (free-form team chatter) and Message (an actual
// email/SMS/chat that went through GoHighLevel) because it answers a
// different question: not "what was said" but "what was done, and what
// happens next". A single action can have all three faces — sending an email
// writes a Message for the content and a TaskAction for the decision.
export type TaskActionKind = "note" | "team" | "chat" | "email" | "sms" | "call" | "meeting" | "met";

export const TASK_ACTION_META: Record<TaskActionKind, { label: string; verb: string; icon: string; needsNextStep: boolean }> = {
  // needsNextStep drives whether the "what's next?" panel opens pre-expanded.
  // A note is the one action that genuinely may not need one — forcing a
  // follow-up date on "FYI for Michaella" would train people to type junk.
  note:    { label: "Leave a note",       verb: "Left a note",       icon: "note",    needsNextStep: false },
  team:    { label: "Message a teammate", verb: "Messaged",          icon: "team",    needsNextStep: false },
  chat:    { label: "Chat the client",    verb: "Chatted client",    icon: "chat",    needsNextStep: true },
  email:   { label: "Email them",         verb: "Emailed client",    icon: "email",   needsNextStep: true },
  sms:     { label: "Text them",          verb: "Texted client",     icon: "sms",     needsNextStep: true },
  call:    { label: "Call them",          verb: "Called",            icon: "call",    needsNextStep: true },
  meeting: { label: "Book a meeting",     verb: "Booked a meeting",  icon: "meeting", needsNextStep: true },
  // Distinct from "meeting", which is one being booked. Same word, opposite
  // ends of time, and only one of them needs a slot picked.
  met:     { label: "Meeting",            verb: "Met",               icon: "met",     needsNextStep: true },
};

export const TASK_ACTION_ORDER: TaskActionKind[] = ["note", "team", "chat", "email", "sms", "call", "met", "meeting"];

// Actions that reach the client. Hidden from anyone without permission to
// contact that client, so a VA sees the internal half of the dock (note,
// teammate, log a meeting, ask) and none of the ways to talk to them.
//
// "met" is not on this list: logging a meeting that already happened is a
// record, not an outbound message, and a VA who sat in on a call still has to
// be able to write down what was decided.
export const CLIENT_FACING_ACTIONS: ReadonlySet<TaskActionKind> = new Set(["chat", "email", "sms", "call", "meeting"]);

export type TaskAction = {
  id: string;
  taskId: string;
  kind: TaskActionKind;
  authorId: string | null;
  body: string;
  at: string;
  nextStep: string | null;
  nextStepDue: string | null;
  nextStepDoneAt: string | null;
};

// The one open commitment on a task: the newest action that set a next step
// and hasn't had it ticked off. Newest wins because setting a new next step
// is how you supersede an old one — you don't go back and cancel the
// previous one first.
export function openNextStep(actions: TaskAction[]): TaskAction | null {
  let best: TaskAction | null = null;
  for (const a of actions) {
    if (!a.nextStep || a.nextStepDoneAt) continue;
    if (!best || a.at > best.at) best = a;
  }
  return best;
}

// The fields a new occurrence of a recurring task must NOT inherit.
//
// A recurrence clone used to copy createdAt and followUpAt straight off the
// finished occurrence. Both are wrong for a task that starts life today:
//
//   createdAt  drove the runway bar, so a monthly task first created in
//              January read "233 of 237 days used · Start now" forever. The
//              window has to be this cycle, not every cycle ever.
//   followUpAt was last cycle's "check back on the 12th". Carried over it
//              either parks the new occurrence before anyone has touched it,
//              or lands in the past and makes it look overdue on day one.
//
// The window starts at the previous due date, which is exactly when this
// occurrence became the live one. Falling back to now covers a recurring task
// that somehow had no due date to advance from.
export function recurrenceResetFields(previousDue: string | null, now: string = new Date().toISOString()): { createdAt: string; followUpAt: null } {
  return { createdAt: previousDue ? `${previousDue}T00:00:00.000Z` : now, followUpAt: null };
}

// A readable name for a link when we have nothing better. Used as the
// immediate label while the title fetch is in flight, and as the permanent
// one when that fetch finds nothing.
//
// The last meaningful path segment beats the host, because that is where the
// human-written part of a URL usually lives: a scribehow share ends in
// "Publishing_Local_Events_via_ClickUpLocal_Ambassador_Portal", which is a
// real title once the separators are turned back into spaces. Falls back to
// the host when a path is all ids and slashes.
// Finds the links inside a plain string, as [start, end, href] spans.
//
// Two shapes, because older activity entries stored links with the scheme
// stripped ("app.clickuplocal.com/v2/location/...") rather than the full URL.
// Matching only https?:// left those as unclickable text, which is most of
// what is in an existing feed.
//
// The bare form insists on a dotted host AND a slash path, so ordinary prose
// survives: "e.g." and "Inc." have no path, so they are left alone. Trailing
// punctuation is trimmed after the match rather than excluded from it, so
// "see foo.com/a." links the URL and not the full stop.
//
// Pulled out of the component so the matching can actually be tested; getting
// this wrong mangles every note anyone has written.
export function linkSpans(text: string): { start: number; end: number; href: string }[] {
  const re = /(https?:\/\/[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s<>"']*)/gi;
  const out: { start: number; end: number; href: string }[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const trimmed = raw.replace(/[.,;:!?)\]"']+$/, "") || raw;
    out.push({ start, end: start + trimmed.length, href: /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` });
  }
  return out;
}

// Titles that tell you nothing. A page behind a login hands back its
// interstitial rather than its content: a Drive folder titles itself "Open",
// a gated doc says "Sign in". Letting those win produced attachments called
// "Open" (Derek), which is worse than the URL they replaced because it also
// looks deliberate.
const USELESS_TITLES = new Set([
  "open", "sign in", "sign in - google accounts", "google drive", "google docs",
  "redirecting", "redirecting…", "loading", "loading…", "untitled", "untitled document",
  "error", "not found", "access denied", "just a moment...", "attention required!",
]);
export function isUselessTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return t.length === 0 || USELESS_TITLES.has(t);
}

// What a Google link is, when we cannot know what it is called.
//
// The real name of a Drive folder needs an authenticated Drive API call; the
// public page will never give it up. So rather than a folder id or the word
// "Open", say what kind of thing it is and let it be renamed in place.
export function googleLinkName(url: string): string | null {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;
  if (host === "docs.google.com") {
    if (path.startsWith("/document")) return "Google Doc";
    if (path.startsWith("/spreadsheets")) return "Google Sheet";
    if (path.startsWith("/presentation")) return "Google Slides";
    if (path.startsWith("/forms")) return "Google Form";
    return "Google Docs link";
  }
  if (host === "drive.google.com") {
    if (path.includes("/folders/")) return "Google Drive folder";
    if (path.includes("/file/")) return "Google Drive file";
    return "Google Drive link";
  }
  if (host === "calendar.google.com") return "Google Calendar event";
  if (host === "meet.google.com") return "Google Meet";
  return null;
}

// Splits an email body into the part worth reading and the reply chain under
// it. A received email arrives carrying the whole thread plus signatures and
// legal boilerplate, so one reply of "I edited it. Its ready." rendered as a
// screen and a half of quoted history (Derek: "the emails are adding a ton of
// space").
//
// Cutting at the quote marker rather than truncating blindly keeps whatever
// the person actually wrote, however long it is, and hides only the part they
// did not write. The quoted half is returned, not discarded, so it stays one
// click away.
const QUOTE_MARKERS: RegExp[] = [
  // "On Mon, 1 Sep 2026 at 14:32, Derek Fox <derek@x.com> wrote:"
  /^\s*On .{0,120}\bwrote:\s*$/im,
  // Gmail's other shape: "August 31 at 2:32 PM, Derek Fox <derek@x.com> wrote:"
  /^\s*\w+ \d{1,2}(,| at ).{0,120}\bwrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,
  // Outlook's header block, which starts a quote without any "wrote:" line.
  /^\s*From:.{0,200}\r?\n\s*Sent:/im,
  /^\s*>{1,}\s?.+$/m,
];
export function splitQuotedEmail(body: string): { visible: string; quoted: string } {
  // Runs of blank lines are most of the wasted height: HTML mail converts to
  // text with a dozen of them between paragraphs.
  const text = body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  let cut = -1;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut === -1) return { visible: text, quoted: "" };
  return { visible: text.slice(0, cut).trim(), quoted: text.slice(cut).trim() };
}

export function prettyLinkName(url: string): string {
  const google = googleLinkName(url);
  if (google) return google;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return url.slice(0, 120); }
  const host = u.hostname.replace(/^www\./, "");
  const segments = u.pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const raw = decodeURIComponent(segments[i]).replace(/\.(html?|php|aspx)$/i, "");
    const words = raw.replace(/[_+-]+/g, " ").replace(/\s+/g, " ").trim();
    // Skip pure ids and hashes: they are not names, however long they are.
    if (words.length < 3) continue;
    if (!/[a-z]/i.test(words)) continue;
    if (!words.includes(" ") && /^[0-9a-f]{8,}$/i.test(words)) continue;
    // Order and reference ids that are not hex: "FO62A175F5FC6" off a Fiverr
    // order. One token, shouty, and carrying digits is an id, not a name.
    if (!words.includes(" ") && /\d/.test(words) && /^[A-Z0-9_-]{6,}$/.test(words)) continue;
    if (!words.includes(" ") && words.length > 24) continue;
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, 120);
  }
  return host;
}

export function isSnoozed(task: { followUpAt?: string | null }, today: string = TODAY): boolean {
  return !!task.followUpAt && task.followUpAt > today;
}

/** The date the task should be ORDERED by. While snoozed that's the
 *  follow-up, because acting on it before then isn't possible and sorting it
 *  to the top by a due date you can't yet act on is just noise. The due date
 *  itself is never overwritten — that was the whole problem with using one
 *  field for both. */
export function effectiveDueDate(task: { due: string | null; followUpAt?: string | null }): string | null {
  // A follow-up date beats the due date whenever one is set (Derek: "follow
  // up date trumps due date ... pulling the task to the top due today even if
  // it's not due for a week"). Both directions matter:
  //
  //   follow up today, due next week  → it surfaces today, which is the point
  //                                     of having said "come back to me then"
  //   follow up next week, due today  → it stays parked, which is the point
  //                                     of having parked it
  //
  // The due date is still the promise, and the runway bar and the overdue
  // colouring both keep measuring against it. This is only about when the
  // task asks for your attention.
  return task.followUpAt ?? task.due;
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

/** "Today" / "Yesterday" / weekday / "Mon 3" (+ year once it's not this
 *  one) — a reverse-chronological feed reads a lot like a chat log without
 *  day dividers to give the eye somewhere to land. Shared home for this
 *  (was duplicated inline in ClientJournal) since Inbox's Activity feed
 *  needs the identical grouping. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

/** Converts stored rich-text HTML (task.description) to a plain-text
 *  approximation for consumers that can't render markup — the GHL task
 *  sync body and the "Copy for Claude" brief. Browser-only (real DOM text
 *  extraction beats a regex); server-side callers get a best-effort tag
 *  strip instead. Never appended to the document, so this carries no XSS
 *  risk despite using innerHTML — it's read-only text extraction. */
export function htmlToText(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") {
    // No DOM to decode entities for us server-side — a link with a bare "&"
    // (e.g. "...?project=x&task=y") would otherwise come through as
    // literal "&amp;", which is exactly the shape of link this app hands
    // out (see the waiting-page task link). Covers the entities real
    // content actually produces, not a full HTML entity table.
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"").replace(/&#0?39;|&apos;/gi, "'").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("p, li, h1, h2, h3, blockquote, br").forEach((el) => el.after(document.createTextNode("\n")));
  return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** A sent email's `messages.body` is plain text for everything composed
 *  before the Journal's email composer went rich-text, and real HTML
 *  (RichTextEditor output, always starting with a tag) for everything after.
 *  There's no stored flag distinguishing the two — this heuristic stands in
 *  for one, same "don't migrate old data, degrade gracefully" approach as
 *  noteTypeMeta's fallback above. A plain-text message starting with a
 *  literal "<" is not a real-world case worth guarding against. */
export function looksLikeHtml(body: string): boolean {
  return /^\s*<[a-z][\s\S]*>/i.test(body);
}

/** Plain text (as returned by the AI drafter, or a legacy plain body) into
 *  paragraph HTML a RichTextEditor can load — blank-line-separated blocks
 *  become <p> tags, escaped so a stray "<" in the text can't be read as
 *  markup. Inverse-ish of htmlToText above. */
export function plainTextToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return "";
  return paras.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
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
export function advanceDue(iso: string | null, rec: Recurrence, interval?: number, unit?: RecurrenceUnit, daysOfMonth?: number[], nth?: number, weekday?: number): string | null {
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
  else if (rec === "custom" && unit === "nth-weekday") {
    // "the 3rd Monday": this month's if it's still ahead of the current due
    // date, otherwise next month's. Walks forward rather than assuming the
    // occurrence exists, so a "last" rule and any future 5th-style option
    // can't silently produce an invalid date. Twelve tries is far more than
    // needed and guarantees termination.
    const n = nth ?? 1;
    const wd = ((weekday ?? 1) % 7 + 7) % 7;
    let y2 = dt.getUTCFullYear();
    let m2 = dt.getUTCMonth();
    for (let i = 0; i < 12; i++) {
      const day = nthWeekdayOfMonth(y2, m2, wd, n);
      if (day !== null && !(i === 0 && day <= dt.getUTCDate())) {
        return `${y2}-${String(m2 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      m2 += 1;
      if (m2 > 11) { m2 = 0; y2 += 1; }
    }
    return iso;
  }
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
 * "dm" — someone sent you a private 1:1 message; routes to that DM thread
 * instead of Team Chat (see openNotification), but still counts as a
 * "Messages" notification for Inbox's filter tab. Lets the Inbox filter the
 * two apart; missing on older rows, treated as "activity" (the more common
 * case) via `?? "activity"` wherever read. */
export type NotificationKind = "message" | "activity" | "dm";
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
 * isn't tied to any client or project (see supabase/team-chat.sql).
 * Deliberately not modeled on ClientNote/Message: no clientId/projectId, no
 * channel — a plain flat feed for "who's covering X today"-style talk, plus
 * the three optional extras any chat needs: quote-reply (replyToId, a
 * same-table message id — resolved client-side, no join), attachments
 * (mirrors Comment.attachments' shape exactly), and pin (pinned/pinnedBy/
 * pinnedAt — any team member can toggle it, a shared curation flag, not
 * message ownership like delete is). */
export interface TeamMessage {
  id: string;
  authorId: string;
  body: string;
  at: string;
  replyToId?: string | null;
  attachments?: Attachment[];
  pinned?: boolean;
  pinnedBy?: string | null;
  pinnedAt?: string | null;
}

/** One message in a private 1:1 DM thread between two teammates (see
 * supabase/dm-chat.sql). Modeled directly on TeamMessage — same flat,
 * insert-only-plus-pin shape — plus the two participant columns a DM needs
 * that a single global feed doesn't: recipientId (who this is addressed to,
 * for RLS/unread/notify) and conversationId (the sorted-pair thread key, so
 * a thread's messages are one indexed lookup instead of an OR of two id
 * checks). 1:1 only — no group DMs. */
export interface DmMessage {
  id: string;
  conversationId: string; // dmConversationId(authorId, recipientId)
  authorId: string;
  recipientId: string;
  body: string;
  at: string;
  replyToId?: string | null;
  attachments?: Attachment[];
  pinned?: boolean;
  pinnedBy?: string | null;
  pinnedAt?: string | null;
}

/** Canonical 1:1 thread key — sorted so either participant resolves to the
 * same id (e.g. dmConversationId("u_derek","u_maria") === dmConversationId("u_maria","u_derek")). */
export function dmConversationId(a: string, b: string): string {
  return `dm_${[a, b].sort().join("__")}`;
}

// --- Lookups (bound at runtime to live state via the helpers below) ---------

export const userById = (id: string | null) => users.find((u) => u.id === id) ?? null;
export const labelById = (id: string) => labels.find((l) => l.id === id) ?? null;
