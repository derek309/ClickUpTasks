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
/** yyyy-mm-dd of the Saturday ending next calendar week — one week past
 * THIS_WEEK_END — the boundary for the "Due next week" urgency tier. */
export const NEXT_WEEK_END = addDaysIso(THIS_WEEK_END, 7);
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
export type TaskStatus = "todo" | "in_progress" | "review" | "changes_requested" | "done";
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
  /** A personal "check in on this again" reminder date, independent of any
   * task's due date — lets a client stay a real urgency signal (sidebar
   * sort, My Work) even when none of its tasks carry a due date. Plain ISO
   * string, matching tasks.due's exact type/comparison semantics. */
  followUpAt?: string | null;
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
  // Explicit override for the WordPress option-key slug push-sync writes
  // into (WordPress's own PHP sanitize_title() of the city name) — avoids
  // silently drifting from a JS re-derivation on punctuation/spelling edge
  // cases. Null = derive it the simple way (see planner push route).
  wpCitySlug: string | null;
}

// --- Content Planner (the per-city weekly newsletter workflow) -------------
// Moved in from WordPress's /sales Content Planner; ClickUpTasks is now the
// source of truth (see supabase/planner.sql), pushing finalized picks out to
// WordPress on save so the public "{City} Weekly" archive page keeps working
// unchanged. See /Users/derekfox/.claude/plans/twinkly-puzzling-prism.md for
// the full migration plan.

// A business reference attached to a slot/section/event. clientId links a
// ClickUpTasks prospect/client when one exists; gdPlaceId is the WordPress
// GeoDirectory listing id (captured from /api/directory/listings at pick
// time) so push-sync can build the public listing link. Free-text-only
// (both null) is legal — matches what WordPress already allowed.
export interface PlannerBiz {
  clientId: string | null;
  gdPlaceId: number | null;
  name: string;
  url: string;
  cat: string;
  note: string;
}

export type PlannerSlot = "spotlight" | "gem" | "gem2" | "gem3" | "story";
// Business Spotlight + up to 3 Hidden Gems — new businesses claimed to be
// featured. "story" (local news) is content-only, not a business slot.
export const PLANNER_BUSINESS_SLOTS: PlannerSlot[] = ["spotlight", "gem", "gem2", "gem3"];
export const PLANNER_CONTENT_SLOTS: PlannerSlot[] = [...PLANNER_BUSINESS_SLOTS, "story"];

export interface PlannerWeek {
  id: string;
  territoryId: string;
  week: string; // yyyy-mm-dd — the issue's Wednesday ship date, same key WordPress used
  themeOverride: string;
  // Longer-form "what this week is about" — the goal, what to feature, what
  // to promote. Set from an AI theme suggestion's description, or by hand.
  themeDescription: string;
  categories: string[]; // per-week override of the theme calendar's target categories — drives "who to go after" pools and the brief's Support Local section
  notes: string;
  // A fetched local forecast blurb (suggest_weather), reviewed/approved like
  // any other AI suggestion — replaces plannerBrief's old hardcoded stub.
  weatherNote: string;
  picks: Partial<Record<PlannerSlot, PlannerBiz>>;
  // gd_place_ids explicitly skipped for this week's newsletter — "not using
  // them this week," set before ever inviting them. Reversible (bring back
  // clears it). A business that WAS invited and later marked skipped lives
  // in `invited[].status` instead, not here — the two never overlap.
  dismissed: number[];
  // gd_place_ids invited to be featured this week (via the WordPress outreach
  // proxy), with when — lets the "Invited ✓" mark survive a refresh instead
  // of being session-only. `status` starts "invited" and flips to "accepted"
  // by the inbound response webhook (planner-interest route), or to
  // "skipped" by a rep manually — WordPress has no "declined" signal to wait
  // on, so skipped is always a local, manual call. Entries from before this
  // field existed have no `status` — treat as "invited" at every read site.
  invited: PlannerInvite[];
  // Support Local override, on top of the auto-populated "every claimed
  // business with an active offer" list: ids hidden this week (a listing id,
  // as a string), and businesses added on top that don't otherwise qualify
  // (e.g. not flagged hasOffer, or unclaimed but worth a shout-out anyway).
  supportLocalExcluded: string[];
  supportLocalAdded: PlannerBiz[];
  archived: boolean;
  sentDate: string | null;
  wpPushedAt: string | null;
  createdAt: string;
}

