"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  users,
  setUsers,
  initialsOf,
  userById,
  formatDue,
  advanceDue,
  timeAgo,
  TODAY,
  STATUS_META,
  STATUS_ORDER,
  CLIENT_STATUS_META,
  type ClientStatus,
  HEALTH_META,
  clientHealth,
  PRIORITY_META,
  PRIORITY_ORDER,
  type Task,
  type TaskStatus,
  type Priority,
  type Client,
  type Project,
  type Contact,
  type Attachment,
  type Notification,
  type ClientLink,
  type ClientNote,
  type NoteType,
  type Comment,
  type Me,
} from "@/lib/data";
import { supabase, supabaseReady, authedFetch } from "@/lib/supabase";
import { seedIfEmpty, fetchAll, fetchContacts, upsertTask, deleteTaskDb, upsertClient, upsertProject, deleteProjectDb, deleteClientDb, insertNotif, markNotifsReadDb, uploadTaskFile, signedUrlForFile, deleteTaskFile, upsertClientLink, deleteClientLinkDb, upsertClientNote, deleteClientNoteDb, appendCommentDb, rowToTask, rowToClient, rowToNotif } from "@/lib/db";
import { subscribeRealtime } from "@/lib/realtime";
import TeamPanel from "./TeamPanel";
import SettingsPanel from "./SettingsPanel";
import AddClientModal from "./AddClientModal";


import { I, SideItem, MAX_ATTACHMENT_BYTES, newId, formatBytes, kindFromName, LIST_COLUMNS, type FilterState, type SortBy, type Toast } from "./cockpit/ui";
import { ConfirmModal, PromptModal, LinkFormModal, type ConfirmSpec, type PromptSpec } from "./cockpit/modals";
import { CommandK } from "./cockpit/CommandK";
import { GroupedList } from "./cockpit/GroupedList";
import { TaskDrawer } from "./cockpit/TaskDrawer";
import { QuickLinksBar } from "./cockpit/ClientLinks";
import { ClientNotes } from "./cockpit/ClientNotes";

