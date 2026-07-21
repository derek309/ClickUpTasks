"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  TODAY,
  TOMORROW,
  addDaysIso,
  daysBetween,
  THIS_MONDAY,
  THIS_WEEK_END,
  THIS_MONTH_END,
  NURTURE_CHECK_IN_DAYS,
  STATUS_META,
  STATUS_ORDER,
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
  type UnmatchedEmail,
  type Attachment,
  type Notification,
  type NotificationKind,
  type ClientLink,
  type ClientNote,
  type NoteType,
  type Comment,
  type Message,
  type MessageChannel,
  type Me,
  type Territory,
  type TaskTemplate,
  type Playbook,
  type PlaybookTask,
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
import { seedIfEmpty, fetchAll, fetchContacts, upsertTask, deleteTaskDb, upsertClient, bulkUpsertClients, upsertProject, deleteProjectDb, deleteClientDb, mergeClientsDb, insertNotif, markNotifsReadDb, markNotifReadDb, uploadTaskFile, signedUrlForFile, deleteTaskFile, upsertClientLink, deleteClientLinkDb, upsertClientNote, deleteClientNoteDb, appendCommentDb, fetchClaudeQueue, queueTaskDb, unqueueTaskDb, upsertTerritory, deleteTerritoryDb, upsertTaskTemplate, deleteTaskTemplateDb, upsertPlaybook, deletePlaybookDb, upsertVaultFolder, deleteVaultFolderDb, upsertFolder, deleteFolderDb, upsertStage, deleteStageDb, rowToTask, rowToClient, rowToNotif, rowToMessage, rowToClientNote, rowToTeamMessage, insertTeamMessage, deleteTeamMessageDb, updateTeamMessageDb, rowToDmMessage, insertDmMessage, deleteDmMessageDb, updateDmMessageDb, markMessagesReadDb, reassignMessagesTaskDb, insertMessage, markUnmatchedHandledDb, fetchUnmatchedDb, upsertContact } from "@/lib/db";
import { subscribeRealtime } from "@/lib/realtime";
import { Inbox } from "./cockpit/Inbox";
import SettingsHub from "./SettingsHub";
import TeamChat from "./TeamChat";
import AddClientModal from "./AddClientModal";
import TerritoryPanel from "./TerritoryPanel";


import { I, Avatar, SideItem, MAX_ATTACHMENT_BYTES, newId, formatBytes, kindFromName, LIST_COLUMNS, type FilterState, type SortBy, type Toast } from "./cockpit/ui";
import { ConfirmModal, PromptModal, LinkFormModal, MergeTaskModal, MergeClientModal, type ConfirmSpec, type PromptSpec } from "./cockpit/modals";
import { CommandK } from "./cockpit/CommandK";
import { GroupedList, InlineDue } from "./cockpit/GroupedList";
import StageBoard from "./cockpit/StageBoard";
import { TaskDrawer } from "./cockpit/TaskDrawer";
import { QuickLinksBar } from "./cockpit/ClientLinks";
import { ClientJournal } from "./cockpit/ClientJournal";
import { QuickAddTask } from "./cockpit/QuickAddTask";
import { VaultView, type VaultItem } from "./cockpit/VaultView";
import { ClientsBoard, type WorkBoardGroup, type WorkItem } from "./cockpit/ClientsBoard";
import { ClientsDirectory } from "./cockpit/ClientsDirectory";
import { ProjectsDirectory } from "./cockpit/ProjectsDirectory";
import { FolderRail } from "./cockpit/FolderRail";
import { claudeCodeUrl } from "@/lib/claudeLink";

// --- Deep-link URL state ----------------------------------------------------
// The whole app lives on "/", so we encode what you're looking at into the
// query string: shareable links, refresh-safe, and back/forward navigation.
//   ?view=work|clients|personal   the special boards
//   ?client=<id>[&project=<id>]   a client (optionally scoped to one project)
//   ?task=<id>                    the task drawer (layers over any of the above)
type NavState = { view: "work" | "personal" | "inbox" | "clients" | "projects" | null; client: string; project: string | null; task: string | null; clientTab: "tasks" | "chat" | "vault" | null; vaultFolder: string | null };
function buildSearch(s: NavState): string {
  const p = new URLSearchParams();
  if (s.view) p.set("view", s.view);
  else if (s.client !== "all") {
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
    view: v === "work" || v === "personal" || v === "inbox" || v === "clients" || v === "projects" ? v : null,
    client: p.get("client") ?? "all",
    project: p.get("project"),
    task: p.get("task"),
    clientTab: tab === "chat" || tab === "vault" ? tab : null,
    vaultFolder: p.get("folder"),
  };
}

