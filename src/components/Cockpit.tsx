"use client";

import { addBusinessDaysIso, addReplyStep, clientEmailText, needsYou, needsYouClearsOn, planSteps, tickedAStep, todayIso } from "@/lib/data";
import { emailMessageKey } from "@/lib/emailFiles";
import { STEP_TOOLS, currentStepLine } from "@/lib/claudeBrief";
import { isClientWait } from "@/lib/afterThis";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  users,
  setUsers,
  initialsOf,
  userById,
  formatDue,
  effectivePriority,
  effectiveStatus,
  TODAY,
  CLAUDE_ID,
  followUpWithDue,
  addDaysIso,
  DUE_BUCKETS,
  dueBucketOf,
  TRIAL_DAYS, trialState, todayPacific,
  STATUS_META,
  STATUS_ORDER, HIDDEN_STATUSES, pickableStatuses,
  viewerDueDate, isOnPlateOf,
  isCompletionEvent, finishKindOf,
  CLIENT_STATUS_META,
  clientStatusMeta,
  type ClientStatus,
  PRIORITY_META,
  PRIORITY_ORDER,
  isManuallyAssignable,
  isMessageConversationTask,
  type Task, type Subtask,
  type TaskStatus,
  type Priority,
  type Client,
  type Project,
  type Contact,
  type Notification,
  type ClientLink,
  type ClientNote,
  type Message,
  type Me,
  type TaskTemplate,
  type VaultFolder,
  type Folder,
  type Stage,
  type DmMessage,
  type Attachment,
  mentionsUser,
  dmConversationId,
  PERSONAL_CLIENT_ID,
  WORKSPACE_CLIENT_ID,
  PERSONAL_PROJECT_ID,
  THIS_WEEK_END,
  NEXT_WEEK_END,
  THIS_MONTH_END,
  isReplyTask,
  unansweredPreviewByTask,
  htmlToText, plainTextToHtml,
  decodeEntities,
} from "@/lib/data";
import { supabase, supabaseReady, authedFetch } from "@/lib/supabase";
import { deleteClientEmailDraft, fetchClientEmailDraft, saveClientEmailDraft, upsertTask, seedIfEmpty, fetchAll, fetchOlderDoneTasks, fetchTaskById, type SyncMarks, fetchContacts, upsertClient, markNotifReadDb, signedUrlForFile, upsertClientNote, upsertVaultFolder, deleteVaultFolderDb, fetchDmReads, markDmReadDb, markMessagesReadDb, fetchAppSetting, upsertAppSetting } from "@/lib/db";
import { WRITE_SETTLE_MS, mergeFetched, tasksWrittenSince } from "@/lib/localTaskWrites";
import SettingsHub, { type TabKey } from "./SettingsHub";
import DmChat from "./DmChat";
import AddClientModal from "./AddClientModal";
import { afterFirstFrame, usePersisted } from "@/lib/usePersisted";
import { usePins } from "./cockpit/usePins";
import { useShareLinks } from "./cockpit/useShareLinks";
import { useNotify } from "./cockpit/useNotify";
import { useAiHelpers } from "./cockpit/useAiHelpers";
import { useComposer, type TaskStart } from "./cockpit/useComposer";
import { fromKey } from "./cockpit/FromNumber";
import { useTaskEdits } from "./cockpit/useTaskEdits";
import { useClientRecords } from "./cockpit/useClientRecords";
import { useClientAdmin } from "./cockpit/useClientAdmin";
import { useTemplates } from "./cockpit/useTemplates";
import { useChecklist } from "./cockpit/useChecklist";
import { useLists } from "./cockpit/useLists";
import { useTaskFiles } from "./cockpit/useTaskFiles";
import { useBoards } from "./cockpit/useBoards";
import { useMessaging } from "./cockpit/useMessaging";
import { useLiveSync } from "./cockpit/useLiveSync";


import { I, Avatar, SideItem, newId, LIST_COLUMNS, SearchableSelect, type FilterState, type SortBy, type ViewPrefs, type Toast } from "./cockpit/ui";
import { MindDumpModal, type ParsedRow } from "./cockpit/MindDumpModal";
import { verbatimTaskRow } from "@/lib/quickAddRow";
import { sidebarWidthFor, canvasMeasure, SIDEBAR_MIN_PX } from "@/lib/sidebarWidth";
import { ClientEmail, type ClientEmailStart } from "./cockpit/ClientEmail";
import { sentEmailFor } from "./cockpit/EmailWindow";
import { draftLinkHtml, escapeHtml } from "@/lib/draftLink";
import { ConfirmModal, PromptModal, ShortcutsModal, LinkFormModal, MergeTaskModal, MergeClientModal, type ConfirmSpec, type PromptSpec } from "./cockpit/modals";
import { CommandK } from "./cockpit/CommandK";
import { GroupedList, InlineDate, friendlyDue } from "./cockpit/GroupedList";
import StageBoard from "./cockpit/StageBoard";
import { TaskDrawer, openStepNext } from "./cockpit/TaskDrawer";
import { FeedbackTab, FEEDBACK_TASK_ID } from "./cockpit/FeedbackTab";
import { appendCommentDb } from "@/lib/db";
import { QuickLinksBar } from "./cockpit/ClientLinks";
import { ClientJournal } from "./cockpit/ClientJournal";
import { ClientsBoard, type WorkBoardGroup, type WorkItem } from "./cockpit/ClientsBoard";
import { ClientsDirectory } from "./cockpit/ClientsDirectory";
import { FinishedFeed, type CompletionRow } from "./cockpit/FinishedFeed";
import { BulkDelegateModal } from "./cockpit/BulkDelegateModal";
import { ProjectsDirectory } from "./cockpit/ProjectsDirectory";
import { orderLists } from "@/lib/listOrder";
import { REMINDER_LINK_LABEL, reminderEmail, reminderGroups } from "@/lib/portalReminders";
import { reminderLine, reminderSettings, type ClientReminders } from "@/lib/reminderSchedule";
import { ClientNeeds } from "./cockpit/ClientNeeds";
import { RemindersView } from "./cockpit/RemindersView";
import { ClientRequestsList } from "./cockpit/ClientRequestsList";
import { orderRequests, requestFromTask, type ClientRequest } from "@/lib/clientRequests";
import { addFoldIns, foldInTasks, type FoldInPick } from "@/lib/foldIn";
import type { FoldInRow } from "./cockpit/FoldInSheet";
import { ClientConversation } from "./cockpit/ClientConversation";
import { sendFromFeed, useClientSavedDraft } from "./cockpit/clientFeedDrafts";
import { collectClientDrafts, emailBeingAnswered, newestLine, taskChoices, waitingLine, waitingOnReply, whereNewMessageGoes, type TalkChannel } from "@/lib/clientConversation";
import { TextWindow } from "./cockpit/TextWindow";
import { loadBookingLinks } from "./cockpit/useCalendar";
import { pickThreeTimes } from "@/lib/improveText";
import { meetingTimesCopy } from "@/lib/meetingTimes";
import { theirTimeZone } from "@/lib/theirTimeZone";

// Read when a click needs the time, never while rendering.
const nowMs = () => Date.now();
import { FolderRail } from "./cockpit/FolderRail";
import { QueueList } from "./cockpit/QueueList";
import { useQueue } from "./cockpit/useQueue";
import { queueSettings, upNextIds } from "../../mcp/queue.mjs";
import InboxView from "./cockpit/inbox/InboxView";
import { CalendarView } from "./cockpit/CalendarBoard";
import { useInbox } from "./cockpit/inbox/useInbox";
import { retireQueuedDraft, useInboxPrefs } from "./cockpit/inbox/inboxPrefs";
import { isAppNotice, type InboxThread } from "./cockpit/inbox/inboxModel";
import { inboxKind, latestCommentBy } from "@/lib/extensionInbox";


import { sortTasks as sortTasksBy } from "@/lib/taskSort";
import { URGENCY_TIER, tierForDate, urgencyDateOf, urgencyKeyFrom } from "@/lib/urgency";
import { type NavState, buildSearch, parseSearch, NAV_KEY_VIEWS, ALL_TASKS_HREF, isPlainLeftClick } from "@/lib/navState";
import { shortcut } from "@/lib/platform";
import { clientFirstName } from "@/lib/clientFirstName";
import { BookAppointment } from "./cockpit/BookAppointment";
import { MeetNowSheet } from "./cockpit/MeetNowSheet";
import { liveMeetingOf } from "@/lib/meetNow";


/** Team chat as Inbox messages: each task's comments (on tasks you own, made,
 *  commented on or were mentioned in), your direct messages, and the team
 *  group. The last 30 days. */
function buildTeamMessages({ meId, meName, users, tasks, dms, feed }: {
  meId: string; meName: string; users: { id: string; name: string }[]; tasks: Task[];
  dms: DmMessage[]; feed: { id: string; author_id: string; body: string; created_at: string }[];
}): Message[] {
  const since = Date.now() - 30 * 86_400_000;
  const team = new Map(users.map((u) => [u.id, u.name]));
  const nameOf = (id: string) => team.get(id) ?? "Teammate";
  const out: Message[] = [];
  const add = (o: { id: string; key: string; title: string; author: string; body: string; at: string; taskId?: string; clientId?: string; attachments?: Attachment[] }) => {
    const t = Date.parse(o.at);
    if (!Number.isFinite(t) || t < since) return;
    out.push({
      id: o.id, contactId: "", clientId: o.clientId ?? "", taskId: o.taskId ?? null, channel: "team",
      direction: o.author === meId ? "outbound" : "inbound", subject: null, body: o.body, ghlMessageId: null,
      createdBy: o.author, at: o.at, read: true, attachments: o.attachments ?? [], cc: [], bcc: [],
      peerName: nameOf(o.author), peerAddress: null, threadKey: o.key, threadTitle: o.title,
    });
  };
  for (const t of tasks) {
    const said = (t.comments ?? []).filter((c) => c.kind !== "event" && team.has(c.authorId));
    if (!said.length) continue;
    const mine = t.assigneeId === meId || t.createdBy === meId || said.some((c) => c.authorId === meId || mentionsUser(c.body, meName));
    if (!mine) continue;
    for (const c of said) add({ id: `tc_${c.id}`, key: `team:task:${t.id}`, title: t.title, author: c.authorId, body: c.body, at: c.at, taskId: t.id, clientId: t.clientId, attachments: c.attachments });
  }
  // Only your own conversations: admins can read every direct message.
  for (const m of dms) {
    if (m.authorId !== meId && m.recipientId !== meId) continue;
    const other = m.authorId === meId ? m.recipientId : m.authorId;
    add({ id: `dm_${m.id}`, key: `team:dm:${other}`, title: nameOf(other), author: m.authorId, body: m.body, at: m.at, attachments: m.attachments });
  }
  const groupTitle = users.filter((u) => u.id !== meId).map((u) => u.name.split(/\s+/)[0]).join(", ") || "Team";
  for (const r of feed) add({ id: `tm_${r.id}`, key: "team:group", title: groupTitle, author: r.author_id, body: r.body, at: r.created_at });
  return out;
}

// ⌘Z: the last action that offered Undo, kept for a minute.
type LastUndo = { id: string; run: () => void; at: number };
function rememberUndo(ref: { current: LastUndo | null }, id: string, run: () => void) { ref.current = { id, run, at: Date.now() }; }
const undoTooOld = (at: number) => Date.now() - at > 60_000;

/** The time, for event handlers (outside the component so the render purity
 *  rule can tell it's never read while drawing). */
const clockNow = () => Date.now();

