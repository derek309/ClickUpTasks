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
  type Attachment,
  type Notification,
  type ClientLink,
  type ClientNote,
  type NoteType,
  type Comment,
  type Message,
  type MessageChannel,
  type Me,
  type Territory,
  type TaskTemplate,
  type VaultFolder,
  PERSONAL_CLIENT_ID,
  WORKSPACE_CLIENT_ID,
  PERSONAL_PROJECT_ID,
} from "@/lib/data";
import { supabase, supabaseReady, authedFetch } from "@/lib/supabase";
import { seedIfEmpty, fetchAll, fetchContacts, upsertTask, deleteTaskDb, upsertClient, upsertProject, deleteProjectDb, deleteClientDb, insertNotif, markNotifsReadDb, markNotifReadDb, uploadTaskFile, signedUrlForFile, deleteTaskFile, upsertClientLink, deleteClientLinkDb, upsertClientNote, deleteClientNoteDb, appendCommentDb, fetchClaudeQueue, queueTaskDb, unqueueTaskDb, upsertTerritory, deleteTerritoryDb, upsertTaskTemplate, deleteTaskTemplateDb, upsertVaultFolder, deleteVaultFolderDb, rowToTask, rowToClient, rowToNotif, rowToMessage, rowToClientNote, markMessagesReadDb, insertMessage } from "@/lib/db";
import { subscribeRealtime } from "@/lib/realtime";
import { Inbox } from "./cockpit/Inbox";
import SettingsHub from "./SettingsHub";
import AddClientModal from "./AddClientModal";


import { I, Avatar, SideItem, MAX_ATTACHMENT_BYTES, newId, formatBytes, kindFromName, LIST_COLUMNS, type FilterState, type SortBy, type Toast } from "./cockpit/ui";
import { ConfirmModal, PromptModal, LinkFormModal, type ConfirmSpec, type PromptSpec } from "./cockpit/modals";
import { CommandK } from "./cockpit/CommandK";
import { GroupedList, InlineDue } from "./cockpit/GroupedList";
import { TaskDrawer } from "./cockpit/TaskDrawer";
import { QuickLinksBar } from "./cockpit/ClientLinks";
import { ClientJournal } from "./cockpit/ClientJournal";
import { VaultView, type VaultItem } from "./cockpit/VaultView";
import { ClientsBoard, type WorkBoardGroup, type WorkItem } from "./cockpit/ClientsBoard";
import { claudeCodeUrl } from "@/lib/claudeLink";