export type PlannerInvite = {
  gdPlaceId: number;
  at: string;
  status?: "invited" | "accepted" | "skipped";
  respondedAt?: string;
  responseEvent?: string;
};

export interface PlannerSection {
  id: string;
  weekId: string;
  position: number;
  type: string; // "The Story" | "New In Town" | "Ask Your Concierge" | "Last Call" | a custom title
  text: string;
  biz: PlannerBiz | null;
}

export interface PlannerEvent {
  id: string;
  weekId: string;
  position: number;
  text: string;
  biz: PlannerBiz | null;
}

export type NewsletterItemType = "business" | "video" | "event" | "offer" | "news" | "social" | "blog";
export type NewsletterItemStatus = "pending" | "done";

// A queued item in the newsletter backlog — added from a business's own
// page or the planner sidebar, optionally assigned to a week (null = "who
// to go after" backlog, not yet scheduled).
export interface NewsletterItem {
  id: string;
  territoryId: string;
  type: NewsletterItemType;
  clientId: string | null;
  gdPlaceId: number | null;
  weekId: string | null;
  title: string;
  note: string;
  url: string | null;
  status: NewsletterItemStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface ThemeCalendarEntry {
  id: number;
  month: number; // 1-12
  weekOfMonth: number; // 1-5
  title: string;
  categories: string[];
}

// The Wednesday (yyyy-mm-dd) of the ISO week containing `iso` — the same
// anchor WordPress's planner uses (cul_planner_current_week_iso), so a
// ClickUpTasks week id maps 1:1 onto the WP push-sync option key with no
// date translation needed.
export function plannerWeekOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const isoDow = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay(); // 1=Mon…7=Sun
  dt.setUTCDate(dt.getUTCDate() + (3 - isoDow));
  return dt.toISOString().slice(0, 10);
}
export const PLANNER_CURRENT_WEEK = plannerWeekOf(TODAY);

// Human label for a planner week as its Sunday–Saturday span, e.g.
// "Jun 14 – 20, 2026" (or "Jun 28 – Jul 4, 2026" across months) — matches
// WordPress's cul_planner_week_label. The week is keyed by its Wednesday
// ship date; Sunday = Wed − 3 days, Saturday = Wed + 3 days.
export function plannerWeekLabel(week: string): string {
  const sun = addDaysIso(week, -3);
  const sat = addDaysIso(week, 3);
  const parts = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
  const s = parts(sun), e = parts(sat);
  const monthName = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  if (s.y !== e.y) return `${monthName(s.m)} ${s.d}, ${s.y} – ${monthName(e.m)} ${e.d}, ${e.y}`;
  if (s.m !== e.m) return `${monthName(s.m)} ${s.d} – ${monthName(e.m)} ${e.d}, ${e.y}`;
  return `${monthName(s.m)} ${s.d} – ${e.d}, ${e.y}`;
}