export default function Cockpit({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  // Your sign in address, which is your Gmail: shown as From in the Inbox.
  const [myEmail, setMyEmail] = useState<string | null>(null);
  // From the saved session, not a call to the server (loading plan step 1).
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setMyEmail(data.session?.user.email ?? null)).catch(() => {}); }, []);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Always-current mirror of `tasks`. Full-row task writes (patchTask/update)
  // build the outgoing row from "before", so a handler that captured `tasks`
  // in a closure and runs later — a bulk confirm dialog, an Undo toast up to
  // ~11s after — would otherwise upsert a stale row and silently clobber a
  // teammate's edit that landed via realtime in the meantime. Reading the ref
  // instead means the merge is always against the latest committed state.
  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [clientLinks, setClientLinks] = useState<ClientLink[]>([]);
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  // The newest change the app has seen in each table that carries updated_at,
  // so the focus refetch asks only for what changed since (db.ts fetchAll).
  const syncMarks = useRef<SyncMarks>({});
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [vaultFolders, setVaultFolders] = useState<VaultFolder[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [clientTab, setClientTab] = useState<"tasks" | "chat">("tasks");
  // Set once from a deep link's ?folder= param (see applyNav); ClientJournal
  // reads it only as its initial folder-filter value, not a live prop.
  const [initialVaultFolder, setInitialVaultFolder] = useState<string | null>(null);
  const [linkModal, setLinkModal] = useState<{ initial?: ClientLink } | null>(null);
  const [ghlLinkOpen, setGhlLinkOpen] = useState(false); // "Link to GHL" contact-picker
  const [ghlLinkSearch, setGhlLinkSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  const [activeClient, setActiveClient] = useState<string>("all");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  // Container rail scope: when set, the client Tasks view shows just this
  // folder's lists' tasks, grouped by list. Mutually exclusive with a single
  // activeProject (a standalone list). Cleared when the client changes.
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  // "My Work" — formerly two separate tabs (an assignee/delegate-filtered
  // task list, and "My Clients"'s assigned-or-following client+project
  // board). Merged into one: the board, under the "My Work" name, since
  // that's the more useful default (VAs still land here first) and the
  // board already covers due-date urgency across everything relevant.
  const [myWork, setMyWork] = useState(me.role === "va");
  // Whose clients the Clients page shows: you, unless an admin picks a
  // teammate (Derek, 2026-10-06: "select Justin or Michaella to see who their
  // clients are"). It was removed once; it is back as a dropdown that starts
  // on you every time.
  const [myWorkUserPicked, setMyWorkUser] = useState<string | null>(null);
  const myWorkUser = myWorkUserPicked ?? me.id;
  const [personalView, setPersonalView] = useState(false);
  const [inboxView, setInboxView] = useState(false);
  // What "← back" says on a task slid over the Inbox: the conversation it came from.
  const [inboxBackLabel, setInboxBackLabel] = useState<string | null>(null);
  // Full-page Clients / Projects directory views (the "Clients" and "Projects"
  // nav links). A distinct mode like inbox/personal — when set, the main pane
  // shows the directory instead of a client/task view. clearViews() below
  // resets it alongside the others.
  // "inbox" is the Inbox (every email, text and task chat, 2026-10-01), a
  // full page like the directories, so it shares their flag.
  const [dirView, setDirView] = useState<"clients" | "projects" | "inbox" | "reminders" | "calendar" | null>(null);
  // Dashboard's own Work/Completed split — Completed relocated here from the
  // Clients directory (Derek: "makes more sense there") — see the myWork
  // content branch below. The Activity tab (notifications inbox) was cut
  // (Derek, 2026-08-24: "not finding it useful... cut the tab" — the notif
  // bell dropdown already covers real mentions/assignments; Activity's own
  // "Unmatched email" section was mostly automated noise — WordPress,
  // Stripe, Amazon — not real leads).
  // No "completed" any more — it moved to All Tasks. Anyone whose stored
  // value still says completed fails this guard and lands back on Work,
  // rather than on a tab that no longer has a button or a view.
  // Plan and Next steps were removed (Derek, 2026-09-28: "we are not using it
  // at all"). Anyone whose remembered tab or deep link still says one of them
  // lands on Work rather than a blank screen.
  // Reviews and Drafts now live in the Inbox (Derek, 2026-10-06: "we don't need
  // review and drafts now because we have the inbox"); a remembered tab or old
  // ?sub= link lands on Work.
  const [dashboardViewStored, setDashboardView] = usePersisted<"work" | "reviews" | "drafts">("dashboardView", "work", (v) => v === "work");
  void dashboardViewStored;
  const dashboardView = "work" as "work" | "reviews" | "drafts";
  void setDashboardView;
  // Reviews sent back and unsent drafts, for the Inbox (cockpit/useBoards),
  // and the Finished marker.
  const {
    openReviews, markReviewHandled, pendingSends, loadPendingSends,
    finishedMarkerAt, openFinished, newFinishedCount,
  } = useBoards({ tasks, tasksRef, showingBoard: dirView === "inbox" ? "inbox" : null, meId: me.id });
  // All Tasks defaults to just your own — admins can flip to "all"; for VAs
  // this is inert either way since scopedTasks already fully restricts them.
  // All Tasks can show the completed log instead of the open list. It moved
  // off My Work (Derek: "on my work move completed tasks to All Tasks"),
  // where it sat behind a third tab on a page that is about what is still
  // open; All Tasks is already the everything view, and the scope dropdown
  // beside this answers "whose".
  const [allTasksCompleted, setAllTasksCompleted] = useState(false);
  // "mine", "all", or one member's id — a two-way toggle could only ever ask
  // "me or everyone", and the question Derek actually has on All Tasks is
  // "what is Michaella carrying" (Derek: "make this a drop down to select all
  // or a user").
  const [allTasksScope, setAllTasksScope] = useState<string>("mine");
  // View preferences survive a refresh AND are kept per section (Derek: "if
  // I change a setting stop resetting it, keep it for that section"). They
  // were one global set of three values, and All Tasks additionally forced
  // its own grouping and sort every time you opened it — so grouping the
  // list by priority held until you clicked away and back, then silently
  // went to due date again.
  //
  // Sections, not individual clients: how you like to read a client's task
  // list is the same thought whichever client it is, and a preference stored
  // once per client would be a preference you have to set thirty-five times.
  const sectionKey = myWork ? "mywork" : personalView ? "personal" : activeProject ? "project" : activeClient === "all" ? "alltasks" : "client";
  // All Tasks opens grouped by when it comes back and sorted by priority
  // (Derek, 2026-09-01). The "due" grouping reads the follow-up date first
  // and falls back to the due date, so a task you said you would look at
  // today sits in Today even when it is not due for a week — which is the
  // whole reason the follow-up date exists. Within a day, priority decides
  // the order: the day says when, the priority says what first.
  //
  // A starting point, used only until you choose otherwise, rather than
  // something reapplied on every visit.
  const SECTION_DEFAULTS: Record<string, ViewPrefs> = {
    alltasks: { groupBy: "due", sortBy: "priority", sortDir: "asc" },
  };
  const FALLBACK_PREFS: ViewPrefs = { groupBy: "priority", sortBy: "due", sortDir: "asc" };
  const [viewPrefs, setViewPrefs] = usePersisted<Record<string, ViewPrefs>>("viewPrefs", {}, (v) => !!v && typeof v === "object" && !Array.isArray(v));
  const prefs = viewPrefs[sectionKey] ?? SECTION_DEFAULTS[sectionKey] ?? FALLBACK_PREFS;
  const setPrefs = (patch: Partial<ViewPrefs>) => setViewPrefs({ ...viewPrefs, [sectionKey]: { ...prefs, ...patch } });
  const groupBy = prefs.groupBy;
  const sortBy = prefs.sortBy;
  const sortDir = prefs.sortDir;
  const setGroupBy = (g: ViewPrefs["groupBy"]) => setPrefs({ groupBy: g });
  const setSortBy = (sb: SortBy) => setPrefs({ sortBy: sb });
  const setSortDir = (d: "asc" | "desc") => setPrefs({ sortDir: d });
  // Remembered in this browser, like group and sort (Derek, 2026-10-12:
  // "whatever settings we select, let's remember them"): Everyone, Mine or
  // Claude, and the View panel's filters.
  const [filters, saveFilters] = usePersisted<FilterState>("viewFilters", { status: "all", assignee: "all", priority: "all" },
    (v) => !!v && typeof v === "object" && typeof (v as FilterState).status === "string" && typeof (v as FilterState).assignee === "string" && typeof (v as FilterState).priority === "string");
  const setFilters = (next: FilterState | ((f: FilterState) => FilterState)) => saveFilters(typeof next === "function" ? next(filters) : next);
  // Title, client, follow up, due (Derek: "on all tasks only show title,
  // client, follow and due date by default"). Stage, priority and created
  // were on by default and are all derivable from what is left: the priority
  // follows the due date, the stage follows how close it is, and nobody scans
  // a list by when a task was made. They are still one click away in Columns.
  // A new storage key, because the old default is already saved in the
  // browser of anyone who has opened the list once.
  const [visibleCols, setVisibleCols] = usePersisted<string[]>("visibleCols2", ["followUp", "due"], (v) => Array.isArray(v) && v.every((x) => typeof x === "string"));
  // Manual drag order for list columns — persisted like the other view
  // toggles below. Any key not yet in a saved order (e.g. after adding a new
  // column) falls back to LIST_COLUMNS' own order in reorderCols/colOrder use.
  const [colOrder, setColOrder] = usePersisted<string[]>("colOrder", LIST_COLUMNS.map((c) => c.key), (v) => Array.isArray(v) && v.every((x) => typeof x === "string"));
  const reorderCols = (keys: string[]) => setColOrder(keys);
  // The old "Filter & view" popover held Following, group/sort, filter, and
  // column config all in one 290px panel — split into three focused menus
  // (item 6) plus Following moving to its own header avatar stack below.
  const [groupSortOpen, setGroupSortOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [hideDone, setHideDone] = usePersisted("hideDone", true, (v) => typeof v === "boolean");

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // A real page, like My Work or Personal — not a popup or slide-out
  // (it used to be a fixed-position overlay; Derek asked more than once for
  // it to render in the normal content area instead).
  const [settingsView, setSettingsView] = useState(false);
  // Lets a deep link (e.g. the "Work with Claude" fallback toast) open
  // Settings straight to a specific tab instead of always landing on
  // Integrations — SettingsHub only reads this once per mount, via its own
  // initialTab prop.
  // A constant since openSettingsTab went: nothing sets it any more, and a
  // useState nobody writes to is a variable pretending to be state.
  const settingsInitialTab: TabKey = "integrations";
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([]);
  // Which DM thread is open, by teammate id. Non-null is the only state
  // that shows a thread: null means no DM page at all (see the render branch
  // further down), so it always moves in lockstep with inboxView.
  const [dmUserId, setDmUserId] = useState<string | null>(null);
  // The conversation open in the Inbox, in the URL so it can be linked.
  const [mailThread, setMailThread] = useState<string | null>(null);
  // Leaving the Inbox closes its conversation, so coming back shows the list
  // (audit 2026-10-10: it reopened the last one). Set while rendering, when
  // the view changes, not in an effect.
  const [mailDir, setMailDir] = useState(dirView);
  if (mailDir !== dirView) { setMailDir(dirView); if (dirView !== "inbox" && mailThread) setMailThread(null); }
  // Shared, admin-controlled — "we don't need DMs for now... make it so we
  // can turn it on and off in case we want it later" (Derek). Off by
  // default; see supabase/app-settings.sql. Fails soft to false (DMs hidden)
  // if that migration hasn't run yet, rather than erroring.
  const [dmEnabled, setDmEnabledState] = useState(false);
  useEffect(() => { fetchAppSetting("dm_enabled", false).then(setDmEnabledState); }, []);
  const setDmEnabled = (v: boolean) => { setDmEnabledState(v); upsertAppSetting("dm_enabled", v); };
  // If an admin turns DMs off while someone's actually looking at a thread,
  // don't leave them stranded on a now-hidden feature — closing the thread
  // drops them back to the view they came from.
  // (Done while rendering, with the other navigation resets below.)
  // Declared up here rather than down with the other layout state because
  // goToView (just below) closes over it — every navigation also dismisses
  // the mobile sidebar.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Every top-level destination resets the same pile of view flags. One
  // helper for all of them so the sidebar click and the keyboard shortcut
  // set identical state by construction rather than by two hand-maintained
  // copies that quietly drift — and so adding a view later is one edit, not
  // five. NAV_KEY_VIEWS maps the number keys onto these.
  const goToView = (view: "dashboard" | "alltasks" | "clients" | "projects" | "personal" | "inbox" | "reminders" | "calendar") => {
    setMyWork(view === "dashboard");
    setPersonalView(view === "personal");
    setInboxView(false);
    setDirView(view === "clients" ? "clients" : view === "projects" ? "projects" : view === "inbox" ? "inbox" : view === "reminders" ? "reminders" : view === "calendar" ? "calendar" : null);
    setDmUserId(null);
    setSettingsView(false);

    setOpenTaskId(null);
    setSidebarOpen(false);
    // Only the two directory views cleared this before; leaving it alone
    // elsewhere preserves the previously-open project when you bounce to
    // Dashboard/Personal/Chat and back.
    if (view === "clients" || view === "projects") setActiveProject(null);
    // All Tasks is the flat everything-list, so it can't stay scoped to one
    // client or project. Its due-date grouping is now a default for that
    // section rather than something reapplied here on every visit, which was
    // overwriting the grouping you had just chosen.
    if (view === "alltasks") {
      setActiveClient("all");
      setActiveProject(null);
    }
  };
  // DM read-state — one "last seen" timestamp per conversation.
  // Read state follows the person, not the browser. It lived in localStorage,
  // which made a message read on a laptop still unread on a desktop and turned
  // a cleared cache into months of resurrected unreads.
  const [dmLastRead, setDmLastRead] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    // One read of the old localStorage value, kept as a seed so nobody's
    // existing read state is thrown away by the move, merged under whatever
    // the server says. Both land in a single setState after the fetch rather
    // than one synchronously in the effect and another later, which is two
    // renders and a warning for no gain — nothing can be read in the
    // milliseconds between them anyway.
    let seed: Record<string, string> = {};
    try {
      const local = JSON.parse(localStorage.getItem("cut_dmLastRead") ?? "{}");
      if (local && typeof local === "object") seed = local;
    } catch {}
    void fetchDmReads(me.id).then((rows) => {
      if (!live) return;
      setDmLastRead({ ...seed, ...rows });
    });
    return () => { live = false; };
  }, [me.id]);
  const markDmRead = (conversationId: string) => {
    const now = new Date().toISOString();
    setDmLastRead((m) => ({ ...m, [conversationId]: now }));
    markDmReadDb(me.id, conversationId, now);
  };
  // Opening a teammate's thread clears the bell notifications they generated —
  // otherwise each "X sent you a message" lingers unread until you open the
  // notification bell, inflating the badge even though you've read the thread.
  const markDmNotifsRead = (partnerId: string) => {
    const ids = notifications.filter((n) => n.recipientId === me.id && n.kind === "dm" && n.actorId === partnerId && !n.read).map((n) => n.id);
    if (!ids.length) return;
    setNotifications((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    ids.forEach((id) => markNotifReadDb(id));
  };
  const dmUnread = (otherUserId: string) => {
    const cid = dmConversationId(me.id, otherUserId);
    return dmMessages.some((m) => m.conversationId === cid && m.authorId !== me.id && m.at > (dmLastRead[cid] ?? ""));
  };
  // Opens a specific teammate's DM thread.
  const openDm = (userId: string) => {
    setInboxView(true); setDmUserId(userId);
    setMyWork(false); setPersonalView(false); setDirView(null); setSettingsView(false);
    setOpenTaskId(null); setSidebarOpen(false);
    markDmRead(dmConversationId(me.id, userId));
    markDmNotifsRead(userId);
  };
  // A DM arriving while its thread is already open is already read.
  const openDmThreadUnread = dmUserId !== null && dmUnread(dmUserId);
  // Two suppressions, both load-bearing. markDmRead still sets the optimistic
  // read marker, so this is a setState in an effect by design: the alternative
  // is the thread you are looking at staying bold until a round trip finishes.
  // And markDmRead is redefined every render, so listing it as a dependency
  // would re-run this on every render and mark the thread read in a loop —
  // what should re-trigger it is the thread changing or becoming unread, which
  // is exactly what is listed.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (dmUserId && openDmThreadUnread) markDmRead(dmConversationId(me.id, dmUserId)); }, [dmUserId, openDmThreadUnread, me.id]);
  const [addClientOpen, setAddClientOpen] = useState(false);
  // Set by the header Email/SMS buttons — jumps the Journal composer into that
  // mode. nonce bumps each click so it re-fires even when already on the Journal.
  const [composeIntent, setComposeIntent] = useState<{ mode: "email" | "sms"; nonce: number; body?: string } | null>(null);
  // Texts open their own window over the page, like email (Derek, 2026-10-05).
  const [clientText, setClientText] = useState<{ clientId: string; body?: string; queuedId?: string; nonce: number } | null>(null);
  // A task opened from a draft on the client's page: its email window opens too.
  const [openTaskEmail, setOpenTaskEmail] = useState<string | null>(null);
  // A task just made from the new task box with step 1's action to start on
  // it (its email window, its step page on a box, the ask to the client).
  const [openTaskStart, setOpenTaskStart] = useState<TaskStart | null>(null);
  const openClientText = (clientId: string, body?: string, queuedId?: string) => setClientText((c) => ({ clientId, body, queuedId, nonce: (c?.nonce ?? 0) + 1 }));
  const openCompose = (mode: "email" | "sms", body?: string) => {
    if (mode === "sms") { openClientText(activeClient, body); return; }
    setClientTab("chat"); setComposeIntent((c) => ({ mode, body, nonce: (c?.nonce ?? 0) + 1 }));
  };
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const [promptDialog, setPromptDialog] = useState<PromptSpec | null>(null);
  // Id of the Conversation task currently being merged elsewhere — drives
  // the target-task picker modal (see requestMerge/mergeTasks).
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  // Client-merge modal: the client it was launched from (a), and optionally a
  // pre-chosen second side (b) when opened from a "possible duplicate" hint.
  const [mergeClientState, setMergeClientState] = useState<{ a: Client; b?: Client } | null>(null);

  // Pins, client sort, manual order and "recently used" (cockpit/usePins).
  const { clientSort, saveClientSort, clientUsed, starred, starredLists, manualOrder, toggleStar, toggleStarList, pinDrag } = usePins(activeClient);
  // Sidebar Clients list defaults to just what you actually have to work on
  // (open task assigned to you, or explicitly followed) instead of every
  // client you can see — same "mine vs. all" idea as allTasksScope, just
  // applied to the client list instead of the task list. Not persisted,
  // same as allTasksScope — always starts scoped down.
  const [clientListScope, setClientListScope] = useState<"mine" | "all">("mine");
  // Clients directory's grouping mode — "status" (default, pipeline stage
  // buckets) or "team" (one section per teammate's own active clients, see
  // teamActiveClients below). Not persisted, same as clientListScope.
  // ("completed" used to live here too; moved under My Work — Derek: "makes
  // more sense there.")
  const [clientsGroupBy, setClientsGroupBy] = useState<"flat" | "team">("flat");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkDelegateOpen, setBulkDelegateOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  // The phone menu's Send feedback opens the Feedback box (its tab is desktop only).
  const [feedbackNonce, setFeedbackNonce] = useState(0);
  // New Client settings sheet (item 7) — replaces the three standing toggles
  // that used to live directly in the kebab menu (a menu mixing persistent
  // toggles with one-shot actions gave no signal about what closes it).
  const [clientSettingsOpen, setClientSettingsOpen] = useState(false);

  // Realtime echo suppression for `clients` writes. Admin-only, low-frequency
  // writes — a short TTL ledger is proportionate here (unlike tasks, which
  // get a server-confirmed `updated_by` column instead — see below — because
  // keystroke-driven task writes make a timing-window ledger risky).
  const clientWriteLedgerRef = useRef<Map<string, number>>(new Map());
  const CLIENT_ECHO_TTL_MS = 5000;
  const markOwnClientWrite = (id: string) => clientWriteLedgerRef.current.set(id, clockNow());
  const isOwnClientEcho = (id: string) => {
    const ts = clientWriteLedgerRef.current.get(id);
    if (ts === undefined) return false;
    clientWriteLedgerRef.current.delete(id);
    return clockNow() - ts < CLIENT_ECHO_TTL_MS;
  };

  const setClientStatus = (id: string, status: ClientStatus) => {
    const c = clientById(id);
    if (!c || c.status === status) return;
    // Conversion moment: a prospect that reaches active_client has
    // stopped being a prospect, so it joins the real client roster here.
    // One-way on purpose — moving a client back to an earlier stage is a
    // lifecycle correction, not a reason to hide it from the sidebar again.
    //
    // "onboarding" (Listing Launch) used to promote too, and that was the
    // bug: it fires a full step BEFORE the business is actually won and
    // paying, so unclosed deals landed on the main dashboard alongside real
    // clients. active_client is now the sole trigger.
    // risked a real business silently never reaching the main dashboard
    // because nobody remembered to tick it, worse than today's imperfect but
    // reliable trigger. So the Stage dropdown stays the driver, and now also
    // catches the sales pipeline up to match whatever it's just confirmed —
    // both directions stay in sync, drift goes away, and the dropdown keeps
    // being the one control reps already reach for.
    const promoted = c.type === "prospect" && status === "active_client";
    // The 14-day trial starts at that same moment, and only ever once: a
    // client already carrying inTrial (or reaching active_client a second
    // time, or already type "client") keeps its original window, so a
    // routine re-save can't push the end date out.
    const startsTrial = promoted && c.inTrial !== true;
    const nc: Client = {
      ...c, status,
      ...(promoted ? { type: "client" as const } : {}),
      ...(startsTrial ? { inTrial: true, trialEndsAt: addDaysIso(TODAY, TRIAL_DAYS) } : {}),
    };
    setClients((cs) => cs.map((x) => (x.id === id ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(promoted ? `${c.name} → ${CLIENT_STATUS_META[status].label} · now a client` : `${c.name} → ${CLIENT_STATUS_META[status].label}`);
  };
  // "Follow" a client: adds/removes a team member from assigned_to, which
  // supabase/client-assignment.sql's RLS lets that person see the client
  // (and its projects/tasks/links/notes/messages) even with zero tasks
  // assigned to them there yet.
  const toggleClientAssignment = (clientId: string, memberId: string) => {
    const c = clientById(clientId);
    if (!c) return;
    const current = c.assignedTo ?? [];
    const nc = { ...c, assignedTo: current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId] };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
  };
  // Per-client-per-VA send permission (layered on top of the global
  // profiles.can_send_messages) — NOT a visibility grant, purely gates
  // /api/ghl/message server-side. Admin-only UI (clients_write RLS enforces
  // that server-side too — a VA calling this directly would just get a
  // silently-ignored write).
  const toggleClientMessagePermission = (clientId: string, memberId: string) => {
    const c = clientById(clientId);
    if (!c) return;
    const current = c.canMessage ?? [];
    const nc = { ...c, canMessage: current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId] };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
  };
  // One switch on a client, flipped and saved. These were the same twenty
  // lines written out twice, differing only in which column they wrote and
  // what the toast said.
  //
  // Admin only, like everything in this sheet: clients_write RLS is is_admin(),
  // so a VA calling one of these gets a silently ignored write. Every route
  // that acts on one of these columns re-reads it server side, so a toggle
  // here is the decision and never the enforcement.
  const toggleClientFlag = (
    clientId: string,
    key: "canRequestNewTasks" | "portalShowsAllTasks",
    toast: (name: string, on: boolean) => string,
  ) => {
    const c = clientById(clientId);
    if (!c) return;
    const on = c[key] !== true;
    const nc = { ...c, [key]: on };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(toast(c.name, on));
  };
  // Whether this client's public page (/waiting/[token]) offers the "Add
  // Something" composer that raises a brand new task, or stays reply only.
  // Off by default. /api/waiting/[token]/request re-reads the column before it
  // writes anything.
  const toggleClientCanRequestNewTasks = (clientId: string) =>
    toggleClientFlag(clientId, "canRequestNewTasks", (name, on) =>
      on ? `${name} can now add their own requests.` : `${name} can no longer add their own requests.`);
  // How much of the account the client portal shows. Off means only what
  // involves them (waiting on their input, or already replied to); on means
  // every non-private task on the account, which is real exposure: internal
  // work becomes readable by the client. Per client for that reason, never
  // global.
  const toggleClientPortalShowsAllTasks = (clientId: string) =>
    toggleClientFlag(clientId, "portalShowsAllTasks", (name, on) =>
      on ? `${name} now sees every task on their account.` : `${name} now only sees what involves them.`);

  // Ending a trial by hand. The window is stamped once, when the deal closes,
  // and deliberately never re-stamped, so a routine save cannot push the end
  // date out (see setClientStatus). That left no way to close one either: a
  // client who cancelled in week one carried "in trial" until the date caught
  // up. This clears the flag and KEEPS the date, so what was promised is still
  // on the record and trialState can tell an early close from a natural end.
  const endClientTrial = (clientId: string) => {
    const c = clientById(clientId);
    if (!c || c.inTrial !== true) return;
    const nc = { ...c, inTrial: false };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(`${c.name}'s trial is closed.`);
  };

  // Point a client at a synced GHL contact (or null to unlink). Used for
  // clients whose id isn't itself a contact id, so GHL features can't derive
  // one from the id — see contactForClient.
  const linkClientToContact = (clientId: string, contactId: string | null) => {
    const c = clientById(clientId);
    if (!c) return;
    const nc = { ...c, linkedContactId: contactId };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(contactId ? `Linked to GoHighLevel — ${contactById(contactId)?.name ?? "contact"}` : "Unlinked from GoHighLevel");
  };
  // AI relationship summary (Gemini) — only ever called from the task
  // drawer's "Regenerate" button, never automatically, so opening a task
  // never spends money. The server route (/api/ai/summary) does the actual
  // Supabase write; this just reflects that result into local state.
  const [aiSummaryBusyId, setAiSummaryBusyId] = useState<string | null>(null);
  // "Add tasks from a list" — paste notes, AI splits them, you review, then
  // they're created (Derek, 2026-08-26). Parsing and creating are separate
  // steps by design: nothing reaches the database until it's been seen.
  // The email window for a client outside any task: the Journal's Email and
  // Reply, and Remind client (ClientEmail.tsx). Sending goes through the ordinary
  // send path: same can-message gating, same journal entry, same thread.
  const [clientEmail, setClientEmail] = useState<ClientEmailStart | null>(null);
  // The client page's Conversation, open beside the list (Derek, 2026-10-14):
  // the client it is open for, so it closes on its own when you go elsewhere.
  const [feedClient, setFeedClient] = useState<string | null>(null);
  // What we need from a client, open over their page (ClientRequestsList).
  const [needsFor, setNeedsFor] = useState<string | null>(null);
  // Moves when the client's saved email changes outside its window (Remind, a send from the feed).
  const [savedDraftNonce, setSavedDraftNonce] = useState(0);
  // Another client's page starts with it closed.
  const [feedSeenClient, setFeedSeenClient] = useState(activeClient);
  if (feedSeenClient !== activeClient) { setFeedSeenClient(activeClient); if (feedClient !== null && feedClient !== activeClient) setFeedClient(null); }
  const openClientEmail = (clientId: string, start: Omit<ClientEmailStart, "clientId" | "nonce"> = {}) =>
    setClientEmail((c) => ({ ...start, clientId, nonce: (c?.nonce ?? 0) + 1 }));
  // "We're still waiting on these" nudge, raised from the Review controls: the
  // reminder is written for them and opens for review before it goes. The portal
  // link is resolved on the click, not during render: getClientShareUrl mints and
  // persists a share token the first time it's called for a client.
  const remindDraftFor = (clientId: string) => {
    const name = clientById(clientId)?.name ?? "";
    const firstName = clientFirstName(contactForClient(clientId), name, "there");
    const waiting = waitingTasksFor(clientId);
    const url = getClientShareUrl(clientId);
    if (!url) pushToast("No portal link could be made for this client, so the reminder has no link. An admin needs to create the share link first.");
    const link = url ? { url, label: REMINDER_LINK_LABEL } : null;
    // Counts only, by list, never the tasks themselves, and the portal is
    // where they answer, not a reply (Derek, 2026-10-14). The same words the
    // 8 AM job sends (lib/portalReminders reminderEmail).
    const email = reminderEmail({ firstName, groups: reminderGroups(waiting, projectsForClient(clientId)), link });
    return { subject: email?.subject ?? "", body: email?.body ?? "", link, aiContext: email?.aiContext ?? "" };
  };
  // A client's reminder schedule, from the waiting card (Derek, 2026-10-14).
  // Admin only, like the portal switches: clients_write RLS is is_admin().
  // "since" moves only when the days change, so turning sends itself on or
  // off doesn't restart an every few days count.
  const setClientReminders = (clientId: string, next: ClientReminders) => {
    const c = clientById(clientId);
    if (!c) return;
    const before = reminderSettings(c.reminders ?? null);
    const r = reminderSettings(next);
    const sameDays = before.schedule === r.schedule && before.every === r.every && String(before.days ?? []) === String(r.days ?? []);
    const nc: Client = { ...c, reminders: { ...r, since: sameDays && before.since ? before.since : todayPacific() } };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(`${c.name}: ${reminderLine(nc.reminders)}`);
  };
  // Remind, from the client page (Derek, 2026-10-14): the reminder is written
  // as their saved email and shows as a draft in the Conversation, opened
  // beside the list, to read and send there. One saved email at a time, as
  // the email window keeps it: one already started is only replaced on a yes.
  const remindAsDraft = async (clientId: string) => {
    const start = remindDraftFor(clientId);
    const saved = await fetchClientEmailDraft(clientId);
    const name = clientById(clientId)?.name ?? "this client";
    setFeedClient(clientId);
    if (saved && htmlToText(saved.body).trim() && !window.confirm(`You already started an email to ${name}. Replace it with the reminder?`)) return;
    const now = new Date().toISOString();
    await saveClientEmailDraft(clientId, { subject: start.subject, body: start.body, link: start.link, aiContext: start.aiContext, replyTo: null, createdAt: now, updatedAt: now }, me.id);
    setSavedDraftNonce((n) => n + 1);
    pushToast("The reminder is a draft in the conversation, ready to read and send.");
  };
  // Send client link (Derek, 2026-10-05): the portal link in an email to them,
  // opened for review before it goes. From a list, the link opens on that list.
  const openSendClientLink = (clientId: string, projectId?: string | null) => {
    const name = clientById(clientId)?.name ?? "";
    const firstName = clientFirstName(contactForClient(clientId), name, "there");
    const url = getClientShareUrl(clientId, projectId ? { projectId } : undefined);
    if (!url) return;
    const link = { url, label: "Open your page" };
    openClientEmail(clientId, {
      subject: "Your page for everything we're working on",
      body: `<p>Hi ${escapeHtml(firstName)},</p><p>Here is your own page for everything we're working on together. You can see what we need from you, what's in progress and what's done, add a new request, and upload files. No login needed, so bookmark it.</p>${draftLinkHtml(link)}<p>Thanks!</p>`,
      link,
      aiContext: "Sending the client the link to their own page, where they see what we need from them, what is in progress and what is done, and can add requests and upload files.",
    });
  };
  // Request a meeting (Derek, 2026-10-05): three open times from your default
  // calendar (else your first) and its booking page, as an email or a text
  // that opens for you to check. Nothing is booked until they pick.
  const requestMeeting = async (clientId: string, channel: "email" | "sms", defaultCalendarId: string | null) => {
    const first = clientFirstName(contactForClient(clientId), clientById(clientId)?.name, "there");
    // Their time zone is asked for at the same time as the open times (Derek,
    // 2026-10-15: "my time and their time"), so it adds no wait of its own.
    const theirTz = theirTimeZone(contactForClient(clientId));
    const links = await loadBookingLinks();
    const cal = links.find((l) => l.calendarId === defaultCalendarId) ?? links.find((l) => l.memberId === me.id) ?? links[0];
    if (!cal) { pushToast("No GoHighLevel calendar found to offer times from."); return; }
    let times: string[] = [];
    try {
      const r = await authedFetch(`/api/calendar/slots?calendarId=${encodeURIComponent(cal.calendarId)}&days=7`);
      const j = await r.json().catch(() => ({}));
      times = pickThreeTimes(j.slots ?? [], nowMs());
    } catch { /* the link alone still works */ }
    const copy = meetingTimesCopy(times, await theirTz);
    if (channel === "sms") {
      const body = [`Hi ${first}, do you have time to meet this week?`, copy.smsSentence, `Or pick any time here: ${cal.url}`].filter(Boolean).join(" ");
      openClientText(clientId, body);
      return;
    }
    const link = { url: cal.url, label: "Pick a time that works for you" };
    openClientEmail(clientId, {
      subject: "Time to meet?",
      body: `<p>Hi ${escapeHtml(first)},</p><p>Do you have time to meet this week?${times.length ? ` ${copy.emailIntro}` : ""}</p>`
        + (times.length ? `<ul>${copy.lines.map((t) => `<li><p>${escapeHtml(t)}</p></li>`).join("")}</ul>` : "")
        + `${draftLinkHtml(link)}<p>Thanks!</p>`,
      link,
      aiContext: `Asking the client to meet. ${copy.aiTimes} Booking link: ${cal.url}`,
    });
  };
  // The mind-dump composer. Null when closed; otherwise the group its plus
  // was clicked on (null key = the toolbar button, which belongs to no group).
  // clientId is set when the composer is opened from somewhere with no client
  // on screen (the header on Tasks), where it is chosen inside the composer.
  // Null means "whatever client is open", which is every other way in.
  const [dumpGroup, setDumpGroup] = useState<{ key: string | null; personal: boolean; clientId?: string | null } | null>(null);
  const [bulkAddBusy, setBulkAddBusy] = useState(false);
  const parseTaskList = async (text: string): Promise<ParsedRow[] | null> => {
    setBulkAddBusy(true);
    try {
      const res = await authedFetch("/api/ai/parse-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, roster: users.map((u) => u.name), clientName: clientById(activeClient)?.name ?? "", today: TODAY }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Couldn't read that list."); return null; }
      // followUpAt/size are the modal's to fill from its defaults — the AI is
      // never asked to guess either one.
      return (j.tasks as ParsedRow[]).map((t) => ({ ...t, followUpAt: null, size: null, keep: true }));
    } catch {
      pushToast("Couldn't read that list.");
      return null;
    } finally {
      setBulkAddBusy(false);
    }
  };
  // The composer's other button: one task, grammar cleaned up, created
  // straight away with no review step (Derek, 2026-09-09: "sometimes we have
  // to just add a task quickly, other times we want to add a list of
  // tasks"). Same endpoint as parseTaskList, just told not to split — see
  // api/ai/parse-tasks' single flag. If the AI call fails, quick add still
  // has to work: it falls back to the raw text itself (first line as the
  // title, the rest as description) rather than blocking on Gemini being
  // slow or down, which the review path is allowed to do because a person is
  // about to look the result over anyway.
  const aiAddTask = async (text: string): Promise<ParsedRow | null> => {
    setBulkAddBusy(true);
    try {
      const res = await authedFetch("/api/ai/parse-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, single: true, roster: users.map((u) => u.name), clientName: clientById(activeClient)?.name ?? "", today: TODAY }),
      });
      const j = await res.json().catch(() => ({}));
      const t = (j.tasks as ParsedRow[] | undefined)?.[0];
      if (!res.ok || j.error || !t) return verbatimTaskRow(text);
      return { ...t, followUpAt: null, size: null, keep: true };
    } catch {
      return verbatimTaskRow(text);
    } finally {
      setBulkAddBusy(false);
    }
  };
  // Which date the plus you clicked implies. The bucket wins over the three
  // day default, because opening the composer from "Tomorrow" and getting a
  // task due next Tuesday reads as a bug (Derek, 2026-09-04). Buckets with no
  // single honest date of their own (Overdue, Later, No date) fall back to
  // the default, and so does every non-date grouping.
  const dueForGroup = (groupKey: string | null): string | null => {
    if (!groupKey || groupBy !== "due") return null;
    if (groupKey === "today") return TODAY;
    if (groupKey === "tomorrow") return addDaysIso(TODAY, 1);
    if (groupKey === "week") return THIS_WEEK_END;
    if (groupKey === "nextWeek") return NEXT_WEEK_END;
    if (groupKey === "month") return THIS_MONTH_END;
    return null;
  };

  const toggleHideDone = () => setHideDone(!hideDone);
  const [drawerFull, setDrawerFull] = useState(false);
  useEffect(() => afterFirstFrame(() => setDrawerFull(localStorage.getItem("cut_drawerFull") === "1")), []);
  // Navigation resets, made while rendering when what they hang on changes
  // ("adjusting state when a prop changes"), not in effects that drew the
  // screen twice for each (2026-10-11, the last lint errors here). Same
  // rules as before:
  // - leaving a project's client (or entering My Work) drops the project filter;
  // - the folder-rail scope clears when the client or view changes;
  // - a bulk selection is scoped to the list on screen, so any navigation
  //   clears it rather than leave the bar acting on rows you can't see;
  // - Links/Notes/health are one client's, so a new client lands on Tasks;
  // - DMs switched off while one is open closes it.
  const navNow = { activeClient, myWork, personalView, inboxView, settingsView, dirView, activeProject, projects, dmEnabled, dmUserId };
  const [navPrev, setNavPrev] = useState(navNow);
  const navChanged = (...keys: (keyof typeof navNow)[]) => keys.some((k) => navPrev[k] !== navNow[k]);
  if (navChanged("activeClient", "myWork", "personalView", "inboxView", "settingsView", "dirView", "activeProject", "projects", "dmEnabled", "dmUserId")) {
    setNavPrev(navNow);
    if (navChanged("activeClient", "myWork", "personalView", "inboxView", "settingsView", "projects"))
      setActiveProject((p) => (p && projects.find((x) => x.id === p)?.clientId === activeClient && !myWork && !personalView && !inboxView && !settingsView ? p : null));
    if (navChanged("activeClient", "myWork", "personalView", "inboxView", "dirView")) setActiveFolder(null);
    if (navChanged("activeClient", "activeProject", "myWork", "personalView", "inboxView")) setSelectedTaskIds(new Set());
    if (navChanged("activeClient", "myWork")) setClientTab("tasks");
    if (!dmEnabled && dmUserId !== null) setDmUserId(null);
  }

  // --- Deep-link URL sync ---------------------------------------------------
  const currentNav = (): NavState => ({
    view: settingsView ? "settings" : dirView === "inbox" ? "mail" : dirView ?? (myWork ? "work" : personalView ? "personal" : inboxView ? "inbox" : null),
    client: activeClient, project: activeProject, task: openTaskId,
    clientTab, vaultFolder: null, // read from an old folder link on load, never written as you browse
    dm: inboxView ? dmUserId : null,
    thread: dirView === "inbox" ? mailThread : null,
    assignee: activeClient === "all" ? allTasksScope : null,
    sub: myWork ? (dashboardView === "work" ? null : dashboardView) : (showCompletedLog ? "completed" : null),
  });
  const applyNav = (s: NavState) => {
    setSettingsView(s.view === "settings");
    setMyWork(s.view === "work"); setPersonalView(s.view === "personal");
    // "inbox" is a DM thread and nothing else now that Team Chat is gone, so a
    // bare view=inbox with no dm (an old bookmark) must not open a blank page.
    setInboxView(s.view === "inbox" && !!s.dm);
    setDmUserId(s.view === "inbox" ? s.dm : null);
    setMailThread(s.view === "mail" ? s.thread ?? null : null);
    setDirView(s.view === "clients" || s.view === "projects" || s.view === "calendar" || s.view === "reminders" ? s.view : s.view === "mail" ? "inbox" : null);
    setActiveClient(s.view ? "all" : s.client); setActiveProject(s.view ? null : s.project);
    setOpenTaskId(s.task);
    if (s.clientTab) setClientTab(s.clientTab);
    setInitialVaultFolder(s.vaultFolder);
    // Explicit reset to "mine" when absent, not a no-op — a shared link with
    // no ?assignee= (or the back button landing on one) has to show the
    // default, not whatever this browser happened to have selected already.
    if (!s.view && s.client === "all") setAllTasksScope(s.assignee ?? "mine");
    // Same reasoning as the assignee above: absent means the default half of
    // the view, not whatever this browser was last left on.
    if (s.view === "work") setDashboardView(s.sub === "reviews" || s.sub === "drafts" ? s.sub : "work");
    if (!s.view && s.client === "all") {
      // A link straight into Finished is looking at it, the same as the button.
      if (s.sub === "completed" && !allTasksCompleted) openFinished();
      setAllTasksCompleted(s.sub === "completed");
    }
  };
  // The URL-writing effect below is inert until this flips, so nothing can
  // clobber the deep link before we read it here.
  const hydratedRef = useRef(false);
  // Restore from the URL once data is loaded (so project ids resolve, not get
  // reconciled away). An empty URL keeps the role-based defaults untouched.
  useEffect(() => {
    if (hydratedRef.current || loading) return;
    hydratedRef.current = true;
    const search = window.location.search;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (search) applyNav(parseSearch(search));
  }, [loading]);
  // Mirror state → URL on every navigation. Skip until hydrated, and no-op when
  // the URL already matches (covers hydration and back/forward round-trips).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const next = buildSearch(currentNav());
    // A link that says the same view another way (the sidebar's Tasks link,
    // ?assignee=mine, opened in a new tab) is tidied in place, not pushed as a
    // second history entry that Back would land on to no effect.
    const sameView = buildSearch(parseSearch(window.location.search)) === next;
    if (next !== window.location.search) window.history[sameView ? "replaceState" : "pushState"](null, "", next || window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsView, dirView, myWork, personalView, inboxView, activeClient, activeProject, openTaskId, clientTab, dmUserId, mailThread, allTasksScope, dashboardView, allTasksCompleted]);
  // Back/forward → state.
  useEffect(() => {
    const onPop = () => applyNav(parseSearch(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const toggleDrawerFull = () => setDrawerFull((f) => { const v = !f; try { localStorage.setItem("cut_drawerFull", v ? "1" : "0"); } catch {} return v; });
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdkOpen(true); return; }
      // "?" lists the rest of them. Not while typing, where it is punctuation,
      // and not with a modifier held, which belongs to the browser.
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Jump to a top-level view with a single number key, in sidebar order:
  // 1 My Work, 2 All Tasks, 3 Clients, 4 Projects, 5 Personal. The list lives
  // in NAV_KEY_VIEWS; 2 was missing, so the sidebar's second row was the one
  // thing you could not reach this way.
  //
  // Bare keys rather than Cmd/Ctrl+1-5: browsers reserve Cmd/Ctrl+1-9 for
  // tab switching and never hand the event to the page at all (Chrome,
  // Safari and Edge don't dispatch it; Firefox dispatches but ignores
  // preventDefault), deliberately, so keyboard-only users can't be trapped
  // in a page. A modifier version is therefore impossible here, not just
  // inadvisable. Bare keys also match the j/k task navigation this app
  // already uses.
  //
  // The refs let this bind once instead of re-registering the listener on
  // every render, while still calling the current render's goToView. Both
  // are written from an effect, not during render.
  const goToViewRef = useRef(goToView);
  const navBlockedRef = useRef(false);
  // Read through a ref so the listener below can stay mounted once, the same
  // way goToView does.
  const openComposerRef = useRef<() => void>(() => {});
  useEffect(() => { goToViewRef.current = goToView; });
  // Don't navigate out from under anything holding work in progress — a
  // dialog asking for an answer, or an open task. A number key reaching the
  // task drawer closed it and switched view, taking an unsaved title, next
  // step or half-typed comment with it; focus only has to be off the field
  // (after a chip or a checkbox click, say) for the key to arrive here.
  useEffect(() => {
    navBlockedRef.current = !!confirmDialog || !!promptDialog || !!linkModal || cmdkOpen
      || !!openTaskId || !!dumpGroup || !!mergeSourceId || !!mergeClientState || addClientOpen || shortcutsOpen || bulkDelegateOpen;
  }, [confirmDialog, promptDialog, linkModal, cmdkOpen, openTaskId, dumpGroup, mergeSourceId, mergeClientState, addClientOpen, shortcutsOpen, bulkDelegateOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (navBlockedRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      // A bare key, like the nav digits and j/k beside it: every Cmd and Ctrl
      // combination worth having is taken by the browser, and c is one key
      // under the left hand. navBlockedRef already covers dumpGroup, so it
      // cannot reopen on top of itself.
      if (e.key === "c") { e.preventDefault(); openComposerRef.current(); return; }
      const view = NAV_KEY_VIEWS[e.key];
      if (!view) return;
      e.preventDefault();
      goToViewRef.current(view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("light");
  const [sidebarHidden, setSidebarHidden] = useState(false);
  useEffect(() => afterFirstFrame(() => setSidebarHidden(localStorage.getItem("cut_sidebarHidden") === "1")), []);
  // Theme: light/dark/auto, persisted as cut_theme. Auto resolves off the
  // clock (dark 19:00–6:59) rather than prefers-color-scheme — there's no
  // OS-level dark-mode signal in play here, just "dim it in the evening".
  useEffect(() => afterFirstFrame(() => {
    const saved = localStorage.getItem("cut_theme");
    if (saved === "light" || saved === "dark" || saved === "auto") setTheme(saved);
  }), []);
  const resolveTheme = (t: "light" | "dark" | "auto"): "light" | "dark" => {
    if (t !== "auto") return t;
    const h = new Date().getHours();
    return h >= 19 || h < 7 ? "dark" : "light";
  };
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme);
    if (theme !== "auto") return;
    const id = setInterval(() => { document.documentElement.dataset.theme = resolveTheme(theme); }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [theme]);
  const toggleSidebar = () => {
    setSidebarHidden((h) => { const v = !h; try { localStorage.setItem("cut_sidebarHidden", v ? "1" : "0"); } catch {} return v; });
    setSidebarOpen((o) => !o); // mobile overlay uses the same button
  };

  // Which of the 5 top nav items (Inbox/All tasks/My Work/My Clients/
  // Personal) each person wants visible — personal display preference, not
  // an admin setting, so every role can customize their own sidebar.
  // The four primary nav items always show now — the hide/show toggle went
  // away when the account block replaced the sidebar's branding header. Kept
  // as a lookup so the render below stays unchanged.
  // All Tasks is back as a primary nav item under My Work (Derek,
  // 2026-08-26) after a spell as a de-emphasized button on the Dashboard
  // header. It's a plain goToView case now rather than its own hand-rolled
  // copy of the same flag resets — that copy had already drifted, forgetting
  // to clear activeProject, so arriving from inside a project left the
  // "everything" list still filtered down to it.
  const openAllTasks = () => goToView("alltasks");

  useEffect(() => {
    (async () => {
      try {
        if (!supabaseReady) { setDbError("Supabase env vars are missing."); return; }
        // The team and everything else at once, not one after the other
        // (loading plan step 1, 2026-10-10): the roster used to wait on a
        // seed check, then two reads of profiles, before fetchAll started.
        // Avatars ride in the same read; without that column yet (before
        // supabase/avatars.sql) it's read again without it.
        const roster = (async () => {
          const first = await supabase.from("profiles").select("id, name, email, role, member_id, color, avatar_url");
          const profs = first.error ? (await supabase.from("profiles").select("id, name, email, role, member_id, color")).data : first.data;
          if (!profs?.length) return;
          const seen = new Set<string>();
          setUsers(profs.flatMap((p: { id: string; name: string | null; email: string | null; role: string | null; member_id: string | null; color: string | null; avatar_url?: string | null }) => {
            const id = p.member_id || p.id;
            if (seen.has(id)) return [];
            seen.add(id);
            const name = p.name || p.email || "Teammate";
            return [{ id, name, initials: initialsOf(name), color: p.color || "#a855f7", role: p.role === "admin" ? "admin" as const : "va" as const, ...(p.avatar_url ? { avatarUrl: p.avatar_url } : {}) }];
          }));
        })().catch(() => { /* roster is best-effort; founder fallback stays */ });
        let d = await fetchAll(undefined, { contacts: false, me: me.id });
        // A brand new, empty database gets the demo data, then reads again.
        if (!d.clients.length) { await seedIfEmpty(); d = await fetchAll(undefined, { contacts: false, me: me.id }); }
        // Contacts right after the first screen, not before it (loading plan
        // step 4): what needs them (a client's page, the Inbox's people,
        // search) is a click or two away.
        void fetchContacts().then(setContacts, () => { /* the 15 minute refresh tries again */ });
        await roster;
        syncMarks.current = d.marks;
        // Merged, not replaced: a task or conversation fetched on its own while
        // this was in flight (an old task opened from a link) stays.
        setClients(d.clients); setProjects(d.projects); if (d.contacts) setContacts(d.contacts); setTasks((prev) => mergeFetched(prev, d.tasks)); setNotifications(d.notifications);
        setClientLinks(d.clientLinks); setClientNotes(d.clientNotes); setMessages((prev) => mergeFetched(prev, d.messages));
        setTaskTemplates(d.taskTemplates);
        setVaultFolders(d.vaultFolders);
        setFolders(d.folders);
        setStages(d.stages);
        setDmMessages(d.dmMessages);
      } catch (e) {
        setDbError(e instanceof Error ? e.message : "Failed to load data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [me.id]); // you, for the start load; the same for the whole sign in

  // Map indices — clientById/projectById/tasksById used to be linear .find()
  // scans over the full arrays, called from many places per render (often
  // several times per client/task). O(1) lookups instead.
  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const clientById = (id: string) => clientsById.get(id) ?? null;
  const projectById = (id: string) => projectsById.get(id) ?? null;
  const contactById = (id: string | null) => contacts.find((c) => c.id === id) ?? null;

  const setThemePref = (next: "light" | "dark" | "auto") => {
    setTheme(next);
    try { localStorage.setItem("cut_theme", next); } catch {}
  };

  // Toasts with an action (undo) linger ~4x longer — 2.8s is not enough time
  // to read what happened and decide to reverse it.
  // quiet: no toast, but ⌘Z can still undo it (Derek, 2026-10-05: deleting
  // fast stacked a toast per conversation; the Trash keeps them anyway).
  const pushToast = (text: string, action?: { label: string; run: () => void }, secondaryAction?: { label: string; run: () => void }, opts?: { quiet?: boolean }) => {
    const id = newId("toast_");
    if (opts?.quiet) { if (action && /^undo$/i.test(action.label)) rememberUndo(lastUndoRef, id, action.run); return; }
    const lifetime = action ? 11000 : 2800;
    setToasts((t) => [...t, { id, text, action, secondaryAction }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), lifetime);
    if (action && /^undo$/i.test(action.label)) rememberUndo(lastUndoRef, id, action.run);
  };
  // ⌘Z (Ctrl+Z) undoes the last thing that offered Undo, for a minute after
  // (Derek, 2026-10-02). Not while typing: there it is the box's own undo.
  const lastUndoRef = useRef<LastUndo | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const last = lastUndoRef.current;
      if (!last || undoTooOld(last.at)) return;
      e.preventDefault();
      lastUndoRef.current = null;
      setToasts((t) => t.filter((x) => x.id !== last.id));
      last.run();
      pushToast("Undone");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const dismissToast = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  // Copy a shareable deep link (see buildSearch) to the clipboard.
  // Same URL copyLink puts on the clipboard, returned instead of copied, so a
  // DM about a task can carry a way back to it.
  const linkTo = (nav: NavState) => `${window.location.origin}${window.location.pathname}${buildSearch(nav)}`;
  // One way to land on a client's list, used by the drawer's breadcrumb and
  // by clicking a client name in a task row. Inlined in two places it would
  // drift: every one of these setters has to fire or you land on the right
  // client inside the wrong view.
  const openClientList = (clientId: string, projectId?: string | null) => {
    setMyWork(false); setPersonalView(false); setInboxView(false);
    setDmUserId(null); setSettingsView(false); setDirView(null);
    setActiveClient(clientId);
    if (projectId !== undefined) setActiveProject(projectId);
    setClientTab("tasks");
    setOpenTaskId(null);
  };
  const copyLink = (nav: NavState) => {
    const url = linkTo(nav);
    navigator.clipboard?.writeText(url).then(() => pushToast("🔗 Link copied"), () => pushToast("⚠️ Couldn't copy link"));
  };
  // A folder link is just the current client/project link with tab=chat
  // and folder=<id> layered on — built fresh at click time, not mirrored
  // into the live URL bar as you browse (see currentNav's vaultFolder note).
  // A failed save is not a passing event, it is a state: the screen is showing
  // something the database refused, and it will keep showing it until the page
  // is reloaded. A toast said so once and then took the evidence away with it.
  //
  // db.ts's save() retries a few times first, so anything that reaches here has
  // already failed a dropped connection's worth of attempts.
  const [unsaved, setUnsaved] = useState(0);
  useEffect(() => {
    const onUnsaved = (e: Event) => {
      const n = (e as CustomEvent<number>).detail ?? 0;
      // Deferred out of the event handler: this fires from inside a write that
      // may itself be mid-render elsewhere.
      requestAnimationFrame(() => setUnsaved(n));
    };
    window.addEventListener("cut:unsaved", onUnsaved);
    return () => window.removeEventListener("cut:unsaved", onUnsaved);
  }, []);

  // Live updates from other people, and the catch up when the tab comes back
  // into view (cockpit/useLiveSync).
  useLiveSync({
    loading, meId: me.id, syncMarks, pushToast, isOwnClientEcho,
    setTasks, setClients, setProjects, setContacts, setNotifications, setMessages, setClientNotes,
    setClientLinks, setVaultFolders, setFolders, setStages, setDmMessages, setActiveClient, setOpenTaskId, dmEnabled,
  });

  const { hasUnreadReply, markTaskNotifsRead, notify, sendMentionEmail } = useNotify({ tasksRef, me, setNotifications, notifications });
  // Whose move it is (Derek, 2026-10-15: "I want to see what am I waiting
  // on"): the client's turn is the flag or a current step that waits on
  // them; Team is a current step a teammate has (not you, not Claude).
  const curOpen = (t: Task) => t.subtasks.find((x) => !x.done && !x.fromClient) ?? null;
  const onClientNow = (t: Task) => { const c = curOpen(t); return !!t.waitingOnClient || (!!c && isClientWait(c)); };
  const onTeamNow = (t: Task) => { const c = curOpen(t); const who = c?.assigneeId ?? null; return t.status === "delegated" || (!!who && who !== me.id && who !== CLAUDE_ID && !(c && isClientWait(c))); };
  const passesFilters = (t: Task) =>
    (filters.status === "all" || effectiveStatus(t) === filters.status) &&
    (filters.assignee === "all" || (filters.assignee === "waiting" ? onClientNow(t) : filters.assignee === "team" ? onTeamNow(t) : filters.assignee === "unassigned" ? t.assigneeId === null : t.assigneeId === filters.assignee)) &&
    (filters.priority === "all" || effectivePriority(t) === filters.priority) &&
    // Explicitly filtering to Done overrides the hide-done toggle — asking
    // to see done tasks and then hiding them would show nothing.
    (!hideDone || filters.status === "done" || t.status !== "done" || lingeringDone.has(t.id));

  // Tasks quick-added in this list, newest first, held at the top of their
  // group instead of being sorted into place the moment they're created
  // (Derek, 2026-08-26: "otherwise it sorts away you know"). A task you just
  // typed almost always needs a due date or a priority set next, and it can't
  // be given one if hitting Enter files it out of sight.
  //
  // Stored with the list it belongs to rather than cleared by an effect, so
  // it expires on its own: change client, project, grouping, sort column or
  // direction and the key stops matching, the pins evaporate, and you get the
  // ordering you just asked for. No cleanup call to forget at a future call
  // site, and no setState-in-effect.
  const listKey = `${activeClient}|${activeProject ?? ""}|${groupBy}|${sortBy}|${sortDir}`;
  // A task you just ticked off stays on screen, struck through, instead of
  // vanishing under the hide-done filter the instant you click (Derek: "check
  // it but leave it until they leave the page, that way if they want to
  // reverse they can, otherwise you check it's gone and you're like oops and
  // lose it"). The row itself is the undo — click the circle again.
  //
  // Keyed to the page, not the list ordering: re-sorting shouldn't yank a row
  // you're still looking at, but navigating away is the "I'm done here" signal
  // that lets them go. Same self-expiring idiom as justAdded above, so there's
  // no cleanup call for a future call site to forget.
  const pageKey = `${activeClient}|${activeProject ?? ""}|${myWork}|${personalView}|${inboxView}|${dirView ?? ""}|${settingsView}`;
  const [justCompleted, setJustCompleted] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const lingeringDone = new Set(justCompleted.key === pageKey ? justCompleted.ids : []);
  const keepDoneVisible = (taskId: string) =>
    setJustCompleted((prev) => ({ key: pageKey, ids: [taskId, ...(prev.key === pageKey ? prev.ids.filter((x) => x !== taskId) : [])] }));
  const [justAdded, setJustAdded] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const pinnedIds = justAdded.key === listKey ? justAdded.ids : [];
  const pinJustAdded = (taskId: string) =>
    setJustAdded((prev) => ({ key: listKey, ids: [taskId, ...(prev.key === listKey ? prev.ids : [])] }));

  // The rule lives in lib/taskSort.ts so it can be tested: ordering is what
  // the list view mostly is, and it has been quietly wrong before.
  const sortTasks = (list: Task[]) => sortTasksBy(list, { sortBy, sortDir, hasUnreadReply, pinnedIds, viewerId: lensUserId });
  const sortByCol = (key: string) => {
    const map: Record<string, SortBy> = { priority: "priority", assignee: "assignee", due: "due", task: "title", status: "status", comments: "comments", created: "created" };
    const sb = map[key] ?? "manual";
    if (sortBy === sb) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(sb); setSortDir("asc"); }
  };
  const toggleCol = (key: string) => setVisibleCols(visibleCols.includes(key) ? visibleCols.filter((x) => x !== key) : [...visibleCols, key]);

  const canAdmin = me.role === "admin";
  // Reminders waiting for review, for the sidebar row's count (admins only:
  // they go to clients in a teammate's name). The view sets it fresh too.
  const [reminderCount, setReminderCount] = useState(0);
  useEffect(() => {
    if (!canAdmin) return;
    let live = true;
    const load = () => authedFetch("/api/reminders?count=1").then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && typeof j?.toReview === "number") setReminderCount(j.toReview); }, () => {});
    load();
    const i = setInterval(load, 5 * 60_000);
    return () => { live = false; clearInterval(i); };
  }, [canAdmin]);
  // Sending email/SMS is gated per-user (admins always, VAs when granted).
  // When false, the SMS/Email composers are never even rendered — passing an
  // undefined send handler hides them (see TaskDrawer's hasMessaging).
  // Effective per-client send permission — admins always; VAs need BOTH
  // the global grant (profiles.can_send_messages) and this client's
  // can_message roster (supabase/client-message-permission.sql).
  const canMessageClient = (clientId: string): boolean => {
    if (canAdmin) return true;
    if (!me.canSendMessages) return false;
    return (clientById(clientId)?.canMessage ?? []).includes(me.id);
  };
  // Memoized — this filters the full tasks table (28k+ rows) and was
  // previously recomputed on every render (Cockpit re-renders often, driven
  // by realtime subscriptions), making it and everything downstream of it
  // (myWorkGroups, sortedClients, clientTaskCountRef, etc.) redo an O(tasks)
  // scan on every update even when tasks/canAdmin/me.id hadn't changed.
  const scopedTasks = useMemo(
    () => (canAdmin ? tasks : tasks.filter((t) => isOnPlateOf(t, me.id))),
    [tasks, canAdmin, me.id]
  );
  // Tasks waiting in line on a queue list (Up next, mcp/queue.mjs): they show
  // on their own list only, never on All tasks, a client's All or My work,
  // unless they need you (a client wrote on one). Now and Waiting show as usual.
  const queuedUpNext = useMemo(() => {
    const ids = new Set<string>();
    const queues = projects.filter((p) => queueSettings(p.queue));
    if (!queues.length) return ids;
    const byList = new Map<string, Task[]>(queues.map((p) => [p.id, []]));
    for (const t of tasks) byList.get(t.projectId)?.push(t);
    for (const p of queues) for (const id of upNextIds(byList.get(p.id) ?? [], queueSettings(p.queue)!)) ids.add(id);
    return ids;
  }, [tasks, projects]);
  const inLineOnly = (t: Task) => queuedUpNext.has(t.id) && !needsYou(t, me.id);
  // What the All Tasks row in the sidebar counts: your own open work.
  //
  // It counted every task an admin could see, which is every task across
  // thirty-five clients — 23,494 of them, a number that says nothing and
  // reads as an error. A nav badge answers "how much is on me", so it is
  // scoped to you regardless of the Mine/All toggle, which also keeps the
  // number from lurching when you flip it.
  //
  // Approved counts (Derek, 2026-09-01: "approved is still work, count it
  // everywhere"). The client saying yes is not the work being delivered —
  // that is exactly why the two are separate stages — so an approved task is
  // still something you owe. Done is the only stage that is not.
  const openTaskCount = useMemo(
    () => tasks.filter((t) => isOnPlateOf(t, me.id) && t.status !== "done" && !inLineOnly(t)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, me.id, queuedUpNext],
  );
  // Map indices for scopedTasks/clients/projects — every lookup helper below
  // (clientById, clientTaskCount, clientNeedsReview, hasOpenConversationTask,
  // clientUrgencyKey, assignedClientsFor, ...) used to do its own linear
  // .find()/.filter()/.some() over the FULL scopedTasks/clients/projects
  // array on every call, and several of them call each other, so a single
  // clientUrgencyKey call could be 3+ full-table scans — multiplied across
  // every client in the sidebar, every user in "By teammate," every row of
  // My Work. Building these once per scopedTasks/clients/projects change
  // turns every one of those sites into an O(1) Map.get() plus a scan of
  // just that one client's/project's own (typically small) task list.
  const scopedTasksByClientId = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of scopedTasks) {
      const list = m.get(t.clientId);
      if (list) list.push(t); else m.set(t.clientId, [t]);
    }
    return m;
  }, [scopedTasks]);
  const scopedTasksByProjectId = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of scopedTasks) {
      if (!t.projectId) continue;
      const list = m.get(t.projectId);
      if (list) list.push(t); else m.set(t.projectId, [t]);
    }
    return m;
  }, [scopedTasks]);
  // Sub-accounts (Agency/Directory) are the contact source; clients (cl_*) are contacts you've added.
  const subAccounts = useMemo(() => clients.filter((c) => !c.id.startsWith("cl_")), [clients]);
  // Only type 'client' gets sidebar/⌘K/task presence — prospects/past
  // clients/vendors are classified contacts you can message, reached via the
  // Contacts tab and Conversations, not full clients with projects/tasks.
  // WORKSPACE_CLIENT_ID is a contact-less container for internal/agency work
  // (its projects behave like standalone lists that never sync). Kept out of
  // the real client list and shown as its own top-of-sidebar section.
  const clientList = useMemo(
    () => clients.filter((c) => c.id.startsWith("cl_") && c.type === "client" && c.id !== WORKSPACE_CLIENT_ID),
    [clients]
  );
  // Everything you can hang work on: real clients PLUS prospects. A prospect
  // still has a full record — tasks, projects, journal — so anywhere that
  // reasons about *work* rather than *the roster* has to look here instead,
  // or a task on a prospect silently falls out of My Work / ⌘K / the
  // move-task pickers.
  const workableClients = useMemo(
    () => clients.filter((c) => c.id.startsWith("cl_") && c.id !== WORKSPACE_CLIENT_ID && (c.type === "client" || c.type === "prospect")),
    [clients]
  );
  // Everywhere a task can be moved to: each client, then each of its
  // projects underneath. Clients alone left the ClickUpLocal projects Derek
  // actually files work into (Tracy CA, Lincoln CA, CUL Website) unreachable
  // from the move picker.
  const moveTargets = useMemo(() => {
    const byClient = new Map<string, Project[]>();
    for (const p of projects) {
      const list = byClient.get(p.clientId);
      if (list) list.push(p); else byClient.set(p.clientId, [p]);
    }
    // The workspace's own projects belong here too — Tracy CA and Lincoln CA
    // are ClickUpLocal's internal lists, and workableClients deliberately
    // excludes the workspace client, so listing clients and their projects
    // alone still left them unreachable (Derek: "still not showing the
    // project in search").
    const workspace = clients.find((c) => c.id === WORKSPACE_CLIENT_ID);
    const all = [
      ...(workspace ? [...byClient.get(WORKSPACE_CLIENT_ID) ?? []].sort((x, y) => x.name.localeCompare(y.name))
        .map((p) => ({ value: `p:${p.id}`, label: p.name, sub: workspace.name, dot: workspace.color, hollow: true })) : []),
      ...[...workableClients].sort((x, y) => x.name.localeCompare(y.name)).flatMap((c) => [
      { value: `c:${c.id}`, label: c.name, dot: c.color },
      ...(byClient.get(c.id) ?? []).sort((x, y) => x.name.localeCompare(y.name))
        // A lone project named for the client adds a second row that means
        // the same thing as the client row above it.
        .filter((p, _i, all) => all.length > 1 || p.name !== "Tasks")
        .map((p) => ({ value: `p:${p.id}`, label: p.name, sub: c.name, dot: c.color, hollow: true })),
      ]),
    ];
    // The client you're on comes first, its lists before anyone else's
    // (Derek, 2026-10-06), minus the list you're already in.
    if (activeClient === "all") return all;
    const here = clients.find((c) => c.id === activeClient);
    const mine = [...byClient.get(activeClient) ?? []].filter((p) => p.id !== activeProject).sort((x, y) => x.name.localeCompare(y.name))
      .map((p) => ({ value: `p:${p.id}`, label: p.name, sub: here?.name ?? "This client", dot: here?.color, hollow: true }));
    const firstValues = new Set(mine.map((o) => o.value));
    return [...mine, ...all.filter((o) => !firstValues.has(o.value))];
  }, [workableClients, clients, projects, activeClient, activeProject]);
  const workspaceProjects = useMemo(
    () => (clients.some((c) => c.id === WORKSPACE_CLIENT_ID) ? projects.filter((p) => p.clientId === WORKSPACE_CLIENT_ID) : []),
    [clients, projects]
  );
  // Mirrors the RLS rule in supabase/client-assignment.sql: a VA sees a
  // client if they have a task on it OR they're explicitly following it —
  // this is a display-layer echo of that DB rule, not the enforcement of it.
  // Memoized — for a non-admin this filters clientList against a scan of
  // scopedTasks per client, and it's computed on every render of Cockpit
  // (the sidebar is always mounted) regardless of which view is active.
  const visibleClients = useMemo(
    () => (canAdmin ? clientList : clientList.filter((c) => scopedTasks.some((t) => t.clientId === c.id) || (c.assignedTo ?? []).includes(me.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canAdmin, clients, scopedTasks, me.id]
  );
  // "My Work" is a strictly personal-to-someone view — only clients with a
  // currently *open* task assigned to that person specifically (or that
  // they're explicitly following), even for admins, who otherwise see every
  // client via visibleClients above. A client whose only connection is a
  // task already finished, and not followed, drops off the board entirely
  // rather than lingering in "No open tasks" forever. Parametrized by
  // userId (not just `me`) so the admin-only "viewing work for" selector
  // can point this at a teammate instead of yourself.
  // Reads workableClients, not clientList: a prospect you've been assigned
  // a task on is real work and belongs on your board.
  const assignedClientsFor = (userId: string) => workableClients.filter((c) => (scopedTasksByClientId.get(c.id) ?? []).some((t) => t.status !== "done" && isOnPlateOf(t, userId)) || (c.assignedTo ?? []).includes(userId));
  // Same rule, applied to projects — but only "Projects" in Derek's sense
  // (the sidebar's Administration/Idea board/etc. list, i.e. workspaceProjects
  // above — not tied to a real GHL client). A client's own internal
  // sub-lists ("Tasks", "Website") are excluded here: clicking the client
  // already shows every task across all of its lists, so a per-client
  // project row would just duplicate the client row right next to it.
  // NOTE: can't test this with `!clientId.startsWith("cl_")` — the
  // workspace pseudo-client's id is literally "cl_workspace", so that
  // heuristic wrongly excluded every real project too. Test the two known
  // non-client-scoped ids explicitly instead. A project with no assignedTo
  // field yet (pre-migration rows) just falls back to an empty follow-list,
  // matching rowToProject's `?? []`.
  const assignedProjectsFor = (userId: string) => projects.filter((p) => (p.clientId === WORKSPACE_CLIENT_ID || p.clientId === PERSONAL_CLIENT_ID) && ((scopedTasksByProjectId.get(p.id) ?? []).some((t) => t.status !== "done" && isOnPlateOf(t, userId)) || (p.assignedTo ?? []).includes(userId)));
  // Memoized — always computed every render (unconditionally, regardless of
  // clientListScope) via assignedClientsFor, which scans scopedTasks per
  // workable client. Same class of bug as myWorkGroups: this ran on every
  // Cockpit render since the sidebar is always mounted, not just on My Work.
  const myAssignedClients = useMemo(
    () => assignedClientsFor(me.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedTasks, clients, me.id]
  );
  // "Who's working with who" — the Clients directory's "By teammate" view
  // (Derek: "right now we're both in the dark what the other people are
  // doing"). Same assignedClientsFor definition every other per-person view
  // in this app already uses (open task assignee/subtask assignee, or
  // explicitly following) — restricted to active_client status only, since
  // this is a review-the-active-roster view, not a full pipeline dump.
  // Gated on the "By teammate" tab actually being open — its only consumer
  // (ClientsDirectory's teamGroups prop) — same reasoning as completionLog
  // below: an O(users × clients × tasks) scan isn't worth paying on every
  // task edit while looking at some other view entirely.
  const teamActiveClients = useMemo(() => {
    if (!(dirView === "clients" && clientsGroupBy === "team")) return [];
    return users.map((u) => ({ member: u, clients: assignedClientsFor(u.id).filter((c) => c.status === "active_client").sort((a, b) => a.name.localeCompare(b.name)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirView, clientsGroupBy, scopedTasks, clients, users]);
  // "Completed" log — who marked what done, and when. Lives under My Work
  // now (Derek: "makes more sense there"), not the Clients directory. No new
  // schema needed: every status change already writes a plain "kind: event"
  // comment onto the task (see patchTask's describeFieldChange call) with a
  // real authorId/at, so a task marked done the normal way through this app
  // already carries its own completion record — including ones from before
  // this view existed, i.e. the "backfill" is just reading history that was
  // already there. Tasks completed some other way (a GHL sync, a webhook)
  // won't have one, so this is a log of what we can prove, not a total task
  // count. Gated on the tab actually being open — a full scan of every
  // task's comments is real work at this app's task volume, no reason to
  // pay for it on every render of every other view.
  const showCompletedLog = !myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient === "all" && allTasksCompleted;
  const completionLog = useMemo(() => {
    if (!showCompletedLog) return [];
    const rows: CompletionRow[] = [];
    for (const t of tasks) {
      if (t.clientId === PERSONAL_CLIENT_ID) continue; // personal to-dos aren't client work to review
      const clientName = clientById(t.clientId)?.name ?? "—";
      for (const c of t.comments) {
        if (c.kind !== "event") continue;
        const kind = finishKindOf(c.body, c.authorId);
        if (!kind) continue;
        // The client is not on the roster, so an approval of theirs is credited
        // to the client itself. Their own name is what makes the row readable:
        // "Brian Goodell" beside "Client approved" says the whole thing.
        const client = kind === "client_approved";
        const author = client ? null : userById(c.authorId);
        rows.push({
          id: c.id, taskId: t.id, taskTitle: t.title, clientId: t.clientId, clientName,
          authorId: client ? `client:${t.clientId}` : c.authorId,
          authorName: client ? clientName : author?.name ?? "Unknown",
          authorColor: (client ? clientById(t.clientId)?.color : author?.color) ?? "#94a3b8",
          authorInitials: client ? initialsOf(clientName) : author?.initials ?? "?",
          ownerId: t.assigneeId ?? null,
          kind,
          at: c.at,
        });
      }
    }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return rows.slice(0, 300); // a running log, not a full export
  }, [showCompletedLog, tasks]);
  // Memoized for the same reason — the sidebar's "My Work" nav badge
  // (below) calls this inline on every render of every view, including the
  // chat pages, which is what made typing/sending there feel laggy even
  // after the myWorkGroups and sidebar-client-list fixes.
  const myAssignedProjects = useMemo(
    () => assignedProjectsFor(me.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedTasks, projects, me.id]
  );
  // ⌘K's "Not imported" search — any type counts as "already added" here,
  // not just type 'client', so a contact never shows as addable twice.
  const addedContactIds = useMemo(() => new Set(clients.filter((c) => c.id.startsWith("cl_")).map((c) => c.id.slice(3))), [clients]);
  // The sidebar stays a *roster* view: prospects are filtered back out here
  // even though myAssignedClients now includes them. A prospect you have a
  // task on shows up on the My Work board and in ⌘K, but never enters the
  // client sidebar — that's exactly what typing them as prospects is meant
  // to prevent, and it would otherwise leak back in through the "Mine" scope.
  const rosterOnly = (list: Client[]) => list.filter((c) => c.type === "client");
  // The sidebar's actual source list — scoped down to "mine" by default
  // (reuses myAssignedClients, the exact same set My Work uses) so a long
  // client roster doesn't bury what actually needs attention. Toggled to
  // visibleClients (everyone you can see) via the header's Mine/All control.
  // Memoized so its reference stays stable across renders when the underlying
  // data hasn't changed — otherwise sortedClients below (which depends on
  // this) would recompute its expensive "urgent"/"mine" branches every
  // render regardless of memoization, since a fresh array reference here
  // would look like a change every time.
  const clientListBase = useMemo(
    () => rosterOnly(clientListScope === "mine" ? myAssignedClients : visibleClients),
    [clientListScope, myAssignedClients, visibleClients]
  );
  // Memoized — the "urgent"/"mine" branches call clientUrgencyKey per client,
  // which scans scopedTasks; same O(clients × tasks) cost as myWorkGroups,
  // but this ran on every render since the sidebar is always mounted.
  const sortedClients = useMemo(() => {
    const base = [...clientListBase];
    if (clientSort === "az") base.sort((a, b) => a.name.localeCompare(b.name));
    else if (clientSort === "tasks") base.sort((a, b) => clientTaskCountRef(b.id) - clientTaskCountRef(a.id));
    else if (clientSort === "recent") base.reverse(); // fetch order is created_at asc
    else if (clientSort === "used") base.sort((a, b) => (clientUsed[b.id] ?? 0) - (clientUsed[a.id] ?? 0)); // most recently opened first
    else if (clientSort === "urgent") {
      // A client who's actually messaged us goes first — they're waiting on
      // a reply, which trumps everything else. Then: overdue, then due
      // today, then soonest due date, then anything with no due date, then
      // clients with no open tasks at all — each tier broken by priority
      // (highest first), then recency (fetch order is created_at asc, so a
      // higher original index is more recently added).
      const withIndex = base.map((c, i) => ({ c, i, k: clientUrgencyKey(c.id) }));
      withIndex.sort((a, b) => a.k.tier - b.k.tier || a.k.due.localeCompare(b.k.due) || b.k.priorityRank - a.k.priorityRank || b.i - a.i);
      base.splice(0, base.length, ...withIndex.map((x) => x.c));
    }
    else if (clientSort === "mine") {
      // Same urgency tiering as "Overdue first", but scoped to just my own
      // open tasks (clientUrgencyKey's forAssignee param, the same scoping
      // myWorkGroups already uses) — a client only lands in "Overdue"/"Due
      // today" here because of a task assigned to me, not a teammate's.
      const withIndex = base.map((c, i) => ({ c, i, k: clientUrgencyKey(c.id, me.id) }));
      withIndex.sort((a, b) => a.k.tier - b.k.tier || a.k.due.localeCompare(b.k.due) || b.k.priorityRank - a.k.priorityRank || b.i - a.i);
      base.splice(0, base.length, ...withIndex.map((x) => x.c));
    }
    else if (manualOrder.length) base.sort((a, b) => { const ia = manualOrder.indexOf(a.id), ib = manualOrder.indexOf(b.id); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); });
    return [...base.filter((c) => starred.has(c.id)), ...base.filter((c) => !starred.has(c.id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientListBase, clientSort, clientUsed, starred, manualOrder, scopedTasks, tasks, clients, projects, me.id]);
  // The sidebar is as wide as its longest name, from 208px to 320px (Derek,
  // 2026-10-07). Every name it can show counts, not just today's, so it
  // doesn't jump as tasks get done. Measured from the text, never the layout:
  // see lib/sidebarWidth for the Windows crash that rules the layout out.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(true)).catch(() => setFontsReady(true)); }, []);
  const sidebarPx = useMemo(() => {
    const measure = canvasMeasure();
    if (!measure) return SIDEBAR_MIN_PX;
    const names = [
      ...myAssignedClients.map((c) => c.name),
      ...myAssignedProjects.filter((pr) => pr.clientId === WORKSPACE_CLIENT_ID).map((pr) => pr.name),
      "Personal",
      ...[...starred].map((id) => clients.find((c) => c.id === id)?.name ?? ""),
      ...[...starredLists].map((id) => projects.find((pr) => pr.id === id)?.name ?? ""),
    ];
    return sidebarWidthFor(names, measure);
    // fontsReady: measure again once Inter has loaded, the fallback font is narrower.
  }, [myAssignedClients, myAssignedProjects, starred, starredLists, clients, projects, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  function clientTaskCountRef(clientId: string) { return (scopedTasksByClientId.get(clientId) ?? []).length; }
  const unreadContactIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of messages) if (m.direction === "inbound" && !m.read) s.add(m.contactId);
    return s;
  }, [messages]);
  function hasUnreadMessage(clientId: string): boolean {
    if (!clientId.startsWith("cl_")) return false;
    const contactId = clientId.slice(3);
    return unreadContactIds.has(contactId);
  }
  // The tier-0 "New message" boost in clientUrgencyKey is driven by an open
  // Conversation-priority task (the priority-system source of truth for "a
  // thread needs a reply"), not raw unread-message state — a thread stays
  // boosted for as long as its task is open, even after the message itself
  // is marked read, and clears only when the task is completed.
  //
  // forAssignee, like clientUrgencyKey's: a reply task sitting on a teammate's
  // list used to raise that client to the top of YOUR board, which is how
  // Giselle led Derek's My Work on work that was all Justin's (2026-09-28).
  // Unassigned reply tasks still count for everyone, since nobody has picked
  // them up and somebody has to.
  function hasOpenConversationTask(clientId: string, forAssignee?: string): boolean {
    return (scopedTasksByClientId.get(clientId) ?? []).some((t) => t.status !== "done" && t.priority === "conversation" && isMessageConversationTask(t.title)
      && (!forAssignee || !t.assigneeId || t.assigneeId === forAssignee));
  }
  // The Review/Check-in tier (Derek + Justin, Jul 17): a client with open work
  // but nothing actually dated silently sinks to the bottom and gets
  /** Open tasks this client owes us an answer on. Unassigned by construction,
   *  so every caller has to look them up deliberately rather than expecting
   *  them in an assignee-scoped list. */
  /** The client's open requests: the current client step of each open,
   *  shared task, across all their lists (lib/clientRequests). */
  function clientRequestsFor(clientId: string): ClientRequest[] {
    return (scopedTasksByClientId.get(clientId) ?? [])
      .filter((t) => t.status !== "done" && t.status !== "on_hold" && !t.private && !t.hiddenFromClient)
      .map((t) => requestFromTask({ id: t.id, title: t.title, clientId: t.clientId, projectId: t.projectId, due: t.due, subtasks: t.subtasks }))
      .filter((r): r is ClientRequest => !!r);
  }
  /** Their older tasks only flagged waiting on them, with no step for them:
   *  the fold in's rows, grouped by list, each by due date (lib/foldIn). */
  function foldInRowsFor(clientId: string): FoldInRow[] {
    return foldInTasks(scopedTasksByClientId.get(clientId) ?? [], (id) => (id ? projectById(id)?.name ?? null : null))
      .map((t) => ({ taskId: t.id, title: t.title, listId: t.projectId ?? null, notes: t.description?.trim() ? t.description : planSteps(t.subtasks)[0]?.notes ?? null }));
  }
  /** Adds the fold in's picks: one task write at a time through the ordinary
   *  task save, each waiting for the one before (never a bulk update). */
  async function addFoldInsFor(first: string, picks: FoldInPick[], onProgress: (done: number, total: number) => void): Promise<void> {
    const added = await addFoldIns(picks, {
      getTask: (id) => tasksRef.current.find((x) => x.id === id),
      patch: (id, p) => patchTask(id, p),
      now: () => new Date().toISOString(), makeId: () => newId("s_"), onProgress,
    });
    pushToast(added ? `Added ${added} to ${first}'s list. Every reminder waits for review in Reminders.` : `Nothing was added: each one already has a step for ${first}.`);
  }
  function waitingTasksFor(clientId: string): Task[] {
    return (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done" && t.waitingOnClient);
  }
  // Tier scheme (lower = more urgent, sorts first):
  //   0 Review · 1 New message · 2 Overdue · 3 Due today · 4 Due tomorrow ·
  //   5 Due this week · 6 Due next week · 7 Due this month · 8 Upcoming ·
  //   9 No due date · 10 No open tasks
  // Which date My Work tiers a task by. A snoozed task counts at its
  // follow-up, not its due date (Derek: "fix My Work so it honors the snooze
  // too"). Two ways to do that and the choice matters: EXCLUDING snoozed
  // tasks from the tiering would drop a client whose only open work is
  // parked into "No open tasks", which is a lie — the work exists, it's just
  // waiting. Counting it at the date it comes back keeps the client on the
  // board, at the moment it's actually actionable, and it reappears in the
  // right tier on its own with nothing to remember.
  // forAssignee narrows "open tasks" to just that person's — used by the
  // personal My Work board, where a client's tier should reflect *my* tasks
  // there, not a teammate's. Omitted for the sidebar's "Overdue first" sort,
  // which is intentionally client-wide across every assignee.
  function clientUrgencyKey(clientId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    if (hasOpenConversationTask(clientId, forAssignee)) return { tier: URGENCY_TIER.newMessage, due: "", priorityRank: 0 };
    return urgencyKeyFrom((scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee)));
  }
  // Same tiering as clientUrgencyKey, scoped to one project's tasks. No "New
  // message" tier — that's a client-level Conversation concept, not a
  // project one.
  function projectUrgencyKey(projectId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    return urgencyKeyFrom((scopedTasksByProjectId.get(projectId) ?? []).filter((t) => t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee)));
  }
  // A personal to-do's own tier — no Review/New-message concept (those are
  // client/project-level), and it's always "open" if it's being shown at
  // all, so this is just tierForDate off its own due date, falling back to
  // tier 9 (no due date) same as clientUrgencyKey/projectUrgencyKey do.
  function taskUrgencyKey(task: Task): { tier: number; due: string; priorityRank: number } {
    const d = urgencyDateOf(task);
    if (!d) return { tier: URGENCY_TIER.noDate, due: "", priorityRank: PRIORITY_META[task.priority].rank };
    return { tier: tierForDate(d), due: d, priorityRank: PRIORITY_META[task.priority].rank };
  }
  const projectTaskCount = (projectId: string) => (scopedTasksByProjectId.get(projectId) ?? []).filter((t) => t.status !== "done").length;
  // Same "Overdue first" urgency ordering the Clients section gets when
  // clientSort === "urgent" — the sidebar's Projects section had no sort at
  // all before this. Same comparator as myWorkGroups/sortedClients's
  // "urgent" branch: tier, then soonest due, then priority, then name.
  const sortedWorkspaceProjects = clientSort === "urgent" || clientSort === "mine"
    ? [...workspaceProjects].sort((a, b) => {
        const forAssignee = clientSort === "mine" ? me.id : undefined;
        const ka = projectUrgencyKey(a.id, forAssignee), kb = projectUrgencyKey(b.id, forAssignee);
        return ka.tier - kb.tier || ka.due.localeCompare(kb.due) || kb.priorityRank - ka.priorityRank || a.name.localeCompare(b.name);
      })
    : workspaceProjects;
  // "My Work" — the same urgency tiers as the sidebar's "Overdue first"
  // sort, as grouped sections of clients AND projects (interleaved together
  // within each tier, sorted by the same due/priority/name comparator)
  // rather than two separate lists. Scoped by myWorkUser, not always `me` —
  // that's what lets the admin "viewing work for" selector repoint this at
  // a teammate.
  // Memoized — this drives every "My Work" render (the VA/admin default
  // landing view) and was an unmemoized IIFE recomputed on every Cockpit
  // render, each time re-scanning scopedTasks per assigned client/project via
  // assignedClientsFor/clientUrgencyKey/hasOpenConversationTask etc. With
  // ~28k tasks and Cockpit re-rendering continuously off realtime updates,
  // that was the actual "running very slow" bottleneck on view=work — the
  // earlier fix (capping concurrent row fetches) only bounded the initial
  // load, not this per-render CPU cost. Deps mirror the true inputs of
  // assignedClientsFor/assignedProjectsFor/clientUrgencyKey/projectUrgencyKey/
  // hasOpenConversationTask/clientNeedsReview/projectNeedsReview, which all
  // close over tasks/scopedTasks/clients/projects/canAdmin/me.id.
  const myWorkGroups: WorkBoardGroup[] = useMemo(() => {
    const defs: [number, string, string][] = [
      [0, "Review", "#14b8a6"],
      [1, "New message", "#8b5cf6"],
      [2, "Overdue", "#ef4444"],
      [3, "Due today", "#f59e0b"],
      [4, "Due tomorrow", "#eab308"],
      [5, "Due this week", "#3b82f6"],
      [6, "Due next week", "#06b6d4"],
      [7, "Due this month", "#6366f1"],
      [8, "Upcoming", "#0ea5e9"],
      [9, "No due date", "#94a3b8"],
      [10, "No open tasks", "#cbd5e1"],
    ];
    const clientKeys = assignedClientsFor(myWorkUser).map((c) => ({ kind: "client" as const, item: { kind: "client" as const, client: c }, name: c.name, k: clientUrgencyKey(c.id, myWorkUser) }));
    // Excludes the Personal pseudo-project — its tasks appear individually
    // below instead of folded into one undifferentiated "Personal" tile.
    const projectKeys = assignedProjectsFor(myWorkUser).filter((p) => p.id !== PERSONAL_PROJECT_ID).map((p) => ({ kind: "project" as const, item: { kind: "project" as const, project: p, clientName: clientById(p.clientId)?.name ?? "—" } as WorkItem, name: p.name, k: projectUrgencyKey(p.id, myWorkUser) }));
    // Private to-dos are only ever yours, never shown when viewing a teammate.
    const taskKeys = tasks.filter((t) => myWorkUser === me.id && t.assigneeId === myWorkUser && t.private && t.status !== "done")
      .map((t) => ({ kind: "task" as const, item: { kind: "task" as const, task: t } as WorkItem, name: t.title, k: taskUrgencyKey(t) }));
    const withKey = [...clientKeys, ...projectKeys, ...taskKeys];
    return defs
      .map(([tier, label, color]) => ({
        key: String(tier),
        label,
        color,
        items: withKey
          .filter((x) => x.k.tier === tier)
          .sort((a, b) => a.k.due.localeCompare(b.k.due) || b.k.priorityRank - a.k.priorityRank || a.name.localeCompare(b.name))
          .map((x) => x.item),
      }))
      .filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, scopedTasks, clients, projects, myWorkUser, me.id]);
  // Resolves the GHL contact backing a client: an explicit link (set via
  // "Link to GHL" for clients whose id isn't itself a contact id) wins;
  // otherwise fall back to the id-derived contact ("cl_" + contact id).
  // The SaaS link belongs to the contact, so entering it once should be
  // entering it everywhere (Derek, 2026-09-29: "we only want to enter it
  // once"). The drawer writes it to GoHighLevel and the contacts row; this
  // catches the app's own copy up, which every other task reads from.
  // Stable, so the drawer's GoHighLevel check can list it as a dependency.
  const noteSaasUrl = useCallback((contactId: string, url: string) =>
    setContacts((cs) => cs.map((c) => (c.id === contactId ? { ...c, saasUrl: url } : c))), []);
  const [bookClient, setBookClient] = useState<string | null>(null);
  // Meet now from the client page (Derek, 2026-10-14): the sheet that starts
  // the meeting and sends them the link.
  const [meetNowClient, setMeetNowClient] = useState<string | null>(null);
  const contactForClient = (clientId: string): Contact | null => {
    const c = clientById(clientId);
    if (c?.linkedContactId) return contactById(c.linkedContactId);
    return clientId.startsWith("cl_") ? contactById(clientId.slice(3)) : null;
  };
  // The GoHighLevel sub account a client's contact is in: which of our
  // numbers a text to them can go from (FromNumberLine).
  const textLocationFor = (clientId: string): string | null => {
    const ct = contactForClient(clientId);
    return ct ? clientById(ct.clientId)?.ghlLocationId || null : null;
  };
  const ghlContactUrlFor = (clientId: string) => {
    const ct = contactForClient(clientId);
    if (!ct) return null;
    const sub = clientById(ct.clientId);
    return sub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${sub.ghlLocationId}/contacts/detail/${ct.ghlContactId}` : null;
  };

  // Sorted by position so folder-grouped list headings match the folder rail's
  // drag order (B5). Falls back to insertion order for equal/absent positions.
  const visibleProjects = useMemo(() => projects.filter((p) => p.clientId.startsWith("cl_") && (activeClient === "all" || p.clientId === activeClient) && (!activeFolder || p.folderId === activeFolder)), [projects, activeClient, activeFolder]);
  // On the All Tasks tab (activeClient === "all"), further restrict to your
  // own tasks by default — reusing scopedTasks' own assigneeId === me.id
  // pattern. Redundant-but-harmless for VAs, who are already fully
  // restricted by scopedTasks; only changes anything for admins.
  // Owner Growth Plan tasks are excluded from any unscoped-by-project view
  // (activeProject === null — "All" for a client, or the cross-client All
  // Whose list is on screen. Everything that answers "when is this due" or
  // "whose face goes on the row" reads this rather than me.id, so scoping All
  // Tasks to Michaella shows her dates and her face on a task delegated to
  // her, while the same task on Derek's list keeps his (Derek: "it's still on
  // mine with my face and my follow up, and also on Michaella with her face
  // and her follow up details, and you click on it, it goes to the same
  // task").
  const lensUserId = activeClient === "all" && allTasksScope !== "all" && allTasksScope !== "mine" ? allTasksScope : me.id;
  // Memoized — the main task list's hot path. With activeFolder set this
  // was O(scopedTasks × projects) every render (projectById is a linear
  // scan), and it feeds displayedGroups/vaultItems/Journal counts below.
  // Every task but a personal to do. It used to keep only clients whose id
  // starts "cl_", added to keep personal to dos out; the two GoHighLevel sub
  // accounts, "Agency" (c_agency) and "Directory" (c_directory), do not start
  // "cl_" either, so every task on them, which is every reply from someone not
  // yet a client, was missing from All Tasks whatever the scope (Derek,
  // 2026-09-22: "I'm not seeing the reply to message tasks"). The Clients list
  // and project pickers keep the "cl_" rule: a sub account is not a client
  // there. This is a list of work, and those are.
  const baseTasks = useMemo(
    () => scopedTasks.filter((t) => t.clientId !== PERSONAL_CLIENT_ID && (activeClient === "all" || t.clientId === activeClient) && (!activeProject || t.projectId === activeProject) && (!activeFolder || projectById(t.projectId)?.folderId === activeFolder) && (activeClient !== "all" || allTasksScope === "all" || isOnPlateOf(t, allTasksScope === "mine" ? me.id : allTasksScope))
      // Waiting in line on a queue: only on that list.
      && (activeProject === t.projectId || !inLineOnly(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedTasks, activeClient, activeProject, activeFolder, projects, allTasksScope, me.id, queuedUpNext]
  );

  // Client/project-wide equivalent of TaskDrawer's per-task copyForClaude —
  // same clipboard hand-off pattern, just widened from one task to every
  // open task under the currently open client/project.
  // listId: just that list (Derek, 2026-10-06: "copy for Claude for these
  // lists as well, so it's only the list"), from the list's ⋮ menu.
  // Only the tasks picked (Derek, 2026-10-12: "a Claude button in the bulk
  // bar so it only copies those tasks to be completed").
  const BULK_CTL = "h-9 rounded-[5px] border bg-background px-2.5 text-[16px] outline-none hover:bg-surface";
  const copySelectedForClaude = async () => {
    const picked = [...selectedTaskIds].map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t);
    if (!picked.length) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "https://clickuptasks.vercel.app";
    const brief = [
      `Complete these ${picked.length} ${picked.length === 1 ? "task" : "tasks"} from ClickUpTasks, one at a time. For each, read it with get_task first.`,
      ``,
      ...picked.map((t, i) => {
        const st = currentStepLine(t.subtasks);
        const desc = htmlToText(t.description ?? "").replace(/\s+/g, " ").trim();
        return [
          `${i + 1}. ${t.title} [${t.id}]`,
          `   ${[clientById(t.clientId)?.name, projectById(t.projectId)?.name].filter(Boolean).join(" · ")} · ${STATUS_META[t.status].label}${t.due ? ` · Due ${t.due}` : ""}${t.assigneeId ? ` · On ${userById(t.assigneeId)?.name ?? t.assigneeId}` : ""}`,
          st ? `   Now: ${st}` : "",
          desc ? `   ${desc.slice(0, 300)}${desc.length > 300 ? "…" : ""}` : "",
          `   ${origin}/?task=${t.id}`,
        ].filter(Boolean).join("\n");
      }),
      ``,
      STEP_TOOLS,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(brief);
      pushToast(`Copied ${picked.length} ${picked.length === 1 ? "task" : "tasks"} for Claude`);
    } catch { pushToast("Couldn't copy to the clipboard."); }
  };
  const copyClientForClaude = async (listId?: string) => {
    // Tasks ticked: only those (Derek, 2026-10-12: "will Claude only add those
    // tasks"); nothing ticked: the whole list, as before.
    if (selectedTaskIds.size > 0) { await copySelectedForClaude(); return; }
    const client = clientById(activeClient);
    if (!client) return;
    const scopeId = listId ?? activeProject;
    const project = scopeId ? projectById(scopeId) : null;
    const contact = contactForClient(activeClient);
    const openTasks = sortTasks((listId ? (scopedTasksByClientId.get(activeClient) ?? []).filter((t) => t.projectId === listId) : baseTasks).filter((t) => t.status !== "done"));
    const shown = openTasks.slice(0, 30);
    const notes = clientNotes
      .filter((n) => (scopeId ? n.projectId === scopeId : n.clientId === activeClient && !n.projectId))
      .slice(0, 5);
    const ghlUrl = ghlContactUrlFor(activeClient);
    const brief = [
      `Work on this client/project from ClickUpTasks (${window.location.origin}):`,
      ``,
      `Client: ${client.name}${contact?.email ? ` (${contact.email})` : ""}`,
      `List: ${project ? `${project.name} (list id ${project.id})` : "All lists"}`,
      `Use the ClickUpTasks connection: get_task with a task id below for the full task and its steps.`,
      ``,
      `Open tasks (${openTasks.length}):`,
      ...shown.map((t) => { const st = currentStepLine(t.subtasks); return `- ${t.title} [${t.id}] · ${STATUS_META[t.status].label} · ${PRIORITY_META[t.priority].label}${t.due ? ` · Due: ${t.due}` : ""}${t.assigneeId ? ` · On: ${userById(t.assigneeId)?.name ?? t.assigneeId}` : ""}${st ? ` · Now: ${st}` : ""}`; }),
      openTasks.length > shown.length ? `...and ${openTasks.length - shown.length} more (showing top ${shown.length} by priority/due)` : "",
      notes.length ? `\nRecent chat notes:\n${notes.map((n) => `- ${userById(n.authorId)?.name ?? "?"}: ${n.body}`).join("\n")}` : "",
      ghlUrl ? `\nGHL contact: ${ghlUrl}` : "",
      `\n${STEP_TOOLS}`,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(brief);
      pushToast(project ? `Copied the ${project.name} list for Claude.` : "Copied client brief for Claude.");
    } catch {
      pushToast("Couldn't copy to clipboard.");
    }
  };
  // Note-attachment folder filing — the one Vault capability that survives
  // the merge into Journal (see AttachmentThumbs' folders/onSetFolder props).
  // Task/comment attachments never had this in the Journal feed to begin
  // with (Journal only ever showed note+message attachments), so their
  // Vault-only folder mutators went with the tab.
  const setNoteAttachmentFolder = (note: ClientNote, attId: string, folderId: string | null) => {
    const updated: ClientNote = { ...note, attachments: (note.attachments ?? []).map((a) => (a.id === attId ? { ...a, folderId: folderId ?? undefined } : a)) };
    setClientNotes((ns) => ns.map((n) => (n.id === note.id ? updated : n)));
    upsertClientNote(updated);
  };
  const createVaultFolder = (clientId: string, name: string) => {
    const f: VaultFolder = { id: newId("vf_"), clientId, projectId: null, name, createdAt: new Date().toISOString() };
    setVaultFolders((fs) => [...fs, f]);
    upsertVaultFolder(f);
    return f;
  };
  // Deleting a folder doesn't touch the attachments that referenced it —
  // their folderId just stops matching anything and they fall back to
  // "Unfiled." No cascade needed; JSONB isn't relationally enforced anyway.
  const deleteVaultFolder = (id: string) => {
    const f = vaultFolders.find((x) => x.id === id);
    setConfirmDialog({
      title: `Delete folder “${f?.name ?? "this folder"}”?`,
      message: "Its attachments are kept — they just fall back to Unfiled.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setVaultFolders((fs) => fs.filter((x) => x.id !== id));
        deleteVaultFolderDb(id);
      },
    });
  };
  // This client's Vault folders — Journal reads them for its Filter menu's
  // Folder section now that the Vault tab itself is gone.
  const activeVaultFolders = useMemo(
    () => (activeClient === "all" ? [] : vaultFolders.filter((f) => f.clientId === activeClient)),
    [activeClient, vaultFolders]
  );
  const projectsForClient = (clientId: string) => projects.filter((p) => p.clientId === clientId);
  const foldersForClient = (clientId: string) => folders.filter((f) => f.clientId === clientId).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const stagesForProject = (projectId: string) => stages.filter((s) => s.projectId === projectId).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const folderById = (id: string | null | undefined) => (id ? folders.find((f) => f.id === id) ?? null : null);
  // Open (non-done) count — matches what the client's task list actually shows
  // with "Hide done" on by default, so the sidebar/board badge and the list
  // never disagree about how many tasks "need attention".
  const clientTaskCount = (clientId: string) => (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done").length;
  // What the My Work board counts: the open tasks that are actually yours, or
  // nobody's. "3 tasks" on a client whose three tasks all belong to a
  // teammate is a number about someone else's day (Derek, 2026-09-28: "when I
  // look at the tasks nothing is for me").
  const myClientTaskCount = (clientId: string) => (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done" && (!t.assigneeId || t.assigneeId === myWorkUser) && !inLineOnly(t)).length;
  const myProjectTaskCount = (projectId: string) => (scopedTasksByProjectId.get(projectId) ?? []).filter((t) => t.status !== "done" && (!t.assigneeId || t.assigneeId === myWorkUser) && !inLineOnly(t)).length;
  // Open tasks bucketed by client, for the Clients directory's Tasks
  // column. One pass instead of a filter per row.
  // Not memoized: useMemo over a bucketing loop trips
  // react-hooks/preserve-manual-memoization (it can't see that the arrays
  // being pushed into are freshly built here, not scopedTasks itself), and a
  // single pass over a few thousand tasks per render is not worth the fight.
  // Memoized — a single pass over scopedTasks (up to ~28k rows), previously
  // rerun on every render regardless of view, same class of bug as the
  // sidebar/My Work fixes above.
  const openTasksByClient = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of scopedTasks) {
      if (t.status === "done") continue;
      const list = m.get(t.clientId);
      if (list) list.push(t); else m.set(t.clientId, [t]);
    }
    return m;
  }, [scopedTasks]);
  // Not gated by myWorkUser (the admin-only "viewing work for" selector) —
  // RLS never even returns another person's private tasks in `tasks`, so
  // filtering by `me.id` here is correct regardless of who's being viewed.
  // Memoized — filters + sorts the full ~28k-row tasks table every render.
  const myPersonalTasks = useMemo(
    // A private task waiting in line on a queue list stays on that list, as
    // on All tasks and My work (Derek, 2026-10-14).
    () => sortTasks(tasks.filter((t) => t.assigneeId === me.id && t.private && !inLineOnly(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, me.id, sortBy, sortDir, notifications, queuedUpNext]
  );

  // Memoized — a linear scan of the full tasks table every render, even
  // when no task is open.
  const openTask = useMemo(() => tasks.find((t) => t.id === openTaskId) ?? null, [tasks, openTaskId]);
  // The drawer's own slices, kept as the same arrays until they really change:
  // filtering inline handed it new ones on every render anywhere in the app.
  const openTaskClientId = openTask?.clientId ?? null;
  // The app's own "X replied on ..." email is linked to its task for the
  // Inbox, but the task already shows what X wrote: kept out of its feed
  // (Derek, 2026-10-07, the seats task showed Pamela's message twice).
  const openTaskMessages = useMemo(() => (openTaskId ? messages.filter((m) => m.taskId === openTaskId && !isAppNotice(m)) : []), [messages, openTaskId]);
  const openTaskClientLinks = useMemo(() => (openTaskClientId ? clientLinks.filter((l) => l.clientId === openTaskClientId) : []), [clientLinks, openTaskClientId]);
  // The client's meetings (Granola and logged by hand) shown on each of
  // their tasks (Derek, 2026-10-11).
  const openTaskMeetings = useMemo(() => (openTaskClientId ? clientNotes.filter((n) => n.clientId === openTaskClientId && n.type === "meeting") : []), [clientNotes, openTaskClientId]);
  // Sending, editing and scheduling client messages, the GoHighLevel refresh,
  // and a conversation's older messages loading when it opens (cockpit/useMessaging).
  // The client page's Conversation is open when it was opened for the client
  // on screen; its messages load as the Journal's do.
  const onClientPage = activeClient !== "all" && !myWork && !personalView && !inboxView && !settingsView && !dirView && clientTab !== "chat";
  const feedFor = feedClient !== null && feedClient === activeClient && onClientPage && activeClient !== WORKSPACE_CLIENT_ID ? feedClient : null;
  const conversationContact = (activeClient !== "all" && clientTab === "chat" && !activeProject ? activeClient : null) ?? feedFor ?? clientEmail?.clientId ?? null;
  // The client's own saved email, counted with their drafts and shown in the
  // Conversation; read again when their email window closes.
  const savedClientDraft = useClientSavedDraft(onClientPage && activeClient !== WORKSPACE_CLIENT_ID ? activeClient : null, clientEmail?.clientId === activeClient, savedDraftNonce);
  const conversationContactId = conversationContact ? contactForClient(conversationContact)?.id ?? null : null;
  const {
    sendingMessage, sendMessage, deleteMessage, markTaskChannelRead, editMessage,
    scheduledMessages, loadScheduledMessages, scheduleMessage, cancelScheduledMessage,
    refreshingMessages, refreshMessages, resetConversations,
  } = useMessaging({
    meId: me.id, messages, setMessages, loading, openTaskId, conversationContactId, contactForClient, clientById, pushToast,
    // Answering is what a "Reply to X" task was waiting for, so it closes.
    onAnswered: (taskId) => {
      const t = tasksRef.current.find((x) => x.id === taskId);
      if (t && isReplyTask(t) && t.status !== "done") patchTask(taskId, { status: "done" });
    },
  });
  // What the client last said, under the title of each task still waiting on us.
  const previewByTask = useMemo(() => unansweredPreviewByTask(messages), [messages]);

  // The Inbox. Loaded whatever page is open, so the sidebar can count it.
  const clientNames = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  // A thread is named after the person: their contact's name, not the address
  // or display name Gmail had ("brian bibboards.com").
  const contactNames = useMemo(() => new Map(contacts.map((c) => [c.id, c.name])), [contacts]);
  const inboxNameOf = useCallback((m: Message) => (m.contactId ? contactNames.get(m.contactId) ?? null : null) ?? (m.clientId && !m.peerName ? clientNames.get(m.clientId) ?? null : null), [clientNames, contactNames]);
  const { prefs: inboxPrefs, setPrefs: setInboxPrefs } = useInboxPrefs(me.id);
  // A Claude draft opened from the client's page leaves the Inbox's queue once it goes.
  const afterQueuedSend = <T,>(queuedId: string | undefined, sent: T): T => {
    // Only once it actually went (audit 2026-10-07: a failed send dropped it too).
    // Its Gmail copy goes too, so it can't be sent a second time from Gmail.
    if (queuedId) void Promise.resolve(sent).then((ok) => { if (ok === true) void retireQueuedDraft(setInboxPrefs, queuedId); }, () => {});
    return sent;
  };
  const inboxGmailSync = useMemo(() => ({ read: inboxPrefs.gmailRead, archive: inboxPrefs.gmailArchive }), [inboxPrefs.gmailRead, inboxPrefs.gmailArchive]);
  // Task chats in the Inbox: your mentions, comments on your tasks and a
  // client's review notes, as messages on that task's chat conversation.
  const inboxTaskNotes = useMemo(() => { const taskById = new Map(tasks.map((t) => [t.id, t])); return notifications
    .filter((n) => n.recipientId === me.id && n.taskId && !/^\d+[a-z] ago$/.test(n.at))
    .flatMap((n): Message[] => {
      const kind = inboxKind({ text: n.text, actor_id: n.actorId ?? null });
      // Teammates' comments and mentions now come in as task chats (below).
      if (kind !== "client_review") return [];
      const task = taskById.get(n.taskId!);
      if (!task) return [];
      const said = latestCommentBy(task.comments, n.actorId ?? null, kind === "client_review");
      return [{
        id: `note_${n.id}`, contactId: "", clientId: task.clientId, taskId: task.id, channel: "chat", direction: "inbound",
        subject: task.title, body: said ? `${n.text}\n\n${said}` : n.text, ghlMessageId: null, createdBy: n.actorId ?? null, at: n.at,
        read: n.read, attachments: [], cc: [], bcc: [],
        peerName: kind === "client_review" ? (clientById(task.clientId)?.name ?? "Client") : (userById(n.actorId ?? "")?.name ?? "Teammate"),
        peerAddress: null,
      }];
    }); }, [notifications, me.id, tasks]); // eslint-disable-line react-hooks/exhaustive-deps -- clientById/userById read state already listed
  // ── Team chat in the Inbox (Derek, 2026-10-02, mockup
  // https://claude.ai/artifact/EEwdfz34xJxnfjkbBWS8gG): a chat per task (its
  // comments), direct messages, and the team group, laid out like texts.
  const [teamFeed, setTeamFeed] = useState<{ id: string; author_id: string; body: string; created_at: string }[]>([]);
  const loadTeamFeed = useCallback(() => {
    supabase.from("team_messages").select("id, author_id, body, created_at").gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: true }).limit(500).then(({ data }) => { if (data) setTeamFeed(data as typeof teamFeed); });
  }, []);
  useEffect(() => {
    loadTeamFeed();
    const id = setInterval(loadTeamFeed, 60_000);
    return () => clearInterval(id);
  }, [loadTeamFeed]);
  const teamInbox = useMemo(() => buildTeamMessages({ meId: me.id, meName: me.name, users, tasks, dms: dmMessages, feed: teamFeed }), [me.id, me.name, tasks, dmMessages, teamFeed]);
  const inboxExtra = useMemo(() => [...inboxTaskNotes, ...teamInbox], [inboxTaskNotes, teamInbox]);
  const sendTeam = async (key: string, body: string) => {
    if (key.startsWith("team:task:")) { addComment(key.slice(10), body); return; }
    if (key.startsWith("team:dm:")) { sendDmMessage(key.slice(8), body); return; }
    const row = { id: newId("tm_"), author_id: me.id, body: body.trim(), created_at: new Date().toISOString() };
    setTeamFeed((f) => [...f, row]);
    const { error } = await supabase.from("team_messages").insert({ id: row.id, author_id: row.author_id, body: row.body });
    if (error) { setTeamFeed((f) => f.filter((x) => x.id !== row.id)); throw new Error(error.message); }
  };
  const inbox = useInbox({ meMemberId: me.id, isAdmin: me.role === "admin", liveMessages: messages, extraMessages: inboxExtra, tasks, nameOf: inboxNameOf, gmailSync: inboxGmailSync, allows: inboxPrefs.allowSenders, hide: inboxPrefs.hideKinds, pushToast, ready: !loading });
  // Updates don't count toward the badge or pop alerts: they are robots.
  const inboxUnread = useMemo(() => inbox.threads.filter((t) => t.unread && !t.done && !t.snoozed && !t.trashed && !t.updates).length, [inbox.threads]);
  // A browser alert for a new message while ClickUpTasks is in another tab.
  const alertedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const unread = inbox.threads.filter((t) => t.unread && !t.done && !t.snoozed && !t.updates);
    const seen = alertedRef.current;
    alertedRef.current = new Set(unread.map((t) => `${t.key}|${t.latest.id}`));
    if (!seen || !inboxPrefs.popup || typeof Notification === "undefined") return;
    const fresh = unread.filter((t) => !seen.has(`${t.key}|${t.latest.id}`) && t.latest.direction === "inbound");
    if (!fresh.length || !document.hidden) return;
    // Permission is asked from a click (askAlertPermission in the Inbox).
    if (Notification.permission !== "granted") return;
    const t = fresh[0];
    const n = new Notification(`${t.peerName}`, { body: (t.subject ? `${t.subject}: ` : "") + t.latest.body.replace(/\s+/g, " ").slice(0, 140), tag: t.key });
    n.onclick = () => { window.focus(); goToViewRef.current("inbox"); n.close(); };
    if (inboxPrefs.sound) { try { new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=").play().catch(() => {}); } catch { /* no sound */ } }
  }, [inbox.threads, inboxPrefs.popup, inboxPrefs.sound]);
  // opts: what was typed in the Inbox's new task form (Derek, 2026-10-06:
  // "more custom control"); without it, the old one click version.
  const newTaskFromThread = async (t: InboxThread, opts?: { title?: string; clientId?: string | null; projectId?: string | null; assigneeId?: string | null; due?: string | null }): Promise<string | null> => {
    const first = t.peerName.split(/\s+/)[0];
    // The client picked in the panel when the email isn't matched to one yet.
    const owner = t.clientId || opts?.clientId || null;
    const lists = owner ? projectsForClient(owner) : [];
    const project = (opts?.projectId ? lists.find((x) => x.id === opts.projectId) : null) ?? lists[0] ?? null;
    // Nothing picked, or Personal picked: it goes on your own Personal list,
    // private like every Personal task.
    const personal = !project || owner === PERSONAL_CLIENT_ID;
    const task: Task = {
      id: newId("t_"), projectId: project?.id ?? PERSONAL_PROJECT_ID, clientId: project ? owner! : PERSONAL_CLIENT_ID,
      title: opts?.title?.trim() || (t.subject ? decodeEntities(t.subject).replace(/^(re|fwd?):\s*/i, "") : `Follow up with ${first}`),
      // No description (Derek, 2026-10-14): their email is on step 1 below and
      // in the Conversation already.
      description: "",
      status: "todo", priority: "normal", assigneeId: opts && "assigneeId" in opts ? opts.assigneeId ?? null : me.id, contactId: t.contactId,
      due: opts && "due" in opts ? opts.due ?? null : TODAY,
      // A due date picked here sets its follow up, as it does anywhere else.
      ...(opts?.due && opts.due !== TODAY ? { followUpAt: followUpWithDue({ due: null }, { due: opts.due }) ?? null } : {}),
      recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: false, private: personal, subtasks: [], attachments: [], comments: [],
      createdAt: new Date().toISOString(), createdBy: me.id,
    };
    // Its first step is answering them, with their email on it (Derek, 2026-10-12).
    const theirs = t.messages.find((m) => m.direction === "inbound" && m.channel === "email");
    if (theirs) {
      const from = (theirs.peerName ?? t.peerName).replace(/\s*\(via [^)]*\)\s*$/i, "").trim();
      const made = addReplyStep([], { messageId: theirs.id, from, subject: decodeEntities(theirs.subject ?? t.subject ?? ""), body: clientEmailText(theirs.body ?? "", from).slice(0, 6000), at: theirs.at, fileKey: emailMessageKey({ id: theirs.id, rfc822_message_id: theirs.rfc822MessageId, gmail_message_id: theirs.gmailMessageId }) }, from.split(/\s+/)[0] || first, () => newId("s_"));
      if (made) task.subtasks = made.map((x) => ({ ...x, assigneeId: task.assigneeId ?? undefined }));
    }
    setTasks((ts) => [...ts, task]);
    // The email's files come along (Derek, 2026-10-07: Kelly's photos didn't):
    // from the newest email from them that has any, once the task is saved.
    const withFiles = t.messages.find((m) => m.direction === "inbound" && (m.attachments ?? []).some((a) => (a as { gmailAttachmentId?: string }).gmailAttachmentId));
    void Promise.resolve(upsertTask(task, me.id)).then(async () => {
      if (!withFiles) return;
      const res = await authedFetch("/api/inbox/attachment/to-task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: withFiles.id, taskId: task.id }) }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (j?.attachments?.length) setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, attachments: [...x.attachments, ...j.attachments] } : x)));
      if (!res?.ok || j?.skipped?.length) pushToast(`${j?.skipped?.length ?? "Some"} of the email's files couldn't be added to the task. Add them from the email.`);
    });
    return task.id;
  };

  // The start load holds open tasks and the last 30 days of finished ones
  // (db.ts fetchAll). The rest load when something shows finished work: the
  // Finished log, lists showing done tasks, ⌘K search (everyone's), or one
  // client's Journal (that client's). Once each per session.
  const olderTasksLoaded = useRef(new Set<string>());
  const wantsAllDone = showCompletedLog || !hideDone || filters.status === "done" || cmdkOpen;
  const journalClient = activeClient !== "all" && clientTab === "chat" ? activeClient : null;
  useEffect(() => {
    const scope = wantsAllDone ? null : journalClient ? { clientId: journalClient } : undefined;
    if (loading || scope === undefined) return;
    const key = scope ? `c:${scope.clientId}` : "all";
    if (olderTasksLoaded.current.has("all") || olderTasksLoaded.current.has(key)) return;
    olderTasksLoaded.current.add(key);
    void fetchOlderDoneTasks(scope).then((older) => {
      if (older.length) setTasks((prev) => mergeFetched(prev, older, tasksWrittenSince(Date.now() - WRITE_SETTLE_MS)));
    });
  }, [loading, wantsAllDone, journalClient]);

  // A link or a notification can open a task the start load left out. Asked
  // for once the first load has landed, and only when it is not already here.
  const fetchedOpenTask = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !openTaskId || openTask || fetchedOpenTask.current === openTaskId) return;
    fetchedOpenTask.current = openTaskId;
    void fetchTaskById(openTaskId).then((t) => { if (t) setTasks((prev) => mergeFetched(prev, [t])); });
  }, [loading, openTaskId, openTask]);
  // Opening an Interaction task auto-pulls any reply sent directly in GHL's
  // own UI (not through this app) — the whole point being nobody wastes time
  // re-replying to something a teammate already answered elsewhere. Scoped
  // to Interaction tasks only (cheap, bounded — not every task open hits
  // GHL's API), silent unless it actually finds something new.
  useEffect(() => {
    if (!openTask || openTask.priority !== "conversation" || !openTask.contactId) return;
    const contact = contactById(openTask.contactId);
    if (!contact) return;
    refreshMessages(openTask.clientId, contact, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTaskId]);
  const filtersActive = filters.status !== "all" || filters.assignee !== "all" || filters.priority !== "all";
  const activeFilterCount = [filters.status !== "all", filters.assignee !== "all", filters.priority !== "all", sortBy !== "due"].filter(Boolean).length;

  // My open work in the order its dates demand, then laid across the days.
  // Same ordering the list uses, so the plan never disagrees with the board
  // about what is next.
  // due-date buckets relative to the fixed "today" — "This week"/"Next week"
  // are calendar weeks starting Sunday, not rolling 7-day windows, so the
  // boundary always falls on a Saturday regardless of what day "today" is.
  // Shared with Follow Up's sales board (dueBucketOf/DUE_BUCKETS in data.ts)
  // so both read identically — My Work for active clients, Follow Up for
  // sales (Derek, 2026-08-11).
  // Buckets on the effective date, so a task you asked to see today shows up
  // in Today even when it isn't owed for a week.
  // Bucketed by the date the person looking was actually given: a task
  // delegated to you groups on your item's date, not on the owner's.
  const dueBucket = (t: Task) => dueBucketOf(viewerDueDate(t, lensUserId), t.status === "done");

  type Grp = { key: string; label: string; color: string; tasks: Task[] };
  // "Needs you" first, whatever the grouping (Derek, 2026-10-13: "after Claude
  // is done or a client responds I'm missing it"): tasks whose current step
  // turned to your move because someone else acted (data.ts needsYou).
  const buildGroups = (list: Task[], dim: typeof groupBy = groupBy): Grp[] => {
    const needs = list.filter((t) => !!needsYou(t, me.id, clientById(t.clientId)?.name.split(" ")[0]));
    if (!needs.length) return buildGroupsBy(list, dim);
    const ids = new Set(needs.map((t) => t.id));
    return [{ key: "needs_you", label: "Needs you", color: "#ef4444", tasks: needs }, ...buildGroupsBy(list.filter((t) => !ids.has(t.id)), dim)];
  };
  const buildGroupsBy = (list: Task[], dim: typeof groupBy = groupBy): Grp[] => {
    // A hidden stage gets a column only when something is actually in it, so
    // nobody is looking at an empty Delegated column on the thirty three
    // clients where nothing has been handed off.
    if (dim === "status") return STATUS_ORDER
      .map((s) => ({ key: s, label: STATUS_META[s].label, color: STATUS_META[s].dot, tasks: list.filter((t) => effectiveStatus(t) === s) }))
      .filter((g) => !HIDDEN_STATUSES.has(g.key as TaskStatus) || g.tasks.length > 0);
    if (dim === "priority") {
      const needsReply = list.filter(hasUnreadReply);
      const needsReplyIds = new Set(needsReply.map((t) => t.id));
      const rest = list.filter((t) => !needsReplyIds.has(t.id));
      const buckets = PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_META[p].label, color: PRIORITY_META[p].color, tasks: rest.filter((t) => effectivePriority(t) === p) }));
      return needsReply.length ? [{ key: "needs_reply", label: "Needs your reply", color: "#0ea5e9", tasks: needsReply }, ...buckets] : buckets;
    }
    if (dim === "due") return DUE_BUCKETS.map((b) => ({ key: b.key, label: b.label, color: b.color, tasks: list.filter((t) => dueBucket(t) === b.key) }));
    // By list, in the order of the client's list tabs (lib/listOrder: A to Z
    // until an admin rearranges them); every client's lists together, A to Z.
    return (activeClient === "all" ? [...visibleProjects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })) : orderLists(visibleProjects)).map((p) => ({ key: p.id, label: p.name, color: clientById(p.clientId)?.color ?? "#94a3b8", tasks: list.filter((t) => t.projectId === p.id) }));
  };


  // Flat, in-display-order list of the tasks currently shown — drives prev/next
  // navigation inside the open task (j/k + header arrows).
  // myWork (the merged My Work board) has no entry here — it's a client/
  // project board, not a flat task list, so j/k prev/next task navigation
  // doesn't apply to it, same as it never applied to the old My Clients tab.
  // Memoized — buildGroups does an O(list × visibleProjects) pass in the
  // project-grouped case and several full scans of baseTasks otherwise, all
  // previously rerun on every render regardless of view.
  const displayedGroups = useMemo(
    () => (personalView ? buildGroups(myPersonalTasks, "due").filter((g) => g.tasks.length > 0) : buildGroups(sortTasks(baseTasks.filter(passesFilters)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personalView, myPersonalTasks, groupBy, visibleProjects, clients, baseTasks, filters, hideDone, notifications, me.id, sortBy, sortDir]
  );
  const orderedTaskIds = useMemo(() => displayedGroups.flatMap((g) => g.tasks.map((t) => t.id)), [displayedGroups]);
  // Snapshotted per open task, not recomputed live: marking the open task
  // Done drops it out of `orderedTaskIds` the instant "Hide done" (on by
  // default) filters it from the list — without freezing the nav order at
  // open time, Prev/Next silently stranded on "0 of N" the moment you
  // completed the task you were looking at. Refreshes automatically whenever
  // a different task opens; a live filter change while a task is already
  // open won't reshuffle nav mid-look, which is the more predictable feel.
  const [navSnapshot, setNavSnapshot] = useState<{ taskId: string | null; ids: string[] }>({ taskId: null, ids: [] });
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (openTaskId) setNavSnapshot({ taskId: openTaskId, ids: orderedTaskIds }); }, [openTaskId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (openTaskId) markTaskNotifsRead(openTaskId); }, [openTaskId]);
  const navTaskIds = navSnapshot.taskId === openTaskId ? navSnapshot.ids : orderedTaskIds;
  const openTaskIdx = openTaskId ? navTaskIds.indexOf(openTaskId) : -1;
  const goToTask = (delta: number) => { if (openTaskIdx < 0) return; const next = navTaskIds[openTaskIdx + delta]; if (next) setOpenTaskId(next); };
  useEffect(() => {
    if (!openTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      // Cmd/Ctrl-K opens the command palette (see the [] -deps effect above) —
      // e.key stays "k" regardless of modifiers, so without this guard that
      // shortcut also triggered "previous task" here at the same time.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); goToTask(1); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); goToTask(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTaskId, navTaskIds]);

  // Drag a task row onto a different group header to reprioritize/restatus it
  // (grouped list view, priority/status dims only — due/project groupings
  // don't have an unambiguous single-field patch, so drag is disabled there;
  // see the onDropInGroup wiring on the main GroupedList render below).
  const dropTaskInGroup = (taskId: string, groupKey: string) => {
    // Needs you is not a stage or a priority: nothing to set by dropping there.
    if (groupKey === "needs_you" || groupKey === "needs_reply") return;
    if (groupBy === "status") patchTask(taskId, { status: groupKey as TaskStatus });
    else if (groupBy === "priority") {
      if (!isManuallyAssignable(groupKey as Priority)) { pushToast("Interaction is assigned automatically, not manually."); return; }
      patchTask(taskId, { priority: groupKey as Priority });
    }
  };

  // finishHandoffInstead (below) ticks the handoff with toggleSub, which
  // useChecklist builds from this block's update, so it is reached through a
  // ref set once useChecklist has run.
  const toggleSubRef = useRef<(taskId: string, subId: string, want?: boolean) => void>(() => {});
  const toggleSubLate = (taskId: string, subId: string) => toggleSubRef.current(taskId, subId, true);
  const { patchTask, clearNeedsYou, update, clearSelection, finishHandoffInstead, toggleTaskSelection, bulkPatch, bulkDelete, deleteTask, addComment, duplicateTask, deleteComment, stepToTask, emailToTask, applyQueuePatches } = useTaskEdits({ tasksRef, pushToast, keepDoneVisible, setTasks, me, toggleSubLate, notify, setSelectedTaskIds, selectedTaskIds, setConfirmDialog, openTaskId, setOpenTaskId, projectById, clientById, tasks, sendMentionEmail });
  const { addFiles, uploadOneImage, downloadFile, downloadFileAs, downloadAllAsZip, zippingIds, removeFile, copyAttachmentLink } = useTaskFiles({ tasks, pushToast, setUploadProgress, update, setConfirmDialog });
  // --- GoHighLevel task sync -----------------------------------------------
  // A client is a GHL contact (cl_<localContactId>). To act on its GHL tasks we
  // need the contact's GHL id + the sub-account's location id (+ its token,
  // resolved server-side). Returns null when the task isn't tied to a GHL contact.
  // Tasks are no longer pushed INTO GoHighLevel. The only reason to reach a
  // client's GHL account is to email, text or call them, and the "Open in
  // GHL" contact link already does that (Derek: "we don't need to make a task
  // on their account"). A second copy of every task, living in a system
  // nobody actually worked it in, just meant two records drifting apart.
  //
  // The pull direction went too (api/ghl/import-tasks, deleted 2026-09-29).
  // Task.ghlTaskId stays on the model: tasks imported before then still carry
  // it, and the GoHighLevel webhook and the MCP status tool match on it.
  // Esc lets go of a selection, when nothing else is open to close first.
  useEffect(() => {
    if (!selectedTaskIds.size || openTaskId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) clearSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTaskIds.size, openTaskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { toggleSub, addSub, deleteSub, renameSub, patchSub, toggleLabel, delegateTask, bulkDelegate } = useChecklist({ tasks, update, me, setTasks, notify, setConfirmDialog, pushToast, tasksRef, selectedTaskIds, setBulkDelegateOpen, clearSelection });
  useEffect(() => { toggleSubRef.current = toggleSub; });
  // Needs you clears by itself the way this person chose in Settings
  // (Derek, 2026-10-13): on opening the task (the default), or on ticking a
  // step on it, or only with the ×. Silent, and only ever the step that
  // needs this person (clearedFromNeedsYou); it comes back when something
  // new happens. Opening: once per open, once the task itself is here (a
  // link to a task the start load left out waits for it to be fetched).
  const needsYouClears = inboxPrefs.needsYouClears;
  const seenOnOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!openTaskId) { seenOnOpen.current = null; return; }
    if (loading || !openTask || seenOnOpen.current === openTaskId) return;
    seenOnOpen.current = openTaskId;
    if (needsYouClearsOn(needsYouClears, "open")) clearNeedsYou(openTaskId, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTaskId, openTask, loading]);
  // Ticking: whatever this person ticked on the task, then the step that
  // needs them (if one still does) is marked seen.
  const seenOnTick = <T,>(taskId: string, act: () => T): T => {
    if (!needsYouClearsOn(needsYouClears, "tick")) return act();
    const before = tasksRef.current.find((x) => x.id === taskId)?.subtasks ?? [];
    const out = act();
    const after = tasksRef.current.find((x) => x.id === taskId)?.subtasks ?? [];
    if (tickedAStep(before, after)) clearNeedsYou(taskId, { silent: true });
    return out;
  };
  // Steps the server just wrote for this task (a review's stage moved them):
  // shown now, without a save of our own on top (it already holds them).
  // A step put on another task (What's next's "Add it to <task>").
  const addStepToTask = (taskId: string, step: Subtask) => {
    const t = tasksRef.current.find((x) => x.id === taskId);
    if (t) update(taskId, { subtasks: [...t.subtasks, step] }, { append: [step] });
  };
  const stepsFromServer = (taskId: string, subtasks: Subtask[]) => {
    tasksRef.current = tasksRef.current.map((t) => (t.id === taskId ? { ...t, subtasks } : t));
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, subtasks } : t)));
  };
  const toggleSubSeen = (taskId: string, subId: string, want?: boolean) => seenOnTick(taskId, () => toggleSub(taskId, subId, want));
  const lastUsedClientId = (): string | null => {
    const recent = Object.entries(clientUsed).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return recent.find((id) => id.startsWith("cl_") && clientById(id)) ?? null;
  };
  const openComposer = () => setDumpGroup({
    key: null, personal: personalView,
    clientId: activeClient.startsWith("cl_") ? activeClient : lastUsedClientId(),
  });
  useEffect(() => { openComposerRef.current = openComposer; });
  const clientCompany = (c: Client | null) => (c && c.id.startsWith("cl_") ? c.ghlLocationId : "");
  const { restoreClient, restoreProjectFromTrash, restoreTaskFromTrash, purgeClient, purgeProject, purgeTask, renameClient, deleteClient, addClientContact, addRemoteContact, mergeClients } = useClientAdmin({ subAccounts, setContacts, clients, setActiveClient, setMyWork, setPersonalView, setInboxView, setDmUserId, setSettingsView, setDirView, setAddClientOpen, pushToast, clientById, setClients, markOwnClientWrite, tasks, projects, setProjects, setTasks, me, setPromptDialog, setConfirmDialog, setClientLinks, setClientNotes, activeClient, contactById, setMessages, setFolders, setVaultFolders, setNotifications, syncMarks, olderTasksLoaded, resetConversations });
  const { saveTemplate, deleteTemplate, useTemplateAsTask, applyTemplate } = useTemplates({ setTaskTemplates, taskTemplates, setConfirmDialog, tasks, update, pushToast, me, setTasks });
  const { createStage, addProject, renameProject, deleteProject, toggleProjectHidden, railHidden, createFolder, renameFolder, deleteFolder, moveListToFolder, reorderFolders, reorderLists, setTaskStage, quickAddInStage, renameStage, toggleStageIsDone, deleteStage, reorderStages, requestMerge, bulkMoveTo, moveTaskToClient, moveTaskToNewProject } = useLists({ setPromptDialog, projects, setProjects, folders, setFolders, folderById, setConfirmDialog, projectById, stages, setStages, setTasks, tasks, finishHandoffInstead, update, activeClient, foldersForClient, projectsForClient, canAdmin, me, patchTask, pushToast, tasksRef, clientById, selectedTaskIds, clearSelection, setMessages, setOpenTaskId, setClientNotes });
  const { toggleQueue, setQueueSettings, moveInQueue, moveUpInQueue } = useQueue({ projectById, setProjects, tasksRef, setTasks, me, notify, pushToast });
  const { addNote, deleteLink, reorderLinks, saveClientFile, sendDmMessage, deleteDmMessage, pinDmMessage, editNote, deleteNote, saveLink } = useClientRecords({ setClientLinks, clientLinks, setLinkModal, setConfirmDialog, me, dmMessages, setDmMessages, notify, setClientNotes, projectById, clientById });
  const { createTasksFromDump, targetProjectId } = useComposer({ dumpGroup, activeClient, groupBy, me, setTasks, pinJustAdded, setDumpGroup, pushToast, activeProject, projects, setProjects, notify, addFiles,
    tasksRef, applyQueuePatches, today: todayIso(), openTaskWith: (start) => { setOpenTaskStart(start); setOpenTaskId(start.taskId); } });
  const { draftMessage, draftingMessage, draftFeedReply, refreshContact, refreshingContact, regenerateAiSummary } = useAiHelpers({ setAiSummaryBusyId, setClients, addNote, pushToast, openTask, setContacts });
  const { getClientShareUrl, copyClientShareLink, copyProjectShareLink } = useShareLinks({ clientById, pushToast, canAdmin, setClients, markOwnClientWrite, projectById, setProjects });
  if (loading) return (<div className="flex h-screen items-center justify-center text-muted">Loading your workspace…</div>);
  if (dbError) return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-lg font-semibold">Database not set up yet</div>
      <div className="max-w-md text-[13px] text-muted">Run <code className="rounded bg-background px-1 py-0.5">supabase/schema.sql</code> in your Supabase project&apos;s SQL editor, then reload this page.</div>
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[15px] text-red-600">{dbError}</div>
    </div>
  );

  // Shared header bits, reused by both the desktop header and the compact
  // mobile header below so the bell / filter / overflow popovers aren't
  // duplicated in source. Only one header is ever visible (CSS breakpoint),
  // so the popovers never double-render on screen.
  // Viewing one specific client, or one of its projects — the condition the
  // header's client-only controls already spell out inline in several places.
  const clientView = !settingsView && !inboxView && !dirView && !personalView && !myWork && activeClient !== "all";
  // "All Tasks" is the flat list with no other view claiming the screen —
  // the same condition headerTitleText falls through to below.
  const allTasksView = !settingsView && !inboxView && !dirView && !personalView && !myWork && activeClient === "all";
  const headerTitleText = settingsView ? "Settings" : inboxView ? (userById(dmUserId)?.name ?? "Direct Message") : dirView === "inbox" ? "Inbox" : dirView === "reminders" ? "Reminders" : dirView === "calendar" ? "Calendar" : dirView === "clients" ? "All clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "Clients" : activeClient === "all" ? "Tasks" : (activeProject && projectById(activeProject) ? projectById(activeProject)!.name : (clientById(activeClient)?.name ?? ""));
  const isClientDetail = !myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && !!clientById(activeClient);
  const showFilterControl = !inboxView && !dirView && !myWork && !settingsView && !(activeClient !== "all" && clientTab === "chat");
  // Whose tasks All Tasks is showing: me, everyone, or one named member.
  // The old Mine/All pair could only ask "me or everyone" (Derek: "make this
  // a drop down to select all or a user").
  const scopeControl = (
    <select value={allTasksScope} onChange={(e) => setAllTasksScope(e.target.value)}
      title="VAs only ever see their own tasks here regardless of this setting"
      className="min-w-0 max-w-[124px] rounded-md border bg-background px-2 py-1.5 text-[13px] font-medium outline-none sm:max-w-none">
      <option value="mine">Mine</option>
      <option value="all">Everyone</option>
      {users.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  );
  // One switch, not a third tab: All Tasks is either what is still open or
  // what got finished, for whoever the dropdown beside it names.
  const scopeControls = (
    <div className="flex min-w-0 items-center gap-2">
      {scopeControl}
      <button onClick={() => { if (!allTasksCompleted) openFinished(); setAllTasksCompleted((v) => !v); }}
        title={allTasksCompleted ? "Back to open tasks" : "Show what has finished: tasks done, reviews approved, handoffs finished"}
        className={`shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[16px] font-medium ${allTasksCompleted ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>
        Finished{!allTasksCompleted && newFinishedCount > 0 && (
          <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[16px] font-semibold text-white">{newFinishedCount}</span>
        )}
      </button>
    </div>
  );
  // Following moved out of the filter popover into its own header avatar
  // stack — "Following" isn't a filter, it's who's watching this client.
  const followingControl = !personalView && activeClient !== "all" && clientById(activeClient) ? (
    <div className="relative">
      {/* A bell says what the faces are (Derek, 2026-10-06: "we need an icon"). */}
      <button onClick={() => setFollowingOpen((o) => !o)} title="Following: who gets this client's updates" aria-label="Following"
        className="flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 hover:bg-accent-soft">
        <I.bell className="text-muted" />
        <span className="flex items-center -space-x-1.5">
          {(clientById(activeClient)!.assignedTo ?? []).length === 0
            ? <I.user className="text-muted" />
            : (clientById(activeClient)!.assignedTo ?? []).slice(0, 3).map((uid) => (<Avatar key={uid} id={uid} size={20} />))}
        </span>
      </button>
      {followingOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setFollowingOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-surface p-3 shadow-xl">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Following</div>
          {!canAdmin && (
            <div className="text-[13px] text-muted">
              {(clientById(activeClient)!.assignedTo ?? []).length === 0 ? "Nobody yet" : (clientById(activeClient)!.assignedTo ?? []).map((uid) => userById(uid)?.name).filter(Boolean).join(", ")}
            </div>
          )}
          {canAdmin && (
            <div className="flex flex-col gap-0.5">
              {users.map((u) => {
                const on = (clientById(activeClient)!.assignedTo ?? []).includes(u.id);
                return (
                  <button key={u.id} onClick={() => toggleClientAssignment(activeClient, u.id)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on && <I.check />}</span>
                    <Avatar id={u.id} size={18} /> <span className="truncate text-[13px]">{u.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </>)}
    </div>
  ) : null;
  // "Days left" and "Due date" are ONE option, not two (Derek asked for days
  // left; the label now says so). Days left is due date minus today, so the
  // two produce an identical ordering — offering both would be two menu
  // entries that do exactly the same thing, which is worse than one named
  // for what the column visibly shows. Created is listed here too: it was
  // sortable by clicking the column header but was missing from this menu.
  // The bar says what the list is currently doing rather than hiding it
  // behind an icon (Derek, 2026-09-01: "I like 3 because it's faster"). Every
  // one of these still opens the same popover it always did; the difference
  // is that you can read the answer without opening anything, and change one
  // thing without a panel.
  const GROUP_LABEL: Record<typeof groupBy, string> = {
    status: "stage", priority: "priority", due: "follow up / due", project: "project",
  };
  const SORT_LABEL: Partial<Record<SortBy, string>> = {
    manual: "manual", due: "days left", created: "oldest first", priority: "priority",
    title: "name", status: "stage", assignee: "assignee",
  };
  const barButton = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-2.5 py-1.5 text-[13px] text-muted hover:border-accent hover:text-accent";

  // The merged Journal feed's size — notes, messages, task comments and
  // completions, which is what ClientJournal actually renders. Lifted out of
  // the old Tasks/Journal toggle so the overflow item can carry it.
  const journalCount = () => {
    const noteCount = clientNotes.filter((n) => (activeProject ? n.projectId === activeProject : n.clientId === activeClient && !n.projectId)).length;
    const messageCount = activeProject ? 0 : (() => { const ct = contactForClient(activeClient); return ct ? messages.filter((m) => m.contactId === ct.id).length : 0; })();
    const activityCount = baseTasks.reduce((sum, t) => sum + t.comments.filter((c) => c.kind !== "event" || isCompletionEvent(c.body)).length, 0);
    return noteCount + messageCount + activityCount;
  };

  // The three view panels, shared by their own buttons and by the client
  // page's single View button (Derek, 2026-10-05, header mockup C).
  const groupSortPanel = (<>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Group &amp; sort</span>
            {(sortBy !== "due" || groupBy !== "priority") && <button onClick={() => { setGroupBy("priority"); setSortBy("due"); }} className="text-[13px] font-medium text-accent">Reset</button>}
          </div>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Group by</span><select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="status">Status</option><option value="priority">Priority</option><option value="due">Due date</option><option value="project">List</option></select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Sort</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="manual">Manual</option><option value="due">Days left (due date)</option><option value="created">Created (oldest first)</option><option value="priority">Priority</option><option value="title">Task name</option><option value="status">Status</option><option value="assignee">Assignee</option></select></label>
          <button onClick={toggleHideDone} className="flex w-full items-center gap-2 rounded px-0 py-1 text-left hover:bg-background">
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${hideDone ? "border-accent bg-accent text-white" : "border-border"}`}>{hideDone && <I.check />}</span>
            <span className="text-muted">Hide done tasks</span>
          </button>
          {activeProject && canAdmin && stagesForProject(activeProject).length === 0 && (
            <button onClick={() => createStage(activeProject)} className="flex w-full items-center gap-2 rounded border-t px-0 pt-2 text-left text-[13px] font-medium text-accent hover:bg-background">
              <I.plus /> Set up custom Kanban stages for this list
            </button>
          )}
  </>);
  const filterPanel = (<>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Filter</span>
            {filtersActive && <button onClick={() => setFilters({ status: "all", assignee: "all", priority: "all" })} className="text-[13px] font-medium text-accent">Clear</button>}
          </div>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Status</span><select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as FilterState["status"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Assignee</span><select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option><option value="team">With a teammate</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value={CLAUDE_ID}>Claude</option></select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Priority</span><select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as FilterState["priority"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{PRIORITY_ORDER.filter((p) => p !== "none").map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></label>
  </>);
  const columnsPanel = (<>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Columns</div>
          <div className="flex flex-col gap-0.5">
            {LIST_COLUMNS.map((c) => (
              <button key={c.key} onClick={() => toggleCol(c.key)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${visibleCols.includes(c.key) ? "border-accent bg-accent text-white" : "border-border"}`}>{visibleCols.includes(c.key) && <I.check />}</span>
                {c.label}
              </button>
            ))}
          </div>
  </>);
  const viewControl = (
    <div className="relative">
      <button onClick={() => setViewOpen((o) => !o)} title="Group, sort, filter and columns" className={`${barButton} ${activeFilterCount > 0 ? "border-accent text-accent" : ""}`}>
        <I.list className="h-3.5 w-3.5" />
        <span>View: <b className="font-semibold text-foreground">by {GROUP_LABEL[groupBy]}</b>{activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"}` : ""}</span>
        <span aria-hidden>▾</span>
      </button>
      {viewOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setViewOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 max-h-[75vh] w-72 max-w-[calc(100vw-1.5rem)] space-y-2.5 overflow-y-auto rounded-xl border bg-surface p-3 shadow-xl">
          {groupSortPanel}
          <div className="space-y-2.5 border-t pt-2.5">{filterPanel}</div>
          <div className="border-t pt-2.5">{columnsPanel}</div>
        </div>
      </>)}
    </div>
  );
  // Everyone, Mine or Claude, full size for the phone's View menu.
  const whoseOnPhone = filters.assignee === me.id ? "mine" : filters.assignee === CLAUDE_ID ? "claude" : filters.assignee === "waiting" ? "client" : filters.assignee === "team" ? "team" : "all";
  const whosePhoneBtn = (on: boolean) => `flex-1 px-2.5 py-2 text-[16px] ${on ? "bg-accent-soft font-semibold text-accent" : "bg-background text-muted hover:text-foreground"}`;
  const mineTogglePhone = (
    // Five on a phone: three, then two, so none is cut off in the View menu.
    <span className="grid grid-cols-3 gap-px overflow-hidden rounded-[5px] bg-[var(--border)] ring-1 ring-[var(--border)]" role="group" aria-label="Whose tasks">
      <button onClick={() => setFilters((f) => ({ ...f, assignee: "all" }))} aria-pressed={whoseOnPhone === "all"} className={whosePhoneBtn(whoseOnPhone === "all")}>Everyone</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: me.id }))} aria-pressed={whoseOnPhone === "mine"} className={whosePhoneBtn(whoseOnPhone === "mine")}>Mine</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: "waiting" }))} aria-pressed={whoseOnPhone === "client"} title="Waiting on the client" className={whosePhoneBtn(whoseOnPhone === "client")}>Client</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: "team" }))} aria-pressed={whoseOnPhone === "team"} title="A teammate has it" className={whosePhoneBtn(whoseOnPhone === "team")}>Team</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: CLAUDE_ID }))} aria-pressed={whoseOnPhone === "claude"} title="Tasks on Claude" className={whosePhoneBtn(whoseOnPhone === "claude")}>Claude</button>
    </span>
  );
  // On a phone, group, sort, filters, columns and the link to this view in
  // one small button, so the list starts one row under the title (Derek,
  // 2026-10-10, mockup 1).
  const viewControlPhone = (
    <div className="relative">
      <button onClick={() => setViewOpen((o) => !o)} title="Group, sort, filter and columns" aria-label="View options"
        className={`${barButton} ${activeFilterCount > 0 ? "border-accent text-accent" : ""}`}>
        <I.filter className="h-3.5 w-3.5" />
        {activeFilterCount > 0 && <b className="font-semibold">{activeFilterCount}</b>}
      </button>
      {viewOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setViewOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 max-h-[75vh] w-72 max-w-[calc(100vw-1.5rem)] space-y-2.5 overflow-y-auto rounded-xl border bg-surface p-3 shadow-xl">
          {/* A client page's Everyone, Mine or Claude lives here on a phone,
              so the list tabs fit without scrolling sideways (Derek, 2026-10-13). */}
          {clientView && <div className="space-y-1.5 border-b pb-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Whose tasks</div>
            {mineTogglePhone}
          </div>}
          {groupSortPanel}
          <div className="space-y-2.5 border-t pt-2.5">{filterPanel}</div>
          <div className="border-t pt-2.5">{columnsPanel}</div>
          {activeClient === "all" && canAdmin && (
            <button onClick={() => { copyLink(currentNav()); setViewOpen(false); }}
              className="flex w-full items-center gap-2 border-t pt-2.5 text-left text-[16px] font-medium text-accent"><I.link /> Copy a link to this view</button>
          )}
        </div>
      </>)}
    </div>
  );
  // Just mine: one click shows only your tasks, another shows everyone's
  // (Derek, 2026-10-06). The same Assignee filter the View panel sets.
  // Everyone, Mine or Claude (Derek, 2026-10-07: "add everyone, me, and
  // Claude"): the tasks waiting on Claude, a click away.
  const mineOn = filters.assignee === me.id;
  const claudeOn = filters.assignee === CLAUDE_ID;
  const clientOn = filters.assignee === "waiting";
  const teamOn = filters.assignee === "team";
  const everyoneOn = !mineOn && !claudeOn && !clientOn && !teamOn;
  const whoseBtn = (on: boolean) => `px-2.5 py-1.5 text-[13px] ${on ? "bg-accent-soft font-semibold text-accent" : "bg-background text-muted hover:text-foreground"}`;
  const mineToggle = (
    <span className="inline-flex overflow-hidden rounded-md ring-1 ring-[var(--border)]" role="group" aria-label="Whose tasks">
      <button onClick={() => setFilters((f) => ({ ...f, assignee: "all" }))} aria-pressed={everyoneOn} className={whoseBtn(everyoneOn)}>Everyone</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: me.id }))} aria-pressed={mineOn} className={whoseBtn(mineOn)}>Mine</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: "waiting" }))} aria-pressed={clientOn} title="Waiting on the client" className={whoseBtn(clientOn)}>Client</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: "team" }))} aria-pressed={teamOn} title="A teammate has it" className={whoseBtn(teamOn)}>Team</button>
      <button onClick={() => setFilters((f) => ({ ...f, assignee: CLAUDE_ID }))} aria-pressed={claudeOn} title="Tasks on Claude" className={whoseBtn(claudeOn)}>Claude</button>
    </span>
  );
  const groupSortControl = (
    <div className="relative">
      <button onClick={() => setGroupSortOpen((o) => !o)} title="Group & sort" className={barButton}>
        <I.list className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Grouped by <b className="font-semibold text-foreground">{GROUP_LABEL[groupBy]}</b> <span className="opacity-50">·</span> sorted by <b className="font-semibold text-foreground">{SORT_LABEL[sortBy] ?? sortBy}</b></span>
      </button>
      {groupSortOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setGroupSortOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] space-y-2.5 rounded-xl border bg-surface p-3 shadow-xl">
          {groupSortPanel}
        </div>
      </>)}
    </div>
  );
  const filterMenuControl = (
    <div className="relative">
      {/* Says how many rather than carrying a dot, so an unexpectedly short
          list explains itself instead of you hunting for why. */}
      <button onClick={() => setFilterMenuOpen((o) => !o)} title="Filter"
        className={`${barButton} ${activeFilterCount > 0 ? "border-accent text-accent" : ""}`}>
        <I.filter className="h-3.5 w-3.5" />
        {activeFilterCount > 0
          ? <><b className="font-semibold">{activeFilterCount}</b><span className="hidden sm:inline"> filter{activeFilterCount === 1 ? "" : "s"}</span></>
          : <span className="hidden sm:inline">No filters</span>}
      </button>
      {filterMenuOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setFilterMenuOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] space-y-2.5 rounded-xl border bg-surface p-3 shadow-xl">
          {filterPanel}
        </div>
      </>)}
    </div>
  );
  const columnsControl = (
    <div className="relative">
      <button onClick={() => setColumnsOpen((o) => !o)} title="Columns & density" className={barButton}>
        <I.grid className="h-3.5 w-3.5" />
        <span className="hidden sm:inline"><b className="font-semibold text-foreground">{visibleCols.length + 1 + (activeClient === "all" ? 1 : 0)}</b> columns</span>
      </button>
      {columnsOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setColumnsOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-surface p-3 shadow-xl">
          {columnsPanel}
        </div>
      </>)}
    </div>
  );
  // Names each active filter as a dismissible chip above the list instead of
  // an unexplained "3 of 18" count in the header — clicking a chip's × clears
  // just that filter, Clear resets all three at once.
  // Just mine shows itself on its own button, so its chip is left out here
  // (Derek, 2026-10-06: "it's in a bad place").
  const activeFilterBar = !clientView && (filters.status !== "all" || filters.priority !== "all" || (filters.assignee !== "all" && filters.assignee !== me.id)) ? (
    <div className="mb-2 mt-2 flex flex-wrap items-center gap-1.5 px-4 sm:px-5">
      {filters.status !== "all" && (
        <span className="inline-flex items-center gap-1 rounded-[5px] border bg-background px-2 py-0.5 text-[13px]">Status: {STATUS_META[filters.status].label}
          <button onClick={() => setFilters((f) => ({ ...f, status: "all" }))} className="text-muted hover:text-foreground"><I.close className="h-3 w-3" /></button></span>
      )}
      {filters.assignee !== "all" && filters.assignee !== me.id && (
        <span className="inline-flex items-center gap-1 rounded-[5px] border bg-background px-2 py-0.5 text-[13px]">Assignee: {filters.assignee === "unassigned" ? "Unassigned" : filters.assignee === "waiting" ? "Waiting on client" : filters.assignee === "team" ? "With a teammate" : userById(filters.assignee)?.name ?? filters.assignee}
          <button onClick={() => setFilters((f) => ({ ...f, assignee: "all" }))} className="text-muted hover:text-foreground"><I.close className="h-3 w-3" /></button></span>
      )}
      {filters.priority !== "all" && (
        <span className="inline-flex items-center gap-1 rounded-[5px] border bg-background px-2 py-0.5 text-[13px]">Priority: {PRIORITY_META[filters.priority].label}
          <button onClick={() => setFilters((f) => ({ ...f, priority: "all" }))} className="text-muted hover:text-foreground"><I.close className="h-3 w-3" /></button></span>
      )}
      <button onClick={() => setFilters({ status: "all", assignee: "all", priority: "all" })} className="text-[13px] font-medium text-accent hover:underline">Clear</button>
    </div>
  ) : null;
  // Hoisted rather than looked up inline inside the settings sheet's JSX —
  // an IIFE returning JSX there confused the React Compiler into treating it
  // as a component defined during render.
  const settingsClient = clientSettingsOpen && activeClient !== "all" ? clientById(activeClient) : null;
  // The Overdue, Waiting and Meeting boxes (Derek, 2026-10-05, mockup C).
  // Not on ClickUpLocal's own projects: messages, waiting and meetings are
  // about a client (Derek, 2026-10-08).
  // The client page's three answers and the Conversation they open (Derek,
  // 2026-10-14, client header mockup). Not on ClickUpLocal's own projects:
  // messages, waiting and meetings are about a client (Derek, 2026-10-08).
  const talkClient = clientView && clientTab !== "chat" && activeClient !== WORKSPACE_CLIENT_ID && clientById(activeClient) ? activeClient : null;
  const talk = talkClient ? (() => {
    const cid = talkClient;
    const ct = contactForClient(cid);
    const first = clientFirstName(ct, clientById(cid)!.name);
    const canMsg = canMessageClient(cid);
    // Portal chats count too (Derek, 2026-10-12: Pam's chat never showed here).
    const said = ct ? messages.filter((m) => m.contactId === ct.id && (m.channel === "email" || m.channel === "sms" || m.channel === "chat")) : [];
    const clientTasks = scopedTasksByClientId.get(cid) ?? [];
    const queued = (inboxPrefs.queuedDrafts ?? []).filter((d) => !!ct && (d.contactId === ct.id || d.to.toLowerCase() === ((d.kind === "email" ? ct.email : ct.phone) ?? "").toLowerCase()));
    const draftCount = canMsg ? collectClientDrafts({ tasks: clientTasks, messages: said, queued, clientDraft: savedClientDraft, sentAlready: (d, ms) => !!sentEmailFor(d, ms) }).length : 0;
    // Email, text and chat, only the ways they have; a chat needs a task to show on.
    const channels: TalkChannel[] = !canMsg || !ct ? [] : [...(ct.email ? ["email" as const] : []), ...(ct.phone ? ["sms" as const] : []),
      ...(whereNewMessageGoes({ channel: "chat", tasks: clientTasks, messages: said, contactId: ct.id, first }).taskId ? ["chat" as const] : [])];
    return { cid, ct, first, canMsg, said, clientTasks, queued, draftCount, channels };
  })() : null;
  // Outside the strip's render below: it writes through a ref (markOwnClientWrite).
  const setActiveClientReminders = (r: ClientReminders) => setClientReminders(activeClient, r);
  const needsStrip = talk ? (() => {
          const { cid, ct, first, canMsg, said, draftCount } = talk;
          const waiting = waitingTasksFor(cid).sort((x, y) => (x.due ?? "9999").localeCompare(y.due ?? "9999"));
          // Their open steps, the queue the reminders chase (lib/clientRequests).
          const requests = clientRequestsFor(cid);
          const foldIn = foldInRowsFor(cid);
          const top = orderRequests(requests, TODAY)[0];
          const unanswered = waitingOnReply(said);
          return (
            <>
              <ClientNeeds clientId={cid} ghlContactId={ct?.ghlContactId ?? null} first={first}
                newest={newestLine(said, { first, meId: me.id, nameOf: (id) => userById(id)?.name ?? null })}
                unanswered={unanswered ? waitingLine(first, unanswered.at) : null}
                draftCount={draftCount} feedOpen={feedFor === cid} onToggleFeed={() => setFeedClient(feedFor === cid ? null : cid)}
                waiting={requests.length || waiting.length} oldestWaiting={top?.title ?? waiting[0]?.title ?? null}
                onOpenNeeds={requests.length || foldIn.length ? () => setNeedsFor(cid) : null} onRemind={canMsg ? () => void remindAsDraft(cid) : null}
                reminders={clientById(cid)?.reminders} onSetReminders={canAdmin && clientById(cid)?.reminders !== undefined ? setActiveClientReminders : null}
                canBook={!!ct?.ghlContactId} onBook={() => setBookClient(cid)}
                requestChannels={[...(ct?.email ? ["email" as const] : []), ...(ct?.phone ? ["sms" as const] : [])]}
                onRequest={canMsg ? (ch) => void requestMeeting(cid, ch, inboxPrefs.defaultCalendarId ?? null) : null}
                onMeetNow={canMsg && ct ? () => setMeetNowClient(cid) : null}
                meetingNow={liveMeetingOf(scopedTasksByClientId.get(cid) ?? [], nowMs())}
                meId={me.id} pushToast={(m) => pushToast(m)}
                defaultCalendarId={inboxPrefs.defaultCalendarId ?? null} onSetDefault={(id) => setInboxPrefs({ defaultCalendarId: id })} />
              {needsFor === cid && (
                <ClientRequestsList clientId={cid} first={first} requests={requests} today={TODAY}
                  listName={(id) => (id ? projectById(id)?.name ?? null : null)}
                  foldIn={foldIn}
                  onFoldIn={(picks, onProgress) => addFoldInsFor(first, picks, onProgress)}
                  onOpenStep={(taskId, stepId) => { setNeedsFor(null); openStepNext(stepId); setOpenTaskId(taskId); }}
                  onReorder={(changes) => {
                    // One write per task whose step moved, never a bulk update.
                    for (const c of changes) {
                      const t = tasks.find((x) => x.id === c.taskId);
                      if (t) patchTask(t.id, { subtasks: t.subtasks.map((x) => (x.id === c.stepId ? { ...x, clientOrder: c.clientOrder } : x)) });
                    }
                  }}
                  onClose={() => setNeedsFor(null)} />
              )}
            </>
          );
        })() : null;
  // The Conversation: beside the list on a desktop, over it on a tablet, the
  // whole screen on a phone (ClientConversation). Always the same parent, the
  // page's own row, whether open or not.
  const conversationFeed = talk && feedFor === talk.cid ? (
    <ClientConversation key={talk.cid} first={talk.first} meId={me.id} nameOf={(id) => userById(id)?.name ?? null} messages={talk.said}
      taskTitle={(id) => tasks.find((x) => x.id === id)?.title ?? null} onOpenTask={(id) => setOpenTaskId(id)} onOpenFile={downloadFile}
      draftDeps={{
        clientId: talk.cid, first: talk.first, contact: talk.ct ?? null, canMessage: talk.canMsg, tasks: talk.clientTasks, messages: talk.said,
        queued: talk.queued, saved: savedClientDraft, tasksNow: tasksRef,
        sendMessage, patchTask, afterQueuedSend, retireQueued: (id) => void retireQueuedDraft(setInboxPrefs, id),
        openClientEmail: (start) => openClientEmail(talk.cid, start),
        openTaskWithEmail: (id) => { setOpenTaskEmail(id); setOpenTaskId(id); },
        onSavedDraftGone: () => setSavedDraftNonce((n) => n + 1),
        ccContacts: contacts, onUpload: (file) => uploadOneImage(`messages/${talk.cid}`, file), pushToast: (m) => pushToast(m),
      }}
      channels={talk.channels}
      whereFor={(channel) => whereNewMessageGoes({ channel, tasks: talk.clientTasks, messages: talk.said, contactId: talk.ct?.id ?? null, first: talk.first })}
      taskOptions={taskChoices(talk.clientTasks, talk.said)}
      answering={emailBeingAnswered(talk.said)}
      onSend={(channel, subject, text, replyTo, taskId) => sendFromFeed({ clientId: talk.cid, first: talk.first, tasksNow: tasksRef, sendMessage, patchTask, pushToast: (m) => pushToast(m) },
        channel, subject, channel === "email" ? plainTextToHtml(text) : text, replyTo, taskId)}
      onFullEmail={(subject, text) => openClientEmail(talk.cid, { subject, body: text.trim() ? plainTextToHtml(text) : "", replyTo: emailBeingAnswered(talk.said)?.id ?? null })}
      onAiDraft={(channel, taskId) => draftFeedReply(talk.cid, channel, taskId)}
      showAutomatic={!!inboxPrefs.feedShowAutomatic} onShowAutomatic={(v) => setInboxPrefs({ feedShowAutomatic: v })}
      seenAt={inboxPrefs.feedSeen?.[talk.cid] ?? null}
      onSeen={() => { const cid = talk.cid; setInboxPrefs((p) => ({ feedSeen: { ...(p.feedSeen ?? {}), [cid]: new Date().toISOString() } })); }}
      onClose={() => setFeedClient(null)}
      textFrom={{ pickKey: fromKey.client(talk.cid), locationId: textLocationFor(talk.cid) }} />
  ) : null;
  // A phone's ⋮ holds the client's links and who follows them (2026-10-14).
  const phoneSaas = isClientDetail ? contactForClient(activeClient)?.saasUrl ?? null : null;
  const phoneLinks = isClientDetail ? clientLinks.filter((l) => l.clientId === activeClient) : [];
  const phoneFollows = isClientDetail ? clientById(activeClient)?.assignedTo ?? [] : [];
  const phoneRow = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[16px] hover:bg-background";
  const overflowControl = (
    <div className="relative">
      <button onClick={() => setHeaderMoreOpen((o) => !o)} title="More actions"
        className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground"><I.dots /></button>
      {headerMoreOpen && (<>
        <div className="fixed inset-0 z-40" onClick={() => setHeaderMoreOpen(false)} />
        {/* A sheet along the bottom on a phone, a menu under ⋮ elsewhere (2026-10-14). */}
        <div className="fixed inset-x-3 bottom-3 z-50 max-h-[75vh] overflow-y-auto rounded-[5px] border bg-surface p-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] shadow-soft-md sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:max-h-none sm:w-56 sm:overflow-visible sm:pb-1">
          {/* Journal lives here now (Derek, 2026-09-01: "we don't use journal
              much so much that under 3 dots"). It was half of a permanent
              segmented control at the top of every client, which is a lot of
              bar for a view nobody opens most days. */}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && (
            <button onClick={() => { setHeaderMoreOpen(false); setClientTab(clientTab === "chat" ? "tasks" : "chat"); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background">
              <I.comment /> {clientTab === "chat" ? "Back to tasks" : `Journal · ${journalCount()}`}
            </button>
          )}
          {/* On a phone the header is one line: their links and who follows
              them are here instead (Derek, 2026-10-14, client header). */}
          {isClientDetail && (
            <div className="sm:hidden">
              {(phoneSaas || phoneLinks.length > 0) && <>
                <div className="px-2.5 pb-0.5 pt-1.5 text-[16px] font-bold">Links</div>
                {phoneSaas && <a href={phoneSaas} target="_blank" rel="noopener noreferrer" onClick={() => setHeaderMoreOpen(false)} className={`${phoneRow} font-bold text-accent`}>SaaS account ↗</a>}
                {phoneLinks.map((l) => <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => setHeaderMoreOpen(false)} className={phoneRow}><I.link className="shrink-0 text-muted" /><span className="truncate">{l.label}</span></a>)}
              </>}
              <div className="px-2.5 pb-0.5 pt-1.5 text-[16px] font-bold">Following</div>
              {canAdmin ? users.map((u) => (
                <button key={u.id} onClick={() => toggleClientAssignment(activeClient, u.id)} aria-pressed={phoneFollows.includes(u.id)} className={phoneRow}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${phoneFollows.includes(u.id) ? "border-accent bg-accent text-white" : "border-border"}`}>{phoneFollows.includes(u.id) && <I.check />}</span>
                  <Avatar id={u.id} size={20} /> <span className="truncate">{u.name}</span>
                </button>
              )) : <div className="px-2.5 py-1.5 text-[16px] text-muted">{phoneFollows.length ? phoneFollows.map((uid) => userById(uid)?.name).filter(Boolean).join(", ") : "Nobody yet"}</div>}
              <div className="my-1 border-t" />
            </div>
          )}
          {/* The two icon buttons from the old bar, named (mockup C). */}
          {clientView && (<>
            <button onClick={() => { setHeaderMoreOpen(false); setDumpGroup({ key: null, personal: false }); }} title="Dump your notes and let AI create the tasks"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.plus /> Add tasks from notes</button>
            <button onClick={() => { setHeaderMoreOpen(false); copyClientForClaude(); }} title="Copy this list as a brief for Claude"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.copy /> Copy for Claude</button>
          </>)}
          {activeClient !== "all" && !activeProject && canMessageClient(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); openCompose("email"); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background sm:hidden"><I.comment /> Email</button>
          )}
          {activeClient !== "all" && !activeProject && canMessageClient(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); openCompose("sms"); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background sm:hidden"><I.comment /> SMS</button>
          )}
          <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Share</div>
          <button onClick={() => { setHeaderMoreOpen(false); copyLink({ view: null, client: activeClient, project: activeProject, task: null, clientTab, vaultFolder: null, dm: null, assignee: null, sub: null }); }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.link /> Copy link</button>
          {/* On every list too (Derek, 2026-10-05), not just the client's home. */}
          {activeClient !== "all" && clientById(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); copyClientShareLink(activeClient); }} title="A public, no-login link showing this client what we're waiting on them for"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.link /> Copy client link</button>
          )}
          {activeClient !== "all" && clientById(activeClient) && canMessageClient(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); openSendClientLink(activeClient); }} title="Email them their page. Opens for you to check before it sends."
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.comment /> Send client link</button>
          )}
          {activeClient !== "all" && activeProject && projectById(activeProject) && (
            <button onClick={() => { setHeaderMoreOpen(false); copyProjectShareLink(activeProject); }} title="A separate public link scoped to only this list — nothing else on the client is reachable from it"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.link /> Copy list link</button>
          )}
          {canAdmin && (
            <button onClick={() => { setHeaderMoreOpen(false); setLinkModal({}); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.plus /> Add quick link</button>
          )}
          {(ghlContactUrlFor(activeClient) || canAdmin) && (
            <div className="mt-1 border-t px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">GoHighLevel</div>
          )}
          {ghlContactUrlFor(activeClient) && (
            <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" onClick={() => setHeaderMoreOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-accent hover:bg-background"><I.bolt /> Open in GoHighLevel</a>
          )}
          {canAdmin && !ghlContactUrlFor(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); setGhlLinkSearch(""); setGhlLinkOpen(true); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.bolt /> Link to GoHighLevel</button>
          )}
          {canAdmin && clientById(activeClient)?.linkedContactId && (
            <button onClick={() => { setHeaderMoreOpen(false); linkClientToContact(activeClient, null); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-background hover:text-danger"><I.close /> Unlink from GoHighLevel</button>
          )}
          <div className="mt-1 border-t px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Manage</div>
          {canAdmin && activeClient !== "all" && !activeProject && clientById(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); setClientSettingsOpen(true); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.gear /> Client settings</button>
          )}
          {canAdmin && !activeProject && activeClient.startsWith("cl_") && clientById(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); setMergeClientState({ a: clientById(activeClient)! }); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-danger hover:bg-background"><I.repeat /> Merge with another client…</button>
          )}
        </div>
      </>)}
    </div>
  );

  return (
    // --drawer-left is where the docked TaskDrawer starts: the sidebar's right
    // edge, or the window's left edge when the sidebar is collapsed. Set here
    // (rather than read inside the drawer) so the one place that owns the
    // sidebar's width owns this too.
    // relative and max-w-full, so one too wide child can't widen the page on
    // a phone and push the header's icons off the right edge (2026-10-16): a
    // box positioned against the page itself is clipped here too.
    <div className="safe-x safe-y relative flex h-screen w-full max-w-full overflow-hidden text-[15px]" style={{ "--drawer-left": sidebarHidden ? "0px" : `${sidebarPx}px` } as React.CSSProperties}>
      {/* mobile backdrop */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ---------- Sidebar ---------- */}
      {/* A width worked out from the names (sidebarPx), never a w-max column:
          the content-sized version crashed the tab on
          Windows. A w-max column that scrolls is a feedback loop wherever
          scrollbars take layout width: the scrollbar appears, max-content
          shrinks, the scrollbar goes, it grows, and the ResizeObserver
          feeding the width into state re-rendered on every step until the
          renderer died. macOS overlay scrollbars take no width, which is why
          it only ever happened to Michaella. */}
      <aside style={{ width: sidebarPx, maxWidth: "85vw" }} className={`sidebar-dark safe-y fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col overflow-y-auto [scrollbar-gutter:stable] border-r bg-surface transition-transform ${sidebarHidden ? "md:hidden" : "md:static md:translate-x-0"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Dashboard, Conversations, and Clients/Projects/Personal, all one
            block (Derek: put them together "so they use less space") — no
            divider/gap between them, just Pinned below stays its own
            section. DMs under Conversations are parked per
            Derek's ask ("we don't need DMs for now, just the team — if they
            want to chat with someone specifically they can use the @") but
            not deleted, just admin-toggled off by default. */}
        <nav className="shrink-0 space-y-0.5 px-2">
          {/* One Clients item, not two (Derek, 2026-09-28). This is the board
              of your own clients and projects by urgency, which is what you
              open all day; the directory of every client is still there, one
              click back through a client's breadcrumb, and adding a client now
              happens here so there was nothing left to come to it for. */}
          {/* Search you can click, with its key written for this computer
              (Derek, 2026-10-05: Michaella is on Windows and couldn't find it). */}
          {/* Search first, then you and Settings at the end of the same row
              (Derek, 2026-10-05); the account block above it is gone. */}
          <div className="mb-1 flex items-center gap-1 pt-3">
            <button onClick={() => setCmdkOpen(true)} title={`Search everything (${shortcut("K")})`}
              className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-muted ring-1 ring-[var(--border)] transition hover:bg-background hover:text-foreground">
              <I.search className="shrink-0" /><span className="flex-1 truncate text-[15px]">Search</span>
              <kbd className="rounded border border-b-2 px-1.5 text-[12px] font-semibold">{shortcut("K")}</kbd>
            </button>
            {/* A link too, like every row below it (Derek, 2026-10-14). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a click stays in the app; the link is for right click */}
            <a href="/?view=settings" onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setDirView(null); setSidebarOpen(false); setOpenTaskId(null); setSettingsView(true); }} title={`${me.name} (${me.role}): Settings`} aria-label="Settings"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-background hover:text-foreground">
              <I.gear />
            </a>
          </div>
          {/* A phone has no Feedback tab on the edge (Derek, 2026-10-14): it is here. */}
          <button onClick={() => { setSidebarOpen(false); setFeedbackNonce((n) => n + 1); }}
            className="mb-1 flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[16px] text-muted hover:bg-background hover:text-foreground sm:hidden">
            <I.comment className="shrink-0" /> Send feedback
          </button>
          {/* Inbox and Calendar as two icons side by side (Derek, 2026-10-05: no text),
              then the Agency and Directory sub-accounts in GoHighLevel, in a new tab. */}
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {/* Links, so right click offers new tab, new window or side panel (Derek, 2026-10-05). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a click stays in the app; the link is for right click */}
            <a href="/?view=mail" onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); goToView("inbox"); }} title="Inbox: your email, texts and task chats (press 1)" aria-label="Inbox"
              className={`relative grid h-10 place-items-center rounded-lg text-[20px] transition ${dirView === "inbox" ? "bg-accent-soft ring-1 ring-accent/40" : "hover:bg-background"}`}>
              📥{inboxPrefs.badge && inboxUnread > 0 && <span className="absolute right-2 top-1 rounded-full bg-accent px-1.5 text-[12px] font-semibold leading-5 text-white">{inboxUnread}</span>}
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a click stays in the app; the link is for right click */}
            <a href="/?view=calendar" onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); goToView("calendar"); }} title="Calendar: the next two weeks, from GoHighLevel" aria-label="Calendar"
              className={`grid h-10 place-items-center rounded-lg text-[20px] transition ${dirView === "calendar" ? "bg-accent-soft ring-1 ring-accent/40" : "hover:bg-background"}`}>📅</a>
            {([["c_agency", "7B0Y8xCOblcTHzYnM1Kc", "Agency", "🏢"], ["c_directory", "GN4HK1ybbTBWcolEjLHl", "Directory", "📍"]] as const).map(([cid, fallback, label, icon]) => (
              <a key={cid} href={`https://app.gohighlevel.com/v2/location/${clientById(cid)?.ghlLocationId || fallback}/dashboard`} target="_blank" rel="noopener noreferrer"
                title={`Open the ${label} sub-account in GoHighLevel`} aria-label={`${label} in GoHighLevel`}
                // GoHighLevel's site, not its app: no use on a phone (Derek, 2026-10-13).
                className="hidden h-10 place-items-center rounded-lg text-[20px] transition hover:bg-background sm:grid">{icon}</a>
            ))}
          </div>
          {/* Reminders, right under Inbox (Derek and Justin, 2026-10-15): every
              reminder to a client waits there for Approve. */}
          {canAdmin && (
            <SideItem href="/?view=reminders" active={dirView === "reminders"} title="Reminders: every reminder to a client, to approve before it goes" onClick={() => goToView("reminders")}>
              <I.bell className="text-muted" /> <span>Reminders</span>
              {reminderCount > 0 && <span className="ml-auto text-[16px] font-bold text-accent" aria-label={`${reminderCount} to review`}>{reminderCount}</span>}
            </SideItem>
          )}
          <SideItem href="/?view=work" active={myWork} title="Clients (press 2)" onClick={() => goToView("dashboard")}><I.user className="text-muted" /> <span>Clients</span><span className="ml-auto text-[13px] text-muted">{myAssignedClients.length + myAssignedProjects.length}</span></SideItem>
          {/* Directly under My Work, which stays exactly as it was — this is
              a second way in, not a replacement. It went in without a number
              shortcut at first, to avoid shifting every row below it down one
              and breaking muscle memory. Shifting never turned out to be
              necessary: Clients, Projects and Personal were already on 3, 4
              and 5, so 2 was a hole in the middle of a list documented as
              sidebar order, and the second row was the only one you could not
              reach from the keyboard. It is now 2, and nothing else moved. */}
          {/* Your open tasks, not every task in the database. Every other row
              in this nav carries its count; this one was the exception. */}
          <SideItem href={ALL_TASKS_HREF} active={allTasksView} title={`${openTaskCount} open task${openTaskCount === 1 ? "" : "s"} assigned to you (press 3)`} onClick={() => goToView("alltasks")}><I.list className="text-muted" /> <span>Tasks</span><span className="ml-auto text-[13px] text-muted">{openTaskCount}</span></SideItem>
          {/* "Client replies" nav item removed (Derek, 2026-08-09) — My Work
              and Follow Up already surface an open conversation-priority
              task each their own way (hasOpenConversationTask / Follow Up's
              own task-driven tiers); a third place to check the same signal
              was redundant, not additional coverage. */}
          {clients.some((c) => c.id === WORKSPACE_CLIENT_ID) && (
            <SideItem href="/?view=projects" active={dirView === "projects"} title="Projects (press 4)" onClick={() => goToView("projects")}><I.folder className="text-muted" /> <span>Projects</span><span className="ml-auto text-[13px] text-muted">{workspaceProjects.length}</span></SideItem>
          )}
          <SideItem href="/?view=personal" active={personalView} title="Personal (press 5)" onClick={() => goToView("personal")}><I.check className="text-muted" /> <span>Personal</span><span className="ml-auto text-[13px] text-muted">{myPersonalTasks.filter((t) => t.status !== "done").length}</span></SideItem>
          {/* Teammate chats sit under Personal rather than between the work
              views (Derek, 2026-09-28): they are people, not places work
              lives, and they were splitting My Work and All Tasks off from
              Clients and Projects. */}
          {/* Teammate chats moved into the Inbox's Team chats (Derek, 2026-10-02). */}
        </nav>

        {/* Overdue and due today, your clients only (Derek, 2026-10-06: "see the
            clients overdue and due today in the side bar to work and clear
            them out instead of having to click on clients each time"). Each
            section folds shut and stays that way, per person. */}
        {(() => {
          const folded = new Set(inboxPrefs.sideFolded ?? []);
          const fold = (k: string) => setInboxPrefs({ sideFolded: folded.has(k) ? [...folded].filter((x) => x !== k) : [...folded, k] });
          // Clients, the workspace's own projects (Lincoln, Tracy, Administration…)
          // and Personal, all counted the same way: your open work, late or due today.
          const tally = (list: Task[]) => {
            let late = 0, today = 0;
            for (const t of list) {
              if (t.status === "done" || t.status === "on_hold") continue;
              // Waiting in line on a queue (Up next) is not today's work, even
              // with a follow up left on it (Derek, 2026-10-14: Amanda showed
              // here for a queued meeting task with nothing late or due).
              if (inLineOnly(t)) continue;
              const d = urgencyDateOf(t); if (!d) continue;
              if (d < TODAY) late++; else if (d === TODAY) today++;
            }
            return { late, today };
          };
          const openClient = (clientId: string, projectId: string | null) => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(clientId); setActiveProject(projectId); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); };
          const rows: { key: string; name: string; sub?: string; href: string; active: boolean; open: () => void; late: number; today: number }[] = [
            ...myAssignedClients.map((c) => ({ key: c.id, name: c.name, href: `/?client=${encodeURIComponent(c.id)}`,
              active: !myWork && !personalView && !inboxView && !settingsView && !dirView && !activeProject && activeClient === c.id, open: () => openClient(c.id, null),
              ...tally((scopedTasksByClientId.get(c.id) ?? []).filter((t) => isOnPlateOf(t, me.id))) })),
            ...myAssignedProjects.filter((pr) => pr.clientId === WORKSPACE_CLIENT_ID).map((pr) => ({ key: pr.id, name: pr.name, sub: clientById(pr.clientId)?.name, href: `/?client=${encodeURIComponent(pr.clientId)}&project=${encodeURIComponent(pr.id)}`,
              active: !myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject === pr.id, open: () => openClient(pr.clientId, pr.id),
              ...tally((scopedTasksByProjectId.get(pr.id) ?? []).filter((t) => isOnPlateOf(t, me.id))) })),
            { key: "personal", name: "Personal", href: "/?view=personal", active: personalView, open: () => { setSidebarOpen(false); goToView("personal"); }, ...tally(myPersonalTasks) },
          ].filter((r) => r.late + r.today > 0).sort((a, b) => b.late - a.late || b.today - a.today || a.name.localeCompare(b.name));
          if (!rows.length) return null;
          return (
            <nav className="mt-[10px] shrink-0 space-y-0.5 border-t px-2 pt-[10px]">
              <button onClick={() => fold("needs")} aria-expanded={!folded.has("needs")} title={folded.has("needs") ? "Show" : "Hide"}
                className="flex w-full items-center gap-1.5 px-2.5 pb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-foreground">
                <span aria-hidden className="text-[9px]">{folded.has("needs") ? "▸" : "▾"}</span><span className="flex-1">Overdue and today</span><span className="font-normal normal-case tracking-normal">{rows.length}</span>
              </button>
              {!folded.has("needs") && rows.map((r) => (
                <SideItem key={r.key} href={r.href} active={r.active} title={[r.late ? `${r.late} overdue` : "", r.today ? `${r.today} due today` : ""].filter(Boolean).join(", ")} onClick={r.open}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.late ? "#ef4444" : "#f59e0b" }} />
                  <span className="min-w-0 flex-1 truncate text-left">{r.sub ? <><span className="block truncate text-[11px] leading-tight text-muted">{r.sub}</span>{r.name}</> : r.name}</span>
                  {r.late > 0 && <span className="shrink-0 rounded px-1.5 text-[12px] font-bold text-white" style={{ background: "#ef4444" }}>{r.late}</span>}
                  {r.today > 0 && <span className="shrink-0 rounded px-1.5 text-[12px] font-bold text-white" style={{ background: "#f59e0b" }}>{r.today}</span>}
                </SideItem>
              ))}
            </nav>
          );
        })()}

        {/* Pinned — per-user quick access to starred clients + lists. Starring
            a client (from the Clients directory or its header) pins it here.
            Placed right after Clients/Projects since it's the highest-value,
            most-frequently-tapped section, so it shouldn't get pushed below
            the fold on a phone. */}
        {(() => {
          const pinnedClients = [...starred].map((id) => clientById(id)).filter((c): c is Client => !!c && c.id.startsWith("cl_"));
          const pinned = [...starredLists].map((id) => projectById(id)).filter((p): p is Project => !!p);
          if (pinnedClients.length === 0 && pinned.length === 0) return null;
          return (
            <nav className="mt-[10px] shrink-0 space-y-0.5 border-t px-2 pt-[10px]">
              <button onClick={() => setInboxPrefs({ sideFolded: (inboxPrefs.sideFolded ?? []).includes("pinned") ? (inboxPrefs.sideFolded ?? []).filter((x) => x !== "pinned") : [...(inboxPrefs.sideFolded ?? []), "pinned"] })}
                aria-expanded={!(inboxPrefs.sideFolded ?? []).includes("pinned")} title={(inboxPrefs.sideFolded ?? []).includes("pinned") ? "Show" : "Hide"}
                className="flex w-full items-center gap-1.5 px-2.5 pb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-foreground">
                <span aria-hidden className="text-[9px]">{(inboxPrefs.sideFolded ?? []).includes("pinned") ? "▸" : "▾"}</span><span className="flex-1">Pinned</span>
              </button>
              {!(inboxPrefs.sideFolded ?? []).includes("pinned") && pinnedClients.map((c) => {
                const active = !myWork && !personalView && !inboxView && !settingsView && !dirView && !activeProject && activeClient === c.id;
                return (
                  <SideItem key={c.id} href={`/?client=${encodeURIComponent(c.id)}`} active={active} drag={pinDrag("client", c.id)} title="Drag to reorder" onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(c.id); setActiveProject(null); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientStatusMeta(c.status).dot }} /> <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                    <span role="button" tabIndex={-1} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleStar(c.id); }} title="Unpin from sidebar" className="shrink-0 rounded p-0.5 text-amber-400 hover:bg-background"><I.star filled /></span>
                  </SideItem>
                );
              })}
              {!(inboxPrefs.sideFolded ?? []).includes("pinned") && pinned.map((p) => {
                const active = !myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject === p.id;
                // A list name alone ("Website") doesn't say whose — several
                // clients can have a same-named list. Show the owning
                // client small above it, same idea as ProjectsDirectory's
                // subtitle for the same ambiguity.
                const clientName = clientById(p.clientId)?.name;
                return (
                  <SideItem key={p.id} href={`/?client=${encodeURIComponent(p.clientId)}&project=${encodeURIComponent(p.id)}`} active={active} drag={pinDrag("list", p.id)} title="Drag to reorder" onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(p.clientId); setActiveProject(p.id); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
                    <I.list className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 text-left">
                      {clientName && <span className="block truncate text-[11px] leading-tight text-muted">{clientName}</span>}
                      <span className="block truncate leading-tight">{p.name}</span>
                    </span>
                    <span role="button" tabIndex={-1} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleStarList(p.id); }} title="Unpin from sidebar" className="shrink-0 rounded p-0.5 text-amber-400 hover:bg-background"><I.star filled /></span>
                  </SideItem>
                );
              })}
            </nav>
          );
        })()}

      </aside>

      {/* ---------- Main ---------- */}
      {/* The page itself is the scroll container so the header + quick-links +
          folder rail scroll away with the task list (rather than staying
          pinned and shrinking the list's scroll area). Views with their own
          internal scroll (Journal, Vault, directories) are flex-1 min-h-0, so
          they still scroll inside and this overflow never engages for them. */}
      {/* Nothing at the top of a page may shrink (headers, the links row, the
          list tabs): in this scrolling column a long list squeezed them to a
          sliver on phones (Derek, 2026-10-02). Views that scroll inside
          themselves are flex-1 and keep shrinking. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-background [&>:not(.flex-1)]:shrink-0">
        {/* Mobile header (Option A) — compact title bar + full-width segmented
            tabs. Reuses the shared bell/filter/overflow controls. The full
            desktop header below is hidden on phones. */}
        {/* overflow-x-clip, not hidden: hidden turned the other axis to auto,
            so the bell, filter and ⋮ menus opening under the header were cut
            off and a tap seemed to do nothing (2026-10-14). */}
        <header className="relative z-10 flex shrink-0 flex-col gap-2 overflow-x-clip border-b bg-surface px-3 py-2 shadow-soft sm:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={toggleSidebar} aria-label="Menu" className="shrink-0 rounded-lg border p-2 text-muted"><I.menu /></button>
            {/* Not flex-1: the icons sit right after the name, not pushed
                into the corner (Derek, 2026-10-16: "a little jammed up there
                in the top right corner, so move it over by inbox"). The name
                is what gives way, so nothing at the right is ever cut off. */}
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="min-w-0 truncate text-[17px] font-semibold">{headerTitleText}</h1>
              {/* The star beside the name, as on a desktop (2026-10-14). */}
              {isClientDetail && !activeProject && (
                <button onClick={() => toggleStar(activeClient)} aria-label={starred.has(activeClient) ? "Unpin from sidebar" : "Pin to sidebar"}
                  className={`shrink-0 rounded-[5px] p-1.5 ${starred.has(activeClient) ? "text-amber-400" : "text-muted"}`}><I.star filled={starred.has(activeClient)} /></button>
              )}
            </div>
            {/* Four ways round on a phone, beside the name: Search, Inbox,
                Calendar and Clients (Derek, 2026-10-16). Reminders is in the
                sidebar. A client's page has its own controls at the right,
                so there it is Search and Inbox, and the name still shows;
                Calendar goes below 360px wide. Links, so they open in a new
                tab too. */}
            <span className="flex shrink-0 items-center gap-1">
              <button onClick={() => setCmdkOpen(true)} aria-label="Search" title="Search" className="grid h-10 w-10 place-items-center rounded-[5px] text-muted hover:bg-background hover:text-foreground"><I.search className="h-5 w-5" /></button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a click stays in the app; the link is for a new tab */}
              <a href="/?view=mail" onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); goToView("inbox"); }} aria-label="Inbox" title="Inbox"
                className={`relative grid h-10 w-10 place-items-center rounded-[5px] hover:bg-background ${dirView === "inbox" ? "text-accent" : "text-muted"}`}>
                {/* The count sits inside the box, so the header never clips it. */}
                <I.inbox className="h-5 w-5" />{inboxPrefs.badge && inboxUnread > 0 && <span className="absolute right-0 top-0 min-w-5 rounded-full bg-accent px-1 text-center text-[12px] font-semibold leading-5 text-white">{inboxUnread > 99 ? "99+" : inboxUnread}</span>}
              </a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a click stays in the app; the link is for a new tab */}
              <a href="/?view=calendar" onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); goToView("calendar"); }} aria-label="Calendar" title="Calendar"
                className={`h-10 w-10 place-items-center rounded-[5px] hover:bg-background ${isClientDetail ? "hidden" : "grid max-[359px]:hidden"} ${dirView === "calendar" ? "text-accent" : "text-muted"}`}><I.calendar className="h-5 w-5" /></a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a click stays in the app; the link is for a new tab */}
              <a href="/?view=work" onClick={(e) => { if (!isPlainLeftClick(e)) return; e.preventDefault(); goToView("dashboard"); }} aria-label="Clients" title="Clients"
                className={`h-10 w-10 place-items-center rounded-[5px] hover:bg-background ${isClientDetail ? "hidden" : "grid"} ${myWork ? "text-accent" : "text-muted"}`}><I.user className="h-5 w-5" /></a>
            </span>
            {/* A client's page keeps everything on this one row (Derek,
                2026-10-13: "move all to one line on mobile"), pushed to the
                right; the name shortens to make room. */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 empty:hidden">
              {/* Who follows them and their links are in ⋮ on a phone (2026-10-14). */}
              {isClientDetail && clientTab === "tasks" && viewControlPhone}
              {/* Icon only here — the phone header has a title and two controls
                  already, and a labelled button would push one of them off. */}
              {!inboxView && !settingsView && !dirView && (
                <button onClick={openComposer} aria-label="New task" title="New task"
                  className="shrink-0 rounded-lg bg-accent p-2 text-white"><I.plus /></button>
              )}
              {isClientDetail && overflowControl}
            </span>
          </div>
          {isClientDetail ? null : myWork ? (
            <div className="flex flex-col gap-2">
              {/* Reviews and Drafts moved into the Inbox (Derek, 2026-10-06). */}
              {/* The desktop header's Add client, which a phone would otherwise
                  have no way to reach now that the directory is off the nav. */}
              {dashboardView === "work" && canAdmin && (
                <button onClick={() => setAddClientOpen(true)}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border bg-background px-3 py-2 text-[16px] font-semibold text-foreground">
                  <I.plus /> Add client
                </button>
              )}
            </div>
          ) : showFilterControl ? (
            // One row: whose tasks and Finished, then one View button that holds
            // group, sort, filters, columns and the link (Derek, 2026-10-10,
            // mockup 1). Seven controls on one line ran off a 375px screen
            // (2026-09-22), so the rest moved into that button, not a 2nd row.
            <div className="flex min-w-0 items-center gap-2">
              {activeClient === "all" && !myWork && canAdmin && scopeControls}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {followingControl}
                {viewControlPhone}
              </div>
            </div>
          ) : null}
        </header>

        <header className={`relative z-10 hidden shrink-0 items-center gap-x-3 gap-y-1.5 border-b bg-surface px-4 py-2 shadow-soft sm:flex sm:gap-y-2 sm:px-5 sm:py-3 ${isClientDetail ? "flex-nowrap" : "flex-wrap"}`}>
          <button onClick={toggleSidebar} title="Show/hide sidebar" className="rounded-lg border p-2 text-muted hover:text-foreground"><I.menu /></button>
          <div className={`min-w-0 ${isClientDetail ? "flex-1" : ""}`}>
            {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject && projectById(activeProject) ? (<>
              <h1 className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[20px] font-semibold"><I.folder className="shrink-0 text-muted" /> {projectById(activeProject)!.name}
                {/* The client's quick links on their lists too (Derek, 2026-10-06: header G
                    left them only on the client's own page). */}
                {/* One line: the links that fit, the rest under + More (2026-10-14). */}
                {clientView && (
                  <QuickLinksBar fit links={clientLinks.filter((l) => l.clientId === activeClient)} canEdit={canAdmin} onOpenFile={(l) => { if (l.path) downloadFile(l.path); }}
                    onEdit={(link) => setLinkModal({ initial: link })} onDelete={deleteLink} onReorder={(ids) => reorderLinks(activeClient, ids)}
                    onAdd={(v) => saveLink(activeClient, undefined, { ...v, groupLabel: "", color: "" })} />
                )}</h1>
              <p className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
                {/* One Clients, not two (Derek, 2026-10-08). */}
                <button onClick={() => { setDirView("clients"); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setOpenTaskId(null); }} className="hover:text-foreground hover:underline">Clients</button>
                <span>›</span>
                <button onClick={() => setActiveProject(null)} className="hover:text-foreground hover:underline">{clientById(activeClient)?.name}</button>
                {/* No done count or progress bar here — it said the same
                    thing three ways in a breadcrumb (Derek: "remove tasks
                    done, it's just clutter"). */}
              </p>
            </>) : (<>
              {/* Not truncate: it clipped the Following menu beside the name. */}
              <h1 className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[20px] font-semibold">
                {/* The name gives way (ends in …) before the links run under the bell. */}
                <span className="min-w-0 truncate">{settingsView ? "Settings" : inboxView ? (userById(dmUserId)?.name ?? "Direct Message") : dirView === "inbox" ? "Inbox" : dirView === "reminders" ? "Reminders" : dirView === "calendar" ? "Calendar" : dirView === "clients" ? "All clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "Clients" : activeClient === "all" ? "Tasks" : (ghlContactUrlFor(activeClient) ? <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="hover:text-accent hover:underline">{clientById(activeClient)?.name}</a> : clientById(activeClient)?.name)}</span>
                {/* The health pill is gone: the Overdue box under the header says it
                    with the count (Derek, 2026-10-05, header mockup C). */}
                {/* Same star as the Clients directory row — pinning to the
                    sidebar shouldn't require leaving the client's own page
                    to do it. */}
                {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && !activeProject && (
                  <span role="button" tabIndex={-1} onClick={() => toggleStar(activeClient)} title={starred.has(activeClient) ? "Unpin from sidebar" : "Pin to sidebar"}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${starred.has(activeClient) ? "text-amber-400" : "text-muted"}`}><I.star filled={starred.has(activeClient)} /></span>
                )}
                {/* Their SaaS account first (Derek, 2026-10-06), then the quick
                    links (header G), on one line: the ones that fit, the rest
                    under + More (2026-10-14). */}
                {clientView && (
                  <QuickLinksBar fit links={clientLinks.filter((l) => l.clientId === activeClient)} canEdit={canAdmin} onOpenFile={(l) => { if (l.path) downloadFile(l.path); }}
                    lead={contactForClient(activeClient)?.saasUrl ? { label: "SaaS account ↗", url: contactForClient(activeClient)!.saasUrl!, title: "Open their SaaS account" } : null}
                    onEdit={(link) => setLinkModal({ initial: link })} onDelete={deleteLink} onReorder={(ids) => reorderLinks(activeClient, ids)}
                    onAdd={(v) => saveLink(activeClient, undefined, { ...v, groupLabel: "", color: "" })} />
                )}
                {/* No "N overdue" chip here (Derek, 2026-10-12): the list shows what's late. */}
              </h1>
              <div className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
                {/* Breadcrumb back to the Clients directory — only meaningful
                    when a specific client is the thing being viewed. */}
                {/* Company, then who follows them (Derek, 2026-10-05, mockup C). */}
                <span>{settingsView ? "Integrations, team, templates, and API tokens" : inboxView ? "Private, only the two of you can see this" : dirView === "inbox" ? "Your email, texts, social messages, calls and task chats" : dirView === "reminders" ? "Every reminder to a client waits here for your Approve" : dirView === "calendar" ? "The next two weeks, from GoHighLevel" : dirView === "clients" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"}` : dirView === "projects" ? `${workspaceProjects.length} project${workspaceProjects.length === 1 ? "" : "s"}` : personalView ? "Your private to-dos, only visible to you" : myWork ? "" : activeClient === "all" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}` : clientCompany(clientById(activeClient))}</span>
              </div>
            </>)}
          </div>

          <div className={`ml-auto flex items-center justify-end gap-1.5 sm:gap-2 ${isClientDetail ? "shrink-0 flex-nowrap" : "flex-wrap"}`}>
          {/* The only way into the create form since the floating "+" was
              removed, and the only way to make a task at all from All Tasks,
              where the inline row is off because no client is selected.
              Hidden on the views that are not lists of tasks. */}
          {!inboxView && !settingsView && !dirView && !clientView && (
            <button onClick={openComposer} title="New task (press c)"
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90">
              <I.plus /> New task
            </button>
          )}
          {/* Adding a client happens here now that this page is Clients (Derek,
              2026-09-28: "just make it so we can add clients from that page").
              It opens the new client straight away, as it always has. */}
          {myWork && dashboardView === "work" && canAdmin && (
            <button onClick={() => setAddClientOpen(true)} title="Add a client"
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1.5 text-[13px] font-semibold text-foreground hover:bg-accent-soft">
              <I.plus /> Add client
            </button>
          )}
          {/* This is the "All Tasks" scope toggle — it belongs there only. */}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient === "all" && canAdmin && (<>
            {scopeControls}
            <button onClick={() => copyLink(currentNav())} title="Copy a link to this exact Tasks view — same assignee, opens for anyone signed in"
              className="rounded-md border bg-background p-1.5 text-muted hover:bg-background hover:text-foreground"><I.link /></button>
          </>)}
          {/* The Tasks/Journal toggle is gone from the bar — Journal is in
              the ⋮ menu now, and Tasks is simply where you already are. */}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && clientById(activeClient) && (
            <div className="flex items-center gap-1.5">
              {/* Status dropdown hidden per Derek (Aug 23): the multi-stage
                  pipeline (Claimed/Interview/.../Past Client) isn't needed —
                  a client either made it into ClickUpTasks or didn't. Status
                  data/column and setClientStatus are untouched, just not
                  shown/editable here. Trial window is separate info (how
                  long the clock has left, not where the work's at) and
                  stays. Client-scoped, so hidden while a project is open. */}
              {!activeProject && canAdmin && (() => {
                // Only while it is actually running. It used to show for any
                // client carrying an end date, so one whose trial finished in
                // June still read "Trial ends 12 Jun" months later.
                const trial = trialState(clientById(activeClient)!);
                if (trial.kind !== "running") return null;
                return (
                  <span className="inline-flex items-center rounded-md border px-2 py-1 text-[13px] font-medium text-muted" title={`${TRIAL_DAYS} day trial window, set when this deal closed`}>
                    Trial ends {formatDue(trial.endsAt)}
                  </span>
                );
              })()}
              {/* Secondary/config actions folded into one overflow menu so the
                  header leads with Follow-up / tabs / Email-SMS / Follow / Status
                  / Review instead of a cluster of equal-weight buttons. Same
                  menu as the compact header — see overflowControl above. */}
              {/* Who follows them, left of the ⋮ (Derek, 2026-10-06; was beside the name). */}
              {followingControl}
              {overflowControl}
              {/* New task last, on the far right (mockup C). Email and Text are
                  in the Conversation now (2026-10-14). */}
              <button onClick={openComposer} title="New task (press c)"
                className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-accent px-3 py-1.5 text-[16px] font-semibold text-white hover:opacity-90">
                <I.plus /> New task
              </button>
            </div>
          )}


          {inboxView || settingsView || dirView ? null : myWork ? (
            <div className="flex flex-wrap items-center gap-2">
              {canAdmin && dashboardView === "work" && (
                <select value={myWorkUser} onChange={(e) => setMyWorkUser(e.target.value === me.id ? null : e.target.value)} aria-label="Whose clients"
                  title="Whose clients to show" className="h-[30px] rounded-md border bg-background px-2 text-[13px] font-semibold">
                  {[...users].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name))).map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `${u.name.split(/\s+/)[0]} (you)` : u.name.split(/\s+/)[0]}</option>)}
                </select>
              )}
              {/* De-emphasized on purpose — the Dashboard is meant to be the
                  one place everyone works from; this is just an escape
                  hatch to the flat list, not a peer to it. */}
              {dashboardView === "work" && (
                <button onClick={openAllTasks} title="See every task across all clients and projects"
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[13px] text-muted hover:bg-accent-soft hover:text-accent">
                  <I.list className="h-3.5 w-3.5" /> All tasks
                </button>
              )}
            </div>
          ) : !personalView && clientTab === "chat" ? null : (
            // Order is fixed on purpose (Derek, 2026-08-26: "put these on the
            // far right before the alert bell so it's always consistent").
            // The two that only appear on a client view sit at the END, right
            // before the bell, rather than at the front where their coming and
            // going shifted every other icon sideways between pages.
            // A client page keeps these in one View button on the list row
            // (mockup C); with no list row, the View button sits here.
            clientView ? (railHidden ? <span className="inline-flex items-center gap-1.5">{mineToggle}{viewControl}</span> : null) : (
            <div className="flex items-center gap-1.5">
              {followingControl}
              {groupSortControl}
              {filterMenuControl}
              {columnsControl}
            </div>)
          )}

          {/* No notification bell (Derek, 2026-09-01: "not useful"). It
              restated things the app already surfaces where you act on them:
              assignments show up in your task list, client replies raise a
              Conversation task, and unread chat is counted on the teammate's
              own row. A second inbox for the same signals is one more thing to
              clear rather than one more thing you learn from. */}

          </div>
          {/* Part of the bar, full width (Derek, 2026-10-05: "fill in the whole bar"). */}
        </header>

        {/* The three answers, under the header on every size (2026-10-14). */}
        {needsStrip && <div className="shrink-0 border-b bg-surface px-3 py-2.5 sm:px-5">{needsStrip}</div>}
        {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && !clientView && (
          <QuickLinksBar
            links={clientLinks.filter((l) => l.clientId === activeClient)}
            canEdit={canAdmin}
            onEdit={(link) => setLinkModal({ initial: link })}
            onDelete={deleteLink}
            onReorder={(ids) => reorderLinks(activeClient, ids)}
            onAdd={(v) => saveLink(activeClient, undefined, { ...v, groupLabel: "", color: "" })}
          />
        )}


        {/* content */}
        {settingsView ? (
          <SettingsHub
            initialTab={settingsInitialTab}
            needsYouClears={inboxPrefs.needsYouClears} onSetNeedsYouClears={(v) => setInboxPrefs({ needsYouClears: v })}
            meetingLink={inboxPrefs.meetingLink ?? ""} onSetMeetingLink={(v) => setInboxPrefs({ meetingLink: v })}
            me={me} canAdmin={canAdmin}
            subAccounts={subAccounts}
            onSaveClient={(c) => { setClients((cs) => cs.map((x) => (x.id === c.id ? c : x))); markOwnClientWrite(c.id); upsertClient(c); }}
            onSynced={async () => { try { setContacts(await fetchContacts()); pushToast("Contacts updated from GoHighLevel"); } catch { /* ignore */ } }}
            clients={clients}
            templates={taskTemplates} projects={projects}
            onSaveTemplate={saveTemplate} onDeleteTemplate={deleteTemplate} onUseTemplateAsTask={useTemplateAsTask}
            dmEnabled={dmEnabled} onSetDmEnabled={setDmEnabled}
            onRestoreClient={restoreClient} onRestoreProject={restoreProjectFromTrash} onRestoreTask={restoreTaskFromTrash}
            onPurgeClient={purgeClient} onPurgeProject={purgeProject} onPurgeTask={purgeTask}
            theme={theme} onSetTheme={setThemePref} onSignOut={onSignOut}
          />
        ) : inboxView && dmUserId ? (
          <DmChat key={dmUserId} me={me} other={userById(dmUserId)!}
            messages={dmMessages.filter((m) => m.conversationId === dmConversationId(me.id, dmUserId))}
            onSend={(body, attachments, replyToId) => sendDmMessage(dmUserId, body, attachments, replyToId)} onDelete={deleteDmMessage}
            onPin={pinDmMessage} onUploadFile={(file) => uploadOneImage(`dm/${dmConversationId(me.id, dmUserId)}`, file)} onOpenFile={downloadFile} onGetSignedUrl={signedUrlForFile} />
        ) : dirView === "calendar" ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
            <CalendarView meId={me.id} colorOf={(id) => users.find((u) => u.id === id)?.color ?? "#64748b"}
              clientName={(id) => clientById(id)?.name ?? null} onOpenClient={(id) => openClientList(id, null)} pushToast={(text) => pushToast(text)} contacts={contacts}
              defaultCalendarId={inboxPrefs.defaultCalendarId ?? null} onSetDefault={(id) => setInboxPrefs({ defaultCalendarId: id })}
              hiddenLinks={inboxPrefs.hiddenBookingLinks ?? []} onSetHidden={(ids) => setInboxPrefs({ hiddenBookingLinks: ids })}
              starredLinks={inboxPrefs.starredBookingLinks ?? []} onSetStarred={(ids) => setInboxPrefs({ starredBookingLinks: ids })}
              workFrom={inboxPrefs.workFrom ?? "09:00"} workTo={inboxPrefs.workTo ?? "17:00"} onSetHours={(f, t) => setInboxPrefs({ workFrom: f, workTo: t })}
              clientNote={(cid) => {
                // What's open with the client, under their meeting (Derek, 2026-10-05).
                const c = clientById(cid);
                if (!c) return null;
                const open = (scopedTasksByClientId.get(cid) ?? []).filter((t) => t.status !== "done" && t.status !== "on_hold");
                const waiting = waitingTasksFor(cid).length;
                const late = open.filter((t) => !t.waitingOnClient && t.due && t.due < TODAY).length;
                const first = c.name.trim().split(/\s+/)[0];
                return [waiting ? `${waiting} waiting on ${first}` : "", late ? `${late} overdue` : ""].filter(Boolean).join(" · ") || null;
              }} />
          </div>
        ) : dirView === "reminders" ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
            <RemindersView nameOf={(id) => (id === me.id ? "you" : userById(id)?.name ?? "the team")} pushToast={(m) => pushToast(m)} onCount={setReminderCount}
              // The task, its steps in view (Derek, 2026-10-15: "open the task so we can see the steps").
              onOpenStep={(_clientId, taskId) => { setOpenTaskId(taskId); }} />
          </div>
        ) : dirView === "inbox" ? (
          <div className="flex min-h-0 flex-1 bg-surface">
            <InboxView openKey={mailThread} onOpenKey={setMailThread} inbox={inbox} me={{ id: me.id, name: me.name, email: myEmail }} team={users.map((u) => ({ id: u.id, name: u.name }))}
              prefs={inboxPrefs} setPrefs={setInboxPrefs} clientName={(id) => (id ? clientById(id)?.name ?? null : null)}
              tasks={tasks} onOpenTask={(id, from) => { setInboxBackLabel(from ?? null); setOpenTaskId(id); }} onNewTask={newTaskFromThread}
              onUpload={uploadOneImage} onSignedUrl={(path) => signedUrlForFile(path)}
              onSendChat={async (t, body) => {
                // A teammate's note is answered on the task, for the team; a
                // client's portal chat is answered in the portal.
                if (t.latest.id.startsWith("note_") && t.latest.peerName !== clientById(t.clientId ?? "")?.name) { if (t.taskId) addComment(t.taskId, body); return; }
                if (t.clientId) await sendMessage(t.clientId, "chat", "", body, [], [], [], t.taskId);
              }}
              clients={workableClients.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))} canAdmin={canAdmin}
              contacts={contacts} onContactUpdated={(c) => setContacts((cs) => cs.map((x) => (x.id === c.id ? c : x)))}
              onSendTeam={sendTeam}
              onPatchTask={(id, patch) => patchTask(id, patch)}
              listsFor={(cid) => projectsForClient(cid).map((x) => ({ id: x.id, name: x.name }))}
              // Task drafts and reviews sent back, in the Inbox (Derek, 2026-10-06).
              // Read against the tasks as they are now: the list was fetched when
              // Drafts opened, and a draft since sent, deleted or on a task now
              // done is gone (Derek, 2026-10-07: "there's no draft here").
              workDrafts={pendingSends.drafts.filter((d) => { if (!d.taskId) return true; const t = tasks.find((x) => x.id === d.taskId); return !!t?.draftEmail && t.status !== "done" && !sentEmailFor(t.draftEmail, messages.filter((m) => m.taskId === t.id)); }).map((d) => ({ id: d.id, taskId: d.taskId, clientId: d.clientId, subject: d.subject, preview: d.preview, at: d.at,
                where: d.taskId ? tasks.find((t) => t.id === d.taskId)?.title ?? null : null, clientName: clientById(d.clientId)?.name ?? null }))}
              // Only reviews on your own tasks, or on tasks nobody has (Derek,
              // 2026-10-07: Justin saw Brian's changes on Derek's tasks).
              reviewsBack={openReviews.yourMove.filter((r) => { const t = tasks.find((x) => x.id === r.taskId); return !!t && (!t.assigneeId || t.assigneeId === me.id || isOnPlateOf(t, me.id)); }).map((r) => ({ id: r.id, taskId: r.taskId, name: r.name, days: r.days,
                taskTitle: tasks.find((t) => t.id === r.taskId)?.title ?? null, clientName: (() => { const t = tasks.find((x) => x.id === r.taskId); return t ? clientById(t.clientId)?.name ?? null : null; })() }))}
              // Mark handled: the review goes back to draft and leaves the group (Derek, 2026-10-13).
              onMarkReviewHandled={async (id) => {
                const r = await markReviewHandled(id);
                if (r) pushToast(r.ok ? `Marked handled: ${r.name}` : `Could not mark ${r.name} handled. It is back in the list.`);
              }}
              onOpenClientDraft={(cid) => { openClientList(cid, null); setClientTab("chat"); }}
              // Delete a draft from the Drafts list (Derek, 2026-10-06), with Undo.
              onDeleteWorkDraft={async (d) => {
                if (d.taskId) {
                  const was = tasks.find((t) => t.id === d.taskId)?.draftEmail ?? null;
                  patchTask(d.taskId, { draftEmail: null });
                  setTimeout(() => void loadPendingSends(), 800);
                  pushToast("Draft deleted", { label: "Undo", run: () => { patchTask(d.taskId!, { draftEmail: was }); setTimeout(() => void loadPendingSends(), 800); } });
                } else {
                  const was = await fetchClientEmailDraft(d.clientId);
                  await deleteClientEmailDraft(d.clientId);
                  void loadPendingSends();
                  pushToast("Draft deleted", was ? { label: "Undo", run: () => { void saveClientEmailDraft(d.clientId, was, me.id).then(() => loadPendingSends()); } } : undefined);
                }
              }}
              onAddComment={(id, body) => addComment(id, body)}
              onOpenClient={(id) => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(id); setActiveProject(null); setOpenTaskId(null); setClientTab("tasks"); }}
              ghlUrlFor={(contactId) => { const ct = contactById(contactId); const sub = ct ? clientById(ct.clientId) : null; return ct?.ghlContactId && sub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${sub.ghlLocationId}/contacts/detail/${ct.ghlContactId}` : null; }}
              onSchedule={(t, body, at) => (t.clientId && canMessageClient(t.clientId) ? scheduleMessage(t.clientId, t.channel === "email" ? "email" : "sms", t.subject ? (/^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`) : "", body, at.toISOString(), [], [], [], t.taskId, undefined, t.messages.find((m) => m.direction === "inbound")?.id ?? null) : Promise.reject(new Error("Send later works on a client's conversation."))) as Promise<void>}
              pushToast={pushToast} />
          </div>
        ) : dirView === "clients" ? (
          <ClientsDirectory clients={sortedClients} clientCompany={(c) => clientCompany(c)} taskCount={clientTaskCount} tasksByClient={openTasksByClient} starred={starred} onToggleStar={toggleStar}
            onOpen={(id) => { setDirView(null); setActiveClient(id); setActiveProject(null); setOpenTaskId(null); setClientTab("tasks"); }}
            canAdmin={canAdmin} onAddClient={() => setAddClientOpen(true)} onRename={renameClient} onDelete={deleteClient}
            sort={clientSort} onSetSort={saveClientSort} scope={clientListScope} onToggleScope={() => setClientListScope((s) => (s === "mine" ? "all" : "mine"))}
            groupBy={clientsGroupBy} onSetGroupBy={setClientsGroupBy} teamGroups={teamActiveClients} />
        ) : dirView === "projects" ? (
          <ProjectsDirectory projects={sortedWorkspaceProjects} openCount={projectTaskCount}
            needsYouCount={(id) => (scopedTasksByProjectId.get(id) ?? []).filter((t) => !!needsYou(t, me.id)).length}
            onOpen={(id) => { setDirView(null); setActiveClient(WORKSPACE_CLIENT_ID); setActiveProject(id); setOpenTaskId(null); setClientTab("tasks"); }}
            canAdmin={canAdmin} onAddProject={() => addProject(WORKSPACE_CLIENT_ID)} onRename={renameProject} onDelete={deleteProject}
            starredLists={starredLists} onToggleStarList={toggleStarList} />
        ) : personalView ? (
          <GroupedList ownList key={`${groupBy}:${activeClient === "all"}`} lensId={lensUserId} listsFor={projectsForClient} groupKind={groupBy} collapseFarBuckets={activeClient === "all"} meId={me.id} onOpenClient={(cid) => openClientList(cid, null)} groups={buildGroups(myPersonalTasks.filter(passesFilters))} showClient={false} clientById={clientById} projectById={projectById} folderById={folderById} contactById={contactById} previewByTask={previewByTask} visibleCols={["followUp", "due"]} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} onClearNeedsYou={clearNeedsYou} canQuickAdd quickAddHint="" onAddInGroup={(k) => setDumpGroup({ key: k, personal: true })} onToggleSub={toggleSubSeen} onAddSub={addSub} onDeleteSub={deleteSub} colOrder={colOrder} onReorderCols={reorderCols} />
        ) : showCompletedLog ? (
          // Now an All Tasks mode rather than a My Work tab — day-grouped feed
          // of what finished and when. The header's scope answers WHOSE work,
          // by the task's owner, exactly as it does for the list behind this;
          // the feed's own picker answers who finished it, which is a different
          // question once a client can be the one who did.
          <FinishedFeed rows={completionLog} ownerId={allTasksScope === "all" ? null : allTasksScope === "mine" ? me.id : allTasksScope}
            seenAt={finishedMarkerAt}
            onOpenTask={(_clientId: string, taskId: string) => setOpenTaskId(taskId)} />
        ) : myWork ? (
          <ClientsBoard groups={myWorkGroups} clientTaskCount={myClientTaskCount} projectTaskCount={myProjectTaskCount} hasUnreadMessage={hasUnreadMessage} onOpenTask={setOpenTaskId}
            onOpenClient={(id) => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(id); setActiveProject(null); setOpenTaskId(null); }}
            onOpenProject={(id) => {
              if (id === PERSONAL_PROJECT_ID) { setMyWork(false); setPersonalView(true); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setOpenTaskId(null); return; }
              const p = projects.find((x) => x.id === id); if (!p) return;
              setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(p.clientId); setActiveProject(id); setOpenTaskId(null);
            }} />
        ) : activeClient !== "all" && clientTab === "chat" ? (
          <ClientJournal
            key={activeProject ?? activeClient}
            onOpenClientTasks={() => openClientList(activeClient, activeProject ?? null)}
            onBook={activeProject || !contactForClient(activeClient)?.ghlContactId ? undefined : () => setBookClient(activeClient)}
            ghlUrl={activeProject ? null : ghlContactUrlFor(activeClient)}
            notes={clientNotes.filter((n) => (activeProject ? n.projectId === activeProject : n.clientId === activeClient && !n.projectId))}
            tasks={baseTasks}
            messages={activeProject ? null : (() => { const ct = contactForClient(activeClient); return ct ? messages.filter((m) => m.contactId === ct.id) : null; })()}
            me={me}
            onAdd={(type, body, attachments) => addNote(activeClient, type, body, activeProject, attachments)}
            onEdit={editNote}
            onDelete={deleteNote}
            onOpenTask={(id) => { setClientTab("tasks"); setOpenTaskId(id); }}
            onOpenMessages={() => { const ct = contactForClient(activeClient); if (ct) { setMessages((ms) => ms.map((m) => (m.contactId === ct.id ? { ...m, read: true } : m))); markMessagesReadDb(ct.id); } }}
            onSendMessage={activeProject || !canMessageClient(activeClient) ? undefined : (channel, subject, body) => sendMessage(activeClient, channel, subject, body)}
            onScheduleMessage={activeProject || !canMessageClient(activeClient) ? undefined : (channel, subject, body, scheduledAt) => scheduleMessage(activeClient, channel, subject, body, scheduledAt)}
            onComposeEmail={activeProject || !canMessageClient(activeClient) ? undefined : (reply) => openClientEmail(activeClient, reply ?? {})}
            onComposeText={activeProject || !canMessageClient(activeClient) ? undefined : () => openClientText(activeClient)}
            scheduled={scheduledMessages[activeClient] ?? []}
            onLoadScheduled={() => loadScheduledMessages(activeClient)}
            onCancelScheduled={(id) => cancelScheduledMessage(id, activeClient)}
            toContact={activeProject ? null : contactForClient(activeClient)}
            composeIntent={composeIntent}
            sendingMessage={sendingMessage}
            onUploadImage={(file) => uploadOneImage(`messages/${activeClient}`, file)}
            onOpenFile={downloadFile}
            canAdmin={canAdmin}
            canMessage={clientById(activeClient)?.canMessage}
            onToggleCanMessage={(memberId) => toggleClientMessagePermission(activeClient, memberId)}
            onDraftMessage={(channel, prompt) => draftMessage(activeClient, channel, prompt, activeProject)}
            draftingMessage={draftingMessage}
            onRefreshContact={activeProject ? undefined : (() => { const ct = contactForClient(activeClient); return ct ? () => refreshContact(ct) : undefined; })()}
            refreshingContact={refreshingContact}
            onRefreshMessages={activeProject ? undefined : (() => { const ct = contactForClient(activeClient); return ct ? () => refreshMessages(activeClient, ct) : undefined; })()}
            refreshingMessages={refreshingMessages}
            onWhatsNext={activeProject ? undefined : () => regenerateAiSummary(activeClient)}
            whatsNextBusy={aiSummaryBusyId === activeClient}
            folders={activeVaultFolders}
            onCreateFolder={(name) => createVaultFolder(activeClient, name)}
            onDeleteFolder={deleteVaultFolder}
            onSetNoteAttachmentFolder={setNoteAttachmentFolder}
            initialFolderFilter={initialVaultFolder}
          />
        ) : (
          <>
          {activeClient !== "all" && !railHidden && (() => {
            const cf = foldersForClient(activeClient);
            const cl = projectsForClient(activeClient);
            return (
              <FolderRail folders={cf} lists={cl} activeFolder={activeFolder} activeProject={activeProject} canAdmin={canAdmin}
                starredLists={starredLists} onToggleStarList={toggleStarList}
                onSelectAll={() => { setActiveFolder(null); setActiveProject(null); }}
                onCopyAllForClaude={() => void copyClientForClaude()}
                onSelectFolder={(id) => { setActiveFolder(id); setActiveProject(null); setGroupBy("project"); }}
                onSelectList={(id) => { setActiveProject(id); setActiveFolder(null); }}
                onCreateFolder={() => createFolder(activeClient)} onCreateList={(fid) => addProject(activeClient, fid)}
                onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onRenameList={renameProject} onDeleteList={deleteProject} onToggleListHidden={toggleProjectHidden} onToggleListQueue={toggleQueue} onMoveList={moveListToFolder}
                onReorderFolders={(ids) => reorderFolders(activeClient, ids)} onReorderLists={(fid, ids) => reorderLists(activeClient, fid, ids)}
                trailing={<span className="hidden items-center gap-1.5 sm:inline-flex">{mineToggle}{viewControl}</span>} onCopyListForClaude={(id) => void copyClientForClaude(id)} />
            );
          })()}
          {activeProject && stagesForProject(activeProject).length > 0 ? (
            <StageBoard stages={stagesForProject(activeProject)} tasks={baseTasks.filter(passesFilters)} canAdmin={canAdmin}
              onOpenTask={setOpenTaskId} onSetTaskStage={setTaskStage} onQuickAdd={(stageId, title) => quickAddInStage(activeProject, stageId, title)}
              onCreateStage={() => createStage(activeProject)} onRenameStage={renameStage} onToggleStageIsDone={toggleStageIsDone} onDeleteStage={deleteStage}
              onReorderStages={(ids) => reorderStages(activeProject, ids)} />
          ) : activeProject && queueSettings(projectById(activeProject)?.queue) ? (
            // A queue list: its line instead of the grouped list (mcp/queue.mjs).
            <QueueList name={projectById(activeProject)!.name} tasks={baseTasks} settings={queueSettings(projectById(activeProject)!.queue)!}
              meId={me.id} clientFirst={(clientById(activeClient)?.name ?? "").trim().split(/\s+/)[0] || "The client"} today={TODAY}
              onOpen={setOpenTaskId} onMove={(id, beforeId, reason) => moveInQueue(activeProject, id, beforeId, reason)}
              onMoveUp={(id, reason) => moveUpInQueue(activeProject, id, reason)} onSettings={(q) => setQueueSettings(activeProject, q)} onPatch={patchTask} />
          ) : (
            <>
            {activeFilterBar}
            <GroupedList key={`${groupBy}:${activeClient === "all"}`} lensId={lensUserId} listsFor={projectsForClient} groupKind={groupBy} collapseFarBuckets={activeClient === "all"} meId={me.id} onOpenClient={(cid) => openClientList(cid, null)} groups={buildGroups(sortTasks(baseTasks.filter(passesFilters)))} showClient={activeClient === "all"} clientById={clientById} projectById={projectById} folderById={folderById} contactById={contactById} previewByTask={previewByTask} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} onClearNeedsYou={clearNeedsYou} canQuickAdd quickAddHint="" onAddInGroup={railHidden ? (k) => setDumpGroup({ key: k, personal: false, clientId: activeClient.startsWith("cl_") ? activeClient : lastUsedClientId() }) : undefined} onToggleSub={toggleSubSeen} onAddSub={addSub} onDeleteSub={deleteSub} onDropInGroup={groupBy === "status" || groupBy === "priority" ? dropTaskInGroup : undefined} onMergeTasks={requestMerge} colOrder={colOrder} onReorderCols={reorderCols} selectedIds={selectedTaskIds} onToggleSelect={toggleTaskSelection} />
            </>
          )}
          </>
        )}
      </main>
      {conversationFeed}

      {selectedTaskIds.size > 0 && (
        // One tidy row (Derek, 2026-10-12: "how can we improve the bulk bar"):
        // how many and Clear, then what to change, then Claude, then Delete
        // on its own at the end. Every control the same height and corners.
        <div role="toolbar" aria-label="Change the selected tasks"
          // Centred over the task area, not the window, so the sidebar never
          // covers its left end; it wraps to a second row when narrow
          // (Derek, 2026-10-12: it was cut off).
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-30 flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[5px] border bg-surface px-3 py-2 text-[16px] shadow-xl md:left-[calc(var(--drawer-left,0px)_+_(100vw_-_var(--drawer-left,0px))_/_2)] md:max-w-[min(1100px,calc(100vw_-_var(--drawer-left,0px)_-_32px))]">
          <span className="font-semibold tabular-nums">{selectedTaskIds.size} selected</span>
          <button onClick={clearSelection} title="Unselect them (Esc)" aria-label="Clear the selection" className="h-9 rounded-[5px] px-2 text-muted hover:bg-background hover:text-foreground">✕</button>
          <span aria-hidden className="mx-1 h-6 w-px bg-[var(--border)]" />
          <select aria-label="Assign to" defaultValue="" onChange={(e) => {
            const v = e.target.value;
            // "waiting" is a task flag, not a real member id. It never touches
            // the assignee, and assigning never clears it: a waiting task
            // stays with whoever follows up on it (see applyWaitingStatusSync).
            if (v === "waiting") bulkPatch({ waitingOnClient: true }, "Set waiting on client");
            else if (v === "unassigned") bulkPatch({ assigneeId: null }, "Unassign");
            else if (v) bulkPatch({ assigneeId: v }, `Assign to ${users.find((u) => u.id === v)?.name ?? "user"}`);
            e.target.value = "";
          }} className={BULK_CTL}><option value="" disabled>Assign</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select aria-label="Stage" defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ status: e.target.value as TaskStatus }, `Set stage to ${STATUS_META[e.target.value as TaskStatus]?.label ?? e.target.value}`); e.target.value = ""; }} className={BULK_CTL}><option value="" disabled>Stage</option>{pickableStatuses().map((st) => <option key={st} value={st}>{STATUS_META[st].label}</option>)}</select>
          <select aria-label="Priority" defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ priority: e.target.value as Priority }, `Set priority to ${PRIORITY_META[e.target.value as Priority]?.label ?? e.target.value}`); e.target.value = ""; }} className={BULK_CTL}><option value="" disabled>Priority</option>{PRIORITY_ORDER.filter(isManuallyAssignable).map((pr) => <option key={pr} value={pr}>{PRIORITY_META[pr].label}</option>)}</select>
          {/* Reschedule (Derek, 2026-10-12): tick a group's box, then one date
              for all. A follow up before the new date moves with it, so an
              overdue task really leaves Overdue. No date clears them. */}
          <InlineDate value={null} onChange={(d) => { if (d) bulkPatch((t) => ({ due: d, ...(t.followUpAt && t.followUpAt < d ? { followUpAt: d } : {}) }), `Reschedule to ${friendlyDue(d)}`); }} emptyLabel="📅 Reschedule"
            className={`${BULK_CTL} inline-flex items-center font-semibold text-foreground`} />
          {/* Spread out (Derek, 2026-10-12): one task per business day from the
              day picked, soonest due first, so ten overdue tasks don't all
              land on the same Monday again. */}
          {selectedTaskIds.size > 1 && (
            <InlineDate value={null} onChange={(d) => {
              if (!d) return;
              const order = [...selectedTaskIds].map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)
                .sort((x, y) => (x.due ?? "9999").localeCompare(y.due ?? "9999") || x.title.localeCompare(y.title));
              const dayOf = new Map(order.map((t, i) => [t.id, addBusinessDaysIso(d, i)]));
              const last = dayOf.get(order[order.length - 1].id)!;
              bulkPatch((t) => { const day = dayOf.get(t.id) ?? d; return { due: day, ...(t.followUpAt && t.followUpAt < day ? { followUpAt: day } : {}) }; },
                `Spread out one a day, ${friendlyDue(d)} to ${friendlyDue(last)}`);
            }} emptyLabel="↔ Spread out" className={`${BULK_CTL} inline-flex items-center text-foreground`} />
          )}
          <select aria-label="Client portal" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) bulkPatch({ hiddenFromClient: v === "hide" }, v === "hide" ? "Hide from the client" : "Show to the client"); e.target.value = ""; }} className={BULK_CTL}>
            <option value="" disabled>Client portal</option><option value="hide">🔒 Hide from client</option><option value="show">👁 Show to client</option>
          </select>
          <button onClick={() => bulkPatch({ due: null }, "Removed due date")} title="Clear the due date on every selected task" className={`${BULK_CTL} text-muted hover:text-danger`}>No date</button>
          <div className="w-44">
            <SearchableSelect value="" onChange={(v) => v && bulkMoveTo(v)}
              options={moveTargets}
              placeholder="Move to…" searchPlaceholder="Search clients and projects…"
              className={BULK_CTL} />
          </div>
          {selectedTaskIds.size === 2 && (() => {
            // The older task is the "keeper" (target); the newer one merges
            // into it — no separate picker needed for exactly-2 selected.
            const [a, b] = [...selectedTaskIds].map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t);
            if (!a || !b) return null;
            const [target, source] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
            return (
              <button onClick={() => requestMerge(source.id, target.id)} title={`Merge "${source.title}" into "${target.title}"`} className={BULK_CTL}>Merge</button>
            );
          })()}
          {users.some((u) => u.id !== me.id) && (
            <button onClick={() => setBulkDelegateOpen(true)} title={`Hand all ${selectedTaskIds.size} to one person, once`} className={BULK_CTL}>Delegate</button>
          )}
          <button onClick={() => void copySelectedForClaude()} title="Copy just these tasks for Claude to complete"
            className="inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-accent px-3 font-semibold text-white hover:opacity-90"><span aria-hidden>✳</span> Copy for Claude</button>
          <span aria-hidden className="mx-1 h-6 w-px bg-[var(--border)]" />
          <button onClick={bulkDelete} title="Delete selected tasks" className="h-9 rounded-[5px] px-3 font-semibold text-danger hover:bg-danger/10">Delete</button>
        </div>
      )}

      {clientEmail && (() => {
        const cid = clientEmail.clientId;
        const contact = contactForClient(cid);
        const allowed = canMessageClient(cid);
        return (
          <ClientEmail key={clientEmail.nonce} start={clientEmail} clientName={clientById(cid)?.name ?? "this client"} meId={me.id}
            toEmail={contact?.email || null} toName={contact?.name ?? null} messages={contact ? messages.filter((m) => m.contactId === contact.id) : null}
            onClose={() => setClientEmail(null)}
            // A Claude draft from the queue goes with it, or Discard looked
            // like it did nothing (Derek, 2026-10-12).
            onDiscarded={clientEmail.queuedId ? () => void retireQueuedDraft(setInboxPrefs, clientEmail.queuedId!) : undefined}
            onSend={allowed ? (email) => afterQueuedSend(clientEmail.queuedId, sendMessage(cid, "email", email.subject, email.body, email.attachments, email.cc, email.bcc, null, undefined, email.replyTo)) : undefined}
            onSchedule={allowed ? (email, whenIso) => scheduleMessage(cid, "email", email.subject, email.body, whenIso, email.attachments, email.cc, email.bcc, null, undefined, email.replyTo) : undefined}
            ccContacts={contacts} onUpload={(file) => uploadOneImage(`messages/${cid}`, file)}
            onAiDraft={(instruction, context) => draftMessage(cid, "email", instruction || undefined, null, context)}
            scheduled={(scheduledMessages[cid] ?? []).filter((s) => s.channel === "email")}
            onLoadScheduled={() => loadScheduledMessages(cid)} onCancelScheduled={(id) => cancelScheduledMessage(id, cid)}
            pushToast={pushToast} />
        );
      })()}
      {clientText && (() => {
        const cid = clientText.clientId;
        const ct = contactForClient(cid);
        const allowed = canMessageClient(cid);
        return (
          <TextWindow key={clientText.nonce} clientId={cid} clientName={clientById(cid)?.name ?? "this client"} toName={ct?.name || clientById(cid)?.name || "them"} toPhone={ct?.phone || null}
            start={clientText.body} meId={me.id} pushToast={pushToast} onClose={() => setClientText(null)} textLocationId={textLocationFor(cid)}
            history={ct ? messages.filter((m) => m.contactId === ct.id && m.channel === "sms").sort((a, b) => a.at.localeCompare(b.at)) : []}
            onSend={allowed ? (body) => afterQueuedSend(clientText.queuedId, sendMessage(cid, "sms", "", body)) : undefined}
            onSchedule={allowed ? (body, whenIso) => scheduleMessage(cid, "sms", "", body, whenIso) : undefined}
            onAiDraft={(instruction) => draftMessage(cid, "sms", instruction || undefined, null)}
            onPageLink={() => getClientShareUrl(cid)} />
        );
      })()}
      {dumpGroup && (() => {
        // The list it lands on, when that is a queue: the box says where in
        // the line instead of a due date (lib/newTaskQueue).
        const cid = dumpGroup.clientId ?? activeClient;
        const pid = targetProjectId();
        const q = pid ? queueSettings(projectById(pid)?.queue) : null;
        const ct = dumpGroup.personal ? null : contactForClient(cid);
        return (
        <MindDumpModal
          // Keyed on the group so reopening on a different bar starts clean
          // rather than inheriting the last one's text and dates.
          key={`${dumpGroup.personal}:${dumpGroup.key ?? "-"}`}
          clientName={dumpGroup.personal ? "you" : (clientById(dumpGroup.clientId ?? activeClient)?.name ?? "this client")}
          listName={activeProject ? (projectById(activeProject)?.name ?? "Tasks") : "Tasks"}
          destinationHint={dumpGroup.personal ? "Your own list" : undefined}
          suggestedDue={dueForGroup(dumpGroup.key)}
          busy={bulkAddBusy}
          needsClient={!dumpGroup.personal && !(dumpGroup.clientId ?? activeClient).startsWith("cl_")}
          clients={workableClients}
          companyFor={(id) => contactForClient(id)?.company}
          defaultClientId={dumpGroup.clientId}
          onPickClient={(id) => setDumpGroup((g) => (g ? { ...g, clientId: id } : g))}
          onParse={parseTaskList}
          onAiAdd={aiAddTask}
          onCreate={createTasksFromDump}
          onCancel={() => setDumpGroup(null)}
          meId={me.id}
          // No client on Personal or on a list in Projects: no client choices.
          clientFirst={dumpGroup.personal || cid === WORKSPACE_CLIENT_ID ? null : clientFirstName(ct, clientById(cid)?.name ?? null)}
          personal={dumpGroup.personal}
          canMessage={!dumpGroup.personal && cid.startsWith("cl_") && canMessageClient(cid) && !!ct}
          hasPhone={!!ct?.phone}
          queue={q && pid ? { settings: q, tasks: tasks.filter((t) => t.projectId === pid) } : null}
        />
        );
      })()}
      {openTask && (
        // Keyed on the task, so switching tasks closes this drawer and opens
        // a new one rather than swapping the record underneath a drawer that
        // keeps its old state (Derek: "close the window and open the new one
        // when I hit enter in the command K search"). Without it the drawer
        // is one long-lived component: a composer left open, a description
        // mid-edit, a scrolled feed and an expanded section all carried over
        // onto whatever task you jumped to, which reads as the jump not
        // having happened. Applies to j/k navigation too, and should: a draft
        // typed against one task has no business following you to another.
        <TaskDrawer key={openTask.id} defaultCalendarId={inboxPrefs.defaultCalendarId ?? null} task={openTask} clientById={clientById} projectById={projectById} contactById={contactById}
          // A task opens as a panel sliding over the list, from anywhere, with
          // Open full page beside it (Derek, 2026-10-12: "in list mode can we
          // click to slide out and full as well").
          full={drawerFull} onToggleFull={toggleDrawerFull} slideOver fromInbox={dirView === "inbox"}
          slideBackLabel={dirView === "inbox" ? inboxBackLabel : (activeProject ? projectById(activeProject)?.name : null) ?? (activeClient !== "all" ? clientById(activeClient)?.name : null) ?? "Back"}
          navIndex={openTaskIdx} navTotal={navTaskIds.length} onPrev={() => goToTask(-1)} onNext={() => goToTask(1)}
          openEmail={openTaskEmail === openTask.id}
          start={openTaskStart?.taskId === openTask.id ? openTaskStart : undefined}
          // Closed, the next task opens as the panel again, not full page.
          onClose={() => { setOpenTaskId(null); setOpenTaskEmail(null); setOpenTaskStart(null); setDrawerFull(false); }} onPatch={(patch) => seenOnTick(openTask.id, () => patchTask(openTask.id, patch))} onClearNeedsYou={() => clearNeedsYou(openTask.id)} onDelete={() => deleteTask(openTask.id)} onAddComment={(body, attachments) => addComment(openTask.id, body, attachments)}
          onAddFiles={(files) => addFiles(openTask.id, files)} onDownloadFile={downloadFile} onDownloadFileAs={downloadFileAs} onDownloadAll={downloadAllAsZip} zippingIds={zippingIds} onRemoveFile={(att) => removeFile(openTask.id, att)} uploadProgress={uploadProgress} allClients={[...workableClients].sort((a, b) => a.name.localeCompare(b.name))} onMoveClient={(cid) => moveTaskToClient(openTask.id, cid)} clientProjects={projectsForClient(openTask.clientId)} onSetProject={(pid) => { patchTask(openTask.id, { projectId: pid }); }} onNewProject={() => moveTaskToNewProject(openTask.id, openTask.clientId)} onRenameProject={() => renameProject(openTask.projectId)} onToggleSub={(sid, want) => toggleSubSeen(openTask.id, sid, want)} onAddSub={(title) => addSub(openTask.id, title)} onRenameSub={(sid, title) => renameSub(openTask.id, sid, title)} onDeleteSub={(sid, after) => deleteSub(openTask.id, sid, after)} onPatchSub={(sid, patch) => seenOnTick(openTask.id, () => patchSub(openTask.id, sid, patch))} onToggleLabel={(lid) => toggleLabel(openTask.id, lid)} onCopyLink={() => copyLink({ view: null, client: "all", project: null, task: openTask.id, clientTab: null, vaultFolder: null, dm: null, assignee: null, sub: null })} onDuplicate={(target) => duplicateTask(openTask.id, target)} onStepToTask={(sid) => stepToTask(openTask.id, sid)} onEmailToTask={(sid) => emailToTask(openTask.id, sid)} projectsFor={projectsForClient} onOpenMerge={() => setMergeSourceId(openTask.id)} onOpenClientList={() => openClientList(openTask.clientId, openTask.projectId)} templates={taskTemplates} onApplyTemplate={(templateId) => applyTemplate(openTask.id, templateId)} onSaveTemplate={canAdmin ? (spec) => saveTemplate(undefined, spec) : undefined} onStepsFromServer={(subtasks) => stepsFromServer(openTask.id, subtasks)} sameClientTasks={tasks.filter((t) => t.clientId === openTask.clientId && t.id !== openTask.id && t.status !== "done")} historyTasks={tasks} onAddStepToTask={addStepToTask} onUploadCommentImage={(file) => uploadOneImage(`${openTask.id}/comments`, file)} onCopyAttachmentLink={copyAttachmentLink} onGetSignedUrl={signedUrlForFile} onSaveToClient={canAdmin ? (a) => { pushToast(saveClientFile(openTask.clientId, a) ? `Saved "${a.name}" to ${clientById(openTask.clientId)?.name ?? "the client"}` : "Saved to the client already"); } : undefined} messages={openTaskMessages} onMarkChannelRead={(channel) => markTaskChannelRead(openTask.id, channel)} linkedContactInfo={contactForClient(openTask.clientId)} onSaasSaved={noteSaasUrl} ccContacts={contacts} onUploadMessageImage={(file) => uploadOneImage(`messages/${openTask.clientId}`, file)} onSendTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, attachments, cc, bcc, replyToMessageId) => sendMessage(openTask.clientId, channel, subject, body, attachments, cc, bcc, openTask.id, undefined, replyToMessageId) : undefined} onScheduleTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, scheduledAt, attachments, cc, bcc, replyToMessageId) => scheduleMessage(openTask.clientId, channel, subject, body, scheduledAt, attachments, cc, bcc, openTask.id, undefined, replyToMessageId) : undefined} sendingMessage={sendingMessage} onDraftMessage={(channel, prompt, context) => draftMessage(openTask.clientId, channel, prompt, openTask.projectId, context)} draftingMessage={draftingMessage} canAdmin={canAdmin} onDeleteMessage={deleteMessage} onEditMessage={editMessage} onCopyClientLink={() => {
            // The client's portal, opened straight on this task (Derek, 2026-10-12).
            const url = getClientShareUrl(openTask.clientId, { taskId: openTask.id });
            if (url) navigator.clipboard?.writeText(url).then(() => pushToast("Client portal link copied, opens on this task"), () => pushToast(`Share this link: ${url}`));
          }} onDeleteComment={(cid) => deleteComment(openTask.id, cid)} pushToast={pushToast} meId={me.id}
          onSendDm={(userId, body) => sendDmMessage(userId, body)}
          onDelegate={(spec) => delegateTask(openTask.id, spec)}
          clientPortalUrl={getClientShareUrl(openTask.clientId, { taskId: openTask.id })}
          clientLinks={openTaskClientLinks}
          clientMeetings={openTaskMeetings}
          meetingLink={inboxPrefs.meetingLink ?? null} onSaveMeetingLink={(link) => setInboxPrefs({ meetingLink: link })}
          taskLink={() => linkTo({ view: null, client: "all", project: null, task: openTask.id, clientTab: null, vaultFolder: null, dm: null, assignee: null, sub: null })} />
      )}

      {addClientOpen && <AddClientModal subAccounts={subAccounts} contacts={contacts} existingIds={new Set(clients.map((c) => c.id))} onAdd={addClientContact} onAddRemote={addRemoteContact} onOpenClient={(id) => { setAddClientOpen(false); openClientList(id); }} onClose={() => setAddClientOpen(false)} />}
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
      {promptDialog && <PromptModal {...promptDialog} onCancel={() => setPromptDialog(null)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {bulkDelegateOpen && (
        <BulkDelegateModal count={selectedTaskIds.size} users={users.filter((u) => u.id !== me.id)}
          onCancel={() => setBulkDelegateOpen(false)} onDelegate={bulkDelegate} onProblem={pushToast} />
      )}
      {mergeSourceId && (() => {
        const src = tasks.find((t) => t.id === mergeSourceId);
        if (!src) return null;
        const candidates = tasks
          .filter((t) => t.clientId === src.clientId && t.id !== src.id && t.priority !== "conversation" && t.status !== "done")
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((t) => ({ id: t.id, title: t.title, status: t.status }));
        return (
          <MergeTaskModal sourceTitle={src.title} candidates={candidates}
            onSubmit={(targetId) => { setMergeSourceId(null); requestMerge(mergeSourceId, targetId); }}
            onCancel={() => setMergeSourceId(null)} />
        );
      })()}
      {mergeClientState && (
        <MergeClientModal
          a={mergeClientState.a}
          initialB={mergeClientState.b}
          candidates={clients.filter((c) => c.id !== mergeClientState.a.id && c.id !== WORKSPACE_CLIENT_ID && c.id !== PERSONAL_CLIENT_ID).sort((x, y) => x.name.localeCompare(y.name))}
          contactFor={(c) => contactForClient(c.id)}
          taskCount={(id) => tasks.filter((t) => t.clientId === id).length}
          onSubmit={(sourceId, targetId, patch) => {
            setMergeClientState(null);
            const s = clientById(sourceId), t = clientById(targetId);
            setConfirmDialog({
              title: `Merge “${s?.name}” into “${t?.name}”?`,
              message: "Everything from both records will live on the one you're keeping, and the other client is removed. This can't be undone.",
              confirmLabel: "Merge", danger: true,
              onConfirm: () => { setConfirmDialog(null); mergeClients(sourceId, targetId, patch); },
            });
          }}
          onCancel={() => setMergeClientState(null)} />
      )}
      {settingsClient && (<>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setClientSettingsOpen(false)} />
          <div className="safe-y fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-[17px] font-semibold">Client settings — {settingsClient.name}</h2>
              <button onClick={() => setClientSettingsOpen(false)} className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"><I.close /></button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div>
                <div className="mb-2 text-[16px] font-semibold uppercase tracking-wide text-muted">Client portal</div>
                <div className="space-y-3">
                  <label className="flex items-start justify-between gap-3">
                    <span><span className="block text-[16px] font-medium">Client can add requests</span><span className="block text-[16px] text-muted">They can submit new task requests from their portal link, not just reply to what we send.</span></span>
                    <button onClick={() => toggleClientCanRequestNewTasks(activeClient)} className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition ${settingsClient.canRequestNewTasks ? "bg-accent" : "bg-border"}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition ${settingsClient.canRequestNewTasks ? "translate-x-4" : "translate-x-0.5"}`} /></button>
                  </label>
                  <label className="flex items-start justify-between gap-3">
                    <span><span className="block text-[16px] font-medium">Client sees all tasks</span><span className="block text-[16px] text-muted">Their portal also lists what the team is working on and what&apos;s been completed, not just what needs them. Every non-private task on this account becomes readable by the client.</span></span>
                    <button onClick={() => toggleClientPortalShowsAllTasks(activeClient)} className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition ${settingsClient.portalShowsAllTasks ? "bg-accent" : "bg-border"}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition ${settingsClient.portalShowsAllTasks ? "translate-x-4" : "translate-x-0.5"}`} /></button>
                  </label>
                </div>
                <button onClick={() => copyClientShareLink(activeClient)} className="mt-3 flex items-center gap-1.5 text-[16px] font-medium text-accent hover:underline"><I.link className="h-3.5 w-3.5" /> Copy portal link</button>
              </div>
              {/* The trial window is stamped once, when the deal closes, and
                  never re-stamped, so it cannot silently slide forward. That
                  left no way to CLOSE one either: a client who cancelled in
                  week one carried "in trial" until the date caught up. Ending
                  it keeps the date, so what was promised stays on the record. */}
              {(() => {
                const trial = trialState(settingsClient);
                if (trial.kind === "none") return null;
                return (
                  <div className="border-t pt-4">
                    <div className="mb-2 text-[16px] font-semibold uppercase tracking-wide text-muted">Trial</div>
                    {trial.kind === "running" ? (
                      <div className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block text-[16px] font-medium">Ends {formatDue(trial.endsAt)}</span>
                          <span className="block text-[16px] text-muted">
                            {trial.daysLeft === 0 ? "Last day." : `${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left.`}
                          </span>
                        </span>
                        {canAdmin && (
                          <button onClick={() => setConfirmDialog({
                            title: `End ${settingsClient.name}'s trial?`,
                            message: "They stop counting as in trial from now. The date it was due to end stays on the record, and nothing else about the account changes.",
                            confirmLabel: "End trial", danger: false,
                            onConfirm: () => { setConfirmDialog(null); endClientTrial(activeClient); },
                          })} className="shrink-0 rounded-md border px-2.5 py-1 text-[16px] font-medium hover:bg-background">End trial</button>
                        )}
                      </div>
                    ) : (
                      <div className="text-[16px] text-muted">
                        {trial.ended === "closed early" ? "Closed early" : "Ended"} · was due to end {formatDue(trial.endsAt)}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="border-t pt-4">
                <div className="mb-2 text-[16px] font-semibold uppercase tracking-wide text-muted">GoHighLevel</div>
                {settingsClient.linkedContactId ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[16px] text-accent"><span className="h-2 w-2 rounded-full bg-accent" /> Connected</span>
                    <span className="flex items-center gap-3">
                      {ghlContactUrlFor(activeClient) && <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" className="text-[16px] font-medium text-accent hover:underline">Open in GHL</a>}
                      {canAdmin && <button onClick={() => linkClientToContact(activeClient, null)} className="text-[16px] font-medium text-muted hover:text-danger">Unlink</button>}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[16px] text-muted"><span className="h-2 w-2 rounded-full bg-border" /> Not linked</span>
                    {canAdmin && <button onClick={() => { setClientSettingsOpen(false); setGhlLinkSearch(""); setGhlLinkOpen(true); }} className="text-[16px] font-medium text-accent hover:underline">Link to GoHighLevel</button>}
                  </div>
                )}
              </div>
              <div className="border-t pt-4">
                <div className="mb-2 text-[16px] font-semibold uppercase tracking-wide text-muted">Ownership</div>
                {/* There's no separate "owner" field in the data model — Following
                    (assignedTo) already IS what puts a client in someone's My Work
                    queue (see assignedClientsFor), so it does double duty as
                    ownership here rather than this sheet inventing a second field
                    the brief's open question proposed but the app doesn't need. */}
                <p className="mb-2 text-[16px] text-muted">Following decides whose My Work queue this client shows up in.</p>
                {canAdmin ? (
                  <div className="flex flex-col gap-0.5">
                    {users.map((u) => {
                      const on = (settingsClient.assignedTo ?? []).includes(u.id);
                      return (
                        <button key={u.id} onClick={() => toggleClientAssignment(activeClient, u.id)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on && <I.check />}</span>
                          <Avatar id={u.id} size={18} /> <span className="truncate text-[16px]">{u.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[16px] text-muted">{(settingsClient.assignedTo ?? []).length === 0 ? "Nobody yet" : (settingsClient.assignedTo ?? []).map((uid) => userById(uid)?.name).filter(Boolean).join(", ")}</div>
                )}
              </div>
              {canAdmin && (
                <div className="space-y-2 border-t pt-4">
                  <div className="mb-1 text-[16px] font-semibold uppercase tracking-wide text-muted">Danger zone</div>
                  {activeClient.startsWith("cl_") && (
                    <button onClick={() => { setClientSettingsOpen(false); setMergeClientState({ a: settingsClient }); }}
                      className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-[16px] hover:bg-background"><I.repeat /> Merge with another client…</button>
                  )}
                  {settingsClient.status !== "past_client" && (
                    <button onClick={() => { setClientSettingsOpen(false); setConfirmDialog({ title: `Archive ${settingsClient.name}?`, message: "Marks this client Past Client. Their tasks and history stay intact — this just takes them out of active views.", confirmLabel: "Archive", danger: true, onConfirm: () => { setConfirmDialog(null); setClientStatus(activeClient, "past_client"); } }); }}
                      className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-[16px] text-danger hover:bg-red-50"><I.close /> Archive client</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>)}
      {linkModal && activeClient !== "all" && (
        <LinkFormModal
          initial={linkModal.initial ? { label: linkModal.initial.label, url: linkModal.initial.url, groupLabel: linkModal.initial.groupLabel, color: linkModal.initial.color } : undefined}
          onSubmit={(v) => saveLink(activeClient, linkModal.initial, v)}
          onCancel={() => setLinkModal(null)}
        />
      )}
      {ghlLinkOpen && activeClient !== "all" && (<>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setGhlLinkOpen(false)} />
        <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[70vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-surface shadow-xl">
          <div className="border-b px-5 py-3">
            <h2 className="text-[16px] font-semibold">Link to GoHighLevel</h2>
            <p className="text-[13px] text-muted">Connect <b>{clientById(activeClient)?.name}</b> to a synced GoHighLevel contact so Open-in-GHL and task import work.</p>
          </div>
          <div className="border-b p-3">
            <input autoFocus value={ghlLinkSearch} onChange={(e) => setGhlLinkSearch(e.target.value)} placeholder="Search contacts by name or email…" className="w-full rounded-md border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {(() => {
              const q = ghlLinkSearch.trim().toLowerCase();
              const linkable = contacts.filter((ct) => ct.ghlContactId && clientById(ct.clientId)?.ghlLocationId);
              const matches = (q ? linkable.filter((ct) => ct.name.toLowerCase().includes(q) || ct.email.toLowerCase().includes(q)) : linkable).slice(0, 50);
              if (matches.length === 0) return <div className="px-4 py-8 text-center text-[13px] text-muted">{q ? "No matching GoHighLevel contacts." : "Type to search your synced contacts."}</div>;
              return matches.map((ct) => (
                <button key={ct.id} onClick={() => { linkClientToContact(activeClient, ct.id); setGhlLinkOpen(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-background">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{ct.name}</span>{ct.email && <span className="block truncate text-[13px] text-muted">{ct.email}</span>}</span>
                  <span className="shrink-0 text-[13px] text-muted">{clientById(ct.clientId)?.name}</span>
                </button>
              ));
            })()}
          </div>
        </div>
      </>)}
      {bookClient && contactForClient(bookClient)?.ghlContactId && (
        <BookAppointment target={{ kind: "book", ghlContactId: contactForClient(bookClient)!.ghlContactId, name: contactForClient(bookClient)!.name || clientById(bookClient)?.name || "Client" }}
          meId={me.id} onClose={() => setBookClient(null)} onDone={() => {}} pushToast={(m) => pushToast(m)}
          defaultCalendarId={inboxPrefs.defaultCalendarId ?? null} onSetDefault={(id) => setInboxPrefs({ defaultCalendarId: id })} />
      )}
      {meetNowClient && contactForClient(meetNowClient) && (() => {
        const ct = contactForClient(meetNowClient)!;
        const allowed = canMessageClient(meetNowClient);
        return (
          <MeetNowSheet clientId={meetNowClient} first={clientFirstName(ct, clientById(meetNowClient)?.name, "there")}
            email={ct.email || null} phone={ct.phone || null}
            savedLink={inboxPrefs.meetingLink ?? null} onSaveLink={(link) => setInboxPrefs({ meetingLink: link })}
            // Sent as the client page's own email and text are, on no task:
            // the task it is on was a Reply task a moment ago, and an answer
            // on a Reply task closes it.
            onSend={allowed ? (channel, subject, body) => sendMessage(meetNowClient, channel, subject, body) : null}
            onClose={() => setMeetNowClient(null)} pushToast={(m) => pushToast(m)} />
        );
      })()}
      {cmdkOpen && <CommandK tasks={scopedTasks} clients={workableClients} projects={projects} contacts={contacts} addedContactIds={addedContactIds} clientById={clientById}
        pinnedClients={[...starred].map((id) => clientById(id)).filter((c): c is Client => !!c && c.id.startsWith("cl_"))}
        pinnedLists={[...starredLists].map((id) => projectById(id)).filter((p): p is Project => !!p)}
        onGo={(view) => { goToView(view); setCmdkOpen(false); }}
        onOpenTask={(id) => { setOpenTaskId(id); setCmdkOpen(false); }}
        // Picking a client or list goes there the one way (openClientList), which
        // also closes an open task: search used to switch the client behind a
        // task still open on top (Derek, 2026-09-11).
        onOpenClient={(id) => { openClientList(id, null); setCmdkOpen(false); }}
        onOpenProject={(id) => {
          if (id === PERSONAL_PROJECT_ID) { setMyWork(false); setPersonalView(true); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setOpenTaskId(null); setCmdkOpen(false); return; }
          const p = projects.find((x) => x.id === id); if (p) openClientList(p.clientId, id); setCmdkOpen(false);
        }}
        onAddContact={(contact) => { addClientContact(contact); setCmdkOpen(false); }}
        onClose={() => setCmdkOpen(false)} />}

      {/* Persistent on purpose. Reloading is the only thing that reconciles the
          screen with the database, so this stays until someone does. */}
      {unsaved > 0 && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-danger px-4 py-2 text-[14px] font-medium text-white shadow-lg">
          <span>
            {unsaved} change{unsaved === 1 ? "" : "s"} did not save. What you are looking at is not what is stored.
          </span>
          <button onClick={() => window.location.reload()}
            className="rounded-md bg-white/20 px-2.5 py-1 text-[13px] font-semibold hover:bg-white/30">Reload</button>
        </div>
      )}
      <FeedbackTab openNonce={feedbackNonce} where={openTask ? `the task "${openTask.title}" (${openTask.id})` : settingsView ? "Settings" : inboxView ? "the Inbox" : myWork ? "My work" : "the task list"}
        onSend={async (body, images) => {
          // Straight to the database: the feedback task may not be in this
          // teammate's loaded tasks, so addComment (which needs it) won't do.
          // Screenshots ride along as the comment's pictures.
          const attachments = (await Promise.all(images.map((f) => uploadOneImage(`${FEEDBACK_TASK_ID}/feedback`, f)))).filter((a): a is Attachment => !!a);
          appendCommentDb(FEEDBACK_TASK_ID, { id: newId("cm_"), authorId: me.id, body, at: new Date().toISOString(), ...(attachments.length ? { attachments } : {}) });
          if (me.id !== "u_derek") notify("u_derek", `${me.name} sent feedback on ClickUpTasks`, FEEDBACK_TASK_ID, { kind: "message" });
          pushToast("Thanks, feedback sent");
        }} />
      {/* Above every window (reviews and emails are z-100, pictures z-110), so a
          message about what you just did there is never hidden behind it. */}
      {/* On a phone: one toast at a time, the newest, one wide line across the
          bottom with the page's 16px gutters, not a narrow tower in the middle
          (Derek, 2026-10-14: "very narrow, bulky, distracting"). */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-[120] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:items-center">
        {toasts.map((t) => (<div key={t.id} className="pointer-events-auto hidden items-center gap-3 rounded-[5px] bg-foreground px-3.5 py-2 text-[16px] font-medium leading-snug text-[color:var(--surface)] shadow-lg last:flex sm:flex"><span className="min-w-0 flex-1">{t.text}</span>{t.action && (<button onClick={() => { t.action!.run(); dismissToast(t.id); }} className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[16px] font-semibold underline underline-offset-4 hover:bg-[color:var(--surface)]/15">{t.action.label}</button>)}{t.secondaryAction && (<button onClick={() => { t.secondaryAction!.run(); dismissToast(t.id); }} className="shrink-0 rounded-[5px] bg-[color:var(--surface)] px-2 py-0.5 text-[16px] font-semibold text-foreground hover:opacity-90">{t.secondaryAction.label}</button>)}</div>))}
      </div>
    </div>
  );
}