export default function Cockpit({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [clientLinks, setClientLinks] = useState<ClientLink[]>([]);
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  // Territory (city) view — a value is a territory id, or "all" for the manage-
  // all overview. Its own top-level view alongside inbox/dashboard/etc.
  const [territoryView, setTerritoryView] = useState<string | null>(null);
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [vaultFolders, setVaultFolders] = useState<VaultFolder[]>([]);
  const [unmatchedEmails, setUnmatchedEmails] = useState<UnmatchedEmail[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [importingTasks, setImportingTasks] = useState(false);
  const [clientTab, setClientTab] = useState<"tasks" | "chat" | "vault">("tasks");
  // Set once from a deep link's ?folder= param (see applyNav); VaultView
  // reads it only as its initial selected-folder value, not a live prop.
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
  // Admin-only "viewing work for [teammate]" — carried over from the old
  // My Work tab's selector, now scoping the merged board instead.
  const [myWorkUser, setMyWorkUser] = useState<string>(me.id);
  const [personalView, setPersonalView] = useState(false);
  const [inboxView, setInboxView] = useState(false);
  // Full-page Clients / Projects directory views (the "Clients" and "Projects"
  // nav links). A distinct mode like inbox/personal — when set, the main pane
  // shows the directory instead of a client/task view. clearViews() below
  // resets it alongside the others.
  const [dirView, setDirView] = useState<"clients" | "projects" | null>(null);
  // All Tasks defaults to just your own — admins can flip to "all"; for VAs
  // this is inert either way since scopedTasks already fully restricts them.
  const [allTasksScope, setAllTasksScope] = useState<"mine" | "all">("mine");
  const [groupBy, setGroupBy] = useState<"project" | "status" | "priority" | "due">("priority");
  const [filters, setFilters] = useState<FilterState>({ status: "all", assignee: "all", priority: "all" });
  const [sortBy, setSortBy] = useState<SortBy>("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleCols, setVisibleCols] = useState<string[]>(["status", "due", "priority", "comments"]);
  // Manual drag order for list columns — persisted like the other view
  // toggles below. Any key not yet in a saved order (e.g. after adding a new
  // column) falls back to LIST_COLUMNS' own order in reorderCols/colOrder use.
  const [colOrder, setColOrder] = useState<string[]>(LIST_COLUMNS.map((c) => c.key));
  const reorderCols = (keys: string[]) => { setColOrder(keys); try { localStorage.setItem("cut_colOrder", JSON.stringify(keys)); } catch {} };
  const [filterOpen, setFilterOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hideDone, setHideDone] = useState(true);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const [bellOpen, setBellOpen] = useState(false);
  // A real page, like My Work/Personal/Team Chat — not a popup or slide-out
  // (it used to be a fixed-position overlay; Derek asked more than once for
  // it to render in the normal content area instead).
  const [settingsView, setSettingsView] = useState(false);
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([]);
  // Which half of the Team Chat page is showing. Chat leads — per Derek, the
  // inbox "is really what team chat was supposed to be": talk to the team
  // first, review the task comments/mentions addressed to you second.
  const [inboxTab, setInboxTab] = useState<"chat" | "activity">("chat");
  // Per-user "last seen" timestamp for the unread dot — local-only, same
  // idiom as cut_starred/cut_sidebarHidden (no server-side read-state needed
  // for a lightweight badge).
  const [teamChatLastRead, setTeamChatLastRead] = useState<string>("");
  // One-time localStorage hydration on mount — same accepted pattern as
  // ClientJournal's composerW / TaskDrawer's activityW/siblingsCollapsed
  // (already tolerated elsewhere in this file), not a new class of issue.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setTeamChatLastRead(localStorage.getItem("cut_teamChatLastRead") ?? ""); } catch {} }, []);
  const markTeamChatRead = () => {
    const now = new Date().toISOString();
    setTeamChatLastRead(now);
    try { localStorage.setItem("cut_teamChatLastRead", now); } catch {}
  };
  // Which DM thread (if any) is open — the Chat hub's "Team" row and each
  // teammate's row are mutually exclusive, so a non-null value here means
  // "showing a DM thread" and null means "showing Team Chat" (see the Team
  // Chat page's render branch further down).
  const [dmUserId, setDmUserId] = useState<string | null>(null);
  // Team Chat is a real view now, not an overlay — open the page on its Chat
  // tab and clear the unread dot. Used by both the sidebar item and the
  // header shortcut so there's exactly one home for it.
  const openTeamChat = () => {
    setInboxView(true); setInboxTab("chat"); setDmUserId(null);
    setMyWork(false); setPersonalView(false); setDirView(null); setTerritoryView(null); setSettingsView(false);
    setOpenTaskId(null); setSidebarOpen(false);
    markTeamChatRead();
  };
  const teamChatUnread = teamMessages.some((m) => m.authorId !== me.id && m.at > teamChatLastRead);
  // Messages arriving while you're looking at the Chat tab are already read —
  // without this the realtime insert lights an unread dot for a message
  // that's on screen, and it only clears by navigating away and back.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (inboxView && dmUserId === null && inboxTab === "chat" && teamChatUnread) markTeamChatRead(); }, [inboxView, dmUserId, inboxTab, teamChatUnread]);

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
  const dmUnread = (otherUserId: string) => {
    const cid = dmConversationId(me.id, otherUserId);
    return dmMessages.some((m) => m.conversationId === cid && m.authorId !== me.id && m.at > (dmLastRead[cid] ?? ""));
  };
  // Mirrors openTeamChat exactly, for a specific teammate's thread instead
  // of the shared feed.
  const openDm = (userId: string) => {
    setInboxView(true); setDmUserId(userId);
    setMyWork(false); setPersonalView(false); setDirView(null); setTerritoryView(null); setSettingsView(false);
    setOpenTaskId(null); setSidebarOpen(false);
    markDmRead(dmConversationId(me.id, userId));
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
  // Recently-used ordering: clientId → last-opened epoch, persisted locally.
  // Opening a client stamps it (see the effect below), floating it to the top
  // when the "Recently used" sort is active.
  const [clientUsed, setClientUsed] = useState<Record<string, number>>({});
  const [starred, setStarred] = useState<Set<string>>(new Set());
  // Per-user pinned lists (projects), mirroring `starred` for clients — a
  // starred list gets its own quick-access row in the sidebar's Pinned section.
  const [starredLists, setStarredLists] = useState<Set<string>>(new Set());
  const [claudeQueue, setClaudeQueue] = useState<Set<string>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const toggleClaudeQueue = (taskId: string) => {
    setClaudeQueue((s) => {
      const n = new Set(s);
      if (n.has(taskId)) { n.delete(taskId); unqueueTaskDb(taskId); } else { n.add(taskId); queueTaskDb(taskId, me.id); }
      return n;
    });
  };
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);

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
    const nc = { ...c, status };
    setClients((cs) => cs.map((x) => (x.id === id ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
    pushToast(`${c.name} → ${CLIENT_STATUS_META[status].label}`);
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
  // A personal "check on this again" reminder date, independent of any
  // task's due date — see clientUrgencyKey/projectUrgencyKey, which treat
  // this as one more urgency candidate alongside open task due dates.
  const setClientFollowUp = (clientId: string, date: string | null) => {
    const c = clientById(clientId);
    if (!c) return;
    const nc = { ...c, followUpAt: date };
    setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
    markOwnClientWrite(nc.id);
    upsertClient(nc);
  };
  const setProjectFollowUp = (projectId: string, date: string | null) => {
    const p = projectById(projectId);
    if (!p) return;
    const np = { ...p, followUpAt: date };
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
  const draftMessage = async (clientId: string, channel: MessageChannel, prompt?: string): Promise<{ subject?: string; body: string } | null> => {
    setDraftingMessage(true);
    try {
      const res = await authedFetch("/api/ai/draft-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, channel, prompt }) });
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
  // Re-pulls one contact's info from GHL on demand — the bulk sync re-syncs
  // a whole sub-account (~30 sequential API calls for a big location), way
  // more than needed to check if one person's phone number changed.
  const [refreshingContact, setRefreshingContact] = useState(false);
  const refreshContact = async (contact: Contact) => {
    // ghlTargetForContact is declared later in this component; harmless in
    // practice (this only ever runs post-render, from a click handler or
    // the auto-refresh effect near openTask), same TDZ shape as other
    // cross-referencing helpers here.
    // eslint-disable-next-line react-hooks/immutability
    const target = ghlTargetForContact(contact);
    if (!target) { pushToast("No GoHighLevel connection for this client's sub-account."); return; }
    setRefreshingContact(true);
    try {
      const res = await authedFetch("/api/ghl/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: contact.id, locationId: target.locationId, ghlContactId: target.ghlContactId }) });
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
    try {
      const s = localStorage.getItem("cut_clientSort"); if (s) setClientSort(s as ClientSort);
      const st = localStorage.getItem("cut_starred"); if (st) setStarred(new Set(JSON.parse(st)));
      const stl = localStorage.getItem("cut_starredLists"); if (stl) setStarredLists(new Set(JSON.parse(stl)));
      const fp = localStorage.getItem("cut_fabPos"); if (fp) setFabPos(JSON.parse(fp));
      const mo = localStorage.getItem("cut_clientOrder"); if (mo) setManualOrder(JSON.parse(mo));
      const he = localStorage.getItem("cut_hideEmpty"); if (he !== null) setHideEmpty(he === "1");
      const hd = localStorage.getItem("cut_hideDone"); if (hd !== null) setHideDone(hd === "1");
      const colo = localStorage.getItem("cut_colOrder"); if (colo) setColOrder(JSON.parse(colo));
      const cu = localStorage.getItem("cut_clientUsed"); if (cu) setClientUsed(JSON.parse(cu));
    } catch { /* fresh browser */ }
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
  const toggleStar = (id: string) => setStarred((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem("cut_starred", JSON.stringify([...n])); } catch {}
    return n;
  });
  const toggleStarList = (id: string) => setStarredLists((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem("cut_starredLists", JSON.stringify([...n])); } catch {}
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
    view: dirView ?? (myWork ? "work" : personalView ? "personal" : inboxView ? "inbox" : null),
    client: activeClient, project: activeProject, task: openTaskId,
    clientTab, vaultFolder: null, // vaultFolder is write-only (via copyFolderLink) — not mirrored into the live URL as you browse
  });
  const applyNav = (s: NavState) => {
    setMyWork(s.view === "work"); setPersonalView(s.view === "personal"); setInboxView(s.view === "inbox");
    setDirView(s.view === "clients" || s.view === "projects" ? s.view : null);
    setActiveClient(s.view ? "all" : s.client); setActiveProject(s.view ? null : s.project); setOpenTaskId(s.task);
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
  });
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  useEffect(() => { try { setSidebarHidden(localStorage.getItem("cut_sidebarHidden") === "1"); } catch {} }, []);
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
  const navVisible: Record<string, boolean> = { inbox: true, all: true, work: true, personal: true };

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
        setTerritories(d.territories);
        setTaskTemplates(d.taskTemplates);
        setPlaybooks(d.playbooks);
        setVaultFolders(d.vaultFolders);
        setFolders(d.folders);
        setStages(d.stages);
        setTeamMessages(d.teamMessages);
        setDmMessages(d.dmMessages);
        setUnmatchedEmails(d.unmatchedEmails);
        fetchClaudeQueue().then((ids) => setClaudeQueue(new Set(ids)));
      } catch (e) {
        setDbError(e instanceof Error ? e.message : "Failed to load data.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const clientById = (id: string) => clients.find((c) => c.id === id) ?? null;
  const projectById = (id: string) => projects.find((p) => p.id === id) ?? null;
  const contactById = (id: string | null) => contacts.find((c) => c.id === id) ?? null;

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  };

  // Toasts with an action (undo) linger ~4x longer — 2.8s is not enough time
  // to read what happened and decide to reverse it.
  const pushToast = (text: string, action?: { label: string; run: () => void }) => {
    const id = newId("toast_");
    setToasts((t) => [...t, { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 11000 : 2800);
  };
  const dismissToast = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  // Copy a shareable deep link (see buildSearch) to the clipboard.
  const copyLink = (nav: NavState) => {
    const url = `${window.location.origin}${window.location.pathname}${buildSearch(nav)}`;
    navigator.clipboard?.writeText(url).then(() => pushToast("🔗 Link copied"), () => pushToast("⚠️ Couldn't copy link"));
  };
  // A folder link is just the current client/project link with tab=vault
  // and folder=<id> layered on — built fresh at click time, not mirrored
  // into the live URL bar as you browse (see currentNav's vaultFolder note).
  const copyFolderLink = (folderId: string) => copyLink({ ...currentNav(), view: null, clientTab: "vault", vaultFolder: folderId });
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
      // No echo suppression needed: messages are append-only/immutable (never
      // edited after insert, unlike a task title), so id-based dedup below is
      // sufficient — an own-write echo just re-writes the same array slot.
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
  const sendNotificationEmail = (recipientMemberId: string, subject: string, link?: string) => {
    authedFetch("/api/notifications/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientMemberId, subject, link }),
    }).catch(() => {});
  };

  // kind defaults to "activity" (automatic side-effect notice) — call sites
  // for a direct human communication (an @mention or comment) pass
  // kind: "message" explicitly, so the Inbox can filter the two apart.
  // skipEmail is set only by the one call site that already fires its own
  // richer, quoted-comment email (sendMentionEmail, task-comment mentions) —
  // every other notification gets this plain generic email automatically.
  const notify = (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean }) => {
    const n: Notification = { id: newId("n_"), recipientId, text, taskId, actorId: me.id, clientId: extra?.clientId ?? null, projectId: extra?.projectId ?? null, at: new Date().toISOString(), read: false, kind: extra?.kind ?? "activity" };
    setNotifications((ns) => [n, ...ns]);
    insertNotif(n);
    if (!extra?.skipEmail) {
      const link = taskId ? `?task=${encodeURIComponent(taskId)}` : extra?.clientId ? `?client=${encodeURIComponent(extra.clientId)}` : undefined;
      sendNotificationEmail(recipientId, text, link);
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
  const markAllNotifsRead = () => {
    setNotifications((ns) => ns.map((n) => (n.recipientId === me.id ? { ...n, read: true } : n)));
    markNotifsReadDb(me.id);
  };
  // On-demand pull of client email replies that came back through Gmail
  // (bypassing GHL). Runs the same poll the cron does, via the admin session
  // — the reliable trigger on Vercel Hobby (cron only fires once a day there).
  const [syncingEmail, setSyncingEmail] = useState(false);
  const syncEmail = async () => {
    setSyncingEmail(true);
    try {
      const res = await authedFetch("/api/google/poll-replies", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Email sync failed.");
      if (j.surfaced) setUnmatchedEmails(await fetchUnmatchedDb()); // pull the newly-parked unknown senders into the Inbox
      const parts: string[] = [];
      if (j.ingested) parts.push(`${j.ingested} new to Journal`);
      if (j.surfaced) parts.push(`${j.surfaced} to Inbox`);
      pushToast(parts.length ? `📥 Synced email — ${parts.join(", ")}.` : "Email synced — nothing new.");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Email sync failed.");
    } finally {
      setSyncingEmail(false);
    }
  };
  // On-demand pull of upcoming GHL appointments (see sync-appointments/route.ts)
  // — same Vercel-Hobby-cron-is-once-a-day reasoning as syncEmail above.
  const [syncingAppointments, setSyncingAppointments] = useState(false);
  const syncAppointments = async () => {
    setSyncingAppointments(true);
    try {
      const res = await authedFetch("/api/ghl/sync-appointments", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Appointment sync failed.");
      pushToast(j.synced ? `📅 Synced ${j.synced} upcoming appointment${j.synced === 1 ? "" : "s"}.` : "Appointments synced — nothing new.");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Appointment sync failed.");
    } finally {
      setSyncingAppointments(false);
    }
  };
  // Triage an unknown-sender email parked in the Inbox: dismiss it, or turn the
  // sender into a tracked client (creating a contact + cl_ client and pulling
  // any of their conversation onto the new page via addClientContact).
  const dismissUnmatched = (id: string) => {
    setUnmatchedEmails((us) => us.filter((u) => u.id !== id));
    markUnmatchedHandledDb(id);
  };
  const addAsClientFromEmail = async (u: UnmatchedEmail) => {
    const ct: Contact = {
      id: newId("ct_"), clientId: subAccounts[0]?.id ?? WORKSPACE_CLIENT_ID,
      name: u.fromName?.trim() || u.fromEmail, email: u.fromEmail,
      phone: "", ghlContactId: "", company: "", city: "", state: "",
    };
    setContacts((cs) => [...cs, ct]);
    upsertContact(ct);
    await addClientContact(ct); // creates cl_<ct.id>, opens it, brings any conversation over
    dismissUnmatched(u.id);
  };
  const openNotification = (n: Notification) => {
    if (!n.read) { setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, read: true } : x))); markNotifReadDb(n.id); }
    // A DM notification's actorId is exactly who sent it — that's the thread to open.
    if (n.kind === "dm" && n.actorId) { openDm(n.actorId); return; }
    if (n.taskId) { setOpenTaskId(n.taskId); return; }
    if (n.clientId) {
      setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null);
      setActiveClient(n.clientId); setActiveProject(n.projectId ?? null); setClientTab("chat");
      return;
    }
    // A direct message with no task and no client is a Team Chat mention —
    // the only notification kind with nowhere else to point. Without this it
    // was a dead click: "X mentioned you in Team Chat" marked itself read and
    // did nothing, with the chat one tab away.
    if (n.kind === "message") setInboxTab("chat");
  };

  const passesFilters = (t: Task) =>
    (filters.status === "all" || t.status === filters.status) &&
    (filters.assignee === "all" || (filters.assignee === "waiting" ? !!t.waitingOnClient : filters.assignee === "unassigned" ? (t.assigneeId === null && !t.waitingOnClient) : t.assigneeId === filters.assignee)) &&
    (filters.priority === "all" || t.priority === filters.priority) &&
    // Explicitly filtering to Done overrides the hide-done toggle — asking
    // to see done tasks and then hiding them would show nothing.
    (!hideDone || filters.status === "done" || t.status !== "done");

  const sortTasks = (list: Task[]) => {
    if (sortBy === "manual") return list;
    const dir = sortDir === "desc" ? -1 : 1;
    const arr = [...list];
    if (sortBy === "due") arr.sort((a, b) => ((a.due ?? "9999").localeCompare(b.due ?? "9999")) * dir);
    else if (sortBy === "priority") arr.sort((a, b) => (PRIORITY_META[b.priority].rank - PRIORITY_META[a.priority].rank) * dir);
    else if (sortBy === "title") arr.sort((a, b) => a.title.localeCompare(b.title) * dir);
    else if (sortBy === "status") arr.sort((a, b) => (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * dir);
    else if (sortBy === "assignee") arr.sort((a, b) => ((userById(a.assigneeId)?.name ?? "~").localeCompare(userById(b.assigneeId)?.name ?? "~")) * dir);
    else if (sortBy === "comments") arr.sort((a, b) => (b.comments.length - a.comments.length) * dir);
    return arr;
  };
  const sortByCol = (key: string) => {
    const map: Record<string, SortBy> = { priority: "priority", assignee: "assignee", due: "due", task: "title", status: "status", comments: "comments" };
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
  const scopedTasks = canAdmin ? tasks : tasks.filter((t) => t.assigneeId === me.id);
  // Follow-up date = "always true": auto-track each client/project's
  // follow-up to the soonest due date among its open (status != done) dated
  // tasks, so it always reflects the next real deadline. Diff-then-write —
  // only rows whose stored value actually differs get touched, which also
  // stops the effect from looping (once written, the next pass matches and
  // skips). When a client/project has NO dated open task, its followUpAt is
  // left untouched so a manually-set reminder still sticks. Admin-only: a VA
  // only sees their own scoped tasks, so they'd compute a too-late value and
  // (RLS aside) locally clobber the admin-maintained date.
  useEffect(() => {
    if (canAdmin === false) return;
    const soonestByClient = new Map<string, string>();
    const soonestByProject = new Map<string, string>();
    for (const t of tasks) {
      if (t.status === "done" || !t.due) continue;
      const pc = soonestByClient.get(t.clientId);
      if (!pc || t.due < pc) soonestByClient.set(t.clientId, t.due);
      if (t.projectId) {
        const pp = soonestByProject.get(t.projectId);
        if (!pp || t.due < pp) soonestByProject.set(t.projectId, t.due);
      }
    }
    for (const c of clients) {
      const soonest = soonestByClient.get(c.id);
      if (soonest && soonest !== (c.followUpAt ?? null)) setClientFollowUp(c.id, soonest);
    }
    for (const p of projects) {
      const soonest = soonestByProject.get(p.id);
      if (soonest && soonest !== (p.followUpAt ?? null)) setProjectFollowUp(p.id, soonest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, clients, projects, canAdmin]);
  // Sub-accounts (Agency/Directory) are the contact source; clients (cl_*) are contacts you've added.
  const subAccounts = clients.filter((c) => !c.id.startsWith("cl_"));
  // Only type 'client' gets sidebar/⌘K/task presence — prospects/past
  // clients/vendors are classified contacts you can message, reached via the
  // Contacts tab and Conversations, not full clients with projects/tasks.
  // WORKSPACE_CLIENT_ID is a contact-less container for internal/agency work
  // (its projects behave like standalone lists that never sync). Kept out of
  // the real client list and shown as its own top-of-sidebar section.
  const clientList = clients.filter((c) => c.id.startsWith("cl_") && c.type === "client" && c.id !== WORKSPACE_CLIENT_ID);
  const workspaceProjects = clients.some((c) => c.id === WORKSPACE_CLIENT_ID) ? projects.filter((p) => p.clientId === WORKSPACE_CLIENT_ID) : [];
  // Mirrors the RLS rule in supabase/client-assignment.sql: a VA sees a
  // client if they have a task on it OR they're explicitly following it —
  // this is a display-layer echo of that DB rule, not the enforcement of it.
  const visibleClients = canAdmin ? clientList : clientList.filter((c) => scopedTasks.some((t) => t.clientId === c.id) || (c.assignedTo ?? []).includes(me.id));
  // "My Work" is a strictly personal-to-someone view — only clients with a
  // currently *open* task assigned to that person specifically (or that
  // they're explicitly following), even for admins, who otherwise see every
  // client via visibleClients above. A client whose only connection is a
  // task already finished, and not followed, drops off the board entirely
  // rather than lingering in "No open tasks" forever. Parametrized by
  // userId (not just `me`) so the admin-only "viewing work for" selector
  // can point this at a teammate instead of yourself.
  const assignedClientsFor = (userId: string) => clientList.filter((c) => scopedTasks.some((t) => t.clientId === c.id && t.status !== "done" && (t.assigneeId === userId || t.subtasks.some((s) => s.assigneeId === userId))) || (c.assignedTo ?? []).includes(userId));
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
  const assignedProjectsFor = (userId: string) => projects.filter((p) => (p.clientId === WORKSPACE_CLIENT_ID || p.clientId === PERSONAL_CLIENT_ID) && (scopedTasks.some((t) => t.projectId === p.id && t.status !== "done" && (t.assigneeId === userId || t.subtasks.some((s) => s.assigneeId === userId))) || (p.assignedTo ?? []).includes(userId)));
  const myAssignedClients = assignedClientsFor(me.id);
  const myTerritories = territories.filter((t) => (t.assignedTo ?? []).includes(me.id));
  // Cities shown in the sidebar: only the ones assigned to YOU, admin or not
  // — an admin managing every territory doesn't mean every admin should see
  // every rep's territory in their own personal nav just by being an admin.
  // Seeing/assigning the full roster is still available via "Manage
  // territories" (openTerritory("all"), canAdmin-gated below), which reads
  // `territories` directly rather than this filtered list. Sorted by city
  // for a stable list.
  const visibleTerritories = myTerritories.slice().sort((a, b) => a.city.localeCompare(b.city));
  const territoryById = (id: string) => territories.find((t) => t.id === id) ?? null;
  const openTerritory = (id: string) => {
    setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null);
    setActiveClient("all"); setActiveProject(null); setOpenTaskId(null); setSidebarOpen(false);
    setTerritoryView(id);
  };
  // ⌘K's "Not imported" search — any type counts as "already added" here,
  // not just type 'client', so a contact never shows as addable twice.
  const addedContactIds = new Set(clients.filter((c) => c.id.startsWith("cl_")).map((c) => c.id.slice(3)));
  // The sidebar's actual source list — scoped down to "mine" by default
  // (reuses myAssignedClients, the exact same set My Work uses) so a long
  // client roster doesn't bury what actually needs attention. Toggled to
  // visibleClients (everyone you can see) via the header's Mine/All control.
  const clientListBase = clientListScope === "mine" ? myAssignedClients : visibleClients;
  // Apply the user's sort preference; starred clients always float to the top.
  const sortedClients = (() => {
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
  })();
  function clientTaskCountRef(clientId: string) { return scopedTasks.filter((t) => t.clientId === clientId).length; }
  function hasUnreadMessage(clientId: string): boolean {
    if (!clientId.startsWith("cl_")) return false;
    const contactId = clientId.slice(3);
    return messages.some((m) => m.contactId === contactId && m.direction === "inbound" && !m.read);
  }
  // The tier-0 "New message" boost in clientUrgencyKey is driven by an open
  // Conversation-priority task (the priority-system source of truth for "a
  // thread needs a reply"), not raw unread-message state — a thread stays
  // boosted for as long as its task is open, even after the message itself
  // is marked read, and clears only when the task is completed.
  function hasOpenConversationTask(clientId: string): boolean {
    return scopedTasks.some((t) => t.clientId === clientId && t.status !== "done" && t.priority === "conversation");
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
    const open = scopedTasks.filter((t) => t.clientId === clientId && t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    const hasAnyDate = open.some((t) => t.due) || !!c.followUpAt;
    const reviewedThisWeek = !!c.reviewedAt && c.reviewedAt >= THIS_MONDAY;
    if (open.length > 0 && !hasAnyDate && !reviewedThisWeek) return true; // (A)
    if (c.status === "nurture" && (!c.reviewedAt || daysBetween(c.reviewedAt, TODAY) >= NURTURE_CHECK_IN_DAYS)) return true; // (B)
    return false;
  }
  // Projects have no status, so only condition (A) applies — no nurture cadence.
  function projectNeedsReview(projectId: string, forAssignee?: string): boolean {
    const p = projectById(projectId);
    if (!p) return false;
    const open = scopedTasks.filter((t) => t.projectId === projectId && t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    const hasAnyDate = open.some((t) => t.due) || !!p.followUpAt;
    const reviewedThisWeek = !!p.reviewedAt && p.reviewedAt >= THIS_MONDAY;
    return open.length > 0 && !hasAnyDate && !reviewedThisWeek;
  }
  // Tier scheme (lower = more urgent, sorts first):
  //   0 Review · 1 New message · 2 Overdue · 3 Due today · 4 Due tomorrow ·
  //   5 Due this week · 6 Due this month · 7 Upcoming · 8 No due date · 9 No open tasks
  function tierForDate(soonest: string): number {
    if (soonest < TODAY) return 2;
    if (soonest === TODAY) return 3;
    if (soonest === TOMORROW) return 4;
    if (soonest <= THIS_WEEK_END) return 5;
    if (soonest <= THIS_MONTH_END) return 6;
    return 7;
  }
  // forAssignee narrows "open tasks" to just that person's — used by the
  // personal My Work board, where a client's tier should reflect *my* tasks
  // there, not a teammate's. Omitted for the sidebar's "Overdue first" sort,
  // which is intentionally client-wide across every assignee.
  function clientUrgencyKey(clientId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    if (clientNeedsReview(clientId, forAssignee)) return { tier: 0, due: "", priorityRank: 0 };
    if (hasOpenConversationTask(clientId)) return { tier: 1, due: "", priorityRank: 0 };
    const open = scopedTasks.filter((t) => t.clientId === clientId && t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    // Follow-up date is one more urgency candidate alongside task due dates —
    // "whichever is soonest wins." Deliberately does NOT also scan this
    // client's projects' own follow-up dates (unlike tasks, which already
    // roll up from project to client automatically via t.clientId) — kept
    // independent per client/project for now; add a rollup here later if a
    // project-only follow-up date turns out to need to surface the client too.
    // Follow-up date only counts on a per-assignee tier when it's standing
    // alone as a genuine manual reminder — i.e. when nobody currently has a
    // dated open task for this client. The recompute effect above pins
    // followUpAt to the soonest dated open task from ANY assignee the moment
    // one exists, so once that's true the field is just a mirror of
    // whichever task happens to be earliest, not an independent signal.
    // Blanket-including it per-assignee let a teammate's task make a client
    // look overdue on someone else's Dashboard even though nothing of
    // theirs was due (Derek: Michaella's task was overdue on Michael
    // Swaleh, Derek's own wasn't due till Monday, but Derek's Dashboard
    // showed Overdue anyway). When forAssignee isn't set (the unfiltered
    // "Overdue first" sort), always include it — it's already redundant
    // with `open` there since nothing is being filtered out by assignee.
    const followUp = clientById(clientId)?.followUpAt;
    const clientHasAnyDatedOpenTask = tasks.some((t) => t.clientId === clientId && t.status !== "done" && !!t.due);
    const includeFollowUp = !forAssignee || !clientHasAnyDatedOpenTask;
    const candidates: { date: string; priorityRank: number }[] = [
      ...open.filter((t) => t.due).map((t) => ({ date: t.due!, priorityRank: PRIORITY_META[t.priority].rank })),
      ...(followUp && includeFollowUp ? [{ date: followUp, priorityRank: 0 }] : []),
    ];
    if (candidates.length === 0) {
      if (open.length === 0) return { tier: 9, due: "", priorityRank: 0 };
      return { tier: 8, due: "", priorityRank: Math.max(...open.map((t) => PRIORITY_META[t.priority].rank)) };
    }
    const soonest = candidates.reduce((a, b) => (b.date < a.date ? b : a)).date;
    const atSoonest = candidates.filter((c) => c.date === soonest);
    return { tier: tierForDate(soonest), due: soonest, priorityRank: Math.max(...atSoonest.map((c) => c.priorityRank)) };
  }
  // Same tiering as clientUrgencyKey, scoped to one project's tasks (+ its
  // own followUpAt). No "New message" tier — that's a client-level Conversation
  // concept, not a project one.
  function projectUrgencyKey(projectId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    if (projectNeedsReview(projectId, forAssignee)) return { tier: 0, due: "", priorityRank: 0 };
    const open = scopedTasks.filter((t) => t.projectId === projectId && t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    // Same rule as clientUrgencyKey: only counts per-assignee when nobody
    // currently has a dated open task in this project.
    const followUp = projectById(projectId)?.followUpAt;
    const projectHasAnyDatedOpenTask = tasks.some((t) => t.projectId === projectId && t.status !== "done" && !!t.due);
    const includeFollowUp = !forAssignee || !projectHasAnyDatedOpenTask;
    const candidates: { date: string; priorityRank: number }[] = [
      ...open.filter((t) => t.due).map((t) => ({ date: t.due!, priorityRank: PRIORITY_META[t.priority].rank })),
      ...(followUp && includeFollowUp ? [{ date: followUp, priorityRank: 0 }] : []),
    ];
    if (candidates.length === 0) {
      if (open.length === 0) return { tier: 9, due: "", priorityRank: 0 };
      return { tier: 8, due: "", priorityRank: Math.max(...open.map((t) => PRIORITY_META[t.priority].rank)) };
    }
    const soonest = candidates.reduce((a, b) => (b.date < a.date ? b : a)).date;
    const atSoonest = candidates.filter((c) => c.date === soonest);
    return { tier: tierForDate(soonest), due: soonest, priorityRank: Math.max(...atSoonest.map((c) => c.priorityRank)) };
  }
  const projectTaskCount = (projectId: string) => scopedTasks.filter((t) => t.projectId === projectId && t.status !== "done").length;
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
  const myWorkGroups: WorkBoardGroup[] = (() => {
    const defs: [number, string, string][] = [
      [0, "Review", "#14b8a6"],
      [1, "New message", "#8b5cf6"],
      [2, "Overdue", "#ef4444"],
      [3, "Due today", "#f59e0b"],
      [4, "Due tomorrow", "#eab308"],
      [5, "Due this week", "#3b82f6"],
      [6, "Due this month", "#6366f1"],
      [7, "Upcoming", "#0ea5e9"],
      [8, "No due date", "#94a3b8"],
      [9, "No open tasks", "#cbd5e1"],
    ];
    const clientKeys = assignedClientsFor(myWorkUser).map((c) => ({ kind: "client" as const, item: { kind: "client" as const, client: c }, name: c.name, k: clientUrgencyKey(c.id, myWorkUser) }));
    const projectKeys = assignedProjectsFor(myWorkUser).map((p) => ({ kind: "project" as const, item: { kind: "project" as const, project: p, clientName: clientById(p.clientId)?.name ?? "—" } as WorkItem, name: p.name, k: projectUrgencyKey(p.id, myWorkUser) }));
    const withKey = [...clientKeys, ...projectKeys];
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
  })();
  // The Monday "set up your week" queue: my clients/projects currently in the
  // Review tier, in the same order My Work shows them. Drives the header
  // "Review next" button so you can click through them one at a time (the
  // interaction Derek wanted — open each, decide, advance) instead of hunting.
  const reviewQueue: { kind: "client" | "project"; id: string }[] = [
    ...assignedClientsFor(me.id).filter((c) => clientNeedsReview(c.id, me.id)).map((c) => ({ kind: "client" as const, id: c.id })),
    ...assignedProjectsFor(me.id).filter((p) => projectNeedsReview(p.id, me.id)).map((p) => ({ kind: "project" as const, id: p.id })),
  ];
  const goToNextReview = (afterClientId: string, afterProjectId: string | null) => {
    const curIdx = reviewQueue.findIndex((r) => (afterProjectId ? r.kind === "project" && r.id === afterProjectId : r.kind === "client" && r.id === afterClientId));
    // Wrap around so the last item's "next" loops back to the first still-
    // pending one; nothing left → let the caller know via a toast.
    const next = reviewQueue[(curIdx + 1) % reviewQueue.length] ?? reviewQueue[0];
    if (!next) { pushToast("Nothing left to review — all caught up. 🎉"); return; }
    if (next.kind === "project") { const pr = projectById(next.id); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(pr?.clientId ?? "all"); setActiveProject(next.id); }
    else { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(next.id); setActiveProject(null); }
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
  const baseTasks = scopedTasks.filter((t) => t.clientId.startsWith("cl_") && (activeClient === "all" || t.clientId === activeClient) && (!activeProject || t.projectId === activeProject) && (!activeFolder || projectById(t.projectId)?.folderId === activeFolder) && (activeClient !== "all" || allTasksScope === "all" || t.assigneeId === me.id));

  // Client/project-wide equivalents of TaskDrawer's per-task copyForClaude /
  // onToggleQueue — same clipboard+paste and queue-and-let-Claude-pull-it
  // hand-off patterns, just widened from one task to every open task under
  // the currently open client/project.
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
      pushToast("Copied client brief for Claude.");
    } catch {
      pushToast("Couldn't copy to clipboard.");
    }
  };
  const queueClientForClaude = () => {
    const openTasks = baseTasks.filter((t) => t.status !== "done");
    const toQueue = openTasks.filter((t) => !claudeQueue.has(t.id));
    if (!toQueue.length) { pushToast("All open tasks here are already queued for Claude."); return; }
    setClaudeQueue((prev) => new Set([...prev, ...toQueue.map((t) => t.id)]));
    toQueue.forEach((t) => queueTaskDb(t.id, me.id));
    pushToast(`Queued ${toQueue.length} task${toQueue.length === 1 ? "" : "s"} for Claude.`);
  };

  // Vault folder assignment — three different write-back paths since an
  // attachment can live on a task, nested inside one of that task's
  // comments, or on a Chat note, and none of those three has an existing
  // per-attachment patch mutator. All three go through the full-row
  // update()/upsertClientNote path (no atomic RPC like append_comment) —
  // not worth building one for a rare, low-collision action, unlike live
  // commenting.
  const setTaskAttachmentFolder = (taskId: string, attId: string, folderId: string | null) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    update(taskId, { attachments: t.attachments.map((a) => (a.id === attId ? { ...a, folderId: folderId ?? undefined } : a)) });
  };
  const setCommentAttachmentFolder = (taskId: string, commentId: string, attId: string, folderId: string | null) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const comments = t.comments.map((c) => (c.id !== commentId ? c : { ...c, attachments: (c.attachments ?? []).map((a) => (a.id === attId ? { ...a, folderId: folderId ?? undefined } : a)) }));
    update(taskId, { comments });
  };
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
    setVaultFolders((fs) => fs.filter((f) => f.id !== id));
    deleteVaultFolderDb(id);
  };
  // Every attachment anywhere in the current client/project scope — task
  // attachments, task comment images, and Chat message images — collected
  // into one flat list for the Vault tab. Only computed when the Vault tab
  // is reachable at all (a real client, not "All tasks"/My Work/etc.).
  const activeVaultFolders = activeClient === "all" ? [] : vaultFolders.filter((f) => f.clientId === activeClient);
  const vaultItems: VaultItem[] = activeClient === "all" ? [] : [
    ...baseTasks.flatMap((t) => t.attachments.map((a) => ({ ...a, sourceLabel: t.title, onOpenSource: () => { setClientTab("tasks"); setOpenTaskId(t.id); }, onSetFolder: (folderId: string | null) => setTaskAttachmentFolder(t.id, a.id, folderId) }))),
    ...baseTasks.flatMap((t) => t.comments.flatMap((c) => (c.attachments ?? []).map((a) => ({ ...a, sourceLabel: t.title, onOpenSource: () => { setClientTab("tasks"); setOpenTaskId(t.id); }, onSetFolder: (folderId: string | null) => setCommentAttachmentFolder(t.id, c.id, a.id, folderId) })))),
    ...clientNotes.filter((n) => (activeProject ? n.projectId === activeProject : n.clientId === activeClient && !n.projectId))
      .flatMap((n) => (n.attachments ?? []).map((a) => ({ ...a, sourceLabel: "Journal", onOpenSource: () => setClientTab("chat"), onSetFolder: (folderId: string | null) => setNoteAttachmentFolder(n, a.id, folderId) }))),
  ];
  const projectsForClient = (clientId: string) => projects.filter((p) => p.clientId === clientId);
  const foldersForClient = (clientId: string) => folders.filter((f) => f.clientId === clientId).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const stagesForProject = (projectId: string) => stages.filter((s) => s.projectId === projectId).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const folderById = (id: string | null | undefined) => (id ? folders.find((f) => f.id === id) ?? null : null);
  const projectProgress = (projectId: string) => { const ts = scopedTasks.filter((t) => t.projectId === projectId); const done = ts.filter((t) => t.status === "done").length; return { done, total: ts.length, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 }; };
  // Open (non-done) count — matches what the client's task list actually shows
  // with "Hide done" on by default, so the sidebar/board badge and the list
  // never disagree about how many tasks "need attention".
  const clientTaskCount = (clientId: string) => scopedTasks.filter((t) => t.clientId === clientId && t.status !== "done").length;
  // Not gated by myWorkUser (the admin-only "viewing work for" selector) —
  // RLS never even returns another person's private tasks in `tasks`, so
  // filtering by `me.id` here is correct regardless of who's being viewed.
  const myPersonalTasks = sortTasks(tasks.filter((t) => t.assigneeId === me.id && t.private));

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;
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
  const todayDow = (() => { const [y, m, d] = TODAY.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); })();
  const weekStart = addDaysIso(TODAY, -todayDow);
  const thisWeekEnd = addDaysIso(weekStart, 6);
  const nextWeekEnd = addDaysIso(weekStart, 13);
  const dueBucket = (t: Task) => {
    if (!t.due) return "none";
    if (t.due < TODAY && t.status !== "done") return "overdue";
    if (t.due === TODAY) return "today";
    if (t.due === TOMORROW) return "tomorrow";
    if (t.due <= thisWeekEnd) return "week";
    if (t.due <= nextWeekEnd) return "nextWeek";
    return "later";
  };

  type Grp = { key: string; label: string; color: string; tasks: Task[] };
  const buildGroups = (list: Task[], dim: typeof groupBy = groupBy): Grp[] => {
    if (dim === "status") return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_META[s].label, color: STATUS_META[s].dot, tasks: list.filter((t) => t.status === s) }));
    if (dim === "priority") return PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_META[p].label, color: PRIORITY_META[p].color, tasks: list.filter((t) => t.priority === p) }));
    if (dim === "due") { const defs: [string, string, string][] = [["overdue", "Overdue", "#ef4444"], ["today", "Due today", "#f59e0b"], ["tomorrow", "Due tomorrow", "#eab308"], ["week", "This week", "#3b82f6"], ["nextWeek", "Next week", "#6366f1"], ["later", "Later", "#94a3b8"], ["none", "No due date", "#cbd5e1"]]; return defs.map(([k, l, c]) => ({ key: k, label: l, color: c, tasks: list.filter((t) => dueBucket(t) === k) })); }
    return visibleProjects.map((p) => ({ key: p.id, label: p.name, color: clientById(p.clientId)?.color ?? "#94a3b8", tasks: list.filter((t) => t.projectId === p.id) }));
  };

  // Flat, in-display-order list of the tasks currently shown — drives prev/next
  // navigation inside the open task (j/k + header arrows).
  // myWork (the merged My Work board) has no entry here — it's a client/
  // project board, not a flat task list, so j/k prev/next task navigation
  // doesn't apply to it, same as it never applied to the old My Clients tab.
  const displayedGroups = personalView ? buildGroups(myPersonalTasks, "due").filter((g) => g.tasks.length > 0) : buildGroups(sortTasks(baseTasks.filter(passesFilters)));
  const orderedTaskIds = displayedGroups.flatMap((g) => g.tasks.map((t) => t.id));
  const openTaskIdx = openTaskId ? orderedTaskIds.indexOf(openTaskId) : -1;
  const goToTask = (delta: number) => { if (openTaskIdx < 0) return; const next = orderedTaskIds[openTaskIdx + delta]; if (next) setOpenTaskId(next); };
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
  }, [openTaskId, orderedTaskIds]);

  const quickAdd = (groupKey: string, title: string) => {
    if (!title.trim() || !activeClient.startsWith("cl_")) return;
    let projectId: string;
    if (groupBy === "project") projectId = groupKey;
    // Scoped to one project? Add straight into it — otherwise the task lands in
    // some other project of this client and vanishes from the filtered view.
    else if (activeProject) projectId = activeProject;
    else {
      const existing = projects.find((p) => p.clientId === activeClient);
      if (existing) projectId = existing.id;
      else { const p: Project = { id: newId("p_"), clientId: activeClient, name: "Tasks", description: "" }; setProjects((ps) => [...ps, p]); upsertProject(p); projectId = p.id; }
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
      due: groupBy === "due" && groupKey === "today" ? TODAY : TOMORROW,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
  };

  // Quick-add-task FAB: create a task for an explicitly-chosen client/list
  // (from the floating "+" modal). Mirrors quickAdd's Task shape and the
  // find-or-create-"Tasks"-list idiom; assignee = the creator.
  const createQuickTask = (clientId: string, projectId: string | null, title: string, due: string | null, priority: Priority) => {
    if (!title.trim() || !clientId.startsWith("cl_")) return;
    let pid = projectId ?? "";
    if (!pid) {
      const existing = projects.find((p) => p.clientId === clientId);
      if (existing) pid = existing.id;
      else { const p: Project = { id: newId("p_"), clientId, name: "Tasks", description: "" }; setProjects((ps) => [...ps, p]); upsertProject(p); pid = p.id; }
    }
    const t: Task = {
      id: newId("t_"), projectId: pid, clientId, title: title.trim(), description: "",
      status: "todo", priority: isManuallyAssignable(priority) ? priority : "none",
      assigneeId: me.id, contactId: clientId.slice(3), due,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: false, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
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

  // Add a task straight into a specific list (client + project), used by the
  // task drawer's sibling-list quick-add. Inherits the list's private flag so
  // adding under a Personal task stays private.
  const addTaskToList = (clientId: string, projectId: string, isPrivate: boolean, title: string) => {
    if (!title.trim()) return;
    const t: Task = {
      id: newId("t_"), projectId, clientId, title: title.trim(), description: "",
      status: "todo", priority: "normal", assigneeId: me.id,
      contactId: clientId.startsWith("cl_") ? clientId.slice(3) : null,
      due: TOMORROW, recurrence: "none", labelIds: [], ghlTaskId: null, private: isPrivate, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
  };

  const quickAddPersonal = (groupKey: string, title: string) => {
    if (!title.trim()) return;
    const t: Task = {
      id: newId("t_"), projectId: PERSONAL_PROJECT_ID, clientId: PERSONAL_CLIENT_ID, title: title.trim(), description: "",
      status: groupBy === "status" ? (groupKey as TaskStatus) : "todo",
      priority: "normal",
      assigneeId: me.id, contactId: null,
      due: groupBy === "due" && groupKey === "today" ? TODAY : TOMORROW,
      recurrence: "none", labelIds: [], ghlTaskId: null, private: true, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
  };

  // --- mutations ------------------------------------------------------------

  const update = (id: string, patch: Partial<Task>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const cur = tasks.find((t) => t.id === id);
    if (cur) { const merged = { ...cur, ...patch }; upsertTask(merged, me.id); syncGhlIfLinked(merged, patch); }
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
    const before = tasks.find((x) => x.id === id);
    if (!before) return;
    const events = describeFieldChange(before, patch).map((body) => ({ id: newId("cm_"), authorId: me.id, body, at: new Date().toISOString(), kind: "event" as const }));
    const updated: Task = { ...before, ...patch, comments: events.length ? [...before.comments, ...events] : before.comments };
    let clone: Task | null = null;
    if (patch.status === "done" && before.status !== "done" && before.recurrence !== "none") {
      const nextDue = advanceDue(before.due, before.recurrence, before.recurrenceInterval, before.recurrenceUnit, before.recurrenceDaysOfMonth);
      clone = { ...before, id: newId("t_"), status: "todo", due: nextDue, subtasks: before.subtasks.map((s) => ({ ...s, id: newId("s_"), done: false })), comments: [], attachments: [...before.attachments], ghlTaskId: null };
      pushToast(`🔁 Recurring — next occurrence created for ${formatDue(nextDue)}`);
    }
    setTasks((prev) => { let next = prev.map((x) => (x.id === id ? updated : x)); if (clone) next = [...next, clone]; return next; });
    upsertTask(updated, me.id);
    syncGhlIfLinked(updated, patch);
    if (clone) upsertTask(clone, me.id);
    if (patch.assigneeId && patch.assigneeId !== me.id && patch.assigneeId !== before.assigneeId) {
      notify(patch.assigneeId, `${me.name} assigned you “${before.title}”`, id);
      pushToast(`Notified ${userById(patch.assigneeId)?.name}`);
    }
    // Finishing work is worth surfacing to the rest of the team, not just silence.
    if (patch.status && (patch.status === "review" || patch.status === "done") && patch.status !== before.status) {
      users.filter((u) => u.id !== me.id && (u.role === "admin" || before.assigneeId === u.id)).forEach((u) => {
        notify(u.id, `${me.name} moved “${before.title}” to ${STATUS_META[patch.status as TaskStatus].label}`, id);
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
            const t = tasks.find((x) => x.id === id);
            if (!t) return null;
            const prev: Partial<Task> = {};
            keys.forEach((k) => { (prev as Record<string, unknown>)[k] = t[k]; });
            return { id, prev };
          })
          .filter((x): x is { id: string; prev: Partial<Task> } => !!x);
        ids.forEach((id) => patchTask(id, patch));
        setConfirmDialog(null);
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
  // "Move all due dates forward" — a client/project list can pile up many
  // dated tasks (a slow week leaves everything overdue) and re-dating each
  // one by hand is exactly the tedium Derek flagged. Pick a new date for
  // whichever open task is due soonest; every other dated open task on this
  // client/project shifts by that same day-delta, preserving relative
  // spacing (a task 3 days after another stays 3 days after) instead of
  // collapsing everything onto one date the way the bulk-select toolbar's
  // due-date field already does for a manually-selected set.
  const pushAllDatesForward = (newEarliestDate: string) => {
    const dated = baseTasks.filter((t) => t.status !== "done" && t.due);
    if (!dated.length) { pushToast("No dated open tasks here to move."); return; }
    const earliest = dated.reduce((a, b) => (b.due! < a.due! ? b : a)).due!;
    const delta = daysBetween(earliest, newEarliestDate);
    if (delta === 0) return;
    dated.forEach((t) => update(t.id, { due: addDaysIso(t.due!, delta) }));
    pushToast(`Moved ${dated.length} due date${dated.length === 1 ? "" : "s"} ${delta > 0 ? "forward" : "back"} ${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"}.`);
  };
  const deleteTask = (id: string) => {
    setConfirmDialog({
      title: "Delete this task?", message: "This can't be undone.", confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        const t = tasks.find((x) => x.id === id);
        if (t?.ghlTaskId) ghlCall("delete", t); // also remove it from GoHighLevel
        setTasks((ts) => ts.filter((t) => t.id !== id));
        setOpenTaskId(null);
        deleteTaskDb(id);
        pushToast("Task deleted");
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
      if (u.id !== me.id && body.includes("@" + u.name)) {
        mentioned.add(u.id);
        notify(u.id, `${me.name} mentioned you in “${t.title}”`, id, { kind: "message", skipEmail: true });
        pushToast(`Notified ${u.name}`);
        sendMentionEmail(u.id, id, t.title, body.trim());
      }
    });
    if (t.assigneeId && t.assigneeId !== me.id && !mentioned.has(t.assigneeId)) {
      notify(t.assigneeId, `${me.name} commented on “${t.title}”`, id, { kind: "message" });
    }
    setComment("");
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
  const removeFile = (id: string, att: Attachment) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    if (att.path) deleteTaskFile(att.path);
    update(id, { attachments: t.attachments.filter((a) => a.id !== att.id) });
    pushToast("Attachment removed");
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
          body: JSON.stringify({ clientId, toEmail: contact.email, subject, body, cc: emailCc, bcc: emailBcc, fromEmail, attachments: attachments.filter((a) => a.path).map((a) => ({ path: a.path, name: a.name })) }),
        });
        if (gres.status !== 501) {
          const gj = await gres.json().catch(() => ({}));
          if (!gres.ok || gj.error) { pushToast(gj.error || "Failed to send email."); return; }
          const gm: Message = {
            id: newId("msg_"), contactId: contact.id, clientId, taskId, channel, direction: "outbound",
            subject: subject.trim() ? subject.trim() : null, body,
            ghlMessageId: null, gmailMessageId: gj.gmailMessageId ?? null, createdBy: me.id, at: new Date().toISOString(), read: true,
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
        body: JSON.stringify({ clientId, locationId: target.locationId, ghlContactId: target.ghlContactId, channel, subject: channel === "email" ? subject : undefined, body, attachments: attachmentUrls, cc: emailCc, bcc: emailBcc }),
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
  // Pulls a contact's tasks created directly in GoHighLevel (not pushed from
  // here) into local tracked tasks, linked via ghlTaskId so they join the
  // existing two-way sync (see GHL_SYNC_FIELDS/syncGhlIfLinked below) going
  // forward. Dedupes against ghlTaskId already present locally so re-clicking
  // never creates duplicates.
  const importGhlTasks = async () => {
    const contact = activeContact();
    const target = contact && ghlTargetForContact(contact);
    if (!contact || !target) return;
    setImportingTasks(true);
    try {
      const res = await authedFetch(`/api/ghl/import-tasks?${new URLSearchParams(target)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.error) { pushToast(j?.error ?? "GoHighLevel import failed."); return; }
      const existingGhlIds = new Set(tasks.map((t) => t.ghlTaskId).filter(Boolean));
      const notYetImported = ((j.tasks ?? []) as { ghlTaskId: string; title: string; description: string; due: string | null; completed: boolean }[])
        .filter((g) => !existingGhlIds.has(g.ghlTaskId));
      // GHL tasks are commonly years of completed history (recurring blog/
      // review tasks, etc.) — importing those would just be dead clutter in
      // an active task manager, so open tasks only.
      const skippedDone = notYetImported.filter((g) => g.completed).length;
      const fresh = notYetImported.filter((g) => !g.completed);
      if (fresh.length === 0) {
        pushToast(skippedDone > 0
          ? `No open tasks to import — skipped ${skippedDone} already-completed task${skippedDone === 1 ? "" : "s"}.`
          : "No new tasks to import — everything's already tracked.");
        return;
      }
      let projectId = projects.find((p) => p.clientId === activeClient)?.id;
      if (!projectId) {
        const p: Project = { id: newId("p_"), clientId: activeClient, name: "Tasks", description: "" };
        setProjects((ps) => [...ps, p]);
        upsertProject(p);
        projectId = p.id;
      }
      const newTasks: Task[] = fresh.map((g) => ({
        id: newId("t_"), projectId: projectId!, clientId: activeClient, title: g.title, description: g.description,
        status: "todo", priority: "none", assigneeId: null, contactId: contact.id,
        due: g.due, recurrence: "none", labelIds: [], ghlTaskId: g.ghlTaskId, private: false, subtasks: [], attachments: [], comments: [],
        createdAt: new Date().toISOString(),
      }));
      setTasks((ts) => [...ts, ...newTasks]);
      newTasks.forEach((t) => upsertTask(t, me.id));
      pushToast(`Imported ${newTasks.length} task${newTasks.length === 1 ? "" : "s"} from GoHighLevel${skippedDone > 0 ? ` (skipped ${skippedDone} already completed)` : ""}`);
    } catch {
      pushToast("Network error reaching GoHighLevel.");
    } finally {
      setImportingTasks(false);
    }
  };
  const toggleSub = (taskId: string, subId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const s = t.subtasks.find((x) => x.id === subId);
    const nowDone = s ? !s.done : false;
    update(taskId, { subtasks: t.subtasks.map((x) => (x.id === subId ? { ...x, done: !x.done } : x)) });
    // Completing a delegated item pings the task owner so they know it's handled.
    if (nowDone && s?.assigneeId && t.assigneeId && t.assigneeId !== me.id) notify(t.assigneeId, `${me.name} completed "${s.title}" on ${t.title}`, taskId);
  };
  const addSub = (taskId: string, title: string) => { const t = tasks.find((x) => x.id === taskId); if (t && title.trim()) update(taskId, { subtasks: [...t.subtasks, { id: newId("s_"), title: title.trim(), done: false }] }); };
  const renameSub = (taskId: string, subId: string, title: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, title } : s)) }); };
  const deleteSub = (taskId: string, subId: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { subtasks: t.subtasks.filter((s) => s.id !== subId) }); };
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
    if (clients.some((c) => c.id === id)) { setActiveClient(id); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setAddClientOpen(false); return; }
    // Prevent a duplicate: if this contact matches a client we already track
    // (same email/phone/name, e.g. the same business in the other GHL
    // account), link it to that one and open it instead of making a second.
    const dupe = findDuplicateTrackedClient(contact);
    if (dupe) {
      linkContactToClient(dupe, contact.id);
      setActiveClient(dupe); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setAddClientOpen(false);
      pushToast(`${contact.name} is already tracked as “${clientById(dupe)?.name}” — linked to it.`);
      return;
    }
    const sub = subAccounts.find((s) => s.id === contact.clientId);
    const c: Client = { id, name: contact.name, color: sub?.color ?? "#a855f7", ghlLocationId: "", status: "lead", type, assignedTo: [] };
    setClients((cs) => [...cs, c]);
    markOwnClientWrite(c.id);
    upsertClient(c);
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
  // Territory is a working view over what's already in GHL — a business
  // showing up in the ClickUpLocal directory for an assigned city means it's
  // being actively worked, so it just needs to already be here as a Lead
  // (no manual "+ Add as client" step). Bulk, silent, no navigation/toast —
  // unlike addClientContact (a single user-initiated add-and-open action),
  // this can fire for dozens/hundreds of contacts at once as a territory
  // page loads.
  const syncTerritoryClients = (matched: Contact[]) => {
    // Skip contacts already tracked under a different id (same email/phone/
    // name in the other GHL account) — auto-creating cl_<id> for them is
    // exactly how duplicate client records were getting made.
    const missing = matched.filter((c) => !clients.some((cl) => cl.id === "cl_" + c.id) && !findDuplicateTrackedClient(c));
    if (!missing.length) return;
    // Dedupe before building the batch, on two axes:
    //
    // 1. Same contact id twice. The caller maps over LISTINGS, and two
    //    listings can resolve to the same GHL contact, so the same cl_<id>
    //    could appear twice. Postgres rejects an upsert whose statement
    //    touches one row twice ("ON CONFLICT DO UPDATE command cannot affect
    //    row a second time"), failing the whole batch — and since nothing
    //    persisted, every refresh retried the identical failing write.
    //
    // 2. Distinct contact ids that are the same business (shared email,
    //    phone, or name). findDuplicateTrackedClient above only compares
    //    against already-persisted clients, never members of this batch
    //    against each other, so these sailed through with different primary
    //    keys — no error, no toast, just the same business silently listed
    //    twice after a first sync. Same rule as the persisted check.
    const seenEmail = new Set<string>(), seenPhone = new Set<string>(), seenName = new Set<string>();
    const unique = [...new Map(missing.map((c) => [c.id, c])).values()].filter((c) => {
      const email = (c.email ?? "").trim().toLowerCase();
      const phone = dedupPhone(c.phone);
      const name = dedupName(c.name);
      if ((email && seenEmail.has(email)) || (phone && seenPhone.has(phone)) || (name.length > 3 && seenName.has(name))) return false;
      if (email) seenEmail.add(email);
      if (phone) seenPhone.add(phone);
      if (name.length > 3) seenName.add(name);
      return true;
    });
    const newClients: Client[] = unique.map((c) => {
      const sub = subAccounts.find((s) => s.id === c.clientId);
      return { id: "cl_" + c.id, name: c.name, color: sub?.color ?? "#a855f7", ghlLocationId: "", status: "lead", type: "client", assignedTo: [] };
    });
    setClients((cs) => [...cs, ...newClients]);
    newClients.forEach((c) => markOwnClientWrite(c.id));
    bulkUpsertClients(newClients);
  };
  // The list every feature's touches land in. Named by us, not the user, so
  // deriving "has this business been featured?" off it is stable.
  const FEATURE_LIST = "Newsletter feature";
  // Businesses already run through the newsletter motion, so the territory
  // can show who's been used and you never double-feature a city.
  const featuredClientIds = useMemo(() => {
    const listIds = new Set(projects.filter((p) => p.name === FEATURE_LIST).map((p) => p.id));
    return new Set(tasks.filter((t) => listIds.has(t.projectId)).map((t) => t.clientId));
  }, [projects, tasks]);

  // G2-SOP Stage 3, turned into dated work. Per the Jul 20 2026 field note in
  // 02-SOP-Sales-Process.md, the feature invite IS the opener ("we want to
  // write an article about your business") — cold calling is the low-yield
  // path. Day 0 is the day you click, because that's when the invite goes
  // out; the newsletter itself ships the following Wednesday.
  const featureBusiness = (opts: { clientId: string | null; contact: Contact | null; name: string; city: string; state: string }) => {
    const { name, city, state } = opts;
    // A directory business you haven't touched yet has no client record — the
    // bulk sync only creates one once it's matched to a GHL contact. Featuring
    // it is a decision to start working it, so promote it here rather than
    // making the button quietly do nothing (which is exactly what it did).
    let clientId = opts.clientId;
    if (!clientId) {
      if (!opts.contact) { pushToast(`No GoHighLevel contact matched to ${name} yet — can't start the sequence.`); return; }
      const c = opts.contact;
      const sub = subAccounts.find((s) => s.id === c.clientId);
      const nc: Client = { id: "cl_" + c.id, name: c.name, color: sub?.color ?? "#a855f7", ghlLocationId: "", status: "lead", type: "client", assignedTo: [] };
      setClients((cs) => (cs.some((x) => x.id === nc.id) ? cs : [...cs, nc]));
      markOwnClientWrite(nc.id);
      bulkUpsertClients([nc]);
      clientId = nc.id;
    }
    let projectId = projects.find((p) => p.clientId === clientId && p.name === FEATURE_LIST)?.id;
    if (!projectId) {
      const p: Project = { id: newId("p_"), clientId, name: FEATURE_LIST, description: "" };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
      projectId = p.id;
    }
    // The city's ambassador owns the sequence when there's exactly one;
    // otherwise it lands on whoever pressed the button rather than guessing.
    const terr = territories.find((t) => t.city.trim().toLowerCase() === city.trim().toLowerCase() && normalizeState(t.state) === normalizeState(state));
    const roster = terr?.assignedTo ?? [];
    const owner = roster.length === 1 ? roster[0] : me.id;
    const contactId = clientId.startsWith("cl_") ? clientId.slice(3) : null;
    // Day offsets straight from the SOP's touch timeline.
    const touches: [number, string][] = [
      [0, `Feature invite email — ${name}`],
      [1, `Call or drop-in — ${name}`],
      [3, `Value email: what the feature looks like — ${name}`],
      [5, `Second attempt — still want to feature you — ${name}`],
      [8, `Break-up note — ${name}`],
    ];
    const created: Task[] = touches.map(([offset, title]) => ({
      id: newId("t_"), projectId: projectId!, clientId, title, description: "",
      status: "todo", priority: "normal", assigneeId: owner, contactId,
      due: addDaysIso(TODAY, offset), recurrence: "none", labelIds: [], ghlTaskId: null, private: false,
      subtasks: [], comments: [], attachments: [], createdAt: new Date().toISOString(),
    }));
    setTasks((ts) => [...ts, ...created]);
    created.forEach((t) => upsertTask(t, me.id));
    if (owner !== me.id) notify(owner, `${me.name} queued ${name} for a newsletter feature — ${created.length} touches`, created[0].id, { clientId });
    pushToast(`${name} featured — ${created.length} touches added to ${userById(owner)?.name ?? "you"}.`);
  };

  const addTerritory = (spec: { name: string; city: string; state: string; assignedTo: string[] }) => {
    const t: Territory = { id: newId("terr_"), ...spec };
    setTerritories((ts) => [...ts, t]);
    upsertTerritory(t);
  };
  // Toggle a teammate on/off a city's ambassador list — a city can have several.
  const toggleTerritoryAssignee = (id: string, memberId: string) => {
    const t = territories.find((x) => x.id === id);
    if (!t) return;
    const has = (t.assignedTo ?? []).includes(memberId);
    const nt = { ...t, assignedTo: has ? t.assignedTo.filter((m) => m !== memberId) : [...(t.assignedTo ?? []), memberId] };
    setTerritories((ts) => ts.map((x) => (x.id === id ? nt : x)));
    upsertTerritory(nt);
  };
  const deleteTerritory = (id: string) => {
    setTerritories((ts) => ts.filter((t) => t.id !== id));
    deleteTerritoryDb(id);
  };
  const saveTemplate = (id: string | undefined, spec: { name: string; checklistItems: string[] }) => {
    const t: TaskTemplate = { id: id ?? newId("tmpl_"), ...spec };
    setTaskTemplates((ts) => (id ? ts.map((x) => (x.id === id ? t : x)) : [...ts, t]));
    upsertTaskTemplate(t);
  };
  const deleteTemplate = (id: string) => {
    setTaskTemplates((ts) => ts.filter((t) => t.id !== id));
    deleteTaskTemplateDb(id);
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
      due: TOMORROW, recurrence: "none", labelIds: [], ghlTaskId: null, private: false,
      subtasks: tpl.checklistItems.map((title) => ({ id: newId("s_"), title, done: false })),
      attachments: [], comments: [], createdAt: new Date().toISOString(),
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
    setPlaybooks((ps) => ps.filter((p) => p.id !== id));
    deletePlaybookDb(id);
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
      subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
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
      message: `${n ? `This also removes its ${n} task${n === 1 ? "" : "s"}. ` : ""}The GoHighLevel contact itself stays untouched.`,
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
      stageId,
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t, me.id);
  };
  const moveTaskToNewProject = (taskId: string, clientId: string) => {
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
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.clientId === newClientId) return;
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
    const movable = ids.filter((id) => tasks.find((t) => t.id === id)?.clientId !== clientId);
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
            const t = tasks.find((x) => x.id === id);
            return t ? { id, prev: { clientId: t.clientId, projectId: t.projectId, contactId: t.contactId, ghlTaskId: t.ghlTaskId } as Partial<Task> } : null;
          })
          .filter((x): x is { id: string; prev: Partial<Task> } => !!x);
        movable.forEach((id) => moveTaskToClient(id, clientId, true));
        setConfirmDialog(null);
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
  const mergeTasks = (sourceId: string, targetId: string) => {
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
    reassignMessagesTaskDb(sourceId, targetId);
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
      message: n ? `This also deletes its ${n} task${n === 1 ? "" : "s"}.` : "This can't be undone.",
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
    const lower = body.toLowerCase();
    users.forEach((u) => {
      if (u.id === me.id) return;
      const at = "@" + u.name.toLowerCase();
      let from = lower.indexOf(at);
      while (from !== -1) {
        const after = lower[from + at.length];
        if (after === undefined || !/[\w]/.test(after)) { notify(u.id, `${me.name} mentioned you in Team Chat`, null, { kind: "message" }); return; }
        from = lower.indexOf(at, from + 1);
      }
    });
  };
  const deleteTeamMessage = (id: string) => {
    setTeamMessages((ms) => ms.filter((m) => m.id !== id));
    deleteTeamMessageDb(id);
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
    const m: DmMessage = { id: newId("dm_"), conversationId: dmConversationId(me.id, otherUserId), authorId: me.id, recipientId: otherUserId, body: body.trim(), at: new Date().toISOString(), replyToId: replyToId ?? null, attachments: attachments ?? [] };
    setDmMessages((ms) => [...ms, m]);
    insertDmMessage(m);
    notify(otherUserId, `${me.name} sent you a message`, null, { kind: "dm" });
  };
  const deleteDmMessage = (id: string) => {
    setDmMessages((ms) => ms.filter((m) => m.id !== id));
    deleteDmMessageDb(id);
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
      if (u.id !== me.id && body.includes("@" + u.name)) notify(u.id, `${me.name} mentioned you in the ${where ?? "team"} chat`, null, { clientId, projectId, kind: "message" });
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
  const territoryTitle = territoryView ? (territoryView === "all" ? "Territories" : (territoryById(territoryView) ? `${territoryById(territoryView)!.city}, ${territoryById(territoryView)!.state}` : "Territory")) : null;
  const headerTitleText = territoryTitle ?? (settingsView ? "Settings" : inboxView ? (dmUserId ? (userById(dmUserId)?.name ?? "Direct Message") : "Team Chat") : dirView === "clients" ? "Clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "Dashboard" : activeClient === "all" ? "All Tasks" : (activeProject && projectById(activeProject) ? projectById(activeProject)!.name : (clientById(activeClient)?.name ?? "")));
  const isClientDetail = !myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && !!clientById(activeClient);
  const showFilterControl = !territoryView && !inboxView && !dirView && !myWork && !(activeClient !== "all" && (clientTab === "chat" || clientTab === "vault"));
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
  const filterControl = (
    <div className="relative">
      <button onClick={() => setFilterOpen((o) => !o)} title="Filter & view" className="relative rounded-md border bg-background p-2 text-muted hover:text-foreground">
        <I.filter />
        {activeFilterCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[13px] font-semibold text-white">{activeFilterCount}</span>}
      </button>
      {filterOpen && (<>
        <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
        <div className="absolute right-0 z-40 mt-1 w-72 max-w-[calc(100vw-1.5rem)] space-y-2.5 rounded-xl border bg-surface p-3 shadow-xl">
          {!personalView && activeClient !== "all" && clientById(activeClient) && (
            <div className="space-y-1.5 border-b pb-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Following</span>
                {!canAdmin && (
                  <div className="flex items-center -space-x-1.5">
                    {(clientById(activeClient)!.assignedTo ?? []).length === 0 && <span className="text-[13px] text-muted">Nobody yet</span>}
                    {(clientById(activeClient)!.assignedTo ?? []).map((uid) => (<Avatar key={uid} id={uid} size={20} />))}
                  </div>
                )}
              </div>
              {canAdmin && (
                <div className="grid grid-cols-2 gap-0.5">
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
          )}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Group &amp; sort</span>
            {(filtersActive || sortBy !== "due" || groupBy !== "priority") && <button onClick={() => { setFilters({ status: "all", assignee: "all", priority: "all" }); setGroupBy("priority"); setSortBy("due"); }} className="text-[13px] font-medium text-accent">Reset</button>}
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
          <div className="border-t pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Filter</div>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Status</span><select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as FilterState["status"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Assignee</span><select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Priority</span><select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as FilterState["priority"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{PRIORITY_ORDER.filter((p) => p !== "none").map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></label>
          <div className="border-t pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Columns</div>
          <div className="grid grid-cols-2 gap-0.5">
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
          {activeClient !== "all" && !activeProject && clientById(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); setClientTab("chat"); regenerateAiSummary(activeClient); }} disabled={aiSummaryBusyId === activeClient}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background disabled:opacity-50 sm:hidden"><span aria-hidden>✨</span> {aiSummaryBusyId === activeClient ? "Thinking…" : "What's next"}</button>
          )}
          <button onClick={() => { setHeaderMoreOpen(false); copyLink({ view: null, client: activeClient, project: activeProject, task: null, clientTab, vaultFolder: null }); }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.link /> Copy link</button>
          <button onClick={() => { setHeaderMoreOpen(false); copyClientForClaude(); }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>✳</span> Copy for Claude</button>
          <button onClick={() => { setHeaderMoreOpen(false); queueClientForClaude(); }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>★</span> Queue for Claude</button>
          <div title="Shifts every open dated task here by the same number of days, preserving their relative spacing"
            className="rounded-md px-2.5 py-1.5 hover:bg-background">
            <div className="mb-1 flex items-center gap-2 text-[13px]"><I.calendar className="shrink-0" /> Move all due dates to…</div>
            <input type="date" onClick={(e) => e.stopPropagation()}
              onChange={(e) => { if (e.target.value) { setHeaderMoreOpen(false); pushAllDatesForward(e.target.value); } e.target.value = ""; }}
              className="w-full rounded border bg-background px-1.5 py-1 text-[13px] outline-none" />
          </div>
          <button onClick={() => {
              setHeaderMoreOpen(false);
              const scope = activeProject ? `client ${activeClient}, project ${activeProject}` : `client ${activeClient}`;
              const clientName = clientById(activeClient)?.name ?? activeClient;
              const projectName = activeProject ? projectById(activeProject)?.name : null;
              const label = projectName ? `${clientName} — ${projectName}` : clientName;
              window.location.href = claudeCodeUrl(`${label}\n\nWork through the open tasks for ClickUpTasks ${scope} using the clickuptasks MCP tools — start with list_client_tasks.`);
            }}
            title="Open this client/project in Claude Desktop, ready to work through its open tasks"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>▶</span> Work with Claude</button>
          {canAdmin && (
            <button onClick={() => { setHeaderMoreOpen(false); setLinkModal({}); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.plus /> Add quick link</button>
          )}
          {canAdmin && !activeProject && activeClient.startsWith("cl_") && clientById(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); setMergeClientState({ a: clientById(activeClient)! }); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.repeat /> Merge with another client…</button>
          )}
          {ghlContactUrlFor(activeClient) && (
            <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" onClick={() => setHeaderMoreOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-accent hover:bg-background"><I.bolt /> Open in GoHighLevel</a>
          )}
          {ghlContactUrlFor(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); importGhlTasks(); }} disabled={importingTasks}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background disabled:opacity-50"><I.repeat /> Import tasks from GHL</button>
          )}
          {canAdmin && !ghlContactUrlFor(activeClient) && (
            <button onClick={() => { setHeaderMoreOpen(false); setGhlLinkSearch(""); setGhlLinkOpen(true); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.bolt /> Link to GoHighLevel</button>
          )}
          {canAdmin && clientById(activeClient)?.linkedContactId && (
            <button onClick={() => { setHeaderMoreOpen(false); linkClientToContact(activeClient, null); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-background hover:text-danger"><I.close /> Unlink from GoHighLevel</button>
          )}
        </div>
      </>)}
    </div>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden text-[15px]">
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
          <button onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setDirView(null); setTerritoryView(null); setSidebarOpen(false); setOpenTaskId(null); setSettingsView(true); }} title="Settings" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground"><I.gear /></button>
          <button onClick={toggleTheme} title="Toggle theme" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">{theme === "light" ? <I.moon /> : <I.sun />}</button>
          <button onClick={onSignOut} title="Sign out" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-background hover:text-red-500"><I.logout /></button>
        </div>

        {/* Chat hub: Team Chat + one row per teammate for private DMs, merged
            into a single section per Derek's ask — "different chat groups...
            a team chat that's everyone but then we can all private chat with
            each other." Roster is small (a handful of people), so every
            teammate gets a row rather than only ones you've messaged before —
            no extra state to derive, matches how Territories/Pinned already
            work at this scale. */}
        {navVisible.inbox && (
          <div className="shrink-0 space-y-0.5 px-2">
            <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Chat</div>
            <SideItem active={inboxView && dmUserId === null} onClick={openTeamChat}><I.comment className="text-muted" /> <span>Team</span>{(teamChatUnread || unread > 0) && (
              // Both indicators, not either/or: notifications accumulate
              // routinely, and an exclusive check meant a real unread chat
              // message showed nothing at all whenever any notice was pending.
              <span className="ml-auto flex items-center gap-1.5">
                {teamChatUnread && <span title="Unread team chat" className="h-2 w-2 rounded-full bg-accent" />}
                {unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[13px] font-semibold text-white">{unread}</span>}
              </span>
            )}</SideItem>
            {users.filter((u) => u.id !== me.id && u.id !== "u_claude").map((u) => (
              <SideItem key={u.id} active={inboxView && dmUserId === u.id} onClick={() => openDm(u.id)}>
                <Avatar id={u.id} size={20} /> <span className="min-w-0 flex-1 truncate text-left">{u.name}</span>
                {dmUnread(u.id) && <span title="Unread messages" className="ml-auto h-2 w-2 rounded-full bg-accent" />}
              </SideItem>
            ))}
          </div>
        )}
        <nav className="shrink-0 space-y-0.5 px-2">
          {navVisible.work && <SideItem active={myWork} onClick={() => { setMyWork(true); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setSidebarOpen(false); setOpenTaskId(null); }}><I.grid className="text-muted" /> <span>Dashboard</span><span className="ml-auto text-[13px] text-muted">{myAssignedClients.length + assignedProjectsFor(me.id).length}</span></SideItem>}
          {navVisible.all && <SideItem active={!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient === "all"} onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient("all"); setSidebarOpen(false); setOpenTaskId(null); }}><I.list className="text-muted" /> <span>All Tasks</span><span className="ml-auto text-[13px] text-muted">{scopedTasks.filter((t) => t.clientId.startsWith("cl_")).length}</span></SideItem>}
          {navVisible.personal && <SideItem active={personalView} onClick={() => { setPersonalView(true); setMyWork(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setSidebarOpen(false); setOpenTaskId(null); }}><I.check className="text-muted" /> <span>Personal</span><span className="ml-auto text-[13px] text-muted">{myPersonalTasks.filter((t) => t.status !== "done").length}</span></SideItem>}
        </nav>

        {/* Projects / Clients are now directory pages, not inline lists — the
            sidebar stays lean since day-to-day work happens from Dashboard. */}
        <nav className="mt-1.5 shrink-0 space-y-0.5 border-t px-2 pt-1.5">
          <SideItem active={dirView === "clients"} onClick={() => { setDirView("clients"); setTerritoryView(null); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setSidebarOpen(false); setOpenTaskId(null); }}><I.user className="text-muted" /> <span>Clients</span><span className="ml-auto text-[13px] text-muted">{clientList.length}</span></SideItem>
          {clients.some((c) => c.id === WORKSPACE_CLIENT_ID) && (
            <SideItem active={dirView === "projects"} onClick={() => { setDirView("projects"); setTerritoryView(null); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setSidebarOpen(false); setOpenTaskId(null); }}><I.folder className="text-muted" /> <span>Projects</span><span className="ml-auto text-[13px] text-muted">{workspaceProjects.length}</span></SideItem>
          )}
        </nav>

        {/* Pinned — per-user quick access to starred clients + lists. Starring
            a client (from the Clients directory or its header) pins it here.
            Placed right after Clients/Projects, ahead of Territories — a
            territory roster can run long, and Pinned is the highest-value,
            most-frequently-tapped section, so it shouldn't get pushed below
            the fold on a phone (where scrolling past a long Territories list
            to reach it is what made pins effectively invisible on mobile). */}
        {(() => {
          const pinnedClients = [...starred].map((id) => clientById(id)).filter((c): c is Client => !!c && c.id.startsWith("cl_"));
          const pinned = [...starredLists].map((id) => projectById(id)).filter((p): p is Project => !!p);
          if (pinnedClients.length === 0 && pinned.length === 0) return null;
          return (
            <nav className="mt-1.5 shrink-0 space-y-0.5 border-t px-2 pt-1.5">
              <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Pinned</div>
              {pinnedClients.map((c) => {
                const active = !myWork && !personalView && !inboxView && !settingsView && !dirView && !activeProject && activeClient === c.id;
                return (
                  <SideItem key={c.id} active={active} onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(c.id); setActiveProject(null); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientStatusMeta(c.status).dot }} /> <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                    <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggleStar(c.id); }} title="Unpin from sidebar" className="shrink-0 rounded p-0.5 text-amber-400 hover:bg-background"><I.star filled /></span>
                  </SideItem>
                );
              })}
              {pinned.map((p) => {
                const active = !myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject === p.id;
                return (
                  <SideItem key={p.id} active={active} onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(p.clientId); setActiveProject(p.id); setClientTab("tasks"); setSidebarOpen(false); setOpenTaskId(null); }}>
                    <I.list className="text-muted" /> <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                    <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggleStarList(p.id); }} title="Unpin from sidebar" className="shrink-0 rounded p-0.5 text-amber-400 hover:bg-background"><I.star filled /></span>
                  </SideItem>
                );
              })}
            </nav>
          );
        })()}

        {/* Territories — cities (city+state) assigned to you; an admin sees all.
            Click a city to work its contacts (claimed vs unclaimed). */}
        {visibleTerritories.length > 0 && (
          <nav className="mt-1.5 shrink-0 space-y-0.5 border-t px-2 pt-1.5">
            <div className="flex items-center justify-between px-2.5 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Territories</span>
              {canAdmin && <button onClick={() => openTerritory("all")} title="Manage territories" className="rounded p-0.5 text-muted hover:bg-background hover:text-foreground"><I.gear /></button>}
            </div>
            {visibleTerritories.map((t) => (
              <SideItem key={t.id} active={territoryView === t.id} onClick={() => openTerritory(t.id)}>
                <I.flag className="shrink-0 text-muted" /> <span className="min-w-0 flex-1 truncate text-left">{t.city}, {t.state}</span>
              </SideItem>
            ))}
          </nav>
        )}
        {canAdmin && visibleTerritories.length === 0 && (
          <nav className="mt-2 shrink-0 border-t px-2 pt-2">
            <SideItem active={territoryView === "all"} onClick={() => openTerritory("all")}><I.flag className="text-muted" /> <span>Territories</span></SideItem>
          </nav>
        )}


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
            {isClientDetail && (() => {
              const scopedProject = activeProject ? projectById(activeProject) : null;
              const entity = scopedProject ?? clientById(activeClient)!;
              const fu = entity.followUpAt ?? null;
              if (!fu) return null;
              const overdue = isOverdue(fu);
              return (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[12px] font-medium ${overdue ? "border-danger/40 bg-danger-soft text-danger" : "border-accent/40 bg-accent-soft text-accent"}`} title="Follow-up date">
                  <I.calendar /> {formatDue(fu)}
                </span>
              );
            })()}
            {bellControl}
            {isClientDetail && overflowControl}
          </div>
          {isClientDetail ? (
            <div className="flex items-center gap-2">
              <div className="flex flex-1 rounded-lg bg-background p-0.5">
                <button onClick={() => setClientTab("tasks")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${clientTab === "tasks" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Tasks</button>
                <button onClick={() => setClientTab("chat")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${clientTab === "chat" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Journal</button>
                <button onClick={() => setClientTab("vault")} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[14px] font-medium ${clientTab === "vault" ? "bg-surface text-foreground shadow-soft" : "text-muted"}`}>Vault</button>
              </div>
              {clientTab === "tasks" && filterControl}
            </div>
          ) : myWork && canAdmin ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[13px] text-muted">Work for</span>
              <select value={myWorkUser} onChange={(e) => setMyWorkUser(e.target.value)} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-[14px] outline-none">{users.map((u) => (<option key={u.id} value={u.id}>{u.name}{u.role === "va" ? " (VA)" : ""}</option>))}</select>
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
              {filterControl}
            </div>
          ) : null}
        </header>

        <header className="relative z-10 hidden flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-surface px-4 py-2 shadow-soft sm:flex sm:gap-y-2 sm:px-5 sm:py-3">
          <button onClick={toggleSidebar} title="Show/hide sidebar" className="rounded-lg border p-2 text-muted hover:text-foreground"><I.menu /></button>
          <div className="min-w-0">
            {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeProject && projectById(activeProject) ? (<>
              <h1 className="flex items-center gap-1.5 truncate text-[20px] font-semibold"><I.folder className="shrink-0 text-muted" /> {projectById(activeProject)!.name}</h1>
              <p className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
                <button onClick={() => { setDirView("clients"); setTerritoryView(null); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setOpenTaskId(null); }} className="hover:text-foreground hover:underline">Clients</button>
                <span>›</span>
                <button onClick={() => setActiveProject(null)} className="hover:text-foreground hover:underline">{clientById(activeClient)?.name}</button>
                <span>·</span>
                {(() => { const pg = projectProgress(activeProject); return (<span className="inline-flex items-center gap-1.5">{pg.done}/{pg.total} done<span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-border align-middle"><span className="block h-full rounded-full bg-green-500 transition-all" style={{ width: `${pg.pct}%` }} /></span>{pg.pct}%</span>); })()}
              </p>
            </>) : (<>
              <h1 className="flex items-center gap-2 truncate text-[20px] font-semibold">
                {territoryTitle ? territoryTitle : settingsView ? "Settings" : inboxView ? (dmUserId ? (userById(dmUserId)?.name ?? "Direct Message") : "Team Chat") : dirView === "clients" ? "Clients" : dirView === "projects" ? "Projects" : personalView ? "Personal" : myWork ? "Dashboard" : activeClient === "all" ? "All Tasks" : (ghlContactUrlFor(activeClient) ? <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="hover:text-accent hover:underline">{clientById(activeClient)?.name}</a> : clientById(activeClient)?.name)}
                {!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && (() => { const h = HEALTH_META[clientHealth(activeClient, scopedTasks)]; return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ background: h.dot + "1a", color: h.dot }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} /> {h.label}</span>; })()}
              </h1>
              {/* No subtitle for a territory — it fell through to the
                  generic "All Tasks" branch below (wrong, global counts)
                  because activeClient is "all" while viewing one; the
                  territory's own scoped counts render right below instead,
                  so repeating them here would just duplicate the title. */}
              {!territoryTitle && (
                <p className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
                  {/* Breadcrumb back to the Clients directory — only meaningful
                      when a specific client is the thing being viewed. */}
                  {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient !== "all" && (<>
                    <button onClick={() => { setDirView("clients"); setTerritoryView(null); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setActiveProject(null); setOpenTaskId(null); }} className="hover:text-foreground hover:underline">Clients</button>
                    <span>›</span>
                  </>)}
                  <span>{settingsView ? "Integrations, team, territories, templates, playbooks, and API tokens" : inboxView ? (dmUserId ? "Private — only the two of you can see this" : inboxTab === "chat" ? "Talk to the team — @mention someone to notify them" : "Everything that mentions or notifies you, in one place") : dirView === "clients" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"}` : dirView === "projects" ? `${workspaceProjects.length} project${workspaceProjects.length === 1 ? "" : "s"}` : personalView ? "Your private to-dos — only visible to you" : myWork ? "Every client and project you're on, grouped by what needs attention first" : activeClient === "all" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}` : clientCompany(clientById(activeClient))}</span>
                </p>
              )}
            </>)}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && activeClient === "all" && canAdmin && (
            <div className="inline-flex overflow-hidden rounded-md border" title="VAs only ever see their own tasks here regardless of this toggle">
              <button onClick={() => setAllTasksScope("mine")} className={`px-2.5 py-1.5 text-[13px] font-medium ${allTasksScope === "mine" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Mine</button>
              <button onClick={() => setAllTasksScope("all")} className={`px-2.5 py-1.5 text-[13px] font-medium ${allTasksScope === "all" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>All</button>
            </div>
          )}
          {/* Follow-up date — Derek's primary planning signal (he works by
              "when do I next check in", not per-task due dates), so it leads
              the header actions, ahead of the Tasks/Journal/Vault tabs, as a
              prominent accent (or red-when-overdue) pill rather than the tiny
              grey chip it used to be. */}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && clientById(activeClient) && (() => {
            const scopedProject = activeProject ? projectById(activeProject) : null;
            const entity = scopedProject ?? clientById(activeClient)!;
            const fu = entity.followUpAt ?? null;
            const overdue = isOverdue(fu);
            const setFollowUp = (d: string | null) => (scopedProject ? setProjectFollowUp(scopedProject.id, d) : setClientFollowUp(activeClient, d));
            // Auto-tracked when this entity has an open dated task — the
            // recompute effect keeps followUpAt pinned to the soonest one, so
            // the header shows it read-only (editing would just be overwritten).
            // With no dated task, it's a free manual reminder you can set.
            const autoTracked = tasks.some((t) => t.status !== "done" && !!t.due && (scopedProject ? t.projectId === scopedProject.id : t.clientId === activeClient));
            return (
              <div title={autoTracked ? "Follow-up date — auto-tracked to the next task due date" : "Follow-up date — when to next check in on this"}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${overdue ? "border-danger/40 bg-danger-soft" : fu ? "border-accent/40 bg-accent-soft" : "border-dashed"}`}>
                <I.calendar className={overdue ? "text-danger" : fu ? "text-accent" : "text-muted"} />
                {autoTracked ? (
                  <span className={`text-[13px] font-semibold ${overdue ? "text-danger" : "text-accent"}`}>{fu ? formatDue(fu) : "—"}<span className="ml-1 font-normal text-muted">· auto</span></span>
                ) : (
                  <InlineDue value={fu} overdue={overdue} onChange={setFollowUp} emptyLabel="Follow-up" strong />
                )}
              </div>
            );
          })()}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && (
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
              <button onClick={() => setClientTab("vault")} className={`px-2.5 py-1.5 text-[13px] font-medium ${clientTab === "vault" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Vault · {vaultItems.length}</button>
            </div>
          )}
          {/* Quick Email/SMS — jumps straight into the Journal composer in that
              mode. Client-scoped messaging only (not projects), gated by the
              same permission as sending. */}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && !activeProject && canMessageClient(activeClient) && (
            <div className="hidden overflow-hidden rounded-md border sm:inline-flex">
              <button onClick={() => openCompose("email")} title="Email this client" className="inline-flex items-center gap-1 bg-background px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-accent-soft hover:text-accent"><I.comment /> <span className="hidden sm:inline">Email</span></button>
              <button onClick={() => openCompose("sms")} title="Text this client" className="border-l bg-background px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-accent-soft hover:text-accent">SMS</button>
            </div>
          )}
          {/* On-demand AI recap — "here's what we just did, here's what's next".
              Client-scoped, never runs on its own (matches the app's "AI never
              spends without a click" rule). Jumps to the Journal, where the
              freshest recap is pinned at the top. */}
          {!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && !activeProject && clientById(activeClient) && (
            <button onClick={async () => { setClientTab("chat"); await regenerateAiSummary(activeClient); }}
              disabled={aiSummaryBusyId === activeClient}
              title="Generate an up-to-date 'recently done / next up' recap for this client"
              className="hidden items-center gap-1 rounded-md border px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-50 sm:inline-flex">
              <span aria-hidden>✨</span> <span className="hidden sm:inline">{aiSummaryBusyId === activeClient ? "Thinking…" : "What's next"}</span>
            </button>
          )}

          {!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && clientById(activeClient) && (
            <div className="flex items-center gap-1.5">
              {(() => {
                // One contextual Follow toggle, not two — it tracks whatever
                // scope is currently open (the project, if one's selected;
                // the client otherwise), since that's the only thing that
                // matters for surfacing it in My Work.
                const scopedProject = activeProject ? projectById(activeProject) : null;
                const following = scopedProject
                  ? (scopedProject.assignedTo ?? []).includes(me.id)
                  : (clientById(activeClient)!.assignedTo ?? []).includes(me.id);
                const toggle = () => scopedProject ? toggleProjectAssignment(scopedProject.id, me.id) : toggleClientAssignment(activeClient, me.id);
                const label = scopedProject ? "this project" : "this client";
                return (
                  <button onClick={toggle}
                    title={following ? `Following — click to stop following ${label}` : `Follow ${label} to keep it in My Work`}
                    className={`rounded-md border p-1.5 ${following ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
                    <I.bookmark filled={following} />
                  </button>
                );
              })()}
              {/* Client status, promoted from the sidebar-dot popover onto the
                  main header (Derek, Jul 17). "Nurture" drives the monthly
                  check-in. Client-scoped, so hidden while a project is open. */}
              {!activeProject && canAdmin && (() => {
                const c = clientById(activeClient)!;
                const meta = clientStatusMeta(c.status);
                return (
                  <span className="inline-flex items-center gap-1.5 rounded-md border pl-2 pr-1 py-1" title="Client status">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.dot }} />
                    <select value={c.status} onChange={(e) => { setClientStatus(c.id, e.target.value as ClientStatus); }}
                      className="cursor-pointer rounded bg-transparent py-0.5 text-[13px] font-medium text-foreground outline-none">
                      {CLIENT_STATUS_ORDER.map((s) => <option key={s} value={s}>{CLIENT_STATUS_META[s].label}</option>)}
                    </select>
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
                    <button onClick={() => goToNextReview(activeClient, activeProject)}
                      title="Go to the next client/project that needs review"
                      className="border-l border-teal-500/40 bg-teal-500/10 px-2 py-1.5 text-[13px] font-medium text-teal-600 hover:bg-teal-500/20">Next ›</button>
                  </span>
                );
              })()}
              {/* Secondary/config actions folded into one overflow menu so the
                  header leads with Follow-up / tabs / Email-SMS / Follow / Status
                  / Review instead of a cluster of equal-weight buttons. The GHL
                  actions (Open, Import, Link) all live in here too. */}
              <div className="relative">
                <button onClick={() => setHeaderMoreOpen((o) => !o)} title="More actions"
                  className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground"><I.dots /></button>
                {headerMoreOpen && (<>
                  <div className="fixed inset-0 z-40" onClick={() => setHeaderMoreOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-surface p-1 shadow-soft-md">
                    {/* Mobile-only: the messaging + recap actions that show as
                        inline buttons on ≥sm live here instead, so the phone
                        header stays short. */}
                    {activeClient !== "all" && !activeProject && canMessageClient(activeClient) && (
                      <button onClick={() => { setHeaderMoreOpen(false); openCompose("email"); }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background sm:hidden"><I.comment /> Email</button>
                    )}
                    {activeClient !== "all" && !activeProject && canMessageClient(activeClient) && (
                      <button onClick={() => { setHeaderMoreOpen(false); openCompose("sms"); }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background sm:hidden"><I.comment /> SMS</button>
                    )}
                    {activeClient !== "all" && !activeProject && clientById(activeClient) && (
                      <button onClick={() => { setHeaderMoreOpen(false); setClientTab("chat"); regenerateAiSummary(activeClient); }} disabled={aiSummaryBusyId === activeClient}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background disabled:opacity-50 sm:hidden"><span aria-hidden>✨</span> {aiSummaryBusyId === activeClient ? "Thinking…" : "What's next"}</button>
                    )}
                    <button onClick={() => { setHeaderMoreOpen(false); copyLink({ view: null, client: activeClient, project: activeProject, task: null, clientTab, vaultFolder: null }); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.link /> Copy link</button>
                    <button onClick={() => { setHeaderMoreOpen(false); copyClientForClaude(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>✳</span> Copy for Claude</button>
                    <button onClick={() => { setHeaderMoreOpen(false); queueClientForClaude(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>★</span> Queue for Claude</button>
                    <div title="Shifts every open dated task here by the same number of days, preserving their relative spacing"
                      className="rounded-md px-2.5 py-1.5 hover:bg-background">
                      <div className="mb-1 flex items-center gap-2 text-[13px]"><I.calendar className="shrink-0" /> Move all due dates to…</div>
                      <input type="date" onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { if (e.target.value) { setHeaderMoreOpen(false); pushAllDatesForward(e.target.value); } e.target.value = ""; }}
                        className="w-full rounded border bg-background px-1.5 py-1 text-[13px] outline-none" />
                    </div>
                    <button onClick={() => {
                        setHeaderMoreOpen(false);
                        const scope = activeProject ? `client ${activeClient}, project ${activeProject}` : `client ${activeClient}`;
                        const clientName = clientById(activeClient)?.name ?? activeClient;
                        const projectName = activeProject ? projectById(activeProject)?.name : null;
                        // Same auto-title lean as the task-level button: no
                        // title param exists, so lead with a readable label.
                        const label = projectName ? `${clientName} — ${projectName}` : clientName;
                        window.location.href = claudeCodeUrl(`${label}\n\nWork through the open tasks for ClickUpTasks ${scope} using the clickuptasks MCP tools — start with list_client_tasks.`);
                      }}
                      title="Open this client/project in Claude Desktop, ready to work through its open tasks"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>▶</span> Work with Claude</button>
                    {canAdmin && (
                      <button onClick={() => { setHeaderMoreOpen(false); setLinkModal({}); }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.plus /> Add quick link</button>
                    )}
                    {canAdmin && !activeProject && activeClient.startsWith("cl_") && clientById(activeClient) && (
                      <button onClick={() => { setHeaderMoreOpen(false); setMergeClientState({ a: clientById(activeClient)! }); }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.repeat /> Merge with another client…</button>
                    )}
                    {ghlContactUrlFor(activeClient) && (
                      <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" onClick={() => setHeaderMoreOpen(false)}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-accent hover:bg-background"><I.bolt /> Open in GoHighLevel</a>
                    )}
                    {ghlContactUrlFor(activeClient) && (
                      <button onClick={() => { setHeaderMoreOpen(false); importGhlTasks(); }} disabled={importingTasks}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background disabled:opacity-50"><I.repeat /> Import tasks from GHL</button>
                    )}
                    {canAdmin && !ghlContactUrlFor(activeClient) && (
                      <button onClick={() => { setHeaderMoreOpen(false); setGhlLinkSearch(""); setGhlLinkOpen(true); }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.bolt /> Link to GoHighLevel</button>
                    )}
                    {canAdmin && clientById(activeClient)?.linkedContactId && (
                      <button onClick={() => { setHeaderMoreOpen(false); linkClientToContact(activeClient, null); }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-background hover:text-danger"><I.close /> Unlink from GoHighLevel</button>
                    )}
                  </div>
                </>)}
              </div>
            </div>
          )}


          {territoryView || inboxView || settingsView || dirView ? null : myWork ? (
            canAdmin ? (
              <label className="flex items-center gap-2"><span className="text-muted">Viewing work for</span>
                <select value={myWorkUser} onChange={(e) => setMyWorkUser(e.target.value)} className="rounded-md border bg-background px-2 py-1 outline-none">{users.map((u) => (<option key={u.id} value={u.id}>{u.name}{u.role === "va" ? " (VA)" : ""}</option>))}</select>
              </label>
            ) : (
              <span className="text-[13px] text-muted">Your assigned clients and projects</span>
            )
          ) : !personalView && (clientTab === "chat" || clientTab === "vault") ? null : (
            <div className="relative">
              <button onClick={() => setFilterOpen((o) => !o)} title="Filter & view" className="relative rounded-md border bg-background p-2 text-muted hover:text-foreground">
                <I.filter />
                {activeFilterCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[13px] font-semibold text-white">{activeFilterCount}</span>}
              </button>
              {filterOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-72 space-y-2.5 rounded-xl border bg-surface p-3 shadow-xl">
                  {!personalView && activeClient !== "all" && clientById(activeClient) && (
                    <div className="space-y-1.5 border-b pb-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Following</span>
                        {!canAdmin && (
                          <div className="flex items-center -space-x-1.5">
                            {(clientById(activeClient)!.assignedTo ?? []).length === 0 && <span className="text-[13px] text-muted">Nobody yet</span>}
                            {(clientById(activeClient)!.assignedTo ?? []).map((uid) => (<Avatar key={uid} id={uid} size={20} />))}
                          </div>
                        )}
                      </div>
                      {canAdmin && (
                        <div className="grid grid-cols-2 gap-0.5">
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
                  )}
                  {activeProject && canAdmin && stagesForProject(activeProject).length === 0 && (
                    <button onClick={() => { setHeaderMoreOpen(false); createStage(activeProject); }} className="flex w-full items-center gap-2 rounded px-0 py-1 text-left text-[13px] font-medium text-accent hover:bg-background">
                      <I.plus /> Set up custom Kanban stages for this list
                    </button>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Group &amp; sort</span>
                    {(filtersActive || sortBy !== "due" || groupBy !== "priority") && <button onClick={() => { setFilters({ status: "all", assignee: "all", priority: "all" }); setGroupBy("priority"); setSortBy("due"); }} className="text-[13px] font-medium text-accent">Reset</button>}
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
                  <div className="border-t pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Filter</div>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Status</span><select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as FilterState["status"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Assignee</span><select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Priority</span><select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as FilterState["priority"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{PRIORITY_ORDER.filter((p) => p !== "none").map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></label>
                  <div className="border-t pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Columns</div>
                  <div className="grid grid-cols-2 gap-0.5">
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
          )}

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
          </div>
        </header>

        {!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && (
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
            me={me} canAdmin={canAdmin} hasTerritoryAccess={canAdmin || myTerritories.length > 0}
            subAccounts={subAccounts}
            onSaveClient={(c) => { setClients((cs) => cs.map((x) => (x.id === c.id ? c : x))); markOwnClientWrite(c.id); upsertClient(c); }}
            onSynced={async () => { try { setContacts(await fetchContacts()); pushToast("Contacts updated from GoHighLevel"); } catch { /* ignore */ } }}
            territories={territories} contacts={contacts} clients={clients}
            onAddTerritory={addTerritory} onToggleAssignee={toggleTerritoryAssignee} onDeleteTerritory={deleteTerritory}
            onAddContact={(contact) => addClientContact(contact)}
            onOpenClient={(id) => { setSettingsView(false); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setDirView(null); setTerritoryView(null); setActiveClient(id); setActiveProject(null); }}
            templates={taskTemplates} projects={projects}
            onSaveTemplate={saveTemplate} onDeleteTemplate={deleteTemplate} onUseTemplateAsTask={useTemplateAsTask}
            playbooks={playbooks} onSavePlaybook={savePlaybook} onDeletePlaybook={deletePlaybook} onLoadPlaybook={loadPlaybook}
          />
        ) : territoryView ? (
          <div className="flex-1 overflow-auto bg-background py-2">
            <TerritoryPanel me={me} canAdmin={canAdmin} territories={territories} contacts={contacts} clients={clients}
              onAddTerritory={addTerritory} onToggleAssignee={toggleTerritoryAssignee} onDeleteTerritory={(id) => { deleteTerritory(id); if (territoryView === id) setTerritoryView("all"); }}
              // Territory is a working view over what's already in GHL — no
              // "become a client" ceremony before you can open/journal a
              // business. Clicking the name is the same immediate action as
              // "+ Add as client": no confirm, no separate step.
              onAddContact={(c) => addClientContact(c)}
              onSyncClients={syncTerritoryClients}
              onSetStatus={setClientStatus}
              featuredClientIds={featuredClientIds}
              onFeature={featureBusiness}
              onOpenClient={(id) => { setTerritoryView(null); setActiveClient(id); setActiveProject(null); setClientTab("tasks"); }}
              focusId={territoryView === "all" ? undefined : territoryView} />
          </div>
        ) : inboxView && dmUserId ? (
          // A DM thread has no "Activity" sub-view (that's a Team Chat-page
          // concept — task comments/mentions addressed to you, not private
          // messages), so it skips the Chat/Activity tab bar entirely.
          <TeamChat me={me} scope={{ type: "dm", other: userById(dmUserId)! }}
            messages={dmMessages.filter((m) => m.conversationId === dmConversationId(me.id, dmUserId))}
            onSend={(body, attachments, replyToId) => sendDmMessage(dmUserId, body, attachments, replyToId)} onDelete={deleteDmMessage}
            onPin={pinDmMessage} onUploadFile={(file) => uploadOneImage(`dm/${dmConversationId(me.id, dmUserId)}`, file)} onOpenFile={downloadFile} />
        ) : inboxView ? (
          // Team Chat page — the two halves of "talk to the team" in one
          // place: the workspace chat, and the task comments/mentions
          // addressed to you. Deliberately two tabs rather than one merged
          // feed: chat is a conversation you write into, Activity is a list
          // you triage and mark read — interleaving them would bury the
          // composer and make "mark all read" ambiguous.
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b bg-surface px-4 py-2">
              {([["chat", "Chat"], ["activity", "Activity"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => { setInboxTab(v); if (v === "chat") markTeamChatRead(); }}
                  className={`relative rounded-md px-3 py-1.5 text-[13px] font-medium ${inboxTab === v ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
                  {label}
                  {v === "chat" && teamChatUnread && inboxTab !== "chat" && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />}
                  {v === "activity" && unread > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{unread}</span>}
                </button>
              ))}
            </div>
            {inboxTab === "chat" ? (
              <TeamChat me={me} scope={{ type: "team" }} messages={teamMessages} onSend={sendTeamMessage} onDelete={deleteTeamMessage}
                onPin={pinTeamMessage} onUploadFile={(file) => uploadOneImage("team-chat", file)} onOpenFile={downloadFile} />
            ) : (
              <Inbox notifications={myNotifs} clientById={clientById} projectById={projectById} onOpen={openNotification} onMarkAllRead={markAllNotifsRead} onSyncEmail={canAdmin ? syncEmail : undefined} syncingEmail={syncingEmail} onSyncAppointments={canAdmin ? syncAppointments : undefined} syncingAppointments={syncingAppointments}
                unmatchedEmails={canAdmin ? unmatchedEmails : []} onAddAsClient={addAsClientFromEmail} onDismissUnmatched={dismissUnmatched} />
            )}
          </div>
        ) : dirView === "clients" ? (
          <ClientsDirectory clients={sortedClients} clientCompany={(c) => clientCompany(c)} taskCount={clientTaskCount} starred={starred} onToggleStar={toggleStar}
            needsReview={(id) => clientNeedsReview(id, me.id)}
            onOpen={(id) => { setDirView(null); setTerritoryView(null); setActiveClient(id); setActiveProject(null); setOpenTaskId(null); setClientTab("tasks"); }}
            canAdmin={canAdmin} onAddClient={() => setAddClientOpen(true)} onRename={renameClient} onDelete={deleteClient} onSetStatus={setClientStatus}
            sort={clientSort} onSetSort={saveClientSort} scope={clientListScope} onToggleScope={() => setClientListScope((s) => (s === "mine" ? "all" : "mine"))} />
        ) : dirView === "projects" ? (
          <ProjectsDirectory projects={sortedWorkspaceProjects} openCount={projectTaskCount}
            onOpen={(id) => { setDirView(null); setTerritoryView(null); setActiveClient(WORKSPACE_CLIENT_ID); setActiveProject(id); setOpenTaskId(null); setClientTab("tasks"); }}
            canAdmin={canAdmin} onAddProject={() => addProject(WORKSPACE_CLIENT_ID)} onRename={renameProject} onDelete={deleteProject}
            starredLists={starredLists} onToggleStarList={toggleStarList} />
        ) : personalView ? (
          <GroupedList groups={buildGroups(myPersonalTasks.filter(passesFilters))} showClient={false} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={["status", "due", "priority", "comments"]} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd quickAddHint="" onQuickAdd={quickAddPersonal} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} onAddComment={addComment} hideEmpty={hideEmpty} queuedIds={claudeQueue} colOrder={colOrder} onReorderCols={reorderCols} />
        ) : myWork ? (
          <ClientsBoard groups={myWorkGroups} clientTaskCount={clientTaskCount} projectTaskCount={projectTaskCount} hasUnreadMessage={hasUnreadMessage}
            onOpenClient={(id) => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(id); setActiveProject(null); setOpenTaskId(null); }}
            onOpenProject={(id) => {
              if (id === PERSONAL_PROJECT_ID) { setMyWork(false); setPersonalView(true); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setOpenTaskId(null); return; }
              const p = projects.find((x) => x.id === id); if (!p) return;
              setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(p.clientId); setActiveProject(id); setOpenTaskId(null);
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
            toContact={activeProject ? null : contactForClient(activeClient)}
            ccContacts={contacts}
            composeIntent={composeIntent}
            sendingMessage={sendingMessage}
            onUploadImage={(file) => uploadOneImage("notes", file)}
            onOpenFile={downloadFile}
            canAdmin={canAdmin}
            canMessage={clientById(activeClient)?.canMessage}
            onToggleCanMessage={(memberId) => toggleClientMessagePermission(activeClient, memberId)}
            onDraftMessage={activeProject ? undefined : (channel, prompt) => draftMessage(activeClient, channel, prompt)}
            draftingMessage={draftingMessage}
            onRefreshContact={activeProject ? undefined : (() => { const ct = contactForClient(activeClient); return ct ? () => refreshContact(ct) : undefined; })()}
            refreshingContact={refreshingContact}
            onRefreshMessages={activeProject ? undefined : (() => { const ct = contactForClient(activeClient); return ct ? () => refreshMessages(activeClient, ct) : undefined; })()}
            refreshingMessages={refreshingMessages}
          />
        ) : activeClient !== "all" && clientTab === "vault" ? (
          <VaultView items={vaultItems} folders={activeVaultFolders} onDownloadFile={downloadFile} onGetSignedUrl={signedUrlForFile} onCopyLink={copyAttachmentLink}
            onCopyFolderLink={copyFolderLink}
            onCreateFolder={(name) => createVaultFolder(activeClient, name)}
            onRenameFolder={(id, name) => { const f = vaultFolders.find((x) => x.id === id); if (f) renameVaultFolder(f, name); }}
            onDeleteFolder={deleteVaultFolder}
            initialFolderId={initialVaultFolder} />
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
          {activeProject && stagesForProject(activeProject).length > 0 ? (
            <StageBoard stages={stagesForProject(activeProject)} tasks={baseTasks.filter(passesFilters)} canAdmin={canAdmin}
              onOpenTask={setOpenTaskId} onSetTaskStage={setTaskStage} onQuickAdd={(stageId, title) => quickAddInStage(activeProject, stageId, title)}
              onCreateStage={() => createStage(activeProject)} onRenameStage={renameStage} onToggleStageIsDone={toggleStageIsDone} onDeleteStage={deleteStage}
              onReorderStages={(ids) => reorderStages(activeProject, ids)} />
          ) : (
            <GroupedList groups={buildGroups(sortTasks(baseTasks.filter(passesFilters)))} showClient={activeClient === "all"} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={activeClient.startsWith("cl_")} quickAddHint="Pick a client on the left to add tasks." onQuickAdd={quickAdd} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} onAddComment={addComment} hideEmpty={hideEmpty} queuedIds={claudeQueue} onDropInGroup={groupBy === "status" || groupBy === "priority" ? dropTaskInGroup : undefined} onMergeTasks={requestMerge} colOrder={colOrder} onReorderCols={reorderCols} selectedIds={selectedTaskIds} onToggleSelect={toggleTaskSelection} />
          )}
          </>
        )}
      </main>

      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border bg-surface px-3 py-2 shadow-xl">
          <span className="text-[15px] font-medium">{selectedTaskIds.size} selected</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ assigneeId: e.target.value === "unassigned" ? null : e.target.value }, e.target.value === "unassigned" ? "Unassign" : `Assign to ${users.find((u) => u.id === e.target.value)?.name ?? "user"}`); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Assignee…</option><option value="unassigned">Unassigned</option><option value="waiting">⏳ Waiting on client</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ status: e.target.value as TaskStatus }, `Set status to ${STATUS_META[e.target.value as TaskStatus]?.label ?? e.target.value}`); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Status…</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ priority: e.target.value as Priority }, `Set priority to ${PRIORITY_META[e.target.value as Priority]?.label ?? e.target.value}`); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Priority…</option>{PRIORITY_ORDER.filter(isManuallyAssignable).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select>
          <input type="date" onChange={(e) => { if (e.target.value) { bulkPatch({ due: e.target.value }, `Set due date to ${e.target.value}`); e.target.value = ""; } }} title="Due date" className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none" />
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkMoveToClient(e.target.value); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Move to…</option>{[...clientList].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
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
          <button onClick={clearSelection} className="rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-background">Clear</button>
        </div>
      )}

      {openTask && (
        <TaskDrawer task={openTask} comment={comment} setComment={setComment} clientById={clientById} projectById={projectById} contactById={contactById}
          full={drawerFull} onToggleFull={toggleDrawerFull}
          navIndex={openTaskIdx} navTotal={orderedTaskIds.length} navTasks={orderedTaskIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)} onOpenTask={setOpenTaskId} onAddSibling={(title) => addTaskToList(openTask.clientId, openTask.projectId, openTask.private, title)} onPrev={() => goToTask(-1)} onNext={() => goToTask(1)}
          onClose={() => setOpenTaskId(null)} onPatch={(patch) => patchTask(openTask.id, patch)} onDelete={() => deleteTask(openTask.id)} onAddComment={(attachments) => addComment(openTask.id, comment, attachments)}
          onAddFiles={(files) => addFiles(openTask.id, files)} onDownloadFile={downloadFile} onRemoveFile={(att) => removeFile(openTask.id, att)} uploadProgress={uploadProgress} onPushGhl={() => pushToGhl(openTask.id)} ghlBusy={ghlBusy} ghlLinkable={!!ghlTargetFor(openTask)} onUnlinkGhl={() => unlinkGhl(openTask.id)} allClients={[...clientList].sort((a, b) => a.name.localeCompare(b.name))} onMoveClient={(cid) => moveTaskToClient(openTask.id, cid)} clientProjects={projectsForClient(openTask.clientId)} onSetProject={(pid) => patchTask(openTask.id, { projectId: pid })} onNewProject={() => moveTaskToNewProject(openTask.id, openTask.clientId)} onRenameProject={() => renameProject(openTask.projectId)} onToggleSub={(sid) => toggleSub(openTask.id, sid)} onAddSub={(title) => addSub(openTask.id, title)} onRenameSub={(sid, title) => renameSub(openTask.id, sid, title)} onDeleteSub={(sid) => deleteSub(openTask.id, sid)} onPatchSub={(sid, patch) => patchSub(openTask.id, sid, patch)} onToggleLabel={(lid) => toggleLabel(openTask.id, lid)} isQueued={claudeQueue.has(openTask.id)} onToggleQueue={() => toggleClaudeQueue(openTask.id)} onCopyLink={() => copyLink({ view: null, client: "all", project: null, task: openTask.id, clientTab: null, vaultFolder: null })} onOpenMerge={() => setMergeSourceId(openTask.id)} onOpenClientList={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(openTask.clientId); setActiveProject(openTask.projectId); setClientTab("tasks"); setOpenTaskId(null); }} templates={taskTemplates} onApplyTemplate={(templateId) => applyTemplate(openTask.id, templateId)} onUploadCommentImage={(file) => uploadOneImage("comments", file)} onCopyAttachmentLink={copyAttachmentLink} onGetSignedUrl={signedUrlForFile} messages={messages.filter((m) => m.taskId === openTask.id)} linkedContactInfo={contactForClient(openTask.clientId)} ccContacts={contacts} onUploadMessageImage={(file) => uploadOneImage("messages", file)} onSendTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, attachments, cc, bcc) => sendMessage(openTask.clientId, channel, subject, body, attachments, cc, bcc, openTask.id) : undefined} sendingMessage={sendingMessage} onDraftMessage={(channel, prompt) => draftMessage(openTask.clientId, channel, prompt)} draftingMessage={draftingMessage} onRegenerateAiSummary={() => regenerateAiSummary(openTask.clientId)} aiSummaryBusy={aiSummaryBusyId === openTask.clientId} />
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
      {cmdkOpen && <CommandK tasks={scopedTasks} clients={clientList} projects={projects} contacts={contacts} addedContactIds={addedContactIds} clientById={clientById}
        onOpenTask={(id) => { setOpenTaskId(id); setCmdkOpen(false); }}
        onOpenClient={(id) => { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(id); setActiveProject(null); setCmdkOpen(false); }}
        onOpenProject={(id) => {
          if (id === PERSONAL_PROJECT_ID) { setMyWork(false); setPersonalView(true); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setCmdkOpen(false); return; }
          const p = projects.find((x) => x.id === id); if (p) { setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setTerritoryView(null); setActiveClient(p.clientId); setActiveProject(id); } setCmdkOpen(false);
        }}
        onAddContact={(contact) => { addClientContact(contact); setCmdkOpen(false); }}
        onClose={() => setCmdkOpen(false)} />}

      {/* Global quick-add-task FAB — defaults to bottom-LEFT (the composer's
          Send button and toasts live bottom-right), draggable so it can be
          parked anywhere, and hidden on the Journal tab so it never covers the
          message composer while writing/sending. */}
      {!(!myWork && !personalView && !inboxView && !settingsView && !dirView && !territoryView && activeClient !== "all" && clientTab === "chat") && (
        <button onPointerDown={onFabPointerDown} onPointerMove={onFabPointerMove} onPointerUp={onFabPointerUp}
          title="Add a task (drag to move)" aria-label="Add a task"
          style={fabPos ? { left: fabPos.x, top: fabPos.y, right: "auto", bottom: "auto" } : undefined}
          className={`fixed z-30 flex h-12 w-12 touch-none items-center justify-center rounded-full bg-accent text-white shadow-lg ring-2 ring-[color:var(--surface)] transition-all duration-200 hover:opacity-90 active:scale-95 ${fabScrolling ? "pointer-events-none scale-90 opacity-0" : ""} ${fabPos ? "" : "bottom-6 left-4 sm:left-6"}`}>
          <I.plus className="h-6 w-6" />
        </button>
      )}
      {quickAddOpen && (
        <QuickAddTask
          clients={clientList}
          projectsFor={projectsForClient}
          companyFor={(id) => contactForClient(id)?.company}
          defaultClientId={activeClient.startsWith("cl_") ? activeClient : ""}
          defaultProjectId={activeProject}
          onCreate={createQuickTask}
          onClose={() => setQuickAddOpen(false)}
        />
      )}

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (<div key={t.id} className="flex items-center gap-3 rounded-lg bg-foreground px-3.5 py-2 text-[15px] font-medium text-[color:var(--surface)] shadow-lg"><span>{t.text}</span>{t.action && (<button onClick={() => { t.action!.run(); dismissToast(t.id); }} className="shrink-0 rounded-md border border-[color:var(--surface)]/35 px-2 py-0.5 text-[14px] font-semibold hover:bg-[color:var(--surface)]/15">{t.action.label}</button>)}</div>))}
      </div>
    </div>
  );
}

