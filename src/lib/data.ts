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

// The named dates every quick-pick offers, in one place, because there were
// three copies of this list and they had drifted: the list view offered "This
// weekend" and counted in calendar days, the action dock counted in business
// days and started at Tomorrow, and the mind dump offered three options.
// Derek, 2026-09-04: "today, tomorrow, in 3 days, next week, in 2 weeks, in a
// month. we don't need this weekend and then no date and it always picks
// business days as standard".
//
// Business days throughout. "In 3 days" from a Thursday landing on a Sunday
// means two extra days of silence and a task that reads as overdue by Monday
// morning. Today is today even when today is a Saturday: naming a day and
// then moving it is worse than the weekend.
export const DATE_QUICK_PICKS: { label: string; businessDays: number }[] = [
  { label: "Today", businessDays: 0 },
  { label: "Tomorrow", businessDays: 1 },
  { label: "In 3 days", businessDays: 3 },
  { label: "Next week", businessDays: 5 },
  { label: "In 2 weeks", businessDays: 10 },
  { label: "In a month", businessDays: 20 },
];

/** The quick picks resolved against a date, newest callers pass TODAY. */
export function dateQuickPicks(from: string = TODAY): { label: string; date: string }[] {
  return DATE_QUICK_PICKS.map((q) => ({ label: q.label, date: addBusinessDaysIso(from, q.businessDays) }));
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
export type TaskStatus = "todo" | "get_started" | "in_progress" | "review" | "changes_requested" | "waiting" | "approved" | "delegated" | "done";
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
// Which Conversation-priority titles represent an actual message waiting on
// a reply, versus a booked-appointment task that only logs what happened.
// Read by Cockpit.tsx's hasOpenConversationTask, which drives the sidebar's
// "New message" tier: a synced appointment (title "Meeting with …", see
// sync-appointments/route.ts) used to sit in that tier looking exactly like
// an unread reply, with nothing to read once you opened it — its only
// comment is a system-logged event, not something the client sent (Derek,
// 2026-09-09). Everything else defaults to true: an unread reply must never
// be missed because its title didn't match a known non-message pattern.
const NON_MESSAGE_CONVERSATION_TITLES = [/^Meeting with /];
export function isMessageConversationTask(title: string | null | undefined): boolean {
  if (!title) return true;
  return !NON_MESSAGE_CONVERSATION_TITLES.some((p) => p.test(title));
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
   * at all. Plenty of businesses never text
   * their list, and handing every one of them five setup tasks they'll never
   * do buries the steps that matter. Off unless someone says otherwise, so
   * the extra work is opted into rather than issued by default. Optional
   * (like canMessage) so existing clientsSeed literals don't need editing;
   * read as `=== true` everywhere. */
  doesA2P?: boolean;
  /** Whether the public /waiting/[token] page shows the "Your growth plan"
   * progress card at all. Off unless an admin turns it on — not every client
   * should see internal framing on their link, so this is opted in
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
  /** The GoHighLevel conversation this message belongs to. The GHL equivalent
   *  of gmailThreadId: what lets a reply find the task it belongs to. */
  ghlConversationId?: string | null;
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
   * the row shows a "Waiting on client" pill. It keeps its assignee, so it stays
   * on the owner's list for them to follow up (it used to drop off everyone's,
   * Derek 2026-09-10), and it keeps the client visible on the Dashboard. */
  waitingOnClient?: boolean;
  /** The client's own reply, submitted through the public /waiting/[token]
   * page — a single overwritable field (not a growing thread), so the
   * client can revise it right up until the team marks the task done.
   * Submitting while waitingOnClient is true clears that flag, hands the task
   * back to its owner (or the client's follower when it has none), and bumps
   * due to today (see /api/waiting/[token]/respond); editing an
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
  /** A typed estimate in hours, which overrides the bucket's own number.
   *  How a Multi-day says how many days, and how anything else says an hour
   *  and a half without rounding to something untrue. */
  sizeHours?: number | null;
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
  /** Who (or what) created this task — a roster member id, "u_claude" (fully
   * automated system creation, matching the sentinel already used for
   * automated comments), "client" (raised from the public waiting page), or
   * null (legacy row, or a path that predates this field). Recurrence clones
   * propagate the original creator rather than stamping a new one. */
  createdBy?: string | null;
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
  in_progress: { label: "In progress", dot: "#3b82f6", chip: "#eff6ff" },
  review: { label: "Review", dot: "#f59e0b", chip: "#fffbeb" },
  changes_requested: { label: "Changes requested", dot: "#ef4444", chip: "#fef2f2" },
  waiting: { label: "Waiting", dot: "#14b8a6", chip: "#f0fdfa" },
  // The client said go. Deliberately not Done: their yes and your delivery
  // are two different events, and collapsing them loses the gap between them.
  approved: { label: "Approved", dot: "#8b5cf6", chip: "#f5f3ff" },
  // Handed to a teammate. Set by delegating, never picked by hand — see
  // HIDDEN_STATUSES.
  delegated: { label: "Delegated", dot: "#7c3aed", chip: "#f5f3ff" },
  done: { label: "Done", dot: "#22c55e", chip: "#f0fdf4" },
};
export const STATUS_ORDER: TaskStatus[] = ["todo", "get_started", "in_progress", "review", "changes_requested", "waiting", "delegated", "approved", "done"];

