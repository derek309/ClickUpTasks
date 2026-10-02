"use client";

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
  addDaysIso,
  DUE_BUCKETS,
  dueBucketOf,
  TRIAL_DAYS, trialState,
  STATUS_META,
  STATUS_ORDER, HIDDEN_STATUSES, pickableStatuses,
  viewerDueDate, isOnPlateOf,
  isCompletionEvent, finishKindOf,
  CLIENT_STATUS_META,
  clientStatusMeta,
  type ClientStatus,
  HEALTH_META,
  clientHealth,
  PRIORITY_META,
  PRIORITY_ORDER,
  isManuallyAssignable,
  isMessageConversationTask,
  type Task,
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
} from "@/lib/data";
import { supabase, supabaseReady, authedFetch } from "@/lib/supabase";
import { upsertTask, seedIfEmpty, fetchAll, fetchOlderDoneTasks, fetchTaskById, type SyncMarks, fetchContacts, upsertClient, markNotifReadDb, signedUrlForFile, upsertClientNote, upsertVaultFolder, deleteVaultFolderDb, fetchDmReads, markDmReadDb, markMessagesReadDb, fetchAppSetting, upsertAppSetting } from "@/lib/db";
import { WRITE_SETTLE_MS, mergeFetched, tasksWrittenSince } from "@/lib/localTaskWrites";
import SettingsHub, { type TabKey } from "./SettingsHub";
import DmChat from "./DmChat";
import AddClientModal from "./AddClientModal";
import { afterFirstFrame, usePersisted } from "@/lib/usePersisted";
import { usePins } from "./cockpit/usePins";
import { useShareLinks } from "./cockpit/useShareLinks";
import { useNotify } from "./cockpit/useNotify";
import { useAiHelpers } from "./cockpit/useAiHelpers";
import { useComposer } from "./cockpit/useComposer";
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
import { ClientEmail, type ClientEmailStart } from "./cockpit/ClientEmail";
import { draftLinkHtml, escapeHtml } from "@/lib/draftLink";
import { ConfirmModal, PromptModal, ShortcutsModal, LinkFormModal, MergeTaskModal, MergeClientModal, type ConfirmSpec, type PromptSpec } from "./cockpit/modals";
import { CommandK } from "./cockpit/CommandK";
import { GroupedList } from "./cockpit/GroupedList";
import StageBoard from "./cockpit/StageBoard";
import { TaskDrawer } from "./cockpit/TaskDrawer";
import { QuickLinksBar } from "./cockpit/ClientLinks";
import { ClientJournal } from "./cockpit/ClientJournal";
import { ClientsBoard, type WorkBoardGroup, type WorkItem } from "./cockpit/ClientsBoard";
import { ClientsDirectory } from "./cockpit/ClientsDirectory";
import { FinishedFeed, type CompletionRow } from "./cockpit/FinishedFeed";
import { ReviewsBoard } from "./cockpit/ReviewsBoard";
import { DraftsBoard } from "./cockpit/DraftsBoard";
import { BulkDelegateModal } from "./cockpit/BulkDelegateModal";
import { ProjectsDirectory } from "./cockpit/ProjectsDirectory";
import { FolderRail } from "./cockpit/FolderRail";
import InboxView from "./cockpit/inbox/InboxView";
import { useInbox } from "./cockpit/inbox/useInbox";
import { useInboxPrefs } from "./cockpit/inbox/inboxPrefs";
import type { InboxThread } from "./cockpit/inbox/inboxModel";
import { inboxKind, latestCommentBy } from "@/lib/extensionInbox";


import { sortTasks as sortTasksBy } from "@/lib/taskSort";
import { URGENCY_TIER, tierForDate, urgencyDateOf, urgencyKeyFrom } from "@/lib/urgency";
import { type NavState, buildSearch, parseSearch, NAV_KEY_VIEWS } from "@/lib/navState";


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

