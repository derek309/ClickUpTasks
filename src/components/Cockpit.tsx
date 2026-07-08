"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  users,
  labels,
  userById,
  labelById,
  formatDue,
  isOverdue,
  advanceDue,
  TODAY,
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  RECURRENCE_LABEL,
  type Task,
  type TaskStatus,
  type Priority,
  type Recurrence,
  type Client,
  type Project,
  type Contact,
  type Attachment,
  type Notification,
  type Me,
} from "@/lib/data";
import { supabaseReady } from "@/lib/supabase";
import { seedIfEmpty, fetchAll, fetchContacts, upsertTask, deleteTaskDb, upsertClient, upsertProject, deleteProjectDb, deleteClientDb, insertNotif, markNotifsReadDb, uploadTaskFile, signedUrlForFile, deleteTaskFile } from "@/lib/db";
import TeamPanel from "./TeamPanel";
import SettingsPanel from "./SettingsPanel";
import AddClientModal from "./AddClientModal";

// --- tiny inline icons ------------------------------------------------------

const I = {
  grid: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>),
  inbox: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>),
  comment: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/></svg>),
  clip: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>),
  check: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="13" height="13"><path d="M20 6L9 17l-5-5"/></svg>),
  plus: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="16" height="16"><path d="M12 5v14M5 12h14"/></svg>),
  close: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="18" height="18"><path d="M18 6L6 18M6 6l12 12"/></svg>),
  search: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>),
  user: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>),
  calendar: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>),
  bolt: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="12" height="12"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>),
  flag: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="12" height="12"><path d="M4 22V4h13l-1.5 4L17 12H6v10z"/></svg>),
  repeat: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="12" height="12"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>),
  list: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>),
  folder: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>),
  bell: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="17" height="17"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>),
  pencil: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>),
  trash: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>),
  grip: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="12" height="12"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>),
  chevron: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="14" height="14"><path d="M15 18l-6-6 6-6"/></svg>),
  sun: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="15" height="15"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>),
  moon: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="15" height="15"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>),
  menu: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="18" height="18"><path d="M3 6h18M3 12h18M3 18h18"/></svg>),
  logout: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="15" height="15"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>),
  dots: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="16" height="16"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>),
  filter: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>),
  expand: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>),
  minimize: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M9 3v6H3M21 15h-6v6M15 9l6-6M3 21l6-6"/></svg>),
  gear: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
};

function Avatar({ id, size = 26 }: { id: string | null; size?: number }) {
  const u = userById(id);
  if (!u) return (<span className="inline-flex items-center justify-center rounded-full border border-dashed text-muted" style={{ width: size, height: size, fontSize: size * 0.42 }}><I.user /></span>);
  return (<span className="inline-flex items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: u.color, fontSize: size * 0.4 }} title={u.name}>{u.initials}</span>);
}

const attachIcon: Record<string, string> = { pdf: "📄", image: "🖼️", doc: "📝", sheet: "📊", link: "🔗" };
let idCounter = 0;
const newId = (p: string) => p + Date.now().toString(36) + (idCounter++).toString(36);
function formatBytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function kindFromName(name: string): Attachment["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["pdf"].includes(ext)) return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  return "doc";
}

// ---------------------------------------------------------------------------

type FilterState = { status: TaskStatus | "all"; assignee: string; priority: Priority | "all" };
type SortBy = "manual" | "due" | "priority" | "title" | "status" | "assignee" | "comments";
const LIST_COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: "due", label: "Due date", sortable: true },
  { key: "priority", label: "Priority", sortable: true },
  { key: "comments", label: "Comments", sortable: true },
  { key: "contact", label: "Contact", sortable: false },
  { key: "labels", label: "Labels", sortable: false },
];
const COL_WIDTHS: Record<string, string> = { due: "96px", priority: "104px", comments: "84px", assignee: "72px", contact: "160px", labels: "150px" };
type Toast = { id: string; text: string };