// Stages nobody picks by hand. They arrive by doing the thing that sets them
// (delegating), so offering them in a stage menu just adds a way to lie about
// where the work is. Hidden from every picker unless the task is already in
// one, which is how you get back out of it (Derek: "it will move into a
// delegated stage that's hidden and only shows when it's created").
export const HIDDEN_STATUSES: ReadonlySet<TaskStatus> = new Set(["delegated"]);
/** The stages a picker should offer, given where this task is now. */
export function pickableStatuses(current?: TaskStatus | null): TaskStatus[] {
  return STATUS_ORDER.filter((s) => !HIDDEN_STATUSES.has(s) || s === current);
}

// Status "waiting" and Task.waitingOnClient must always move together — this
// is the one place that rule lives. Every mutation path (update/patchTask
// client-side, the public /waiting/[token]/respond route server-side) must
// run its patch through this before writing, so the "⏳ Waiting on client"
// assignee option, the public client-response page, and the Waiting column
// never drift out of agreement with each other.
//
// Waiting never touches the assignee. The client has the next move, but the
// task still belongs to whoever follows up on it. Clearing the assignee took it
// off their list until the client answered, so 15 open waiting tasks had no
// owner at all (Derek, 2026-09-10: "it's complete gone from justin who needs
// to follow up with it").
export function applyWaitingStatusSync(before: { status: TaskStatus; waitingOnClient?: boolean }, patch: Partial<Task>): Partial<Task> {
  const out: Partial<Task> = {};
  if (patch.status === "waiting") {
    out.waitingOnClient = true;
  } else if (patch.status !== undefined && before.status === "waiting") {
    out.waitingOnClient = false;
  } else if (patch.waitingOnClient === true && patch.status === undefined) {
    out.status = "waiting";
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
export type TaskSize = "quick" | "hour" | "h2" | "h3" | "half" | "full" | "multi";

// Every bucket names its hours, because "half day" is a word two people read
// as four hours and twelve. The named ones stay named — a full day is a
// recognisable unit of work in a way that "8 h" is not — but the number rides
// along with it so there is nothing to guess at.
export const SIZE_META: Record<TaskSize, { label: string; hint: string; hours: number }> = {
  quick: { label: "30 min", hint: "0.5 h", hours: 0.5 },
  hour: { label: "1 hour", hint: "1 h", hours: 1 },
  // The gap these two close: an hour to three hours used to be one step, and
  // most of what actually gets estimated lands inside it.
  h2: { label: "2 hours", hint: "2 h", hours: 2 },
  h3: { label: "3 hours", hint: "3 h", hours: 3 },
  half: { label: "Half day", hint: "4 h", hours: 4 },
  full: { label: "Full day", hint: "8 h", hours: 8 },
  // Counted as a full day per day it appears in: a multi-day task fills every
  // day it touches, so treating it as one 8 hour block would let the rest of
  // the week look free when it is not.
  multi: { label: "Multi-day", hint: "8 h+, set your own", hours: 8 },
};
export const SIZE_ORDER: TaskSize[] = ["quick", "hour", "h2", "h3", "half", "full", "multi"];

// A task nobody has sized still has to occupy the day, or the plan quietly
// promises time that does not exist. Half a day is the honest middle: it is
// wrong in both directions rather than optimistic in one.
export const UNSIZED_HOURS = 4;

// A typed estimate beats the bucket it sits in. The buckets exist so sizing
// is one click on the common cases, not so an hour and a half has to be
// rounded to something that is not true.
// Clock times for the plan. Sizing says how long each thing takes; a start
// time is the one extra fact needed to turn that into "this is what you are
// doing at half ten", which is the difference between a list and a day.
//
// Minutes since midnight throughout, because arithmetic on "9:30" is how you
// end up with 9:70. Formatting back to a clock happens once, at the edge.
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatClock(mins: number): string {
  // Wraps rather than reading 25:00, for a day that runs past midnight.
  const m = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m % 60).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
}

// Lays a day's work end to end from a start time. Back to back on purpose:
// this is a plan, not a calendar, and inventing gaps would be inventing
// facts about a day nobody described.
export function clockSlots(hours: number[], startMins: number): { start: number; end: number }[] {
  let at = startMins;
  return hours.map((h) => {
    const start = at;
    at += Math.round(h * 60);
    return { start, end: at };
  });
}

// Reads back what was set: the bucket's own name, or the typed estimate when
// there is one, since a number someone chose deserves to be shown as that
// number rather than as the bucket it happens to land in.
export function sizeLabel(task: { size?: TaskSize | null; sizeHours?: number | null }): string | null {
  const h = task.sizeHours;
  if (typeof h === "number" && h > 0) {
    if (h >= 8 && h % 8 === 0) return `${h / 8} day${h === 8 ? "" : "s"}`;
    if (h < 1) return `${Math.round(h * 60)} min`;
    return `${Number(h.toFixed(2))} h`;
  }
  return task.size ? SIZE_META[task.size].label : null;
}

export function taskHours(task: { size?: TaskSize | null; sizeHours?: number | null }): number {
  if (typeof task.sizeHours === "number" && task.sizeHours > 0) return task.sizeHours;
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
export function fillDay<T extends { size?: TaskSize | null; sizeHours?: number | null }>(
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
export function buildPlan<T extends { size?: TaskSize | null; sizeHours?: number | null }>(
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
// offers the picker (task comments, Client Journal) and by every notifier
// that scans a sent body for one. They used to be six separate inline regexes
// that had already drifted: some guarded against email addresses opening the
// picker and matched names case-insensitively on a word boundary, task
// comments did neither — so "@michaella" notified nobody and "derek@" popped
// the picker mid-address.

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

/** One value for a date, never two.
 *
 *  A date and a countdown beside it are the same fact said twice, which is
 *  why "Tomorrow 1 day left" read as clutter. Inside a week the countdown is
 *  the thing you act on, so that is all this says. Past a week a countdown
 *  stops meaning anything you can hold ("17 days left" is not a quantity
 *  anyone feels), so the date takes over. The real date is always in the
 *  title attribute, so nothing is actually lost either way.
 */
export function dueOneLine(iso: string | null, today: string = TODAY): string {
  const n = daysUntilDue(iso, today);
  if (n === null) return "";
  if (n < 0) return `${Math.abs(n)} day${n === -1 ? "" : "s"} late`;
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n <= 6) return `${n} days left`;
  return formatDue(iso!);
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
export type TaskActionKind = "note" | "team" | "delegate" | "chat" | "email" | "sms" | "call" | "meeting" | "met";

export const TASK_ACTION_META: Record<TaskActionKind, { label: string; verb: string; icon: string; needsNextStep: boolean }> = {
  // needsNextStep drives whether the "what's next?" panel opens pre-expanded.
  // A note is the one action that genuinely may not need one — forcing a
  // follow-up date on "FYI for Michaella" would train people to type junk.
  note:    { label: "Leave a note",       verb: "Left a note",       icon: "note",    needsNextStep: false },
  team:    { label: "Message a teammate", verb: "Messaged",          icon: "team",    needsNextStep: false },
  // Handing the work over, not asking about it. Its own panel asks for the
  // instructions, both dates, the hours and the priority, then writes a
  // delegated checklist item so the delegatee can actually see the task.
  delegate:{ label: "Delegate",           verb: "Delegated",         icon: "team",    needsNextStep: false },
  chat:    { label: "Chat the client",    verb: "Chatted client",    icon: "chat",    needsNextStep: true },
  email:   { label: "Email them",         verb: "Emailed client",    icon: "email",   needsNextStep: true },
  sms:     { label: "Text them",          verb: "Texted client",     icon: "sms",     needsNextStep: true },
  call:    { label: "Call them",          verb: "Called",            icon: "call",    needsNextStep: true },
  meeting: { label: "Book a meeting",     verb: "Booked a meeting",  icon: "meeting", needsNextStep: true },
  // Distinct from "meeting", which is one being booked. Same word, opposite
  // ends of time, and only one of them needs a slot picked.
  met:     { label: "Meeting",            verb: "Met",               icon: "met",     needsNextStep: true },
};

export const TASK_ACTION_ORDER: TaskActionKind[] = ["note", "team", "chat", "email", "sms", "call", "met", "meeting", "delegate"];

// Actions that reach the client. Hidden from anyone without permission to
// contact that client, so a VA sees the internal half of the dock (note,
// teammate, log a meeting, ask) and none of the ways to talk to them.
//
// "met" is not on this list: logging a meeting that already happened is a
// record, not an outbound message, and a VA who sat in on a call still has to
// be able to write down what was decided.
export const CLIENT_FACING_ACTIONS: ReadonlySet<TaskActionKind> = new Set(["chat", "email", "sms", "call", "meeting"]);

/** Everything one handoff decides. The dock collects it, Cockpit writes it. */
export type DelegateSpec = {
  toId: string;
  /** What to call the handoff. Blank means "name it from the brief" — see
   *  delegationTitle. */
  title: string;
  instructions: string;
  /** When THEY owe it. Drives their list, not yours. */
  theirDue: string;
  /** When it comes back to you if you have heard nothing. */
  followUpAt: string | null;
  size: TaskSize | null;
  priority: Priority;
  links: string[];
};

export type TaskAction = {
  id: string;
  taskId: string;
  kind: TaskActionKind;
  authorId: string | null;
  // Who it was addressed to, for the kinds that have an addressee (today
  // just "team"). Null everywhere else.
  toId?: string | null;
  // Set on a reply, pointing at the entry being replied to. Replies are
  // actions like any other, so they thread without a second table.
  parentId?: string | null;
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

/** A short name for a handoff, from the brief someone typed. A brief opens
 *  with the whole ask on one line ("FULL PAGE PRINT AD for a run specialty
 *  trade magazine, The Running Event 2026 Planner (Running Insight).
 *  Publisher deadline Sept 18, so I need..."), and using that line whole
 *  gave a row title that wrapped, truncated, and then repeated verbatim in
 *  the brief underneath it. Cut at the first sentence, then at the first
 *  clause, then hard, so the title is a name and the brief is the detail. */
export function delegationTitle(instructions: string): string {
  const first = instructions.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (first.length <= 60) return first;
  const sentence = first.split(/(?<=[.!?])\s/)[0].trim();
  if (sentence.length <= 60) return sentence;
  const clause = sentence.split(/[,;:(]/)[0].trim();
  if (clause.length >= 20 && clause.length <= 60) return clause;
  // Cut on a word boundary rather than mid-word, then say it was cut.
  const cut = sentence.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
}

/** The date this person was given on their own open delegated item, if any.
 *  The same task can therefore be due one day for its owner and another for
 *  the person holding a piece of it, which is the point: they were given
 *  different dates. */
export function delegatedDueFor(
  task: { assigneeId?: string | null; subtasks?: Subtask[] },
  userId: string,
): string | null {
  return delegatedItemFor(task, userId)?.due ?? null;
}

/** The handoff this person is holding on someone else's task: their open
 *  delegated checklist item, the soonest dated one first. Null for the
 *  task's owner. Their row reads its title and date from this one item, so
 *  the name and the date on their list can never come from two different
 *  handoffs (Derek: her list showed the task's title, not the one he gave
 *  her). */
export function delegatedItemFor(
  task: { assigneeId?: string | null; subtasks?: Subtask[] },
  userId: string,
): Subtask | null {
  if (task.assigneeId === userId) return null;
  const mine = (task.subtasks ?? []).filter((s) => !s.done && s.assigneeId === userId);
  mine.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  return mine[0] ?? null;
}

/** Who a task is currently with, if it has been handed off: the assignee of
 *  the first open delegated checklist item that is not the owner's own. Null
 *  for a task nobody is waiting on. */
export function delegateeOf(task: { assigneeId?: string | null; subtasks?: Subtask[] }): string | null {
  const item = (task.subtasks ?? []).find((s) => !s.done && s.assigneeId && s.assigneeId !== task.assigneeId);
  return item?.assigneeId ?? null;
}

/** Is this task on that person's plate? True for its assignee, and for
 *  anyone holding an open delegated checklist item on it. Delegation puts a
 *  task on someone's list without changing who owns it, so every "whose work
 *  is this" question has to ask both (Derek: "it's delegated to Michaella but
 *  it's not showing up"). */
export function isOnPlateOf(
  task: { assigneeId?: string | null; subtasks?: Subtask[] },
  userId: string,
): boolean {
  return task.assigneeId === userId
    || (task.subtasks ?? []).some((s) => !s.done && s.assigneeId === userId);
}

/** The date THIS person should plan by. For the task's owner that is the
 *  effective due date. For someone it was delegated to it is the date on
 *  their own open checklist item, because the owner's follow-up date is a
 *  fact about the owner's week, not theirs. Without this a delegated task
 *  lands on their list grouped by a date they were never given. */
export function viewerDueDate(
  task: { due: string | null; followUpAt?: string | null; assigneeId?: string | null; subtasks?: Subtask[] },
  viewerId?: string | null,
): string | null {
  const mine = viewerId ? delegatedDueFor(task, viewerId) : null;
  return mine ?? effectiveDueDate(task);
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

/** The next occurrence that is actually still ahead of you, skipping any the
 *  date has already gone past.
 *
 *  advanceDue takes exactly one step, which is right for describing a
 *  recurrence but wrong for finishing one. A daily task three weeks overdue
 *  advanced one day at a time, so clearing it meant ticking it twenty-one
 *  times to walk it back to today, each tick writing a task nobody would ever
 *  do (Derek, 2026-09-08: "instead of having to complete all the days to
 *  catch it up just move it to the next future date that follows the
 *  sequence").
 *
 *  Strictly after `today`, not on it: you have just completed an occurrence,
 *  so handing you another one due the same day is the same problem in
 *  miniature. A task due today and completed today goes to tomorrow, which is
 *  what it always did.
 *
 *  The sequence itself is untouched — this only walks it. A weekly task keeps
 *  landing on its own weekday however long it was left, because every step is
 *  still advanceDue.
 */
export function nextDueAhead(
  iso: string | null, rec: Recurrence, interval?: number, unit?: RecurrenceUnit,
  daysOfMonth?: number[], nth?: number, weekday?: number, today: string = TODAY,
): string | null {
  if (!iso || rec === "none") return iso;
  let cur = iso;
  // A cap, because advanceDue returns its input unchanged for a rule it
  // cannot satisfy (see the nth-weekday fallback), and a loop that trusts it
  // to always move would hang the tab. Ten years of daily steps is far more
  // than any real backlog and still costs nothing.
  for (let i = 0; i < 4000; i++) {
    const next = advanceDue(cur, rec, interval, unit, daysOfMonth, nth, weekday);
    if (!next || next === cur) return next; // stalled: hand back what we have
    cur = next;
    if (cur > today) return cur;
  }
  return cur;
}

// --- Notifications ----------------------------------------------------------

/** "message" — a direct human communication (an @mention or comment someone
 * wrote to you). "activity" — an automatic side-effect notice from normal
 * task work (assignment, status/due-date change, checklist completion).
 * "dm" — someone sent you a private 1:1 message; routes straight to that DM
 * thread (see openNotification), but still counts as a "Messages"
 * notification for Inbox's filter tab. Lets the Inbox filter the
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

/** One message in a private 1:1 DM thread between two teammates (see
 * supabase/dm-chat.sql). Deliberately not modeled on ClientNote/Message: no
 * clientId/projectId, no channel — a flat, insert-only feed plus the three
 * extras any chat needs: quote-reply (replyToId, a same-table message id,
 * resolved client-side with no join), attachments (mirrors Comment.attachments'
 * shape exactly) and pin (pinned/pinnedBy/pinnedAt — either participant can
 * toggle it, a shared curation flag, not ownership like delete is). The two
 * participant columns are what make it a DM: recipientId (who this is
 * addressed to, for RLS/unread/notify) and conversationId (the sorted-pair
 * thread key, so a thread's messages are one indexed lookup instead of an OR
 * of two id checks). 1:1 only — no group DMs. */
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