export default function Cockpit({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [clientLinks, setClientLinks] = useState<ClientLink[]>([]);
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([]);
  const [clientTab, setClientTab] = useState<"tasks" | "knowledge">("tasks");
  const [linkModal, setLinkModal] = useState<{ initial?: ClientLink } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  const [activeClient, setActiveClient] = useState<string>("all");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [myWork, setMyWork] = useState(me.role === "va");
  const [myWorkUser, setMyWorkUser] = useState<string>(me.id);
  const [groupBy, setGroupBy] = useState<"project" | "status" | "priority" | "due">("status");
  const [filters, setFilters] = useState<FilterState>({ status: "all", assignee: "all", priority: "all" });
  const [sortBy, setSortBy] = useState<SortBy>("manual");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleCols, setVisibleCols] = useState<string[]>(["due", "priority", "comments"]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const [bellOpen, setBellOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [ghlBusy, setGhlBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const [promptDialog, setPromptDialog] = useState<PromptSpec | null>(null);
  const [menuClientId, setMenuClientId] = useState<string | null>(null);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);

  // Sidebar client ordering: star to pin, sort mode, manual drag order.
  // Personal preferences → persisted per-browser (localStorage), not the DB.
  type ClientSort = "manual" | "az" | "tasks" | "recent";
  const [clientSort, setClientSort] = useState<ClientSort>("manual");
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
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
  useEffect(() => {
    try {
      const s = localStorage.getItem("cut_clientSort"); if (s) setClientSort(s as ClientSort);
      const st = localStorage.getItem("cut_starred"); if (st) setStarred(new Set(JSON.parse(st)));
      const mo = localStorage.getItem("cut_clientOrder"); if (mo) setManualOrder(JSON.parse(mo));
      const he = localStorage.getItem("cut_hideEmpty"); if (he !== null) setHideEmpty(he === "1");
    } catch { /* fresh browser */ }
  }, []);
  const toggleHideEmpty = () => setHideEmpty((v) => { const n = !v; try { localStorage.setItem("cut_hideEmpty", n ? "1" : "0"); } catch {} return n; });
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
  useEffect(() => { setActiveProject((p) => (p && projects.find((x) => x.id === p)?.clientId === activeClient && !myWork ? p : null)); }, [activeClient, myWork, projects]);
  // Links/Notes/health are single-client concepts — always land back on Tasks when the active client changes.
  useEffect(() => { setClientTab("tasks"); }, [activeClient, myWork]);
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
        } catch { /* roster fetch is best-effort; founder fallback stays */ }
        const d = await fetchAll();
        setClients(d.clients); setProjects(d.projects); setContacts(d.contacts); setTasks(d.tasks); setNotifications(d.notifications);
        setClientLinks(d.clientLinks); setClientNotes(d.clientNotes);
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
          // event — contacts/projects/client_links/client_notes aren't in
          // the publication, so no CDC event arrives for them independently.
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
      onStatusChange: (s) => { if (s === "CHANNEL_ERROR") pushToast("⚠️ Live updates interrupted — reconnecting…"); },
    });
    return unsub;
  }, [loading, me.id]);

  // Fallback for the 4 tables without a live subscription (contacts/projects/
  // client_links/client_notes), and a reconnection safety net for the 3 that
  // do — postgres_changes has no replay/resume, and browsers commonly
  // suspend backgrounded WebSocket connections, so a dropped socket means
  // silently missed events, not queued ones. Reuses fetchAll() for the data.
  //
  // tasks/clients/notifications are merged (add/update by id), NEVER
  // wholesale-replaced: their deletions are already fully covered by the
  // live realtime DELETE handlers above, so this fallback has no need to
  // remove anything for them — and a wholesale replace here was actively
  // dangerous: any transient gap between this fetch's snapshot and a very
  // recent local write could wipe a real, just-saved task out of view even
  // though it was safely in the database. contacts/projects/client_links/
  // client_notes have no realtime coverage at all, so they still need a
  // full replace (including removals) to reflect deletes.
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
        setContacts(d.contacts); setClientLinks(d.clientLinks); setClientNotes(d.clientNotes); setProjects(d.projects);
        setTasks((prev) => mergeById(prev, d.tasks));
        setClients((prev) => mergeById(prev, d.clients));
        setNotifications((prev) => mergeById(prev, d.notifications));
      } catch (e) { console.warn("[realtime] visibility refetch failed", e); }
    };
    document.addEventListener("visibilitychange", refetch);
    window.addEventListener("focus", refetch);
    return () => { document.removeEventListener("visibilitychange", refetch); window.removeEventListener("focus", refetch); };
  }, []);

  const notify = (recipientId: string, text: string, taskId: string | null) => {
    const n: Notification = { id: newId("n_"), recipientId, text, taskId, at: new Date().toISOString(), read: false };
    setNotifications((ns) => [n, ...ns]);
    insertNotif(n);
  };

  const myNotifs = notifications.filter((n) => n.recipientId === me.id);
  const unread = myNotifs.filter((n) => !n.read).length;

  const passesFilters = (t: Task) =>
    (filters.status === "all" || t.status === filters.status) &&
    (filters.assignee === "all" || (filters.assignee === "unassigned" ? t.assigneeId === null : t.assigneeId === filters.assignee)) &&
    (filters.priority === "all" || t.priority === filters.priority);

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
  const scopedTasks = canAdmin ? tasks : tasks.filter((t) => t.assigneeId === me.id);
  // Sub-accounts (Agency/Directory) are the contact source; clients (cl_*) are contacts you've added.
  const subAccounts = clients.filter((c) => !c.id.startsWith("cl_"));
  const clientList = clients.filter((c) => c.id.startsWith("cl_"));
  const visibleClients = canAdmin ? clientList : clientList.filter((c) => scopedTasks.some((t) => t.clientId === c.id));
  // Apply the user's sort preference; starred clients always float to the top.
  const sortedClients = (() => {
    const base = [...visibleClients];
    if (clientSort === "az") base.sort((a, b) => a.name.localeCompare(b.name));
    else if (clientSort === "tasks") base.sort((a, b) => clientTaskCountRef(b.id) - clientTaskCountRef(a.id));
    else if (clientSort === "recent") base.reverse(); // fetch order is created_at asc
    else if (manualOrder.length) base.sort((a, b) => { const ia = manualOrder.indexOf(a.id), ib = manualOrder.indexOf(b.id); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); });
    return [...base.filter((c) => starred.has(c.id)), ...base.filter((c) => !starred.has(c.id))];
  })();
  function clientTaskCountRef(clientId: string) { return scopedTasks.filter((t) => t.clientId === clientId).length; }
  // Sidebar sections by client status; Active has no header, others only show when non-empty.
  const clientGroups = ([["", "active"], ["Paused", "paused"], ["Archived", "archived"]] as const)
    .map(([header, st]) => ({ header, items: sortedClients.filter((c) => c.status === st) }))
    .filter((g) => g.items.length > 0);
  const ghlContactUrlFor = (clientId: string) => {
    if (!clientId.startsWith("cl_")) return null;
    const ct = contactById(clientId.slice(3));
    if (!ct) return null;
    const sub = clientById(ct.clientId);
    return sub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${sub.ghlLocationId}/contacts/detail/${ct.ghlContactId}` : null;
  };

  const visibleProjects = useMemo(() => projects.filter((p) => p.clientId.startsWith("cl_") && (activeClient === "all" || p.clientId === activeClient)), [projects, activeClient]);
  const baseTasks = scopedTasks.filter((t) => t.clientId.startsWith("cl_") && (activeClient === "all" || t.clientId === activeClient) && (!activeProject || t.projectId === activeProject));
  const projectsForClient = (clientId: string) => projects.filter((p) => p.clientId === clientId);
  const projectProgress = (projectId: string) => { const ts = scopedTasks.filter((t) => t.projectId === projectId); const done = ts.filter((t) => t.status === "done").length; return { done, total: ts.length, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 }; };
  const clientTaskCount = (clientId: string) => scopedTasks.filter((t) => t.clientId === clientId).length;
  const myWorkTasks = sortTasks(tasks.filter((t) => t.assigneeId === myWorkUser && passesFilters(t)));

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;
  const filtersActive = filters.status !== "all" || filters.assignee !== "all" || filters.priority !== "all";
  const activeFilterCount = [filters.status !== "all", filters.assignee !== "all", filters.priority !== "all", sortBy !== "manual"].filter(Boolean).length;

  // due-date buckets relative to the fixed "today"
  const weekEnd = (() => { const [y, m, d] = TODAY.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + 7); return dt.toISOString().slice(0, 10); })();
  const dueBucket = (t: Task) => { if (!t.due) return "none"; if (t.due < TODAY && t.status !== "done") return "overdue"; if (t.due === TODAY) return "today"; if (t.due <= weekEnd) return "week"; return "later"; };

  type Grp = { key: string; label: string; color: string; tasks: Task[] };
  const buildGroups = (list: Task[], dim: typeof groupBy = groupBy): Grp[] => {
    if (dim === "status") return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_META[s].label, color: STATUS_META[s].dot, tasks: list.filter((t) => t.status === s) }));
    if (dim === "priority") return PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_META[p].label, color: PRIORITY_META[p].color, tasks: list.filter((t) => t.priority === p) }));
    if (dim === "due") { const defs: [string, string, string][] = [["overdue", "Overdue", "#ef4444"], ["today", "Today", "#f59e0b"], ["week", "This week", "#3b82f6"], ["later", "Later", "#94a3b8"], ["none", "No due date", "#cbd5e1"]]; return defs.map(([k, l, c]) => ({ key: k, label: l, color: c, tasks: list.filter((t) => dueBucket(t) === k) })); }
    return visibleProjects.map((p) => ({ key: p.id, label: p.name, color: clientById(p.clientId)?.color ?? "#94a3b8", tasks: list.filter((t) => t.projectId === p.id) }));
  };

  // Flat, in-display-order list of the tasks currently shown — drives prev/next
  // navigation inside the open task (j/k + header arrows).
  const displayedGroups = myWork ? buildGroups(myWorkTasks, "due").filter((g) => g.tasks.length > 0) : buildGroups(sortTasks(baseTasks.filter(passesFilters)));
  const orderedTaskIds = displayedGroups.flatMap((g) => g.tasks.map((t) => t.id));
  const openTaskIdx = openTaskId ? orderedTaskIds.indexOf(openTaskId) : -1;
  const goToTask = (delta: number) => { if (openTaskIdx < 0) return; const next = orderedTaskIds[openTaskIdx + delta]; if (next) setOpenTaskId(next); };
  useEffect(() => {
    if (!openTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
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
    else {
      const existing = projects.find((p) => p.clientId === activeClient);
      if (existing) projectId = existing.id;
      else { const p: Project = { id: newId("p_"), clientId: activeClient, name: "Tasks", description: "" }; setProjects((ps) => [...ps, p]); upsertProject(p); projectId = p.id; }
    }
    const t: Task = {
      id: newId("t_"), projectId, clientId: activeClient, title: title.trim(), description: "",
      status: groupBy === "status" ? (groupKey as TaskStatus) : "todo",
      priority: groupBy === "priority" ? (groupKey as Priority) : "none",
      assigneeId: me.role === "admin" ? null : me.id,
      contactId: activeClient.slice(3),
      due: groupBy === "due" && groupKey === "today" ? TODAY : null,
      recurrence: "none", labelIds: [], ghlTaskId: null, subtasks: [], attachments: [], comments: [], createdAt: new Date().toISOString(),
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
    if (patch.status && patch.status !== before.status) lines.push(`changed status to ${STATUS_META[patch.status].label}`);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) lines.push(patch.assigneeId ? `assigned to ${userById(patch.assigneeId)?.name ?? "someone"}` : "unassigned");
    if (patch.due !== undefined && patch.due !== before.due) lines.push(patch.due ? `set due date to ${formatDue(patch.due)}` : "cleared the due date");
    if (patch.priority && patch.priority !== before.priority) lines.push(`set priority to ${PRIORITY_META[patch.priority].label}`);
    return lines;
  };

  const patchTask = (id: string, patch: Partial<Task>) => {
    const before = tasks.find((x) => x.id === id);
    if (!before) return;
    const events = describeFieldChange(before, patch).map((body) => ({ id: newId("cm_"), authorId: me.id, body, at: new Date().toISOString(), kind: "event" as const }));
    const updated: Task = { ...before, ...patch, comments: events.length ? [...before.comments, ...events] : before.comments };
    let clone: Task | null = null;
    if (patch.status === "done" && before.status !== "done" && before.recurrence !== "none") {
      const nextDue = advanceDue(before.due, before.recurrence);
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

  const addComment = (id: string, body: string) => {
    if (!body.trim()) return;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    // Atomic JSONB append (append_comment RPC) instead of a full-row upsert —
    // two teammates commenting on the same task in the same window would
    // otherwise silently drop one comment (read-then-replace race).
    const newComment: Comment = { id: newId("cm_"), authorId: me.id, body: body.trim(), at: new Date().toISOString() };
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
      body: JSON.stringify({ op, ...target, ghlTaskId: t.ghlTaskId, title: t.title, body: t.description, due: t.due, completed: t.status === "done" }),
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
  const toggleSub = (taskId: string, subId: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) }); };
  const addSub = (taskId: string, title: string) => { const t = tasks.find((x) => x.id === taskId); if (t && title.trim()) update(taskId, { subtasks: [...t.subtasks, { id: newId("s_"), title: title.trim(), done: false }] }); };
  const renameSub = (taskId: string, subId: string, title: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, title } : s)) }); };
  const toggleLabel = (taskId: string, labelId: string) => { const t = tasks.find((x) => x.id === taskId); if (t) update(taskId, { labelIds: t.labelIds.includes(labelId) ? t.labelIds.filter((l) => l !== labelId) : [...t.labelIds, labelId] }); };

  // A client's ghlLocationId field is repurposed to store the contact's business/company name.
  const clientCompany = (c: Client | null) => (c && c.id.startsWith("cl_") ? c.ghlLocationId : "");
  const addClientContact = async (contact: Contact) => {
    const id = "cl_" + contact.id;
    if (clients.some((c) => c.id === id)) { setActiveClient(id); setMyWork(false); setAddClientOpen(false); return; }
    const sub = subAccounts.find((s) => s.id === contact.clientId);
    const c: Client = { id, name: contact.name, color: sub?.color ?? "#a855f7", ghlLocationId: "", status: "active" };
    setClients((cs) => [...cs, c]);
    markOwnClientWrite(c.id);
    upsertClient(c);
    setActiveClient(id);
    setMyWork(false);
    pushToast(`Added ${contact.name}`);
    try {
      const res = await authedFetch("/api/ghl/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: sub?.ghlLocationId ?? "", contactId: contact.ghlContactId }) });
      const j = await res.json();
      if (j.company) { const up: Client = { ...c, ghlLocationId: j.company }; setClients((cs) => cs.map((x) => (x.id === id ? up : x))); markOwnClientWrite(up.id); upsertClient(up); }
    } catch { /* business name is optional */ }
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
        deleteProjectDb(id);
      },
    });
  };

  // --- client links -----------------------------------------------------
  const saveLink = (clientId: string, initial: ClientLink | undefined, v: { label: string; url: string; groupLabel: string }) => {
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
  const addNote = (clientId: string, type: NoteType, body: string) => {
    const note: ClientNote = { id: newId("cn_"), clientId, type, body, authorId: me.id, at: new Date().toISOString() };
    setClientNotes((ns) => [note, ...ns]); // newest-first feed
    upsertClientNote(note);
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
      <div className="max-w-md text-[15px] text-muted">Run <code className="rounded bg-background px-1 py-0.5">supabase/schema.sql</code> in your Supabase project&apos;s SQL editor, then reload this page.</div>
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[15px] text-red-600">{dbError}</div>
    </div>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden text-[15px]">
      {/* mobile backdrop */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ---------- Sidebar ---------- */}
      <aside className={`sidebar-dark fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r bg-surface transition-transform ${sidebarHidden ? "md:hidden" : "md:static md:translate-x-0"} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">CT</span>
          <div className="leading-tight"><div className="font-semibold">ClickUpTasks</div><div className="text-[15px] text-muted">GHL Task Cockpit</div></div>
        </div>

        <nav className="space-y-0.5 px-2">
          <SideItem active={myWork} onClick={() => { setMyWork(true); setSidebarOpen(false); setOpenTaskId(null); }}><I.inbox className="text-muted" /> <span>My Work</span></SideItem>
          <SideItem active={!myWork && activeClient === "all"} onClick={() => { setMyWork(false); setActiveClient("all"); setSidebarOpen(false); setOpenTaskId(null); }}><I.grid className="text-muted" /> <span>All clients</span><span className="ml-auto text-[15px] text-muted">{scopedTasks.length}</span></SideItem>
        </nav>

        <div className="flex items-center justify-between px-4 pb-1 pt-4">
          <span className="text-[15px] font-semibold uppercase tracking-wide text-muted">Clients</span>
          <span className="flex items-center gap-0.5">
            <span className="relative">
              <button onClick={() => setSortMenuOpen((o) => !o)} title="Sort clients" className={`rounded p-0.5 hover:bg-background hover:text-foreground ${clientSort !== "manual" ? "text-accent" : "text-muted"}`}><I.list className="h-3.5 w-3.5" /></button>
              {sortMenuOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setSortMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-white/10 bg-background p-1 shadow-xl">
                  {([["manual", "Manual (drag to order)"], ["az", "A → Z"], ["tasks", "Most active"], ["recent", "Recently added"]] as const).map(([v, label]) => (
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
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {clientGroups.map((g) => (
          <div key={g.header || "active"}>
          {g.header && <div className="px-2.5 pb-0.5 pt-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{g.header}</div>}
          {g.items.map((c) => {
            const active = !myWork && activeClient === c.id;
            const clientProjects = projectsForClient(c.id);
            return (
              <div key={c.id} className={menuClientId === c.id ? "relative z-50" : undefined}
                draggable onDragStart={() => setDragClientId(c.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropOnClient(c.id); }}>
                <div className={`group/row relative ${dragClientId === c.id ? "opacity-40" : ""} ${statusMenuClientId === c.id ? "z-50" : ""}`}>
                  {statusMenuClientId === c.id && (<>
                    <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setStatusMenuClientId(null); }} />
                    <div className="absolute left-1 top-full z-40 mt-1 w-36 rounded-lg border border-white/10 bg-background p-1 shadow-xl">
                      {(Object.keys(CLIENT_STATUS_META) as ClientStatus[]).map((st) => (
                        <button key={st} onClick={(e) => { e.stopPropagation(); setStatusMenuClientId(null); setClientStatus(c.id, st); }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CLIENT_STATUS_META[st].dot }} />
                          {CLIENT_STATUS_META[st].label}
                          {c.status === st && <I.check className="ml-auto text-accent" />}
                        </button>
                      ))}
                    </div>
                  </>)}
                  <button onClick={() => { setMyWork(false); setActiveClient(c.id); setActiveProject(null); setSidebarOpen(false); setOpenTaskId(null); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[15px] transition ${active ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-background"} ${c.status === "archived" ? "opacity-50" : ""}`}>
                    <span role="button" title={`${CLIENT_STATUS_META[c.status].label} — click to change`}
                      onClick={(e) => { e.stopPropagation(); setStatusMenuClientId(statusMenuClientId === c.id ? null : c.id); }}
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-white/30" style={{ background: CLIENT_STATUS_META[c.status].dot }} />
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" title={HEALTH_META[clientHealth(c.id, scopedTasks)].label} style={{ background: HEALTH_META[clientHealth(c.id, scopedTasks)].dot }} />
                    <span className="min-w-0 flex-1">
                      <span className="truncate">{c.name}</span>
                      {clientCompany(c) && <span className="block truncate text-[13px] font-normal text-muted">{clientCompany(c)}</span>}
                    </span>
                    <span className="text-[15px] text-muted group-hover/row:opacity-0">{clientTaskCount(c.id)}</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); toggleStar(c.id); }} title={starred.has(c.id) ? "Unstar" : "Star — pin to top"}
                    className={`absolute right-8 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-background ${starred.has(c.id) ? "text-amber-400" : "text-muted opacity-0 group-hover/row:opacity-100"}`}>
                    <I.star filled={starred.has(c.id)} />
                  </button>
                  {canAdmin && (
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                      <button onClick={(e) => { e.stopPropagation(); setMenuClientId(menuClientId === c.id ? null : c.id); }} title="More" className="rounded p-1 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover/row:opacity-100"><I.dots /></button>
                      {menuClientId === c.id && (<>
                        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMenuClientId(null); }} />
                        <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-white/10 bg-background p-1 shadow-xl">
                          <button onClick={(e) => { e.stopPropagation(); setMenuClientId(null); addProject(c.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[15px] hover:bg-white/10"><I.plus /> Add project</button>
                          <button onClick={(e) => { e.stopPropagation(); setMenuClientId(null); renameClient(c.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[15px] hover:bg-white/10"><I.pencil /> Rename client</button>
                          <button onClick={(e) => { e.stopPropagation(); setMenuClientId(null); deleteClient(c.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[15px] text-red-500 hover:bg-white/10"><I.trash /> Remove client</button>
                        </div>
                      </>)}
                    </div>
                  )}
                </div>
                {active && clientProjects.length > 0 && (
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
                            <span className="shrink-0 tabular-nums opacity-70">{pg.done}/{pg.total}</span>
                            {canAdmin && (
                              <span onClick={(e) => { e.stopPropagation(); setMenuProjectId(menuProjectId === p.id ? null : p.id); }}
                                className="rounded p-0.5 opacity-0 hover:bg-background hover:text-foreground group-hover/prow:opacity-100"><I.dots /></span>
                            )}
                          </button>
                          {menuProjectId === p.id && (<>
                            <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMenuProjectId(null); }} />
                            <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg border border-white/10 bg-background p-1 shadow-xl">
                              <button onClick={(e) => { e.stopPropagation(); setMenuProjectId(null); renameProject(p.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/10"><I.pencil /> Rename</button>
                              <button onClick={(e) => { e.stopPropagation(); setMenuProjectId(null); deleteProject(p.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-red-500 hover:bg-white/10"><I.trash /> Delete</button>
                            </div>
                          </>)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          </div>
          ))}
          {visibleClients.length === 0 && <div className="px-3 py-3 text-[15px] leading-relaxed text-muted">No clients yet. Click <b>+</b> to add one from your GoHighLevel contacts.</div>}
        </nav>

        {canAdmin && (
          <nav className="space-y-0.5 border-t px-2 py-2">
            <div className="px-2.5 pb-1 pt-0.5 text-[15px] font-semibold uppercase tracking-wide text-muted">Manage</div>
            <SideItem active={false} onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}><I.gear className="text-muted" /> <span>Settings</span></SideItem>
            <SideItem active={false} onClick={() => { setTeamOpen(true); setSidebarOpen(false); }}><I.user className="text-muted" /> <span>Team</span></SideItem>
          </nav>
        )}

        <div className="flex items-center gap-2 border-t px-4 py-3">
          <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ width: 30, height: 30, background: me.color }}>{me.initials}</span>
          <div className="min-w-0 leading-tight"><div className="truncate text-[15px] font-medium">{me.name}</div><div className="text-[15px] capitalize text-muted">{me.role}</div></div>
          <button onClick={toggleTheme} title="Toggle theme" className="ml-auto rounded-lg border p-1.5 text-muted hover:text-foreground">{theme === "light" ? <I.moon /> : <I.sun />}</button>
          <button onClick={onSignOut} title="Sign out" className="rounded-lg border p-1.5 text-muted hover:text-red-500"><I.logout /></button>
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-4 py-3 shadow-soft sm:px-5">
          <button onClick={toggleSidebar} title="Show/hide sidebar" className="rounded-lg border p-2 text-muted hover:text-foreground"><I.menu /></button>
          {!myWork && activeClient !== "all" && clientById(activeClient) && (
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[16px] font-semibold text-white shadow-soft sm:flex" style={{ background: clientById(activeClient)!.color }}>{clientById(activeClient)!.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
          )}
          <div className="min-w-0">
            {!myWork && activeProject && projectById(activeProject) ? (<>
              <h1 className="flex items-center gap-1.5 truncate text-[17px] font-semibold"><I.folder className="shrink-0 text-muted" /> {projectById(activeProject)!.name}</h1>
              <p className="hidden items-center gap-2 text-[15px] text-muted sm:flex">
                <button onClick={() => setActiveProject(null)} className="hover:text-foreground hover:underline">{clientById(activeClient)?.name}</button>
                <span>·</span>
                {(() => { const pg = projectProgress(activeProject); return (<span className="inline-flex items-center gap-1.5">{pg.done}/{pg.total} done<span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-border align-middle"><span className="block h-full rounded-full bg-green-500 transition-all" style={{ width: `${pg.pct}%` }} /></span>{pg.pct}%</span>); })()}
              </p>
            </>) : (<>
              <h1 className="flex items-center gap-2 truncate text-[17px] font-semibold">
                {myWork ? "My Work" : activeClient === "all" ? "All clients" : (ghlContactUrlFor(activeClient) ? <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="hover:text-accent hover:underline">{clientById(activeClient)?.name}</a> : clientById(activeClient)?.name)}
                {!myWork && activeClient !== "all" && (() => { const h = HEALTH_META[clientHealth(activeClient, scopedTasks)]; return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ background: h.dot + "1a", color: h.dot }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} /> {h.label}</span>; })()}
              </h1>
              <p className="hidden text-[15px] text-muted sm:block">{myWork ? "Everything assigned to one person, across all clients" : activeClient === "all" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}` : clientCompany(clientById(activeClient))}</p>
            </>)}
          </div>

          {!myWork && activeClient !== "all" && !activeProject && (
            <div className="inline-flex overflow-hidden rounded-md border">
              <button onClick={() => setClientTab("tasks")} className={`px-2.5 py-1.5 text-[13px] font-medium ${clientTab === "tasks" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Tasks</button>
              <button onClick={() => setClientTab("knowledge")} className={`px-2.5 py-1.5 text-[13px] font-medium ${clientTab === "knowledge" ? "bg-accent-soft text-accent" : "bg-background text-muted hover:text-foreground"}`}>Knowledge · {clientNotes.filter((n) => n.clientId === activeClient).length}</button>
            </div>
          )}


          {myWork ? (
            canAdmin ? (
              <label className="flex items-center gap-2"><span className="text-muted">Viewing work for</span>
                <select value={myWorkUser} onChange={(e) => setMyWorkUser(e.target.value)} className="rounded-md border bg-background px-2 py-1 outline-none">{users.map((u) => (<option key={u.id} value={u.id}>{u.name}{u.role === "va" ? " (VA)" : ""}</option>))}</select>
              </label>
            ) : (
              <span className="text-[15px] text-muted">Your assigned tasks across all clients</span>
            )
          ) : clientTab === "knowledge" ? null : (
            <div className="relative">
              <button onClick={() => setFilterOpen((o) => !o)} className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-muted hover:text-foreground">
                <I.filter /> Filter &amp; view
                {activeFilterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[13px] font-semibold text-white">{activeFilterCount}</span>}
              </button>
              {filterOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
                <div className="absolute left-0 z-40 mt-1 w-72 space-y-2.5 rounded-xl border bg-surface p-3 shadow-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold uppercase tracking-wide text-muted">Group &amp; sort</span>
                    {(filtersActive || sortBy !== "manual") && <button onClick={() => { setFilters({ status: "all", assignee: "all", priority: "all" }); setSortBy("manual"); }} className="text-[13px] font-medium text-accent">Reset</button>}
                  </div>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Group by</span><select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="status">Status</option><option value="priority">Priority</option><option value="due">Due date</option><option value="project">Project</option></select></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Sort</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="manual">Manual</option><option value="due">Due date</option><option value="priority">Priority</option><option value="title">Task name</option><option value="status">Status</option><option value="assignee">Assignee</option></select></label>
                  <button onClick={toggleHideEmpty} className="flex w-full items-center gap-2 rounded px-0 py-1 text-left hover:bg-background">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${hideEmpty ? "border-accent bg-accent text-white" : "border-border"}`}>{hideEmpty && <I.check />}</span>
                    <span className="text-muted">Hide empty groups</span>
                  </button>
                  <div className="border-t pt-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Filter</div>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Status</span><select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as FilterState["status"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Assignee</span><select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option><option value="unassigned">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-muted">Priority</span><select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as FilterState["priority"] }))} className="rounded-md border bg-background px-2 py-1 outline-none"><option value="all">All</option>{PRIORITY_ORDER.filter((p) => p !== "none").map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></label>
                  <div className="border-t pt-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Columns</div>
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

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button onClick={() => { const opening = !bellOpen; setBellOpen(opening); if (opening) { setNotifications((ns) => ns.map((n) => (n.recipientId === me.id ? { ...n, read: true } : n))); markNotifsReadDb(me.id); } }} className="relative rounded-lg border bg-background p-2 text-muted hover:text-foreground">
                <I.bell />
                {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[15px] font-semibold text-white">{unread}</span>}
              </button>
              {bellOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-80 overflow-hidden rounded-xl border bg-surface shadow-xl">
                  <div className="border-b px-4 py-2.5 text-[15px] font-semibold uppercase tracking-wide text-muted">Notifications</div>
                  <div className="max-h-96 overflow-y-auto">
                    {myNotifs.length === 0 && <div className="px-4 py-6 text-center text-[15px] text-muted">You&apos;re all caught up.</div>}
                    {myNotifs.map((n) => (<button key={n.id} onClick={() => { if (n.taskId) setOpenTaskId(n.taskId); setBellOpen(false); }} className="flex w-full gap-2.5 border-b px-4 py-2.5 text-left last:border-0 hover:bg-background"><I.comment className="mt-0.5 shrink-0 text-accent" /><div><div className="text-[15px] leading-snug">{n.text}</div><div className="text-[15px] text-muted">{timeAgo(n.at)}</div></div></button>))}
                  </div>
                </div>
              </>)}
            </div>
          </div>
        </header>

        {!myWork && activeClient !== "all" && (
          <QuickLinksBar
            links={clientLinks.filter((l) => l.clientId === activeClient)}
            ghlLink={ghlContactUrlFor(activeClient) ? { label: "Open in GHL", url: ghlContactUrlFor(activeClient)! } : null}
            canEdit={canAdmin}
            onAdd={() => setLinkModal({})}
            onEdit={(link) => setLinkModal({ initial: link })}
            onDelete={deleteLink}
            onReorder={(ids) => reorderLinks(activeClient, ids)}
          />
        )}

        {/* content */}
        {myWork ? (
          <GroupedList groups={buildGroups(myWorkTasks, "due").filter((g) => g.tasks.length > 0)} showClient clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={["priority", "comments"]} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={false} quickAddHint="" onQuickAdd={() => {}} onToggleSub={toggleSub} onAddSub={addSub} />
        ) : !activeProject && activeClient !== "all" && clientTab === "knowledge" ? (
          <ClientNotes
            notes={clientNotes.filter((n) => n.clientId === activeClient)}
            me={me}
            onAdd={(type, body) => addNote(activeClient, type, body)}
            onEdit={editNote}
            onDelete={deleteNote}
          />
        ) : (
          <GroupedList groups={buildGroups(sortTasks(baseTasks.filter(passesFilters)))} showClient={activeClient === "all"} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={activeClient.startsWith("cl_")} quickAddHint="Pick a client on the left to add tasks." onQuickAdd={quickAdd} onToggleSub={toggleSub} onAddSub={addSub} hideEmpty={hideEmpty} />
        )}
      </main>

      {openTask && (
        <TaskDrawer task={openTask} comment={comment} setComment={setComment} clientById={clientById} projectById={projectById} contactById={contactById}
          full={drawerFull} onToggleFull={toggleDrawerFull}
          navIndex={openTaskIdx} navTotal={orderedTaskIds.length} onPrev={() => goToTask(-1)} onNext={() => goToTask(1)}
          onClose={() => setOpenTaskId(null)} onPatch={(patch) => patchTask(openTask.id, patch)} onDelete={() => deleteTask(openTask.id)} onAddComment={() => addComment(openTask.id, comment)}
          onAddFiles={(files) => addFiles(openTask.id, files)} onDownloadFile={downloadFile} onRemoveFile={(att) => removeFile(openTask.id, att)} uploadProgress={uploadProgress} onPushGhl={() => pushToGhl(openTask.id)} ghlBusy={ghlBusy} ghlLinkable={!!ghlTargetFor(openTask)} onUnlinkGhl={() => unlinkGhl(openTask.id)} clientProjects={projectsForClient(openTask.clientId)} onSetProject={(pid) => patchTask(openTask.id, { projectId: pid })} onNewProject={() => moveTaskToNewProject(openTask.id, openTask.clientId)} onToggleSub={(sid) => toggleSub(openTask.id, sid)} onAddSub={(title) => addSub(openTask.id, title)} onRenameSub={(sid, title) => renameSub(openTask.id, sid, title)} onToggleLabel={(lid) => toggleLabel(openTask.id, lid)} />
      )}

      {teamOpen && <TeamPanel me={me} onClose={() => setTeamOpen(false)} />}
      {settingsOpen && <SettingsPanel clients={subAccounts} onClose={() => setSettingsOpen(false)}
        onSaveClient={(c) => { setClients((cs) => cs.map((x) => (x.id === c.id ? c : x))); markOwnClientWrite(c.id); upsertClient(c); }}
        onSynced={async () => { try { setContacts(await fetchContacts()); pushToast("Contacts updated from GoHighLevel"); } catch { /* ignore */ } }} />}
      {addClientOpen && <AddClientModal subAccounts={subAccounts} contacts={contacts} existingIds={new Set(clients.map((c) => c.id))} onAdd={addClientContact} onClose={() => setAddClientOpen(false)} />}
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
      {promptDialog && <PromptModal {...promptDialog} onCancel={() => setPromptDialog(null)} />}
      {linkModal && activeClient !== "all" && (
        <LinkFormModal
          initial={linkModal.initial ? { label: linkModal.initial.label, url: linkModal.initial.url, groupLabel: linkModal.initial.groupLabel } : undefined}
          onSubmit={(v) => saveLink(activeClient, linkModal.initial, v)}
          onCancel={() => setLinkModal(null)}
        />
      )}
      {cmdkOpen && <CommandK tasks={scopedTasks} clients={clientList} clientById={clientById} onOpenTask={(id) => { setOpenTaskId(id); setCmdkOpen(false); }} onOpenClient={(id) => { setMyWork(false); setActiveClient(id); setCmdkOpen(false); }} onClose={() => setCmdkOpen(false)} />}

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (<div key={t.id} className="rounded-lg bg-foreground px-3.5 py-2 text-[15px] font-medium text-[color:var(--surface)] shadow-lg">{t.text}</div>))}
      </div>
    </div>
  );
}