// The calendar entry auto-assigned to a week, by its Wednesday's month +
// week-of-month — a direct port of WordPress's cul_sales_week_theme (same
// clamped ceil(day/7) index, same "fall back to the month's last entry"
// behavior when a month has fewer than 5 seeded rows) so a given date
// resolves to the same theme it always has, just re-derived here instead of
// carried over as stored data.
export function themeForWeek(weekIso: string, calendar: ThemeCalendarEntry[]): ThemeCalendarEntry | null {
  const [, m, d] = weekIso.split("-").map(Number);
  const weekIndex = Math.min(5, Math.max(1, Math.ceil(d / 7)));
  const list = calendar.filter((c) => c.month === m).sort((a, b) => a.weekOfMonth - b.weekOfMonth);
  if (!list.length) return null;
  return list[Math.min(weekIndex - 1, list.length - 1)];
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
// THE-OWNER-GROWTH-PLAN-DRAFT.md's step order.
export type PlaybookPhase = { key: string; label: string };
export const PLAYBOOK_PHASES: PlaybookPhase[] = [
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
};
export const PLAYBOOK_STEPS: PlaybookStepDef[] = [
  {
    key: "claim_listing", phase: "map", label: "Claim listing",
    timeEstimate: "~5 min",
    whyItMatters: "Claiming unlocks your My Business dashboard, where everything else lives. Your Score was already calculated when we built your profile — claiming lets you start improving it.",
    howTo: [
      "From the directory: search your business at clickuplocal.com, open your listing, and click \"Claim this business, it's free.\"",
      "Or from the Businesses page: go to clickuplocal.com/businesses and click \"Claim My Free Listing.\"",
      "Find your business (or add it if it's not there), verify you're the owner, and you'll land in My Business.",
    ],
    commonMistake: "Thinking you have to pay to claim — you don't. Free gets you a verified listing, Google Business Profile setup, and automated review requests at no cost.",
    weGive: "We open your dashboard and mark you a verified local owner.",
    youGet: "Control of your directory presence, free.",
    scoreImpact: "low",
  },
  {
    key: "complete_listing", phase: "map", label: "Complete business listing",
    timeEstimate: "~10 min (established shortcut: copy straight from your website/Google)",
    whyItMatters: "Photo-rich, complete listings get far more clicks, rank higher, and become eligible to be featured. Profile completeness is one of the biggest Score factors.",
    howTo: [
      "Add your logo and 5–10 photos (storefront, interior, products, team).",
      "Complete every field: name, category, description, services/products, hours, phone, website, address.",
      "Add your social links.",
      "Save / Publish, then check the live preview.",
    ],
    commonMistake: "A thin listing — no photos, blank description. Fill it all in now.",
    weGive: "We optimize your listing for local + AI search — completeness is one of the biggest Score drivers, so this keeps lifting you as your Score refreshes.",
    youGet: "A listing that gets found and chosen.",
    scoreImpact: "high",
  },
  {
    key: "first_offer", phase: "map", label: "Create first offer",
    timeEstimate: "~10 min",
    whyItMatters: "An offer drives residents through your door — and every redemption hands you a new customer contact you own. It doesn't have to be a discount: a bonus, upgrade, bundle, priority booking, free add-on, or VIP perk all work — what matters is it's compelling enough to make someone actually come in.",
    howTo: [
      "Go to Offers & Events → Offers → Create Offer.",
      "Not sure what to offer? Use the built-in offer suggestion tool.",
      "Write a clear title + the fine print; set the expiration (residents get 14 days to redeem).",
      "Publish, and set up a Comeback Offer for after they redeem.",
    ],
    commonMistake: "Too small to matter, or so big it hurts. Get someone off the couch, but make it pencil out.",
    weGive: "We push it to residents, notify the town, and feature it in the newsletter, on social, and in the app. Every redemption auto-adds a new contact to your list.",
    youGet: "Foot traffic now + a new owned customer per redemption.",
    scoreImpact: "medium",
  },
  {
    key: "add_events", phase: "map", label: "Add events",
    timeEstimate: "~5 min each",
    whyItMatters: "Events give residents a reason to visit now, and give the Campaign Builder (Phase 5) more to promote.",
    howTo: [
      "Go to Offers & Events → Events → Add Event.",
      "Fill in name, date/time, description, photo.",
      "Publish. Add all your upcoming events.",
    ],
    weGive: "We surface your events in the directory + newsletter, and let you turn any event into a full campaign later.",
    youGet: "More reasons for residents to show up, promoted for you.",
    scoreImpact: "low",
  },
  {
    key: "connect_gbp", phase: "reputation", label: "Connect Google Business Profile",
    timeEstimate: "~5 min",
    whyItMatters: "Google is where new customers judge you and where your review requests point. Nothing else in reputation works until this is connected.",
    howTo: [
      "Go to Reputation → Settings → Integrations.",
      "Click Google Business Profile → Connect.",
      "Sign in with the account that owns the listing (not a personal one) → Allow.",
      "Confirm it says Connected.",
    ],
    commonMistake: "Signing in with the wrong Google account — it must own the listing.",
    weGive: "We get you ready to auto-respond to every review, past and future.",
    youGet: "The connection that powers your whole reputation engine.",
    scoreImpact: "medium",
  },
  {
    key: "review_engine", phase: "reputation", label: "Turn on review engine",
    timeEstimate: "~10 min",
    whyItMatters: "Reviews are the #1 thing people check before choosing a local business — and responding to every review, good and bad, signals you care, builds trust, and lifts your Google ranking. (Industry research puts each extra Google star at roughly 5–9% more revenue.) Doing this by hand is a grind; this automates all of it.",
    howTo: [
      "In Reputation → Settings, Review Link: select Google (already connected — no pasting).",
      "Requests: enable SMS Requests + Email Requests, set up Reviews QR for in-store capture, and turn on Spam Reviews filtering.",
      "Reviews AI (Settings → AI): choose Auto Responses and set a short wait time before responding so it feels human.",
      "Past reviews — Drip Mode: under \"Respond to Reviews – Drip Mode,\" create a new campaign — name it, set the review date range, Frequency: Daily, replies per day (e.g. 10/day), an optional time window, select an AI Agent, and create it.",
    ],
    commonMistake: "Replies-per-day too high — a natural pace looks more genuine than a same-minute flood.",
    weGive: "We give you a review count that climbs on its own, and AI that responds to every new review and every past review — automatically, in your voice.",
    youGet: "A reputation that works 24/7 without you touching it.",
    scoreImpact: "high",
  },
  {
    key: "first_review_request", phase: "reputation", label: "Send first review request",
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
    key: "reviews_widget", phase: "reputation", label: "Add reviews widget to website",
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
    key: "import_contacts", phase: "list", label: "Import contacts",
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
    key: "ongoing_capture", phase: "list", label: "Set up ongoing capture (QR/table tents)",
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
    key: "smart_website", phase: "everywhere", label: "Get Smart Website",
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
    key: "optimize_gbp_nap", phase: "everywhere", label: "Optimize Google profile + NAP",
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
    key: "campaign_start", phase: "campaigns", label: "Start a campaign",
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
    key: "campaign_answer", phase: "campaigns", label: "Answer the campaign question",
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
    key: "campaign_review", phase: "campaigns", label: "Review the five pieces",
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
    key: "campaign_publish", phase: "campaigns", label: "Publish + send campaign",
    timeEstimate: "~5 min your side",
    whyItMatters: "This is where the campaign actually reaches customers — the FAQ answer alone gets displayed on your Smart Website and your listing, answering customers before they even ask.",
    howTo: [
      "Blog → saved as a draft → publish it (or we do).",
      "FAQ answer → displayed on your Smart Website and your listing automatically.",
      "Social / Email / Text / Facebook → Copy or Save to vault, then post/send (first-name merge tags ready).",
    ],
    weGive: "Hand the finished campaign to your ambassador and we publish the blog, schedule the social, send the email + text, and launch the Facebook ad for you.",
    youGet: "A full multi-channel campaign from about five minutes of your time.",
    scoreImpact: "medium",
  },
  {
    key: "video_testimonials", phase: "grow", label: "Collect video testimonials",
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
    key: "paid_ads", phase: "grow", label: "Run paid ads (optional)",
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
];

// A2P (texting registration) — real, trackable steps, but deliberately a
// SEPARATE catalog from PLAYBOOK_STEPS, not a 7th phase: the source doc
// frames it as "not part of the main path, do it early" (folding it into the
// phase loop would put it last, the opposite of that), the app's "X of 18"
// progress math is a real doc-verified number that shouldn't silently become
// 22, and the source material never Score-weights A2P the way the main 18
// are. Still real Task rows via reconcilePlaybookTasks — just excluded from
// playbookCompletion()'s total and rendered as its own group (Cockpit.tsx),
// positioned right after Phase 1 to match "do it early."
export const PLAYBOOK_A2P_PHASE: PlaybookPhase = { key: "a2p", label: "Turn on texting (A2P) — side quest" };
export const PLAYBOOK_A2P_STEPS: PlaybookStepDef[] = [
  {
    key: "a2p_get_number", phase: "a2p", label: "Get a marketing phone number",
    timeEstimate: "~5 min",
    whyItMatters: "You need a number before you can register for A2P — this is the first domino. To send review requests and campaigns by text, your business has to be registered (a phone-carrier requirement, not a ClickUpLocal one).",
    howTo: ["Go to Settings → Phone Numbers → Add a Number.", "Pick a local number."],
    youGet: "A dedicated marketing number, ready to register.",
    weGive: "Prefer to skip the whole thing? Our team will do the entire A2P setup for $97 — phone number, business details, and registration, all completed and approved.",
    scoreImpact: "low",
  },
  {
    key: "a2p_business_profile", phase: "a2p", label: "Complete business profile details",
    timeEstimate: "~10 min",
    whyItMatters: "Registration is rejected without these — legal name, address, EIN, website, and contact all have to be on file first.",
    howTo: ["Go to Settings → Business Profile.", "Fill in your legal business name, address, EIN, website, and contact info."],
    youGet: "A complete business profile that won't get your registration bounced.",
    weGive: "Prefer to skip the whole thing? Our team will do the entire A2P setup for $97.",
    scoreImpact: "low",
  },
  {
    key: "a2p_register", phase: "a2p", label: "Register for A2P",
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
    key: "a2p_wait_approval", phase: "a2p", label: "Wait for approval",
    timeEstimate: "A few days",
    whyItMatters: "Approval takes a few days — email keeps working meanwhile, so nothing stalls while you wait.",
    howTo: ["Wait for carrier approval (typically a few days).", "Once approved, texting switches on across your review requests and campaigns."],
    youGet: "Texting turned on across requests + campaigns — including the review drip, which needs A2P.",
    scoreImpact: "low",
  },
];
// Combined lookup so the TaskDrawer guide panel can resolve a task's
// playbookStepKey regardless of which catalog it came from.
export const PLAYBOOK_STEP_BY_KEY: Map<string, PlaybookStepDef> = new Map(
  [...PLAYBOOK_STEPS, ...PLAYBOOK_A2P_STEPS].map((s) => [s.key, s])
);

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
    "We want to tell your story — we'll write an article featuring your business; just book a quick interview with your ClickUpLocal ambassador and we'll handle the rest.",
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
 * client up to a newly-added step. */
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

export type MessageChannel = "email" | "sms" | "call";
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
  /** Set when this task IS one of the fixed Owner Growth Plan steps (matches
   * a PLAYBOOK_STEPS or PLAYBOOK_A2P_STEPS key — look up either via
   * PLAYBOOK_STEP_BY_KEY) — reconcilePlaybookTasks() keeps its title synced
   * to the catalog and it can't be deleted or retitled by hand (see
   * TaskDrawer.tsx). Also the stable join key a future sync with the
   * customer-facing Playbook (on the business's public listing) will match
   * against — never match on the editable title. */
  playbookStepKey?: string | null;
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
// Same idea, one per territory: a contact-less container holding a city's own
// work (launch plan, newsletter, events) as opposed to the work on any one
// business in it. Id is derived from the territory id so it needs no schema
// of its own — `cl_terr_` + territory.id — and the shared prefix is what
// keeps these out of the client roster (see clientList in Cockpit).
// Territory ids are themselves newId("terr_")-generated, so the leading
// "terr_" is stripped rather than doubled up ("cl_terr_terr_ab12"). Every
// territory id carries that prefix, which makes the strip a bijection — no
// two territories can collide on the container id.
export const TERRITORY_CLIENT_PREFIX = "cl_terr_";
export const territoryClientId = (territoryId: string) => TERRITORY_CLIENT_PREFIX + territoryId.replace(/^terr_/, "");

export const STATUS_META: Record<TaskStatus, { label: string; dot: string; chip: string }> = {
  todo: { label: "To do", dot: "#94a3b8", chip: "#f1f5f9" },
  in_progress: { label: "In progress", dot: "#3b82f6", chip: "#eff6ff" },
  review: { label: "Review", dot: "#f59e0b", chip: "#fffbeb" },
  changes_requested: { label: "Change Requests", dot: "#ef4444", chip: "#fef2f2" },
  done: { label: "Done", dot: "#22c55e", chip: "#f0fdf4" },
};
export const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "changes_requested", "done"];

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
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
