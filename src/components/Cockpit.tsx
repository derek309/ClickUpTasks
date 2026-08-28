"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  users,
  setUsers,
  initialsOf,
  userById,
  formatDue,
  advanceDue,
  isOverdue,
  timeAgo,
  htmlToText,
  plainTextToHtml,
  TODAY,
  TOMORROW,
  addDaysIso,
  daysBetween,
  THIS_MONDAY,
  THIS_WEEK_END,
  NEXT_WEEK_END,
  THIS_MONTH_END,
  DUE_BUCKETS,
  dueBucketOf,
  NURTURE_CHECK_IN_DAYS,
  TRIAL_DAYS,
  STATUS_META,
  STATUS_ORDER,
  applyWaitingStatusSync,
  mentionsUser,
  isCompletionEvent,
  CLIENT_STATUS_META,
  CLIENT_STATUS_ORDER,
  clientStatusMeta,
  type ClientStatus,
  type ClientType,
  HEALTH_META,
  clientHealth,
  PRIORITY_META,
  PRIORITY_ORDER,
  isManuallyAssignable,
  type Task,
  type TaskStatus,
  type Priority,
  type Subtask,
  type Client,
  type Project,
  type Contact,
  type Attachment,
  type Notification,
  type NotificationKind,
  type ClientLink,
  type ClientNote,
  type NoteType,
  type Comment,
  type Message,
  type MessageChannel,
  type ScheduledMessage,
  type Me,
  type TaskTemplate,
  type Playbook,
  type PlaybookTask,
  playbookCompletion,
  PLAYBOOK_PHASES,
  PLAYBOOK_A2P_PHASE,
  PLAYBOOK_EMAIL_DOMAIN_PHASE,
  PLAYBOOK_ONGOING_PHASE,
  PLAYBOOK_ALL_STEPS,
  SALES_STAGE_STEPS, SALES_STAGE_ORDER, STATUS_IMPLIES_SALES_STAGE,
  playbookStepsForClient,
  PLAYBOOK_INTRO,
  PLAYBOOK_MILESTONE,
  PLAYBOOK_ALWAYS_RUNNING,
  PLAYBOOK_FINISH_LINE,
  playbookProjectId,
  type VaultFolder,
  type Folder,
  type Stage,
  type TeamMessage,
  type DmMessage,
  dmConversationId,
  PERSONAL_CLIENT_ID,
  WORKSPACE_CLIENT_ID,
  PERSONAL_PROJECT_ID,
  normalizeState,
} from "@/lib/data";
import { supabase, supabaseReady, authedFetch } from "@/lib/supabase";
import { seedIfEmpty, fetchAll, fetchContacts, upsertTask, deleteTaskDb, restoreTaskDb, hardDeleteTaskDb, upsertClient, bulkUpsertClients, upsertProject, deleteProjectDb, restoreProjectDb, hardDeleteProjectDb, deleteClientDb, restoreClientDb, hardDeleteClientDb, mergeClientsDb, insertNotif, markNotifsReadDb, markNotifReadDb, uploadTaskFile, signedUrlForFile, downloadUrlForFile, deleteTaskFile, upsertClientLink, deleteClientLinkDb, upsertClientNote, deleteClientNoteDb, appendCommentDb, upsertTaskTemplate, deleteTaskTemplateDb, upsertPlaybook, deletePlaybookDb, bulkUpsertTasks, upsertVaultFolder, deleteVaultFolderDb, upsertFolder, deleteFolderDb, upsertStage, deleteStageDb, rowToTask, rowToClient, rowToNotif, rowToMessage, rowToClientNote, rowToTeamMessage, insertTeamMessage, deleteTeamMessageDb, updateTeamMessageDb, rowToDmMessage, insertDmMessage, deleteDmMessageDb, updateDmMessageDb, markMessagesReadDb, markTaskChannelReadDb, reassignMessagesTaskDb, insertMessage, deleteMessageDb, upsertContact, rowToScheduledMessage, touchPlaybookProgress, fetchAppSetting, upsertAppSetting } from "@/lib/db";
import { subscribeRealtime } from "@/lib/realtime";
import SettingsHub, { type TabKey } from "./SettingsHub";
import TeamChat from "./TeamChat";
import AddClientModal from "./AddClientModal";


import { I, Avatar, SideItem, MAX_ATTACHMENT_BYTES, newId, formatBytes, kindFromName, LIST_COLUMNS, SearchableSelect, type FilterState, type SortBy, type Toast } from "./cockpit/ui";
import { BulkAddModal, type ParsedRow } from "./cockpit/BulkAddModal";
import { RemindClientModal } from "./cockpit/RemindClientModal";
import { ConfirmModal, PromptModal, LinkFormModal, MergeTaskModal, MergeClientModal, type ConfirmSpec, type PromptSpec } from "./cockpit/modals";
import { CommandK } from "./cockpit/CommandK";
import { GroupedList, InlineDue } from "./cockpit/GroupedList";
import StageBoard from "./cockpit/StageBoard";
import { TaskDrawer } from "./cockpit/TaskDrawer";
import { QuickLinksBar } from "./cockpit/ClientLinks";
import { ClientJournal } from "./cockpit/ClientJournal";
import { QuickAddTask } from "./cockpit/QuickAddTask";
import { ClientsBoard, type WorkBoardGroup, type WorkItem } from "./cockpit/ClientsBoard";
import { ClientsDirectory } from "./cockpit/ClientsDirectory";
import { CompletedLog } from "./cockpit/CompletedLog";
import { ProjectsDirectory } from "./cockpit/ProjectsDirectory";
import { FolderRail } from "./cockpit/FolderRail";

// --- Deep-link URL state ----------------------------------------------------
// The whole app lives on "/", so we encode what you're looking at into the
// query string: shareable links, refresh-safe, and back/forward navigation.
//   ?view=work|clients|personal|settings   the special boards
//   ?view=inbox[&dm=<userId>]              team chat, optionally a DM thread
//   ?client=<id>[&project=<id>]   a client (optionally scoped to one project)
//   ?task=<id>                    the task drawer (layers over any of the above)
type NavState = { view: "work" | "personal" | "inbox" | "clients" | "projects" | "settings" | null; client: string; project: string | null; task: string | null; clientTab: "tasks" | "chat" | null; vaultFolder: string | null; dm: string | null };
function buildSearch(s: NavState): string {
  const p = new URLSearchParams();
  if (s.view) {
    p.set("view", s.view);
    if (s.view === "inbox" && s.dm) p.set("dm", s.dm);
  } else if (s.client !== "all") {
    p.set("client", s.client);
    if (s.project) p.set("project", s.project);
    // "tasks" is the default sub-tab — only encode it when it differs, so
    // every pre-existing shared link (no ?tab= at all) still keeps working.
    if (s.clientTab && s.clientTab !== "tasks") p.set("tab", s.clientTab);
    if (s.vaultFolder) p.set("folder", s.vaultFolder);
  }
  if (s.task) p.set("task", s.task);
  const q = p.toString();
  return q ? `?${q}` : "";
}
function parseSearch(search: string): NavState {
  const p = new URLSearchParams(search);
  const v = p.get("view");
  const tab = p.get("tab");
  return {
    view: v === "work" || v === "personal" || v === "inbox" || v === "clients" || v === "projects" || v === "settings" ? v : null,
    client: p.get("client") ?? "all",
    project: p.get("project"),
    task: p.get("task"),
    // "vault" was a separate tab pre-merge — old bookmarked/shared links
    // still resolve it into Journal (now the only place attachments live).
    clientTab: tab === "chat" || tab === "vault" ? "chat" : null,
    vaultFolder: p.get("folder"),
    dm: p.get("dm"),
  };
}

// Number-key shortcuts for the top-level views, in sidebar order. Shown as
// a hint on each sidebar item and handled by the keydown effect below.
const NAV_KEY_VIEWS: Record<string, "dashboard" | "clients" | "projects" | "personal" | "teamchat"> = {
  "1": "dashboard",
  "2": "teamchat",
  "3": "clients",
  "4": "projects",
  "5": "personal",
};

// Titles longer than this get quietly rewritten by AI after the task is
// created (see maybeCleanupTaskTitle). 80 characters is roughly two typical
// sentences: a genuine task title almost never runs that long, so anything
// past it is a sign the whole thought got typed into the title box. It also
// matches the "under 80 characters" title the Gmail extension's enrich prompt
// already asks Gemini for, so both paths agree on what a good title looks like.
const LONG_TITLE_THRESHOLD = 80;