export default function Cockpit({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
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
  // My Work always shows your own work now — the "Viewing work for
  // [teammate]" selector was removed (Derek). Kept as a named constant
  // rather than inlining me.id everywhere it's read below.
  const myWorkUser = me.id;
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
  const [dirView, setDirView] = useState<"clients" | "projects" | "inbox" | null>(null);
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
  const [dashboardView, setDashboardView] = usePersisted<"work" | "reviews" | "drafts">("dashboardView", "work", (v) => ["work", "reviews", "drafts"].includes(v as string));
  // The Reviews and Drafts boards and the Finished marker (cockpit/useBoards).
  const {
    openReviews, reviewsLoading, videoStorage, loadOpenReviews,
    pendingSends, draftsLoading, loadPendingSends,
    finishedMarkerAt, openFinished, newFinishedCount,
  } = useBoards({ tasks, tasksRef, showingBoard: myWork ? dashboardView : null, meId: me.id });
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
  const [filters, setFilters] = useState<FilterState>({ status: "all", assignee: "all", priority: "all" });
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
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = usePersisted("hideEmpty", true, (v) => typeof v === "boolean");
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
  useEffect(() => { if (!dmEnabled && dmUserId !== null) setDmUserId(null); }, [dmEnabled, dmUserId]);
  // Declared up here rather than down with the other layout state because
  // goToView (just below) closes over it — every navigation also dismisses
  // the mobile sidebar.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Every top-level destination resets the same pile of view flags. One
  // helper for all of them so the sidebar click and the keyboard shortcut
  // set identical state by construction rather than by two hand-maintained
  // copies that quietly drift — and so adding a view later is one edit, not
  // five. NAV_KEY_VIEWS maps the number keys onto these.
  const goToView = (view: "dashboard" | "alltasks" | "clients" | "projects" | "personal" | "inbox") => {
    setMyWork(view === "dashboard");
    setPersonalView(view === "personal");
    setInboxView(false);
    setDirView(view === "clients" ? "clients" : view === "projects" ? "projects" : view === "inbox" ? "inbox" : null);
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
  const [composeIntent, setComposeIntent] = useState<{ mode: "email" | "sms"; nonce: number } | null>(null);
  const openCompose = (mode: "email" | "sms") => { setClientTab("chat"); setComposeIntent((c) => ({ mode, nonce: (c?.nonce ?? 0) + 1 })); };
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
  const [copiedForClaude, setCopiedForClaude] = useState(false);
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
  const markOwnClientWrite = (id: string) => clientWriteLedgerRef.current.set(id, Date.now());
  const isOwnClientEcho = (id: string) => {
    const ts = clientWriteLedgerRef.current.get(id);
    if (ts === undefined) return false;
    clientWriteLedgerRef.current.delete(id);
    return Date.now() - ts < CLIENT_ECHO_TTL_MS;
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
  const openClientEmail = (clientId: string, start: Omit<ClientEmailStart, "clientId" | "nonce"> = {}) =>
    setClientEmail((c) => ({ ...start, clientId, nonce: (c?.nonce ?? 0) + 1 }));
  // "We're still waiting on these" nudge, raised from the Review controls: the
  // reminder is written for them and opens for review before it goes. The portal
  // link is resolved on the click, not during render: getClientShareUrl mints and
  // persists a share token the first time it's called for a client.
  const openRemindClient = (clientId: string) => {
    const name = clientById(clientId)?.name ?? "";
    const firstName = name.trim().split(/\s+/)[0] || "there";
    const waiting = waitingTasksFor(clientId);
    const url = getClientShareUrl(clientId);
    if (!url) pushToast("No portal link could be made for this client, so the reminder has no link. An admin needs to create the share link first.");
    const link = url ? { url, label: "Reply or upload everything here" } : null;
    openClientEmail(clientId, {
      subject: `Quick check on a few things for ${name || "you"}`,
      body: `<p>Hi ${escapeHtml(firstName)},</p><p>We are still waiting on a few things from you before we can move forward:</p>`
        + `<ul>${waiting.map((t) => `<li><p>${escapeHtml(t.title)}</p></li>`).join("")}</ul>${draftLinkHtml(link)}<p>Thanks!</p>`,
      link,
      aiContext: `A friendly reminder that we are still waiting on these items from the client before we can move forward:\n${waiting.map((t) => `• ${t.title}`).join("\n")}`,
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

  const toggleHideEmpty = () => setHideEmpty(!hideEmpty);
  const toggleHideDone = () => setHideDone(!hideDone);
  const [drawerFull, setDrawerFull] = useState(false);
  useEffect(() => afterFirstFrame(() => setDrawerFull(localStorage.getItem("cut_drawerFull") === "1")), []);
  // Drop the project filter whenever we leave its client (or enter My Work).
  useEffect(() => { setActiveProject((p) => (p && projects.find((x) => x.id === p)?.clientId === activeClient && !myWork && !personalView && !inboxView && !settingsView ? p : null)); }, [activeClient, myWork, personalView, inboxView, settingsView, projects]);
  // Clear the folder-rail scope whenever the client/view changes.
  useEffect(() => { setActiveFolder(null); }, [activeClient, myWork, personalView, inboxView, dirView]);
  // A bulk selection is scoped to whatever list is on screen — switching
  // clients/views leaves the selected ids referring to now-invisible tasks,
  // which would make the floating bulk-action bar silently apply to rows
  // the user can no longer see. Clear it on any navigation.
  useEffect(() => { setSelectedTaskIds(new Set()); }, [activeClient, activeProject, myWork, personalView, inboxView]);
  // Links/Notes/health are single-client concepts — always land back on Tasks when the active client changes.
  useEffect(() => { setClientTab("tasks"); }, [activeClient, myWork]);

  // --- Deep-link URL sync ---------------------------------------------------
  const currentNav = (): NavState => ({
    view: settingsView ? "settings" : dirView === "inbox" ? "mail" : dirView ?? (myWork ? "work" : personalView ? "personal" : inboxView ? "inbox" : null),
    client: activeClient, project: activeProject, task: openTaskId,
    clientTab, vaultFolder: null, // read from an old folder link on load, never written as you browse
    dm: inboxView ? dmUserId : null,
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
    setDirView(s.view === "clients" || s.view === "projects" ? s.view : s.view === "mail" ? "inbox" : null);
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
    if (next !== window.location.search) window.history.pushState(null, "", next || window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsView, dirView, myWork, personalView, inboxView, activeClient, activeProject, openTaskId, clientTab, dmUserId, allTasksScope, dashboardView, allTasksCompleted]);
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
        await seedIfEmpty();
        // Load the real team roster (every signed-up profile) before rendering
        // data, so assignees/avatars resolve to real people — not demo seeds.
        try {
          const { data: profs } = await supabase.from("profiles").select("id, name, email, role, member_id, color");
          if (profs?.length) {
            const seen = new Set<string>();
            setUsers(profs.flatMap((p) => {
              const id = p.member_id || p.id;
              if (seen.has(id)) return [];
              seen.add(id);
              const name = p.name || p.email || "Teammate";
              return [{ id, name, initials: initialsOf(name), color: p.color || "#a855f7", role: p.role === "admin" ? "admin" as const : "va" as const }];
            }));
          }
          // Avatar photos are a newer, optional column — fetched in a second,
          // independently-failing pass so a deploy that lands before
          // supabase/avatars.sql has run (no avatar_url column yet) can't
          // take the whole roster fetch above down with it; PostgREST 400s
          // the entire query for an unknown column, not just that field.
          try {
            const { data: withAvatars } = await supabase.from("profiles").select("id, member_id, avatar_url");
            if (withAvatars?.length) {
              setUsers(users.map((u) => {
                const row = withAvatars.find((p) => (p.member_id || p.id) === u.id);
                return row?.avatar_url ? { ...u, avatarUrl: row.avatar_url } : u;
              }));
            }
          } catch { /* avatar enrichment is best-effort */ }
        } catch { /* roster fetch is best-effort; founder fallback stays */ }
        const d = await fetchAll();
        syncMarks.current = d.marks;
        // Merged, not replaced: a task or conversation fetched on its own while
        // this was in flight (an old task opened from a link) stays.
        setClients(d.clients); setProjects(d.projects); setContacts(d.contacts); setTasks((prev) => mergeFetched(prev, d.tasks)); setNotifications(d.notifications);
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
  }, []);

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
  const pushToast = (text: string, action?: { label: string; run: () => void }, secondaryAction?: { label: string; run: () => void }) => {
    const id = newId("toast_");
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
    setClientLinks, setVaultFolders, setFolders, setStages, setDmMessages, setActiveClient, setOpenTaskId,
  });

  const { hasUnreadReply, markTaskNotifsRead, notify, sendMentionEmail } = useNotify({ tasksRef, me, setNotifications, notifications });
  const passesFilters = (t: Task) =>
    (filters.status === "all" || effectiveStatus(t) === filters.status) &&
    (filters.assignee === "all" || (filters.assignee === "waiting" ? !!t.waitingOnClient : filters.assignee === "unassigned" ? t.assigneeId === null : t.assigneeId === filters.assignee)) &&
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
    () => tasks.filter((t) => isOnPlateOf(t, me.id) && t.status !== "done").length,
    [tasks, me.id],
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
    return [
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
  }, [workableClients, clients, projects]);
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
    const taskKeys = tasks.filter((t) => t.assigneeId === myWorkUser && t.private && t.status !== "done")
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
  }, [tasks, scopedTasks, clients, projects, myWorkUser]);
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
  const contactForClient = (clientId: string): Contact | null => {
    const c = clientById(clientId);
    if (c?.linkedContactId) return contactById(c.linkedContactId);
    return clientId.startsWith("cl_") ? contactById(clientId.slice(3)) : null;
  };
  const ghlContactUrlFor = (clientId: string) => {
    const ct = contactForClient(clientId);
    if (!ct) return null;
    const sub = clientById(ct.clientId);
    return sub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${sub.ghlLocationId}/contacts/detail/${ct.ghlContactId}` : null;
  };

  // Sorted by position so folder-grouped list headings match the folder rail's
  // drag order (B5). Falls back to insertion order for equal/absent positions.
  const visibleProjects = useMemo(() => projects.filter((p) => p.clientId.startsWith("cl_") && (activeClient === "all" || p.clientId === activeClient) && (!activeFolder || p.folderId === activeFolder)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [projects, activeClient, activeFolder]);
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
    () => scopedTasks.filter((t) => t.clientId !== PERSONAL_CLIENT_ID && (activeClient === "all" || t.clientId === activeClient) && (!activeProject || t.projectId === activeProject) && (!activeFolder || projectById(t.projectId)?.folderId === activeFolder) && (activeClient !== "all" || allTasksScope === "all" || isOnPlateOf(t, allTasksScope === "mine" ? me.id : allTasksScope))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedTasks, activeClient, activeProject, activeFolder, projects, allTasksScope, me.id]
  );

  // Client/project-wide equivalent of TaskDrawer's per-task copyForClaude —
  // same clipboard hand-off pattern, just widened from one task to every
  // open task under the currently open client/project.
  const copyClientForClaude = async () => {
    const client = clientById(activeClient);
    if (!client) return;
    const project = activeProject ? projectById(activeProject) : null;
    const contact = contactForClient(activeClient);
    const openTasks = sortTasks(baseTasks.filter((t) => t.status !== "done"));
    const shown = openTasks.slice(0, 30);
    const notes = clientNotes
      .filter((n) => (activeProject ? n.projectId === activeProject : n.clientId === activeClient && !n.projectId))
      .slice(0, 5);
    const ghlUrl = ghlContactUrlFor(activeClient);
    const brief = [
      `Work on this client/project from ClickUpTasks (https://clickuptasks.vercel.app):`,
      ``,
      `Client: ${client.name}${contact?.email ? ` (${contact.email})` : ""}`,
      `Project: ${project ? project.name : "All projects"}`,
      ``,
      `Open tasks (${openTasks.length}):`,
      ...shown.map((t) => `- ${t.title} — ${STATUS_META[t.status].label} · ${PRIORITY_META[t.priority].label}${t.due ? ` · Due: ${t.due}` : ""}`),
      openTasks.length > shown.length ? `...and ${openTasks.length - shown.length} more (showing top ${shown.length} by priority/due)` : "",
      notes.length ? `\nRecent chat notes:\n${notes.map((n) => `- ${userById(n.authorId)?.name ?? "?"}: ${n.body}`).join("\n")}` : "",
      ghlUrl ? `\nGHL contact: ${ghlUrl}` : "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(brief);
      setCopiedForClaude(true);
      setTimeout(() => setCopiedForClaude(false), 1800);
      pushToast("Copied client brief for Claude.");
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
  const myClientTaskCount = (clientId: string) => (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done" && (!t.assigneeId || t.assigneeId === myWorkUser)).length;
  const myProjectTaskCount = (projectId: string) => (scopedTasksByProjectId.get(projectId) ?? []).filter((t) => t.status !== "done" && (!t.assigneeId || t.assigneeId === myWorkUser)).length;
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
    () => sortTasks(tasks.filter((t) => t.assigneeId === me.id && t.private)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, me.id, sortBy, sortDir, notifications]
  );

  // Memoized — a linear scan of the full tasks table every render, even
  // when no task is open.
  const openTask = useMemo(() => tasks.find((t) => t.id === openTaskId) ?? null, [tasks, openTaskId]);
  // The drawer's own slices, kept as the same arrays until they really change:
  // filtering inline handed it new ones on every render anywhere in the app.
  const openTaskClientId = openTask?.clientId ?? null;
  const openTaskMessages = useMemo(() => (openTaskId ? messages.filter((m) => m.taskId === openTaskId) : []), [messages, openTaskId]);
  const openTaskClientLinks = useMemo(() => (openTaskClientId ? clientLinks.filter((l) => l.clientId === openTaskClientId) : []), [clientLinks, openTaskClientId]);
  // Sending, editing and scheduling client messages, the GoHighLevel refresh,
  // and a conversation's older messages loading when it opens (cockpit/useMessaging).
  const conversationContact = (activeClient !== "all" && clientTab === "chat" && !activeProject ? activeClient : null) ?? clientEmail?.clientId ?? null;
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
  const inbox = useInbox({ meMemberId: me.id, isAdmin: me.role === "admin", liveMessages: messages, extraMessages: inboxExtra, tasks, nameOf: inboxNameOf, gmailSync: inboxGmailSync, allows: inboxPrefs.allowSenders, pushToast });
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
  const newTaskFromThread = async (t: InboxThread): Promise<string | null> => {
    const first = t.peerName.split(/\s+/)[0];
    const project = t.clientId ? projectsForClient(t.clientId)[0] : null;
    const clientId = project ? t.clientId! : PERSONAL_PROJECT_ID;
    const task: Task = {
      id: newId("t_"), projectId: project?.id ?? PERSONAL_PROJECT_ID, clientId: project ? clientId : PERSONAL_PROJECT_ID,
      title: t.subject ? t.subject.replace(/^(re|fwd?):\s*/i, "") : `Follow up with ${first}`, description: "",
      status: "todo", priority: "normal", assigneeId: me.id, contactId: t.contactId, due: TODAY,
      recurrence: "none", labelIds: [], ghlTaskId: null, priorityAuto: true, private: !project, subtasks: [], attachments: [], comments: [],
      createdAt: new Date().toISOString(), createdBy: me.id,
    };
    setTasks((ts) => [...ts, task]);
    upsertTask(task, me.id);
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
  const buildGroups = (list: Task[], dim: typeof groupBy = groupBy): Grp[] => {
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
    return visibleProjects.map((p) => ({ key: p.id, label: p.name, color: clientById(p.clientId)?.color ?? "#94a3b8", tasks: list.filter((t) => t.projectId === p.id) }));
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
    if (groupBy === "status") patchTask(taskId, { status: groupKey as TaskStatus });
    else if (groupBy === "priority") {
      if (!isManuallyAssignable(groupKey as Priority)) { pushToast("Interaction is assigned automatically, not manually."); return; }
      patchTask(taskId, { priority: groupKey as Priority });
    }
  };

  // finishHandoffInstead (below) ticks the handoff with toggleSub, which
  // useChecklist builds from this block's update, so it is reached through a
  // ref set once useChecklist has run.
  const toggleSubRef = useRef<(taskId: string, subId: string) => void>(() => {});
  const toggleSubLate = (taskId: string, subId: string) => toggleSubRef.current(taskId, subId);
  const { patchTask, update, clearSelection, finishHandoffInstead, toggleTaskSelection, bulkPatch, bulkDelete, deleteTask, addComment, duplicateTask, deleteComment } = useTaskEdits({ tasksRef, pushToast, keepDoneVisible, setTasks, me, toggleSubLate, notify, setSelectedTaskIds, selectedTaskIds, setConfirmDialog, openTaskId, setOpenTaskId, projectById, tasks, sendMentionEmail });
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
  const { toggleSub, addSub, deleteSub, renameSub, patchSub, toggleLabel, delegateTask, bulkDelegate } = useChecklist({ tasks, update, me, setTasks, notify, setConfirmDialog, pushToast, tasksRef, selectedTaskIds, setBulkDelegateOpen, clearSelection });
  useEffect(() => { toggleSubRef.current = toggleSub; });
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
  const { createStage, addProject, renameProject, deleteProject, railHidden, createFolder, renameFolder, deleteFolder, moveListToFolder, reorderFolders, reorderLists, setTaskStage, quickAddInStage, renameStage, toggleStageIsDone, deleteStage, reorderStages, requestMerge, bulkMoveTo, moveTaskToClient, moveTaskToNewProject } = useLists({ setPromptDialog, projects, setProjects, folders, setFolders, folderById, setConfirmDialog, projectById, stages, setStages, setTasks, tasks, finishHandoffInstead, update, activeClient, foldersForClient, projectsForClient, canAdmin, me, patchTask, pushToast, tasksRef, clientById, selectedTaskIds, clearSelection, setMessages, setOpenTaskId, setClientNotes });
  const { addNote, deleteLink, reorderLinks, sendDmMessage, deleteDmMessage, pinDmMessage, editNote, deleteNote, saveLink } = useClientRecords({ setClientLinks, clientLinks, setLinkModal, setConfirmDialog, me, dmMessages, setDmMessages, notify, setClientNotes, projectById, clientById });
  const { createTasksFromDump } = useComposer({ dumpGroup, activeClient, groupBy, me, setTasks, pinJustAdded, setDumpGroup, pushToast, activeProject, projects, setProjects, notify, addFiles });
  const { draftMessage, draftingMessage, refreshContact, refreshingContact, regenerateAiSummary, draftDescription, draftingDescription } = useAiHelpers({ setAiSummaryBusyId, setClients, addNote, pushToast, openTask, setContacts });
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
  const headerTitleText = settingsView ? "Settings" : inboxView ? (userById(dmUserId)?.name ?? "Direct Message") : dirView === "inbox" ? "Inbox" : dirView === "clients" ? "All clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "Clients" : activeClient === "all" ? "Tasks" : (activeProject && projectById(activeProject) ? projectById(activeProject)!.name : (clientById(activeClient)?.name ?? ""));
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
      <button onClick={() => setFollowingOpen((o) => !o)} title="Following" className="flex items-center -space-x-1.5 rounded-md border bg-background px-1.5 py-1 hover:bg-accent-soft">
        {(clientById(activeClient)!.assignedTo ?? []).length === 0
          ? <I.user className="text-muted" />
          : (clientById(activeClient)!.assignedTo ?? []).slice(0, 3).map((uid) => (<Avatar key={uid} id={uid} size={20} />))}
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

  const groupSortControl = (
    <div className="relative">
      <button onClick={() => setGroupSortOpen((o) => !o)} title="Group & sort" className={barButton}>
        <I.list className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Grouped by <b className="font-semibold text-foreground">{GROUP_LABEL[groupBy]}</b> <span className="opacity-50">·</span> sorted by <b className="font-semibold text-foreground">{SORT_LABEL[sortBy] ?? sortBy}</b></span>
      </button>
      {groupSortOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setGroupSortOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] space-y-2.5 rounded-xl border bg-surface p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Group &amp; sort</span>
            {(sortBy !== "due" || groupBy !== "priority") && <button onClick={() => { setGroupBy("priority"); setSortBy("due"); }} className="text-[13px] font-medium text-accent">Reset</button>}
          </div>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Group by</span><select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="status">Status</option><option value="priority">Priority</option><option value="due">Due date</option><option value="project">Project</option></select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Sort</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="manual">Manual</option><option value="due">Days left (due date)</option><option value="created">Created (oldest first)</option><option value="priority">Priority</option><option value="title">Task name</option><option value="status">Status</option><option value="assignee">Assignee</option></select></label>
          <button onClick={toggleHideEmpty} className="flex w-full items-center gap-2 rounded px-0 py-1 text-left hover:bg-background">
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${hideEmpty ? "border-accent bg-accent text-white" : "border-border"}`}>{hideEmpty && <I.check />}</span>
            <span className="text-muted">Hide empty groups</span>
          </button>
          <button onClick={toggleHideDone} className="flex w-full items-center gap-2 rounded px-0 py-1 text-left hover:bg-background">
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${hideDone ? "border-accent bg-accent text-white" : "border-border"}`}>{hideDone && <I.check />}</span>
            <span className="text-muted">Hide done tasks</span>
          </button>
          {activeProject && canAdmin && stagesForProject(activeProject).length === 0 && (
            <button onClick={() => createStage(activeProject)} className="flex w-full items-center gap-2 rounded border-t px-0 pt-2 text-left text-[13px] font-medium text-accent hover:bg-background">
              <I.plus /> Set up custom Kanban stages for this list
            </button>
          )}
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
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Filter</span>
            {filtersActive && <button onClick={() => setFilters({ status: "all", assignee: "all", priority: "all" })} className="text-[13px] font-medium text-accent">Clear</button>}
          </div>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Status</span><select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as FilterState["status"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Assignee</span><select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Priority</span><select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as FilterState["priority"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{PRIORITY_ORDER.filter((p) => p !== "none").map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></label>
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
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Columns</div>
          <div className="flex flex-col gap-0.5">
            {LIST_COLUMNS.map((c) => (
              <button key={c.key} onClick={() => toggleCol(c.key)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${visibleCols.includes(c.key) ? "border-accent bg-accent text-white" : "border-border"}`}>{visibleCols.includes(c.key) && <I.check />}</span>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
  // Names each active filter as a dismissible chip above the list instead of
  // an unexplained "3 of 18" count in the header — clicking a chip's × clears
  // just that filter, Clear resets all three at once.
  const activeFilterBar = filtersActive ? (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 px-4 sm:px-0">
      {filters.status !== "all" && (
        <span className="inline-flex items-center gap-1 rounded-[5px] border bg-background px-2 py-0.5 text-[13px]">Status: {STATUS_META[filters.status].label}
          <button onClick={() => setFilters((f) => ({ ...f, status: "all" }))} className="text-muted hover:text-foreground"><I.close className="h-3 w-3" /></button></span>
      )}
      {filters.assignee !== "all" && (
        <span className="inline-flex items-center gap-1 rounded-[5px] border bg-background px-2 py-0.5 text-[13px]">Assignee: {filters.assignee === "unassigned" ? "Unassigned" : filters.assignee === "waiting" ? "Waiting on client" : userById(filters.assignee)?.name ?? filters.assignee}
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
  const bulkAddControl = (
    <button onClick={() => setDumpGroup({ key: null, personal: false })} title="Dump your notes and let AI create the tasks"
      className="rounded-md border bg-background px-2 py-1.5 text-[13px] leading-none text-muted hover:text-foreground">
      <span aria-hidden>📋</span>
    </button>
  );
  const copyForClaudeControl = (
    <button onClick={copyClientForClaude} title="Copy this list as a brief for Claude"
      className="rounded-md border bg-background px-2 py-1.5 text-[13px] leading-none text-muted hover:text-foreground">
      <span aria-hidden>{copiedForClaude ? "✓" : "✳"}</span>
    </button>
  );
  const overflowControl = (
    <div className="relative">
      <button onClick={() => setHeaderMoreOpen((o) => !o)} title="More actions"
        className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground"><I.dots /></button>
      {headerMoreOpen && (<>
        <div className="fixed inset-0 z-40" onClick={() => setHeaderMoreOpen(false)} />
        <div className="absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-surface p-1 shadow-soft-md">
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
          {activeClient !== "all" && !activeProject && clientById(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); copyClientShareLink(activeClient); }} title="A public, no-login link showing this client what we're waiting on them for"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.link /> Copy client link</button>
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
          <button onClick={() => { setHeaderMoreOpen(false); copyClientForClaude(); }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background sm:hidden"><span aria-hidden>✳</span> Copy for Claude</button>
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
    <div className="flex h-screen w-full overflow-hidden text-[15px]" style={{ "--drawer-left": sidebarHidden ? "0px" : "16rem" } as React.CSSProperties}>
      {/* mobile backdrop */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ---------- Sidebar ---------- */}
      {/* Back to a fixed width, and the drawer's left edge back to a
          constant, after the content-sized version crashed the tab on
          Windows. A w-max column that scrolls is a feedback loop wherever
          scrollbars take layout width: the scrollbar appears, max-content
          shrinks, the scrollbar goes, it grows, and the ResizeObserver
          feeding the width into state re-rendered on every step until the
          renderer died. macOS overlay scrollbars take no width, which is why
          it only ever happened to Michaella. */}
      <aside className={`sidebar-dark fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r bg-surface transition-transform ${sidebarHidden ? "md:hidden" : "md:static md:translate-x-0"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Account block, promoted from the sidebar footer to the top in place
            of the old app-branding header (Derek's call). */}
        {/* Account block. Borderless icon buttons, not bordered boxes, which
            crowded the name down to "De…". Theme and sign out have since moved
            into Settings > Account (Derek), leaving the gear as the only icon
            here: two things nobody touches twice a week were costing width on
            every screen. */}
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-3">
          <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ width: 30, height: 30, background: me.color }}>{me.initials}</span>
          <div className="ml-1 min-w-0 flex-1 leading-tight"><div className="truncate text-[15px] font-medium">{me.name}</div><div className="text-[13px] capitalize text-muted">{me.role}</div></div>
          <button onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setDirView(null); setSidebarOpen(false); setOpenTaskId(null); setSettingsView(true); }} title="Settings" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground"><I.gear /></button>
        </div>

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
          <SideItem active={dirView === "inbox"} title="Your email, texts and task chats (press 6)" onClick={() => goToView("inbox")}><span className="text-muted">📥</span> <span>Inbox</span>{inboxPrefs.badge && inboxUnread > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white">{inboxUnread}</span>}</SideItem>
          <SideItem active={myWork} title="Clients (press 1)" onClick={() => goToView("dashboard")}><I.user className="text-muted" /> <span>Clients</span><span className="ml-auto text-[13px] text-muted">{myAssignedClients.length + myAssignedProjects.length}</span></SideItem>
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
          <SideItem active={allTasksView} title={`${openTaskCount} open task${openTaskCount === 1 ? "" : "s"} assigned to you (press 2)`} onClick={() => goToView("alltasks")}><I.list className="text-muted" /> <span>Tasks</span><span className="ml-auto text-[13px] text-muted">{openTaskCount}</span></SideItem>
          {/* "Client replies" nav item removed (Derek, 2026-08-09) — My Work
              and Follow Up already surface an open conversation-priority
              task each their own way (hasOpenConversationTask / Follow Up's
              own task-driven tiers); a third place to check the same signal
              was redundant, not additional coverage. */}
          {clients.some((c) => c.id === WORKSPACE_CLIENT_ID) && (
            <SideItem active={dirView === "projects"} title="Projects (press 4)" onClick={() => goToView("projects")}><I.folder className="text-muted" /> <span>Projects</span><span className="ml-auto text-[13px] text-muted">{workspaceProjects.length}</span></SideItem>
          )}
          <SideItem active={personalView} title="Personal (press 5)" onClick={() => goToView("personal")}><I.check className="text-muted" /> <span>Personal</span><span className="ml-auto text-[13px] text-muted">{myPersonalTasks.filter((t) => t.status !== "done").length}</span></SideItem>
          {/* Teammate chats sit under Personal rather than between the work
              views (Derek, 2026-09-28): they are people, not places work
              lives, and they were splitting My Work and All Tasks off from
              Clients and Projects. */}
          {/* Teammate chats moved into the Inbox's Team chats (Derek, 2026-10-02). */}
        </nav>

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
              <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Pinned</div>
              {pinnedClients.map((c) => {
                const active = !myWork && !personalView && !inboxView && !settingsView && !dirView && !activeProject && activeClient === c.id;
                return (
                  <SideItem key={c.id} active={active} drag={pinDrag("client", c.id)} title="Drag to reorder" onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(c.id); setActiveProject(null); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientStatusMeta(c.status).dot }} /> <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                    <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggleStar(c.id); }} title="Unpin from sidebar" className="shrink-0 rounded p-0.5 text-amber-400 hover:bg-background"><I.star filled /></span>
                  </SideItem>
                );
              })}
              {pinned.map((p) => {
                const active = !myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject === p.id;
                // A list name alone ("Website") doesn't say whose — several
                // clients can have a same-named list. Show the owning
                // client small above it, same idea as ProjectsDirectory's
                // subtitle for the same ambiguity.
                const clientName = clientById(p.clientId)?.name;
                return (
                  <SideItem key={p.id} active={active} drag={pinDrag("list", p.id)} title="Drag to reorder" onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(p.clientId); setActiveProject(p.id); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
                    <I.list className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 text-left">
                      {clientName && <span className="block truncate text-[11px] leading-tight text-muted">{clientName}</span>}
                      <span className="block truncate leading-tight">{p.name}</span>
                    </span>
                    <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggleStarList(p.id); }} title="Unpin from sidebar" className="shrink-0 rounded p-0.5 text-amber-400 hover:bg-background"><I.star filled /></span>
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
        <header className="relative z-10 flex shrink-0 flex-col gap-2 overflow-x-hidden border-b bg-surface px-3 py-2 shadow-soft sm:hidden">
          <div className="flex items-center gap-2">
            <button onClick={toggleSidebar} aria-label="Menu" className="shrink-0 rounded-lg border p-2 text-muted"><I.menu /></button>
            <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{headerTitleText}</h1>
            {/* Icon only here — the phone header has a title and two controls
                already, and a labelled button would push one of them off. */}
            {!inboxView && !settingsView && !dirView && (
              <button onClick={openComposer} aria-label="New task" title="New task"
                className="shrink-0 rounded-lg bg-accent p-2 text-white"><I.plus /></button>
            )}
            {isClientDetail && overflowControl}
          </div>
          {isClientDetail ? (
            <div className="flex items-center gap-2">
              {/* No Tasks/Journal segmented control: Journal has one home now,
                  the ⋮ menu, which this header already carries. */}
              <div className="flex-1" />
              {clientTab === "tasks" && (
                <div className="flex items-center gap-1.5">
                  {followingControl}
                  {groupSortControl}
                  {filterMenuControl}
                  {columnsControl}
                </div>
              )}
            </div>
          ) : myWork ? (
            <div className="flex flex-col gap-2">
              <div className="flex rounded-lg bg-background p-0.5">
                <button onClick={() => setDashboardView("work")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${dashboardView === "work" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Work</button>
                <button onClick={() => setDashboardView("reviews")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${dashboardView === "reviews" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Reviews</button>
                <button onClick={() => setDashboardView("drafts")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${dashboardView === "drafts" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Drafts</button>
              </div>
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
            // Two rows by construction rather than by wrapping: who the list is
            // for on its own line, the icons on theirs. Seven controls sharing
            // one line ran off a 375px screen (Derek, 2026-09-22, twice).
            <div className="flex flex-col gap-2">
              {activeClient === "all" && !myWork && canAdmin && (
                <div className="flex min-w-0 items-center gap-2">
                  {scopeControls}
                  <button onClick={() => copyLink(currentNav())} title="Copy a link to this exact Tasks view — same assignee, opens for anyone signed in"
                    className="shrink-0 rounded-md border bg-background p-1.5 text-muted hover:bg-background hover:text-foreground"><I.link /></button>
                </div>
              )}
              <div className="flex items-center justify-end gap-1.5">
                {followingControl}
                {groupSortControl}
                {filterMenuControl}
                {columnsControl}
              </div>
            </div>
          ) : null}
        </header>

        <header className="relative z-10 hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-surface px-4 py-2 shadow-soft sm:flex sm:gap-y-2 sm:px-5 sm:py-3">
          <button onClick={toggleSidebar} title="Show/hide sidebar" className="rounded-lg border p-2 text-muted hover:text-foreground"><I.menu /></button>
          <div className="min-w-0">
            {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject && projectById(activeProject) ? (<>
              <h1 className="flex items-center gap-1.5 truncate text-[20px] font-semibold"><I.folder className="shrink-0 text-muted" /> {projectById(activeProject)!.name}</h1>
              <p className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
                <button onClick={() => goToView("dashboard")} className="hover:text-foreground hover:underline">Clients</button>
                <span>›</span>
                <button onClick={() => { setDirView("clients"); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setOpenTaskId(null); }} className="hover:text-foreground hover:underline">Clients</button>
                <span>›</span>
                <button onClick={() => setActiveProject(null)} className="hover:text-foreground hover:underline">{clientById(activeClient)?.name}</button>
                {/* No done count or progress bar here — it said the same
                    thing three ways in a breadcrumb (Derek: "remove tasks
                    done, it's just clutter"). */}
              </p>
            </>) : (<>
              <h1 className="flex items-center gap-2 truncate text-[20px] font-semibold">
                {settingsView ? "Settings" : inboxView ? (userById(dmUserId)?.name ?? "Direct Message") : dirView === "inbox" ? "Inbox" : dirView === "clients" ? "All clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "Clients" : activeClient === "all" ? "Tasks" : (ghlContactUrlFor(activeClient) ? <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="hover:text-accent hover:underline">{clientById(activeClient)?.name}</a> : clientById(activeClient)?.name)}
                {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && (() => { const h = HEALTH_META[clientHealth(activeClient, scopedTasks)]; return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ background: h.dot + "1a", color: h.dot }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} /> {h.label}</span>; })()}
                {/* Same star as the Clients directory row — pinning to the
                    sidebar shouldn't require leaving the client's own page
                    to do it. */}
                {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && !activeProject && (
                  <span role="button" tabIndex={-1} onClick={() => toggleStar(activeClient)} title={starred.has(activeClient) ? "Unpin from sidebar" : "Pin to sidebar"}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${starred.has(activeClient) ? "text-amber-400" : "text-muted"}`}><I.star filled={starred.has(activeClient)} /></span>
                )}
              </h1>
              <p className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
                {/* Breadcrumb back to the Clients directory — only meaningful
                    when a specific client is the thing being viewed. */}
                {clientView && (<>
                  <button onClick={() => goToView("dashboard")} className="hover:text-foreground hover:underline">Clients</button>
                  <span>›</span>
                  <button onClick={() => { setDirView("clients"); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setOpenTaskId(null); }} className="hover:text-foreground hover:underline">All clients</button>
                  <span>›</span>
                </>)}
                <span>{settingsView ? "Integrations, team, templates, and API tokens" : inboxView ? "Private — only the two of you can see this" : dirView === "inbox" ? "Your email, texts, social messages, calls and task chats" : dirView === "clients" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"}` : dirView === "projects" ? `${workspaceProjects.length} project${workspaceProjects.length === 1 ? "" : "s"}` : personalView ? "Your private to-dos — only visible to you" : myWork ? "" : activeClient === "all" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}` : clientCompany(clientById(activeClient))}</span>
              </p>
            </>)}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          {/* The only way into the create form since the floating "+" was
              removed, and the only way to make a task at all from All Tasks,
              where the inline row is off because no client is selected.
              Hidden on the views that are not lists of tasks. */}
          {!inboxView && !settingsView && !dirView && (
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
              {/* Emailing the client what we are still waiting on used to live
                  inside the weekly review strip, so it only appeared on a
                  client the review cadence had raised. The cadence is gone
                  (Derek, 2026-09-28); being blocked on a client is not, so
                  this shows whenever there is something outstanding. */}
              {!activeProject && waitingTasksFor(activeClient).length > 0 && canMessageClient(activeClient) && (
                <button onClick={() => openRemindClient(activeClient)}
                  title="Email this client the items we're still waiting on, with their portal link"
                  className="rounded-md border border-teal-500/40 bg-teal-500/10 px-2.5 py-1.5 text-[13px] font-medium text-teal-600 hover:bg-teal-500/20">
                  Remind ({waitingTasksFor(activeClient).length})
                </button>
              )}
              {/* Secondary/config actions folded into one overflow menu so the
                  header leads with Follow-up / tabs / Email-SMS / Follow / Status
                  / Review instead of a cluster of equal-weight buttons. Same
                  menu as the compact header — see overflowControl above. */}
              {overflowControl}
            </div>
          )}


          {inboxView || settingsView || dirView ? null : myWork ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-md border">
                <button onClick={() => setDashboardView("work")} className={`px-2.5 py-1.5 text-[13px] font-medium ${dashboardView === "work" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Work</button>
                <button onClick={() => setDashboardView("reviews")} title="Everything out with a client right now" className={`px-2.5 py-1.5 text-[13px] font-medium ${dashboardView === "reviews" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Reviews</button>
                <button onClick={() => setDashboardView("drafts")} title="Everything written and not sent yet" className={`px-2.5 py-1.5 text-[13px] font-medium ${dashboardView === "drafts" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Drafts</button>
              </div>
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
            <div className="flex items-center gap-1.5">
              {followingControl}
              {groupSortControl}
              {filterMenuControl}
              {columnsControl}
              {clientView && bulkAddControl}
              {clientView && copyForClaudeControl}
            </div>
          )}

          {/* No notification bell (Derek, 2026-09-01: "not useful"). It
              restated things the app already surfaces where you act on them:
              assignments show up in your task list, client replies raise a
              Conversation task, and unread chat is counted on the teammate's
              own row. A second inbox for the same signals is one more thing to
              clear rather than one more thing you learn from. */}

          </div>
        </header>

        {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && (
          <QuickLinksBar
            links={clientLinks.filter((l) => l.clientId === activeClient)}
            canEdit={canAdmin}
            onEdit={(link) => setLinkModal({ initial: link })}
            onDelete={deleteLink}
            onReorder={(ids) => reorderLinks(activeClient, ids)}
          />
        )}


        {/* content */}
        {settingsView ? (
          <SettingsHub
            initialTab={settingsInitialTab}
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
        ) : dirView === "inbox" ? (
          <div className="flex min-h-0 flex-1 bg-surface">
            <InboxView inbox={inbox} me={{ id: me.id, name: me.name }} team={users.map((u) => ({ id: u.id, name: u.name }))}
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
              contacts={contacts}
              onSendTeam={sendTeam}
              onPatchTask={(id, patch) => patchTask(id, patch)}
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
            onOpen={(id) => { setDirView(null); setActiveClient(WORKSPACE_CLIENT_ID); setActiveProject(id); setOpenTaskId(null); setClientTab("tasks"); }}
            canAdmin={canAdmin} onAddProject={() => addProject(WORKSPACE_CLIENT_ID)} onRename={renameProject} onDelete={deleteProject}
            starredLists={starredLists} onToggleStarList={toggleStarList} />
        ) : personalView ? (
          <GroupedList key={`${groupBy}:${activeClient === "all"}`} lensId={lensUserId} groupKind={groupBy} collapseFarBuckets={activeClient === "all"} meId={me.id} onOpenClient={(cid) => openClientList(cid, null)} groups={buildGroups(myPersonalTasks.filter(passesFilters))} showClient={false} clientById={clientById} projectById={projectById} folderById={folderById} contactById={contactById} previewByTask={previewByTask} visibleCols={["followUp", "due"]} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd quickAddHint="" onAddInGroup={(k) => setDumpGroup({ key: k, personal: true })} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} hideEmpty={hideEmpty} colOrder={colOrder} onReorderCols={reorderCols} />
        ) : myWork && dashboardView === "drafts" ? (
          <DraftsBoard groups={pendingSends} loading={draftsLoading} onRefresh={loadPendingSends}
            rowContext={(row) => {
              const client = clientById(row.clientId);
              if (!client) return null;
              const task = row.taskId ? tasks.find((t) => t.id === row.taskId) : null;
              return { clientName: client.name, taskTitle: task?.title ?? null };
            }}
            // A draft on a task opens that task. One on the client itself was
            // written in the Journal's composer, so that is where it opens, not
            // on the client's task list where there is no sign of it.
            onOpen={(row) => {
              if (row.taskId) { setOpenTaskId(row.taskId); return; }
              openClientList(row.clientId, null);
              setClientTab("chat");
            }} />
        ) : myWork && dashboardView === "reviews" ? (
          <ReviewsBoard groups={openReviews} loading={reviewsLoading} onRefresh={loadOpenReviews} videoStorage={videoStorage}
            taskContext={(taskId) => {
              const t = tasks.find((x) => x.id === taskId);
              return t ? { taskTitle: t.title, clientName: clientById(t.clientId)?.name ?? "Unknown client" } : null;
            }}
            onOpenTask={setOpenTaskId} />
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
            scheduled={scheduledMessages[activeClient] ?? []}
            onLoadScheduled={() => loadScheduledMessages(activeClient)}
            onCancelScheduled={(id) => cancelScheduledMessage(id, activeClient)}
            toContact={activeProject ? null : contactForClient(activeClient)}
            composeIntent={composeIntent}
            sendingMessage={sendingMessage}
            onUploadImage={(file) => uploadOneImage("notes", file)}
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
                onSelectFolder={(id) => { setActiveFolder(id); setActiveProject(null); setGroupBy("project"); }}
                onSelectList={(id) => { setActiveProject(id); setActiveFolder(null); }}
                onCreateFolder={() => createFolder(activeClient)} onCreateList={(fid) => addProject(activeClient, fid)}
                onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onRenameList={renameProject} onDeleteList={deleteProject} onMoveList={moveListToFolder}
                onReorderFolders={(ids) => reorderFolders(activeClient, ids)} onReorderLists={(fid, ids) => reorderLists(activeClient, fid, ids)}
                onAddTask={() => setDumpGroup({ key: null, personal: false })} />
            );
          })()}
          {activeProject && stagesForProject(activeProject).length > 0 ? (
            <StageBoard stages={stagesForProject(activeProject)} tasks={baseTasks.filter(passesFilters)} canAdmin={canAdmin}
              onOpenTask={setOpenTaskId} onSetTaskStage={setTaskStage} onQuickAdd={(stageId, title) => quickAddInStage(activeProject, stageId, title)}
              onCreateStage={() => createStage(activeProject)} onRenameStage={renameStage} onToggleStageIsDone={toggleStageIsDone} onDeleteStage={deleteStage}
              onReorderStages={(ids) => reorderStages(activeProject, ids)} />
          ) : (
            <>
            {activeFilterBar}
            <GroupedList key={`${groupBy}:${activeClient === "all"}`} lensId={lensUserId} groupKind={groupBy} collapseFarBuckets={activeClient === "all"} meId={me.id} onOpenClient={(cid) => openClientList(cid, null)} groups={buildGroups(sortTasks(baseTasks.filter(passesFilters)))} showClient={activeClient === "all"} clientById={clientById} projectById={projectById} folderById={folderById} contactById={contactById} previewByTask={previewByTask} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd quickAddHint="" onAddInGroup={railHidden ? (k) => setDumpGroup({ key: k, personal: false, clientId: activeClient.startsWith("cl_") ? activeClient : lastUsedClientId() }) : undefined} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} hideEmpty={hideEmpty} onDropInGroup={groupBy === "status" || groupBy === "priority" ? dropTaskInGroup : undefined} onMergeTasks={requestMerge} colOrder={colOrder} onReorderCols={reorderCols} selectedIds={selectedTaskIds} onToggleSelect={toggleTaskSelection} />
            </>
          )}
          </>
        )}
      </main>

      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border bg-surface px-3 py-2 shadow-xl">
          <span className="text-[15px] font-medium">{selectedTaskIds.size} selected</span>
          <select defaultValue="" onChange={(e) => {
            const v = e.target.value;
            // "waiting" is a task flag, not a real member id. It never touches
            // the assignee, and assigning never clears it: a waiting task
            // stays with whoever follows up on it (see applyWaitingStatusSync).
            if (v === "waiting") bulkPatch({ waitingOnClient: true }, "Set waiting on client");
            else if (v === "unassigned") bulkPatch({ assigneeId: null }, "Unassign");
            else if (v) bulkPatch({ assigneeId: v }, `Assign to ${users.find((u) => u.id === v)?.name ?? "user"}`);
            e.target.value = "";
          }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Assignee…</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ status: e.target.value as TaskStatus }, `Set status to ${STATUS_META[e.target.value as TaskStatus]?.label ?? e.target.value}`); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Status…</option>{pickableStatuses().map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ priority: e.target.value as Priority }, `Set priority to ${PRIORITY_META[e.target.value as Priority]?.label ?? e.target.value}`); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Priority…</option>{PRIORITY_ORDER.filter(isManuallyAssignable).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select>
          <input type="date" onChange={(e) => { if (e.target.value) { bulkPatch({ due: e.target.value }, `Set due date to ${e.target.value}`); e.target.value = ""; } }} title="Due date" className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none" />
          <button onClick={() => bulkPatch({ due: null }, "Removed due date")} title="Clear the due date on every selected task" className="rounded-md border bg-background px-2 py-1 text-[15px] text-muted hover:bg-danger-soft hover:text-danger">Remove dates</button>
          <div className="w-40">
            <SearchableSelect value="" onChange={(v) => v && bulkMoveTo(v)}
              options={moveTargets}
              placeholder="Move to…" searchPlaceholder="Search clients and projects…"
              className="rounded-md border bg-background px-2 py-1 text-[15px]" />
          </div>
          {selectedTaskIds.size === 2 && (() => {
            // The older task is the "keeper" (target); the newer one merges
            // into it — no separate picker needed for exactly-2 selected.
            const [a, b] = [...selectedTaskIds].map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t);
            if (!a || !b) return null;
            const [target, source] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
            return (
              <button onClick={() => requestMerge(source.id, target.id)} title={`Merge "${source.title}" into "${target.title}"`}
                className="rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-background">Merge</button>
            );
          })()}
          {users.some((u) => u.id !== me.id) && (
            <button onClick={() => setBulkDelegateOpen(true)} title={`Hand all ${selectedTaskIds.size} to one person, once`}
              className="rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-background">Delegate</button>
          )}
          <button onClick={bulkDelete} title="Delete selected tasks" className="rounded-md border border-danger/40 px-2.5 py-1 text-[15px] font-medium text-danger hover:bg-danger/10">Delete</button>
          <button onClick={clearSelection} className="rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-background">Clear</button>
        </div>
      )}

      {clientEmail && (() => {
        const cid = clientEmail.clientId;
        const contact = contactForClient(cid);
        const allowed = canMessageClient(cid);
        return (
          <ClientEmail key={clientEmail.nonce} start={clientEmail} clientName={clientById(cid)?.name ?? "this client"} meId={me.id}
            toEmail={contact?.email || null} messages={contact ? messages.filter((m) => m.contactId === contact.id) : null}
            onClose={() => setClientEmail(null)}
            onSend={allowed ? (email) => sendMessage(cid, "email", email.subject, email.body, email.attachments, email.cc, email.bcc, null, undefined, email.replyTo) : undefined}
            onSchedule={allowed ? (email, whenIso) => scheduleMessage(cid, "email", email.subject, email.body, whenIso, email.attachments, email.cc, email.bcc, null, undefined, email.replyTo) : undefined}
            ccContacts={contacts} onUpload={(file) => uploadOneImage(`messages/${cid}`, file)}
            onAiDraft={(instruction, context) => draftMessage(cid, "email", instruction || undefined, null, context)}
            scheduled={(scheduledMessages[cid] ?? []).filter((s) => s.channel === "email")}
            onLoadScheduled={() => loadScheduledMessages(cid)} onCancelScheduled={(id) => cancelScheduledMessage(id, cid)}
            pushToast={pushToast} />
        );
      })()}
      {dumpGroup && (
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
        />
      )}
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
        <TaskDrawer key={openTask.id} task={openTask} clientById={clientById} projectById={projectById} contactById={contactById}
          full={drawerFull} onToggleFull={toggleDrawerFull} slideOver={dirView === "inbox"} slideBackLabel={inboxBackLabel}
          navIndex={openTaskIdx} navTotal={navTaskIds.length} onPrev={() => goToTask(-1)} onNext={() => goToTask(1)}
          onClose={() => setOpenTaskId(null)} onPatch={(patch) => patchTask(openTask.id, patch)} onDelete={() => deleteTask(openTask.id)} onAddComment={(body, attachments) => addComment(openTask.id, body, attachments)}
          onAddFiles={(files) => addFiles(openTask.id, files)} onDownloadFile={downloadFile} onDownloadFileAs={downloadFileAs} onDownloadAll={downloadAllAsZip} zippingIds={zippingIds} onRemoveFile={(att) => removeFile(openTask.id, att)} uploadProgress={uploadProgress} allClients={[...workableClients].sort((a, b) => a.name.localeCompare(b.name))} onMoveClient={(cid) => moveTaskToClient(openTask.id, cid)} clientProjects={projectsForClient(openTask.clientId)} onSetProject={(pid) => { patchTask(openTask.id, { projectId: pid }); }} onNewProject={() => moveTaskToNewProject(openTask.id, openTask.clientId)} onRenameProject={() => renameProject(openTask.projectId)} onToggleSub={(sid) => toggleSub(openTask.id, sid)} onAddSub={(title) => addSub(openTask.id, title)} onRenameSub={(sid, title) => renameSub(openTask.id, sid, title)} onDeleteSub={(sid) => deleteSub(openTask.id, sid)} onPatchSub={(sid, patch) => patchSub(openTask.id, sid, patch)} onToggleLabel={(lid) => toggleLabel(openTask.id, lid)} onCopyLink={() => copyLink({ view: null, client: "all", project: null, task: openTask.id, clientTab: null, vaultFolder: null, dm: null, assignee: null, sub: null })} onDuplicate={(target) => duplicateTask(openTask.id, target)} projectsFor={projectsForClient} onOpenMerge={() => setMergeSourceId(openTask.id)} onOpenClientList={() => openClientList(openTask.clientId, openTask.projectId)} templates={taskTemplates} onApplyTemplate={(templateId) => applyTemplate(openTask.id, templateId)} onUploadCommentImage={(file) => uploadOneImage("comments", file)} onCopyAttachmentLink={copyAttachmentLink} onGetSignedUrl={signedUrlForFile} messages={openTaskMessages} onMarkChannelRead={(channel) => markTaskChannelRead(openTask.id, channel)} linkedContactInfo={contactForClient(openTask.clientId)} onSaasSaved={noteSaasUrl} ccContacts={contacts} onUploadMessageImage={(file) => uploadOneImage(`messages/${openTask.clientId}`, file)} onSendTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, attachments, cc, bcc, replyToMessageId) => sendMessage(openTask.clientId, channel, subject, body, attachments, cc, bcc, openTask.id, undefined, replyToMessageId) : undefined} onScheduleTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, scheduledAt, attachments, cc, bcc, replyToMessageId) => scheduleMessage(openTask.clientId, channel, subject, body, scheduledAt, attachments, cc, bcc, openTask.id, undefined, replyToMessageId) : undefined} sendingMessage={sendingMessage} onDraftMessage={(channel, prompt, context) => draftMessage(openTask.clientId, channel, prompt, openTask.projectId, context)} draftingMessage={draftingMessage} canAdmin={canAdmin} onDeleteMessage={deleteMessage} onEditMessage={editMessage} onCopyClientLink={() => copyClientShareLink(openTask.clientId, openTask.projectId)} onDeleteComment={(cid) => deleteComment(openTask.id, cid)} onDraftDescription={draftDescription} draftingDescription={draftingDescription} pushToast={pushToast} meId={me.id}
          onSendDm={(userId, body) => sendDmMessage(userId, body)}
          onDelegate={(spec) => delegateTask(openTask.id, spec)}
          clientLinks={openTaskClientLinks}
          taskLink={() => linkTo({ view: null, client: "all", project: null, task: openTask.id, clientTab: null, vaultFolder: null, dm: null, assignee: null, sub: null })} />
      )}

      {addClientOpen && <AddClientModal subAccounts={subAccounts} contacts={contacts} existingIds={new Set(clients.map((c) => c.id))} onAdd={addClientContact} onAddRemote={addRemoteContact} onClose={() => setAddClientOpen(false)} />}
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
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l bg-surface shadow-xl">
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
      {cmdkOpen && <CommandK tasks={scopedTasks} clients={workableClients} projects={projects} contacts={contacts} addedContactIds={addedContactIds} clientById={clientById}
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
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (<div key={t.id} className="flex items-center gap-3 rounded-lg bg-foreground px-3.5 py-2 text-[15px] font-medium text-[color:var(--surface)] shadow-lg"><span>{t.text}</span>{t.action && (<button onClick={() => { t.action!.run(); dismissToast(t.id); }} className="shrink-0 rounded-md border border-[color:var(--surface)]/35 px-2 py-0.5 text-[14px] font-semibold hover:bg-[color:var(--surface)]/15">{t.action.label}</button>)}{t.secondaryAction && (<button onClick={() => { t.secondaryAction!.run(); dismissToast(t.id); }} className="shrink-0 rounded-md bg-[color:var(--surface)] px-2 py-0.5 text-[14px] font-semibold text-foreground hover:opacity-90">{t.secondaryAction.label}</button>)}</div>))}
      </div>
    </div>
  );
}