export default function Cockpit({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  const [activeClient, setActiveClient] = useState<string>("all");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [myWork, setMyWork] = useState(me.role === "va");
  const [myWorkUser, setMyWorkUser] = useState<string>(me.role === "va" ? me.id : "u_maria");
  const [viewMode, setViewMode] = useState<"board" | "list">("list");
  const [groupBy, setGroupBy] = useState<"project" | "status" | "priority" | "due">("status");
  const [filters, setFilters] = useState<FilterState>({ status: "all", assignee: "all", priority: "all" });
  const [sortBy, setSortBy] = useState<SortBy>("manual");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleCols, setVisibleCols] = useState<string[]>(["due", "priority", "comments"]);
  const [colsOpen, setColsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [comment, setComment] = useState("");

  const [dragId, setDragId] = useState<string | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [ghlBusy, setGhlBusy] = useState(false);
  const [menuClientId, setMenuClientId] = useState<string | null>(null);
  const [drawerFull, setDrawerFull] = useState(false);
  useEffect(() => { try { setDrawerFull(localStorage.getItem("cut_drawerFull") === "1"); } catch {} }, []);
  // Drop the project filter whenever we leave its client (or enter My Work).
  useEffect(() => { setActiveProject((p) => (p && projects.find((x) => x.id === p)?.clientId === activeClient && !myWork ? p : null)); }, [activeClient, myWork, projects]);
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

  useEffect(() => {
    (async () => {
      try {
        if (!supabaseReady) { setDbError("Supabase env vars are missing."); return; }
        await seedIfEmpty();
        const d = await fetchAll();
        setClients(d.clients); setProjects(d.projects); setContacts(d.contacts); setTasks(d.tasks); setNotifications(d.notifications);
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
  const contactsForClient = (clientId: string) => contacts.filter((c) => c.clientId === clientId);

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
  const notify = (recipientId: string, text: string, taskId: string | null) => {
    const n: Notification = { id: newId("n_"), recipientId, text, taskId, at: "just now", read: false };
    setNotifications((ns) => [n, ...ns]);
    insertNotif(n);
  };

  const myNotifs = notifications.filter((n) => n.recipientId === me.id);
  const unread = myNotifs.filter((n) => !n.read).length;

  const q = query.trim().toLowerCase();
  const passesFilters = (t: Task) =>
    (filters.status === "all" || t.status === filters.status) &&
    (filters.assignee === "all" || (filters.assignee === "unassigned" ? t.assigneeId === null : t.assigneeId === filters.assignee)) &&
    (filters.priority === "all" || t.priority === filters.priority) &&
    (q === "" || t.title.toLowerCase().includes(q) || (contactById(t.contactId)?.name.toLowerCase().includes(q) ?? false));

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
  const subAccountOf = (clientId: string) => contactById(clientId.slice(3))?.clientId ?? null;
  const subAccountName = (clientId: string) => { const s = subAccountOf(clientId); return subAccounts.find((x) => x.id === s)?.name ?? ""; };
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
      recurrence: "none", labelIds: [], ghlTaskId: null, subtasks: [], attachments: [], comments: [],
    };
    setTasks((ts) => [...ts, t]);
    upsertTask(t);
  };

  const toggleCollapse = (key: string) => setCollapsed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // --- mutations ------------------------------------------------------------

  const update = (id: string, patch: Partial<Task>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const cur = tasks.find((t) => t.id === id);
    if (cur) { const merged = { ...cur, ...patch }; upsertTask(merged); syncGhlIfLinked(merged, patch); }
  };

  const patchTask = (id: string, patch: Partial<Task>) => {
    const before = tasks.find((x) => x.id === id);
    if (!before) return;
    const updated: Task = { ...before, ...patch };
    let clone: Task | null = null;
    if (patch.status === "done" && before.status !== "done" && before.recurrence !== "none") {
      const nextDue = advanceDue(before.due, before.recurrence);
      clone = { ...before, id: newId("t_"), status: "todo", due: nextDue, subtasks: before.subtasks.map((s) => ({ ...s, id: newId("s_"), done: false })), comments: [], attachments: [...before.attachments], ghlTaskId: null };
      pushToast(`🔁 Recurring — next occurrence created for ${formatDue(nextDue)}`);
    }
    setTasks((prev) => { let next = prev.map((x) => (x.id === id ? updated : x)); if (clone) next = [...next, clone]; return next; });
    upsertTask(updated);
    syncGhlIfLinked(updated, patch);
    if (clone) upsertTask(clone);
    if (patch.assigneeId && patch.assigneeId !== me.id && patch.assigneeId !== before.assigneeId) {
      notify(patch.assigneeId, `${me.name} assigned you “${before.title}”`, id);
      pushToast(`Notified ${userById(patch.assigneeId)?.name}`);
    }
  };

  const deleteTask = (id: string) => {
    if (!confirm("Delete this task? This can't be undone.")) return;
    const t = tasks.find((x) => x.id === id);
    if (t?.ghlTaskId) ghlCall("delete", t); // also remove it from GoHighLevel
    setTasks((ts) => ts.filter((t) => t.id !== id));
    setOpenTaskId(null);
    deleteTaskDb(id);
    pushToast("Task deleted");
  };

  const addTask = (projectId: string, clientId: string, title: string) => {
    if (!title.trim()) return;
    const t: Task = { id: newId("t_"), projectId, clientId, title: title.trim(), description: "", status: "todo", priority: "none", assigneeId: me.role === "admin" ? null : me.id, contactId: clientId.startsWith("cl_") ? clientId.slice(3) : null, due: null, recurrence: "none", labelIds: [], ghlTaskId: null, subtasks: [], attachments: [], comments: [] };
    setTasks((ts) => [...ts, t]);
    upsertTask(t);
    setDraft("");
    setComposing(null);
  };

  const addComment = (id: string, body: string) => {
    if (!body.trim()) return;
    const t = tasks.find((x) => x.id === id);
    update(id, { comments: [...(t?.comments ?? []), { id: newId("cm_"), authorId: me.id, body: body.trim(), at: "just now" }] });
    users.forEach((u) => { if (u.id !== me.id && body.includes("@" + u.name)) { notify(u.id, `${me.name} mentioned you in “${t?.title}”`, id); pushToast(`Notified ${u.name}`); } });
    setComment("");
  };
  const addFiles = async (id: string, files: FileList) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || files.length === 0) return;
    pushToast(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    const items: Attachment[] = [];
    let failed = 0;
    for (const f of Array.from(files)) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${id}/${newId("f_")}-${safe}`;
      const res = await uploadTaskFile(path, f);
      items.push({ id: newId("a_"), name: f.name, size: formatBytes(f.size), kind: kindFromName(f.name), path: res.ok ? path : undefined });
      if (!res.ok) failed++;
    }
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
    return fetch("/api/ghl/task", {
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

  const moveTask = (columnKey: string, beforeId: string | null) => {
    if (!dragId) return;
    const dragged = tasks.find((t) => t.id === dragId);
    if (!dragged) { setDragId(null); return; }
    const moved: Task = { ...dragged };
    if (groupBy === "project") { moved.projectId = columnKey; moved.clientId = projectById(columnKey)?.clientId ?? moved.clientId; }
    else moved.status = columnKey as TaskStatus;
    setTasks((prev) => {
      const without = prev.filter((t) => t.id !== dragId);
      let idx: number;
      if (beforeId && beforeId !== dragId) idx = without.findIndex((t) => t.id === beforeId);
      else { const inCol = without.filter((t) => (groupBy === "project" ? t.projectId === columnKey : t.status === columnKey)); idx = inCol.length === 0 ? without.length : without.findIndex((t) => t.id === inCol[inCol.length - 1].id) + 1; }
      if (idx < 0) idx = without.length;
      const copy = [...without];
      copy.splice(idx, 0, moved);
      return copy;
    });
    upsertTask(moved);
    setDragId(null);
  };
  const onCardDrop = (target: Task) => moveTask(groupBy === "project" ? target.projectId : target.status, target.id);

  // A client's ghlLocationId field is repurposed to store the contact's business/company name.
  const clientCompany = (c: Client | null) => (c && c.id.startsWith("cl_") ? c.ghlLocationId : "");
  const addClientContact = async (contact: Contact) => {
    const id = "cl_" + contact.id;
    if (clients.some((c) => c.id === id)) { setActiveClient(id); setMyWork(false); setAddClientOpen(false); return; }
    const sub = subAccounts.find((s) => s.id === contact.clientId);
    const c: Client = { id, name: contact.name, color: sub?.color ?? "#a855f7", ghlLocationId: "" };
    setClients((cs) => [...cs, c]);
    upsertClient(c);
    setActiveClient(id);
    setMyWork(false);
    pushToast(`Added ${contact.name}`);
    try {
      const res = await fetch("/api/ghl/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: sub?.ghlLocationId ?? "", contactId: contact.ghlContactId }) });
      const j = await res.json();
      if (j.company) { const up: Client = { ...c, ghlLocationId: j.company }; setClients((cs) => cs.map((x) => (x.id === id ? up : x))); upsertClient(up); }
    } catch { /* business name is optional */ }
  };
  const renameClient = (id: string) => { const c = clientById(id); const name = prompt("Rename client", c?.name); if (!name?.trim() || !c) return; const nc = { ...c, name: name.trim() }; setClients((cs) => cs.map((x) => (x.id === id ? nc : x))); upsertClient(nc); };
  const deleteClient = (id: string) => {
    const c = clientById(id);
    const n = tasks.filter((t) => t.clientId === id).length;
    if (!confirm(`Remove client “${c?.name}”${n ? ` and its ${n} task(s)` : ""}? The GoHighLevel contact itself stays untouched.`)) return;
    setClients((cs) => cs.filter((x) => x.id !== id));
    setProjects((ps) => ps.filter((p) => p.clientId !== id));
    setTasks((ts) => ts.filter((t) => t.clientId !== id));
    deleteClientDb(id);
    if (activeClient === id) setActiveClient("all");
  };
  const addProject = (clientId: string) => { const name = prompt("New project name?"); if (!name?.trim()) return; const p: Project = { id: newId("p_"), clientId, name: name.trim(), description: "" }; setProjects((ps) => [...ps, p]); upsertProject(p); };
  const moveTaskToNewProject = (taskId: string, clientId: string) => { const name = prompt("New project name?"); if (!name?.trim()) return; const p: Project = { id: newId("p_"), clientId, name: name.trim(), description: "" }; setProjects((ps) => [...ps, p]); upsertProject(p); patchTask(taskId, { projectId: p.id }); pushToast(`Moved to “${p.name}”`); };
  const renameProject = (id: string) => { const p = projectById(id); const name = prompt("Rename project", p?.name); if (!name?.trim() || !p) return; const np = { ...p, name: name.trim() }; setProjects((ps) => ps.map((x) => (x.id === id ? np : x))); upsertProject(np); };
  const deleteProject = (id: string) => { const p = projectById(id); const n = tasks.filter((t) => t.projectId === id).length; if (!confirm(`Delete project “${p?.name}”${n ? ` and its ${n} task(s)` : ""}?`)) return; setProjects((ps) => ps.filter((x) => x.id !== id)); setTasks((ts) => ts.filter((t) => t.projectId !== id)); deleteProjectDb(id); };


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
      <aside className={`sidebar-dark fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r bg-surface transition-transform md:static md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
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
          {canAdmin && <button onClick={() => setAddClientOpen(true)} title="Add client from GHL contacts" className="rounded p-0.5 text-muted hover:bg-background hover:text-foreground"><I.plus /></button>}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {visibleClients.map((c) => {
            const active = !myWork && activeClient === c.id;
            const clientProjects = projectsForClient(c.id);
            return (
              <div key={c.id} className={menuClientId === c.id ? "relative z-50" : undefined}>
                <div className="group/row relative">
                  <button onClick={() => { setMyWork(false); setActiveClient(c.id); setActiveProject(null); setSidebarOpen(false); setOpenTaskId(null); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[15px] transition ${active ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-background"}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="truncate">{c.name}</span>
                      {clientCompany(c) && <span className="block truncate text-[13px] font-normal text-muted">{clientCompany(c)}</span>}
                    </span>
                    <span className="text-[15px] text-muted group-hover/row:opacity-0">{clientTaskCount(c.id)}</span>
                  </button>
                  {canAdmin && (
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                      <button onClick={(e) => { e.stopPropagation(); setMenuClientId(menuClientId === c.id ? null : c.id); }} title="More" className="rounded p-1 text-muted opacity-0 hover:bg-background hover:text-foreground group-hover/row:opacity-100"><I.dots /></button>
                      {menuClientId === c.id && (<>
                        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMenuClientId(null); }} />
                        <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-white/10 bg-background p-1 shadow-xl">
                          <button onClick={(e) => { e.stopPropagation(); setMenuClientId(null); addProject(c.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[15px] hover:bg-white/10"><I.plus /> Add project</button>
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
                        <button key={p.id} onClick={() => { setActiveProject(on ? null : p.id); setOpenTaskId(null); }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition ${on ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
                          <I.folder className="shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <span className="shrink-0 tabular-nums opacity-70">{pg.done}/{pg.total}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
        <header className="relative z-10 flex items-center gap-3 border-b bg-surface px-4 py-3 shadow-soft sm:px-5">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg border p-2 text-muted md:hidden"><I.menu /></button>
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
              <h1 className="truncate text-[17px] font-semibold">{myWork ? "My Work" : activeClient === "all" ? "All clients" : clientById(activeClient)?.name}</h1>
              <p className="hidden text-[15px] text-muted sm:block">{myWork ? "Everything assigned to one person, across all clients" : activeClient === "all" ? `${clientList.length} client${clientList.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}` : [clientCompany(clientById(activeClient)), subAccountName(activeClient), contactById(activeClient.slice(3))?.email].filter(Boolean).join(" · ")}</p>
            </>)}
          </div>

          {!myWork && activeClient.startsWith("cl_") && ghlContactUrlFor(activeClient) && (
            <a href={ghlContactUrlFor(activeClient)!} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent px-2.5 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft"><I.bolt /> Open in GHL</a>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 sm:flex">
              <I.search className="text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks…" className="w-36 bg-transparent text-[15px] outline-none placeholder:text-muted" />
            </div>
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
                    {myNotifs.map((n) => (<button key={n.id} onClick={() => { if (n.taskId) setOpenTaskId(n.taskId); setBellOpen(false); }} className="flex w-full gap-2.5 border-b px-4 py-2.5 text-left last:border-0 hover:bg-background"><I.comment className="mt-0.5 shrink-0 text-accent" /><div><div className="text-[15px] leading-snug">{n.text}</div><div className="text-[15px] text-muted">{n.at}</div></div></button>))}
                  </div>
                </div>
              </>)}
            </div>
          </div>
        </header>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-4 py-2 text-[15px] sm:px-5">
          {myWork ? (
            canAdmin ? (
              <label className="flex items-center gap-2"><span className="text-muted">Viewing work for</span>
                <select value={myWorkUser} onChange={(e) => setMyWorkUser(e.target.value)} className="rounded-md border bg-background px-2 py-1 outline-none">{users.map((u) => (<option key={u.id} value={u.id}>{u.name}{u.role === "va" ? " (VA)" : ""}</option>))}</select>
              </label>
            ) : (
              <span className="text-[15px] text-muted">Your assigned tasks across all clients</span>
            )
          ) : (
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
        </div>

        {/* content */}
        {myWork ? (
          <GroupedList groups={buildGroups(myWorkTasks, "due").filter((g) => g.tasks.length > 0)} showClient clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={["priority", "comments"]} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={false} quickAddHint="" onQuickAdd={() => {}} onToggleSub={toggleSub} onAddSub={addSub} />
        ) : viewMode === "list" ? (
          <GroupedList groups={buildGroups(sortTasks(baseTasks.filter(passesFilters)))} showClient={activeClient === "all"} clientById={clientById} projectById={projectById} contactById={contactById} visibleCols={visibleCols} sortKey={sortBy} sortDir={sortDir} onSort={sortByCol} onOpen={setOpenTaskId} onPatch={patchTask} canQuickAdd={activeClient.startsWith("cl_")} quickAddHint="Pick a client on the left to add tasks." onQuickAdd={quickAdd} onToggleSub={toggleSub} onAddSub={addSub} />
        ) : (
          <div className="flex flex-1 gap-4 overflow-x-auto bg-background p-4 sm:p-5">
            {groupBy === "project"
              ? visibleProjects.map((p) => {
                  const list = sortTasks(scopedTasks.filter((t) => t.projectId === p.id && passesFilters(t)));
                  const client = clientById(p.clientId)!;
                  return (
                    <BoardColumn key={p.id} title={p.name} dot={client.color} count={list.length} subtitle={activeClient === "all" ? client.name : undefined} columnKey={p.id} collapsed={collapsed.has(p.id)} onToggleCollapse={() => toggleCollapse(p.id)} onDropColumn={moveTask} onRename={canAdmin ? () => renameProject(p.id) : undefined} onDelete={canAdmin ? () => deleteProject(p.id) : undefined}>
                      {list.map((t) => (<TaskCard key={t.id} task={t} contactById={contactById} clientById={clientById} onOpen={() => setOpenTaskId(t.id)} onDragStart={() => setDragId(t.id)} onCardDrop={() => onCardDrop(t)} dragging={dragId === t.id} />))}
                      {list.length === 0 && <EmptyCol />}
                      <AddTask projectId={p.id} clientId={p.clientId} composing={composing === p.id} draft={draft} setDraft={setDraft} onStart={() => { setComposing(p.id); setDraft(""); }} onCancel={() => setComposing(null)} onAdd={addTask} />
                    </BoardColumn>
                  );
                })
              : STATUS_ORDER.map((s) => {
                  const list = sortTasks(baseTasks.filter((t) => t.status === s && passesFilters(t)));
                  return (
                    <BoardColumn key={s} title={STATUS_META[s].label} dot={STATUS_META[s].dot} count={list.length} columnKey={s} collapsed={collapsed.has(s)} onToggleCollapse={() => toggleCollapse(s)} onDropColumn={moveTask}>
                      {list.map((t) => (<TaskCard key={t.id} task={t} showProject projectName={projectById(t.projectId)?.name} contactById={contactById} clientById={clientById} onOpen={() => setOpenTaskId(t.id)} onDragStart={() => setDragId(t.id)} onCardDrop={() => onCardDrop(t)} dragging={dragId === t.id} />))}
                      {list.length === 0 && <EmptyCol />}
                    </BoardColumn>
                  );
                })}
            {canAdmin && groupBy === "project" && activeClient !== "all" && (<button onClick={() => addProject(activeClient)} className="mt-1 flex h-9 w-[220px] shrink-0 items-center gap-1.5 rounded-lg border border-dashed px-3 text-[15px] text-muted hover:bg-surface"><I.plus /> Add project</button>)}
          </div>
        )}
      </main>

      {openTask && (
        <TaskDrawer task={openTask} comment={comment} setComment={setComment} clientById={clientById} projectById={projectById} contactById={contactById} contactsForClient={contactsForClient}
          full={drawerFull} onToggleFull={toggleDrawerFull}
          navIndex={openTaskIdx} navTotal={orderedTaskIds.length} onPrev={() => goToTask(-1)} onNext={() => goToTask(1)}
          onClose={() => setOpenTaskId(null)} onPatch={(patch) => patchTask(openTask.id, patch)} onDelete={() => deleteTask(openTask.id)} onAddComment={() => addComment(openTask.id, comment)}
          onAddFiles={(files) => addFiles(openTask.id, files)} onDownloadFile={downloadFile} onRemoveFile={(att) => removeFile(openTask.id, att)} onPushGhl={() => pushToGhl(openTask.id)} ghlBusy={ghlBusy} ghlLinkable={!!ghlTargetFor(openTask)} onUnlinkGhl={() => unlinkGhl(openTask.id)} clientProjects={projectsForClient(openTask.clientId)} onSetProject={(pid) => patchTask(openTask.id, { projectId: pid })} onNewProject={() => moveTaskToNewProject(openTask.id, openTask.clientId)} onToggleSub={(sid) => toggleSub(openTask.id, sid)} onAddSub={(title) => addSub(openTask.id, title)} onRenameSub={(sid, title) => renameSub(openTask.id, sid, title)} onToggleLabel={(lid) => toggleLabel(openTask.id, lid)} />
      )}

      {teamOpen && <TeamPanel me={me} onClose={() => setTeamOpen(false)} />}
      {settingsOpen && <SettingsPanel clients={subAccounts} onClose={() => setSettingsOpen(false)}
        onSaveClient={(c) => { setClients((cs) => cs.map((x) => (x.id === c.id ? c : x))); upsertClient(c); }}
        onSynced={async () => { try { setContacts(await fetchContacts()); pushToast("Contacts updated from GoHighLevel"); } catch { /* ignore */ } }} />}
      {addClientOpen && <AddClientModal subAccounts={subAccounts} contacts={contacts} existingIds={new Set(clients.map((c) => c.id))} onAdd={addClientContact} onClose={() => setAddClientOpen(false)} />}
      {cmdkOpen && <CommandK tasks={scopedTasks} clients={clientList} clientById={clientById} onOpenTask={(id) => { setOpenTaskId(id); setCmdkOpen(false); }} onOpenClient={(id) => { setMyWork(false); setActiveClient(id); setCmdkOpen(false); }} onClose={() => setCmdkOpen(false)} />}

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (<div key={t.id} className="rounded-lg bg-foreground px-3.5 py-2 text-[15px] font-medium text-[color:var(--surface)] shadow-lg">{t.text}</div>))}
      </div>
    </div>
  );
}

// --- small building blocks --------------------------------------------------

function SideItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (<button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[15px] transition ${active ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-background"}`}>{children}</button>);
}
function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (<button onClick={onClick} className={`flex items-center gap-1.5 px-2.5 py-1 ${on ? "bg-accent-soft font-medium text-accent" : "bg-surface text-muted hover:bg-background"}`}>{children}</button>);
}
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const active = value !== "all" && value !== "manual";
  return (<label className="flex items-center gap-1.5"><span className="text-muted">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-md border px-2 py-1 outline-none ${active ? "border-accent text-accent" : "bg-background"}`}>{options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}</select></label>);
}
function EmptyCol() { return <div className="rounded-lg border border-dashed px-3 py-4 text-center text-[15px] text-muted">Nothing here yet</div>; }

function BoardColumn({ title, dot, count, subtitle, columnKey, collapsed, onToggleCollapse, onDropColumn, onRename, onDelete, children }: {
  title: string; dot: string; count: number; subtitle?: string; columnKey: string; collapsed?: boolean; onToggleCollapse?: () => void;
  onDropColumn: (columnKey: string, beforeId: string | null) => void; onRename?: () => void; onDelete?: () => void; children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  if (collapsed) {
    return (
      <section className="flex h-full w-11 shrink-0 flex-col items-center rounded-xl border bg-surface py-3">
        <button onClick={onToggleCollapse} className="rotate-180 rounded p-0.5 text-muted hover:text-foreground" title="Expand"><I.chevron /></button>
        <span className="mt-2 h-2 w-2 rounded-full" style={{ background: dot }} />
        <span className="mt-2 rounded-full bg-background px-1.5 text-[15px] text-muted">{count}</span>
        <div className="mt-3 flex-1 [writing-mode:vertical-rl] text-[15px] font-semibold">{title}</div>
      </section>
    );
  }
  return (
    <section className="group/col flex h-full w-[300px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        {onToggleCollapse && <button onClick={onToggleCollapse} className="rounded p-0.5 text-muted hover:text-foreground" title="Collapse"><I.chevron /></button>}
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
        <h2 className="truncate font-semibold">{title}</h2>
        <span className="rounded-full bg-surface px-1.5 text-[15px] text-muted">{count}</span>
        {(onRename || onDelete) && (<span className="ml-1 flex items-center gap-0.5 opacity-0 group-hover/col:opacity-100">{onRename && <button onClick={onRename} title="Rename project" className="rounded p-0.5 text-muted hover:bg-surface hover:text-foreground"><I.pencil /></button>}{onDelete && <button onClick={onDelete} title="Delete project" className="rounded p-0.5 text-muted hover:bg-surface hover:text-red-500"><I.trash /></button>}</span>)}
        {subtitle && <span className="ml-auto truncate text-[15px] text-muted">{subtitle}</span>}
      </div>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onDropColumn(columnKey, null); }}
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg pr-1 transition ${over ? "bg-accent-soft/60 outline-2 outline-dashed outline-accent/40" : ""}`}>
        {children}
      </div>
    </section>
  );
}

function PriorityFlag({ p }: { p: Priority }) { return p === "none" ? null : <I.flag />; }
function LabelChips({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (<div className="mt-1.5 flex flex-wrap gap-1">{ids.map((id) => { const l = labelById(id); return l ? (<span key={id} className="rounded px-1.5 py-0.5 text-[15px] font-medium" style={{ background: l.color + "1a", color: l.color }}>{l.name}</span>) : null; })}</div>);
}

function TaskCard({ task, onOpen, showProject, projectName, contactById, clientById, onDragStart, onCardDrop, dragging }: {
  task: Task; onOpen: () => void; showProject?: boolean; projectName?: string;
  contactById: (id: string | null) => { name: string } | null; clientById: (id: string) => Client | null;
  onDragStart: () => void; onCardDrop: () => void; dragging: boolean;
}) {
  const s = STATUS_META[task.status];
  const contact = contactById(task.contactId);
  const client = clientById(task.clientId)!;
  const doneSubs = task.subtasks.filter((x) => x.done).length;
  const overdue = isOverdue(task.due) && task.status !== "done";
  return (
    <div draggable onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onCardDrop(); }} onClick={onOpen} role="button"
      className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-surface p-3 text-left shadow-sm transition hover:border-accent/40 hover:shadow ${dragging ? "scale-[0.98] opacity-40" : ""}`}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: client.color }} />
      <span className="absolute right-1.5 top-1.5 text-muted opacity-0 group-hover:opacity-60"><I.grip /></span>
      <div className="pl-1.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[15px] font-medium" style={{ background: s.chip, color: s.dot }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} /> {s.label}</span>
          {task.priority !== "none" && (<span className="inline-flex items-center gap-0.5 text-[15px] font-semibold" style={{ color: PRIORITY_META[task.priority].color }}><PriorityFlag p={task.priority} /> {PRIORITY_META[task.priority].label}</span>)}
          <span className="ml-auto flex items-center gap-1">{task.recurrence !== "none" && <I.repeat className="text-muted" />}{task.ghlTaskId && (<span className="inline-flex items-center gap-0.5 rounded-full bg-green-50 px-1.5 py-0.5 text-[15px] font-semibold text-green-600"><I.bolt /> GHL</span>)}</span>
        </div>
        <div className="text-[15px] font-medium leading-snug">{task.title}</div>
        {showProject && projectName && <div className="mt-0.5 text-[15px] text-muted">{projectName}</div>}
        <LabelChips ids={task.labelIds} />
        {contact && (<div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 text-[15px] text-muted"><I.user /> {contact.name}</div>)}
        <div className="mt-2.5 flex items-center gap-3 text-[15px] text-muted">
          <Avatar id={task.assigneeId} size={22} />
          {task.due && (<span className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-red-500" : ""}`}><I.calendar /> {formatDue(task.due)}</span>)}
          <span className="ml-auto flex items-center gap-2.5">{task.subtasks.length > 0 && (<span className="inline-flex items-center gap-1"><I.check /> {doneSubs}/{task.subtasks.length}</span>)}{task.comments.length > 0 && (<span className="inline-flex items-center gap-1"><I.comment /> {task.comments.length}</span>)}{task.attachments.length > 0 && (<span className="inline-flex items-center gap-1"><I.clip /> {task.attachments.length}</span>)}</span>
        </div>
      </div>
    </div>
  );
}

function ListView({ tasks, onOpen, clientById, projectById, emptyLabel }: {
  tasks: Task[]; onOpen: (id: string) => void; emptyLabel: string;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface">
        <table className="w-full text-[15px]">
          <thead><tr className="border-b bg-background/60 text-left text-[15px] uppercase tracking-wide text-muted"><th className="px-4 py-2 font-semibold">Task</th><th className="px-3 py-2 font-semibold">Client / Project</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">Priority</th><th className="px-3 py-2 font-semibold">Assignee</th><th className="px-3 py-2 font-semibold">Due</th></tr></thead>
          <tbody>
            {tasks.length === 0 && (<tr><td colSpan={6} className="px-4 py-10 text-center text-muted">{emptyLabel}</td></tr>)}
            {tasks.map((t) => {
              const s = STATUS_META[t.status]; const client = clientById(t.clientId)!; const overdue = isOverdue(t.due) && t.status !== "done";
              return (
                <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer border-b last:border-0 hover:bg-background/60">
                  <td className="px-4 py-2.5"><div className="font-medium">{t.title}</div><LabelChips ids={t.labelIds} /></td>
                  <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: client.color }} />{client.name}</div><div className="text-[15px] text-muted">{projectById(t.projectId)?.name}</div></td>
                  <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[15px] font-medium" style={{ background: s.chip, color: s.dot }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} /> {s.label}</span></td>
                  <td className="px-3 py-2.5">{t.priority === "none" ? <span className="text-muted">—</span> : (<span className="inline-flex items-center gap-0.5 text-[15px] font-medium" style={{ color: PRIORITY_META[t.priority].color }}><I.flag /> {PRIORITY_META[t.priority].label}</span>)}</td>
                  <td className="px-3 py-2.5"><Avatar id={t.assigneeId} size={24} /></td>
                  <td className={`px-3 py-2.5 ${overdue ? "font-medium text-red-500" : ""}`}>{t.due ? formatDue(t.due) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- ⌘K command palette -----------------------------------------------------

function CommandK({ tasks, clients, clientById, onOpenTask, onOpenClient, onClose }: {
  tasks: Task[]; clients: Client[]; clientById: (id: string) => Client | null;
  onOpenTask: (id: string) => void; onOpenClient: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const ql = q.trim().toLowerCase();
  const taskItems = (ql ? tasks.filter((t) => t.title.toLowerCase().includes(ql)) : tasks).slice(0, 8);
  const clientItems = (ql ? clients.filter((c) => c.name.toLowerCase().includes(ql) || (c.ghlLocationId ?? "").toLowerCase().includes(ql)) : clients).slice(0, 6);
  const total = taskItems.length + clientItems.length;
  const activate = (i: number) => {
    if (i < taskItems.length) onOpenTask(taskItems[i].id);
    else if (i - taskItems.length < clientItems.length) onOpenClient(clientItems[i - taskItems.length].id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, total - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); activate(idx); }
    else if (e.key === "Escape") onClose();
  };
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-24 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <I.search className="text-muted" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} placeholder="Search tasks and clients…" className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          <span className="rounded border px-1.5 py-0.5 text-[13px] text-muted">Esc</span>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {total === 0 && <div className="px-3 py-6 text-center text-[15px] text-muted">No matches</div>}
          {taskItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">Tasks</div>}
          {taskItems.map((t, i) => { const client = clientById(t.clientId); return (
            <button key={t.id} onMouseEnter={() => setIdx(i)} onClick={() => activate(i)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === i ? "bg-background" : ""}`}>
              <span className="min-w-0 flex-1 truncate text-[15px]">{t.title}</span>
              <span className="shrink-0 text-[13px] text-muted">{client?.name}</span>
            </button>
          ); })}
          {clientItems.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">Clients</div>}
          {clientItems.map((c, i) => { const gi = taskItems.length + i; return (
            <button key={c.id} onMouseEnter={() => setIdx(gi)} onClick={() => activate(gi)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${idx === gi ? "bg-background" : ""}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="truncate text-[15px]">{c.name}</span>
            </button>
          ); })}
        </div>
      </div>
    </>
  );
}

// --- grouped list view (ClickUp-style: group, quick-add, expandable subtasks) --

function GroupedList({ groups, showClient, clientById, projectById, contactById, visibleCols, sortKey, sortDir, onSort, onOpen, onPatch, canQuickAdd, quickAddHint, onQuickAdd, onToggleSub, onAddSub }: {
  groups: { key: string; label: string; color: string; tasks: Task[] }[];
  showClient: boolean; clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null;
  visibleCols: string[]; sortKey: string; sortDir: "asc" | "desc"; onSort: (key: string) => void;
  onOpen: (id: string) => void; onPatch: (taskId: string, patch: Partial<Task>) => void; canQuickAdd: boolean; quickAddHint: string; onQuickAdd: (groupKey: string, title: string) => void;
  onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [subDraft, setSubDraft] = useState<Record<string, string>>({});
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [collapsedG, setCollapsedG] = useState<Set<string>>(new Set());
  const toggleG = (k: string) => setCollapsedG((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const cols = LIST_COLUMNS.filter((c) => visibleCols.includes(c.key));
  const template = ["54px", "minmax(0,1fr)", ...(showClient ? ["180px"] : []), ...cols.map((c) => COL_WIDTHS[c.key])].join(" ");
  const sortColKey: Record<string, string> = { title: "task", priority: "priority", due: "due", assignee: "assignee", status: "status", comments: "comments" };
  const activeCol = sortColKey[sortKey];
  const Arrow = ({ col }: { col: string }) => (activeCol === col ? <span className="text-accent">{sortDir === "asc" ? "↑" : "↓"}</span> : null);

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="grid items-center gap-2 border-b bg-background/40 px-4 py-2 text-[15px] text-muted" style={{ gridTemplateColumns: template }}>
          <span />
          <button onClick={() => onSort("task")} className="flex items-center gap-1 text-left hover:text-foreground">Name <Arrow col="task" /></button>
          {showClient && <span>Client</span>}
          {cols.map((c) => c.sortable
            ? <button key={c.key} onClick={() => onSort(c.key)} className="flex items-center gap-1 text-left hover:text-foreground">{c.label} <Arrow col={c.key} /></button>
            : <span key={c.key}>{c.label}</span>)}
        </div>
        {groups.map((g) => (
          <div key={g.key} className="border-b last:border-0">
            <button onClick={() => toggleG(g.key)} className="flex w-full items-center gap-2 px-4 pb-1.5 pt-4 text-left">
              <I.chevron className={`text-muted transition ${collapsedG.has(g.key) ? "rotate-180" : "-rotate-90"}`} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
              <span className="text-[15px] font-bold">{g.label}</span>
              <span className="rounded-full bg-background px-1.5 text-[15px] text-muted">{g.tasks.length}</span>
            </button>
            {!collapsedG.has(g.key) && (
              <div>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} template={template} cols={cols} showClient={showClient} clientById={clientById} projectById={projectById} contactById={contactById} onOpen={() => onOpen(t.id)} onPatch={onPatch}
                    expanded={expanded.has(t.id)} onToggleExpand={() => toggle(t.id)} onToggleSub={onToggleSub} onAddSub={onAddSub}
                    subDraft={subDraft[t.id] ?? ""} setSubDraft={(v) => setSubDraft((s) => ({ ...s, [t.id]: v }))} />
                ))}
                {canQuickAdd && (
                  <div className="flex items-center gap-2 border-t px-4 py-1.5">
                    <I.plus className="text-muted" />
                    <input value={draft[g.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [g.key]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { onQuickAdd(g.key, draft[g.key] ?? ""); setDraft((d) => ({ ...d, [g.key]: "" })); } }}
                      placeholder="Add task…" className="flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted" />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {groups.length === 0 && <div className="px-4 py-10 text-center text-[15px] text-muted">No tasks yet.</div>}
      </div>
      {!canQuickAdd && quickAddHint && <div className="mt-3 text-center text-[15px] text-muted">{quickAddHint}</div>}
    </div>
  );
}

function TaskRow({ task, template, cols, showClient, clientById, projectById, contactById, onOpen, onPatch, expanded, onToggleExpand, onToggleSub, onAddSub, subDraft, setSubDraft }: {
  task: Task; template: string; cols: { key: string; label: string; sortable: boolean }[]; showClient: boolean;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => { name: string } | null; onOpen: () => void; onPatch: (taskId: string, patch: Partial<Task>) => void;
  expanded: boolean; onToggleExpand: () => void; onToggleSub: (taskId: string, subId: string) => void; onAddSub: (taskId: string, title: string) => void;
  subDraft: string; setSubDraft: (v: string) => void;
}) {
  const client = clientById(task.clientId);
  const project = projectById(task.projectId);
  const overdue = isOverdue(task.due) && task.status !== "done";
  const doneSubs = task.subtasks.filter((x) => x.done).length;
  const crumb = project && project.name !== "Tasks" ? project.name : "";
  const cell = (key: string) => {
    if (key === "priority") return <InlinePriority value={task.priority} onChange={(p) => onPatch(task.id, { priority: p })} />;
    if (key === "assignee") return <InlineAssignee value={task.assigneeId} onChange={(a) => onPatch(task.id, { assigneeId: a })} />;
    if (key === "due") return <InlineDue value={task.due} overdue={overdue} recurrence={task.recurrence} onChange={(d) => onPatch(task.id, { due: d })} onRecurrenceChange={(r) => onPatch(task.id, { recurrence: r })} />;
    if (key === "comments") return task.comments.length ? <span className="inline-flex items-center gap-1 text-[15px] text-muted"><I.comment /> {task.comments.length}</span> : <I.comment className="text-muted opacity-30" />;
    if (key === "contact") { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return <span className="truncate text-[15px] text-muted">{ct?.name ?? "—"}</span>; }
    if (key === "labels") return <LabelChips ids={task.labelIds} />;
    return null;
  };
  return (
    <>
      <div className="group/tr grid min-h-[46px] items-center gap-2 border-b px-4 py-2 transition-colors last:border-0 hover:bg-accent-soft/50" style={{ gridTemplateColumns: template }}>
        <div className="flex items-center">
          <button onClick={onToggleExpand} className={`rounded p-0.5 text-muted hover:text-foreground ${task.subtasks.length ? "" : "opacity-0 group-hover/tr:opacity-40"}`} title="Subtasks"><I.chevron className={`transition ${expanded ? "-rotate-90" : "rotate-180"}`} /></button>
          <InlineAssignee value={task.assigneeId} onChange={(a) => onPatch(task.id, { assigneeId: a })} />
        </div>
        <button onClick={onOpen} className="flex min-w-0 flex-col justify-center py-0.5 text-left">
          {crumb && <span className="truncate text-[13px] leading-tight text-muted">{crumb}</span>}
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[17px] font-medium leading-snug">{task.title}</span>
            {task.recurrence !== "none" && <I.repeat className="shrink-0 text-muted" />}
            {task.attachments.length > 0 && <I.clip className="shrink-0 text-muted" />}
            {task.subtasks.length > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[15px] text-muted"><I.check />{doneSubs}/{task.subtasks.length}</span>}
          </span>
        </button>
        {showClient && <span className="flex min-w-0 items-center gap-1.5 text-[15px]"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: client?.color }} /><span className="truncate">{client?.name}</span></span>}
        {cols.map((c) => <div key={c.key} className="min-w-0">{cell(c.key)}</div>)}
      </div>
      {expanded && (
        <div className="border-b bg-background/40 py-1.5 pl-10 pr-3">
          {task.subtasks.map((st) => (
            <label key={st.id} className="flex cursor-pointer items-center gap-2 py-0.5">
              <button onClick={() => onToggleSub(task.id, st.id)} className={`flex h-4 w-4 items-center justify-center rounded border ${st.done ? "border-accent bg-accent text-white" : "border-border"}`}>{st.done && <I.check />}</button>
              <span className={`text-[15px] ${st.done ? "text-muted line-through" : ""}`}>{st.title}</span>
            </label>
          ))}
          <div className="flex items-center gap-2 py-0.5">
            <span className="h-4 w-4 shrink-0" />
            <input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAddSub(task.id, subDraft); setSubDraft(""); } }} placeholder="Add subtask…" className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
          </div>
        </div>
      )}
    </>
  );
}

// --- inline cell editors ----------------------------------------------------

function InlinePriority({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[15px] font-medium hover:bg-background" style={{ color: value === "none" ? "var(--muted)" : PRIORITY_META[value].color }}>
        {value === "none" ? "—" : (<><I.flag />{PRIORITY_META[value].label}</>)}
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div className="absolute left-0 z-40 mt-1 w-32 rounded-lg border bg-surface p-1 shadow-lg">
          {PRIORITY_ORDER.map((p) => (
            <button key={p} onClick={(e) => { e.stopPropagation(); onChange(p); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[15px] hover:bg-background" style={{ color: p === "none" ? "var(--muted)" : PRIORITY_META[p].color }}>
              {p !== "none" && <I.flag />} {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}

function InlineAssignee({ value, onChange }: { value: string | null; onChange: (a: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="rounded-full hover:opacity-80"><Avatar id={value} size={22} /></button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div className="absolute left-0 z-40 mt-1 w-44 rounded-lg border bg-surface p-1 shadow-xl">
          <button onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[15px] text-muted hover:bg-background">Unassigned</button>
          {users.map((u) => (
            <button key={u.id} onClick={(e) => { e.stopPropagation(); onChange(u.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[15px] hover:bg-background"><Avatar id={u.id} size={20} /> {u.name}</button>
          ))}
        </div>
      </>)}
    </div>
  );
}

const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDaysIso = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
const dowIso = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function friendlyDue(iso: string): string {
  if (iso === TODAY) return "Today";
  if (iso === addDaysIso(TODAY, 1)) return "Tomorrow";
  if (iso === addDaysIso(TODAY, -1)) return "Yesterday";
  for (let i = 2; i <= 6; i++) if (iso === addDaysIso(TODAY, i)) return WD_SHORT[dowIso(iso)];
  return formatDue(iso);
}

// Small ClickUp-style status circle that opens a status menu.
function InlineStatus({ value, onChange }: { value: TaskStatus; onChange: (s: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  const m = STATUS_META[value];
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} title={m.label} className="flex h-5 w-5 items-center justify-center">
        {value === "done"
          ? <span className="flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ background: m.dot }}><I.check /></span>
          : <span className="h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: m.dot }} />}
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
        <div className="absolute left-0 z-40 mt-1 w-36 rounded-lg border bg-surface p-1 shadow-lg">
          {STATUS_ORDER.map((s) => { const mm = STATUS_META[s]; return (
            <button key={s} onClick={(e) => { e.stopPropagation(); onChange(s); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[15px] hover:bg-background">
              <span className="h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: mm.dot, background: s === "done" ? mm.dot : "transparent" }} /> {mm.label}
            </button>
          ); })}
        </div>
      </>)}
    </div>
  );
}

function InlineDue({ value, overdue, recurrence, onChange, onRecurrenceChange }: { value: string | null; overdue: boolean; recurrence: Recurrence; onChange: (d: string | null) => void; onRecurrenceChange: (r: Recurrence) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const openIt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, Math.min(r.right - 440, window.innerWidth - 448));
      const top = r.bottom + 300 > window.innerHeight ? r.top - 304 : r.bottom + 4;
      setPos({ top, left });
    }
    setOpen(true);
  };
  return (
    <>
      <button ref={ref} onClick={openIt} className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[15px] hover:bg-background ${overdue ? "font-medium text-red-500" : "text-muted"}`}>
        {value ? friendlyDue(value) : "—"}{recurrence !== "none" && <I.repeat className="text-accent" />}
      </button>
      {open && <DatePopover pos={pos} value={value} recurrence={recurrence} onSelect={(d) => { onChange(d); setOpen(false); }} onRecurrenceChange={onRecurrenceChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function DatePopover({ pos, value, recurrence, onSelect, onRecurrenceChange, onClose }: { pos: { top: number; left: number }; value: string | null; recurrence: Recurrence; onSelect: (d: string | null) => void; onRecurrenceChange: (r: Recurrence) => void; onClose: () => void }) {
  const [ym, setYm] = useState(() => { const [y, m] = (value ?? TODAY).split("-").map(Number); return { y, m: m - 1 }; });
  const dow = dowIso(TODAY);
  const quicks: [string, string][] = [
    ["Today", TODAY],
    ["Tomorrow", addDaysIso(TODAY, 1)],
    ["This weekend", addDaysIso(TODAY, (6 - dow + 7) % 7 || 6)],
    ["Next week", addDaysIso(TODAY, (1 - dow + 7) % 7 || 7)],
    ["In 2 weeks", addDaysIso(TODAY, 14)],
  ];
  const firstDow = new Date(Date.UTC(ym.y, ym.m, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const shift = (n: number) => setYm((s) => { const dt = new Date(Date.UTC(s.y, s.m + n, 1)); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() }; });
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: pos.top, left: pos.left, width: 440 }} className="z-50 flex rounded-xl border bg-surface shadow-xl">
        <div className="w-52 shrink-0 border-r p-1.5">
          {quicks.map(([label, iso]) => (
            <button key={label} onClick={() => onSelect(iso)} className="flex w-full items-center justify-between gap-3 whitespace-nowrap rounded px-2 py-1.5 text-left text-[15px] hover:bg-background"><span>{label}</span><span className="text-[15px] text-muted">{formatDue(iso)}</span></button>
          ))}
          <button onClick={() => onSelect(null)} className="mt-0.5 w-full rounded px-2 py-1.5 text-left text-[15px] text-red-500 hover:bg-background">No date</button>
          <div className="mt-1 border-t pt-1.5">
            <div className="px-2 pb-1 text-[15px] font-semibold uppercase tracking-wide text-muted">Repeat</div>
            <select value={recurrence} onClick={(e) => e.stopPropagation()} onChange={(e) => onRecurrenceChange(e.target.value as Recurrence)} className="w-full rounded border bg-background px-1.5 py-1 text-[15px] outline-none">
              <option value="none">Doesn&apos;t repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
        <div className="flex-1 p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[15px] font-semibold">{MO[ym.m]} {ym.y}</span>
            <span className="flex gap-0.5"><button onClick={() => shift(-1)} className="rounded px-1 text-muted hover:bg-background">‹</button><button onClick={() => shift(1)} className="rounded px-1 text-muted hover:bg-background">›</button></span>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[15px] text-muted">{WD.map((w) => <span key={w} className="py-0.5">{w}</span>)}</div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d === null) return <span key={i} />;
              const iso = isoOf(ym.y, ym.m, d); const sel = iso === value; const today = iso === TODAY;
              return <button key={i} onClick={() => onSelect(iso)} className={`rounded py-1 text-[15px] ${sel ? "bg-accent text-white" : today ? "font-semibold text-accent hover:bg-background" : "hover:bg-background"}`}>{d}</button>;
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function AddTask({ projectId, clientId, composing, draft, setDraft, onStart, onCancel, onAdd }: {
  projectId: string; clientId: string; composing: boolean; draft: string; setDraft: (v: string) => void; onStart: () => void; onCancel: () => void; onAdd: (projectId: string, clientId: string, title: string) => void;
}) {
  if (!composing) return (<button onClick={onStart} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[15px] text-muted hover:bg-surface"><I.plus /> Add task</button>);
  return (
    <div className="rounded-xl border bg-surface p-2">
      <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAdd(projectId, clientId, draft); } if (e.key === "Escape") onCancel(); }} placeholder="Task name…" rows={2} className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-muted" />
      <div className="mt-1 flex gap-2"><button onClick={() => onAdd(projectId, clientId, draft)} className="rounded-md bg-accent px-2.5 py-1 text-[15px] font-medium text-white">Add task</button><button onClick={onCancel} className="rounded-md px-2 py-1 text-[15px] text-muted hover:bg-background">Cancel</button></div>
    </div>
  );
}

function TaskDrawer({ task, comment, setComment, clientById, projectById, contactById, contactsForClient, full, onToggleFull, navIndex, navTotal, onPrev, onNext, onClose, onPatch, onDelete, onAddComment, onAddFiles, onDownloadFile, onRemoveFile, onPushGhl, ghlBusy, ghlLinkable, onUnlinkGhl, clientProjects, onSetProject, onNewProject, onToggleSub, onAddSub, onRenameSub, onToggleLabel }: {
  task: Task; comment: string; setComment: (v: string) => void;
  clientById: (id: string) => Client | null; projectById: (id: string) => Project | null; contactById: (id: string | null) => Contact | null; contactsForClient: (clientId: string) => Contact[];
  full: boolean; onToggleFull: () => void; navIndex: number; navTotal: number; onPrev: () => void; onNext: () => void;
  onClose: () => void; onPatch: (patch: Partial<Task>) => void; onDelete: () => void; onAddComment: () => void; onAddFiles: (files: FileList) => void; onDownloadFile: (path: string) => void; onRemoveFile: (att: Attachment) => void; onPushGhl: () => void; ghlBusy: boolean; ghlLinkable: boolean; onUnlinkGhl: () => void; clientProjects: Project[]; onSetProject: (pid: string) => void; onNewProject: () => void; onToggleSub: (sid: string) => void; onAddSub: (title: string) => void; onRenameSub: (sid: string, title: string) => void; onToggleLabel: (lid: string) => void;
}) {
  const client = clientById(task.clientId)!;
  const project = projectById(task.projectId)!;
  const linkedContact = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId);
  const ghlSub = linkedContact ? clientById(linkedContact.clientId) : null;
  const ghlContactUrl = linkedContact && ghlSub?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${ghlSub.ghlLocationId}/contacts/detail/${linkedContact.ghlContactId}` : null;
  const [subDraft, setSubDraft] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const doneSubs = task.subtasks.filter((s) => s.done).length;
  const mentionMatch = /@([\w]*)$/.exec(comment);
  const mentionCands = mentionMatch ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[1].toLowerCase())) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const titleBlock = (
    <textarea value={task.title} onChange={(e) => onPatch({ title: e.target.value })} rows={1} className={`w-full resize-none bg-transparent font-semibold leading-snug outline-none [field-sizing:content] focus:rounded-md focus:bg-background focus:px-1 ${full ? "text-[24px]" : "text-[18px]"}`} />
  );
  const statusBlock = (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {STATUS_ORDER.map((s) => { const m = STATUS_META[s]; const on = task.status === s; return (<button key={s} onClick={() => onPatch({ status: s })} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[15px] font-medium transition ${on ? "text-white" : "text-muted hover:bg-background"}`} style={on ? { background: m.dot, borderColor: m.dot } : {}}><span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "#fff" : m.dot }} /> {m.label}</button>); })}
    </div>
  );
  const propsBlock = (
    <dl className="space-y-3">
      <Row label="Priority"><select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value as Priority })} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none" style={{ color: PRIORITY_META[task.priority].color }}>{PRIORITY_ORDER.map((p) => (<option key={p} value={p}>{PRIORITY_META[p].label}</option>))}</select></Row>
      <Row label="Assignee"><select value={task.assigneeId ?? ""} onChange={(e) => onPatch({ assigneeId: e.target.value || null })} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none"><option value="">Unassigned</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.name} {u.role === "va" ? "(VA)" : "(Admin)"}</option>))}</select></Row>
      <Row label="Project"><select value={task.projectId} onChange={(e) => { if (e.target.value === "__new") onNewProject(); else onSetProject(e.target.value); }} className="max-w-[200px] rounded-md border bg-background px-2 py-1 text-[15px] outline-none">{clientProjects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}{clientProjects.every((p) => p.id !== task.projectId) && <option value={task.projectId}>{project?.name ?? "—"}</option>}<option value="__new">+ New project…</option></select></Row>
      <Row label="Contact">{(() => { const ct = contactById(task.clientId.startsWith("cl_") ? task.clientId.slice(3) : task.contactId); return ct ? (<span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-[15px]"><I.user /> {ct.name}</span>) : <span className="text-[15px] text-muted">—</span>; })()}</Row>
      <Row label="Due date"><input type="date" value={task.due ?? ""} onChange={(e) => onPatch({ due: e.target.value || null })} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none" /></Row>
      <Row label="Repeat"><select value={task.recurrence} onChange={(e) => onPatch({ recurrence: e.target.value as Recurrence })} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none">{(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (<option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>))}</select></Row>
      <Row label="Labels">
        <div className="flex flex-wrap items-center gap-1.5">
          {task.labelIds.map((id) => { const l = labelById(id); return l ? (<button key={id} onClick={() => onToggleLabel(id)} className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[15px] font-medium" style={{ background: l.color + "1a", color: l.color }}>{l.name} <span className="opacity-50 group-hover:opacity-100">×</span></button>) : null; })}
          <div className="relative">
            <button onClick={() => setLabelOpen((o) => !o)} className="inline-flex items-center gap-0.5 rounded border border-dashed px-1.5 py-0.5 text-[15px] text-muted hover:bg-background"><I.plus /> Label</button>
            {labelOpen && (<div className="absolute z-30 mt-1 w-40 rounded-lg border bg-surface p-1 shadow-lg">{labels.map((l) => { const on = task.labelIds.includes(l.id); return (<button key={l.id} onClick={() => onToggleLabel(l.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[15px] hover:bg-background"><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} /> {l.name}{on && <I.check className="ml-auto text-accent" />}</button>); })}</div>)}
          </div>
        </div>
      </Row>
      <Row label="GoHighLevel">{task.ghlTaskId ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-2 py-1 text-[15px] font-medium text-green-600"><I.bolt /> Synced — changes push automatically</span>
          {ghlContactUrl && <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" className="text-[15px] font-medium text-accent hover:underline">Open contact ↗</a>}
          <button onClick={onUnlinkGhl} className="text-[15px] text-muted hover:text-red-500">Unlink</button>
        </span>
      ) : ghlLinkable ? (
        <button onClick={onPushGhl} disabled={ghlBusy} className="inline-flex items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-[15px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50"><I.bolt /> {ghlBusy ? "Pushing…" : "Push to GHL"}</button>
      ) : (
        <span className="text-[15px] text-muted">Not linkable — this client has no GHL contact/location.</span>
      )}</Row>
    </dl>
  );
  const descriptionBlock = (
    <div className="mt-5"><div className="mb-1.5 text-[15px] font-semibold uppercase tracking-wide text-muted">Description</div><textarea value={task.description} onChange={(e) => onPatch({ description: e.target.value })} placeholder="Add a description…" rows={3} className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" /></div>
  );
  const subtasksBlock = (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between"><span className="text-[15px] font-semibold uppercase tracking-wide text-muted">Subtasks {task.subtasks.length > 0 && `· ${doneSubs}/${task.subtasks.length}`}</span></div>
      {task.subtasks.length > 0 && (<div className="mb-2 h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneSubs / task.subtasks.length) * 100}%` }} /></div>)}
      <div className="space-y-1">{task.subtasks.map((s) => (<div key={s.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-background"><button onClick={() => onToggleSub(s.id)} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${s.done ? "border-accent bg-accent text-white" : "border-border"}`}>{s.done && <I.check />}</button><input value={s.title} onChange={(e) => onRenameSub(s.id, e.target.value)} className={`flex-1 bg-transparent text-[15px] outline-none focus:rounded focus:bg-background focus:px-1 ${s.done ? "text-muted line-through" : ""}`} /></div>))}</div>
      <div className="mt-1.5"><input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAddSub(subDraft); setSubDraft(""); } }} placeholder="Add a subtask…" className="w-full rounded-md border bg-background px-2 py-1 text-[15px] outline-none placeholder:text-muted focus:border-accent" /></div>
    </div>
  );
  const attachmentsBlock = (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between"><span className="text-[15px] font-semibold uppercase tracking-wide text-muted">Attachments · {task.attachments.length}</span><button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-[15px] font-medium text-accent"><I.plus /> Attach</button></div>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ""; }} />
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) onAddFiles(e.dataTransfer.files); }} className="space-y-1.5">
        {task.attachments.length === 0 && (<div className="rounded-lg border border-dashed px-3 py-4 text-center text-[15px] text-muted">Drop files here or click Attach</div>)}
        {task.attachments.map((a) => (
          <div key={a.id} className="group/att flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <span className="text-[16px]">{attachIcon[a.kind]}</span>
            {a.path ? (
              <button onClick={() => onDownloadFile(a.path!)} className="truncate text-left text-[15px] text-accent hover:underline" title="Download">{a.name}</button>
            ) : (
              <span className="truncate text-[15px]" title="Not stored — re-upload once the storage bucket exists">{a.name}</span>
            )}
            <span className="ml-auto text-[15px] text-muted">{a.size}</span>
            <button onClick={() => onRemoveFile(a)} title="Remove" className="text-muted opacity-0 hover:text-red-500 group-hover/att:opacity-100"><I.trash /></button>
          </div>
        ))}
      </div>
    </div>
  );
  const commentsBlock = (
    <div className="mt-6">
      <div className="mb-2 text-[15px] font-semibold uppercase tracking-wide text-muted">Comments · {task.comments.length}</div>
      <div className="space-y-3">{task.comments.map((c) => { const u = userById(c.authorId); return (<div key={c.id} className="flex gap-2.5"><Avatar id={c.authorId} size={28} /><div className="min-w-0"><div className="text-[15px]"><span className="font-medium">{u?.name}</span> <span className="text-muted">· {c.at}</span></div><div className="text-[15px]">{renderMentions(c.body)}</div></div></div>); })}{task.comments.length === 0 && (<div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-7 text-center text-muted"><I.comment /><span className="text-[15px]">No comments yet</span><span className="text-[13px]">Start the thread — type @ to mention a teammate.</span></div>)}</div>
    </div>
  );
  const composer = (
    <div className={`relative border-t p-3 ${full ? "mx-auto w-full max-w-3xl" : ""}`}>
      {mentionMatch && mentionCands.length > 0 && (<div className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-lg border bg-surface shadow-lg">{mentionCands.map((u) => (<button key={u.id} onClick={() => setComment(comment.replace(/@([\w]*)$/, `@${u.name} `))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[15px] hover:bg-background"><Avatar id={u.id} size={22} /> {u.name}{u.role === "va" && <span className="text-[15px] text-muted">VA</span>}</button>))}</div>)}
      <div className="flex items-end gap-2 rounded-xl border bg-background px-2.5 py-2 focus-within:border-accent">
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(mentionMatch && mentionCands.length)) { e.preventDefault(); onAddComment(); } }} placeholder="Write a comment…  (type @ to mention)" rows={1} className="max-h-24 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-muted" />
        <button onClick={onAddComment} disabled={!comment.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Send</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-10 bg-black/20" onClick={onClose} />
      <aside className={full ? "fixed inset-0 z-20 flex flex-col bg-surface" : "fixed inset-y-0 right-0 z-20 flex w-full max-w-[460px] flex-col border-l bg-surface shadow-xl"}>
        <div className="flex items-center gap-2 border-b px-5 py-3 text-[15px] text-muted">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: client.color }} /> {client.name} <span>/</span> <span className="truncate">{project.name}</span>
          <div className="ml-auto flex items-center gap-1">
            {navTotal > 1 && (
              <div className="mr-1 flex items-center gap-0.5">
                <button onClick={onPrev} disabled={navIndex <= 0} title="Previous task (k)" className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground disabled:opacity-30"><I.chevron className="rotate-90" /></button>
                <span className="min-w-[54px] text-center text-[13px] tabular-nums text-muted">{navIndex + 1} of {navTotal}</span>
                <button onClick={onNext} disabled={navIndex < 0 || navIndex >= navTotal - 1} title="Next task (j)" className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground disabled:opacity-30"><I.chevron className="-rotate-90" /></button>
              </div>
            )}
            {ghlContactUrl && <a href={ghlContactUrl} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="inline-flex items-center gap-1 rounded-md border border-accent px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft"><I.bolt /> Open in GHL</a>}
            <button onClick={onToggleFull} title={full ? "Collapse to sidebar" : "Expand to full page"} className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground">{full ? <I.minimize /> : <I.expand />}</button>
            <button onClick={onDelete} title="Delete task" className="rounded-md p-1 text-muted hover:bg-background hover:text-red-500"><I.trash /></button>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
          </div>
        </div>

        {full ? (
          <div className="flex flex-1 overflow-hidden bg-background/60">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-7">
                <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-surface p-8 shadow-soft">
                  {titleBlock}
                  {statusBlock}
                  <div className="my-6 border-t" />
                  {descriptionBlock}
                  {subtasksBlock}
                  {attachmentsBlock}
                  <div className="mt-7 border-t pt-1" />
                  {commentsBlock}
                </div>
              </div>
              {composer}
            </div>
            <div className="w-[340px] shrink-0 overflow-y-auto border-l bg-surface px-6 py-6">
              <div className="mb-5 flex items-center gap-3 rounded-xl border bg-background/50 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold text-white" style={{ background: client.color }}>{client.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                <div className="min-w-0"><div className="truncate text-[15px] font-semibold">{client.name}</div><div className="truncate text-[13px] text-muted">{project.name}</div></div>
              </div>
              <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">Details</div>
              {propsBlock}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {titleBlock}
              {statusBlock}
              <div className="mt-5">{propsBlock}</div>
              {descriptionBlock}
              {subtasksBlock}
              {attachmentsBlock}
              {commentsBlock}
            </div>
            {composer}
          </>
        )}
      </aside>
    </>
  );
}

function renderMentions(body: string) {
  const parts = body.split(/(@[A-Za-z]+ [A-Za-z]+)/g);
  return parts.map((p, i) => { const isMention = users.some((u) => "@" + u.name === p); return isMention ? (<span key={i} className="rounded bg-accent-soft px-1 font-medium text-accent">{p}</span>) : <span key={i}>{p}</span>; });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="flex items-center gap-3"><dt className="w-24 shrink-0 text-[15px] text-muted">{label}</dt><dd className="min-w-0 flex-1">{children}</dd></div>);
}

// Searchable contact picker — handles thousands of synced GHL contacts.
function ContactPicker({ contacts, value, onChange }: { contacts: Contact[]; value: string | null; onChange: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selected = contacts.find((c) => c.id === value) ?? null;
  const ql = q.trim().toLowerCase();
  const list = (ql ? contacts.filter((c) => c.name.toLowerCase().includes(ql) || (c.email ?? "").toLowerCase().includes(ql)) : contacts).slice(0, 50);
  return (
    <div className="relative w-full">
      {open && <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setQ(""); }} />}
      <div className="relative z-30 flex items-center gap-1">
        <input
          value={open ? q : selected?.name ?? ""}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setQ(""); }}
          placeholder={contacts.length ? "Search contacts…" : "No contacts synced yet"}
          className="w-full rounded-md border bg-background px-2 py-1 text-[15px] outline-none focus:border-accent"
        />
        {value && !open && <button onClick={() => onChange(null)} title="Clear" className="rounded p-1 text-muted hover:text-red-500"><I.close /></button>}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-56 w-72 overflow-y-auto rounded-lg border bg-surface shadow-lg">
          <button onClick={() => { onChange(null); setOpen(false); setQ(""); }} className="flex w-full items-center px-3 py-1.5 text-left text-[15px] text-muted hover:bg-background">No contact</button>
          {list.map((c) => (
            <button key={c.id} onClick={() => { onChange(c.id); setOpen(false); setQ(""); }} className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-background">
              <span className="text-[15px]">{c.name}</span>
              {c.email && <span className="text-[15px] text-muted">{c.email}</span>}
            </button>
          ))}
          {!ql && contacts.length > 50 && <div className="px-3 py-1.5 text-[15px] text-muted">Showing 50 of {contacts.length.toLocaleString()} — type to search</div>}
          {ql && list.length === 0 && <div className="px-3 py-2 text-[15px] text-muted">No matches</div>}
        </div>
      )}
    </div>
  );
}