// Deep link straight to Team Chat, for notification emails. ?view=inbox is
// what parseUrl maps onto inboxView (see NavState above).
const TEAM_CHAT_LINK = "?view=inbox";

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
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
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
  // Full-page Clients / Projects directory views (the "Clients" and "Projects"
  // nav links). A distinct mode like inbox/personal — when set, the main pane
  // shows the directory instead of a client/task view. clearViews() below
  // resets it alongside the others.
  const [dirView, setDirView] = useState<"clients" | "projects" | null>(null);
  // Dashboard's own Work/Completed split — Completed relocated here from the
  // Clients directory (Derek: "makes more sense there") — see the myWork
  // content branch below. The Activity tab (notifications inbox) was cut
  // (Derek, 2026-08-24: "not finding it useful... cut the tab" — the notif
  // bell dropdown already covers real mentions/assignments; Activity's own
  // "Unmatched email" section was mostly automated noise — WordPress,
  // Stripe, Amazon — not real leads).
  const [dashboardView, setDashboardView] = useState<"work" | "completed">("work");
  // All Tasks defaults to just your own — admins can flip to "all"; for VAs
  // this is inert either way since scopedTasks already fully restricts them.
  const [allTasksScope, setAllTasksScope] = useState<"mine" | "all">("mine");
  const [groupBy, setGroupBy] = useState<"project" | "status" | "priority" | "due">("priority");
  const [filters, setFilters] = useState<FilterState>({ status: "all", assignee: "all", priority: "all" });
  const [sortBy, setSortBy] = useState<SortBy>("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleCols, setVisibleCols] = useState<string[]>(["status", "priority", "due", "created"]);
  // Manual drag order for list columns — persisted like the other view
  // toggles below. Any key not yet in a saved order (e.g. after adding a new
  // column) falls back to LIST_COLUMNS' own order in reorderCols/colOrder use.
  const [colOrder, setColOrder] = useState<string[]>(LIST_COLUMNS.map((c) => c.key));
  const reorderCols = (keys: string[]) => { setColOrder(keys); try { localStorage.setItem("cut_colOrder", JSON.stringify(keys)); } catch {} };
  // The old "Filter & view" popover held Following, group/sort, filter, and
  // column config all in one 290px panel — split into three focused menus
  // (item 6) plus Following moving to its own header avatar stack below.
  const [groupSortOpen, setGroupSortOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hideDone, setHideDone] = useState(true);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const [bellOpen, setBellOpen] = useState(false);
  // A real page, like My Work/Personal/Team Chat — not a popup or slide-out
  // (it used to be a fixed-position overlay; Derek asked more than once for
  // it to render in the normal content area instead).
  const [settingsView, setSettingsView] = useState(false);
  // Lets a deep link (e.g. the "Work with Claude" fallback toast) open
  // Settings straight to a specific tab instead of always landing on
  // Integrations — SettingsHub only reads this once per mount, via its own
  // initialTab prop.
  const [settingsInitialTab, setSettingsInitialTab] = useState<TabKey>("integrations");
  const openSettingsTab = (tab: TabKey) => {
    setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setDirView(null);
    setSettingsInitialTab(tab);
    setSettingsView(true);
  };
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([]);
  // Which half of the Team Chat page is showing. Chat leads — per Derek, the
  // inbox "is really what team chat was supposed to be": talk to the team
  // first, review the task comments/mentions addressed to you second.
  // Per-user "last seen" timestamp for the unread badge. Server-side now
  // (profiles.team_chat_last_read_at, see supabase/team-chat-read-state.sql):
  // as a localStorage value it was per-browser, so reading the channel on a
  // laptop left the badge showing on a phone, and clearing site data made
  // every message unread again. localStorage is kept as an instant local echo
  // so the badge clears without waiting on a round trip.
  const [teamChatLastRead, setTeamChatLastRead] = useState<string>("");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setTeamChatLastRead(localStorage.getItem("cut_teamChatLastRead") ?? ""); } catch {} }, []);
  // Then the server's value, which wins when it's newer — another device may
  // have read the channel since this tab last wrote its local copy.
  useEffect(() => {
    let cancelled = false;
    authedFetch("/api/notifications/prefs")
      .then((r) => r.json())
      .then((j) => {
        const remote: string | null = j?.teamChatLastReadAt ?? null;
        if (cancelled || !remote) return;
        setTeamChatLastRead((local) => (Date.parse(remote) > (local ? Date.parse(local) : 0) ? remote : local));
      })
      .catch(() => { /* offline — the local echo still works */ });
    return () => { cancelled = true; };
  }, []);
  // Another tab reading the channel clears this one too. Without this a
  // second window keeps showing a badge for messages you've already read,
  // which looks exactly like a phantom notification — the server value is
  // only fetched once, at mount, so nothing else would ever tell this tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "cut_teamChatLastRead" || !e.newValue) return;
      setTeamChatLastRead((local) => (Date.parse(e.newValue!) > (local ? Date.parse(local) : 0) ? e.newValue! : local));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const markTeamChatRead = () => {
    const now = new Date().toISOString();
    setTeamChatLastRead(now);
    try { localStorage.setItem("cut_teamChatLastRead", now); } catch {}
    authedFetch("/api/notifications/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamChatLastReadAt: now }),
    }).catch(() => { /* best effort — the local echo already cleared it here */ });
  };
  // Which DM thread (if any) is open — the Chat hub's "Conversations" row
  // and each teammate's row are mutually exclusive, so a non-null value here
  // means "showing a DM thread" and null means "showing team chat" (see the
  // Conversations page's render branch further down).
  const [dmUserId, setDmUserId] = useState<string | null>(null);
  // Shared, admin-controlled — "we don't need DMs for now... make it so we
  // can turn it on and off in case we want it later" (Derek). Off by
  // default; see supabase/app-settings.sql. Fails soft to false (DMs hidden)
  // if that migration hasn't run yet, rather than erroring.
  const [dmEnabled, setDmEnabledState] = useState(false);
  useEffect(() => { fetchAppSetting("dm_enabled", false).then(setDmEnabledState); }, []);
  const setDmEnabled = (v: boolean) => { setDmEnabledState(v); upsertAppSetting("dm_enabled", v); };
  // If an admin turns DMs off while someone's actually looking at a thread,
  // don't leave them stranded on a now-hidden feature — same "Conversations"
  // row openTeamChat already goes to.
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
  const goToView = (view: "dashboard" | "alltasks" | "clients" | "projects" | "personal" | "teamchat") => {
    setMyWork(view === "dashboard");
    setPersonalView(view === "personal");
    setInboxView(view === "teamchat");
    setDirView(view === "clients" ? "clients" : view === "projects" ? "projects" : null);
    setDmUserId(null);
    setSettingsView(false);

    setOpenTaskId(null);
    setSidebarOpen(false);
    // Only the two directory views cleared this before; leaving it alone
    // elsewhere preserves the previously-open project when you bounce to
    // Dashboard/Personal/Chat and back.
    if (view === "clients" || view === "projects") setActiveProject(null);
    if (view === "teamchat") markTeamChatRead();
    // All Tasks is the flat everything-list, so it can't stay scoped to one
    // client or project. It opens grouped and sorted by due date (Derek,
    // 2026-08-26: "just want to see all tasks as well by due date") — the
    // point of the view is what's coming up, not which client it belongs to.
    // groupBy isn't persisted, and the vault folder picker already sets it on
    // navigation the same way, so this is a starting point you can change
    // from the Group by control, not a preference being overwritten.
    if (view === "alltasks") {
      setActiveClient("all");
      setActiveProject(null);
      setGroupBy("due");
      setSortBy("due");
      setSortDir("asc");
    }
  };
  // Team Chat is a real view now, not an overlay — open the page on its Chat
  // tab and clear the unread dot. Used by both the sidebar item and the
  // header shortcut so there's exactly one home for it.
  const openTeamChat = () => goToView("teamchat");
  // Memoized — .some over teamMessages every render, and it also sits in a
  // useEffect's dependency array below, so an unstable value here re-ran
  // that effect on every render too.
  // A count, not a boolean. Team Chat was the only nav item showing a bare
  // dot while My Work, Clients, Projects and Personal all showed a number —
  // a dot says "something happened", a number says how much you've missed
  // (Derek: make it so "people see it and use it more").
  //
  // Two rules, both from Derek chasing a badge that lit with nothing new to
  // read: "you should only notify when there's a new message from a team
  // member only."
  //
  // 1. Compare instants, not strings. The read marker can arrive in either of
  //    two spellings of the same moment — "…277Z" when this browser wrote it,
  //    "…277+00:00" when Postgres handed it back — and `>` on those compares
  //    characters, not time. Date.parse removes the whole class of problem.
  // 2. Only messages from a real, current teammate count. An author who no
  //    longer resolves on the roster (a removed teammate, or a non-human like
  //    the u_claude bot row) is not someone you can go and read a reply from,
  //    so it must never light the badge.
  const teamChatUnread = useMemo(() => {
    const readAt = teamChatLastRead ? Date.parse(teamChatLastRead) : 0;
    return teamMessages.filter((m) => {
      if (m.authorId === me.id) return false;
      if (!users.some((u) => u.id === m.authorId)) return false;
      const at = Date.parse(m.at);
      return Number.isFinite(at) && at > readAt;
    }).length;
  }, [teamMessages, me.id, teamChatLastRead]);
  // Chat is always on screen now (the whole Conversations page is Chat, full
  // width), so this fires any time you're on that page at all. Messages
  // arriving while you're already there are already read — without this the
  // realtime insert lights an unread dot for a message that's on screen, and
  // it only clears by navigating away and back.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (inboxView && dmUserId === null && teamChatUnread) markTeamChatRead(); }, [inboxView, dmUserId, teamChatUnread]);

  // DM read-state — same local-only "last seen" idiom as Team Chat above,
  // just one timestamp per conversation instead of one global timestamp.
  // Not a DB-backed read table: this is a 5-10 person internal tool that
  // already accepts a single shared Message.read boolean for client SMS/
  // email, so an occasionally-stale-across-devices unread dot is a
  // proportionate cost for how much simpler this is to ship and maintain.
  const [dmLastRead, setDmLastRead] = useState<Record<string, string>>({});
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setDmLastRead(JSON.parse(localStorage.getItem("cut_dmLastRead") ?? "{}")); } catch {} }, []);
  const markDmRead = (conversationId: string) => {
    const now = new Date().toISOString();
    setDmLastRead((m) => {
      const next = { ...m, [conversationId]: now };
      try { localStorage.setItem("cut_dmLastRead", JSON.stringify(next)); } catch {}
      return next;
    });
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
  // Mirrors openTeamChat exactly, for a specific teammate's thread instead
  // of the shared feed.
  const openDm = (userId: string) => {
    setInboxView(true); setDmUserId(userId);
    setMyWork(false); setPersonalView(false); setDirView(null); setSettingsView(false);
    setOpenTaskId(null); setSidebarOpen(false);
    markDmRead(dmConversationId(me.id, userId));
    markDmNotifsRead(userId);
  };
  // Same reasoning as the Team Chat effect above: a DM message arriving
  // while its thread is already open is already read.
  const openDmThreadUnread = dmUserId !== null && dmUnread(dmUserId);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (dmUserId && openDmThreadUnread) markDmRead(dmConversationId(me.id, dmUserId)); }, [dmUserId, openDmThreadUnread, me.id]);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Draggable quick-add FAB position (viewport px of its top-left). null =
  // default corner (bottom-left). Persisted per-user in localStorage so it
  // stays wherever you park it out of the way of the composer/toasts.
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null);
  const fabDragRef = useRef({ down: false, moved: false, offX: 0, offY: 0, startX: 0, startY: 0 });
  const onFabPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    fabDragRef.current = { down: true, moved: false, offX: e.clientX - r.left, offY: e.clientY - r.top, startX: e.clientX, startY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onFabPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDragRef.current;
    if (!d.down) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true;
    setFabPos({ x: Math.max(4, Math.min(window.innerWidth - 60, e.clientX - d.offX)), y: Math.max(4, Math.min(window.innerHeight - 60, e.clientY - d.offY)) });
  };
  const onFabPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDragRef.current;
    d.down = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (!d.moved) setQuickAddOpen(true); // a click (no real drag) opens the modal
  };
  useEffect(() => { if (fabPos) try { localStorage.setItem("cut_fabPos", JSON.stringify(fabPos)); } catch {} }, [fabPos]);
  // Fade the FAB out of the way while you're actively scrolling a list, back
  // in once you stop — so it never sits on top of the content you're reading.
  const [fabScrolling, setFabScrolling] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onScroll = () => { setFabScrolling(true); clearTimeout(t); t = setTimeout(() => setFabScrolling(false), 600); };
    window.addEventListener("scroll", onScroll, true); // capture phase catches nested scroll containers
    return () => { window.removeEventListener("scroll", onScroll, true); clearTimeout(t); };
  }, []);
  // Set by the header Email/SMS buttons — jumps the Journal composer into that
  // mode. nonce bumps each click so it re-fires even when already on the Journal.
  const [composeIntent, setComposeIntent] = useState<{ mode: "email" | "sms"; nonce: number } | null>(null);
  const openCompose = (mode: "email" | "sms") => { setClientTab("chat"); setComposeIntent((c) => ({ mode, nonce: (c?.nonce ?? 0) + 1 })); };
  const [ghlBusy, setGhlBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const [promptDialog, setPromptDialog] = useState<PromptSpec | null>(null);
  // Id of the Conversation task currently being merged elsewhere — drives
  // the target-task picker modal (see requestMerge/mergeTasks).
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  // Client-merge modal: the client it was launched from (a), and optionally a
  // pre-chosen second side (b) when opened from a "possible duplicate" hint.
  const [mergeClientState, setMergeClientState] = useState<{ a: Client; b?: Client } | null>(null);

  // Client ordering: star to pin, sort mode (used by the Clients directory).
  // Personal preferences → persisted per-browser (localStorage), not the DB.
  type ClientSort = "manual" | "az" | "tasks" | "recent" | "used" | "urgent" | "mine";
  // Clients directory opens A-Z by default (Derek's preference); a saved
  // "cut_clientSort" still overrides this on load.
  const [clientSort, setClientSort] = useState<ClientSort>("az");
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
  // Recently-used ordering: clientId → last-opened epoch, persisted locally.
  // Opening a client stamps it (see the effect below), floating it to the top
  // when the "Recently used" sort is active.
  const [clientUsed, setClientUsed] = useState<Record<string, number>>({});
  const [starred, setStarred] = useState<Set<string>>(new Set());
  // Per-user pinned lists (projects), mirroring `starred` for clients — a
  // starred list gets its own quick-access row in the sidebar's Pinned section.
  const [starredLists, setStarredLists] = useState<Set<string>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [manualOrder, setManualOrder] = useState<string[]>([]);
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

  // Client-side twin of playbookReconcileServer.ts's completePlaybookStepServer
  // — no supabaseAdmin here, this goes through patchTask like any other
  // status change a rep makes, so it gets the same comment/history and the
  // same playbook_last_progress_at bump every other completion gets.
  // SALES_STAGE_ORDER/STATUS_IMPLIES_SALES_STAGE live in data.ts as the
  // shared source of truth (also used by the one-off bulk-backfill script),
  // rather than duplicated here.
  const cascadeSalesStageCompletion = (clientId: string, status: ClientStatus) => {
    const throughKey = STATUS_IMPLIES_SALES_STAGE[status];
    const throughIdx = throughKey ? SALES_STAGE_ORDER.indexOf(throughKey) : -1;
    if (throughIdx < 0) return;
    const byKey = new Map(
      (playbookTasksByClient.get(clientId) ?? []).map((t) => [t.playbookStepKey as string, t])
    );
    for (let i = 0; i <= throughIdx; i++) {
      const task = byKey.get(SALES_STAGE_ORDER[i]);
      if (task && task.status !== "done") patchTask(task.id, { status: "done" });
    }
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
    //
    // Reconciled against SALES_STAGE_STEPS below (cascadeSalesStageCompletion)
    // rather than flipping the direction (sales_pitch completing being
    // what promotes, instead of this dropdown) — only 1 of the 6 sales
    // stages has a real automated trigger today (sales_invite, via claim or
    // invite reply); the other 5, including sales_pitch itself, are still a
    // checkbox in a collapsed accordion section. Making promotion depend on that checkbox
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
    // Always, not just on promotion — a Stage move on a Playbook nobody's
    // ever opened still needs its rows to exist before the cascade below has
    // anything to complete.
    reconcilePlaybookTasks(id);
    cascadeSalesStageCompletion(id, status);
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
  // Whether this client's public page (/waiting/[token]) offers the "Add
  // Something" composer that raises a brand-new task, or stays reply-only.
  // Off by default, and admin-only for the same reason as
  // toggleClientMessagePermission above: clients_write RLS is already
  // is_admin(), so a VA calling this directly gets a silently-ignored write.
  // /api/waiting/[token]/request re-reads the column before it writes
  // anything, so this toggle is the decision, never the enforcement.
  const toggleClientCanRequestNewTasks = (clientId: string) => {
    const c = clientById(clientId);
    if (!c) return;
    const on = c.canRequestNewTasks !== true;
    const nc = { ...c, canRequestNewTasks: on };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(on ? `${c.name} can now add their own requests.` : `${c.name} can no longer add their own requests.`);
  };
  // How much of the account the client portal shows. Off means the portal
  // shows only what involves them (waiting on their input, or already
  // replied to); on means every non-private task on the account, which is
  // real exposure — internal work becomes readable by the client. Per client
  // for that reason, never global. Admin only, same as the toggles around it:
  // clients_write RLS is is_admin(), and the portal route re-reads the column
  // itself, so this toggle is the decision and never the enforcement.
  const toggleClientPortalShowsAllTasks = (clientId: string) => {
    const c = clientById(clientId);
    if (!c) return;
    const on = c.portalShowsAllTasks !== true;
    const nc = { ...c, portalShowsAllTasks: on };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(on ? `${c.name} now sees every task on their account.` : `${c.name} now only sees what involves them.`);
  };
  // Whether this client's Playbook includes the A2P texting setup steps and
  // the dedicated email domain step. Off by default (see
  // playbookStepsForClient in data.ts): not every business does SMS
  // marketing, and creating those tasks unconditionally for everyone used to
  // be a real bug. Admin only, same reasoning as the toggle above.
  const toggleClientDoesA2P = (clientId: string) => {
    const c = clientById(clientId);
    if (!c) return;
    const on = c.doesA2P !== true;
    const nc = { ...c, doesA2P: on };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    // The page-view effect only reconciles on a client switch, so without
    // this the new A2P steps wouldn't appear until you navigated away and
    // back. Turning it off intentionally does NOT remove anything already
    // created, same as every other reconcile call in this file.
    if (on) reconcilePlaybookTasks(clientId);
    pushToast(on ? `${c.name} now gets the A2P setup steps.` : `${c.name} no longer gets the A2P setup steps.`);
  };
  // Whether the public /waiting/[token] page shows the "Your growth plan"
  // progress card. Off by default — same reasoning as the toggles above,
  // just for whether the Playbook itself is client-visible at all, not one
  // client's specific steps. Admin only, same reasoning as the toggles above.
  const toggleClientShowGrowthPlan = (clientId: string) => {
    const c = clientById(clientId);
    if (!c) return;
    const on = c.showGrowthPlan !== true;
    const nc = { ...c, showGrowthPlan: on };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(on ? `${c.name}'s client link now shows their growth plan.` : `${c.name}'s client link no longer shows their growth plan.`);
  };
  // "Follow" a project directly — same idea as toggleClientAssignment, just
  // scoped to one project instead of the whole client. App-level only (no
  // RLS change, no realtime subscription on `projects` to echo-suppress).
  const toggleProjectAssignment = (projectId: string, memberId: string) => {
    const p = projectById(projectId);
    if (!p) return;
    const current = p.assignedTo ?? [];
    const np = { ...p, assignedTo: current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId] };
    setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
    upsertProject(np);
  };
  // Stamp reviewedAt = today, clearing this client/project from the Review
  // tier until next Monday (weekly) or its next nurture cycle. See
  // clientNeedsReview.
  const setClientReviewed = (clientId: string) => {
    const c = clientById(clientId);
    if (!c) return;
    const nc = { ...c, reviewedAt: TODAY };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(`Reviewed ${c.name} — cleared until next check-in.`);
  };
  const setProjectReviewed = (projectId: string) => {
    const p = projectById(projectId);
    if (!p) return;
    const np = { ...p, reviewedAt: TODAY };
    setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
    upsertProject(np);
    pushToast(`Reviewed ${p.name}.`);
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
  // "We're still waiting on these" nudge, raised from the Review controls.
  // The portal link is resolved when the modal is OPENED, not during render:
  // getClientShareUrl mints and persists a share token the first time it's
  // called for a client, so calling it from JSX would write to the database
  // on every re-render.
  const [remindClientId, setRemindClientId] = useState<string | null>(null);
  const [remindLink, setRemindLink] = useState<string | null>(null);
  const openRemindClient = (clientId: string) => {
    setRemindLink(getClientShareUrl(clientId));
    setRemindClientId(clientId);
  };
  const closeRemindClient = () => { setRemindClientId(null); setRemindLink(null); };
  const [remindSending, setRemindSending] = useState(false);
  const sendClientReminder = async (clientId: string, subject: string, body: string) => {
    setRemindSending(true);
    try {
      // Goes through the ordinary send path on purpose: same can-message
      // gating, same journal entry, same thread the client already replies
      // into. A reminder that doesn't appear in the client's own history is
      // a reminder nobody can later prove was sent.
      await sendMessage(clientId, "email", subject, plainTextToHtml(body));
      closeRemindClient();
    } finally {
      setRemindSending(false);
    }
  };
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
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
      return (j.tasks as ParsedRow[]).map((t) => ({ ...t, keep: true }));
    } catch {
      pushToast("Couldn't read that list.");
      return null;
    } finally {
      setBulkAddBusy(false);
    }
  };
  // One shared list resolution for the whole batch, so 12 tasks can't race
  // each other into creating 12 copies of a missing "Tasks" list.
  const createTasksFromList = (rows: ParsedRow[]) => {
    if (!rows.length || !activeClient.startsWith("cl_")) return;
    let projectId: string;
    let projectWrite: PromiseLike<unknown> | null = null;
    if (activeProject) projectId = activeProject;
    else {
      const existing = projects.find((pr) => pr.clientId === activeClient);
      if (existing) projectId = existing.id;
      else { const pr: Project = { id: newId("p_"), clientId: activeClient, name: "Tasks", description: "" }; setProjects((ps) => [...ps, pr]); projectWrite = upsertProject(pr); projectId = pr.id; }
    }
    const now = new Date().toISOString();
    const made: Task[] = rows.map((r) => {
      const waiting = r.assignee === "client";
      const member = r.assignee && r.assignee !== "client" ? users.find((u) => u.name === r.assignee) : null;
      return {
        id: newId("t_"), projectId, clientId: activeClient, title: r.title.trim(), description: r.description.trim() ? plainTextToHtml(r.description.trim()) : "",
        status: waiting ? "todo" : "todo",
        priority: r.priority, assigneeId: waiting ? null : (member?.id ?? null), waitingOnClient: waiting,
        contactId: activeClient.slice(3), due: r.due, recurrence: "none", labelIds: [], ghlTaskId: null,
        private: false, subtasks: [], attachments: [], comments: [], createdAt: now, createdBy: me.id,
      } as Task;
    });
    // waiting/status must move together — the one rule that owns that lives in
    // applyWaitingStatusSync, so route each one through it rather than hand
    // rolling it here.
    const synced = made.map((t) => ({ ...t, ...applyWaitingStatusSync({ status: t.status, waitingOnClient: t.waitingOnClient }, { waitingOnClient: t.waitingOnClient }) }));
    setTasks((ts) => [...ts, ...synced]);
    const write = () => synced.forEach((t) => upsertTask(t, me.id));
    if (projectWrite) projectWrite.then(write); else write();
    setBulkAddOpen(false);
    pushToast(`Created ${synced.length} task${synced.length === 1 ? "" : "s"}`);
    synced.forEach((t) => { if (t.assigneeId && t.assigneeId !== me.id) notify(t.assigneeId, `${me.name} assigned you “${t.title}”`, t.id); });
  };
  const regenerateAiSummary = async (clientId: string) => {
    setAiSummaryBusyId(clientId);
    try {
      const res = await authedFetch("/api/ai/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "AI summary failed.");
      setClients((cs) => cs.map((x) => (x.id === clientId ? { ...x, aiSummary: j.summary, aiSummaryAt: j.generatedAt } : x)));
      // Log it into the Chat journal too, not just the AI tab's single
      // overwritable field — this is what makes the journal an actual
      // history instead of losing every prior summary on regenerate.
      addNote(clientId, "ai_summary", j.summary);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "AI summary failed.");
    } finally {
      setAiSummaryBusyId(null);
    }
  };
  // Drafts a client-facing status update via Gemini — fills the composer's
  // subject/body, never sends. Send is independently gated by
  // canMessageClient regardless of what this returns.
  const [draftingMessage, setDraftingMessage] = useState(false);
  const draftMessage = async (clientId: string, channel: MessageChannel, prompt?: string, projectId?: string | null): Promise<{ subject?: string; body: string } | null> => {
    setDraftingMessage(true);
    try {
      const res = await authedFetch("/api/ai/draft-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, channel, prompt, projectId: projectId ?? undefined }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to draft message."); return null; }
      return { subject: j.subject, body: j.body };
    } catch {
      pushToast("Failed to draft message.");
      return null;
    } finally {
      setDraftingMessage(false);
    }
  };
  // Same pattern for the task description — Gemini drafts, never saves.
  const [draftingDescription, setDraftingDescription] = useState(false);
  const draftDescription = async (title: string, description: string, prompt?: string): Promise<string | null> => {
    setDraftingDescription(true);
    try {
      const res = await authedFetch("/api/ai/draft-description", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: openTask?.clientId, title, description, prompt }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to draft description."); return null; }
      return j.body ?? null;
    } catch {
      pushToast("Failed to draft description.");
      return null;
    } finally {
      setDraftingDescription(false);
    }
  };
  // Background tidy-up for a title someone typed as a whole paragraph. Fired
  // and forgotten right after a task is created, never awaited: task creation
  // is a straight client to Supabase write with no server round trip, and it
  // stays that way. The task is already on screen before this even starts.
  //
  // Deliberately silent on every failure path. Nobody asked for this and
  // nobody is waiting on it, so a Gemini timeout, a parse miss, or a title
  // that came back unchanged all end with the task exactly as typed. The one
  // thing worth a toast is success, because a title rewriting itself a second
  // after you hit enter looks like a bug unless something says otherwise.
  const maybeCleanupTaskTitle = (taskId: string, title: string, description: string) => {
    if (title.trim().length <= LONG_TITLE_THRESHOLD) return;
    void (async () => {
      try {
        const res = await authedFetch("/api/ai/cleanup-task-title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) return;
        const cleaned = typeof j.title === "string" ? j.title.trim() : "";
        if (!cleaned || cleaned === title.trim()) return;
        // Re-read the task rather than trusting the values we sent: the user
        // has had a few seconds with it and may have renamed it, written a
        // description, or deleted it outright. Any of those means our answer
        // is stale, so leave their version alone.
        const current = tasksRef.current.find((t) => t.id === taskId);
        if (!current || current.title !== title) return;
        const extracted = typeof j.description === "string" ? j.description.trim() : "";
        const patch: Partial<Task> = { title: cleaned };
        // Append, never overwrite — the extracted detail is an addition to
        // whatever description the task already has, not a replacement for it.
        if (extracted) patch.description = current.description + plainTextToHtml(extracted);
        patchTask(taskId, patch);
        pushToast(extracted ? "Shortened the title, full text moved to the description" : "Cleaned up a long title");
      } catch {
        // Network dropped mid-request. Same as every other failure here: the
        // task keeps the title as typed and the user hears nothing about it.
      }
    })();
  };
  // Re-pulls one contact's info from GHL on demand — the bulk sync re-syncs
  // a whole sub-account (~30 sequential API calls for a big location), way
  // more than needed to check if one person's phone number changed.
  const [refreshingContact, setRefreshingContact] = useState(false);
  const refreshContact = async (contact: Contact) => {
    if (!contact.ghlContactId) { pushToast("This contact isn't linked to GoHighLevel."); return; }
    setRefreshingContact(true);
    try {
      // No locationId needed — the route tries every connected sub-account's
      // token itself, since a client's own ghlLocationId field is
      // unreliable for this (often empty, or repurposed as a company-name
      // label — see the route's comment). This is read-only, so trying
      // several tokens is safe.
      const res = await authedFetch("/api/ghl/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: contact.id, ghlContactId: contact.ghlContactId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to refresh contact."); return; }
      setContacts((cs) => cs.map((c) => (c.id === contact.id ? j.contact : c)));
      pushToast("Contact info refreshed.");
    } catch {
      pushToast("Failed to refresh contact.");
    } finally {
      setRefreshingContact(false);
    }
  };
  // Backfills any GHL messages our webhook never captured — messages is
  // realtime-subscribed, so genuinely new rows this inserts show up on their
  // own; no local state merge needed here.
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  // opts.silent: used by the auto-refresh-on-open-Interaction-task effect
  // below — still surfaces a toast when it actually finds something (that's
  // the whole point — "already handled elsewhere"), just skips the
  // no-op/error noise on every task open.
  const refreshMessages = async (clientId: string, contact: Contact, opts?: { silent?: boolean }) => {
    // ghlTargetForContact is declared later in this component; harmless in
    // practice (this only ever runs post-render, from a click handler or
    // the auto-refresh effect near openTask), same TDZ shape as other
    // cross-referencing helpers here.
    // eslint-disable-next-line react-hooks/immutability
    const target = ghlTargetForContact(contact);
    if (!target) { if (!opts?.silent) pushToast("No GoHighLevel connection for this client's sub-account."); return; }
    setRefreshingMessages(true);
    try {
      const res = await authedFetch("/api/ghl/refresh-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, contactId: contact.id, locationId: target.locationId, ghlContactId: target.ghlContactId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { if (!opts?.silent) pushToast(j.error || "Failed to refresh messages."); return; }
      if (j.inserted > 0) pushToast(`Found ${j.inserted} new message${j.inserted === 1 ? "" : "s"} — may already be handled.`);
      else if (!opts?.silent) pushToast("No new messages.");
    } catch {
      if (!opts?.silent) pushToast("Failed to refresh messages.");
    } finally {
      setRefreshingMessages(false);
    }
  };
  useEffect(() => {
    let localStarred: string[] = [];
    let localStarredLists: string[] = [];
    try {
      const s = localStorage.getItem("cut_clientSort"); if (s) setClientSort(s as ClientSort);
      const st = localStorage.getItem("cut_starred"); if (st) { localStarred = JSON.parse(st); setStarred(new Set(localStarred)); }
      const stl = localStorage.getItem("cut_starredLists"); if (stl) { localStarredLists = JSON.parse(stl); setStarredLists(new Set(localStarredLists)); }
      const fp = localStorage.getItem("cut_fabPos"); if (fp) setFabPos(JSON.parse(fp));
      const mo = localStorage.getItem("cut_clientOrder"); if (mo) setManualOrder(JSON.parse(mo));
      const he = localStorage.getItem("cut_hideEmpty"); if (he !== null) setHideEmpty(he === "1");
      const hd = localStorage.getItem("cut_hideDone"); if (hd !== null) setHideDone(hd === "1");
      const colo = localStorage.getItem("cut_colOrder"); if (colo) setColOrder(JSON.parse(colo));
      const cu = localStorage.getItem("cut_clientUsed"); if (cu) setClientUsed(JSON.parse(cu));
    } catch { /* fresh browser */ }
    // Pinned clients/lists used to live only in localStorage — invisible
    // from a cross-origin iframe (the app loaded as a GHL custom menu link
    // gets its own partitioned storage, even though the same login/session
    // works fine there). DB-backed now (see supabase/pins.sql); this is the
    // one-time migration off localStorage, run from whichever context still
    // has the old values, so nobody's existing pins just vanish.
    (async () => {
      try {
        const res = await authedFetch("/api/pins");
        if (!res.ok) return;
        const j = await res.json();
        const dbStarred: string[] = j.starredClientIds ?? [];
        const dbStarredLists: string[] = j.starredListIds ?? [];
        if (dbStarred.length || dbStarredLists.length) {
          setStarred(new Set(dbStarred));
          setStarredLists(new Set(dbStarredLists));
        } else if (localStarred.length || localStarredLists.length) {
          authedFetch("/api/pins", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ starredClientIds: localStarred, starredListIds: localStarredLists }),
          }).catch(() => {});
        }
      } catch { /* pins fetch is best-effort; localStorage values (if any) stay as the local fallback */ }
    })();
  }, []);
  // Stamp a client's last-opened time whenever it becomes the active client,
  // by any path (sidebar, ⌘K, board, deep link) — so "Recently used" ordering
  // reflects real use without threading a call through every open site.
  useEffect(() => {
    if (!activeClient.startsWith("cl_")) return;
    setClientUsed((m) => { const n = { ...m, [activeClient]: Date.now() }; try { localStorage.setItem("cut_clientUsed", JSON.stringify(n)); } catch {} return n; });
  }, [activeClient]);
  const toggleHideEmpty = () => setHideEmpty((v) => { const n = !v; try { localStorage.setItem("cut_hideEmpty", n ? "1" : "0"); } catch {} return n; });
  const toggleHideDone = () => setHideDone((v) => { const n = !v; try { localStorage.setItem("cut_hideDone", n ? "1" : "0"); } catch {} return n; });
  const saveClientSort = (v: ClientSort) => { setClientSort(v); try { localStorage.setItem("cut_clientSort", v); } catch {} };
  // localStorage write kept alongside the DB one — harmless, and it's what
  // still seeds `starred` synchronously on the very next mount before the
  // /api/pins fetch above resolves.
  const toggleStar = (id: string) => setStarred((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem("cut_starred", JSON.stringify([...n])); } catch {}
    authedFetch("/api/pins", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starredClientIds: [...n] }) }).catch(() => {});
    return n;
  });
  const toggleStarList = (id: string) => setStarredLists((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem("cut_starredLists", JSON.stringify([...n])); } catch {}
    authedFetch("/api/pins", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starredListIds: [...n] }) }).catch(() => {});
    return n;
  });
  const [drawerFull, setDrawerFull] = useState(false);
  useEffect(() => { try { setDrawerFull(localStorage.getItem("cut_drawerFull") === "1"); } catch {} }, []);
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
    view: settingsView ? "settings" : dirView ?? (myWork ? "work" : personalView ? "personal" : inboxView ? "inbox" : null),
    client: activeClient, project: activeProject, task: openTaskId,
    clientTab, vaultFolder: null, // vaultFolder is write-only (via copyFolderLink) — not mirrored into the live URL as you browse
    dm: inboxView ? dmUserId : null,
  });
  const applyNav = (s: NavState) => {
    setSettingsView(s.view === "settings");
    setMyWork(s.view === "work"); setPersonalView(s.view === "personal"); setInboxView(s.view === "inbox");
    setDmUserId(s.view === "inbox" ? s.dm : null);
    setDirView(s.view === "clients" || s.view === "projects" ? s.view : null);
    setActiveClient(s.view ? "all" : s.client); setActiveProject(s.view ? null : s.project);
    setOpenTaskId(s.task);
    if (s.clientTab) setClientTab(s.clientTab);
    setInitialVaultFolder(s.vaultFolder);
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
  }, [settingsView, dirView, myWork, personalView, inboxView, activeClient, activeProject, openTaskId, clientTab, dmUserId]);
  // Back/forward → state.
  useEffect(() => {
    const onPop = () => applyNav(parseSearch(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const toggleDrawerFull = () => setDrawerFull((f) => { const v = !f; try { localStorage.setItem("cut_drawerFull", v ? "1" : "0"); } catch {} return v; });
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdkOpen(true); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Jump to a top-level view with a single number key — 1 Dashboard,
  // 2 Clients, 3 Projects, 4 Personal, 5 Team.
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
  useEffect(() => { goToViewRef.current = goToView; });
  // Don't navigate out from under something that's asking for an answer —
  // a confirm dialog, the link editor, or the command palette.
  useEffect(() => { navBlockedRef.current = !!confirmDialog || !!linkModal || cmdkOpen; }, [confirmDialog, linkModal, cmdkOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (navBlockedRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
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
  useEffect(() => { try { setSidebarHidden(localStorage.getItem("cut_sidebarHidden") === "1"); } catch {} }, []);
  // Theme: light/dark/auto, persisted as cut_theme. Auto resolves off the
  // clock (dark 19:00–6:59) rather than prefers-color-scheme — there's no
  // OS-level dark-mode signal in play here, just "dim it in the evening".
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cut_theme");
      if (saved === "light" || saved === "dark" || saved === "auto") setTheme(saved);
    } catch {}
  }, []);
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
  const navVisible: Record<string, boolean> = { inbox: true, work: true, personal: true };
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
        setClients(d.clients); setProjects(d.projects); setContacts(d.contacts); setTasks(d.tasks); setNotifications(d.notifications);
        setClientLinks(d.clientLinks); setClientNotes(d.clientNotes); setMessages(d.messages);
        setTaskTemplates(d.taskTemplates);
        setPlaybooks(d.playbooks);
        setVaultFolders(d.vaultFolders);
        setFolders(d.folders);
        setStages(d.stages);
        setTeamMessages(d.teamMessages);
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
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = (id: string) => clientsById.get(id) ?? null;
  const projectById = (id: string) => projectsById.get(id) ?? null;
  const contactById = (id: string | null) => contacts.find((c) => c.id === id) ?? null;

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";
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
  };
  const dismissToast = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  // Copy a shareable deep link (see buildSearch) to the clipboard.
  const copyLink = (nav: NavState) => {
    const url = `${window.location.origin}${window.location.pathname}${buildSearch(nav)}`;
    navigator.clipboard?.writeText(url).then(() => pushToast("🔗 Link copied"), () => pushToast("⚠️ Couldn't copy link"));
  };
  // A folder link is just the current client/project link with tab=chat
  // and folder=<id> layered on — built fresh at click time, not mirrored
  // into the live URL bar as you browse (see currentNav's vaultFolder note).
  const copyFolderLink = (folderId: string) => copyLink({ ...currentNav(), view: null, clientTab: "chat", vaultFolder: folderId });
  // Public "here's what we need from you" link for this client — see
  // supabase/client-share-token.sql. Unlike copyLink above, this is a share
  // link, not an app deep-link: it needs to keep working (and copy to the
  // same URL) every time it's clicked, so the token is generated once and
  // reused, not regenerated per click. crypto.randomUUID() is fine here —
  // this only needs to be unguessable, not secret from the browser that's
  // about to hand it to the client.
  // projectId is optional — when given, the copied link opens pre-switched
  // to that one list (the public page's own project switcher) instead of
  // the client's merged view. Still the exact same token underneath: a
  // client with several projects gets ONE link to hand out (or bookmark),
  // not a separate one to track per list — the ?project= param is just a
  // convenience starting point, copyable from any project's own menu.
  // Core of copyClientShareLink below, factored out so the task email
  // composer (auto-populating a client link in the draft) can mint/reuse the
  // same token without going through the clipboard. Returns null (and toasts)
  // when a non-admin hits a client with no token yet — same refusal as before.
  const getClientShareUrl = (clientId: string, opts?: { projectId?: string; taskId?: string }): string | null => {
    const c = clientById(clientId);
    if (!c) return null;
    // "Personal" is a pseudo-client every teammate's private tasks share (see
    // PERSONAL_CLIENT_ID) — minting a share token for it would publish every
    // teammate's private list on the public waiting page, since that page
    // selects tasks by client_id. There is no legitimate client to hand this
    // link to, so it's refused outright rather than gated on admin.
    if (clientId === PERSONAL_CLIENT_ID) { pushToast("Personal tasks can't be shared."); return null; }
    if (!c.shareToken && !canAdmin) { pushToast("Ask an admin to create this client's share link first."); return null; }
    const token = c.shareToken ?? crypto.randomUUID().replace(/-/g, "");
    if (!c.shareToken) {
      const nc = { ...c, shareToken: token };
      setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
      markOwnClientWrite(nc.id);
      upsertClient(nc);
    }
    const params = new URLSearchParams();
    if (opts?.projectId) params.set("project", opts.projectId);
    if (opts?.taskId) params.set("task", opts.taskId);
    const qs = params.toString();
    return `${window.location.origin}/waiting/${token}${qs ? `?${qs}` : ""}`;
  };
  // Public "here's what we need from you" link for this client — see
  // supabase/client-share-token.sql. Unlike copyLink above, this is a share
  // link, not an app deep-link: it needs to keep working (and copy to the
  // same URL) every time it's clicked, so the token is generated once and
  // reused, not regenerated per click. crypto.randomUUID() is fine here —
  // this only needs to be unguessable, not secret from the browser that's
  // about to hand it to the client.
  // projectId is optional — when given, the copied link opens pre-switched
  // to that one list (the public page's own project switcher) instead of
  // the client's merged view. Still the exact same token underneath: a
  // client with several projects gets ONE link to hand out (or bookmark),
  // not a separate one to track per list — the ?project= param is just a
  // convenience starting point, copyable from any project's own menu.
  const copyClientShareLink = (clientId: string, projectId?: string) => {
    const url = getClientShareUrl(clientId, { projectId });
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => pushToast(projectId ? "🔗 List link copied — opens straight to this list" : "🔗 Client link copied — shows what we're waiting on them for"),
      () => pushToast("⚠️ Couldn't copy link"),
    );
  };
  // Real per-project link (see supabase/project-share-token.sql) — a
  // DIFFERENT token from the client's own, not a query param on it. Every
  // /api/waiting/[token]/* lookup scopes to this project's id the moment it
  // resolves the token, so there is nothing else for the recipient to reach
  // regardless of what they click or edit in the URL — unlike
  // copyClientShareLink(clientId, projectId) above, whose ?project= is only
  // a starting view within the full client link. Same mint-once-reuse shape
  // as getClientShareUrl (Derek: emailing a list link to outside reviewers
  // was leaking every other list on the client).
  const getProjectShareUrl = (projectId: string): string | null => {
    const p = projectById(projectId);
    if (!p) return null;
    if (!p.shareToken && !canAdmin) { pushToast("Ask an admin to create this list's share link first."); return null; }
    const token = p.shareToken ?? crypto.randomUUID().replace(/-/g, "");
    if (!p.shareToken) {
      const np = { ...p, shareToken: token };
      setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
      upsertProject(np);
    }
    return `${window.location.origin}/waiting/${token}`;
  };
  const copyProjectShareLink = (projectId: string) => {
    const url = getProjectShareUrl(projectId);
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => pushToast("🔗 List link copied — only this list, nothing else on the client"),
      () => pushToast("⚠️ Couldn't copy link"),
    );
  };
  // Surfaces every failed background save (see db.ts logErr) so a dropped
  // connection is never silent — was previously console.error-only.
  useEffect(() => {
    const onSaveError = () => pushToast("⚠️ Couldn't save — check your connection and reload.");
    window.addEventListener("cut:save-error", onSaveError);
    return () => window.removeEventListener("cut:save-error", onSaveError);
  }, []);

  // Live sync — tasks/clients/notifications only (see supabase/realtime.sql
  // + the plan doc for why not all 7 tables). Gated on !loading so the
  // channel isn't stood up before the initial fetchAll() populates state.
  // Every handler uses raw setXxx — never update()/patchTask()/addComment()/
  // notify() — so an incoming teammate's change never re-derives a diff
  // against local state and never double-fires GHL sync or notifications.
  useEffect(() => {
    if (loading || !supabaseReady) return;
    const unsub = subscribeRealtime({
      onTask: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setTasks((ts) => ts.filter((t) => t.id !== id));
          return;
        }
        const row = p.new;
        // Every server-side write (client portal response, inbound email/SMS,
        // owner Playbook completion) must send updated_by: null. Without it
        // this stays pinned to whichever rep last touched the row from the
        // browser, so a real client reply gets silently dropped by this check
        // as if it were an echo of that rep's own edit — and their next save
        // then overwrites the reply that was never applied locally.
        if (row.updated_by && row.updated_by === me.id) return; // server-confirmed own write
        const t = rowToTask(row);
        setTasks((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]));
      },
      onClient: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          // Cascade purge for teammates who only got the `clients` DELETE
          // event — contacts/projects/client_links aren't in the publication,
          // so no CDC event arrives for them independently. client_notes IS
          // published now, so its own cascade-delete rows emit their own CDC
          // events too (Postgres FK cascades are per-row under the hood) —
          // this purge is a harmless, redundant backstop for it, not load-bearing.
          setClients((cs) => cs.filter((c) => c.id !== id));
          setProjects((ps) => ps.filter((p2) => p2.clientId !== id));
          setTasks((ts) => ts.filter((t) => t.clientId !== id));
          setClientLinks((ls) => ls.filter((l) => l.clientId !== id));
          setClientNotes((ns) => ns.filter((n) => n.clientId !== id));
          setActiveClient((a) => (a === id ? "all" : a));
          return;
        }
        const row = p.new;
        if (isOwnClientEcho(row.id as string)) return;
        const c = rowToClient(row);
        setClients((cs) => (cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? c : x)) : [...cs, c]));
      },
      onNotification: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setNotifications((ns) => ns.filter((n) => n.id !== id));
          return;
        }
        const n = rowToNotif(p.new);
        setNotifications((ns) => (ns.some((x) => x.id === n.id) ? ns.map((x) => (x.id === n.id ? n : x)) : [n, ...ns]));
      },
      // No echo suppression needed: an own-write (send, admin edit, or
      // delete) just re-writes/removes the same array slot via the id-based
      // dedup below, same effect as a remote change landing here.
      onMessage: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setMessages((ms) => ms.filter((m) => m.id !== id));
          return;
        }
        const m = rowToMessage(p.new);
        setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms.map((x) => (x.id === m.id ? m : x)) : [...ms, m]));
      },
      // Same reasoning as messages: a note is only ever fully rewritten on an
      // explicit Save click (not keystroke-driven like a task title), so
      // id-based dedup is enough — no updated_by/echo-suppression column needed.
      onClientNote: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setClientNotes((ns) => ns.filter((n) => n.id !== id));
          return;
        }
        const n = rowToClientNote(p.new);
        setClientNotes((ns) => (ns.some((x) => x.id === n.id) ? ns.map((x) => (x.id === n.id ? n : x)) : [n, ...ns]));
      },
      // Same reasoning as messages/client_notes: append-only, so id dedup covers it.
      onTeamMessage: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setTeamMessages((ms) => ms.filter((m) => m.id !== id));
          return;
        }
        const m = rowToTeamMessage(p.new);
        setTeamMessages((ms) => (ms.some((x) => x.id === m.id) ? ms.map((x) => (x.id === m.id ? m : x)) : [...ms, m]));
      },
      // Same reasoning as team_messages: append-only, so id dedup covers it.
      onDmMessage: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setDmMessages((ms) => ms.filter((m) => m.id !== id));
          return;
        }
        const m = rowToDmMessage(p.new);
        setDmMessages((ms) => (ms.some((x) => x.id === m.id) ? ms.map((x) => (x.id === m.id ? m : x)) : [...ms, m]));
      },
      onStatusChange: (s) => { if (s === "CHANNEL_ERROR") pushToast("⚠️ Live updates interrupted — reconnecting…"); },
    });
    return unsub;
  }, [loading, me.id]);

  // Fallback for the 2 tables without a live subscription (contacts/projects/
  // client_links), and a reconnection safety net for the 5 that do —
  // postgres_changes has no replay/resume, and browsers commonly suspend
  // backgrounded WebSocket connections, so a dropped socket means silently
  // missed events, not queued ones. Reuses fetchAll() for the data.
  //
  // tasks/clients/notifications/messages/client_notes are merged (add/update
  // by id), NEVER wholesale-replaced: their deletions are already fully
  // covered by the live realtime DELETE handlers above, so this fallback has
  // no need to remove anything for them — and a wholesale replace here was
  // actively dangerous: any transient gap between this fetch's snapshot and a
  // very recent local write could wipe a real, just-saved task (or chat
  // message) out of view even though it was safely in the database.
  // contacts/projects/client_links have no realtime coverage at all, so they
  // still need a full replace (including removals) to reflect deletes.
  useEffect(() => {
    let lastRefetch = 0;
    const refetch = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefetch < 20000) return;
      lastRefetch = Date.now();
      try {
        const d = await fetchAll();
        const mergeById = <T extends { id: string }>(prev: T[], incoming: T[]) => {
          const byId = new Map(prev.map((x) => [x.id, x]));
          incoming.forEach((x) => byId.set(x.id, x));
          return [...byId.values()];
        };
        setContacts(d.contacts); setClientLinks(d.clientLinks); setProjects(d.projects);
        setTasks((prev) => mergeById(prev, d.tasks));
        setClients((prev) => mergeById(prev, d.clients));
        setNotifications((prev) => mergeById(prev, d.notifications));
        setMessages((prev) => mergeById(prev, d.messages));
        setClientNotes((prev) => mergeById(prev, d.clientNotes));
        setVaultFolders((prev) => mergeById(prev, d.vaultFolders));
        setFolders((prev) => mergeById(prev, d.folders));
        setStages((prev) => mergeById(prev, d.stages));
        setTeamMessages((prev) => mergeById(prev, d.teamMessages));
        setDmMessages((prev) => mergeById(prev, d.dmMessages));
      } catch (e) { console.warn("[realtime] visibility refetch failed", e); }
    };
    document.addEventListener("visibilitychange", refetch);
    window.addEventListener("focus", refetch);
    return () => { document.removeEventListener("visibilitychange", refetch); window.removeEventListener("focus", refetch); };
  }, []);

  // Best-effort email companion to ANY in-app notification — the bell above
  // already fired, so a failure here (Google not configured, non-Workspace
  // sender, send error) is swallowed rather than surfaced. Generic version of
  // the older mention-only path (see sendMentionEmail below, which still
  // covers the one case — task-comment mentions — that has a richer,
  // quoted-comment email of its own).
  const sendNotificationEmail = (recipientMemberId: string, subject: string, link: string | undefined, kind: NotificationKind) => {
    authedFetch("/api/notifications/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientMemberId, subject, link, kind }),
    }).catch(() => {});
  };

  // kind defaults to "activity" (automatic side-effect notice) — call sites
  // for a direct human communication (an @mention or comment) pass
  // kind: "message" explicitly, so the Inbox can filter the two apart.
  // skipEmail is set only by the one call site that already fires its own
  // richer, quoted-comment email (sendMentionEmail, task-comment mentions) —
  // every other notification gets this plain generic email automatically.
  const notify = (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean; link?: string }) => {
    // A private task's title must never leave its owner. RLS keeps the task row
    // itself unreadable, but notification text is plain and unprotected, and it
    // doubles as the EMAIL SUBJECT — so without this, marking a personal task
    // done mailed its title to every admin, who then couldn't open the task the
    // mail pointed at. Guarding here rather than at each call site so no future
    // notify() can reintroduce it. Optional chaining is deliberate: a taskId we
    // can't resolve locally is treated as not-private, not as private.
    const nt = taskId ? tasksRef.current.find((x) => x.id === taskId) : null;
    if (nt?.private && recipientId !== nt.assigneeId) return;
    const n: Notification = { id: newId("n_"), recipientId, text, taskId, actorId: me.id, clientId: extra?.clientId ?? null, projectId: extra?.projectId ?? null, at: new Date().toISOString(), read: false, kind: extra?.kind ?? "activity" };
    setNotifications((ns) => [n, ...ns]);
    insertNotif(n);
    if (!extra?.skipEmail) {
      // extra.link wins: a caller with no task or client to point at (Team
      // Chat) would otherwise send an email whose only link is the app root.
      const link = extra?.link ?? (taskId ? `?task=${encodeURIComponent(taskId)}` : extra?.clientId ? `?client=${encodeURIComponent(extra.clientId)}` : undefined);
      sendNotificationEmail(recipientId, text, link, extra?.kind ?? "activity");
    }
  };

  // Best-effort email companion to an @mention notification — the in-app
  // bell above already fired, so a failure here (Google not configured,
  // non-Workspace sender, send error) is swallowed rather than surfaced.
  const sendMentionEmail = (recipientMemberId: string, taskId: string, taskTitle: string, commentBody: string) => {
    authedFetch("/api/notifications/mention-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientMemberId, taskId, taskTitle, commentBody }),
    }).catch(() => {});
  };

  const myNotifs = notifications.filter((n) => n.recipientId === me.id);
  const unread = myNotifs.filter((n) => !n.read).length;
  // A live comment/mention thread is easy to miss since notifications aren't
  // reliably checked — surfaced separately from the bell, as its own
  // top-of-list group/sort-boost (see buildGroups/sortTasks below), above
  // even Urgent priority.
  const hasUnreadReply = (t: Task) => notifications.some((n) => n.taskId === t.id && n.recipientId === me.id && n.kind === "message" && !n.read);
  // Notifications otherwise only get marked read via the bell dropdown —
  // since the whole point of the "Needs your reply" boost is that
  // notifications aren't reliably checked, actually opening the task itself
  // should clear it too.
  const markTaskNotifsRead = (taskId: string) => {
    const ids = notifications.filter((n) => n.taskId === taskId && n.recipientId === me.id && n.kind === "message" && !n.read).map((n) => n.id);
    if (!ids.length) return;
    setNotifications((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    ids.forEach((id) => markNotifReadDb(id));
  };

  const passesFilters = (t: Task) =>
    (filters.status === "all" || t.status === filters.status) &&
    (filters.assignee === "all" || (filters.assignee === "waiting" ? !!t.waitingOnClient : filters.assignee === "unassigned" ? (t.assigneeId === null && !t.waitingOnClient) : t.assigneeId === filters.assignee)) &&
    (filters.priority === "all" || t.priority === filters.priority) &&
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

  const sortTasks = (list: Task[]) => {
    const arr = [...list];
    if (sortBy === "manual") return hoistPinned(arr);
    const dir = sortDir === "desc" ? -1 : 1;
    if (sortBy === "due") arr.sort((a, b) => ((a.due ?? "9999").localeCompare(b.due ?? "9999")) * dir);
    else if (sortBy === "priority") arr.sort((a, b) => {
      // A live reply thread outranks every priority tier. Derived from the
      // table rather than hardcoded — it used to be a literal 4, which
      // silently became a TIE when "client_request" was added at rank 4.
      const unreadRank = Math.max(...Object.values(PRIORITY_META).map((m) => m.rank)) + 1;
      const rank = (t: Task) => (hasUnreadReply(t) ? unreadRank : PRIORITY_META[t.priority].rank);
      return (rank(b) - rank(a)) * dir;
    });
    else if (sortBy === "title") arr.sort((a, b) => a.title.localeCompare(b.title) * dir);
    else if (sortBy === "status") arr.sort((a, b) => (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * dir);
    else if (sortBy === "assignee") arr.sort((a, b) => ((userById(a.assigneeId)?.name ?? "~").localeCompare(userById(b.assigneeId)?.name ?? "~")) * dir);
    else if (sortBy === "comments") arr.sort((a, b) => (b.comments.length - a.comments.length) * dir);
    // Oldest first when ascending — "what has been sitting longest" is the
    // question a Created sort is asked to answer.
    else if (sortBy === "created") arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt) * dir);
    return hoistPinned(arr);
  };
  // Pull the just-added tasks to the front, in the order they were pinned
  // (newest first, so each new one lands directly under the Add task row).
  // Order-preserving for everything else, and a no-op once nothing is pinned.
  function hoistPinned(arr: Task[]): Task[] {
    if (pinnedIds.length === 0) return arr;
    const pinned = pinnedIds.map((id) => arr.find((t) => t.id === id)).filter((t): t is Task => !!t);
    if (pinned.length === 0) return arr;
    const pinnedSet = new Set(pinned.map((t) => t.id));
    return [...pinned, ...arr.filter((t) => !pinnedSet.has(t.id))];
  }
  const sortByCol = (key: string) => {
    const map: Record<string, SortBy> = { priority: "priority", assignee: "assignee", due: "due", task: "title", status: "status", comments: "comments", created: "created" };
    const sb = map[key] ?? "manual";
    if (sortBy === sb) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(sb); setSortDir("asc"); }
  };
  const toggleCol = (key: string) => setVisibleCols((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));

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
    () => (canAdmin ? tasks : tasks.filter((t) => t.assigneeId === me.id)),
    [tasks, canAdmin, me.id]
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
  const assignedClientsFor = (userId: string) => workableClients.filter((c) => (scopedTasksByClientId.get(c.id) ?? []).some((t) => t.status !== "done" && (t.assigneeId === userId || t.subtasks.some((s) => s.assigneeId === userId))) || (c.assignedTo ?? []).includes(userId));
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
  const assignedProjectsFor = (userId: string) => projects.filter((p) => (p.clientId === WORKSPACE_CLIENT_ID || p.clientId === PERSONAL_CLIENT_ID) && ((scopedTasksByProjectId.get(p.id) ?? []).some((t) => t.status !== "done" && (t.assigneeId === userId || t.subtasks.some((s) => s.assigneeId === userId))) || (p.assignedTo ?? []).includes(userId)));
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
  const completionLog = useMemo(() => {
    if (!(myWork && dashboardView === "completed")) return [];
    const rows: { id: string; taskId: string; taskTitle: string; clientId: string; clientName: string; authorId: string; authorName: string; authorColor: string; authorInitials: string; at: string }[] = [];
    for (const t of tasks) {
      if (t.clientId === PERSONAL_CLIENT_ID) continue; // personal to-dos aren't client work to review
      for (const c of t.comments) {
        if (c.kind !== "event" || !isCompletionEvent(c.body)) continue;
        const author = userById(c.authorId);
        rows.push({
          id: c.id, taskId: t.id, taskTitle: t.title, clientId: t.clientId, clientName: clientById(t.clientId)?.name ?? "—",
          authorId: c.authorId, authorName: author?.name ?? "Unknown", authorColor: author?.color ?? "#94a3b8", authorInitials: author?.initials ?? "?",
          at: c.at,
        });
      }
    }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return rows.slice(0, 300); // a running log, not a full export
  }, [myWork, dashboardView, tasks]);
  // Memoized for the same reason — the sidebar's "My Work" nav badge
  // (below) calls this inline on every render of every view, including
  // Team Chat, which is what made typing/sending there feel laggy even
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  function hasOpenConversationTask(clientId: string): boolean {
    return (scopedTasksByClientId.get(clientId) ?? []).some((t) => t.status !== "done" && t.priority === "conversation");
  }
  // The Review/Check-in tier (Derek + Justin, Jul 17): a client with open work
  // but nothing actually dated silently sinks to the bottom and gets
  // forgotten. This surfaces it at the very top instead — but resets, so it
  // doesn't nag forever:
  //  A) has open tasks, none dated (no due dates, no follow-up) AND not yet
  //     reviewed since this Monday → weekly review.
  //  B) a "nurture"-status client whose last review was >= NURTURE_CHECK_IN_DAYS
  //     ago (or never) → monthly relationship check-in, even with zero tasks.
  // Marking it reviewed (setClientReviewed) stamps reviewedAt=today, dropping
  // it out until next Monday / next cycle. Conversation-task clients are
  // excluded — they're already surfaced via the "New message" tier and are
  // actively being worked, not forgotten.
  function clientNeedsReview(clientId: string, forAssignee?: string): boolean {
    const c = clientById(clientId);
    if (!c) return false;
    if (hasOpenConversationTask(clientId)) return false;
    const open = (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    const hasAnyDate = open.some((t) => t.due);
    const reviewedThisWeek = !!c.reviewedAt && c.reviewedAt >= THIS_MONDAY;
    if (open.length > 0 && !hasAnyDate && !reviewedThisWeek) return true; // (A)
    if (c.status === "nurture" && (!c.reviewedAt || daysBetween(c.reviewedAt, TODAY) >= NURTURE_CHECK_IN_DAYS)) return true; // (B)
    // (C) Still waiting on the client for something. These were invisible on
    // every dashboard: going "waiting on client" unassigns the task (see
    // applyWaitingStatusSync), so it stops counting toward anyone's My Work
    // and nothing ever brings it back up. A thing you're blocked on is
    // exactly what a Monday review is for (Derek: "if we're waiting on a
    // client task it should pop up to review").
    //
    // Deliberately NOT scoped by forAssignee — a waiting task has no
    // assignee by construction, so scoping it would filter out every one of
    // them and this condition would never fire. The client is already in
    // this person's board via assignedClientsFor (an assigned task, or
    // following the client), so it can't leak someone else's work in.
    if (!reviewedThisWeek && waitingTasksFor(clientId).length > 0) return true;
    return false;
  }
  /** Open tasks this client owes us an answer on. Unassigned by construction,
   *  so every caller has to look them up deliberately rather than expecting
   *  them in an assignee-scoped list. */
  function waitingTasksFor(clientId: string): Task[] {
    return (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done" && t.waitingOnClient);
  }
  // Projects have no status, so only condition (A) applies — no nurture cadence.
  function projectNeedsReview(projectId: string, forAssignee?: string): boolean {
    const p = projectById(projectId);
    if (!p) return false;
    const open = (scopedTasksByProjectId.get(projectId) ?? []).filter((t) => t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    const hasAnyDate = open.some((t) => t.due);
    const reviewedThisWeek = !!p.reviewedAt && p.reviewedAt >= THIS_MONDAY;
    return open.length > 0 && !hasAnyDate && !reviewedThisWeek;
  }
  // Tier scheme (lower = more urgent, sorts first):
  //   0 Review · 1 New message · 2 Overdue · 3 Due today · 4 Due tomorrow ·
  //   5 Due this week · 6 Due next week · 7 Due this month · 8 Upcoming ·
  //   9 No due date · 10 No open tasks
  function tierForDate(soonest: string): number {
    if (soonest < TODAY) return 2;
    if (soonest === TODAY) return 3;
    if (soonest === TOMORROW) return 4;
    if (soonest <= THIS_WEEK_END) return 5;
    if (soonest <= NEXT_WEEK_END) return 6;
    if (soonest <= THIS_MONTH_END) return 7;
    return 8;
  }
  // forAssignee narrows "open tasks" to just that person's — used by the
  // personal My Work board, where a client's tier should reflect *my* tasks
  // there, not a teammate's. Omitted for the sidebar's "Overdue first" sort,
  // which is intentionally client-wide across every assignee.
  function clientUrgencyKey(clientId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    if (clientNeedsReview(clientId, forAssignee)) return { tier: 0, due: "", priorityRank: 0 };
    if (hasOpenConversationTask(clientId)) return { tier: 1, due: "", priorityRank: 0 };
    const open = (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    const candidates: { date: string; priorityRank: number }[] = open.filter((t) => t.due).map((t) => ({ date: t.due!, priorityRank: PRIORITY_META[t.priority].rank }));
    if (candidates.length === 0) {
      if (open.length === 0) return { tier: 10, due: "", priorityRank: 0 };
      return { tier: 9, due: "", priorityRank: Math.max(...open.map((t) => PRIORITY_META[t.priority].rank)) };
    }
    const soonest = candidates.reduce((a, b) => (b.date < a.date ? b : a)).date;
    const atSoonest = candidates.filter((c) => c.date === soonest);
    return { tier: tierForDate(soonest), due: soonest, priorityRank: Math.max(...atSoonest.map((c) => c.priorityRank)) };
  }
  // Same tiering as clientUrgencyKey, scoped to one project's tasks. No "New
  // message" tier — that's a client-level Conversation concept, not a
  // project one.
  function projectUrgencyKey(projectId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    if (projectNeedsReview(projectId, forAssignee)) return { tier: 0, due: "", priorityRank: 0 };
    const open = (scopedTasksByProjectId.get(projectId) ?? []).filter((t) => t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    const candidates: { date: string; priorityRank: number }[] = open.filter((t) => t.due).map((t) => ({ date: t.due!, priorityRank: PRIORITY_META[t.priority].rank }));
    if (candidates.length === 0) {
      if (open.length === 0) return { tier: 10, due: "", priorityRank: 0 };
      return { tier: 9, due: "", priorityRank: Math.max(...open.map((t) => PRIORITY_META[t.priority].rank)) };
    }
    const soonest = candidates.reduce((a, b) => (b.date < a.date ? b : a)).date;
    const atSoonest = candidates.filter((c) => c.date === soonest);
    return { tier: tierForDate(soonest), due: soonest, priorityRank: Math.max(...atSoonest.map((c) => c.priorityRank)) };
  }
  // A personal to-do's own tier — no Review/New-message concept (those are
  // client/project-level), and it's always "open" if it's being shown at
  // all, so this is just tierForDate off its own due date, falling back to
  // tier 9 (no due date) same as clientUrgencyKey/projectUrgencyKey do.
  function taskUrgencyKey(task: Task): { tier: number; due: string; priorityRank: number } {
    if (!task.due) return { tier: 9, due: "", priorityRank: PRIORITY_META[task.priority].rank };
    return { tier: tierForDate(task.due), due: task.due, priorityRank: PRIORITY_META[task.priority].rank };
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
  // The Monday "set up your week" queue: my clients/projects currently in the
  // Review tier, in the same order My Work shows them. Drives the header
  // "Review next" button so you can click through them one at a time (the
  // interaction Derek wanted — open each, decide, advance) instead of hunting.
  // Memoized — reuses myAssignedClients/myAssignedProjects instead of
  // recalling assignedClientsFor/assignedProjectsFor from scratch, and only
  // reruns the clientNeedsReview/projectNeedsReview scan when the underlying
  // data changes rather than on every render.
  const reviewQueue: { kind: "client" | "project"; id: string }[] = useMemo(() => [
    ...myAssignedClients.filter((c) => clientNeedsReview(c.id, me.id)).map((c) => ({ kind: "client" as const, id: c.id })),
    ...myAssignedProjects.filter((p) => projectNeedsReview(p.id, me.id)).map((p) => ({ kind: "project" as const, id: p.id })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [myAssignedClients, myAssignedProjects, scopedTasks, clients, projects, me.id]);
  const goToNextReview = (afterClientId: string, afterProjectId: string | null) => {
    const curIdx = reviewQueue.findIndex((r) => (afterProjectId ? r.kind === "project" && r.id === afterProjectId : r.kind === "client" && r.id === afterClientId));
    // Wrap around so the last item's "next" loops back to the first still-
    // pending one; nothing left → let the caller know via a toast.
    const next = reviewQueue[(curIdx + 1) % reviewQueue.length] ?? reviewQueue[0];
    if (!next) { pushToast("Nothing left to review — all caught up. 🎉"); return; }
    if (next.kind === "project") { const pr = projectById(next.id); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(pr?.clientId ?? "all"); setActiveProject(next.id); }
    else { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(next.id); setActiveProject(null); }
    setClientTab("tasks");
    setOpenTaskId(null);
  };
  // Resolves the GHL contact backing a client: an explicit link (set via
  // "Link to GHL" for clients whose id isn't itself a contact id) wins;
  // otherwise fall back to the id-derived contact ("cl_" + contact id).
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
  // Tasks tab) UNLESS someone has actually made it active work — given it an
  // assignee or a due date. Untouched, it's just a checklist item living in
  // its own Playbook list; the moment either is set, it's real work and
  // should surface like any other task (Derek: "when we assign a task or a
  // due date it can then start to show up on all because it's active,
  // otherwise it sits there a checklist"). Once a specific project IS
  // selected, the existing t.projectId === activeProject check already
  // scopes correctly (only matches when that project happens to be the
  // Playbook one), so this only needs to guard the unscoped case.
  // Memoized — the main task list's hot path. With activeFolder set this
  // was O(scopedTasks × projects) every render (projectById is a linear
  // scan), and it feeds displayedGroups/vaultItems/Journal counts below.
  const baseTasks = useMemo(
    () => scopedTasks.filter((t) => t.clientId.startsWith("cl_") && (activeClient === "all" || t.clientId === activeClient) && (!activeProject || t.projectId === activeProject) && (!activeFolder || projectById(t.projectId)?.folderId === activeFolder) && (activeClient !== "all" || allTasksScope === "all" || t.assigneeId === me.id) && (!t.playbookStepKey || !!activeProject || !!t.assigneeId || !!t.due)),
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
  const renameVaultFolder = (folder: VaultFolder, name: string) => {
    const nf = { ...folder, name };
    setVaultFolders((fs) => fs.map((f) => (f.id === folder.id ? nf : f)));
    upsertVaultFolder(nf);
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
  const projectProgress = (projectId: string) => { const ts = scopedTasks.filter((t) => t.projectId === projectId); const done = ts.filter((t) => t.status === "done").length; return { done, total: ts.length, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 }; };
  // Open (non-done) count — matches what the client's task list actually shows
  // with "Hide done" on by default, so the sidebar/board badge and the list
  // never disagree about how many tasks "need attention".
  const clientTaskCount = (clientId: string) => (scopedTasksByClientId.get(clientId) ?? []).filter((t) => t.status !== "done").length;
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
  // Same idea as openClientPlaybook/openClientSales, for a business's other
  // (non-checklist) lists — no reconciliation needed, it's already a real list.
  const onOpenProject = (clientId: string, projectId: string) => {
 setActiveClient(clientId); setActiveProject(projectId); setClientTab("tasks");
  };
  // Owner Growth Plan tasks, bucketed by client — same one-pass-not-memoized
  // shape as openTasksByClient above, but WITHOUT the status==="done"
  // exclusion (playbookCompletion needs to see done steps too, to count them).
  // Memoized — one pass over the full unfiltered tasks table (~28k rows).
  const playbookTasksByClient = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.playbookStepKey) continue;
      const list = m.get(t.clientId);
      if (list) list.push(t); else m.set(t.clientId, [t]);
    }
    return m;
  }, [tasks]);
  // Owner Growth Plan — every client's Playbook is the SAME fixed catalog
  // (PLAYBOOK_STEPS), never a per-client copy. This is the one place that
  // keeps a client's real Task rows in sync with whatever the catalog
  // currently says: creates any step that doesn't have a task yet, and fixes
  // a task's title if the catalog's wording for that step has since changed.
  // Never touches status/assignee/due/comments — those are the ambassador's
  // own per-client progress. Idempotent — safe to call repeatedly. Called
  // both eagerly (the moment a business becomes a client, see
  // addClientContact/setClientStatus) and lazily (openClientPlaybook below),
  // so a pre-existing client self-heals to the current catalog instead of
  // needing a one-time bulk backfill across every business.
  const reconcilePlaybookTasks = (clientId: string) => {
    const pbProjectId = playbookProjectId(clientId);
    let projectWrite: PromiseLike<unknown> | null = null;
    if (!projects.some((p) => p.id === pbProjectId)) {
      const p: Project = { id: pbProjectId, clientId, name: "Playbook", description: "" };
      setProjects((ps) => [...ps, p]);
      projectWrite = upsertProject(p);
    }
    const byKey = new Map((playbookTasksByClient.get(clientId) ?? []).map((t) => [t.playbookStepKey as string, t]));
    const toWrite: Task[] = [];
    // The sales pipeline stages and the A2P/email-domain/ongoing side quests
    // all ride the same reconciliation as the main growth plan
    // (same project, same create/retitle logic) — they're just excluded from
    // playbookCompletion()'s total and rendered as their own groups
    // (buildPlaybookGroups below). A2P and email-domain additionally only
    // apply to a business that texts its list, hence playbookStepsForClient:
    // every other business was being handed five setup tasks it would never
    // do. Narrowing the catalog only affects what this loop CREATES (and
    // retitles): an A2P row already written for a business that turns out
    // not to text is simply left alone — never deleted, never hidden, still
    // in its group and still resolving its guide panel through
    // PLAYBOOK_STEP_BY_KEY, which stays the full catalog.
    const steps = playbookStepsForClient(clientById(clientId)?.doesA2P === true);
    for (const step of steps) {
      const existing = byKey.get(step.key);
      if (!existing) {
        toWrite.push({
          id: newId("t_"), projectId: pbProjectId, clientId, title: step.label, description: "",
          status: "todo", priority: "none", assigneeId: null, contactId: clientId.slice(3), due: null,
          recurrence: step.recurring ? "monthly" : "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
          playbookStepKey: step.key, createdBy: null,
        });
      } else if (existing.title !== step.label) {
        toWrite.push({ ...existing, title: step.label });
      }
    }
    if (!toWrite.length) return;
    const writeIds = new Set(toWrite.map((t) => t.id));
    setTasks((ts) => [...ts.filter((t) => !writeIds.has(t.id)), ...toWrite]);
    if (projectWrite) projectWrite.then(() => bulkUpsertTasks(toWrite));
    else bulkUpsertTasks(toWrite);
  };
  // The Playbook is standard on every contact, not just ones that came
  // through the claim flow (addClientContact/setClientStatus already
  // reconcile eagerly there) — this is what makes it "just show up" for a
  // plain agency client too: opening ANY real client's page reconciles its
  // Playbook, so a client added before this feature existed (or added
  // through some other path entirely) self-heals the first time anyone
  // actually looks at them, just with no special-cased entry point required
  // anymore.
  useEffect(() => {
    if (activeClient.startsWith("cl_") && activeClient !== WORKSPACE_CLIENT_ID) {
      reconcilePlaybookTasks(activeClient);
      // cascadeSalesStageCompletion only fires forward, on an actual Stage
      // dropdown change — a client already sitting at Claimed (or further)
      // from before that shipped never gets a transition to trigger it. This
      // is the same self-heal moment as the reconcile above: opening the
      // page catches the sales pipeline up to whatever the client's current
      // status already implies, so the backlog clears itself as reps browse
      // rather than needing a one-off migration or a re-click on a dropdown
      // that already shows the right value.
      const c = clientById(activeClient);
      if (c) cascadeSalesStageCompletion(activeClient, c.status);
    }
    // reconcilePlaybookTasks/cascadeSalesStageCompletion/clientById
    // intentionally excluded — all three are redefined every render (close
    // over live `tasks`/`projects`/`clients`), and including them here would
    // refire this effect every render instead of only on a real client
    // switch, which is the only time re-reconciling is meaningful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClient]);
  // Opens a business's Playbook the same way onOpenClient opens its Tasks —
  // reconciling first so a business that's never been looked at yet lands on
  // a fully caught-up list, not a stale/empty one.
  const openClientPlaybook = (clientId: string) => {
    reconcilePlaybookTasks(clientId);
 setActiveClient(clientId); setActiveProject(playbookProjectId(clientId)); setClientTab("tasks");
  };
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
  // Opening an Interaction task auto-pulls any reply sent directly in GHL's
  // own UI (not through this app) — the whole point being nobody wastes time
  // re-replying to something a teammate already answered elsewhere. Scoped
  // to Interaction tasks only (cheap, bounded — not every task open hits
  // GHL's API), silent unless it actually finds something new.
  useEffect(() => {
    if (!openTask || openTask.priority !== "conversation" || !openTask.contactId) return;
    const contact = contactById(openTask.contactId);
    if (!contact) return;
    // refreshMessages sets a loading flag synchronously; same pattern
    // already present elsewhere in this file (11 pre-existing instances),
    // not a new class of issue this component doesn't already have.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMessages(openTask.clientId, contact, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTaskId]);
  const filtersActive = filters.status !== "all" || filters.assignee !== "all" || filters.priority !== "all";
  const activeFilterCount = [filters.status !== "all", filters.assignee !== "all", filters.priority !== "all", sortBy !== "due"].filter(Boolean).length;

  // due-date buckets relative to the fixed "today" — "This week"/"Next week"
  // are calendar weeks starting Sunday, not rolling 7-day windows, so the
  // boundary always falls on a Saturday regardless of what day "today" is.
  // Shared with Follow Up's sales board (dueBucketOf/DUE_BUCKETS in data.ts)
  // so both read identically — My Work for active clients, Follow Up for
  // sales (Derek, 2026-08-11).
  const dueBucket = (t: Task) => dueBucketOf(t.due, t.status === "done");

  type Grp = { key: string; label: string; color: string; tasks: Task[] };
  const buildGroups = (list: Task[], dim: typeof groupBy = groupBy): Grp[] => {
    if (dim === "status") return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_META[s].label, color: STATUS_META[s].dot, tasks: list.filter((t) => t.status === s) }));
    if (dim === "priority") {
      const needsReply = list.filter(hasUnreadReply);
      const needsReplyIds = new Set(needsReply.map((t) => t.id));
      const rest = list.filter((t) => !needsReplyIds.has(t.id));
      const buckets = PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_META[p].label, color: PRIORITY_META[p].color, tasks: rest.filter((t) => t.priority === p) }));
      return needsReply.length ? [{ key: "needs_reply", label: "Needs your reply", color: "#0ea5e9", tasks: needsReply }, ...buckets] : buckets;
    }
    if (dim === "due") return DUE_BUCKETS.map((b) => ({ key: b.key, label: b.label, color: b.color, tasks: list.filter((t) => dueBucket(t) === b.key) }));
    return visibleProjects.map((p) => ({ key: p.id, label: p.name, color: clientById(p.clientId)?.color ?? "#94a3b8", tasks: list.filter((t) => t.projectId === p.id) }));
  };

  // Owner Growth Plan view: fixed Level sections (PLAYBOOK_PHASES), each in
  // catalog order (PLAYBOOK_STEPS) — never the caller's current sortBy/sortDir,
  // so the sequence can't drift no matter what column-sort is active elsewhere
  // in the app. Any non-step task that ends up in the Playbook project (a
  // one-off note an ambassador quick-added) still shows, under "Other", so
  // nothing silently disappears.
  // Sales stages first, so both maps below carry them: they're real step-tasks
  // in the same Playbook project, just kept out of the owner-facing
  // PLAYBOOK_ALL_STEPS (see SALES_STAGE_STEPS in data.ts). Without them here a
  // sales task would fall through to the "Other" bucket at the bottom.
  const playbookOrderedSteps = [...SALES_STAGE_STEPS, ...PLAYBOOK_ALL_STEPS];
  const stepPhase = new Map(playbookOrderedSteps.map((s) => [s.key, s.phase]));
  const stepOrder = new Map(playbookOrderedSteps.map((s, i) => [s.key, i]));
  // Every phase that isn't part of the owner's main growth-plan sequence gets
  // its own color, so a rep can tell the pipeline and the side quests apart
  // from the plan itself at a glance.
  const phaseColor: Record<string, string> = { sales: "#f59e0b", a2p: "#a855f7", email_domain: "#a855f7", ongoing: "#0ea5e9" };
  const buildPlaybookGroups = (list: Task[]): Grp[] => {
    const groupFor = (phase: { key: string; label: string }) => ({
      key: phase.key, label: phase.label, color: phaseColor[phase.key] ?? "#5c8ac4",
      tasks: list.filter((t) => t.playbookStepKey && stepPhase.get(t.playbookStepKey) === phase.key)
        .sort((a, b) => (stepOrder.get(a.playbookStepKey!) ?? 0) - (stepOrder.get(b.playbookStepKey!) ?? 0)),
    });
    // A2P + email-domain sit right after "Get on the map" (PLAYBOOK_PHASES[2] —
    // [0] is the sales pipeline, which runs first, then [1] "package") — "do
    // it early," per both source docs — not folded into the phase array itself
    // so playbookCompletion()'s "X of 25" total never counts them. The sales
    // stages DO live in PLAYBOOK_PHASES (they're core to the funnel, not
    // optional side work) but still stay out of that total, by living outside
    // PLAYBOOK_STEPS instead — see SALES_STAGE_STEPS in data.ts.
    // Monthly retention sits at the very end — an ongoing duty, not something
    // to front-load, and distinct from the fully-passive PLAYBOOK_ALWAYS_RUNNING
    // banner since it needs an ambassador to actually act on it each month.
    // Those two side quests are the only groups that can legitimately be
    // empty now that they're gated on Client.doesA2P — this list renders with
    // hideEmpty off (so a phase you've cleared still shows its heading), which
    // would otherwise leave a business that doesn't text staring at two
    // permanently blank sections. Dropped only when empty, so a client who
    // already has A2P rows from before the gate keeps seeing them.
    const sideQuest = [groupFor(PLAYBOOK_A2P_PHASE), groupFor(PLAYBOOK_EMAIL_DOMAIN_PHASE)].filter((g) => g.tasks.length > 0);
    const byPhase = [
      groupFor(PLAYBOOK_PHASES[0]), groupFor(PLAYBOOK_PHASES[1]), groupFor(PLAYBOOK_PHASES[2]), ...sideQuest,
      ...PLAYBOOK_PHASES.slice(3).map(groupFor),
      groupFor(PLAYBOOK_ONGOING_PHASE),
    ];
    // Latest activity first, same reasoning and same lastActivityAt field as
    // Follow Up's replyRows (Derek, 2026-08-11) — falls back to due (date-
    // only) for anything upsertConversationTask hasn't stamped.
    const extra = list.filter((t) => !t.playbookStepKey)
      .sort((a, b) => (b.lastActivityAt ?? b.due ?? "").localeCompare(a.lastActivityAt ?? a.due ?? ""));
    return extra.length ? [...byPhase, { key: "extra", label: "Other", color: "#94a3b8", tasks: extra }] : byPhase;
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

  const quickAdd = (groupKey: string, title: string) => {
    if (!title.trim() || !activeClient.startsWith("cl_")) return;
    let projectId: string;
    // tasks.project_id is a foreign key, so a task inserted in the same tick as
    // the project it belongs to can reach Postgres first and fail the
    // constraint ("Couldn't save"). When we create the list here, hold its
    // write and chain the task's insert behind it. Null when the project
    // already exists — nothing to wait for.
    let projectWrite: PromiseLike<unknown> | null = null;
    if (groupBy === "project") projectId = groupKey;
    // Scoped to one project? Add straight into it — otherwise the task lands in
    // some other project of this client and vanishes from the filtered view.
    else if (activeProject) projectId = activeProject;
    else {
      const existing = projects.find((p) => p.clientId === activeClient);
      if (existing) projectId = existing.id;
      else { const p: Project = { id: newId("p_"), clientId: activeClient, name: "Tasks", description: "" }; setProjects((ps) => [...ps, p]); projectWrite = upsertProject(p); projectId = p.id; }
    }
    const t: Task = {
      id: newId("t_"), projectId, clientId: activeClient, title: title.trim(), description: "",
      status: groupBy === "status" ? (groupKey as TaskStatus) : "todo",
      // isManuallyAssignable guards Conversation (auto-created-only, see
      // data.ts) — a quick-add inside that group still lands as "normal"
      // rather than manually assigning the reserved tier.
      priority: groupBy === "priority" && isManuallyAssignable(groupKey as Priority) ? (groupKey as Priority) : "normal",
      assigneeId: me.id,
      contactId: activeClient.slice(3),
      // Only set a due date when the group itself says so (adding straight
      // into the "Today"/"Tomorrow" due-date bucket) — anywhere else, no
      // due date is the correct default. A task with none is meant to
      // surface in the assignee's own no-due-date review, not get silently
      // pushed a day out and hidden from it.
      due: groupBy === "due" && groupKey === "today" ? TODAY : groupBy === "due" && groupKey === "tomorrow" ? TOMORROW : null,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
      createdBy: me.id,
    };
    pinJustAdded(t.id);
    setTasks((ts) => [...ts, t]);
    if (projectWrite) projectWrite.then(() => upsertTask(t, me.id));
    else upsertTask(t, me.id);
    maybeCleanupTaskTitle(t.id, t.title, t.description);
  };

  // Quick-add-task FAB: create a task for an explicitly-chosen client/list
  // (from the floating "+" modal). Mirrors quickAdd's Task shape and the
  // find-or-create-"Tasks"-list idiom; assignee = the creator.
  const createQuickTask = (clientId: string, projectId: string | null, title: string, due: string | null, priority: Priority) => {
    if (!title.trim() || !clientId.startsWith("cl_")) return;
    let pid = projectId ?? "";
    // Same foreign-key ordering as quickAdd above — see the comment there.
    let projectWrite: PromiseLike<unknown> | null = null;
    if (!pid) {
      const existing = projects.find((p) => p.clientId === clientId);
      if (existing) pid = existing.id;
      else { const p: Project = { id: newId("p_"), clientId, name: "Tasks", description: "" }; setProjects((ps) => [...ps, p]); projectWrite = upsertProject(p); pid = p.id; }
    }
    const t: Task = {
      id: newId("t_"), projectId: pid, clientId, title: title.trim(), description: "",
      status: "todo", priority: isManuallyAssignable(priority) ? priority : "none",
      assigneeId: me.id, contactId: clientId.slice(3), due,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
      createdBy: me.id,
    };
    setTasks((ts) => [...ts, t]);
    if (projectWrite) projectWrite.then(() => upsertTask(t, me.id));
    else upsertTask(t, me.id);
    maybeCleanupTaskTitle(t.id, t.title, t.description);
    pushToast(`Task added to ${clientById(clientId)?.name ?? "client"}.`);
  };

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

  const quickAddPersonal = (groupKey: string, title: string) => {
    if (!title.trim()) return;
    const t: Task = {
      id: newId("t_"), projectId: PERSONAL_PROJECT_ID, clientId: PERSONAL_CLIENT_ID, title: title.trim(), description: "",
      status: groupBy === "status" ? (groupKey as TaskStatus) : "todo",
      priority: "normal",
      assigneeId: me.id, contactId: null,
      // See quickAdd's identical comment — no due date outside the
      // Today/Tomorrow due-bucket context, so a plain new task can surface
      // in the no-due-date review instead of defaulting a day out.
      due: groupBy === "due" && groupKey === "today" ? TODAY : groupBy === "due" && groupKey === "tomorrow" ? TOMORROW : null,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: true, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
      createdBy: me.id,
    };
    pinJustAdded(t.id);
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
    maybeCleanupTaskTitle(t.id, t.title, t.description);
  };

  // --- mutations ------------------------------------------------------------

  const update = (id: string, patch: Partial<Task>) => {
    const cur = tasksRef.current.find((t) => t.id === id);
    // Keeps status:"waiting" and waitingOnClient in lockstep regardless of
    // which mutation path is used — setTaskStage (the Kanban drag handler)
    // patches status through here, bypassing patchTask entirely, so this
    // needs its own copy of the sync rather than relying on patchTask's.
    const synced = cur ? { ...patch, ...applyWaitingStatusSync(cur, patch) } : patch;
    // Recurrence also needs its own copy, for the same reason — dragging a
    // recurring task into a done-flagged Kanban stage went through here, not
    // patchTask, so it was marking the task done with no next occurrence
    // ever created (Derek: "check recurring tasks... are recreated
    // according to settings and not just marked done"). Same clone shape as
    // patchTask's own version below — kept in sync manually since this path
    // deliberately skips the event-comment logging patchTask also does.
    let clone: Task | null = null;
    if (cur && synced.status === "done" && cur.status !== "done" && cur.recurrence !== "none") {
      const nextDue = advanceDue(cur.due, cur.recurrence, cur.recurrenceInterval, cur.recurrenceUnit, cur.recurrenceDaysOfMonth, cur.recurrenceNth, cur.recurrenceWeekday);
      clone = { ...cur, id: newId("t_"), status: "todo", due: nextDue, subtasks: cur.subtasks.map((s) => ({ ...s, id: newId("s_"), done: false })), comments: [], attachments: [...cur.attachments], ghlTaskId: null };
      pushToast(`🔁 Recurring — next occurrence created for ${formatDue(nextDue)}`);
    }
    if (cur && synced.status === "done" && cur.status !== "done") keepDoneVisible(id);
    setTasks((ts) => { let next = ts.map((t) => (t.id === id ? { ...t, ...synced } : t)); if (clone) next = [...next, clone]; return next; });
    if (cur) { const merged = { ...cur, ...synced }; upsertTask(merged, me.id); syncGhlIfLinked(merged, patch); if (clone) upsertTask(clone, me.id); }
  };

  // Field changes on a task that are worth a line in its Activity feed. Stored
  // as kind:"event" comments (no schema change) so the existing JSONB column
  // and feed rendering carry them for free — excluded from comment counts.
  const describeFieldChange = (before: Task, patch: Partial<Task>): string[] => {
    const lines: string[] = [];
    if (patch.status && patch.status !== before.status) lines.push(`changed status from ${STATUS_META[before.status].label} to ${STATUS_META[patch.status].label}`);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
      if (!before.assigneeId && patch.assigneeId) lines.push(`assigned to ${userById(patch.assigneeId)?.name ?? "someone"}`);
      else if (before.assigneeId && !patch.assigneeId) lines.push(`unassigned (was ${userById(before.assigneeId)?.name ?? "someone"})`);
      else lines.push(`reassigned from ${userById(before.assigneeId!)?.name ?? "someone"} to ${userById(patch.assigneeId!)?.name ?? "someone"}`);
    }
    if (patch.due !== undefined && patch.due !== before.due) {
      if (!before.due && patch.due) lines.push(`set due date to ${formatDue(patch.due)}`);
      else if (before.due && !patch.due) lines.push(`cleared the due date (was ${formatDue(before.due)})`);
      else lines.push(`changed due date from ${formatDue(before.due)} to ${formatDue(patch.due!)}`);
    }
    if (patch.priority && patch.priority !== before.priority) lines.push(`changed priority from ${PRIORITY_META[before.priority].label} to ${PRIORITY_META[patch.priority].label}`);
    return lines;
  };

  const patchTask = (id: string, patch: Partial<Task>) => {
    const before = tasksRef.current.find((x) => x.id === id);
    if (!before) return;
    // Keeps status:"waiting" and waitingOnClient in lockstep — see update()'s
    // matching comment for why this can't just live in one place.
    const synced: Partial<Task> = { ...patch, ...applyWaitingStatusSync(before, patch) };
    const events = describeFieldChange(before, synced).map((body) => ({ id: newId("cm_"), authorId: me.id, body, at: new Date().toISOString(), kind: "event" as const }));
    const updated: Task = { ...before, ...synced, comments: events.length ? [...before.comments, ...events] : before.comments };
    let clone: Task | null = null;
    if (synced.status === "done" && before.status !== "done" && before.recurrence !== "none") {
      const nextDue = advanceDue(before.due, before.recurrence, before.recurrenceInterval, before.recurrenceUnit, before.recurrenceDaysOfMonth, before.recurrenceNth, before.recurrenceWeekday);
      clone = { ...before, id: newId("t_"), status: "todo", due: nextDue, subtasks: before.subtasks.map((s) => ({ ...s, id: newId("s_"), done: false })), comments: [], attachments: [...before.attachments], ghlTaskId: null };
      pushToast(`🔁 Recurring — next occurrence created for ${formatDue(nextDue)}`);
    }
    if (synced.status === "done" && before.status !== "done") keepDoneVisible(id);
    setTasks((prev) => { let next = prev.map((x) => (x.id === id ? updated : x)); if (clone) next = [...next, clone]; return next; });
    upsertTask(updated, me.id);
    syncGhlIfLinked(updated, synced);
    if (clone) upsertTask(clone, me.id);
    // Bumps clients.playbook_last_progress_at whenever a real Owner Growth
    // Plan step's status changes (done or reopened) — see playbookCheckinsServer.ts's
    // stall check, which uses this to tell "quiet because it's done" apart
    // from "quiet because it's stuck." The owner-toggle route bumps this
    // server-side for its own completion path.
    if (before.playbookStepKey && synced.status !== undefined && synced.status !== before.status) {
      touchPlaybookProgress(before.clientId);
    }
    if (patch.assigneeId && patch.assigneeId !== me.id && patch.assigneeId !== before.assigneeId) {
      notify(patch.assigneeId, `${me.name} assigned you “${before.title}”`, id);
      pushToast(`Notified ${userById(patch.assigneeId)?.name}`);
    }
    // Finishing work is worth surfacing to the rest of the team, not just silence.
    // The bell/Inbox row still fires for everyone here exactly as before — only
    // the companion EMAIL is suppressed. This branch fans out to every admin on
    // every Kanban drag, which made it the single loudest source of notification
    // mail; a status move is already visible on the board.
    //
    // PENDING DEREK'S DECISION: "Changes requested" is split out and still
    // emails the ASSIGNEE, on the theory that having your own work kicked back
    // is worth an inbox hit even though the rest of this branch isn't. The
    // admin fan-out is skipped for that status too. If he decides changes
    // requested shouldn't mail either, delete `keepEmail` and pass a flat
    // `{ skipEmail: true }`.
    if (synced.status && (synced.status === "review" || synced.status === "changes_requested" || synced.status === "done") && synced.status !== before.status) {
      users.filter((u) => u.id !== me.id && (u.role === "admin" || before.assigneeId === u.id)).forEach((u) => {
        const keepEmail = synced.status === "changes_requested" && u.id === before.assigneeId;
        notify(u.id, `${me.name} moved “${before.title}” to ${STATUS_META[synced.status as TaskStatus].label}`, id, { skipEmail: !keepEmail });
      });
    }
    // A due-date change is easy for the assignee to miss otherwise.
    if (patch.due !== undefined && patch.due !== before.due && before.assigneeId && before.assigneeId !== me.id) {
      notify(before.assigneeId, `${me.name} changed the due date on “${before.title}”`, id);
    }
  };

  const toggleTaskSelection = (id: string) => setSelectedTaskIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSelection = () => setSelectedTaskIds(new Set());
  // Reuses patchTask per task (not a raw update()) so a bulk change still
  // gets the same event-log comments, notifications, and GHL sync a single
  // edit would — just applied to every selected task at once.
  //
  // Every bulk edit is gated behind a confirm and hands back an undo. These
  // controls sit one careless click away from rewriting a whole list (picking
  // "Done" from the status dropdown used to fire instantly, with no warning
  // and no way back), and the blast radius scales with the selection.
  //
  // Undo snapshots only the keys being written, so reverting restores exactly
  // what changed and can't clobber edits made to other fields in between.
  const bulkPatch = (patch: Partial<Task>, summary: string) => {
    const ids = [...selectedTaskIds];
    if (!ids.length) return;
    const n = ids.length;
    const plural = n === 1 ? "" : "s";
    setConfirmDialog({
      title: `${summary} for ${n} task${plural}?`,
      message: `This updates all ${n} selected task${plural} at once. You can undo it right after.`,
      confirmLabel: `Update ${n} task${plural}`,
      danger: false,
      onConfirm: () => {
        const keys = Object.keys(patch) as (keyof Task)[];
        const before = ids
          .map((id) => {
            const t = tasksRef.current.find((x) => x.id === id);
            if (!t) return null;
            const prev: Partial<Task> = {};
            keys.forEach((k) => { (prev as Record<string, unknown>)[k] = t[k]; });
            return { id, prev };
          })
          .filter((x): x is { id: string; prev: Partial<Task> } => !!x);
        ids.forEach((id) => patchTask(id, patch));
        setConfirmDialog(null);
        clearSelection();
        pushToast(`${summary} for ${n} task${plural}`, {
          label: "Undo",
          run: () => {
            before.forEach(({ id, prev }) => patchTask(id, prev));
            pushToast(`Reverted ${before.length} task${before.length === 1 ? "" : "s"}`);
          },
        });
      },
    });
  };
  // Same confirm-then-undo-toast shape as bulkPatch above, but a real delete
  // has no undo — the toast just reports what happened, it doesn't offer one.
  // Locked checklist steps (Playbook/Sales) are silently skipped rather than
  // blocking the whole batch, same "defense in depth" reasoning as deleteTask
  // below; the confirm message says how many were skipped so it's never a
  // silent surprise.
  const bulkDelete = () => {
    const ids = [...selectedTaskIds];
    if (!ids.length) return;
    const deletable = ids.filter((id) => { const t = tasksRef.current.find((x) => x.id === id); return !!t && !t.playbookStepKey; });
    const skipped = ids.length - deletable.length;
    if (!deletable.length) { pushToast("Playbook/Sales steps can't be deleted."); return; }
    const n = deletable.length;
    setConfirmDialog({
      title: `Delete ${n} task${n === 1 ? "" : "s"}?`,
      message: `This can't be undone.${skipped ? ` ${skipped} selected Playbook/Sales step${skipped === 1 ? "" : "s"} will be skipped.` : ""}`,
      confirmLabel: `Delete ${n} task${n === 1 ? "" : "s"}`,
      onConfirm: () => {
        setConfirmDialog(null);
        deletable.forEach((id) => {
          const t = tasksRef.current.find((x) => x.id === id);
          if (t?.ghlTaskId) ghlCall("delete", t);
        });
        const idSet = new Set(deletable);
        setTasks((ts) => ts.filter((t) => !idSet.has(t.id)));
        if (openTaskId && idSet.has(openTaskId)) setOpenTaskId(null);
        deletable.forEach((id) => deleteTaskDb(id));
        clearSelection();
        pushToast(`${n} task${n === 1 ? "" : "s"} deleted`);
      },
    });
  };
  const deleteTask = (id: string) => {
    // Owner Growth Plan/Sales checklist steps are a fixed template every
    // business gets — defense in depth alongside the hidden delete button in
    // TaskDrawer, in case some other path ever calls this directly.
    const lockedStep = tasksRef.current.find((x) => x.id === id);
    if (lockedStep?.playbookStepKey) { pushToast("Playbook steps can't be deleted."); return; }
    setConfirmDialog({
      title: "Delete this task?", message: "Moves to Trash — restorable there for 30 days.", confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        const t = tasksRef.current.find((x) => x.id === id);
        if (t?.ghlTaskId) ghlCall("delete", t); // also remove it from GoHighLevel
        setTasks((ts) => ts.filter((t) => t.id !== id));
        setOpenTaskId(null);
        deleteTaskDb(id);
        pushToast("Task moved to Trash");
      },
    });
  };

  const addComment = (id: string, body: string, attachments?: Attachment[]) => {
    if (!body.trim() && !attachments?.length) return;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    // Atomic JSONB append (append_comment RPC) instead of a full-row upsert —
    // two teammates commenting on the same task in the same window would
    // otherwise silently drop one comment (read-then-replace race).
    const newComment: Comment = { id: newId("cm_"), authorId: me.id, body: body.trim(), at: new Date().toISOString(), ...(attachments?.length ? { attachments } : {}) };
    setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, comments: [...x.comments, newComment] } : x)));
    appendCommentDb(id, newComment);
    // Comment notifications: @mentions get "mentioned you"; the task's assignee
    // always hears about new comments on their task (unless they wrote it).
    const mentioned = new Set<string>();
    users.forEach((u) => {
      if (u.id !== me.id && mentionsUser(body, u.name)) {
        mentioned.add(u.id);
        notify(u.id, `${me.name} mentioned you in “${t.title}”`, id, { kind: "message", skipEmail: true });
        pushToast(`Notified ${u.name}`);
        sendMentionEmail(u.id, id, t.title, body.trim());
      }
    });
    if (t.assigneeId && t.assigneeId !== me.id && !mentioned.has(t.assigneeId)) {
      notify(t.assigneeId, `${me.name} commented on “${t.title}”`, id, { kind: "message" });
    }
  };
  const addFiles = async (id: string, fileList: FileList) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || fileList.length === 0) return;
    const all = Array.from(fileList);
    const files = all.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    const oversized = all.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length) pushToast(`Skipped ${oversized.length} file${oversized.length > 1 ? "s" : ""} over ${formatBytes(MAX_ATTACHMENT_BYTES)}: ${oversized.map((f) => f.name).join(", ")}`);
    if (files.length === 0) return;

    setUploadProgress({ done: 0, total: files.length });
    const items: Attachment[] = [];
    let failed = 0;
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${id}/${newId("f_")}-${safe}`;
      const res = await uploadTaskFile(path, f);
      items.push({ id: newId("a_"), name: f.name, size: formatBytes(f.size), kind: kindFromName(f.name), path: res.ok ? path : undefined });
      if (!res.ok) failed++;
      setUploadProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
    }
    setUploadProgress(null);
    // Re-read current task in case it changed while awaiting.
    const cur = tasks.find((x) => x.id === id) ?? t;
    update(id, { attachments: [...cur.attachments, ...items] });
    if (failed) pushToast(`Attached ${items.length}, but ${failed} didn't upload — create the "task-files" storage bucket in Supabase.`);
    else pushToast(`Uploaded ${items.length} file${items.length > 1 ? "s" : ""}`);
  };
  const downloadFile = async (path: string) => {
    const url = await signedUrlForFile(path);
    if (url) window.open(url, "_blank", "noopener");
    else pushToast("Couldn't open the file — is the storage bucket set up?");
  };
  // "Download all" for a batch of attachments (a client dropping a dozen
  // logo variations into one chat message, say) — zips them client-side
  // into a single file instead of one `window.open` per attachment, which
  // browsers throttle/pop-up-block past the first couple and which would
  // otherwise leave the user saving 20 files one at a time.
  const [zippingIds, setZippingIds] = useState<Set<string>>(new Set());
  const downloadAllAsZip = async (items: Attachment[], zipName: string, batchId: string) => {
    const withPath = items.filter((a) => a.path);
    if (!withPath.length) { pushToast("Nothing to download."); return; }
    setZippingIds((s) => new Set(s).add(batchId));
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let failed = 0;
      await Promise.all(withPath.map(async (a) => {
        try {
          const url = await signedUrlForFile(a.path!);
          if (!url) { failed++; return; }
          const blob = await fetch(url).then((r) => r.blob());
          let name = a.name || a.path!.split("/").pop() || "file";
          if (usedNames.has(name)) {
            const dot = name.lastIndexOf(".");
            name = dot > 0 ? `${name.slice(0, dot)}-${a.id.slice(0, 6)}${name.slice(dot)}` : `${name}-${a.id.slice(0, 6)}`;
          }
          usedNames.add(name);
          zip.file(name, blob);
        } catch { failed++; }
      }));
      const blob = await zip.generateAsync({ type: "blob" });
      // A blob: URL is same-origin, so (unlike the cross-origin Supabase
      // signed URLs downloadFileAs deals with) the `download` attribute
      // actually triggers a save instead of a navigation.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl; a.download = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      if (failed) pushToast(`Downloaded ${withPath.length - failed} of ${withPath.length} files — ${failed} couldn't be fetched.`);
    } finally {
      setZippingIds((s) => { const n = new Set(s); n.delete(batchId); return n; });
    }
  };
  // Forces an actual save instead of opening the file in a new tab — the
  // gap that mattered most for images, which browsers always render inline
  // rather than downloading. See downloadUrlForFile's comment for why this
  // needs its own signed-URL request rather than an HTML download attribute.
  const downloadFileAs = async (path: string, filename: string) => {
    const url = await downloadUrlForFile(path, filename);
    if (url) window.open(url, "_blank", "noopener");
    else pushToast("Couldn't download the file — is the storage bucket set up?");
  };
  // A "direct link" people can paste elsewhere (Slack, a doc) needs to
  // outlive the 10-minute expiry used for click-to-open — 30 days is long
  // enough to be practically permanent without making the bucket public.
  const copyAttachmentLink = async (path: string) => {
    const url = await signedUrlForFile(path, 60 * 60 * 24 * 30);
    if (!url) { pushToast("Couldn't get a link — is the storage bucket set up?"); return; }
    try { await navigator.clipboard.writeText(url); pushToast("Link copied (valid for 30 days)"); }
    catch { pushToast("Couldn't copy to clipboard"); }
  };
  // Shared single-image upload for paste-to-attach in Chat messages and task
  // comments — same storage bucket/pattern as addFiles above, but returns the
  // Attachment directly instead of patching a task, since a chat message or
  // comment doesn't exist as a row yet when the paste happens.
  const uploadOneImage = async (pathPrefix: string, file: File): Promise<Attachment | null> => {
    if (file.size > MAX_ATTACHMENT_BYTES) { pushToast(`Skipped ${file.name} — over ${formatBytes(MAX_ATTACHMENT_BYTES)}`); return null; }
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${pathPrefix}/${newId("f_")}-${safe}`;
    const res = await uploadTaskFile(path, file);
    if (!res.ok) { pushToast(`Couldn't upload ${file.name} — is the "task-files" storage bucket set up?`); return null; }
    return { id: newId("a_"), name: file.name, size: formatBytes(file.size), kind: kindFromName(file.name), path };
  };
  // Confirmed, not immediate: this permanently deletes the stored file, and
  // unlike a task it has no Trash to fall back on (Derek: "include a
  // confirmation step when deleting an upload on a task").
  const removeFile = (id: string, att: Attachment) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setConfirmDialog({
      title: `Delete “${att.name}”?`,
      message: "This permanently deletes the file. It can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        if (att.path) deleteTaskFile(att.path);
        update(id, { attachments: t.attachments.filter((a) => a.id !== att.id) });
        pushToast("Attachment removed");
      },
    });
  };
  // --- GoHighLevel task sync -----------------------------------------------
  // A client is a GHL contact (cl_<localContactId>). To act on its GHL tasks we
  // need the contact's GHL id + the sub-account's location id (+ its token,
  // resolved server-side). Returns null when the task isn't tied to a GHL contact.
  const ghlTargetFor = (t: Task): { locationId: string; ghlContactId: string } | null => {
    if (!t.clientId.startsWith("cl_")) return null;
    const ct = contactById(t.clientId.slice(3));
    if (!ct?.ghlContactId) return null;
    const sub = clientById(ct.clientId);
    if (!sub?.ghlLocationId) return null;
    return { locationId: sub.ghlLocationId, ghlContactId: ct.ghlContactId };
  };
  const ghlCall = (op: "create" | "update" | "complete" | "delete", t: Task) => {
    const target = ghlTargetFor(t);
    if (!target) return Promise.resolve<{ error?: string; ghlTaskId?: string } | null>(null);
    return authedFetch("/api/ghl/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, ...target, ghlTaskId: t.ghlTaskId, title: t.title, body: htmlToText(t.description), due: t.due, completed: t.status === "done" }),
    }).then((r) => r.json()).catch(() => ({ error: "Network error reaching GoHighLevel." }));
  };
  // Fields that, when changed on an already-synced task, we mirror to GHL.
  const GHL_SYNC_FIELDS: (keyof Task)[] = ["title", "description", "due", "status"];
  const syncGhlIfLinked = (updated: Task, patch: Partial<Task>) => {
    if (!updated.ghlTaskId) return;
    if (!Object.keys(patch).some((k) => GHL_SYNC_FIELDS.includes(k as keyof Task))) return;
    ghlCall("update", updated); // fire-and-forget; GHL stays eventually-consistent
  };
  const pushToGhl = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    if (!ghlTargetFor(t)) { pushToast("This client isn't linked to a GHL contact yet."); return; }
    setGhlBusy(true);
    try {
      const j = await ghlCall("create", t);
      if (j?.ghlTaskId) { update(id, { ghlTaskId: j.ghlTaskId }); pushToast("✓ Pushed to GoHighLevel"); }
      else pushToast(j?.error ?? "GoHighLevel push failed.");
    } finally { setGhlBusy(false); }
  };
  const unlinkGhl = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t?.ghlTaskId) return;
    ghlCall("delete", t); // remove the task on GHL too
    update(id, { ghlTaskId: null });
    pushToast("Unlinked from GoHighLevel");
  };

  // --- GoHighLevel messages (email now, sms later) -------------------------
  // Same target-resolution shape as ghlTargetFor above, but keyed directly off
  // a Contact rather than a Task, since a message belongs to the person, not
  // any one piece of work.
  const ghlTargetForContact = (contact: Contact): { locationId: string; ghlContactId: string } | null => {
    if (!contact.ghlContactId) return null;
    const sub = clientById(contact.clientId);
    if (!sub?.ghlLocationId) return null;
    return { locationId: sub.ghlLocationId, ghlContactId: contact.ghlContactId };
  };
  const activeContact = (): Contact | null =>
    activeClient !== "all" ? contactForClient(activeClient) : null;
  const [sendingMessage, setSendingMessage] = useState(false);
  // Sends via GHL's Conversations API (so it goes out from the sub-account's
  // own connected email/number) and only writes the local `messages` row
  // after a confirmed success — same pattern as pushToGhl. This is the
  // "outbound" half of the Chat tab's Messages view; the webhook (see
  // src/app/api/ghl/webhook/route.ts) covers inbound replies, so together
  // the two capture a full two-way conversation with no gap and no polling.
  const sendMessage = async (clientId: string, channel: MessageChannel, subject: string, body: string, attachments: Attachment[] = [], cc: string[] = [], bcc: string[] = [], taskId: string | null = null, fromEmail?: string) => {
    if (!body.trim()) return;
    const contact = contactForClient(clientId);
    if (!contact) { pushToast("This client isn't linked to a GHL contact yet."); return; }
    // Chat needs neither GHL nor Gmail — it's just a `messages` row the
    // client sees on their own /waiting/[token] page (picked up by the
    // page's own polling), not something delivered through either provider.
    // No per-message email either: only a debounced "you have a new
    // message" nudge, gated server-side by a per-CLIENT cooldown (not
    // per-task — replying across several of the same client's tasks in one
    // pass must still add up to one email, see notify-client/route.ts).
    if (channel === "chat") {
      setSendingMessage(true);
      try {
        const m: Message = {
          id: newId("msg_"), contactId: contact.id, clientId, taskId, channel, direction: "outbound",
          subject: null, body, ghlMessageId: null, createdBy: me.id, at: new Date().toISOString(), read: true,
          attachments, cc: [], bcc: [],
        };
        setMessages((ms) => [...ms, m]);
        insertMessage(m);
        if (taskId) {
          authedFetch("/api/messages/notify-client", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId, taskId }),
          }).catch(() => {});
        }
      } finally {
        setSendingMessage(false);
      }
      return;
    }
    const target = ghlTargetForContact(contact);
    if (!target) { pushToast("No GoHighLevel connection for this client's sub-account."); return; }
    // Cc/Bcc are an email-only concept — never carry them onto an SMS send.
    const emailCc = channel === "email" ? cc : [];
    const emailBcc = channel === "email" ? bcc : [];
    setSendingMessage(true);
    try {
      // Per-teammate "from": route attachment-free emails through Google
      // Workspace (Gmail API) so they come from the sender's own address, not
      // GHL's default. SMS and attachment-bearing emails (v1 Gmail path has no
      // attachments yet) stay on GHL. A 501 from the Google route (not
      // configured, or the caller isn't a domain sender) falls through to GHL,
      // so nothing breaks before setup.
      if (channel === "email" && !!contact.email) {
        const gres = await authedFetch("/api/google/send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, toEmail: contact.email, subject, body, isHtml: channel === "email", cc: emailCc, bcc: emailBcc, fromEmail, attachments: attachments.filter((a) => a.path).map((a) => ({ path: a.path, name: a.name })) }),
        });
        if (gres.status !== 501) {
          const gj = await gres.json().catch(() => ({}));
          if (!gres.ok || gj.error) { pushToast(gj.error || "Failed to send email."); return; }
          const gm: Message = {
            id: newId("msg_"), contactId: contact.id, clientId, taskId, channel, direction: "outbound",
            subject: subject.trim() ? subject.trim() : null, body,
            ghlMessageId: null, gmailMessageId: gj.gmailMessageId ?? null, gmailThreadId: gj.gmailThreadId ?? null, createdBy: me.id, at: new Date().toISOString(), read: true,
            attachments, cc: emailCc, bcc: emailBcc,
          };
          setMessages((ms) => [...ms, gm]);
          insertMessage(gm);
          return;
        }
        // 501 → fall through to the GHL path below.
      }
      // GHL fetches attachments itself from a URL rather than accepting an
      // upload — an hour is ample time for that fetch, without leaving the
      // private bucket's contents reachable indefinitely.
      const attachmentUrls = (await Promise.all(attachments.filter((a) => a.path).map((a) => signedUrlForFile(a.path!, 60 * 60)))).filter((u): u is string => !!u);
      const res = await authedFetch("/api/ghl/message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, locationId: target.locationId, ghlContactId: target.ghlContactId, channel, subject: channel === "email" ? subject : undefined, body, isHtml: channel === "email", attachments: attachmentUrls, cc: emailCc, bcc: emailBcc }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to send message."); return; }
      const m: Message = {
        id: newId("msg_"), contactId: contact.id, clientId, taskId, channel, direction: "outbound",
        subject: channel === "email" && subject.trim() ? subject.trim() : null, body,
        ghlMessageId: j.ghlMessageId ?? null, createdBy: me.id, at: new Date().toISOString(), read: true,
        attachments, cc: emailCc, bcc: emailBcc,
      };
      setMessages((ms) => [...ms, m]);
      insertMessage(m);
    } catch {
      pushToast("Failed to send message.");
    } finally {
      setSendingMessage(false);
    }
  };

  // Admin-only correction for a message that already sent wrong (see
  // supabase/message-delete-policy.sql + api/messages/edit for why edit goes
  // through a server route instead of RLS). Neither of these unsends a real
  // email/text already in the client's inbox — they only change what
  // ClickUpTasks and the client's public waiting-page thread show from here on.
  const deleteMessage = (id: string) => {
    setMessages((ms) => ms.filter((m) => m.id !== id));
    deleteMessageDb(id);
  };
  // Clears the unread dot on one TaskDrawer channel tab (Chat/Email/SMS) the
  // moment it's opened — narrower than onOpenMessages above, which clears
  // every channel for the whole contact when the client-level Journal opens.
  const markTaskChannelRead = (taskId: string, channel: MessageChannel) => {
    setMessages((ms) => ms.map((m) => (m.taskId === taskId && m.channel === channel && !m.read ? { ...m, read: true } : m)));
    markTaskChannelReadDb(taskId, channel);
  };
  const editMessage = async (id: string, body: string, subject?: string | null) => {
    const prev = messages;
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, body, ...(subject !== undefined ? { subject } : {}) } : m)));
    try {
      const res = await authedFetch("/api/messages/edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, body, subject }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { setMessages(prev); pushToast(j.error || "Failed to update message."); }
    } catch {
      setMessages(prev);
      pushToast("Failed to update message.");
    }
  };

  // --- Scheduled sends (send later) ----------------------------------------
  // Fetched on demand per client (not part of fetchAll's global load — a
  // pending-send queue is small and only matters while its client's
  // Journal/composer is open), fired by the /api/cron/send-scheduled cron.
  const [scheduledMessages, setScheduledMessages] = useState<Record<string, ScheduledMessage[]>>({});
  const loadScheduledMessages = async (clientId: string) => {
    try {
      const res = await authedFetch(`/api/messages/schedule?clientId=${encodeURIComponent(clientId)}`);
      const j = await res.json();
      if (!res.ok) return;
      setScheduledMessages((m) => ({ ...m, [clientId]: (j.scheduled ?? []).map(rowToScheduledMessage).filter((s: ScheduledMessage) => s.status === "pending") }));
    } catch { /* best-effort; the composer just shows nothing pending */ }
  };
  const scheduleMessage = async (clientId: string, channel: MessageChannel, subject: string, body: string, scheduledAt: string, attachments: Attachment[] = [], cc: string[] = [], bcc: string[] = [], taskId: string | null = null, fromEmail?: string) => {
    if (!body.trim()) return;
    try {
      const res = await authedFetch("/api/messages/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, taskId, channel, subject, body, cc, bcc, fromEmail, scheduledAt, attachments: attachments.filter((a) => a.path).map((a) => ({ path: a.path, name: a.name })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to schedule message."); return; }
      pushToast(`🕐 Scheduled for ${new Date(scheduledAt).toLocaleString()}`);
      loadScheduledMessages(clientId);
    } catch {
      pushToast("Failed to schedule message.");
    }
  };
  const cancelScheduledMessage = async (id: string, clientId: string) => {
    try {
      const res = await authedFetch("/api/messages/schedule", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to cancel."); return; }
      setScheduledMessages((m) => ({ ...m, [clientId]: (m[clientId] ?? []).filter((s) => s.id !== id) }));
      pushToast("Scheduled send canceled");
    } catch {
      pushToast("Failed to cancel.");
    }
  };

  const toggleSub = (taskId: string, subId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const s = t.subtasks.find((x) => x.id === subId);
    const nowDone = s ? !s.done : false;
    update(taskId, { subtasks: t.subtasks.map((x) => (x.id === subId ? { ...x, done: !x.done } : x)) });
    // Completing a delegated item pings the task owner so they know it's handled.
    // Bell only — a checked-off checklist row is progress on work the owner is
    // already watching, not something that needs to interrupt their inbox.
    // Delegating an item TO someone (see patchSub) still emails, since that one
    // is a direct ask.
    if (nowDone && s?.assigneeId && t.assigneeId && t.assigneeId !== me.id) notify(t.assigneeId, `${me.name} completed "${s.title}" on ${t.title}`, taskId, { skipEmail: true });
  };
  const addSub = (taskId: string, title: string) => { const t = tasks.find((x) => x.id === taskId); if (t && title.trim()) update(taskId, { subtasks: [...t.subtasks, { id: newId("s_"), title: title.trim(), done: false }] }); };
  const renameSub = (taskId: string, subId: string, title: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, title } : s)) }); };
  const deleteSub = (taskId: string, subId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    const s = t?.subtasks.find((x) => x.id === subId);
    if (!t || !s) return;
    setConfirmDialog({
      title: `Delete “${s.title || "this checklist item"}”?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => { setConfirmDialog(null); update(taskId, { subtasks: t.subtasks.filter((x) => x.id !== subId) }); },
    });
  };
  const patchSub = (taskId: string, subId: string, patch: Partial<Subtask>) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const before = t.subtasks.find((s) => s.id === subId);
    update(taskId, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)) });
    // Assigning a checklist item to someone else = delegating that step; ping them.
    if (patch.assigneeId && patch.assigneeId !== before?.assigneeId && patch.assigneeId !== me.id) notify(patch.assigneeId, `${me.name} delegated "${before?.title || "a checklist item"}" on ${t.title} to you`, taskId);
  };
  const toggleLabel = (taskId: string, labelId: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { labelIds: t.labelIds.includes(labelId) ? t.labelIds.filter((l) => l !== labelId) : [...t.labelIds, labelId] }); };

  // A client's ghlLocationId field is repurposed to store the contact's business/company name.
  const clientCompany = (c: Client | null) => (c && c.id.startsWith("cl_") ? c.ghlLocationId : "");
  const addClientContact = async (contact: Contact, type: ClientType = "client") => {
    const id = "cl_" + contact.id;
    if (clients.some((c) => c.id === id)) { setActiveClient(id); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setAddClientOpen(false); return; }
    // Prevent a duplicate: if this contact matches a client we already track
    // (same email/phone/name, e.g. the same business in the other GHL
    // account), link it to that one and open it instead of making a second.
    const dupe = findDuplicateTrackedClient(contact);
    if (dupe) {
      linkContactToClient(dupe, contact.id);
      setActiveClient(dupe); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setAddClientOpen(false);
      pushToast(`${contact.name} is already tracked as “${clientById(dupe)?.name}” — linked to it.`);
      return;
    }
    const sub = subAccounts.find((s) => s.id === contact.clientId);
    const c: Client = { id, name: contact.name, color: sub?.color ?? "#a855f7", ghlLocationId: "", status: "claimed", type, assignedTo: [] };
    setClients((cs) => [...cs, c]);
    markOwnClientWrite(c.id);
    upsertClient(c);
    if (type === "client") reconcilePlaybookTasks(id);
    // Bring any of this contact's stranded conversation onto the new client's
    // page — inbound created a Conversation task under the GHL sub-account
    // before they were a tracked client. Re-point those tasks (by contact_id)
    // to the new client + a project under it.
    const orphanTasks = tasks.filter((t) => t.contactId === contact.id && t.clientId !== id);
    if (orphanTasks.length) {
      let projId = projects.find((p) => p.clientId === id)?.id;
      if (!projId) {
        const np: Project = { id: newId("p_"), clientId: id, name: "Tasks", description: "" };
        setProjects((ps) => [...ps, np]); upsertProject(np); projId = np.id;
      }
      const pid = projId;
      const orphanIds = new Set(orphanTasks.map((t) => t.id));
      setTasks((ts) => ts.map((t) => (orphanIds.has(t.id) ? { ...t, clientId: id, projectId: pid } : t)));
      orphanTasks.forEach((t) => upsertTask({ ...t, clientId: id, projectId: pid }, me.id));
    }
    setActiveClient(id);
    setMyWork(false);
    setPersonalView(false);
    pushToast(orphanTasks.length ? `Added ${contact.name} — brought ${orphanTasks.length} conversation task${orphanTasks.length === 1 ? "" : "s"} over.` : `Added ${contact.name}`);
    try {
      const res = await authedFetch("/api/ghl/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: sub?.ghlLocationId ?? "", contactId: contact.ghlContactId }) });
      const j = await res.json();
      if (j.company) { const up: Client = { ...c, ghlLocationId: j.company }; setClients((cs) => cs.map((x) => (x.id === id ? up : x))); markOwnClientWrite(up.id); upsertClient(up); }
    } catch { /* business name is optional */ }
  };
  const saveTemplate = (id: string | undefined, spec: { name: string; checklistItems: string[] }) => {
    const t: TaskTemplate = { id: id ?? newId("tmpl_"), ...spec };
    setTaskTemplates((ts) => (id ? ts.map((x) => (x.id === id ? t : x)) : [...ts, t]));
    upsertTaskTemplate(t);
  };
  const deleteTemplate = (id: string) => {
    const t = taskTemplates.find((x) => x.id === id);
    setConfirmDialog({
      title: `Delete template “${t?.name ?? "this template"}”?`,
      message: "Tasks already created from it are not affected. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setTaskTemplates((ts) => ts.filter((x) => x.id !== id));
        deleteTaskTemplateDb(id);
      },
    });
  };
  // Appends a template's checklist items onto an existing task as new,
  // unchecked subtasks — one patch, not a loop of addSub calls, so it's a
  // single upsert instead of one per item.
  const applyTemplate = (taskId: string, templateId: string) => {
    const tpl = taskTemplates.find((t) => t.id === templateId);
    const t = tasks.find((x) => x.id === taskId);
    if (!tpl || !t) return;
    const added: Subtask[] = tpl.checklistItems.map((title) => ({ id: newId("s_"), title, done: false }));
    update(taskId, { subtasks: [...t.subtasks, ...added] });
    pushToast(`Added ${added.length} checklist item${added.length === 1 ? "" : "s"} from "${tpl.name}"`);
  };
  // Creates a brand-new task from a template — title defaults to the
  // template name, checklist pre-filled — to quickly populate a project.
  const useTemplateAsTask = (templateId: string, clientId: string, projectId: string) => {
    const tpl = taskTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const t: Task = {
      id: newId("t_"), projectId, clientId, title: tpl.name, description: "",
      status: "todo", priority: "normal", assigneeId: me.id,
      contactId: clientId.startsWith("cl_") ? clientId.slice(3) : null,
      due: null, recurrence: "none", labelIds: [], ghlTaskId: null, private: false,
      subtasks: tpl.checklistItems.map((title) => ({ id: newId("s_"), title, done: false })),
      attachments: [], comments: [], createdAt: new Date().toISOString(), createdBy: me.id,
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
    pushToast(`Created "${t.title}" from template`);
  };
  const savePlaybook = (id: string | undefined, spec: { name: string; tasks: PlaybookTask[] }) => {
    const p: Playbook = { id: id ?? newId("pb_"), ...spec };
    setPlaybooks((ps) => (id ? ps.map((x) => (x.id === id ? p : x)) : [...ps, p]));
    upsertPlaybook(p);
  };
  const deletePlaybook = (id: string) => {
    const pb = playbooks.find((x) => x.id === id);
    setConfirmDialog({
      title: `Delete playbook “${pb?.name ?? "this playbook"}”?`,
      message: "Tasks already loaded from it are not affected. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setPlaybooks((ps) => ps.filter((x) => x.id !== id));
        deletePlaybookDb(id);
      },
    });
  };
  // Manual for now, per Derek: author + load here; auto-loading a playbook
  // when a client enters a given stage is planned but not wired up yet — no
  // stage-change hook calls this.
  const loadPlaybook = (playbookId: string, clientId: string, projectId: string) => {
    const pb = playbooks.find((p) => p.id === playbookId);
    if (!pb || !pb.tasks.length) return;
    const contactId = clientId.startsWith("cl_") ? clientId.slice(3) : null;
    const created: Task[] = pb.tasks.map((pt) => ({
      id: newId("t_"), projectId, clientId, title: pt.title, description: "",
      status: "todo", priority: pt.priority ?? "normal", assigneeId: me.id, contactId,
      due: typeof pt.dueOffsetDays === "number" ? addDaysIso(TODAY, pt.dueOffsetDays) : null,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false,
      subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(), createdBy: me.id,
    }));
    setTasks((ts) => [...ts, ...created]);
    created.forEach((t) => upsertTask(t, me.id));
    pushToast(`Loaded "${pb.name}" — ${created.length} task${created.length === 1 ? "" : "s"} added.`);
  };
  const renameClient = (id: string) => {
    const c = clientById(id);
    if (!c) return;
    setPromptDialog({ title: "Rename client", initial: c.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const nc = { ...c, name };
      setClients((cs) => cs.map((x) => (x.id === id ? nc : x)));
      markOwnClientWrite(nc.id);
      upsertClient(nc);
    } });
  };
  const deleteClient = (id: string) => {
    const c = clientById(id);
    const n = tasks.filter((t) => t.clientId === id).length;
    setConfirmDialog({
      title: `Remove “${c?.name}”?`,
      message: `${n ? `This also moves its ${n} task${n === 1 ? "" : "s"} to Trash. ` : ""}Restorable from Trash for 30 days. The GoHighLevel contact itself stays untouched.`,
      confirmLabel: "Remove",
      onConfirm: () => {
        setConfirmDialog(null);
        setClients((cs) => cs.filter((x) => x.id !== id));
        setProjects((ps) => ps.filter((p) => p.clientId !== id));
        setTasks((ts) => ts.filter((t) => t.clientId !== id));
        setClientLinks((ls) => ls.filter((l) => l.clientId !== id));
        setClientNotes((ns) => ns.filter((n) => n.clientId !== id));
        deleteClientDb(id);
        if (activeClient === id) setActiveClient("all");
      },
    });
  };

  // --- Trash (Settings tab) -----------------------------------------------
  // Restoring only ever affects clients/projects/tasks (the three tables
  // soft-delete covers — see soft-delete.sql), so a targeted re-fetch of
  // just those three is enough; no need for a full fetchAll()-and-replace-
  // everything reload.
  const refreshTrashables = async () => {
    const d = await fetchAll();
    setClients(d.clients); setProjects(d.projects); setTasks(d.tasks);
  };
  const restoreClient = async (id: string) => { await restoreClientDb(id); await refreshTrashables(); pushToast("Client restored"); };
  const restoreProjectFromTrash = async (id: string) => { await restoreProjectDb(id); await refreshTrashables(); pushToast("Project restored"); };
  const restoreTaskFromTrash = async (id: string) => { await restoreTaskDb(id); await refreshTrashables(); pushToast("Task restored"); };
  const purgeClient = async (id: string) => { await hardDeleteClientDb(id); };
  const purgeProject = async (id: string) => { await hardDeleteProjectDb(id); };
  const purgeTask = async (id: string) => { await hardDeleteTaskDb(id); };

  // --- client dedup + merge ------------------------------------------------
  // The same real business can be a contact in more than one GHL sub-account
  // (agency + directory); if each got promoted, you'd get two client records
  // for one entity. These find likely duplicates (by email / phone / name)
  // and fold one into the other.
  const dedupName = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const dedupPhone = (s: string | undefined) => { const d = (s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
  // Every contact id a tracked client "is" — its own (from the cl_ id) plus
  // anything it absorbed via a prior merge / manual GHL link.
  const clientContactIds = (cl: Client): string[] => [
    ...(cl.id.startsWith("cl_") ? [cl.id.slice(3)] : []),
    ...(cl.linkedContactId ? [cl.linkedContactId] : []),
    ...(cl.linkedContactIds ?? []),
  ];
  // Returns an existing tracked client that already represents this contact
  // (same email / phone / name), or null. Used to stop promotion from making
  // a second record for someone already tracked.
  const findDuplicateTrackedClient = (contact: Contact): string | null => {
    const email = (contact.email ?? "").trim().toLowerCase();
    const phone = dedupPhone(contact.phone);
    const name = dedupName(contact.name);
    for (const cl of clients) {
      if (!cl.id.startsWith("cl_")) continue;
      if (cl.id === "cl_" + contact.id) continue; // itself
      for (const cid of clientContactIds(cl)) {
        const other = contactById(cid);
        if (!other) continue;
        if (email && (other.email ?? "").trim().toLowerCase() === email) return cl.id;
        if (phone && dedupPhone(other.phone) === phone) return cl.id;
        if (name.length > 3 && dedupName(other.name) === name) return cl.id;
      }
    }
    return null;
  };
  // Associate an extra contact's future inbound with an existing client
  // (append to linked_contact_ids) without creating a new client record.
  const linkContactToClient = (clientId: string, contactId: string) => {
    const cl = clientById(clientId);
    if (!cl) return;
    if (clientContactIds(cl).includes(contactId)) return;
    const up: Client = { ...cl, linkedContactIds: [...(cl.linkedContactIds ?? []), contactId] };
    setClients((cs) => cs.map((x) => (x.id === clientId ? up : x)));
    markOwnClientWrite(clientId);
    upsertClient(up);
  };
  // Fold source client into target: repoint everything (via the atomic
  // merge_clients RPC), apply the chosen winning field values to the
  // survivor, and reflect it all optimistically. Irreversible — callers
  // gate it behind a confirm (see MergeClientModal).
  const mergeClients = async (sourceId: string, targetId: string, survivorPatch: Partial<Client>) => {
    const source = clientById(sourceId);
    const target = clientById(targetId);
    if (!source || !target || sourceId === targetId) return;
    const absorbed = Array.from(new Set([
      ...(target.linkedContactIds ?? []),
      ...(source.linkedContactIds ?? []),
      ...(source.linkedContactId ? [source.linkedContactId] : []),
      ...(sourceId.startsWith("cl_") ? [sourceId.slice(3)] : []),
    ].filter(Boolean)));
    const survivor: Client = { ...target, ...survivorPatch, linkedContactIds: absorbed };
    // Optimistic repoint of every client-scoped array (contacts intentionally
    // NOT repointed — a contact's client_id is its GHL sub-account; see RPC).
    setTasks((ts) => ts.map((t) => (t.clientId === sourceId ? { ...t, clientId: targetId } : t)));
    setProjects((ps) => ps.map((p) => (p.clientId === sourceId ? { ...p, clientId: targetId } : p)));
    setMessages((ms) => ms.map((m) => (m.clientId === sourceId ? { ...m, clientId: targetId } : m)));
    setClientLinks((ls) => ls.map((l) => (l.clientId === sourceId ? { ...l, clientId: targetId } : l)));
    setClientNotes((ns) => ns.map((n) => (n.clientId === sourceId ? { ...n, clientId: targetId } : n)));
    setFolders((fs) => fs.map((f) => (f.clientId === sourceId ? { ...f, clientId: targetId } : f)));
    setVaultFolders((vs) => vs.map((v) => (v.clientId === sourceId ? { ...v, clientId: targetId } : v)));
    setNotifications((ns) => ns.map((n) => (n.clientId === sourceId ? { ...n, clientId: targetId } : n)));
    setClients((cs) => cs.filter((c) => c.id !== sourceId).map((c) => (c.id === targetId ? survivor : c)));
    if (activeClient === sourceId) setActiveClient(targetId);
    markOwnClientWrite(targetId);
    const { error } = await mergeClientsDb(sourceId, targetId);
    if (error) {
      pushToast(`Merge failed: ${error.message}. Reloading…`);
      try {
        const d = await fetchAll();
        setClients(d.clients); setProjects(d.projects); setContacts(d.contacts); setTasks(d.tasks);
        setMessages(d.messages); setClientLinks(d.clientLinks); setClientNotes(d.clientNotes);
        setFolders(d.folders); setVaultFolders(d.vaultFolders); setNotifications(d.notifications);
      } catch { /* leave optimistic state; a reload will reconcile */ }
      return;
    }
    // The RPC only set linked_contact_ids on the survivor — write the chosen
    // display fields (name/status/color/etc.) too.
    upsertClient(survivor);
    pushToast(`Merged “${source.name}” into “${target.name}”.`);
  };
  const addProject = (clientId: string, folderId: string | null = null) => {
    setPromptDialog({ title: folderId ? "New list" : "New list / project", placeholder: "Name", confirmLabel: "Create", onSubmit: (name) => {
      setPromptDialog(null);
      const pos = projects.filter((p) => p.clientId === clientId && (p.folderId ?? null) === folderId).length;
      const p: Project = { id: newId("p_"), clientId, name, description: "", folderId, position: pos };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
    } });
  };
  // Folder CRUD (a folder groups lists). Mirrors createVaultFolder's optimistic
  // + fire-and-forget shape; admin-only per folders_write RLS.
  const createFolder = (clientId: string) => {
    setPromptDialog({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create", onSubmit: (name) => {
      setPromptDialog(null);
      const pos = folders.filter((f) => f.clientId === clientId).length;
      const f: Folder = { id: newId("fd_"), clientId, name, position: pos, createdAt: new Date().toISOString() };
      setFolders((fs) => [...fs, f]);
      upsertFolder(f);
    } });
  };
  const renameFolder = (id: string) => {
    const f = folderById(id);
    if (!f) return;
    setPromptDialog({ title: "Rename folder", initial: f.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const nf = { ...f, name };
      setFolders((fs) => fs.map((x) => (x.id === id ? nf : x)));
      upsertFolder(nf);
    } });
  };
  // Deleting a folder reparents its lists to standalone (folderId → null) and
  // KEEPS their tasks — the deliberate contrast to deleteProject, which
  // cascades tasks. The DB's ON DELETE SET NULL does the same server-side.
  const deleteFolder = (id: string) => {
    const f = folderById(id);
    if (!f) return;
    setConfirmDialog({
      title: `Delete folder “${f.name}”?`,
      message: "Its lists move to standalone — their tasks are kept.",
      confirmLabel: "Delete folder",
      onConfirm: () => {
        setConfirmDialog(null);
        projects.filter((p) => p.folderId === id).forEach((p) => upsertProject({ ...p, folderId: null }));
        setProjects((ps) => ps.map((p) => (p.folderId === id ? { ...p, folderId: null } : p)));
        setFolders((fs) => fs.filter((x) => x.id !== id));
        deleteFolderDb(id);
      },
    });
  };
  // Move a list into a folder (or out to standalone with null), appending it to
  // the end of the target bucket.
  const moveListToFolder = (projectId: string, folderId: string | null) => {
    const p = projectById(projectId);
    if (!p) return;
    const pos = projects.filter((x) => x.clientId === p.clientId && (x.folderId ?? null) === folderId && x.id !== projectId).length;
    const np = { ...p, folderId, position: pos };
    setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
    upsertProject(np);
  };
  // Drag-sort folders (B5). Renumber the client's folders to match orderedIds
  // and persist each — mirrors reorderLinks' shape. DB-backed = shared order.
  const reorderFolders = (clientId: string, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const f = folders.find((x) => x.id === id)!; return { ...f, position: i }; });
    setFolders((fs) => [...fs.filter((f) => f.clientId !== clientId), ...reordered]);
    reordered.forEach((f) => upsertFolder(f));
  };
  // Drag-sort lists within one bucket (a folder, or the standalone bucket when
  // folderId is null). Renumber only that bucket so positions stay local to it.
  const reorderLists = (clientId: string, folderId: string | null, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const p = projects.find((x) => x.id === id)!; return { ...p, position: i }; });
    setProjects((ps) => [...ps.filter((p) => !(p.clientId === clientId && (p.folderId ?? null) === folderId)), ...reordered]);
    reordered.forEach((p) => upsertProject(p));
  };
  // Custom Kanban stages (a project's own board columns, e.g. "Backlog /
  // Designing / In Review / Shipped"). Mirrors the folder CRUD shape exactly;
  // admin-only per stages_write RLS.
  const createStage = (projectId: string) => {
    setPromptDialog({ title: "New stage", placeholder: "Stage name", confirmLabel: "Create", onSubmit: (name) => {
      setPromptDialog(null);
      const pos = stages.filter((s) => s.projectId === projectId).length;
      const s: Stage = { id: newId("stg_"), projectId, name, position: pos, isDone: false, createdAt: new Date().toISOString() };
      setStages((ss) => [...ss, s]);
      upsertStage(s);
    } });
  };
  const renameStage = (id: string) => {
    const s = stages.find((x) => x.id === id);
    if (!s) return;
    setPromptDialog({ title: "Rename stage", initial: s.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const ns = { ...s, name };
      setStages((ss) => ss.map((x) => (x.id === id ? ns : x)));
      upsertStage(ns);
    } });
  };
  // Toggles whether landing in this stage counts as "done" — see setTaskStage,
  // which is what actually syncs Task.status when a task moves in/out.
  const toggleStageIsDone = (id: string) => {
    const s = stages.find((x) => x.id === id);
    if (!s) return;
    const ns = { ...s, isDone: !s.isDone };
    setStages((ss) => ss.map((x) => (x.id === id ? ns : x)));
    upsertStage(ns);
  };
  // Deleting a stage un-sets it from any task that was in it (ON DELETE SET
  // NULL server-side) — tasks are kept, never cascaded.
  const deleteStage = (id: string) => {
    const s = stages.find((x) => x.id === id);
    if (!s) return;
    setConfirmDialog({
      title: `Delete stage "${s.name}"?`,
      message: "Tasks in this stage are kept — they just fall back to no stage.",
      confirmLabel: "Delete stage",
      onConfirm: () => {
        setConfirmDialog(null);
        setStages((ss) => ss.filter((x) => x.id !== id));
        setTasks((ts) => ts.map((t) => (t.stageId === id ? { ...t, stageId: null } : t)));
        deleteStageDb(id);
      },
    });
  };
  const reorderStages = (projectId: string, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const s = stages.find((x) => x.id === id)!; return { ...s, position: i }; });
    setStages((ss) => [...ss.filter((s) => s.projectId !== projectId), ...reordered]);
    reordered.forEach((s) => upsertStage(s));
  };
  // Move a task into a stage (or out, with null — back to the project's plain
  // status board). The stage's isDone flag is the single source of truth for
  // syncing Task.status, so every existing done/not-done consumer (urgency
  // scoring, GHL sync, MCP, recurrence-on-complete, journal completion
  // detection) keeps working unmodified: landing in a done-flagged stage
  // flips status to "done"; leaving one drops it back to "todo".
  const setTaskStage = (taskId: string, stageId: string | null) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const targetStage = stageId ? stages.find((s) => s.id === stageId) : null;
    const nextStatus: TaskStatus = targetStage?.isDone ? "done" : t.status === "done" ? "todo" : t.status;
    update(taskId, { stageId, status: nextStatus });
  };
  // Per-column quick-add on the Kanban board — mirrors quickAdd's Task shape,
  // just scoped by stage instead of a groupBy key.
  const quickAddInStage = (projectId: string, stageId: string, title: string) => {
    if (!title.trim()) return;
    const p = projectById(projectId);
    if (!p) return;
    const stage = stages.find((s) => s.id === stageId);
    const t: Task = {
      id: newId("t_"), projectId, clientId: p.clientId, title: title.trim(), description: "",
      status: stage?.isDone ? "done" : "todo", priority: "normal", assigneeId: me.id, contactId: p.clientId.slice(3), due: null,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
      stageId, createdBy: me.id,
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
    maybeCleanupTaskTitle(t.id, t.title, t.description);
  };
  const moveTaskToNewProject =(taskId: string, clientId: string) => {
    setPromptDialog({ title: "New project", placeholder: "Project name", confirmLabel: "Create & move", onSubmit: (name) => {
      setPromptDialog(null);
      const p: Project = { id: newId("p_"), clientId, name, description: "" };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
      patchTask(taskId, { projectId: p.id });
      pushToast(`Moved to “${p.name}”`);
    } });
  };
  // Moving a task to a different client also has to move its project (a
  // project belongs to exactly one client) and its contact link — reuses the
  // same find-or-create-a-"Tasks"-project pattern as quickAdd. A GHL-linked
  // task is quietly unlinked rather than deleted remotely: the old link
  // points at the wrong contact once moved, but the task on GHL's side is
  // still real work someone may be tracking there — not ours to delete.
  const moveTaskToClient = (taskId: string, newClientId: string, silent?: boolean) => {
    const t = tasksRef.current.find((x) => x.id === taskId);
    if (!t || t.clientId === newClientId) return;
    // Owner Growth Plan steps stay on their business — defense in depth
    // alongside the hidden Client/Project selects in TaskDrawer, in case
    // some other path (bulk move, a future feature) ever calls this directly.
    if (t.playbookStepKey) { pushToast("Playbook steps can't be moved to a different client."); return; }
    let projectId = projects.find((p) => p.clientId === newClientId)?.id;
    if (!projectId) {
      const p: Project = { id: newId("p_"), clientId: newClientId, name: "Tasks", description: "" };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
      projectId = p.id;
    }
    const wasLinked = !!t.ghlTaskId;
    patchTask(taskId, {
      clientId: newClientId,
      projectId,
      contactId: newClientId.startsWith("cl_") ? newClientId.slice(3) : null,
      ghlTaskId: null,
    });
    if (!silent) pushToast(`Moved to ${clientById(newClientId)?.name ?? "client"}${wasLinked ? " — unlinked from GoHighLevel" : ""}`);
  };
  // Bulk version of the above — moves every selected task in one pass with a
  // single summary toast instead of one per task. Confirmed and undoable for
  // the same reason as bulkPatch, and more so: a move rewrites client,
  // project, and contact together, so putting it back by hand is real work.
  const bulkMoveToClient = (clientId: string) => {
    const ids = [...selectedTaskIds];
    if (!ids.length) return;
    const name = clientById(clientId)?.name ?? "client";
    const movable = ids.filter((id) => { const t = tasks.find((x) => x.id === id); return t && t.clientId !== clientId && !t.playbookStepKey; });
    if (!movable.length) { pushToast(`Already in ${name}`); return; }
    const n = movable.length;
    const plural = n === 1 ? "" : "s";
    setConfirmDialog({
      title: `Move ${n} task${plural} to ${name}?`,
      message: `Each task's project and contact move too, and any GoHighLevel link is cleared. You can undo it right after.`,
      confirmLabel: `Move ${n} task${plural}`,
      danger: false,
      onConfirm: () => {
        const before = movable
          .map((id) => {
            const t = tasksRef.current.find((x) => x.id === id);
            return t ? { id, prev: { clientId: t.clientId, projectId: t.projectId, contactId: t.contactId, ghlTaskId: t.ghlTaskId } as Partial<Task> } : null;
          })
          .filter((x): x is { id: string; prev: Partial<Task> } => !!x);
        movable.forEach((id) => moveTaskToClient(id, clientId, true));
        setConfirmDialog(null);
        clearSelection();
        pushToast(`Moved ${n} task${plural} to ${name}`, {
          label: "Undo",
          run: () => {
            before.forEach(({ id, prev }) => patchTask(id, prev));
            pushToast(`Moved ${before.length} task${before.length === 1 ? "" : "s"} back`);
          },
        });
      },
    });
  };
  // Folds one task into another — started life as "merge a Conversation task
  // into real work" but the mechanics (move messages, fold comments, delete
  // the source) apply to any two tasks, so it's now a general merge, driven
  // three ways: the picker modal (mergeSourceId), dragging one row onto
  // another (GroupedList's onMergeTasks), or checking exactly 2 and using
  // the bulk-action bar's Merge button. Always go through requestMerge below
  // — never call this directly — so every path gets the same confirmation.
  const mergeTasks = async (sourceId: string, targetId: string) => {
    const src = tasks.find((t) => t.id === sourceId);
    const target = tasks.find((t) => t.id === targetId);
    if (!src || !target || src.id === target.id) return;
    if (src.clientId !== target.clientId) { pushToast("Can't merge tasks across different clients."); return; }
    // Comments aren't lost on delete — folded into the target in
    // chronological order. A Conversation task is auto-managed and normally
    // carries none (see ghlConversationTask.ts) unless someone typed a note.
    if (src.comments.length) {
      const merged = [...target.comments, ...src.comments].sort((a, b) => a.at.localeCompare(b.at));
      update(targetId, { comments: merged });
    }
    setMessages((ms) => ms.map((m) => (m.taskId === sourceId ? { ...m, taskId: targetId } : m)));
    // Awaited, not fire-and-forget: messages.task_id references tasks(id) on
    // delete set null. Deleting the source task before this UPDATE actually
    // commits let the FK's own "set null" action win the race — the reassign
    // then matched zero rows (they'd already been nulled), permanently
    // orphaning the message from both tasks. Symptom: the message flashed
    // into the target's activity feed from the optimistic local update above,
    // then vanished again the moment the resulting realtime echo (task_id →
    // null) landed.
    await reassignMessagesTaskDb(sourceId, targetId);
    if (src.ghlTaskId) ghlCall("delete", src);
    setTasks((ts) => ts.filter((t) => t.id !== sourceId));
    setOpenTaskId((id) => (id === sourceId ? targetId : id));
    deleteTaskDb(sourceId);
    pushToast(`Merged into "${target.title}"`);
  };
  // This can't be undone (the source task is deleted), so every entry point
  // routes through this confirmation instead of calling mergeTasks directly.
  const requestMerge = (sourceId: string, targetId: string) => {
    const src = tasks.find((t) => t.id === sourceId);
    const target = tasks.find((t) => t.id === targetId);
    if (!src || !target || src.id === target.id) return;
    setConfirmDialog({
      title: `Merge "${src.title}" into "${target.title}"?`,
      message: "Its messages and any notes move onto that task, and this one is removed. This can't be undone.",
      confirmLabel: "Merge",
      danger: true,
      onConfirm: () => { setConfirmDialog(null); clearSelection(); mergeTasks(sourceId, targetId); },
    });
  };
  const renameProject = (id: string) => {
    const p = projectById(id);
    if (!p) return;
    setPromptDialog({ title: "Rename project", initial: p.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const np = { ...p, name };
      setProjects((ps) => ps.map((x) => (x.id === id ? np : x)));
      upsertProject(np);
    } });
  };
  const deleteProject = (id: string) => {
    const p = projectById(id);
    const n = tasks.filter((t) => t.projectId === id).length;
    setConfirmDialog({
      title: `Delete “${p?.name}”?`,
      message: `${n ? `This also moves its ${n} task${n === 1 ? "" : "s"} to Trash. ` : ""}Restorable from Trash for 30 days.`,
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setProjects((ps) => ps.filter((x) => x.id !== id));
        setTasks((ts) => ts.filter((t) => t.projectId !== id));
        setClientNotes((ns) => ns.filter((n) => n.projectId !== id));
        deleteProjectDb(id);
      },
    });
  };

  // --- client links -----------------------------------------------------
  const saveLink = (clientId: string, initial: ClientLink | undefined, v: { label: string; url: string; groupLabel: string; color: string }) => {
    if (initial) {
      const updated: ClientLink = { ...initial, ...v };
      setClientLinks((ls) => ls.map((l) => (l.id === initial.id ? updated : l)));
      upsertClientLink(updated);
    } else {
      const link: ClientLink = { id: newId("cl_"), clientId, position: clientLinks.filter((l) => l.clientId === clientId).length, ...v };
      setClientLinks((ls) => [...ls, link]);
      upsertClientLink(link);
    }
    setLinkModal(null);
  };
  const deleteLink = (link: ClientLink) => setConfirmDialog({
    title: `Delete "${link.label}"?`, message: "This can't be undone.", confirmLabel: "Delete",
    onConfirm: () => { setConfirmDialog(null); setClientLinks((ls) => ls.filter((l) => l.id !== link.id)); deleteClientLinkDb(link.id); },
  });
  const reorderLinks = (clientId: string, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const l = clientLinks.find((x) => x.id === id)!; return { ...l, position: i }; });
    setClientLinks((ls) => [...ls.filter((l) => l.clientId !== clientId), ...reordered]);
    reordered.forEach((l) => upsertClientLink(l));
  };

  // --- team chat -----------------------------------------------------------
  // Workspace-wide, not tied to any client/project — see supabase/team-chat.sql.
  const sendTeamMessage = (body: string, attachments?: Attachment[], replyToId?: string | null) => {
    if (!body.trim() && !attachments?.length) return;
    const m: TeamMessage = { id: newId("tm_"), authorId: me.id, body: body.trim(), at: new Date().toISOString(), replyToId: replyToId ?? null, attachments: attachments ?? [] };
    setTeamMessages((ms) => [...ms, m]);
    insertTeamMessage(m);
    // @mention detection. The composer's picker inserts the exact "@Full Name"
    // this looks for; the lowercase compare is a safety net for someone typing
    // it by hand with different casing. A bare first name still won't match —
    // that's what the picker is for.
    // Word-boundary match, not a bare substring: "@Samantha" must not also
    // notify a "Sam" on the roster. Case-insensitive so a hand-typed
    // "@derek fox" still lands; the picker inserts the exact name anyway.
    // Who gets told, and how loudly. Before this, ONLY an exact @Full Name
    // match notified anyone — so posting without mentioning someone reached
    // nobody at all until they happened to open the page, which is most of
    // why the channel went quiet (Derek: "how can we implement team chat more
    // so people see it and use it").
    //
    // Three tiers, loudest first:
    //   mentioned      — you were named. Bell + email.
    //   replied to     — someone quoted your message. Bell + email; being
    //                    answered is as direct as being named.
    //   everyone else  — bell only. "the people involved in the chat or chat
    //                    thread" get the email (Derek); the rest get the
    //                    badge, because emailing the whole team on every
    //                    message is how a channel gets muted for good.
    const repliedToAuthorId = replyToId ? teamMessages.find((x) => x.id === replyToId)?.authorId ?? null : null;
    users.forEach((u) => {
      if (u.id === me.id) return;
      if (mentionsUser(body, u.name)) {
        notify(u.id, `${me.name} mentioned you in Team Chat`, null, { kind: "message", link: TEAM_CHAT_LINK });
      } else if (u.id === repliedToAuthorId) {
        notify(u.id, `${me.name} replied to you in Team Chat`, null, { kind: "message", link: TEAM_CHAT_LINK });
      } else {
        notify(u.id, `${me.name} posted in Team Chat`, null, { kind: "message", skipEmail: true, link: TEAM_CHAT_LINK });
      }
    });
  };
  // Confirmed like the client-facing message delete in TaskMessaging — team
  // chat had no prompt at all, so a mis-click silently destroyed a message
  // for everyone.
  const deleteTeamMessage = (id: string) => {
    setConfirmDialog({
      title: "Delete this message?",
      message: "It disappears for everyone in Team Chat. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setTeamMessages((ms) => ms.filter((m) => m.id !== id));
        deleteTeamMessageDb(id);
      },
    });
  };
  // Pin is a shared team curation flag, not message ownership — any teammate
  // can toggle it (see chat-reply-attachments-pins.sql's team_messages_update
  // policy, deliberately open unlike the author-scoped delete policy).
  const pinTeamMessage = (id: string, pinned: boolean) => {
    const patch = { pinned, pinnedBy: pinned ? me.id : null, pinnedAt: pinned ? new Date().toISOString() : null };
    setTeamMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    updateTeamMessageDb(id, patch);
  };

  // --- direct messages -----------------------------------------------------
  // Private 1:1 chat between two teammates — see supabase/dm-chat.sql. A DM
  // has exactly one addressee by construction, so unlike sendTeamMessage
  // there's no @mention scan: every send notifies the recipient directly.
  const sendDmMessage = (otherUserId: string, body: string, attachments?: Attachment[], replyToId?: string | null) => {
    if (!body.trim() && !attachments?.length) return;
    const cid = dmConversationId(me.id, otherUserId);
    // Only email the FIRST message of a burst — if the newest message in this
    // thread so far is already mine, the recipient's inbox has been pinged and
    // a rapid-fire follow-up shouldn't add another email. The in-app bell still
    // fires every time; a reply from them resets "first of burst".
    const prior = dmMessages.filter((mm) => mm.conversationId === cid);
    const newest = prior.length ? prior.reduce((a, b) => (b.at > a.at ? b : a)) : null;
    const firstOfBurst = !newest || newest.authorId !== me.id;
    const m: DmMessage = { id: newId("dm_"), conversationId: cid, authorId: me.id, recipientId: otherUserId, body: body.trim(), at: new Date().toISOString(), replyToId: replyToId ?? null, attachments: attachments ?? [] };
    setDmMessages((ms) => [...ms, m]);
    insertDmMessage(m);
    notify(otherUserId, `${me.name} sent you a message`, null, { kind: "dm", skipEmail: !firstOfBurst });
  };
  const deleteDmMessage = (id: string) => {
    setConfirmDialog({
      title: "Delete this message?",
      message: "It disappears for both of you. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setDmMessages((ms) => ms.filter((m) => m.id !== id));
        deleteDmMessageDb(id);
      },
    });
  };
  // Both participants (or admin) can pin — matches dm_messages_update's RLS
  // predicate exactly (the same people who can already read the thread).
  const pinDmMessage = (id: string, pinned: boolean) => {
    const patch = { pinned, pinnedBy: pinned ? me.id : null, pinnedAt: pinned ? new Date().toISOString() : null };
    setDmMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    updateDmMessageDb(id, patch);
  };

  // --- client notes ------------------------------------------------------
  const addNote = (clientId: string, type: NoteType, body: string, projectId?: string | null, attachments?: Attachment[]) => {
    const note: ClientNote = { id: newId("cn_"), clientId, projectId: projectId ?? null, type, body, authorId: me.id, at: new Date().toISOString(), ...(attachments?.length ? { attachments } : {}) };
    setClientNotes((ns) => [note, ...ns]); // newest-first feed
    upsertClientNote(note);
    // @mentions notify, same as task comments — the one signal that pulls
    // people back into this feed instead of it going stale and unread.
    const where = projectId ? projectById(projectId)?.name : clientById(clientId)?.name;
    users.forEach((u) => {
      if (u.id !== me.id && mentionsUser(body, u.name)) notify(u.id, `${me.name} mentioned you in the ${where ?? "team"} chat`, null, { clientId, projectId, kind: "message" });
    });
  };
  const editNote = (note: ClientNote, body: string) => {
    const updated: ClientNote = { ...note, body };
    setClientNotes((ns) => ns.map((n) => (n.id === note.id ? updated : n)));
    upsertClientNote(updated);
  };
  const deleteNote = (note: ClientNote) => {
    setClientNotes((ns) => ns.filter((n) => n.id !== note.id));
    deleteClientNoteDb(note.id);
  };

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
  const headerTitleText = settingsView ? "Settings" : inboxView ? (dmUserId ? (userById(dmUserId)?.name ?? "Direct Message") : "Team Chat") : dirView === "clients" ? "Clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "My Work" : activeClient === "all" ? "All Tasks" : (activeProject && projectById(activeProject) ? projectById(activeProject)!.name : (clientById(activeClient)?.name ?? ""));
  const isClientDetail = !myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && !!clientById(activeClient);
  const showFilterControl = !inboxView && !dirView && !myWork && !settingsView && !(activeClient !== "all" && clientTab === "chat");
  const bellControl = (
    <div className="relative">
      <button onClick={() => { const opening = !bellOpen; setBellOpen(opening); if (opening) { setNotifications((ns) => ns.map((n) => (n.recipientId === me.id ? { ...n, read: true } : n))); markNotifsReadDb(me.id); } }} aria-label="Notifications" className="relative rounded-lg border bg-background p-2 text-muted hover:text-foreground">
        <I.bell />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[15px] font-semibold text-white">{unread}</span>}
      </button>
      {bellOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border bg-surface shadow-xl">
          <div className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {myNotifs.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-muted">You&apos;re all caught up.</div>}
            {myNotifs.map((n) => (<button key={n.id} onClick={() => { if (n.taskId) setOpenTaskId(n.taskId); setBellOpen(false); }} className="flex w-full gap-2.5 border-b px-4 py-2.5 text-left last:border-0 hover:bg-background"><I.comment className="mt-0.5 shrink-0 text-accent" /><div><div className="text-[15px] leading-snug">{n.text}</div><div className="text-[13px] text-muted">{timeAgo(n.at)}</div></div></button>))}
          </div>
        </div>
      </>)}
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
  const groupSortControl = (
    <div className="relative">
      <button onClick={() => setGroupSortOpen((o) => !o)} title="Group & sort" className="rounded-md border bg-background p-2 text-muted hover:text-foreground"><I.list /></button>
      {groupSortOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setGroupSortOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] space-y-2.5 rounded-xl border bg-surface p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Group &amp; sort</span>
            {(sortBy !== "due" || groupBy !== "priority") && <button onClick={() => { setGroupBy("priority"); setSortBy("due"); }} className="text-[13px] font-medium text-accent">Reset</button>}
          </div>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Group by</span><select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="status">Status</option><option value="priority">Priority</option><option value="due">Due date</option><option value="project">Project</option></select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Sort</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="manual">Manual</option><option value="due">Due date</option><option value="priority">Priority</option><option value="title">Task name</option><option value="status">Status</option><option value="assignee">Assignee</option></select></label>
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
      <button onClick={() => setFilterMenuOpen((o) => !o)} title="Filter" className="relative rounded-md border bg-background p-2 text-muted hover:text-foreground">
        <I.filter />
        {activeFilterCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[13px] font-semibold text-white">{activeFilterCount}</span>}
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
      <button onClick={() => setColumnsOpen((o) => !o)} title="Columns & density" className="rounded-md border bg-background p-2 text-muted hover:text-foreground"><I.grid /></button>
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
    <button onClick={() => setBulkAddOpen(true)} title="Paste a list and let AI create the tasks"
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
          {activeClient !== "all" && !activeProject && canMessageClient(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); openCompose("email"); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background sm:hidden"><I.comment /> Email</button>
          )}
          {activeClient !== "all" && !activeProject && canMessageClient(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); openCompose("sms"); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background sm:hidden"><I.comment /> SMS</button>
          )}
          <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Share</div>
          <button onClick={() => { setHeaderMoreOpen(false); copyLink({ view: null, client: activeClient, project: activeProject, task: null, clientTab, vaultFolder: null, dm: null }); }}
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
      <aside className={`sidebar-dark fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r bg-surface transition-transform ${sidebarHidden ? "md:hidden" : "md:static md:translate-x-0"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Account block, promoted from the sidebar footer to the top in place
            of the old app-branding header (Derek's call). */}
        {/* Account block. Three borderless icon buttons, not four bordered
            ones: the old Team Chat button was pure duplication once Team Chat
            became the first nav item right below (which carries the unread dot
            itself), and four bordered boxes crowded the name down to "De…".
            Dropping the borders + tightening the gap gives the name its row
            back while keeping every action one click away. */}
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-3">
          <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ width: 30, height: 30, background: me.color }}>{me.initials}</span>
          <div className="ml-1 min-w-0 flex-1 leading-tight"><div className="truncate text-[15px] font-medium">{me.name}</div><div className="text-[13px] capitalize text-muted">{me.role}</div></div>
          <button onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setDirView(null); setSidebarOpen(false); setOpenTaskId(null); setSettingsView(true); }} title="Settings" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground"><I.gear /></button>
          <button onClick={toggleTheme} title={`Theme: ${theme === "auto" ? `Auto (${resolveTheme(theme)} now)` : theme[0].toUpperCase() + theme.slice(1)} — click to change`} className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">{resolveTheme(theme) === "light" ? <I.moon /> : <I.sun />}</button>
          <button onClick={onSignOut} title="Sign out" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-background hover:text-red-500"><I.logout /></button>
        </div>

        {/* Dashboard, Conversations, and Clients/Projects/Personal, all one
            block (Derek: put them together "so they use less space") — no
            divider/gap between them, just Pinned below stays its own
            section. DMs under Conversations are parked per
            Derek's ask ("we don't need DMs for now, just the team — if they
            want to chat with someone specifically they can use the @") but
            not deleted, just admin-toggled off by default. */}
        <nav className="shrink-0 space-y-0.5 px-2">
          {navVisible.work && <SideItem active={myWork} title="My Work (press 1)" onClick={() => goToView("dashboard")}><I.grid className="text-muted" /> <span>My Work</span><span className="ml-auto text-[13px] text-muted">{myAssignedClients.length + myAssignedProjects.length}</span></SideItem>}
          {/* Directly under My Work, which stays exactly as it was — this is
              a second way in, not a replacement. Deliberately has no number
              shortcut: NAV_KEY_VIEWS is documented as sidebar order, and
              slotting All Tasks in at 2 would have shifted Team Chat through
              Personal down one and broken existing muscle memory for a key
              nobody asked for. */}
          {navVisible.work && <SideItem active={allTasksView} title="Every task across all clients, by due date" onClick={() => goToView("alltasks")}><I.list className="text-muted" /> <span>All Tasks</span></SideItem>}
          {/* "Client replies" nav item removed (Derek, 2026-08-09) — My Work
              and Follow Up already surface an open conversation-priority
              task each their own way (hasOpenConversationTask / Follow Up's
              own task-driven tiers); a third place to check the same signal
              was redundant, not additional coverage. */}
          {navVisible.inbox && (<>
            <SideItem active={inboxView && dmUserId === null} title="Team Chat (press 2)" onClick={openTeamChat}><I.comment className="text-muted" /> <span>Team Chat</span>{teamChatUnread > 0 && (
              // Literal unread team-chat messages only — general notifications
              // (task assignments, client replies, etc.) have their own home
              // on the bell, not this nav item (Derek, Aug 4). Capped display
              // so a long weekend doesn't stretch the sidebar row.
              <span title={`${teamChatUnread} unread message${teamChatUnread === 1 ? "" : "s"}`} className="ml-auto rounded-full bg-accent px-1.5 text-[12px] font-semibold leading-[18px] text-white">{teamChatUnread > 99 ? "99+" : teamChatUnread}</span>
            )}</SideItem>
            {dmEnabled && users.filter((u) => u.id !== me.id).map((u) => (
              <SideItem key={u.id} active={inboxView && dmUserId === u.id} onClick={() => openDm(u.id)}>
                <Avatar id={u.id} size={20} /> <span className="min-w-0 flex-1 truncate text-left">{u.name}</span>
                {dmUnread(u.id) && <span title="Unread messages" className="ml-auto h-2 w-2 rounded-full bg-accent" />}
              </SideItem>
            ))}
          </>)}
          <SideItem active={dirView === "clients"} title="Clients (press 3)" onClick={() => goToView("clients")}><I.user className="text-muted" /> <span>Clients</span><span className="ml-auto text-[13px] text-muted">{clientList.length}</span></SideItem>
          {clients.some((c) => c.id === WORKSPACE_CLIENT_ID) && (
            <SideItem active={dirView === "projects"} title="Projects (press 4)" onClick={() => goToView("projects")}><I.folder className="text-muted" /> <span>Projects</span><span className="ml-auto text-[13px] text-muted">{workspaceProjects.length}</span></SideItem>
          )}
          {navVisible.personal && <SideItem active={personalView} title="Personal (press 5)" onClick={() => goToView("personal")}><I.check className="text-muted" /> <span>Personal</span><span className="ml-auto text-[13px] text-muted">{myPersonalTasks.filter((t) => t.status !== "done").length}</span></SideItem>}
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
                  <SideItem key={c.id} active={active} onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(c.id); setActiveProject(null); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
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
                  <SideItem key={p.id} active={active} onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(p.clientId); setActiveProject(p.id); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
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
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
        {/* Mobile header (Option A) — compact title bar + full-width segmented
            tabs. Reuses the shared bell/filter/overflow controls. The full
            desktop header below is hidden on phones. */}
        <header className="relative z-10 flex flex-col gap-2 border-b bg-surface px-3 py-2 shadow-soft sm:hidden">
          <div className="flex items-center gap-2">
            <button onClick={toggleSidebar} aria-label="Menu" className="shrink-0 rounded-lg border p-2 text-muted"><I.menu /></button>
            <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{headerTitleText}</h1>
            {!(inboxView && !dmUserId) && bellControl}
            {isClientDetail && overflowControl}
          </div>
          {isClientDetail ? (
            <div className="flex items-center gap-2">
              <div className="flex flex-1 rounded-lg bg-background p-0.5">
                <button onClick={() => setClientTab("tasks")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${clientTab === "tasks" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Tasks</button>
                <button onClick={() => setClientTab("chat")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${clientTab === "chat" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Journal</button>
              </div>
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
                <button onClick={() => setDashboardView("completed")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${dashboardView === "completed" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Completed</button>
              </div>
            </div>
          ) : showFilterControl ? (
            <div className="flex items-center gap-2">
              {activeClient === "all" && !myWork && canAdmin && (
                <div className="inline-flex overflow-hidden rounded-md border text-[13px]">
                  <button onClick={() => setAllTasksScope("mine")} className={`px-3 py-1.5 font-medium ${allTasksScope === "mine" ? "bg-accent-soft text-accent" : "bg-background text-muted"}`}>Mine</button>
                  <button onClick={() => setAllTasksScope("all")} className={`px-3 py-1.5 font-medium ${allTasksScope === "all" ? "bg-accent-soft text-accent" : "bg-background text-muted"}`}>All</button>
                </div>
              )}
              <div className="flex-1" />
              {followingControl}
              {groupSortControl}
              {filterMenuControl}
              {columnsControl}
            </div>
          ) : null}
        </header>

        <header className="relative z-10 hidden flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-surface px-4 py-2 shadow-soft sm:flex sm:gap-y-2 sm:px-5 sm:py-3">
          <button onClick={toggleSidebar} title="Show/hide sidebar" className="rounded-lg border p-2 text-muted hover:text-foreground"><I.menu /></button>
          <div className="min-w-0">
            {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject && projectById(activeProject) ? (<>
              <h1 className="flex items-center gap-1.5 truncate text-[20px] font-semibold"><I.folder className="shrink-0 text-muted" /> {projectById(activeProject)!.name}</h1>
              <p className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
                <button onClick={() => goToView("dashboard")} className="hover:text-foreground hover:underline">My Work</button>
                <span>›</span>
                <button onClick={() => { setDirView("clients"); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setOpenTaskId(null); }} className="hover:text-foreground hover:underline">Clients</button>
                <span>›</span>
                <button onClick={() => setActiveProject(null)} className="hover:text-foreground hover:underline">{clientById(activeClient)?.name}</button>
                <span>·</span>
                {(() => { const pg = projectProgress(activeProject); return (<span className="inline-flex items-center gap-1.5">{pg.done}/{pg.total} done<span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-border align-middle"><span className="block h-full rounded-full bg-green-500 transition-all" style={{ width: `${pg.pct}%` }} /></span>{pg.pct}%</span>); })()}
              </p>
            </>) : (<>
              <h1 className="flex items-center gap-2 truncate text-[20px] font-semibold">
                {settingsView ? "Settings" : inboxView ? (dmUserId ? (userById(dmUserId)?.name ?? "Direct Message") : "Team Chat") : dirView === "clients" ? "Clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "My Work" : activeClient === "all" ? "All Tasks" : (ghlContactUrlFor(activeClient) ? <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="hover:text-accent hover:underline">{clientById(activeClient)?.name}</a> : clientById(activeClient)?.name)}
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
                  <button onClick={() => goToView("dashboard")} className="hover:text-foreground hover:underline">My Work</button>
                  <span>›</span>
                  <button onClick={() => { setDirView("clients"); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setOpenTaskId(null); }} className="hover:text-foreground hover:underline">Clients</button>
                  <span>›</span>
                </>)}
                <span>{settingsView ? "Integrations, team, templates, playbooks, and API tokens" : inboxView ? (dmUserId ? "Private — only the two of you can see this" : "Talk to the team — everyone's in this one") : dirView === "clients" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"}` : dirView === "projects" ? `${workspaceProjects.length} project${workspaceProjects.length === 1 ? "" : "s"}` : personalView ? "Your private to-dos — only visible to you" : myWork ? "" : activeClient === "all" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}` : clientCompany(clientById(activeClient))}</span>
              </p>
            </>)}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          {/* This is the "All Tasks" scope toggle — it belongs there only. */}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient === "all" && canAdmin && (
            <div className="inline-flex overflow-hidden rounded-md border" title="VAs only ever see their own tasks here regardless of this toggle">
              <button onClick={() => setAllTasksScope("mine")} className={`px-2.5 py-1.5 text-[13px] font-medium ${allTasksScope === "mine" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Mine</button>
              <button onClick={() => setAllTasksScope("all")} className={`px-2.5 py-1.5 text-[13px] font-medium ${allTasksScope === "all" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>All</button>
            </div>
          )}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && (
            <div className="inline-flex overflow-hidden rounded-md border">
              <button onClick={() => setClientTab("tasks")} className={`px-2.5 py-1.5 text-[13px] font-medium ${clientTab === "tasks" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Tasks</button>
              <button onClick={() => setClientTab("chat")} className={`px-2.5 py-1.5 text-[13px] font-medium ${clientTab === "chat" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Journal · {(() => {
                // Counts the whole merged feed (notes + messages + task
                // comments + completions), not just typed notes — matches
                // what ClientJournal.tsx actually renders, same scoping
                // it uses for its own `messages`/`tasks` props.
                const noteCount = clientNotes.filter((n) => (activeProject ? n.projectId === activeProject : n.clientId === activeClient && !n.projectId)).length;
                const messageCount = activeProject ? 0 : (() => { const ct = contactForClient(activeClient); return ct ? messages.filter((m) => m.contactId === ct.id).length : 0; })();
                const activityCount = baseTasks.reduce((sum, t) => sum + t.comments.filter((c) => c.kind !== "event" || isCompletionEvent(c.body)).length, 0);
                return noteCount + messageCount + activityCount;
              })()}</button>
            </div>
          )}
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
                const c = clientById(activeClient)!;
                if (!c.trialEndsAt) return null;
                return (
                  <span className="inline-flex items-center rounded-md border px-2 py-1 text-[13px] font-medium text-muted" title="14 day trial window, set when this deal closed">
                    Trial ends {formatDue(c.trialEndsAt)}
                  </span>
                );
              })()}
              {/* Review controls — only when the open scope currently needs a
                  review. "Reviewed" clears it (stamps reviewedAt=today); "Next"
                  jumps to the next client/project still awaiting review. */}
              {(() => {
                const scopedProject = activeProject ? projectById(activeProject) : null;
                const needsReview = scopedProject ? projectNeedsReview(scopedProject.id, me.id) : clientNeedsReview(activeClient, me.id);
                if (!needsReview) return null;
                return (
                  <span className="inline-flex overflow-hidden rounded-md border border-teal-500/40">
                    <button onClick={() => (scopedProject ? setProjectReviewed(scopedProject.id) : setClientReviewed(activeClient))}
                      title="Mark reviewed — clears this from the Review list until the next check-in"
                      className="inline-flex items-center gap-1 bg-teal-500/10 px-2.5 py-1.5 text-[13px] font-medium text-teal-600 hover:bg-teal-500/20"><I.check /> <span className="hidden sm:inline">Reviewed</span></button>
                    {/* Only when there's actually something outstanding, and
                        only for someone allowed to message this client. */}
                    {!scopedProject && waitingTasksFor(activeClient).length > 0 && canMessageClient(activeClient) && (
                      <button onClick={() => openRemindClient(activeClient)}
                        title="Email this client the items we're still waiting on, with their portal link"
                        className="border-l border-teal-500/40 bg-teal-500/10 px-2.5 py-1.5 text-[13px] font-medium text-teal-600 hover:bg-teal-500/20">
                        Remind ({waitingTasksFor(activeClient).length})
                      </button>
                    )}
                    <button onClick={() => goToNextReview(activeClient, activeProject)}
                      title="Go to the next client/project that needs review"
                      className="border-l border-teal-500/40 bg-teal-500/10 px-2 py-1.5 text-[13px] font-medium text-teal-600 hover:bg-teal-500/20">Next ›</button>
                  </span>
                );
              })()}
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
                <button onClick={() => setDashboardView("completed")} className={`px-2.5 py-1.5 text-[13px] font-medium ${dashboardView === "completed" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Completed</button>
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

          {/* Hidden on the Conversations page (team chat) — the bell's own
              notifications already surface everything relevant elsewhere,
              and it was redundant/unwanted floating over a page that's
              already a live feed (Derek, Aug 4). Still shown on DMs,
              Dashboard, client pages, etc. */}
          {!(inboxView && !dmUserId) && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => { const opening = !bellOpen; setBellOpen(opening); if (opening) { setNotifications((ns) => ns.map((n) => (n.recipientId === me.id ? { ...n, read: true } : n))); markNotifsReadDb(me.id); } }} className="relative rounded-lg border bg-background p-2 text-muted hover:text-foreground">
                <I.bell />
                {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[15px] font-semibold text-white">{unread}</span>}
              </button>
              {bellOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-80 overflow-hidden rounded-xl border bg-surface shadow-xl">
                  <div className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Notifications</div>
                  <div className="max-h-96 overflow-y-auto">
                    {myNotifs.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-muted">You&apos;re all caught up.</div>}
                    {myNotifs.map((n) => (<button key={n.id} onClick={() => { if (n.taskId) setOpenTaskId(n.taskId); setBellOpen(false); }} className="flex w-full gap-2.5 border-b px-4 py-2.5 text-left last:border-0 hover:bg-background"><I.comment className="mt-0.5 shrink-0 text-accent" /><div><div className="text-[15px] leading-snug">{n.text}</div><div className="text-[13px] text-muted">{timeAgo(n.at)}</div></div></button>))}
                  </div>
                </div>
              </>)}
            </div>
          </div>
          )}
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
            playbooks={playbooks} onSavePlaybook={savePlaybook} onDeletePlaybook={deletePlaybook} onLoadPlaybook={loadPlaybook}
            dmEnabled={dmEnabled} onSetDmEnabled={setDmEnabled}
            onRestoreClient={restoreClient} onRestoreProject={restoreProjectFromTrash} onRestoreTask={restoreTaskFromTrash}
            onPurgeClient={purgeClient} onPurgeProject={purgeProject} onPurgeTask={purgeTask}
          />
        ) : inboxView && dmUserId ? (
          // A DM thread has no "Activity" sub-view (that's a Team Chat-page
          // concept — task comments/mentions addressed to you, not private
          // messages), so it skips the Chat/Activity tab bar entirely.
          <TeamChat key={dmUserId} me={me} scope={{ type: "dm", other: userById(dmUserId)! }}
            messages={dmMessages.filter((m) => m.conversationId === dmConversationId(me.id, dmUserId))}
            onSend={(body, attachments, replyToId) => sendDmMessage(dmUserId, body, attachments, replyToId)} onDelete={deleteDmMessage}
            onPin={pinDmMessage} onUploadFile={(file) => uploadOneImage(`dm/${dmConversationId(me.id, dmUserId)}`, file)} onOpenFile={downloadFile} onGetSignedUrl={signedUrlForFile} />
        ) : inboxView ? (
          // Team-wide chat, full width — task comments/mentions ("Activity")
          // moved to its own Dashboard tab (Derek: "everything is wired into
          // each contact or tasks... it doesn't belong here"), so this is
          // just the workspace feed now, same footing as a DM thread above.
          <TeamChat me={me} scope={{ type: "team" }} messages={teamMessages} onSend={sendTeamMessage} onDelete={deleteTeamMessage}
            onPin={pinTeamMessage} onUploadFile={(file) => uploadOneImage("team-chat", file)} onOpenFile={downloadFile} onGetSignedUrl={signedUrlForFile} />
        ) : dirView === "clients" ? (
          <ClientsDirectory clients={sortedClients} clientCompany={(c) => clientCompany(c)} taskCount={clientTaskCount} tasksByClient={openTasksByClient} starred={starred} onToggleStar={toggleStar}
            needsReview={(id) => clientNeedsReview(id, me.id)}
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
          <GroupedList meId={me.id} groups={buildGroups(myPersonalTasks.filter(passesFilters))} showClient={false} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={["status", "due"]} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd quickAddHint="" onQuickAdd={quickAddPersonal} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} onAddComment={addComment} hideEmpty={hideEmpty} colOrder={colOrder} onReorderCols={reorderCols} />
        ) : myWork && dashboardView === "completed" ? (
          // Relocated from the Clients directory (Derek: "makes more sense
          // there") — same completionLog data, day-grouped feed of who
          // finished what and when.
          <CompletedLog rows={completionLog} onOpenTask={(_clientId, taskId) => setOpenTaskId(taskId)} />
        ) : myWork ? (
          <ClientsBoard groups={myWorkGroups} clientTaskCount={clientTaskCount} projectTaskCount={projectTaskCount} hasUnreadMessage={hasUnreadMessage} onOpenTask={setOpenTaskId}
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
            onSendMessage={activeProject || !canMessageClient(activeClient) ? undefined : (channel, subject, body, cc, bcc) => sendMessage(activeClient, channel, subject, body, undefined, cc, bcc)}
            onScheduleMessage={activeProject || !canMessageClient(activeClient) ? undefined : (channel, subject, body, scheduledAt, cc, bcc) => scheduleMessage(activeClient, channel, subject, body, scheduledAt, undefined, cc, bcc)}
            scheduled={scheduledMessages[activeClient] ?? []}
            onLoadScheduled={() => loadScheduledMessages(activeClient)}
            onCancelScheduled={(id) => cancelScheduledMessage(id, activeClient)}
            toContact={activeProject ? null : contactForClient(activeClient)}
            ccContacts={contacts}
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
            onRenameFolder={(id, name) => { const f = vaultFolders.find((x) => x.id === id); if (f) renameVaultFolder(f, name); }}
            onDeleteFolder={deleteVaultFolder}
            onCopyFolderLink={copyFolderLink}
            onSetNoteAttachmentFolder={setNoteAttachmentFolder}
            initialFolderFilter={initialVaultFolder}
          />
        ) : (
          <>
          {activeClient !== "all" && (() => {
            const cf = foldersForClient(activeClient);
            const cl = projectsForClient(activeClient);
            // Only show the rail when there's real structure to navigate (a
            // folder, or more than one list) — or for an admin, who always
            // gets the +Folder/+List affordances to organize.
            if (cf.length === 0 && cl.filter((l) => !l.folderId).length <= 1 && !canAdmin) return null;
            return (
              <FolderRail folders={cf} lists={cl} activeFolder={activeFolder} activeProject={activeProject} canAdmin={canAdmin}
                starredLists={starredLists} onToggleStarList={toggleStarList}
                onSelectAll={() => { setActiveFolder(null); setActiveProject(null); }}
                onSelectFolder={(id) => { setActiveFolder(id); setActiveProject(null); setGroupBy("project"); }}
                onSelectList={(id) => { setActiveProject(id); setActiveFolder(null); }}
                onCreateFolder={() => createFolder(activeClient)} onCreateList={(fid) => addProject(activeClient, fid)}
                onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onRenameList={renameProject} onDeleteList={deleteProject} onMoveList={moveListToFolder}
                onReorderFolders={(ids) => reorderFolders(activeClient, ids)} onReorderLists={(fid, ids) => reorderLists(activeClient, fid, ids)} />
            );
          })()}
          {activeProject === playbookProjectId(activeClient) ? (() => {
            // Owner Growth Plan: fixed Level sections, catalog order. No
            // onDropInGroup/onMergeTasks (no drag-to-recategorize or merge),
            // and no selectedIds/onToggleSelect either — that's what the
            // multi-select bulk action bar (Move to…/merge) keys off of, so
            // omitting it here means a playbook step can never be selected
            // for a bulk move in the first place. Combined with the
            // per-task Client/Project lock in TaskDrawer.tsx (playbookStepKey
            // gate), there's no path left to relocate a step out of its
            // business's Playbook or out of its fixed Level — status,
            // priority, and due date remain fully editable, only the plan's
            // shape itself is locked.
            const pb = playbookCompletion(activeClient, tasks);
            const foundationDone = ["claim_listing", "complete_listing", "first_offer", "add_events"].every((k) => pb.done.has(k));
            const allDone = pb.doneCount === pb.total;
            return (
              <>
                <div className="mb-3 rounded-xl border bg-surface p-4">
                  <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">{PLAYBOOK_INTRO.title}</div>
                  <div className="mt-1 text-[14px] text-muted">{PLAYBOOK_INTRO.body}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
                    {PLAYBOOK_INTRO.items.map((it) => <li key={it}>{it}</li>)}
                  </ul>
                  <div className="mt-2 text-[13px] text-muted">📈 {PLAYBOOK_INTRO.youGet}</div>
                </div>
                {foundationDone && (
                  <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft p-4">
                    <div className="text-[15px] font-semibold text-accent">🎉 {PLAYBOOK_MILESTONE.title}</div>
                    <div className="mt-1 text-[14px]">{PLAYBOOK_MILESTONE.intro}</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
                      {PLAYBOOK_MILESTONE.items.map((it) => <li key={it}>{it}</li>)}
                    </ul>
                  </div>
                )}
                {activeFilterBar}
                <GroupedList meId={me.id} groups={buildPlaybookGroups(baseTasks.filter(passesFilters))} showClient={false} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={activeClient.startsWith("cl_")} quickAddHint="" onQuickAdd={quickAdd} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} onAddComment={addComment} hideEmpty={false} colOrder={colOrder} onReorderCols={reorderCols} />
                <div className="mt-3 rounded-xl border bg-surface p-4">
                  <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Always running for you</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-muted">
                    {PLAYBOOK_ALWAYS_RUNNING.map((it) => <li key={it}>{it}</li>)}
                  </ul>
                </div>
                {allDone && (
                  <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft p-4">
                    <div className="text-[15px] font-semibold text-accent">🎓 You&apos;ve graduated</div>
                    <div className="mt-1 text-[14px]">{PLAYBOOK_FINISH_LINE}</div>
                  </div>
                )}
              </>
            );
          })() : activeProject && stagesForProject(activeProject).length > 0 ? (
            <StageBoard stages={stagesForProject(activeProject)} tasks={baseTasks.filter(passesFilters)} canAdmin={canAdmin}
              onOpenTask={setOpenTaskId} onSetTaskStage={setTaskStage} onQuickAdd={(stageId, title) => quickAddInStage(activeProject, stageId, title)}
              onCreateStage={() => createStage(activeProject)} onRenameStage={renameStage} onToggleStageIsDone={toggleStageIsDone} onDeleteStage={deleteStage}
              onReorderStages={(ids) => reorderStages(activeProject, ids)} />
          ) : (
            <>
            {activeFilterBar}
            <GroupedList meId={me.id} groups={buildGroups(sortTasks(baseTasks.filter(passesFilters)))} showClient={activeClient === "all"} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={activeClient.startsWith("cl_")} quickAddHint="Pick a client on the left to add tasks." onQuickAdd={quickAdd} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} onAddComment={addComment} hideEmpty={hideEmpty} onDropInGroup={groupBy === "status" || groupBy === "priority" ? dropTaskInGroup : undefined} onMergeTasks={requestMerge} colOrder={colOrder} onReorderCols={reorderCols} selectedIds={selectedTaskIds} onToggleSelect={toggleTaskSelection} />
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
            // "waiting" is a task flag, not a real member id — mirror the
            // single-task pickers (InlineAssignee/TaskDrawer): set the flag and
            // clear the assignee. And any real assignment must clear the flag,
            // else the row keeps rendering the client "waiting" badge.
            if (v === "waiting") bulkPatch({ waitingOnClient: true, assigneeId: null }, "Set waiting on client");
            else if (v === "unassigned") bulkPatch({ assigneeId: null, waitingOnClient: false }, "Unassign");
            else if (v) bulkPatch({ assigneeId: v, waitingOnClient: false }, `Assign to ${users.find((u) => u.id === v)?.name ?? "user"}`);
            e.target.value = "";
          }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Assignee…</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ status: e.target.value as TaskStatus }, `Set status to ${STATUS_META[e.target.value as TaskStatus]?.label ?? e.target.value}`); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Status…</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ priority: e.target.value as Priority }, `Set priority to ${PRIORITY_META[e.target.value as Priority]?.label ?? e.target.value}`); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Priority…</option>{PRIORITY_ORDER.filter(isManuallyAssignable).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select>
          <input type="date" onChange={(e) => { if (e.target.value) { bulkPatch({ due: e.target.value }, `Set due date to ${e.target.value}`); e.target.value = ""; } }} title="Due date" className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none" />
          <button onClick={() => bulkPatch({ due: null }, "Removed due date")} title="Clear the due date on every selected task" className="rounded-md border bg-background px-2 py-1 text-[15px] text-muted hover:bg-danger-soft hover:text-danger">Remove dates</button>
          <div className="w-40">
            <SearchableSelect value="" onChange={(v) => v && bulkMoveToClient(v)}
              options={[...workableClients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Move to…" searchPlaceholder="Search clients…"
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
          <button onClick={bulkDelete} title="Delete selected tasks" className="rounded-md border border-danger/40 px-2.5 py-1 text-[15px] font-medium text-danger hover:bg-danger/10">Delete</button>
          <button onClick={clearSelection} className="rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-background">Clear</button>
        </div>
      )}

      {remindClientId && (
        <RemindClientModal
          clientName={clientById(remindClientId)?.name ?? "this client"}
          tasks={waitingTasksFor(remindClientId)}
          link={remindLink}
          sending={remindSending}
          onSend={(subject, body) => sendClientReminder(remindClientId, subject, body)}
          onCancel={closeRemindClient}
        />
      )}
      {bulkAddOpen && (
        <BulkAddModal
          clientName={clientById(activeClient)?.name ?? "this client"}
          listName={activeProject ? (projectById(activeProject)?.name ?? "Tasks") : "Tasks"}
          busy={bulkAddBusy}
          onParse={parseTaskList}
          onCreate={createTasksFromList}
          onCancel={() => setBulkAddOpen(false)}
        />
      )}
      {openTask && (
        <TaskDrawer task={openTask} clientById={clientById} projectById={projectById} contactById={contactById}
          full={drawerFull} onToggleFull={toggleDrawerFull}
          navIndex={openTaskIdx} navTotal={navTaskIds.length} onPrev={() => goToTask(-1)} onNext={() => goToTask(1)}
          onClose={() => setOpenTaskId(null)} onPatch={(patch) => patchTask(openTask.id, patch)} onDelete={() => deleteTask(openTask.id)} onAddComment={(body, attachments) => addComment(openTask.id, body, attachments)}
          onAddFiles={(files) => addFiles(openTask.id, files)} onDownloadFile={downloadFile} onDownloadFileAs={downloadFileAs} onDownloadAll={downloadAllAsZip} zippingIds={zippingIds} onRemoveFile={(att) => removeFile(openTask.id, att)} uploadProgress={uploadProgress} onPushGhl={() => pushToGhl(openTask.id)} ghlBusy={ghlBusy} ghlLinkable={!!ghlTargetFor(openTask)} onUnlinkGhl={() => unlinkGhl(openTask.id)} allClients={[...workableClients].sort((a, b) => a.name.localeCompare(b.name))} onMoveClient={(cid) => moveTaskToClient(openTask.id, cid)} clientProjects={projectsForClient(openTask.clientId)} onSetProject={(pid) => { if (openTask.playbookStepKey) { pushToast("Playbook steps can't be moved to a different list."); return; } patchTask(openTask.id, { projectId: pid }); }} onNewProject={() => moveTaskToNewProject(openTask.id, openTask.clientId)} onRenameProject={() => renameProject(openTask.projectId)} onToggleSub={(sid) => toggleSub(openTask.id, sid)} onAddSub={(title) => addSub(openTask.id, title)} onRenameSub={(sid, title) => renameSub(openTask.id, sid, title)} onDeleteSub={(sid) => deleteSub(openTask.id, sid)} onPatchSub={(sid, patch) => patchSub(openTask.id, sid, patch)} onToggleLabel={(lid) => toggleLabel(openTask.id, lid)} onCopyLink={() => copyLink({ view: null, client: "all", project: null, task: openTask.id, clientTab: null, vaultFolder: null, dm: null })} onOpenMerge={() => setMergeSourceId(openTask.id)} onOpenClientList={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(openTask.clientId); setActiveProject(openTask.projectId); setClientTab("tasks"); setOpenTaskId(null); }} templates={taskTemplates} onApplyTemplate={(templateId) => applyTemplate(openTask.id, templateId)} onUploadCommentImage={(file) => uploadOneImage("comments", file)} onCopyAttachmentLink={copyAttachmentLink} onGetSignedUrl={signedUrlForFile} messages={messages.filter((m) => m.taskId === openTask.id)} onMarkChannelRead={(channel) => markTaskChannelRead(openTask.id, channel)} linkedContactInfo={contactForClient(openTask.clientId)} ccContacts={contacts} onUploadMessageImage={(file) => uploadOneImage("messages", file)} onSendTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, attachments, cc, bcc) => sendMessage(openTask.clientId, channel, subject, body, attachments, cc, bcc, openTask.id) : undefined} onScheduleTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, scheduledAt, attachments, cc, bcc) => scheduleMessage(openTask.clientId, channel, subject, body, scheduledAt, attachments, cc, bcc, openTask.id) : undefined} sendingMessage={sendingMessage} onDraftMessage={(channel, prompt) => draftMessage(openTask.clientId, channel, prompt, openTask.projectId)} draftingMessage={draftingMessage} onGetTaskLink={() => getClientShareUrl(openTask.clientId, { projectId: openTask.projectId, taskId: openTask.id })} canAdmin={canAdmin} onDeleteMessage={deleteMessage} onEditMessage={editMessage} onCopyClientLink={() => copyClientShareLink(openTask.clientId, openTask.projectId)} onDraftDescription={draftDescription} draftingDescription={draftingDescription} pushToast={pushToast} />
      )}

      {addClientOpen && <AddClientModal subAccounts={subAccounts} contacts={contacts} existingIds={new Set(clients.map((c) => c.id))} onAdd={addClientContact} onClose={() => setAddClientOpen(false)} />}
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
      {promptDialog && <PromptModal {...promptDialog} onCancel={() => setPromptDialog(null)} />}
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
              <h2 className="text-[16px] font-semibold">Client settings — {settingsClient.name}</h2>
              <button onClick={() => setClientSettingsOpen(false)} className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"><I.close /></button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Client portal</div>
                <div className="space-y-3">
                  <label className="flex items-start justify-between gap-3">
                    <span><span className="block text-[14px] font-medium">Client can add requests</span><span className="block text-[13px] text-muted">They can submit new task requests from their portal link, not just reply to what we send.</span></span>
                    <button onClick={() => toggleClientCanRequestNewTasks(activeClient)} className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition ${settingsClient.canRequestNewTasks ? "bg-accent" : "bg-border"}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition ${settingsClient.canRequestNewTasks ? "translate-x-4" : "translate-x-0.5"}`} /></button>
                  </label>
                  <label className="flex items-start justify-between gap-3">
                    <span><span className="block text-[14px] font-medium">Client sees all tasks</span><span className="block text-[13px] text-muted">Their portal also lists what the team is working on and what&apos;s been completed, not just what needs them. Every non-private task on this account becomes readable by the client.</span></span>
                    <button onClick={() => toggleClientPortalShowsAllTasks(activeClient)} className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition ${settingsClient.portalShowsAllTasks ? "bg-accent" : "bg-border"}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition ${settingsClient.portalShowsAllTasks ? "translate-x-4" : "translate-x-0.5"}`} /></button>
                  </label>
                  <label className="flex items-start justify-between gap-3">
                    <span><span className="block text-[14px] font-medium">Client sees growth plan</span><span className="block text-[13px] text-muted">Their portal shows the Playbook progress card — what&apos;s done and what&apos;s next.</span></span>
                    <button onClick={() => toggleClientShowGrowthPlan(activeClient)} className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition ${settingsClient.showGrowthPlan ? "bg-accent" : "bg-border"}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition ${settingsClient.showGrowthPlan ? "translate-x-4" : "translate-x-0.5"}`} /></button>
                  </label>
                  <label className="flex items-start justify-between gap-3">
                    <span><span className="block text-[14px] font-medium">Client does A2P texting</span><span className="block text-[13px] text-muted">Includes the A2P registration steps in this client&apos;s Playbook checklist.</span></span>
                    <button onClick={() => toggleClientDoesA2P(activeClient)} className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition ${settingsClient.doesA2P ? "bg-accent" : "bg-border"}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition ${settingsClient.doesA2P ? "translate-x-4" : "translate-x-0.5"}`} /></button>
                  </label>
                </div>
                <button onClick={() => copyClientShareLink(activeClient)} className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"><I.link className="h-3.5 w-3.5" /> Copy portal link</button>
              </div>
              <div className="border-t pt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">GoHighLevel</div>
                {settingsClient.linkedContactId ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[14px] text-accent"><span className="h-2 w-2 rounded-full bg-accent" /> Connected</span>
                    <span className="flex items-center gap-3">
                      {ghlContactUrlFor(activeClient) && <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-accent hover:underline">Open in GHL</a>}
                      {canAdmin && <button onClick={() => linkClientToContact(activeClient, null)} className="text-[13px] font-medium text-muted hover:text-danger">Unlink</button>}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[14px] text-muted"><span className="h-2 w-2 rounded-full bg-border" /> Not linked</span>
                    {canAdmin && <button onClick={() => { setClientSettingsOpen(false); setGhlLinkSearch(""); setGhlLinkOpen(true); }} className="text-[13px] font-medium text-accent hover:underline">Link to GoHighLevel</button>}
                  </div>
                )}
              </div>
              <div className="border-t pt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Ownership</div>
                {/* There's no separate "owner" field in the data model — Following
                    (assignedTo) already IS what puts a client in someone's My Work
                    queue (see assignedClientsFor), so it does double duty as
                    ownership here rather than this sheet inventing a second field
                    the brief's open question proposed but the app doesn't need. */}
                <p className="mb-2 text-[13px] text-muted">Following decides whose My Work queue this client shows up in.</p>
                {canAdmin ? (
                  <div className="flex flex-col gap-0.5">
                    {users.map((u) => {
                      const on = (settingsClient.assignedTo ?? []).includes(u.id);
                      return (
                        <button key={u.id} onClick={() => toggleClientAssignment(activeClient, u.id)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on && <I.check />}</span>
                          <Avatar id={u.id} size={18} /> <span className="truncate text-[13px]">{u.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[13px] text-muted">{(settingsClient.assignedTo ?? []).length === 0 ? "Nobody yet" : (settingsClient.assignedTo ?? []).map((uid) => userById(uid)?.name).filter(Boolean).join(", ")}</div>
                )}
              </div>
              {canAdmin && (
                <div className="space-y-2 border-t pt-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Danger zone</div>
                  {activeClient.startsWith("cl_") && (
                    <button onClick={() => { setClientSettingsOpen(false); setMergeClientState({ a: settingsClient }); }}
                      className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-[14px] hover:bg-background"><I.repeat /> Merge with another client…</button>
                  )}
                  {settingsClient.status !== "past_client" && (
                    <button onClick={() => { setClientSettingsOpen(false); setConfirmDialog({ title: `Archive ${settingsClient.name}?`, message: "Marks this client Past Client. Their tasks and history stay intact — this just takes them out of active views.", confirmLabel: "Archive", danger: true, onConfirm: () => { setConfirmDialog(null); setClientStatus(activeClient, "past_client"); } }); }}
                      className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-[14px] text-danger hover:bg-red-50"><I.close /> Archive client</button>
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
        onOpenClient={(id) => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(id); setActiveProject(null); setCmdkOpen(false); }}
        onOpenProject={(id) => {
          if (id === PERSONAL_PROJECT_ID) { setMyWork(false); setPersonalView(true); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setCmdkOpen(false); return; }
          const p = projects.find((x) => x.id === id); if (p) { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setActiveClient(p.clientId); setActiveProject(id); } setCmdkOpen(false);
        }}
        onAddContact={(contact) => { addClientContact(contact); setCmdkOpen(false); }}
        onClose={() => setCmdkOpen(false)} />}

      {/* Global quick-add-task FAB — defaults to bottom-LEFT (the composer's
          Send button and toasts live bottom-right), draggable so it can be
          parked anywhere, and hidden on the Journal tab so it never covers the
          message composer while writing/sending. */}
      {!(!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && clientTab === "chat") && (
        <button onPointerDown={onFabPointerDown} onPointerMove={onFabPointerMove} onPointerUp={onFabPointerUp}
          title="Add a task (drag to move)" aria-label="Add a task"
          style={fabPos ? { left: fabPos.x, top: fabPos.y, right: "auto", bottom: "auto" } : undefined}
          className={`fixed z-30 flex h-12 w-12 touch-none items-center justify-center rounded-full bg-accent text-white shadow-lg ring-2 ring-[color:var(--surface)] transition-all duration-200 hover:opacity-90 active:scale-95 ${fabScrolling ? "pointer-events-none scale-90 opacity-0" : ""} ${fabPos ? "" : "bottom-6 left-4 sm:left-6"}`}>
          <I.plus className="h-6 w-6" />
        </button>
      )}
      {quickAddOpen && (
        <QuickAddTask
          clients={workableClients}
          projectsFor={projectsForClient}
          companyFor={(id) => contactForClient(id)?.company}
          defaultClientId={activeClient.startsWith("cl_") ? activeClient : ""}
          defaultProjectId={activeProject}
          onCreate={createQuickTask}
          onClose={() => setQuickAddOpen(false)}
        />
      )}

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (<div key={t.id} className="flex items-center gap-3 rounded-lg bg-foreground px-3.5 py-2 text-[15px] font-medium text-[color:var(--surface)] shadow-lg"><span>{t.text}</span>{t.action && (<button onClick={() => { t.action!.run(); dismissToast(t.id); }} className="shrink-0 rounded-md border border-[color:var(--surface)]/35 px-2 py-0.5 text-[14px] font-semibold hover:bg-[color:var(--surface)]/15">{t.action.label}</button>)}{t.secondaryAction && (<button onClick={() => { t.secondaryAction!.run(); dismissToast(t.id); }} className="shrink-0 rounded-md bg-[color:var(--surface)] px-2 py-0.5 text-[14px] font-semibold text-foreground hover:opacity-90">{t.secondaryAction.label}</button>)}</div>))}
      </div>
    </div>
  );
}