// --- Deep-link URL state ----------------------------------------------------
// The whole app lives on "/", so we encode what you're looking at into the
// query string: shareable links, refresh-safe, and back/forward navigation.
//   ?view=work|clients|personal   the special boards
//   ?client=<id>[&project=<id>]   a client (optionally scoped to one project)
//   ?task=<id>                    the task drawer (layers over any of the above)
type NavState = { view: "work" | "personal" | "inbox" | null; client: string; project: string | null; task: string | null; clientTab: "tasks" | "chat" | "vault" | null; vaultFolder: string | null };
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
    view: v === "work" || v === "personal" || v === "inbox" ? v : null,
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
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [vaultFolders, setVaultFolders] = useState<VaultFolder[]>([]);
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
  const [settingsHubOpen, setSettingsHubOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [ghlBusy, setGhlBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const [promptDialog, setPromptDialog] = useState<PromptSpec | null>(null);
  const [menuClientId, setMenuClientId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);

  // Sidebar client ordering: star to pin, sort mode, manual drag order.
  // Personal preferences → persisted per-browser (localStorage), not the DB.
  type ClientSort = "manual" | "az" | "tasks" | "recent" | "used" | "urgent" | "mine";
  const [clientSort, setClientSort] = useState<ClientSort>("urgent");
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [claudeQueue, setClaudeQueue] = useState<Set<string>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const toggleClaudeQueue = (taskId: string) => {
    setClaudeQueue((s) => {
      const n = new Set(s);
      if (n.has(taskId)) { n.delete(taskId); unqueueTaskDb(taskId); } else { n.add(taskId); queueTaskDb(taskId, me.id); }
      return n;
    });
  };
  const toggleCollapse = (key: string) => setCollapsed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); try { localStorage.setItem("cut_collapsed", JSON.stringify([...n])); } catch {} return n; });
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  const [dragClientId, setDragClientId] = useState<string | null>(null);
  const [statusMenuClientId, setStatusMenuClientId] = useState<string | null>(null);

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
  const draftMessage = async (clientId: string, channel: MessageChannel): Promise<{ subject?: string; body: string } | null> => {
    setDraftingMessage(true);
    try {
      const res = await authedFetch("/api/ai/draft-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, channel }) });
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
  const refreshMessages = async (clientId: string, contact: Contact) => {
    const target = ghlTargetForContact(contact);
    if (!target) { pushToast("No GoHighLevel connection for this client's sub-account."); return; }
    setRefreshingMessages(true);
    try {
      const res = await authedFetch("/api/ghl/refresh-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, contactId: contact.id, locationId: target.locationId, ghlContactId: target.ghlContactId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to refresh messages."); return; }
      pushToast(j.inserted > 0 ? `Found ${j.inserted} new message${j.inserted === 1 ? "" : "s"}.` : "No new messages.");
    } catch {
      pushToast("Failed to refresh messages.");
    } finally {
      setRefreshingMessages(false);
    }
  };
  useEffect(() => {
    try {
      const s = localStorage.getItem("cut_clientSort"); if (s) setClientSort(s as ClientSort);
      const st = localStorage.getItem("cut_starred"); if (st) setStarred(new Set(JSON.parse(st)));
      const co = localStorage.getItem("cut_collapsed"); if (co) setCollapsed(new Set(JSON.parse(co)));
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
  const saveManualOrder = (ids: string[]) => { setManualOrder(ids); try { localStorage.setItem("cut_clientOrder", JSON.stringify(ids)); } catch {} };
  const dropOnClient = (targetId: string) => {
    if (!dragClientId || dragClientId === targetId) { setDragClientId(null); return; }
    const ids = sortedClients.map((c) => c.id).filter((id) => id !== dragClientId);
    ids.splice(ids.indexOf(targetId), 0, dragClientId);
    saveManualOrder(ids);
    if (clientSort !== "manual") saveClientSort("manual"); // dragging implies manual
    setDragClientId(null);
  };
  const [drawerFull, setDrawerFull] = useState(false);
  useEffect(() => { try { setDrawerFull(localStorage.getItem("cut_drawerFull") === "1"); } catch {} }, []);
  // Drop the project filter whenever we leave its client (or enter My Work).
  useEffect(() => { setActiveProject((p) => (p && projects.find((x) => x.id === p)?.clientId === activeClient && !myWork && !personalView && !inboxView ? p : null)); }, [activeClient, myWork, personalView, inboxView, projects]);
  // A bulk selection is scoped to whatever list is on screen — switching
  // clients/views leaves the selected ids referring to now-invisible tasks,
  // which would make the floating bulk-action bar silently apply to rows
  // the user can no longer see. Clear it on any navigation.
  useEffect(() => { setSelectedTaskIds(new Set()); }, [activeClient, activeProject, myWork, personalView, inboxView]);
  // Links/Notes/health are single-client concepts — always land back on Tasks when the active client changes.
  useEffect(() => { setClientTab("tasks"); }, [activeClient, myWork]);

  // --- Deep-link URL sync ---------------------------------------------------
  const currentNav = (): NavState => ({
    view: myWork ? "work" : personalView ? "personal" : inboxView ? "inbox" : null,
    client: activeClient, project: activeProject, task: openTaskId,
    clientTab, vaultFolder: null, // vaultFolder is write-only (via copyFolderLink) — not mirrored into the live URL as you browse
  });
  const applyNav = (s: NavState) => {
    setMyWork(s.view === "work"); setPersonalView(s.view === "personal"); setInboxView(s.view === "inbox");
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
  const NAV_ITEM_LABELS: Record<string, string> = { inbox: "Inbox", all: "All Tasks", work: "My Work", personal: "Personal" };
  const [navVisible, setNavVisible] = useState<Record<string, boolean>>({ inbox: true, all: true, work: true, personal: true });
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cut_navVisible");
      if (raw) setNavVisible((v) => ({ ...v, ...JSON.parse(raw) }));
    } catch {}
  }, []);
  const toggleNavItem = (key: string) => {
    setNavVisible((v) => {
      const next = { ...v, [key]: !v[key] };
      try { localStorage.setItem("cut_navVisible", JSON.stringify(next)); } catch {}
      return next;
    });
  };

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
        setVaultFolders(d.vaultFolders);
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

  const pushToast = (text: string) => {
    const id = newId("toast_");
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  };
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
      } catch (e) { console.warn("[realtime] visibility refetch failed", e); }
    };
    document.addEventListener("visibilitychange", refetch);
    window.addEventListener("focus", refetch);
    return () => { document.removeEventListener("visibilitychange", refetch); window.removeEventListener("focus", refetch); };
  }, []);

  const notify = (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null }) => {
    const n: Notification = { id: newId("n_"), recipientId, text, taskId, actorId: me.id, clientId: extra?.clientId ?? null, projectId: extra?.projectId ?? null, at: new Date().toISOString(), read: false };
    setNotifications((ns) => [n, ...ns]);
    insertNotif(n);
  };

  const myNotifs = notifications.filter((n) => n.recipientId === me.id);
  const unread = myNotifs.filter((n) => !n.read).length;
  const markAllNotifsRead = () => {
    setNotifications((ns) => ns.map((n) => (n.recipientId === me.id ? { ...n, read: true } : n)));
    markNotifsReadDb(me.id);
  };
  const openNotification = (n: Notification) => {
    if (!n.read) { setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, read: true } : x))); markNotifReadDb(n.id); }
    if (n.taskId) { setOpenTaskId(n.taskId); return; }
    if (n.clientId) {
      setMyWork(false); setPersonalView(false); setInboxView(false);
      setActiveClient(n.clientId); setActiveProject(n.projectId ?? null); setClientTab("chat");
    }
  };

  const passesFilters = (t: Task) =>
    (filters.status === "all" || t.status === filters.status) &&
    (filters.assignee === "all" || (filters.assignee === "unassigned" ? t.assigneeId === null : t.assigneeId === filters.assignee)) &&
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
  const myTerritories = territories.filter((t) => t.memberId === me.id);
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
  // forAssignee narrows "open tasks" to just that person's — used by the
  // personal My Clients board, where a client's tier should reflect *my*
  // tasks there, not a teammate's (a client can't land in "Overdue" here
  // because of someone else's overdue task while my own task on it has no
  // due date). Omitted entirely for the sidebar's "Overdue first" sort,
  // which is intentionally client-wide across every assignee.
  function clientUrgencyKey(clientId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    if (hasOpenConversationTask(clientId)) return { tier: 0, due: "", priorityRank: 0 };
    const open = scopedTasks.filter((t) => t.clientId === clientId && t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    // Follow-up date is one more urgency candidate alongside task due dates —
    // "whichever is soonest wins." Deliberately does NOT also scan this
    // client's projects' own follow-up dates (unlike tasks, which already
    // roll up from project to client automatically via t.clientId) — kept
    // independent per client/project for now; add a rollup here later if a
    // project-only follow-up date turns out to need to surface the client too.
    const followUp = clientById(clientId)?.followUpAt;
    const candidates: { date: string; priorityRank: number }[] = [
      ...open.filter((t) => t.due).map((t) => ({ date: t.due!, priorityRank: PRIORITY_META[t.priority].rank })),
      ...(followUp ? [{ date: followUp, priorityRank: 0 }] : []),
    ];
    if (candidates.length === 0) {
      if (open.length === 0) return { tier: 5, due: "", priorityRank: 0 };
      return { tier: 4, due: "", priorityRank: Math.max(...open.map((t) => PRIORITY_META[t.priority].rank)) };
    }
    const soonest = candidates.reduce((a, b) => (b.date < a.date ? b : a)).date;
    const atSoonest = candidates.filter((c) => c.date === soonest);
    const tier = soonest < TODAY ? 1 : soonest === TODAY ? 2 : 3;
    return { tier, due: soonest, priorityRank: Math.max(...atSoonest.map((c) => c.priorityRank)) };
  }
  // Same tiering as clientUrgencyKey, scoped to one project's tasks (+ its
  // own followUpAt) instead of a whole client's. No tier-0 "New message"
  // boost — that's driven by a client-level Conversation task, not a
  // project concept.
  function projectUrgencyKey(projectId: string, forAssignee?: string): { tier: number; due: string; priorityRank: number } {
    const open = scopedTasks.filter((t) => t.projectId === projectId && t.status !== "done" && (!forAssignee || t.assigneeId === forAssignee));
    const followUp = projectById(projectId)?.followUpAt;
    const candidates: { date: string; priorityRank: number }[] = [
      ...open.filter((t) => t.due).map((t) => ({ date: t.due!, priorityRank: PRIORITY_META[t.priority].rank })),
      ...(followUp ? [{ date: followUp, priorityRank: 0 }] : []),
    ];
    if (candidates.length === 0) {
      if (open.length === 0) return { tier: 5, due: "", priorityRank: 0 };
      return { tier: 4, due: "", priorityRank: Math.max(...open.map((t) => PRIORITY_META[t.priority].rank)) };
    }
    const soonest = candidates.reduce((a, b) => (b.date < a.date ? b : a)).date;
    const atSoonest = candidates.filter((c) => c.date === soonest);
    const tier = soonest < TODAY ? 1 : soonest === TODAY ? 2 : 3;
    return { tier, due: soonest, priorityRank: Math.max(...atSoonest.map((c) => c.priorityRank)) };
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
      [0, "New message", "#8b5cf6"],
      [1, "Overdue", "#ef4444"],
      [2, "Due today", "#f59e0b"],
      [3, "Upcoming", "#3b82f6"],
      [4, "No due date", "#94a3b8"],
      [5, "No open tasks", "#cbd5e1"],
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
  // Sidebar sections by client status, funnel order; Active Client has no
  // header (it's the main working set), the rest only show when non-empty.
  // A client whose stored status predates the funnel (e.g. the old
  // active/paused/archived values, before client-status-funnel.sql has run)
  // falls into this same no-header bucket instead of vanishing from every
  // group — exact-match filtering below would otherwise drop it entirely.
  const knownClientStatuses = new Set<string>(CLIENT_STATUS_ORDER);
  // Urgency sort is meant to answer "how soon do I need to work this" — the
  // status-lifecycle grouping below would otherwise bury that (a client only
  // ever sorts within its own status section, so an overdue Prospect can
  // never outrank a no-due-date Active client). Bypass the grouping
  // entirely in that mode: one flat, fully urgency-ordered list instead.
  // "mine" gets the same flat treatment — it's the same urgency answer, just
  // scoped to my own tasks instead of the whole client.
  const clientGroups = clientSort === "urgent" || clientSort === "mine"
    ? [{ header: "", items: sortedClients }]
    : ([
        ["", "active_client"],
        ["Onboarding", "onboarding"],
        ["Prospects", "prospect"],
        ["Leads", "lead"],
        ["Cancelled", "cancelled"],
        ["Past Clients", "past_client"],
      ] as const)
        .map(([header, st]) => ({
          header,
          items: sortedClients.filter((c) => c.status === st || (st === "active_client" && !knownClientStatuses.has(c.status))),
        }))
        .filter((g) => g.items.length > 0);
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

  const visibleProjects = useMemo(() => projects.filter((p) => p.clientId.startsWith("cl_") && (activeClient === "all" || p.clientId === activeClient)), [projects, activeClient]);
  // On the All Tasks tab (activeClient === "all"), further restrict to your
  // own tasks by default — reusing scopedTasks' own assigneeId === me.id
  // pattern. Redundant-but-harmless for VAs, who are already fully
  // restricted by scopedTasks; only changes anything for admins.
  const baseTasks = scopedTasks.filter((t) => t.clientId.startsWith("cl_") && (activeClient === "all" || t.clientId === activeClient) && (!activeProject || t.projectId === activeProject) && (activeClient !== "all" || allTasksScope === "all" || t.assigneeId === me.id));

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

  // Drag a task row onto a different group header to reprioritize/restatus it
  // (grouped list view, priority/status dims only — due/project groupings
  // don't have an unambiguous single-field patch, so drag is disabled there;
  // see the onDropInGroup wiring on the main GroupedList render below).
  const dropTaskInGroup = (taskId: string, groupKey: string) => {
    if (groupBy === "status") patchTask(taskId, { status: groupKey as TaskStatus });
    else if (groupBy === "priority") {
      if (!isManuallyAssignable(groupKey as Priority)) { pushToast("Conversation is assigned automatically, not manually."); return; }
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
  const bulkPatch = (patch: Partial<Task>) => {
    const ids = [...selectedTaskIds];
    ids.forEach((id) => patchTask(id, patch));
    pushToast(`Updated ${ids.length} task${ids.length === 1 ? "" : "s"}`);
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
    users.forEach((u) => { if (u.id !== me.id && body.includes("@" + u.name)) { mentioned.add(u.id); notify(u.id, `${me.name} mentioned you in “${t.title}”`, id); pushToast(`Notified ${u.name}`); } });
    if (t.assigneeId && t.assigneeId !== me.id && !mentioned.has(t.assigneeId)) {
      notify(t.assigneeId, `${me.name} commented on “${t.title}”`, id);
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
  const sendMessage = async (clientId: string, channel: MessageChannel, subject: string, body: string, attachments: Attachment[] = [], cc: string[] = [], bcc: string[] = [], taskId: string | null = null) => {
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
    if (clients.some((c) => c.id === id)) { setActiveClient(id); setMyWork(false); setPersonalView(false); setInboxView(false); setAddClientOpen(false); return; }
    const sub = subAccounts.find((s) => s.id === contact.clientId);
    const c: Client = { id, name: contact.name, color: sub?.color ?? "#a855f7", ghlLocationId: "", status: "lead", type, assignedTo: [] };
    setClients((cs) => [...cs, c]);
    markOwnClientWrite(c.id);
    upsertClient(c);
    setActiveClient(id);
    setMyWork(false);
    setPersonalView(false);
    pushToast(`Added ${contact.name}`);
    try {
      const res = await authedFetch("/api/ghl/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: sub?.ghlLocationId ?? "", contactId: contact.ghlContactId }) });
      const j = await res.json();
      if (j.company) { const up: Client = { ...c, ghlLocationId: j.company }; setClients((cs) => cs.map((x) => (x.id === id ? up : x))); markOwnClientWrite(up.id); upsertClient(up); }
    } catch { /* business name is optional */ }
  };
  const addTerritory = (spec: { name: string; city: string; state: string; memberId: string | null }) => {
    const t: Territory = { id: newId("terr_"), ...spec };
    setTerritories((ts) => [...ts, t]);
    upsertTerritory(t);
  };
  const assignTerritory = (id: string, memberId: string | null) => {
    setTerritories((ts) => ts.map((t) => (t.id === id ? { ...t, memberId } : t)));
    const t = territories.find((x) => x.id === id);
    if (t) upsertTerritory({ ...t, memberId });
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
  const addProject = (clientId: string) => {
    setPromptDialog({ title: "New project", placeholder: "Project name", confirmLabel: "Create", onSubmit: (name) => {
      setPromptDialog(null);
      const p: Project = { id: newId("p_"), clientId, name, description: "" };
      setProjects((ps) => [...ps, p]);
      upsertProject(p);
    } });
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
  // single summary toast instead of one per task.
  const bulkMoveToClient = (clientId: string) => {
    const ids = [...selectedTaskIds];
    ids.forEach((id) => moveTaskToClient(id, clientId, true));
    pushToast(`Moved ${ids.length} task${ids.length === 1 ? "" : "s"} to ${clientById(clientId)?.name ?? "client"}`);
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

  // --- client notes ------------------------------------------------------
  const addNote = (clientId: string, type: NoteType, body: string, projectId?: string | null, attachments?: Attachment[]) => {
    const note: ClientNote = { id: newId("cn_"), clientId, projectId: projectId ?? null, type, body, authorId: me.id, at: new Date().toISOString(), ...(attachments?.length ? { attachments } : {}) };
    setClientNotes((ns) => [note, ...ns]); // newest-first feed
    upsertClientNote(note);
    // @mentions notify, same as task comments — the one signal that pulls
    // people back into this feed instead of it going stale and unread.
    const where = projectId ? projectById(projectId)?.name : clientById(clientId)?.name;
    users.forEach((u) => {
      if (u.id !== me.id && body.includes("@" + u.name)) notify(u.id, `${me.name} mentioned you in the ${where ?? "team"} chat`, null, { clientId, projectId });
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

  return (
    <div className="flex h-screen w-full overflow-hidden text-[15px]">
      {/* mobile backdrop */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ---------- Sidebar ---------- */}
      <aside className={`sidebar-dark fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r bg-surface transition-transform ${sidebarHidden ? "md:hidden" : "md:static md:translate-x-0"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">CT</span>
          <div className="leading-tight"><div className="font-semibold">ClickUpTasks</div><div className="text-[13px] text-muted">GHL Task Cockpit</div></div>
          <span className="relative ml-auto">
            <button onClick={() => setNavMenuOpen((o) => !o)} title="Show/hide sidebar items" className="rounded p-1 text-muted hover:bg-background hover:text-foreground"><I.list className="h-3.5 w-3.5" /></button>
            {navMenuOpen && (<>
              <div className="fixed inset-0 z-30" onClick={() => setNavMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-lg border border-white/15 bg-[#2c3140] p-1 shadow-2xl">
                {Object.entries(NAV_ITEM_LABELS).map(([key, label]) => (
                  <button key={key} onClick={() => toggleNavItem(key)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10">
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${navVisible[key] ? "border-accent bg-accent" : "border-white/30"}`}>{navVisible[key] && <I.check className="h-2.5 w-2.5 text-white" />}</span>
                    {label}
                  </button>
                ))}
              </div>
            </>)}
          </span>
        </div>

        <nav className="shrink-0 space-y-0.5 px-2">
          {navVisible.inbox && <SideItem active={inboxView} onClick={() => { setInboxView(true); setMyWork(false); setPersonalView(false); setSidebarOpen(false); setOpenTaskId(null); }}><I.bell className="text-muted" /> <span>Inbox</span>{unread > 0 && <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[13px] font-semibold text-white">{unread}</span>}</SideItem>}
          {navVisible.all && <SideItem active={!myWork && !personalView && !inboxView && activeClient === "all"} onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient("all"); setSidebarOpen(false); setOpenTaskId(null); }}><I.grid className="text-muted" /> <span>All Tasks</span><span className="ml-auto text-[13px] text-muted">{scopedTasks.filter((t) => t.clientId.startsWith("cl_")).length}</span></SideItem>}
          {navVisible.work && <SideItem active={myWork} onClick={() => { setMyWork(true); setPersonalView(false); setInboxView(false); setSidebarOpen(false); setOpenTaskId(null); }}><I.user className="text-muted" /> <span>My Work</span><span className="ml-auto text-[13px] text-muted">{myAssignedClients.length + assignedProjectsFor(me.id).length}</span></SideItem>}
          {navVisible.personal && <SideItem active={personalView} onClick={() => { setPersonalView(true); setMyWork(false); setInboxView(false); setSidebarOpen(false); setOpenTaskId(null); }}><I.check className="text-muted" /> <span>Personal</span><span className="ml-auto text-[13px] text-muted">{myPersonalTasks.filter((t) => t.status !== "done").length}</span></SideItem>}
        </nav>

        {clients.some((c) => c.id === WORKSPACE_CLIENT_ID) && (<>
          <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-4">
            <button onClick={() => toggleCollapse("projects")} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-foreground">
              <I.chevron className={`transition ${collapsed.has("projects") ? "-rotate-90" : "rotate-180"}`} /> Projects
            </button>
            {canAdmin && <button onClick={() => addProject(WORKSPACE_CLIENT_ID)} title="Add project (internal list)" className="rounded p-0.5 text-muted hover:bg-background hover:text-foreground"><I.plus /></button>}
          </div>
          {!collapsed.has("projects") && (
          <nav className="shrink-0 space-y-0.5 px-2">
            {sortedWorkspaceProjects.map((p) => {
              const pg = projectProgress(p.id);
              const on = !myWork && !personalView && !inboxView && activeClient === WORKSPACE_CLIENT_ID && activeProject === p.id;
              return (
                <button key={p.id} onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(WORKSPACE_CLIENT_ID); setActiveProject(p.id); setSidebarOpen(false); setOpenTaskId(null); setClientTab("tasks"); }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[15px] transition ${on ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-background"}`}>
                  <I.folder className="shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {/* Open count, not done/total — matches the client rows'
                      convention and what the list actually shows by default
                      (hideDone is on unless toggled off in Filter & view). */}
                  <span className="shrink-0 text-[13px] tabular-nums text-muted">{pg.total - pg.done}</span>
                </button>
              );
            })}
            {workspaceProjects.length === 0 && <div className="px-2.5 py-1 text-[13px] text-muted">No projects yet — click + to add one.</div>}
          </nav>
          )}
        </>)}

        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-4">
          <button onClick={() => toggleCollapse("clients")} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-foreground">
            <I.chevron className={`transition ${collapsed.has("clients") ? "-rotate-90" : "rotate-180"}`} /> Clients
          </button>
          <span className="flex items-center gap-0.5">
            <button onClick={() => setClientListScope((s) => (s === "mine" ? "all" : "mine"))}
              title={clientListScope === "mine" ? "Showing only clients with open work assigned to or followed by you — click to show every client" : "Showing every client — click to show just what needs your attention"}
              className={`rounded p-0.5 hover:bg-background hover:text-foreground ${clientListScope === "mine" ? "text-accent" : "text-muted"}`}>
              <I.user className="h-3.5 w-3.5" />
            </button>
            <span className="relative">
              <button onClick={() => setSortMenuOpen((o) => !o)} title="Sort clients" className={`rounded p-0.5 hover:bg-background hover:text-foreground ${clientSort !== "manual" ? "text-accent" : "text-muted"}`}><I.list className="h-3.5 w-3.5" /></button>
              {sortMenuOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setSortMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-white/15 bg-[#2c3140] p-1 shadow-2xl">
                  {([["urgent", "Overdue first"], ["mine", "By my work"], ["used", "Recently used"], ["manual", "Manual (drag to order)"], ["az", "A → Z"], ["tasks", "Most active"], ["recent", "Recently added"]] as const).map(([v, label]) => (
                    <button key={v} onClick={() => { saveClientSort(v); setSortMenuOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${clientSort === v ? "bg-accent" : "bg-transparent"}`} />{label}
                    </button>
                  ))}
                </div>
              </>)}
            </span>
            {canAdmin && <button onClick={() => setAddClientOpen(true)} title="Add client from GHL contacts" className="rounded p-0.5 text-muted hover:bg-background hover:text-foreground"><I.plus /></button>}
          </span>
        </div>
        {!collapsed.has("clients") && (
        <nav className="shrink-0 space-y-0.5 px-2">
          {clientGroups.map((g) => (
          <div key={g.header || "active"}>
          {g.header && <button onClick={() => toggleCollapse("cli:" + g.header)} className="flex w-full items-center gap-1 px-2.5 pb-0.5 pt-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-muted hover:text-foreground"><I.chevron className={`transition ${collapsed.has("cli:" + g.header) ? "-rotate-90" : "rotate-180"}`} /> {g.header}</button>}
          {!(g.header && collapsed.has("cli:" + g.header)) && (<>
          {g.items.map((c) => {
            const active = !myWork && !personalView && !inboxView && activeClient === c.id;
            const clientProjects = projectsForClient(c.id);
            return (
              <div key={c.id} className={menuClientId === c.id ? "relative z-50" : undefined}
                draggable onDragStart={() => setDragClientId(c.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropOnClient(c.id); }}>
                <div className={`group/row relative ${dragClientId === c.id ? "opacity-40" : ""} ${statusMenuClientId === c.id ? "z-50" : ""}`}>
                  {statusMenuClientId === c.id && (<>
                    <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setStatusMenuClientId(null); }} />
                    <div className="absolute left-1 top-full z-40 mt-1 w-44 rounded-lg border border-white/15 bg-[#2c3140] p-1 shadow-2xl">
                      {CLIENT_STATUS_ORDER.map((st) => (
                        <button key={st} onClick={(e) => { e.stopPropagation(); setStatusMenuClientId(null); setClientStatus(c.id, st); }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CLIENT_STATUS_META[st].dot }} />
                          {CLIENT_STATUS_META[st].label}
                          {c.status === st && <I.check className="ml-auto text-accent" />}
                        </button>
                      ))}
                    </div>
                  </>)}
                  <button onClick={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(c.id); setActiveProject(null); setSidebarOpen(false); setOpenTaskId(null); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[15px] transition ${active ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-background"} ${c.status === "cancelled" || c.status === "past_client" ? "opacity-50" : ""}`}>
                    <span role="button" title={`${clientStatusMeta(c.status).label} — click to change`}
                      onClick={(e) => { e.stopPropagation(); setStatusMenuClientId(statusMenuClientId === c.id ? null : c.id); }}
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-white/30" style={{ background: clientStatusMeta(c.status).dot }} />
                    {hasUnreadMessage(c.id) && <span className="shrink-0 text-accent" title="New message — waiting on a reply"><I.comment /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="truncate">{c.name}</span>
                      {clientCompany(c) && <span className="block truncate text-[13px] font-normal text-muted">{clientCompany(c)}</span>}
                    </span>
                    <span className="text-[13px] text-muted group-hover/row:opacity-0">{clientTaskCount(c.id)}</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); toggleStar(c.id); }} title={starred.has(c.id) ? "Unstar" : "Star — pin to top"}
                    className={`absolute right-8 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-background ${starred.has(c.id) ? "text-amber-400" : "text-muted opacity-0 group-hover/row:opacity-100"}`}>
                    <I.star filled={starred.has(c.id)} />
                  </button>
                  {canAdmin && (
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                      <button onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenuPos({ top: r.bottom + 4, left: Math.min(r.right - 176, window.innerWidth - 184) }); setMenuClientId(menuClientId === c.id ? null : c.id); }} title="More" className="rounded p-1 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover/row:opacity-100"><I.dots /></button>
                      {menuClientId === c.id && (<>
                        <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenuClientId(null); }} />
                        <div style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: 176 }} className="z-50 rounded-lg border border-white/15 bg-[#2c3140] p-1 shadow-2xl">
                          <button onClick={(e) => { e.stopPropagation(); setMenuClientId(null); addProject(c.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[15px] hover:bg-white/10"><I.plus /> Add project</button>
                          <button onClick={(e) => { e.stopPropagation(); setMenuClientId(null); renameClient(c.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[15px] hover:bg-white/10"><I.pencil /> Rename client</button>
                          <button onClick={(e) => { e.stopPropagation(); setMenuClientId(null); deleteClient(c.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[15px] text-red-500 hover:bg-white/10"><I.trash /> Remove client</button>
                        </div>
                      </>)}
                    </div>
                  )}
                </div>
                {active && (
                  <div className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l pl-2">
                    {clientProjects.map((p) => {
                      const pg = projectProgress(p.id);
                      const on = activeProject === p.id;
                      return (
                        <div key={p.id} className={`group/prow relative ${menuProjectId === p.id ? "z-50" : ""}`}>
                          <button onClick={() => { setActiveProject(on ? null : p.id); setOpenTaskId(null); setClientTab("tasks"); }}
                            className={`flex w-full items-center gap-2 rounded-md py-1 pl-2 pr-1 text-left text-[13px] transition ${on ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
                            <I.folder className="shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            {/* Open count, not done/total — see workspaceProjects badge above. */}
                            <span className="shrink-0 tabular-nums opacity-70">{pg.total - pg.done}</span>
                            {canAdmin && (
                              <span onClick={(e) => { e.stopPropagation(); setMenuProjectId(menuProjectId === p.id ? null : p.id); }}
                                className="rounded p-0.5 opacity-0 hover:bg-background hover:text-foreground group-hover/prow:opacity-100"><I.dots /></span>
                            )}
                          </button>
                          {menuProjectId === p.id && (<>
                            <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMenuProjectId(null); }} />
                            <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg border border-white/15 bg-[#2c3140] p-1 shadow-2xl">
                              <button onClick={(e) => { e.stopPropagation(); setMenuProjectId(null); renameProject(p.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10"><I.pencil /> Rename</button>
                              <button onClick={(e) => { e.stopPropagation(); setMenuProjectId(null); deleteProject(p.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-red-500 hover:bg-white/10"><I.trash /> Delete</button>
                            </div>
                          </>)}
                        </div>
                      );
                    })}
                    {canAdmin && (
                      <button onClick={() => addProject(c.id)} title="Add a project (list) to this client"
                        className="flex w-full items-center gap-2 rounded-md py-1 pl-2 pr-1 text-left text-[13px] text-muted hover:bg-background hover:text-foreground">
                        <I.plus className="shrink-0 opacity-70" /> Add project
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </>)}
          </div>
          ))}
          {clientListBase.length === 0 && (
            <div className="px-3 py-3 text-[13px] leading-relaxed text-muted">
              {visibleClients.length === 0
                ? <>No clients yet. Click <b>+</b> to add one from your GoHighLevel contacts.</>
                : <>Nothing needs your attention right now. Click the person icon above to see every client.</>}
            </div>
          )}
        </nav>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
          <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ width: 30, height: 30, background: me.color }}>{me.initials}</span>
          <div className="min-w-0 leading-tight"><div className="truncate text-[15px] font-medium">{me.name}</div><div className="text-[13px] capitalize text-muted">{me.role}</div></div>
          <button onClick={() => { setSettingsHubOpen(true); setSidebarOpen(false); }} title="Settings" className="ml-auto rounded-lg border p-1.5 text-muted hover:text-foreground"><I.gear /></button>
          <button onClick={toggleTheme} title="Toggle theme" className="rounded-lg border p-1.5 text-muted hover:text-foreground">{theme === "light" ? <I.moon /> : <I.sun />}</button>
          <button onClick={onSignOut} title="Sign out" className="rounded-lg border p-1.5 text-muted hover:text-red-500"><I.logout /></button>
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-4 py-3 shadow-soft sm:px-5">
          <button onClick={toggleSidebar} title="Show/hide sidebar" className="rounded-lg border p-2 text-muted hover:text-foreground"><I.menu /></button>
          {!myWork && !personalView && !inboxView && activeClient !== "all" && clientById(activeClient) && (
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[16px] font-semibold text-white shadow-soft sm:flex" style={{ background: clientById(activeClient)!.color }}>{clientById(activeClient)!.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
          )}
          <div className="min-w-0">
            {!myWork && !personalView && !inboxView && activeProject && projectById(activeProject) ? (<>
              <h1 className="flex items-center gap-1.5 truncate text-[20px] font-semibold"><I.folder className="shrink-0 text-muted" /> {projectById(activeProject)!.name}</h1>
              <p className="hidden items-center gap-2 text-[13px] text-muted sm:flex">
                <button onClick={() => setActiveProject(null)} className="hover:text-foreground hover:underline">{clientById(activeClient)?.name}</button>
                <span>·</span>
                {(() => { const pg = projectProgress(activeProject); return (<span className="inline-flex items-center gap-1.5">{pg.done}/{pg.total} done<span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-border align-middle"><span className="block h-full rounded-full bg-green-500 transition-all" style={{ width: `${pg.pct}%` }} /></span>{pg.pct}%</span>); })()}
              </p>
            </>) : (<>
              <h1 className="flex items-center gap-2 truncate text-[20px] font-semibold">
                {inboxView ? "Inbox" : personalView ? "Personal" : myWork ? "My Work" : activeClient === "all" ? "All Tasks" : (ghlContactUrlFor(activeClient) ? <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="hover:text-accent hover:underline">{clientById(activeClient)?.name}</a> : clientById(activeClient)?.name)}
                {!myWork && !personalView && !inboxView && activeClient !== "all" && (() => { const h = HEALTH_META[clientHealth(activeClient, scopedTasks)]; return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ background: h.dot + "1a", color: h.dot }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} /> {h.label}</span>; })()}
              </h1>
              <p className="hidden text-[13px] text-muted sm:block">{inboxView ? "Everything that mentions or notifies you, in one place" : personalView ? "Your private to-dos — only visible to you" : myWork ? "Every client and project you're on, grouped by what needs attention first" : activeClient === "all" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}` : clientCompany(clientById(activeClient))}</p>
            </>)}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {!myWork && !personalView && !inboxView && activeClient === "all" && canAdmin && (
            <div className="inline-flex overflow-hidden rounded-md border" title="VAs only ever see their own tasks here regardless of this toggle">
              <button onClick={() => setAllTasksScope("mine")} className={`px-2.5 py-1.5 text-[13px] font-medium ${allTasksScope === "mine" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Mine</button>
              <button onClick={() => setAllTasksScope("all")} className={`px-2.5 py-1.5 text-[13px] font-medium ${allTasksScope === "all" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>All</button>
            </div>
          )}
          {!myWork && !personalView && !inboxView && activeClient !== "all" && (
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

          {!myWork && !personalView && !inboxView && activeClient !== "all" && clientById(activeClient) && (
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
              {(() => {
                const scopedProject = activeProject ? projectById(activeProject) : null;
                const entity = scopedProject ?? clientById(activeClient)!;
                const setFollowUp = (d: string | null) => (scopedProject ? setProjectFollowUp(scopedProject.id, d) : setClientFollowUp(activeClient, d));
                return (
                  <div title="Follow-up date" className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[13px] text-muted">
                    <I.calendar />
                    <InlineDue value={entity.followUpAt ?? null} overdue={isOverdue(entity.followUpAt ?? null)} onChange={setFollowUp} />
                  </div>
                );
              })()}
              {ghlContactUrlFor(activeClient) && (
                <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel"
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft">
                  <I.bolt /> Open in GHL
                </a>
              )}
              {ghlContactUrlFor(activeClient) && (
                <button onClick={importGhlTasks} disabled={importingTasks} title="Import tasks created directly in GoHighLevel"
                  className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground disabled:opacity-50">
                  <I.repeat />
                </button>
              )}
              {canAdmin && !ghlContactUrlFor(activeClient) && (
                <button onClick={() => { setGhlLinkSearch(""); setGhlLinkOpen(true); }} title="Connect this client to a GoHighLevel contact"
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
                  <I.bolt /> Link to GHL
                </button>
              )}
              {/* Secondary/config actions folded into one overflow menu so the
                  header leads with Follow / Open in GHL / Import instead of a
                  cluster of equal-weight icon buttons. */}
              <div className="relative">
                <button onClick={() => setHeaderMoreOpen((o) => !o)} title="More actions"
                  className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground"><I.dots /></button>
                {headerMoreOpen && (<>
                  <div className="fixed inset-0 z-40" onClick={() => setHeaderMoreOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-surface p-1 shadow-soft-md">
                    <button onClick={() => { setHeaderMoreOpen(false); copyLink({ view: null, client: activeClient, project: activeProject, task: null, clientTab, vaultFolder: null }); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><I.link /> Copy link</button>
                    <button onClick={() => { setHeaderMoreOpen(false); copyClientForClaude(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>✳</span> Copy for Claude</button>
                    <button onClick={() => { setHeaderMoreOpen(false); queueClientForClaude(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background"><span aria-hidden>★</span> Queue for Claude</button>
                    <label title="Shifts every open dated task here by the same number of days, preserving their relative spacing"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-background">
                      <I.calendar className="shrink-0" /><span className="flex-1">Move all due dates…</span>
                      <input type="date" onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { if (e.target.value) { setHeaderMoreOpen(false); pushAllDatesForward(e.target.value); } e.target.value = ""; }}
                        className="w-[124px] shrink-0 rounded border bg-background px-1 py-0.5 text-[12px] outline-none" />
                    </label>
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
                    {canAdmin && clientById(activeClient)?.linkedContactId && (
                      <button onClick={() => { setHeaderMoreOpen(false); linkClientToContact(activeClient, null); }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-background hover:text-danger"><I.close /> Unlink from GoHighLevel</button>
                    )}
                  </div>
                </>)}
              </div>
            </div>
          )}


          {inboxView ? null : myWork ? (
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
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Assignee</span><select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option><option value="unassigned">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
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

        {!myWork && !personalView && !inboxView && activeClient !== "all" && (
          <QuickLinksBar
            links={clientLinks.filter((l) => l.clientId === activeClient)}
            canEdit={canAdmin}
            onEdit={(link) => setLinkModal({ initial: link })}
            onDelete={deleteLink}
            onReorder={(ids) => reorderLinks(activeClient, ids)}
          />
        )}


        {/* content */}
        {inboxView ? (
          <Inbox notifications={myNotifs} clientById={clientById} projectById={projectById} onOpen={openNotification} onMarkAllRead={markAllNotifsRead} />
        ) : personalView ? (
          <GroupedList groups={buildGroups(myPersonalTasks.filter(passesFilters))} showClient={false} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={["status", "due", "priority", "comments"]} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd quickAddHint="" onQuickAdd={quickAddPersonal} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} onAddComment={addComment} hideEmpty={hideEmpty} queuedIds={claudeQueue} colOrder={colOrder} onReorderCols={reorderCols} />
        ) : myWork ? (
          <ClientsBoard groups={myWorkGroups} clientTaskCount={clientTaskCount} projectTaskCount={projectTaskCount} hasUnreadMessage={hasUnreadMessage}
            onOpenClient={(id) => { setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(id); setActiveProject(null); setOpenTaskId(null); }}
            onOpenProject={(id) => {
              if (id === PERSONAL_PROJECT_ID) { setMyWork(false); setPersonalView(true); setInboxView(false); setOpenTaskId(null); return; }
              const p = projects.find((x) => x.id === id); if (!p) return;
              setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(p.clientId); setActiveProject(id); setOpenTaskId(null);
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
            sendingMessage={sendingMessage}
            onUploadImage={(file) => uploadOneImage("notes", file)}
            onOpenFile={downloadFile}
            canAdmin={canAdmin}
            canMessage={clientById(activeClient)?.canMessage}
            onToggleCanMessage={(memberId) => toggleClientMessagePermission(activeClient, memberId)}
            onDraftMessage={activeProject ? undefined : (channel) => draftMessage(activeClient, channel)}
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
          <GroupedList groups={buildGroups(sortTasks(baseTasks.filter(passesFilters)))} showClient={activeClient === "all"} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={activeClient.startsWith("cl_")} quickAddHint="Pick a client on the left to add tasks." onQuickAdd={quickAdd} onToggleSub={toggleSub} onAddSub={addSub} onDeleteSub={deleteSub} onAddComment={addComment} hideEmpty={hideEmpty} queuedIds={claudeQueue} onDropInGroup={groupBy === "status" || groupBy === "priority" ? dropTaskInGroup : undefined} colOrder={colOrder} onReorderCols={reorderCols} selectedIds={selectedTaskIds} onToggleSelect={toggleTaskSelection} />
        )}
      </main>

      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border bg-surface px-3 py-2 shadow-xl">
          <span className="text-[15px] font-medium">{selectedTaskIds.size} selected</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ assigneeId: e.target.value === "unassigned" ? null : e.target.value }); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Assignee…</option><option value="unassigned">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ status: e.target.value as TaskStatus }); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Status…</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ priority: e.target.value as Priority }); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Priority…</option>{PRIORITY_ORDER.filter(isManuallyAssignable).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select>
          <input type="date" onChange={(e) => { if (e.target.value) { bulkPatch({ due: e.target.value }); e.target.value = ""; } }} title="Due date" className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none" />
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkMoveToClient(e.target.value); e.target.value = ""; }} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="" disabled>Move to…</option>{[...clientList].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button onClick={clearSelection} className="rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-background">Clear</button>
        </div>
      )}

      {openTask && (
        <TaskDrawer task={openTask} comment={comment} setComment={setComment} clientById={clientById} projectById={projectById} contactById={contactById}
          full={drawerFull} onToggleFull={toggleDrawerFull}
          navIndex={openTaskIdx} navTotal={orderedTaskIds.length} navTasks={orderedTaskIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)} onOpenTask={setOpenTaskId} onAddSibling={(title) => addTaskToList(openTask.clientId, openTask.projectId, openTask.private, title)} onPrev={() => goToTask(-1)} onNext={() => goToTask(1)}
          onClose={() => setOpenTaskId(null)} onPatch={(patch) => patchTask(openTask.id, patch)} onDelete={() => deleteTask(openTask.id)} onAddComment={(attachments) => addComment(openTask.id, comment, attachments)}
          onAddFiles={(files) => addFiles(openTask.id, files)} onDownloadFile={downloadFile} onRemoveFile={(att) => removeFile(openTask.id, att)} uploadProgress={uploadProgress} onPushGhl={() => pushToGhl(openTask.id)} ghlBusy={ghlBusy} ghlLinkable={!!ghlTargetFor(openTask)} onUnlinkGhl={() => unlinkGhl(openTask.id)} allClients={[...clientList].sort((a, b) => a.name.localeCompare(b.name))} onMoveClient={(cid) => moveTaskToClient(openTask.id, cid)} clientProjects={projectsForClient(openTask.clientId)} onSetProject={(pid) => patchTask(openTask.id, { projectId: pid })} onNewProject={() => moveTaskToNewProject(openTask.id, openTask.clientId)} onRenameProject={() => renameProject(openTask.projectId)} onToggleSub={(sid) => toggleSub(openTask.id, sid)} onAddSub={(title) => addSub(openTask.id, title)} onRenameSub={(sid, title) => renameSub(openTask.id, sid, title)} onDeleteSub={(sid) => deleteSub(openTask.id, sid)} onPatchSub={(sid, patch) => patchSub(openTask.id, sid, patch)} onToggleLabel={(lid) => toggleLabel(openTask.id, lid)} isQueued={claudeQueue.has(openTask.id)} onToggleQueue={() => toggleClaudeQueue(openTask.id)} onCopyLink={() => copyLink({ view: null, client: "all", project: null, task: openTask.id, clientTab: null, vaultFolder: null })} onOpenClientList={() => { setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(openTask.clientId); setActiveProject(openTask.projectId); setClientTab("tasks"); setOpenTaskId(null); }} templates={taskTemplates} onApplyTemplate={(templateId) => applyTemplate(openTask.id, templateId)} onUploadCommentImage={(file) => uploadOneImage("comments", file)} onCopyAttachmentLink={copyAttachmentLink} onGetSignedUrl={signedUrlForFile} messages={messages.filter((m) => m.taskId === openTask.id)} linkedContactInfo={contactForClient(openTask.clientId)} ccContacts={contacts} onUploadMessageImage={(file) => uploadOneImage("messages", file)} onSendTaskMessage={canMessageClient(openTask.clientId) ? (channel, subject, body, attachments, cc, bcc) => sendMessage(openTask.clientId, channel, subject, body, attachments, cc, bcc, openTask.id) : undefined} sendingMessage={sendingMessage} onRegenerateAiSummary={() => regenerateAiSummary(openTask.clientId)} aiSummaryBusy={aiSummaryBusyId === openTask.clientId} />
      )}

      {settingsHubOpen && (
        <SettingsHub
          onClose={() => setSettingsHubOpen(false)}
          me={me} canAdmin={canAdmin} hasTerritoryAccess={canAdmin || myTerritories.length > 0}
          subAccounts={subAccounts}
          onSaveClient={(c) => { setClients((cs) => cs.map((x) => (x.id === c.id ? c : x))); markOwnClientWrite(c.id); upsertClient(c); }}
          onSynced={async () => { try { setContacts(await fetchContacts()); pushToast("Contacts updated from GoHighLevel"); } catch { /* ignore */ } }}
          territories={territories} contacts={contacts} clients={clients}
          onAddTerritory={addTerritory} onAssignTerritory={assignTerritory} onDeleteTerritory={deleteTerritory}
          onAddContact={(contact) => addClientContact(contact)}
          onOpenClient={(id) => { setSettingsHubOpen(false); setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(id); setActiveProject(null); }}
          templates={taskTemplates} projects={projects}
          onSaveTemplate={saveTemplate} onDeleteTemplate={deleteTemplate} onUseTemplateAsTask={useTemplateAsTask}
        />
      )}
      {addClientOpen && <AddClientModal subAccounts={subAccounts} contacts={contacts} existingIds={new Set(clients.map((c) => c.id))} onAdd={addClientContact} onClose={() => setAddClientOpen(false)} />}
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
      {promptDialog && <PromptModal {...promptDialog} onCancel={() => setPromptDialog(null)} />}
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
        onOpenClient={(id) => { setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(id); setActiveProject(null); setCmdkOpen(false); }}
        onOpenProject={(id) => {
          if (id === PERSONAL_PROJECT_ID) { setMyWork(false); setPersonalView(true); setInboxView(false); setCmdkOpen(false); return; }
          const p = projects.find((x) => x.id === id); if (p) { setMyWork(false); setPersonalView(false); setInboxView(false); setActiveClient(p.clientId); setActiveProject(id); } setCmdkOpen(false);
        }}
        onAddContact={(contact) => { addClientContact(contact); setCmdkOpen(false); }}
        onClose={() => setCmdkOpen(false)} />}

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (<div key={t.id} className="rounded-lg bg-foreground px-3.5 py-2 text-[15px] font-medium text-[color:var(--surface)] shadow-lg">{t.text}</div>))}
      </div>
    </div>
  );
}

