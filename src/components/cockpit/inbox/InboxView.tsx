"use client";

// The Inbox (Derek, 2026-10-01): every email, text, social message, call and
// task chat in one place, so nobody has to check Gmail and two GoHighLevel
// logins. Laid out like Pipedrive's Sales Inbox, which Derek sent as the
// model: a folder list on the left, two line rows, and an open conversation
// that replaces the list, with the task it belongs to on the right.
// Mockup he picked: https://claude.ai/artifact/HQwjkE4nCCx4QqFWcPLFQX
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HIDDEN_STATUSES, STATUS_META, STATUS_ORDER, splitQuotedEmail, tidyEmailText, type Attachment, type Message, type Task, type TaskStatus } from "@/lib/data";
import { authedFetch, supabase } from "@/lib/supabase";
import { createPortal } from "react-dom";
import SignaturePanel from "../../SignaturePanel";
import {
  CHANNEL_ICON, CHANNEL_LABEL, CHAT_PAGE, chatItems, bodyParts, isLinkHeavy, dayGroup, dayLabel, inFolder, matchesSearch, shortTime, snoozeUntil, whereIs,
  type ChatItem, type Folder, type InboxThread,
} from "./inboxModel";
import type { useInbox } from "./useInbox";
import { draftKeys, readDraft, writeDraft, type InboxPrefs } from "./inboxPrefs";

type Inbox = ReturnType<typeof useInbox>;
type Member = { id: string; name: string };

export type InboxViewProps = {
  inbox: Inbox;
  me: { id: string; name: string; email?: string | null };
  team: Member[];
  prefs: InboxPrefs;
  setPrefs: (p: Partial<InboxPrefs>) => void;
  clientName: (id: string | null) => string | null;
  tasks: Task[];
  /** from: what the task panel's "← back" says (the conversation). */
  onOpenTask: (taskId: string, from?: string) => void;
  /** Makes a task for a conversation and returns its id. */
  onNewTask: (t: InboxThread) => Promise<string | null>;
  /** Uploads a file the person attached; returns where it went. */
  onUpload: (prefix: string, file: File) => Promise<Attachment | null>;
  onSignedUrl: (path: string) => Promise<string | null>;
  /** Portal chat replies go through the app's own path. */
  onSendChat: (t: InboxThread, body: string) => Promise<void>;
  /** Send later, for a client's conversation (the app's scheduled sends). */
  onSchedule: ((t: InboxThread, body: string, at: Date) => Promise<void>) | null;
  pushToast: (text: string, action?: { label: string; run: () => void }) => void;
  /** For Add to a client and a new text. */
  clients: { id: string; name: string }[];
  canAdmin: boolean;
  /** Everyone in GoHighLevel, for New message. */
  contacts: { id: string; name: string; email?: string | null; phone?: string | null; company?: string | null }[];
  /** The side panel's live task card: status, Mark done. */
  onPatchTask: (taskId: string, patch: Partial<Task>) => void;
  /** 📌 Add to task: an email onto the linked task as a comment. */
  onAddComment: (taskId: string, body: string) => void;
  onOpenClient: (clientId: string) => void;
  /** The person in GoHighLevel, when they are a contact there. */
  ghlUrlFor: (contactId: string) => string | null;
};

const FOLDERS: { id: Folder; label: string; icon: string }[] = [
  { id: "inbox", label: "Inbox", icon: "📥" }, { id: "starred", label: "Starred", icon: "⭐" }, { id: "drafts", label: "Drafts", icon: "📝" },
  { id: "snoozed", label: "Snoozed", icon: "⏰" }, { id: "sent", label: "Sent", icon: "📤" }, { id: "done", label: "Archive", icon: "🗄" },
  { id: "trash", label: "Trash", icon: "🗑" },
];
const FILTERS: { id: Folder; label: string; icon: string }[] = [
  { id: "email", label: "Email", icon: "✉️" }, { id: "sms", label: "Texts", icon: "💬" },
  { id: "social", label: "Social", icon: "👥" }, { id: "call", label: "Calls", icon: "📞" }, { id: "chat", label: "Task chats", icon: "🗂️" },
];
const AVATAR = ["#1b3a5c", "#0f766e", "#b45309", "#7c3aed", "#be185d", "#2563eb", "#4d7c0f"];
const initials = (name: string) => (name.includes("@") || /^\+?\d/.test(name) ? name.replace(/^\+/, "")[0] ?? "?" : name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")).toUpperCase();
const avatarColor = (name: string) => AVATAR[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
const isEmailThread = (t: InboxThread) => t.channel === "email";
// Browsers only show the permission prompt for a click, so it is asked from
// one: turning alerts on, or the first click in the Inbox.
export const askAlertPermission = () => {
  try { if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); } catch { /* not supported */ }
};
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export default function InboxView(p: InboxViewProps) {
  const { inbox, prefs } = p;
  const [folder, setFolder] = useState<Folder | "settings">("inbox");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composeNew, setComposeNew] = useState<false | { to?: string; body?: string }>(false);
  const [drafts, setDrafts] = useState<Set<string>>(() => draftKeys(p.me.id));
  // A search also looks past the 30 days loaded, once you stop typing.
  const searchOlder = inbox.searchOlder;
  const [searchingOlder, setSearchingOlder] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) return;
    const id = setTimeout(async () => { setSearchingOlder(true); await searchOlder(q); setSearchingOlder(false); }, 450);
    return () => clearTimeout(id);
  }, [q, searchOlder]);
  const refreshDrafts = useCallback(() => setDrafts(draftKeys(p.me.id)), [p.me.id]);

  const visible = useMemo(() => {
    if (folder === "settings") return [];
    if (q.trim()) return inbox.threads.filter((t) => matchesSearch(t, q, p.clientName(t.clientId)));
    return inbox.threads.filter((t) => inFolder(t, folder, (k) => drafts.has(k)) && (!p.prefs.unreadOnly || t.unread));
  }, [inbox.threads, folder, q, drafts, p.clientName, p.prefs.unreadOnly]); // eslint-disable-line react-hooks/exhaustive-deps -- only these props matter here
  const open = openKey ? inbox.threads.find((t) => t.key === openKey) ?? null : null;

  const count = (f: Folder) => f === "drafts" ? drafts.size : inbox.threads.filter((t) => t.unread && inFolder(t, f, () => false)).length;

  const undoToast = (text: string, undo: () => Promise<void> | void) => p.pushToast(text, { label: "Undo", run: () => { undo(); } });
  const done = async (keys: string[]) => {
    const undo = await inbox.markDone(keys);
    undoToast(keys.length > 1 ? `${keys.length} archived` : "Archived", undo);
  };
  // Delete: to the Trash here, and to Gmail's Trash for an email.
  const del = async (keys: string[], restore = false) => {
    const { undo, gmailNote } = await inbox.trash(keys, restore);
    const what = keys.length > 1 ? `${keys.length} conversations` : "Conversation";
    undoToast(restore ? `${what} restored` : `${what} moved to Trash${gmailNote ? ` (Gmail: ${gmailNote})` : ""}`, undo);
  };
  const openThread = (t: InboxThread) => {
    setOpenKey(t.key); setCursor(t.key); setComposeNew(false);
    if (t.unread) inbox.markRead([t.key]);
  };
  const step = (d: 1 | -1) => {
    if (!visible.length) return;
    const cur = openKey ?? cursor;
    const i = visible.findIndex((t) => t.key === cur);
    const n = visible[Math.min(visible.length - 1, Math.max(0, i < 0 ? 0 : i + d))];
    if (openKey) openThread(n); else setCursor(n.key);
  };
  const back = () => { if (openKey) setCursor(openKey); setOpenKey(null); setComposeNew(false); };

  // Left hand keys, as in Gmail: J next, K previous, E archive, R read, S snooze, T link, F star.
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const linkSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || folder === "settings") return;
      // A task open over the Inbox has the keys; Escape closes it, not this.
      if (document.querySelector(".inbox-slide")) return;
      const k = e.key.toLowerCase();
      if (k === "j") { e.preventDefault(); step(1); }
      else if (k === "k") { e.preventDefault(); step(-1); }
      else if ((k === " " || k === "enter") && !openKey && cursor) { e.preventDefault(); const t = visible.find((x) => x.key === cursor); if (t) openThread(t); }
      else if (k === "escape" && openKey) back();
      else if (k === "e" && (open || cursor)) { e.preventDefault(); const key = open?.key ?? cursor!; if (open) back(); done([key]); }
      else if (k === "d" && (open || cursor)) { e.preventDefault(); const key = open?.key ?? cursor!; if (open) back(); del([key]); }
      else if (k === "r" && open) { e.preventDefault(); if (open.unread) inbox.markRead([open.key]); else inbox.markUnread([open.key]); }
      else if (k === "s" && open) { e.preventDefault(); setSnoozeOpen(true); }
      else if (k === "t" && open) { e.preventDefault(); linkSearchRef.current?.focus(); }
      else if (k === "f" && (open || cursor)) { e.preventDefault(); const t = open ?? visible.find((x) => x.key === cursor); if (t) inbox.star([t.key], !t.starred); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div onClickCapture={prefs.popup ? askAlertPermission : undefined} className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden text-[16px]">
      {/* Folders */}
      <nav className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-background/40 p-3 md:flex">
        <button onClick={() => { setComposeNew({}); setOpenKey(null); setFolder("inbox"); }} className="mb-3 h-11 rounded-lg bg-accent font-semibold text-white">＋ New message</button>
        {FOLDERS.map((f) => <FolderButton key={f.id} f={f} active={folder === f.id && !q} count={prefs.badge || f.id !== "inbox" ? count(f.id) : 0} onClick={() => { setFolder(f.id); setOpenKey(null); setQ(""); }} />)}
        <div className="mx-3 mb-1 mt-4 text-[13px] font-bold tracking-wide text-muted">SHOW ONLY</div>
        {FILTERS.map((f) => <FolderButton key={f.id} f={f} active={folder === f.id && !q} count={count(f.id)} onClick={() => { setFolder(f.id); setOpenKey(null); setQ(""); }} />)}
        <div className="mt-auto border-t pt-3">
          <FolderButton f={{ id: "inbox", label: "Settings", icon: "⚙️" }} active={folder === "settings"} count={0} onClick={() => { setFolder("settings"); setOpenKey(null); }} />
        </div>
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Phone: folders as a menu */}
        <div className="flex gap-2 border-b p-3 md:hidden">
          <button onClick={() => { setComposeNew({}); setOpenKey(null); }} className="h-11 shrink-0 rounded-lg bg-accent px-4 font-semibold text-white">＋ New</button>
          <select aria-label="Folder" value={folder} onChange={(e) => { setFolder(e.target.value as Folder | "settings"); setOpenKey(null); }} className="h-11 min-w-0 flex-1 rounded-lg border bg-surface px-3 font-semibold">
            {[...FOLDERS, ...FILTERS].map((f) => <option key={f.id} value={f.id}>{f.label}{count(f.id) ? ` (${count(f.id)})` : ""}</option>)}
            <option value="settings">Settings</option>
          </select>
        </div>

        {folder === "settings" ? <InboxSettings {...p} />
          : composeNew ? <NewMessage key={JSON.stringify(composeNew)} p={p} start={composeNew} onClose={() => setComposeNew(false)} />
          : open ? <ThreadView key={open.key} onOpenOther={(k) => { const x = inbox.threads.find((y) => y.key === k); if (x) openThread(x); }} emailInstead={(to, body) => { setOpenKey(null); setComposeNew({ to, body }); }} p={p} t={open} back={back} done={() => { back(); done([open.key]); }} del={() => { back(); del([open.key], open.trashed); }} snoozeOpen={snoozeOpen} setSnoozeOpen={setSnoozeOpen} linkSearchRef={linkSearchRef} onDraft={refreshDrafts} />
          : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                <input type="checkbox" aria-label="Select all" className="h-5 w-5" checked={selected.size > 0 && selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((t) => t.key)) : new Set())} />
                <button onClick={() => inbox.reload()} title="Refresh" className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">↻</button>
                {selected.size > 0 && <>
                  <button onClick={async () => { const undo = await inbox.markRead([...selected]); setSelected(new Set()); undoToast(`${selected.size} marked read`, undo); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">Mark read</button>
                  <button onClick={() => { done([...selected]); setSelected(new Set()); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">🗄 Archive</button>
                  <button onClick={() => { inbox.star([...selected], true); setSelected(new Set()); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">☆ Star</button>
                  <button onClick={() => { del([...selected], folder === "trash"); setSelected(new Set()); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">{folder === "trash" ? "Restore" : "🗑 Delete"}</button>
                </>}
                <button onClick={() => p.setPrefs({ unreadOnly: !p.prefs.unreadOnly })} aria-pressed={p.prefs.unreadOnly}
                  className={`h-10 rounded-lg border px-3 font-semibold ${p.prefs.unreadOnly ? "border-accent bg-accent-soft text-accent" : "hover:bg-background"}`}>{p.prefs.unreadOnly ? "● Unread only" : "Show: All"}</button>
                <span className="ml-auto text-muted">{q.trim() ? `${visible.length} result${visible.length === 1 ? "" : "s"}${searchingOlder ? ", searching older…" : ""}` : `${visible.length} conversation${visible.length === 1 ? "" : "s"}`}</span>
                <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpenKey(null); }} placeholder="Search people, words, files" aria-label="Search the Inbox"
                  className="h-10 w-full rounded-lg border bg-surface px-3 outline-none focus:border-accent sm:w-72" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {inbox.error && <div className="m-4 rounded-lg bg-danger-soft p-3 text-danger">{inbox.error}</div>}
                {!inbox.loading && !visible.length && (
                  <div className="px-6 py-16 text-center text-muted">
                    <div className="text-[21px] font-bold text-foreground">{folder === "inbox" && !q ? "All caught up" : folder === "trash" ? "Trash is empty" : "Nothing here"}</div>
                    {folder === "inbox" && !q && <div className="mt-1">{p.prefs.unreadOnly ? "Nothing unread." : "Every message is answered, snoozed or archived."}</div>}
                  </div>
                )}
                {visible.map((t, i) => {
                  const day = prefs.byDay && !q ? dayGroup(t.latest.at) : null;
                  const showDay = day && (i === 0 || dayGroup(visible[i - 1].latest.at) !== day);
                  return (
                    <div key={t.key}>
                      {showDay && <div className="border-b px-5 pb-2 pt-4 text-[14px] font-extrabold uppercase tracking-wider text-muted">{day}</div>}
                      <Row t={t} p={p} active={cursor === t.key} checked={selected.has(t.key)} draft={drafts.has(t.key)} where={q.trim() ? whereIs(t) : null}
                        onCheck={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(t.key); else n.delete(t.key); return n; })}
                        onOpen={() => openThread(t)} picking={selected.size > 0}
                        onArchive={() => done([t.key])} onDelete={() => del([t.key], t.trashed)}
                        onSnooze={async () => { const until = snoozeUntil("tomorrow"); const undo = await inbox.snooze([t.key], until); undoToast(`Snoozed until ${until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, undo); }} />
                    </div>
                  );
                })}
              </div>
              <div className="hidden gap-4 border-t bg-background/40 px-5 py-2 text-[14px] text-muted lg:flex">
                <span><Kbd>J</Kbd> Next</span><span><Kbd>K</Kbd> Previous</span><span><Kbd>Space</Kbd> Open</span><span><Kbd>E</Kbd> Archive</span><span><Kbd>F</Kbd> Star</span><span><Kbd>D</Kbd> Delete</span><span><Kbd>R</Kbd> Read</span><span><Kbd>S</Kbd> Snooze</span><span><Kbd>T</Kbd> Link task</span>
              </div>
            </>
          )}
      </section>
    </div>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="mr-1 inline-block min-w-6 rounded border border-b-2 bg-surface px-1.5 text-center font-sans text-[13px] text-foreground">{children}</kbd>;

function FolderButton({ f, active, count, onClick }: { f: { id?: string; label: string; icon: string }; active: boolean; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${active ? "bg-accent-soft font-bold text-accent" : "font-medium hover:bg-background"}`}>
      <span className="w-6 text-center">{f.icon}</span>{f.label}
      {count > 0 && <span className={`ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[14px] font-semibold ${active ? "bg-accent text-white" : "bg-border text-foreground"}`}>{count}</span>}
    </button>
  );
}

function Avatar({ t, size = 40 }: { t: InboxThread; size?: number }) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, background: avatarColor(t.peerName), fontSize: size > 34 ? 16 : 13 }} title={CHANNEL_LABEL[t.channel]}>
      {initials(t.peerName)}
      <span className="absolute -bottom-1 -right-1 grid h-[22px] w-[22px] place-items-center rounded-full bg-surface text-[12px] ring-2 ring-surface">{CHANNEL_ICON[t.channel]}</span>
    </span>
  );
}

// A row in the list (Derek, 2026-10-01, mockup
// https://claude.ai/artifact/3a7ZymR6ZLUL5bZPqf1sqU): two clean lines, unread
// as a blue dot and bold, the avatar turns into a checkbox on hover (or for
// every row once one is picked), and Archive, Snooze and Delete take the
// time's place on hover. The star shows on hover or once starred.
function Row({ t, p, active, checked, picking, draft, where, onCheck, onOpen, onArchive, onSnooze, onDelete }: {
  t: InboxThread; p: InboxViewProps; active: boolean; checked: boolean; picking: boolean; draft: boolean; where: string | null;
  onCheck: (v: boolean) => void; onOpen: () => void; onArchive: () => void; onSnooze: () => void; onDelete: () => void;
}) {
  // Words first: links in the preview are just noise.
  const preview = bodyParts(splitQuotedEmail(t.latest.body || "").visible || t.latest.body || "")
    .map((x) => ("text" in x ? x.text : "")).join(" ").replace(/\s+/g, " ").replace(/\[\s*\]/g, "").trim();
  const client = p.clientName(t.clientId);
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  const act = "grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-foreground hover:ring-1 hover:ring-[var(--border)]";
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div onClick={onOpen} className={`group relative grid cursor-pointer grid-cols-[40px_minmax(0,1fr)] items-center gap-3 border-b px-5 py-2.5 ${checked ? "bg-accent-soft" : active ? "bg-accent-soft/60" : "hover:bg-background/60"}`}>
      {t.unread && <span aria-label="Unread" className="absolute left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#2563eb]" />}
      <span className="relative h-10 w-10">
        <span className={picking || checked ? "invisible" : "group-hover:invisible"}><Avatar t={t} /></span>
        <label onClick={(e) => e.stopPropagation()} className={`absolute inset-0 place-items-center ${picking || checked ? "grid" : "hidden group-hover:grid"}`}>
          <input type="checkbox" aria-label={`Select ${t.peerName}`} className="h-5 w-5 accent-[#2563eb]" checked={checked} onChange={(e) => onCheck(e.target.checked)} />
        </label>
      </span>
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`truncate ${t.unread ? "font-extrabold" : ""}`}>{t.peerName}</span>
          {t.count > 1 && <span className="text-muted/80">{t.count}</span>}
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 tabular-nums ${t.unread ? "font-bold text-[#2563eb]" : "text-muted"}`}>
            {t.hasFiles && <span title="Has attachments" className="opacity-60">📎</span>}
            <span className="sm:group-hover:hidden">{t.snoozed && t.snoozedUntil ? `⏰ ${shortTime(t.snoozedUntil)}` : shortTime(t.latest.at)}</span>
            <span className="hidden gap-0.5 font-normal sm:group-hover:flex">
              <button onClick={stop(onArchive)} title="Archive" aria-label="Archive" className={act}>🗄</button>
              <button onClick={stop(onSnooze)} title="Snooze until tomorrow, 9 AM" aria-label="Snooze" className={act}>⏰</button>
              <button onClick={stop(onDelete)} title={t.trashed ? "Restore" : "Delete"} aria-label={t.trashed ? "Restore" : "Delete"} className={act}>{t.trashed ? "↩" : "🗑"}</button>
            </span>
            <button onClick={stop(() => p.inbox.star([t.key], !t.starred))} aria-label={t.starred ? "Unstar" : "Star"} title={t.starred ? "Unstar" : "Star"}
              className={`w-6 text-[19px] font-normal leading-none ${t.starred ? "text-[#d97706]" : "invisible text-muted/50 hover:text-[#d97706] group-hover:visible"}`}>{t.starred ? "★" : "☆"}</button>
          </span>
        </div>
        <div className="flex min-w-0 items-baseline gap-2 text-muted">
          {draft && <span className="shrink-0 font-bold text-danger">Draft</span>}
          {where && where !== "Inbox" && <span className="shrink-0 rounded-md bg-background px-1.5 font-semibold">{where}</span>}
          {t.subject && <span className={`max-w-full shrink-0 truncate text-foreground sm:max-w-[55%] ${t.unread ? "font-extrabold" : "font-semibold"}`}>{t.subject}</span>}
          <span className={`min-w-0 truncate ${t.subject ? "hidden sm:inline" : ""}`}>{preview}</span>
        </div>
        {p.prefs.showClientAndTask && (client || task) && (
          <div className="mt-1 flex flex-wrap gap-2 text-[14px]">
            {client && <span className="rounded bg-background px-2 py-0.5">🏢 {client}</span>}
            {task && <span className="rounded bg-success-soft px-2 py-0.5 font-semibold text-success">✓ {task.title}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── An open conversation ──────────────────────────────────────────────────
function ThreadView({ p, t, back, done, del, snoozeOpen, setSnoozeOpen, linkSearchRef, onDraft, emailInstead, onOpenOther }: {
  p: InboxViewProps; t: InboxThread; back: () => void; done: () => void; del: () => void; emailInstead: (to: string, body: string) => void; onOpenOther: (key: string) => void;
  snoozeOpen: boolean; setSnoozeOpen: (v: boolean) => void; linkSearchRef: React.RefObject<HTMLInputElement | null>; onDraft: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  // Below a wide screen the side panel would squeeze the conversation to a
  // strip (Derek, 2026-10-01), so it waits behind ⓘ Details instead.
  const [details, setDetails] = useState(false);
  // An email's reply box opens from Reply, Reply all or Forward, above the
  // message it answers, so it is clear what is being answered (Derek,
  // 2026-10-01). A draft already started opens it as a reply.
  const lastFromThem = t.messages.find((m) => m.direction === "inbound") ?? t.messages[0];
  const [compose, setCompose] = useState<{ mode: ComposeMode; m: Message } | null>(() => (readDraft(p.me.id, t.key) ? { mode: "reply", m: lastFromThem } : null));
  const [blockOpen, setBlockOpen] = useState(false);
  const domain = t.channel === "email" && t.peerAddress?.includes("@") ? "@" + t.peerAddress.split("@")[1] : null;
  const blockIt = async (address: string) => {
    setBlockOpen(false);
    try {
      await p.inbox.block(address);
      const { undo } = await p.inbox.trash([t.key]);
      back();
      p.pushToast(`Blocked ${address}. Nothing more from them shows here.`, { label: "Undo", run: async () => { await p.inbox.unblock(address); await undo(); } });
    } catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't block them."); }
  };
  const typing = usePresence(p.me, t.key);
  const isGhl = t.key.startsWith("ghl:");
  const snooze = async (preset: "1h" | "3h" | "tomorrow" | "monday") => {
    setSnoozeOpen(false);
    const until = snoozeUntil(preset);
    const undo = await p.inbox.snooze([t.key], until);
    back();
    p.pushToast(`Snoozed until ${until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, { label: "Undo", run: () => { undo(); } });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex flex-wrap gap-0.5 border-b px-2 py-1.5 sm:px-3">
        <button onClick={back} title="Back" aria-label="Back" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">←<span className="hidden sm:inline"> Back</span></button>
        <button onClick={done} title="Archive: out of your Inbox and your Gmail inbox; never deleted" aria-label="Archive" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">🗄<span className="hidden sm:inline"> Archive</span></button>
        <button onClick={() => p.inbox.star([t.key], !t.starred)} aria-pressed={t.starred} aria-label={t.starred ? "Starred" : "Star"} title={t.starred ? "Starred" : "Star"} className={`h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground ${t.starred ? "text-[#d97706]" : ""}`}>{t.starred ? "★" : "☆"}<span className="hidden sm:inline">{t.starred ? " Starred" : " Star"}</span></button>
        <div className="relative">
          <button onClick={() => setSnoozeOpen(!snoozeOpen)} title="Snooze" aria-label="Snooze" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">⏰<span className="hidden sm:inline"> Snooze</span></button>
          {snoozeOpen && (
            <Menu onClose={() => setSnoozeOpen(false)}>
              {([["1h", "In 1 hour"], ["3h", "In 3 hours"], ["tomorrow", "Tomorrow, 9 AM"], ["monday", "Monday, 9 AM"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => snooze(k)} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">{l}</button>
              ))}
            </Menu>
          )}
        </div>
        <button onClick={async () => { await p.inbox.markUnread([t.key]); back(); }} title="Mark as unread" aria-label="Mark as unread" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">✉<span className="hidden sm:inline"> Mark as unread</span></button>
        <button onClick={del} title={t.trashed ? "Bring it back" : t.channel === "email" ? "Moves it to Trash here and in Gmail (kept 30 days)" : "Moves it to Trash here"} aria-label={t.trashed ? "Restore" : "Delete"} className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">{t.trashed ? "↩" : "🗑"}<span className="hidden sm:inline">{t.trashed ? " Restore" : " Delete"}</span></button>
        {t.peerAddress && !t.trashed && (
          <div className="relative">
            <button onClick={() => setBlockOpen(!blockOpen)} title="Block sender" aria-label="Block sender" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">⛔<span className="hidden sm:inline"> Block</span></button>
            {blockOpen && (
              <Menu onClose={() => setBlockOpen(false)}>
                <button onClick={() => blockIt(t.peerAddress!)} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">Block {t.peerAddress}</button>
                {domain && !/@(gmail|yahoo|hotmail|outlook|icloud|aol|me|msn|live)\./i.test(domain) && (
                  <button onClick={() => blockIt(domain)} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">Block everyone at {domain.slice(1)}</button>
                )}
                <div className="px-3 pb-1 pt-2 text-[14px] text-muted">Moves this to Trash. Undo any time in Settings.</div>
              </Menu>
            )}
          </div>
        )}
        <button onClick={() => setDetails(true)} title="Task, contact and other conversations" aria-label="Details" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground 2xl:hidden">ⓘ<span className="hidden sm:inline"> Details</span></button>
        {isGhl && (
          <div className="relative">
            <button onClick={() => setAssignOpen(!assignOpen)} title="Assign" aria-label="Assign" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">👤<span className="hidden sm:inline"> Assign</span></button>
            {assignOpen && (
              <Menu onClose={() => setAssignOpen(false)}>
                {[...p.team.map((m) => ({ id: m.id as string | null, name: m.id === p.me.id ? `${m.name} (you)` : m.name })), { id: null, name: "Unassigned, everyone sees it" }].map((m) => (
                  <button key={m.id ?? "none"} onClick={async () => {
                    setAssignOpen(false);
                    try { await p.inbox.assign(t.key, m.id); if (m.id !== p.me.id) back(); p.pushToast(m.id ? `Assigned to ${m.name}` : "Unassigned. Everyone can see it."); }
                    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't assign it."); }
                  }} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">{m.name}</button>
                ))}
              </Menu>
            )}
          </div>
        )}
      </div>
      {!isEmailThread(t) ? (
        // Texts, social messages and task chats read like a phone chat
        // (Derek, 2026-10-01): newest at the bottom, the reply box under it.
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[100%] overflow-y-auto 2xl:grid-cols-[minmax(0,1fr)_8px_var(--side-w)] 2xl:overflow-hidden" style={sideWidthStyle(p.prefs)}>
          <ChatView p={p} t={t} typing={typing} onDraft={onDraft} emailInstead={emailInstead} />
          <SideResizer p={p} />
          <div className="hidden min-h-0 overflow-y-auto bg-background/40 2xl:block"><SidePanel p={p} t={t} linkSearchRef={linkSearchRef} onOpenOther={onOpenOther} /></div>
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto 2xl:grid-cols-[minmax(0,1fr)_8px_var(--side-w)] 2xl:overflow-hidden" style={sideWidthStyle(p.prefs)}>
        <EmailThread p={p} t={t} typing={typing} compose={compose} setCompose={setCompose} onDraft={onDraft} />
        <SideResizer p={p} />
        <div className="hidden min-h-0 overflow-y-auto bg-background/40 2xl:block"><SidePanel p={p} t={t} linkSearchRef={linkSearchRef} onOpenOther={onOpenOther} /></div>
      </div>
      )}
      {details && <DetailsPanel onClose={() => setDetails(false)}><SidePanel p={{ ...p, onOpenTask: (id, from) => { setDetails(false); p.onOpenTask(id, from); } }} t={t} linkSearchRef={linkSearchRef} onOpenOther={(k) => { setDetails(false); onOpenOther(k); }} /></DetailsPanel>}
    </div>
  );
}

// ── A text conversation as a chat ─────────────────────────────────────────
function ChatView({ p, t, typing, onDraft, emailInstead }: {
  p: InboxViewProps; t: InboxThread; typing: string | null; onDraft: () => void; emailInstead: (to: string, body: string) => void;
}) {
  const [shown, setShown] = useState(CHAT_PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Show earlier keeps your place: the height added above is scrolled past.
  const keepFrom = useRef<number | null>(null);
  const oldestFirst = useMemo(() => [...t.messages].reverse(), [t.messages]);
  const visible = useMemo(() => oldestFirst.slice(-shown), [oldestFirst, shown]);
  const hidden = oldestFirst.length - visible.length;
  const teamName = useCallback((id: string | null) => p.team.find((x) => x.id === id)?.name ?? null, [p.team]);
  const items = useMemo(() => chatItems(visible, (m) => m.direction === "outbound"
    ? (m.createdBy && m.createdBy !== p.me.id ? teamName(m.createdBy) : null)
    : t.channel === "chat" ? (m.peerName || t.peerName) : null), [visible, p.me.id, teamName, t.channel, t.peerName]);
  const newest = t.messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (keepFrom.current !== null) { el.scrollTop = el.scrollHeight - keepFrom.current; keepFrom.current = null; return; }
    el.scrollTop = el.scrollHeight;
  }, [t.key, newest, shown]);
  const showEarlier = () => { keepFrom.current = scrollRef.current?.scrollHeight ?? null; setShown((n) => n + CHAT_PAGE * 2); };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <Avatar t={t} />
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-extrabold leading-tight">{t.peerName}</h1>
          <div className="text-muted">{CHANNEL_LABEL[t.channel]} · {t.count} {t.count === 1 ? "message" : "messages"}</div>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {hidden > 0 && (
          <div className="mb-2 flex justify-center">
            <button onClick={showEarlier} className="rounded-full px-4 py-1.5 font-semibold text-accent ring-1 ring-[var(--border)] hover:bg-background">Show earlier messages ({hidden})</button>
          </div>
        )}
        {items.map((it) => it.kind === "day"
          ? <div key={it.key} className="flex items-center gap-3 pb-1 pt-4 font-semibold text-muted" role="separator"><span className="h-px flex-1 bg-[var(--border)]" />{it.label}<span className="h-px flex-1 bg-[var(--border)]" /></div>
          : <ChatGroup key={it.key} g={it} t={t} p={p} />)}
        {typing && <div className="mt-3 italic text-muted">{typing} is writing a reply…</div>}
      </div>
      <div className="border-t px-3 py-3 sm:px-4">
        <Composer key={t.key} p={p} t={t} compact onSent={() => { onDraft(); }} onDraft={onDraft} emailInstead={emailInstead} />
      </div>
    </div>
  );
}

function ChatGroup({ g, t, p }: { g: Extract<ChatItem, { kind: "group" }>; t: InboxThread; p: InboxViewProps }) {
  const mine = g.side === "mine";
  const last = g.messages[g.messages.length - 1];
  return (
    <div className={`mt-2.5 flex w-fit max-w-[85%] flex-col gap-[3px] sm:max-w-[75%] ${mine ? "ml-auto items-end" : "items-start"}`}>
      {g.who && <div className="px-3 font-semibold text-muted">{g.who}</div>}
      {g.messages.map((m, i) => {
        // Bubbles in a run hug each other: the corners between them tighten.
        const corners = mine
          ? `${i > 0 ? "rounded-tr-md" : ""} ${i < g.messages.length - 1 ? "rounded-br-md" : ""}`
          : `${i > 0 ? "rounded-tl-md" : ""} ${i < g.messages.length - 1 ? "rounded-bl-md" : ""}`;
        const other = m.channel !== t.channel && <span className="mb-0.5 block text-[15px] opacity-80">{CHANNEL_ICON[m.channel]} {CHANNEL_LABEL[m.channel]}</span>;
        return (
          <div key={m.id} className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
            {m.channel === "call" && m.ghlMessageId && m.ghlConversationId
              ? <div className="w-max max-w-full rounded-2xl bg-surface px-3 py-1.5 ring-1 ring-[var(--border)]"><CallPlayer m={m} peerName={t.peerName} /></div>
              : (m.body?.trim() || other) && (
                <div className={`whitespace-pre-wrap rounded-[20px] px-3.5 py-2 [overflow-wrap:anywhere] ${corners} ${mine ? "bg-accent text-white" : "bg-background text-foreground"}`}>
                  {other}<ChatText text={m.body ?? ""} />
                </div>
              )}
            {(m.attachments?.length ?? 0) > 0 && <Files m={m} p={p} />}
          </div>
        );
      })}
      <div className="px-3 text-muted">{shortTime(last.at)}</div>
    </div>
  );
}

/** A text's words, with any link shown as its website. */
function ChatText({ text }: { text: string }) {
  const parts = useMemo(() => bodyParts(text.trim()), [text]);
  return <>{parts.map((part, i) => "url" in part
    ? <a key={i} href={part.url} target="_blank" rel="noopener noreferrer nofollow" title={part.url} className="font-semibold underline">🔗 {part.label}</a>
    : <span key={i}>{part.text}</span>)}</>;
}

function Menu({ children, onClose, right = false }: { children: React.ReactNode; onClose: () => void; right?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute ${right ? "right-0" : "left-0"} top-10 z-50 min-w-60 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]`}>{children}</div>
    </>
  );
}

type ComposeMode = "reply" | "replyAll" | "forward";
/** Who wrote a message, and their company: the contact's own name (not the
 *  address Gmail shows), or the teammate who sent it. */
function whoWrote(m: Message, t: InboxThread, p: InboxViewProps): { name: string; org: string | null } {
  if (m.direction === "outbound") return { name: m.createdBy === p.me.id ? "You" : p.team.find((x) => x.id === m.createdBy)?.name ?? "You", org: null };
  const c = t.contactId ? p.contacts.find((x) => x.id === t.contactId) : null;
  const name = c?.name || m.peerName || t.peerName;
  const org = c?.company || p.clientName(t.clientId);
  return { name, org: org && org.toLowerCase() !== name.toLowerCase() ? org : null };
}
const fullTime = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ── An email conversation (Derek, 2026-10-01, mockup
// https://claude.ai/artifact/Tei4W4znGdehdTpFJAxBP1): oldest first, older
// emails folded to one line, the newest open at the bottom with Reply under it.
function EmailThread({ p, t, typing, compose, setCompose, onDraft }: {
  p: InboxViewProps; t: InboxThread; typing: string | null; onDraft: () => void;
  compose: { mode: ComposeMode; m: Message } | null; setCompose: (c: { mode: ComposeMode; m: Message } | null) => void;
}) {
  const oldestFirst = useMemo(() => [...t.messages].reverse(), [t.messages]);
  const last = oldestFirst[oldestFirst.length - 1];
  // Open: the newest, and everything they sent after your last reply when it is unread.
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const ids = new Set([last.id]);
    if (t.unread) {
      const lastMine = oldestFirst.map((m) => m.direction).lastIndexOf("outbound");
      oldestFirst.slice(lastMine + 1).forEach((m) => ids.add(m.id));
    }
    return ids;
  });
  const toggle = (id: string) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const others = [...new Set(oldestFirst.filter((m) => m.direction === "inbound").map((m) => whoWrote(m, t, p).name))];
  const composer = (m: Message) => compose?.m.id === m.id
    ? <div className="mt-3"><Composer key={`${t.key}:${compose.mode}:${m.id}`} p={p} t={t} mode={compose.mode} answering={m} onClose={() => setCompose(null)} onSent={() => { onDraft(); setCompose(null); }} onDraft={onDraft} /></div>
    : null;
  return (
    <div className="min-w-0 px-4 py-4 sm:px-6 2xl:overflow-y-auto">
      <h1 className="text-[22px] font-extrabold leading-tight" style={{ textWrap: "balance" }}>{t.subject || t.peerName}</h1>
      <p className="mb-3 text-muted">{others.length ? `${others.join(", ")} and you` : `You and ${t.peerName}`} · {t.count} {t.count === 1 ? "email" : "emails"}</p>
      {typing && <div className="mb-3 rounded-lg bg-highlight-soft px-4 py-2.5 font-semibold text-highlight">{typing} is writing a reply right now</div>}
      <div className="border-y">
        {oldestFirst.map((m, i) => {
          const prev = oldestFirst[i - 1];
          return (
            <div key={m.id}>
              {(!prev || dayLabel(prev.at) !== dayLabel(m.at)) && i > 0 && (
                <div className="flex items-center gap-3 border-t py-1.5 font-semibold text-muted" role="separator"><span className="h-px flex-1 bg-[var(--border)]" />{dayLabel(m.at)}<span className="h-px flex-1 bg-[var(--border)]" /></div>
              )}
              <EmailItem m={m} t={t} p={p} open={openIds.has(m.id)} onToggle={() => toggle(m.id)} onAnswer={(mode) => { setOpenIds((s) => new Set(s).add(m.id)); setCompose({ mode, m }); }} first={i === 0} />
              {m.id !== last.id && composer(m)}
            </div>
          );
        })}
      </div>
      {compose?.m.id === last.id ? composer(last) : (
        <div className="flex flex-wrap gap-2 pt-4">
          <button onClick={() => setCompose({ mode: "reply", m: last.direction === "inbound" ? last : (oldestFirst.slice().reverse().find((m) => m.direction === "inbound") ?? last) })} className="h-9 rounded-full bg-accent px-4 font-bold text-white">↩ Reply</button>
          <button onClick={() => setCompose({ mode: "replyAll", m: last })} className="h-9 rounded-full px-4 font-semibold ring-1 ring-[var(--border)] hover:bg-background">↩↩ Reply all</button>
          <button onClick={() => setCompose({ mode: "forward", m: last })} className="h-9 rounded-full px-4 font-semibold ring-1 ring-[var(--border)] hover:bg-background">→ Forward</button>
        </div>
      )}
    </div>
  );
}

function EmailItem({ m, t, p, open, onToggle, onAnswer, first }: {
  m: Message; t: InboxThread; p: InboxViewProps; open: boolean; first: boolean; onToggle: () => void; onAnswer: (mode: ComposeMode) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [asText, setAsText] = useState(false);
  const isHtmlEmail = m.channel === "email" && !!m.gmailMessageId && !!m.mailboxMemberId;
  const { name, org } = whoWrote(m, t, p);
  const mine = m.direction === "outbound";
  const snippet = (m.body || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  const to = mine ? `to ${t.peerName}` : `to you${(m.cc?.length ?? 0) > 0 ? `, ${m.cc.join(", ")}` : ""}`;
  // 📌 Add to task: the email onto the linked task, as a comment.
  const pin = () => {
    if (!t.taskId) { p.pushToast("Link a task first, on the right."); return; }
    const body = `📌 Email from ${name}, ${fullTime(m.at)}${m.subject ? `\n${m.subject}` : ""}\n\n${(m.body || "").trim().slice(0, 4000)}`;
    p.onAddComment(t.taskId, body);
    p.pushToast("Added to the task as a comment");
  };
  return (
    <article className={first ? "" : "border-t"}>
      <div role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onToggle(); } }}
        className="grid cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5 hover:bg-background">
        <span className="grid h-9 w-9 place-items-center rounded-full text-[15px] font-bold text-white" style={{ background: avatarColor(name) }}>{initials(name)}</span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <b className="truncate">{name}</b>
            {org && <span className="hidden truncate text-muted sm:inline">{org}</span>}
          </span>
          <span className="block truncate text-muted">{open ? to : snippet}</span>
        </span>
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <span className="mr-1 whitespace-nowrap text-muted">{open ? fullTime(m.at) : shortTime(m.at)}</span>
          {open && <>
            <button onClick={pin} title="Add this email to the task" aria-label="Add this email to the task" className="h-8 rounded-md px-1.5 text-muted hover:bg-background">📌</button>
            <button onClick={() => onAnswer("reply")} title="Reply to this email" aria-label="Reply to this email" className="h-8 rounded-md px-1.5 font-semibold text-muted hover:bg-background">↩</button>
            <span className="relative">
              <button onClick={() => setMenu(!menu)} aria-label="More" title="More" className="h-8 rounded-md px-1.5 font-bold text-muted hover:bg-background">⋯</button>
              {menu && (
                <Menu onClose={() => setMenu(false)} right>
                  <button onClick={() => { setMenu(false); onAnswer("replyAll"); }} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">↩↩ Reply all</button>
                  <button onClick={() => { setMenu(false); onAnswer("forward"); }} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">→ Forward</button>
                  <button onClick={() => { setMenu(false); pin(); }} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">📌 Add to task</button>
                  {isHtmlEmail && <button onClick={() => { setMenu(false); setAsText(!asText); }} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">{asText ? "✉ Show the email" : "Aa Show as text"}</button>}
                </Menu>
              )}
            </span>
          </>}
        </span>
      </div>
      {open && (
        <div className="pb-4 pl-1 sm:pl-[52px]">
          {m.channel !== t.channel && <div className="mb-1 text-muted">{CHANNEL_ICON[m.channel]} {CHANNEL_LABEL[m.channel]}</div>}
          {isHtmlEmail ? <EmailHtml m={m} p={p} asText={asText} />
            : m.channel === "call" && m.ghlMessageId && m.ghlConversationId ? <CallPlayer m={m} peerName={t.peerName} />
            : <EmailBody body={m.body} />}
          {m.attachments?.length > 0 && <Files m={m} p={p} />}
        </div>
      )}
    </article>
  );
}

// A call: what happened, and for a voicemail (or any recorded call) its
// recording and transcript, read from GoHighLevel when asked for.
function CallPlayer({ m, peerName }: { m: Message; peerName: string }) {
  const [audio, setAudio] = useState<string | null>(null);
  const [lines, setLines] = useState<{ who: "them" | "us"; text: string }[] | null>(null);
  const [copied, setCopied] = useState(false);
  // The transcript opens in a panel on the right, not inside the conversation.
  const [panel, setPanel] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"audio" | "text" | null>(null);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  const play = async () => {
    setBusy("audio"); setNote(null);
    const res = await authedFetch(`/api/inbox/call?message=${encodeURIComponent(m.id)}&part=audio`).catch(() => null);
    if (res?.ok) setAudio(URL.createObjectURL(await res.blob()));
    else setNote((await res?.json().catch(() => null))?.error ?? "Couldn't load the recording.");
    setBusy(null);
  };
  const transcript = async () => {
    setBusy("text"); setNote(null);
    const j = await authedFetch(`/api/inbox/call?message=${encodeURIComponent(m.id)}&part=transcript`).then((r) => r.json()).catch(() => null);
    const got: { who: "them" | "us"; text: string }[] = j?.lines ?? [];
    if (got.length) setLines(got); else setNote(j?.note ?? j?.error ?? "No transcript for this call.");
    setBusy(null);
    return got.length ? got : null;
  };
  const showTranscript = async () => { if (lines || (await transcript())) setPanel(true); };
  // Copy transcript (Derek, 2026-10-01): who said what, ready to paste.
  // Loads it first when it is not open yet.
  const copy = async (): Promise<boolean> => {
    const got = lines ?? (await transcript());
    if (!got) return false;
    const them = peerName.split(/\s+/)[0] || "Them";
    const when = new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const text = [`Call with ${peerName}, ${when}`, "", ...got.map((l) => `${l.who === "them" ? them : "Us"}: ${l.text}`)].join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); return true; }
    catch { if (!panel) setNote("Couldn't copy. Open the transcript and copy it by hand."); return false; }
  };
  return (
    // One slim row (Derek, 2026-10-01: the buttons were "big and bulky").
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="mr-1.5 font-semibold">📞 {m.body || "Call"}</span>
        {audio ? <audio src={audio} controls autoPlay className="h-8 max-w-full" />
          : <button onClick={play} disabled={busy !== null} title="Play recording" className="h-8 rounded-md px-2 font-semibold text-accent hover:bg-accent-soft disabled:opacity-60">{busy === "audio" ? "Loading…" : "▶ Play"}</button>}
        <button onClick={showTranscript} disabled={busy !== null} title="Show transcript" className="h-8 rounded-md px-2 font-semibold text-accent hover:bg-accent-soft disabled:opacity-60">{busy === "text" ? "Loading…" : "Transcript"}</button>
        <button onClick={() => { copy(); }} disabled={busy !== null} title="Copy transcript" className="h-8 rounded-md px-2 font-semibold text-accent hover:bg-accent-soft disabled:opacity-60">{copied ? "✓ Copied" : "Copy"}</button>
      </div>
      {note && <p className="text-muted">{note}</p>}
      {panel && lines && (
        <TranscriptPanel title={`Call with ${peerName}`} when={new Date(m.at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          them={peerName.split(/\s+/)[0] || "Them"} lines={lines} copied={copied} onCopy={copy} onClose={() => setPanel(false)} />
      )}
    </div>
  );
}

/** The side panel slid in from the right, below a wide screen. Esc or a
 *  click outside closes it; the Inbox's keys wait while it is open. */
function DetailsPanel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div role="dialog" aria-label="Details" className="inbox-slide fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background text-[16px] shadow-2xl sm:w-[380px]">
        <div className="flex items-center justify-between border-b bg-surface px-4 py-2.5">
          <b className="text-[18px]">Details</b>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="h-9 rounded-md px-3 font-semibold text-muted hover:bg-background">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/** A call's transcript in a panel on the right (full width on a phone), so a
 *  long call never pushes the conversation down. Esc or a click outside closes
 *  it; the Inbox's own keys wait while it is open (.inbox-slide). */
function TranscriptPanel({ title, when, them, lines, copied, onCopy, onClose }: {
  title: string; when: string; them: string; lines: { who: "them" | "us"; text: string }[]; copied: boolean; onCopy: () => Promise<boolean>; onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  // When the browser refuses the clipboard, the whole transcript is selected
  // so Cmd+C copies it.
  const copy = async () => {
    if (await onCopy()) return;
    const el = body.current, sel = window.getSelection();
    if (!el || !sel) return;
    const r = document.createRange(); r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
    setSelected(true);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <aside role="dialog" aria-label={title} className="inbox-slide fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-surface text-[16px] shadow-2xl sm:w-[clamp(380px,40vw,560px)]">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-extrabold leading-tight">📞 {title}</h2>
            <p className="text-muted">{when}</p>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">✕</button>
        </div>
        <div className="flex gap-2 border-b px-5 py-3">
          <button onClick={copy} className="h-10 rounded-lg bg-accent px-4 font-bold text-white">{copied ? "✓ Copied" : "📋 Copy transcript"}</button>
          {selected && !copied && <span className="self-center text-muted">Selected. Press ⌘C to copy.</span>}
        </div>
        <div ref={body} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 leading-relaxed">
          {lines.map((l, i) => (
            <p key={i}><b className={l.who === "them" ? "text-foreground" : "text-accent"}>{l.who === "them" ? them : "Us"}:</b> {l.text}</p>
          ))}
        </div>
      </aside>
    </>,
    document.body,
  );
}

// The email as it was sent, laid out the way Gmail shows it (Derek,
// 2026-10-01): its own fonts, buttons and photos, with earlier messages
// quoted underneath folded behind "•••". It sits in a sandboxed frame with
// scripts off, so nothing in an email can run; links open in a new tab. A
// plain text email, or one Gmail will not hand over, falls back to the text.
// The last 100 emails opened, so going back to one is instant.
const HTML_CACHE = new Map<string, string | null>();
const cacheHtml = (id: string, html: string | null) => {
  HTML_CACHE.set(id, html);
  if (HTML_CACHE.size > 100) HTML_CACHE.delete(HTML_CACHE.keys().next().value!);
};
// Pictures loaded from the sender's server tell them you opened the email,
// and from where (Derek, 2026-10-01: hidden until you ask). The frame's own
// rule blocks them, CSS backgrounds included; pictures sent inside the email
// still show.
const REMOTE_IMAGES = /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:|background\s*=\s*["']?https?:/i;
// Mail programs pad with rows of empty paragraphs and line breaks; one blank
// line between parts is plenty.
const BLANK = String.raw`(?:\s|&nbsp;|&#160;|<br\s*\/?>)*`;
function tidyEmailHtml(html: string): string {
  return html
    .replace(new RegExp(String.raw`(?:<(p|div)[^>]*>${BLANK}<\/\1>\s*){2,}`, "gi"), "<br>")
    .replace(/(?:<br\s*\/?>\s*(?:&nbsp;|&#160;)?\s*){3,}/gi, "<br><br>");
}
const QUOTE_CSS = ".gmail_quote,.gmail_extra,blockquote,.yahoo_quoted,#appendonsend,#divRplyFwdMsg,#divRplyFwdMsg~*,hr#stopSpelling~*{display:none!important}";
// Show as text lives in the email's ⋯ menu (Derek, 2026-10-01), so the
// switch is held by the email above this (EmailItem).
function EmailHtml({ m, p, asText = false }: { m: Message; p: InboxViewProps; asText?: boolean }) {
  const [html, setHtml] = useState<string | null | undefined>(HTML_CACHE.has(m.id) ? HTML_CACHE.get(m.id) : undefined);
  const [quoted, setQuoted] = useState(false);
  const [imagesOn, setImagesOn] = useState(false);
  const [height, setHeight] = useState(120);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (HTML_CACHE.has(m.id)) return;
    let live = true;
    authedFetch(`/api/inbox/html?message=${encodeURIComponent(m.id)}`)
      .then((r) => (r.ok ? r.json() : { html: null }))
      .then((j: { html: string | null }) => {
        // Belt and braces on top of the sandbox: nothing that runs or submits.
        const clean = j.html ? tidyEmailHtml(j.html.replace(/<(script|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "").replace(/<(script|iframe|object|embed|meta[^>]*http-equiv)[^>]*>/gi, "")) : null;
        cacheHtml(m.id, clean);
        if (live) setHtml(clean);
      }, () => { cacheHtml(m.id, null); if (live) setHtml(null); });
    return () => { live = false; };
  }, [m.id]);
  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    // Never smaller than 16px to read: an email that sets 10 or 11pt text
    // (Outlook does) is lifted; anything larger keeps its own size.
    doc.body?.querySelectorAll<HTMLElement>("p,span,div,td,li,a,font,b,strong,em,i").forEach((el) => {
      const px = parseFloat(doc.defaultView?.getComputedStyle(el).fontSize ?? "16");
      if (px && px < 15 && el.textContent?.trim()) el.style.fontSize = "16px";
    });
    // Links open in a new tab that cannot reach back into this one, and do
    // not tell the site where they came from.
    doc.querySelectorAll("a[href]").forEach((a) => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener noreferrer"); });
    const size = () => setHeight(Math.min(6000, Math.max(60, doc.documentElement.scrollHeight)));
    size();
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", size, { once: true }));
  };
  if (html === undefined) return <p className="text-muted">Loading the email…</p>;
  if (html === null || asText) return (
    <>
      <EmailBody body={m.body} />
    </>
  );
  const hasQuote = /gmail_quote|<blockquote|yahoo_quoted|divRplyFwdMsg/i.test(html);
  const sender = (m.peerAddress ?? "").toLowerCase();
  const remote = REMOTE_IMAGES.test(html);
  // Your own sent mail shows as it is.
  const showImages = !remote || m.direction !== "inbound" || imagesOn || (!!sender && (p.prefs.imageSenders ?? []).includes(sender));
  const csp = showImages ? "" : `<meta http-equiv="Content-Security-Policy" content="img-src data: blob:">`;
  const doc = `<!doctype html><html><head><meta charset="utf-8">${csp}<meta name="referrer" content="no-referrer"><base target="_blank"><style>html,body{margin:0;padding:0;background:#ffffff;color:#1c2030;font:16px/1.5 Inter,system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}${quoted ? "" : QUOTE_CSS}</style></head><body>${html}</body></html>`;
  return (
    <>
      {!showImages && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-background px-3 py-2 text-muted">
          <span>Pictures are hidden so the sender can&apos;t tell you opened this.</span>
          <button onClick={() => setImagesOn(true)} className="font-semibold text-accent hover:underline">Show pictures</button>
          {sender && <button onClick={() => p.setPrefs({ imageSenders: [...(p.prefs.imageSenders ?? []), sender] })} className="font-semibold text-accent hover:underline">Always show from {sender}</button>}
        </div>
      )}
      <div className="overflow-hidden bg-white">
        <iframe key={showImages ? "on" : "off"} ref={frame} title="Email" srcDoc={doc} onLoad={fit} style={{ height }}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="block w-full border-0" />
      </div>
      {hasQuote && (
        <div className="mt-2">
          <button onClick={() => setQuoted(!quoted)} title={quoted ? "Hide earlier messages" : "Show earlier messages"} className="rounded-full bg-background px-3 font-bold tracking-widest text-muted hover:text-foreground">•••</button>
        </div>
      )}
    </>
  );
}

// What the person wrote, readable: tracking links show as their website,
// earlier messages quoted underneath fold away, and the email exactly as it
// came is one click off (Derek, 2026-10-01: "emails that look like all links").
function EmailBody({ body }: { body: string }) {
  const [original, setOriginal] = useState(false);
  const [quoted, setQuoted] = useState(false);
  const text = useMemo(() => tidyEmailText(body || ""), [body]);
  const split = useMemo(() => splitQuotedEmail(text), [text]);
  if (!text) return <p className="text-muted">(no text)</p>;
  if (original) return (
    <>
      <p className="whitespace-pre-wrap break-all font-mono text-[14px] leading-relaxed">{body}</p>
      <button onClick={() => setOriginal(false)} className="mt-2 font-semibold text-accent hover:underline">Show it tidied</button>
    </>
  );
  const shown = quoted ? text : split.visible || text;
  return (
    <>
      <p className="whitespace-pre-wrap break-words leading-relaxed">
        {bodyParts(shown).map((part, i) => "url" in part
          ? <a key={i} href={part.url} target="_blank" rel="noopener noreferrer nofollow" title={part.url} className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 align-baseline text-[15px] font-semibold text-accent hover:underline">🔗 {part.label}</a>
          : <span key={i}>{part.text}</span>)}
      </p>
      <div className="mt-2 flex flex-wrap gap-4">
        {split.quoted && split.visible && <button onClick={() => setQuoted(!quoted)} className="font-semibold text-accent hover:underline">{quoted ? "Hide earlier messages" : "Show earlier messages"}</button>}
        {isLinkHeavy(text) && <button onClick={() => setOriginal(true)} className="font-semibold text-muted hover:underline">Show original</button>}
      </div>
    </>
  );
}

// Photos show as previews; anything else is a card to open (Derek,
// 2026-10-01: "show a preview if there are images").
function Files({ m, p }: { m: Message; p: InboxViewProps }) {
  const imgs = m.attachments.filter((a) => a.kind === "image");
  const docs = m.attachments.filter((a) => a.kind !== "image");
  const [big, setBig] = useState<number | null>(null);
  return (
    <>
      {imgs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {imgs.map((a, i) => (
            <button key={a.id} onClick={() => setBig(i)} className="relative h-36 w-36 overflow-hidden rounded-lg ring-1 ring-[var(--border)]" aria-label={`Open ${a.name}`}>
              <FileImage a={a} m={m} p={p} className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-0.5 text-left text-[13px] text-white">{a.name}</span>
            </button>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {docs.map((a) => (
            <button key={a.id} onClick={() => openFile(a, m, p, true)} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2 text-left ring-1 ring-[var(--border)]">
              <span className="grid h-11 w-9 place-items-center rounded-md bg-danger-soft text-[12px] font-extrabold text-danger">{a.kind === "pdf" ? "PDF" : a.kind === "sheet" ? "XLS" : "DOC"}</span>
              <span><b className="block font-semibold">{a.name}</b><span className="text-[14px] text-muted">{a.size || "Open"}</span></span>
            </button>
          ))}
        </div>
      )}
      {big !== null && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/85 p-6" onClick={() => setBig(null)} role="dialog" aria-label={imgs[big].name}>
          <div className="text-center" onClick={(e) => e.stopPropagation()}>
            <FileImage a={imgs[big]} m={m} p={p} className="max-h-[78vh] max-w-[min(1000px,100%)] rounded-lg bg-white" />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-white">
              {imgs.length > 1 && <button onClick={() => setBig((big - 1 + imgs.length) % imgs.length)} className="h-10 rounded-lg border border-white/40 px-3 font-semibold">← Previous</button>}
              <span>{imgs[big].name}{imgs.length > 1 ? `  ·  ${big + 1} of ${imgs.length}` : ""}</span>
              {imgs.length > 1 && <button onClick={() => setBig((big + 1) % imgs.length)} className="h-10 rounded-lg border border-white/40 px-3 font-semibold">Next →</button>}
              <button onClick={() => openFile(imgs[big], m, p, true)} className="h-10 rounded-lg border border-white/40 px-3 font-semibold">Download</button>
              <button onClick={() => setBig(null)} className="h-10 rounded-lg border border-white/40 px-3 font-semibold">✕ Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function fileUrl(a: Attachment, m: Message, p: InboxViewProps, download = false): Promise<string | null> {
  if (a.url) return a.url;
  if (a.path) return p.onSignedUrl(a.path);
  if (a.gmailAttachmentId) {
    const res = await authedFetch(`/api/inbox/attachment?message=${encodeURIComponent(m.id)}&att=${encodeURIComponent(a.id)}${download ? "&download=1" : ""}`);
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  }
  return null;
}
async function openFile(a: Attachment, m: Message, p: InboxViewProps, download: boolean) {
  const url = await fileUrl(a, m, p, download);
  if (!url) { p.pushToast(`Couldn't open ${a.name}`); return; }
  const link = document.createElement("a");
  link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
  if (download) link.download = a.name;
  link.click();
}
function FileImage({ a, m, p, className }: { a: Attachment; m: Message; p: InboxViewProps; className?: string }) {
  const [src, setSrc] = useState<string | null>(a.url ?? null);
  useEffect(() => {
    let live = true, made: string | null = null;
    if (!a.url) fileUrl(a, m, p).then((u) => { if (!live) return; if (u?.startsWith("blob:")) made = u; setSrc(u); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, m.id]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={a.name} className={className} /> : <span className={`grid place-items-center bg-background text-muted ${className ?? ""}`}>🖼️</span>;
}

// ── The reply box ─────────────────────────────────────────────────────────
function Composer({ p, t, onSent, onDraft, mode = "reply", answering, onClose, emailInstead, compact = false }: {
  p: InboxViewProps; t: InboxThread; onSent: () => void; onDraft: () => void;
  mode?: ComposeMode; answering?: Message; onClose?: () => void; emailInstead?: (to: string, body: string) => void;
  /** Under a chat: two lines to start, Enter sends, Shift+Enter is a new line. */
  compact?: boolean;
}) {
  // Facebook and Instagram only let a business reply within 24 hours of the
  // person's last message (Meta's rule). Said before you type, not after.
  const lastIn = t.messages.find((m) => m.direction === "inbound");
  const [openedAt] = useState(() => Date.now());
  const metaClosed = (t.channel === "fb" || t.channel === "ig") && !!lastIn && openedAt - new Date(lastIn.at).getTime() > 24 * 3_600_000;
  const altEmail = (t.ghlConversationId ? p.inbox.convs.get(t.ghlConversationId)?.email : null) ?? (t.peerAddress?.includes("@") ? t.peerAddress : null);
  const email = isEmailThread(t);
  const forward = mode === "forward";
  const fromLabel = (m: Message) => (m.direction === "outbound" ? "you" : t.peerName.split(/\s+/)[0]);
  const when = (m: Message) => new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const [text, setText] = useState(() => readDraft(p.me.id, t.key) || (forward && answering ? `\n\nForwarded message from ${answering.direction === "outbound" ? p.me.name : t.peerName}, ${when(answering)}:\n${answering.body}` : ""));
  // Reply all: everyone else who was on it, besides the person you answer.
  const allOthers = (answering?.cc ?? []).filter((a) => a && a !== t.peerAddress);
  const [to, setTo] = useState(forward ? "" : t.peerAddress ?? "");
  const [ccOpen, setCcOpen] = useState(mode === "replyAll" && allOthers.length > 0);
  const [cc, setCc] = useState(mode === "replyAll" ? allOthers.join(", ") : ""); const [bcc, setBcc] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [note, setNote] = useState<{ kind: "ai" | "nudge" | "error"; text: string; before?: string } | null>(null);
  const [busy, setBusy] = useState<"improve" | "send" | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (v: string) => {
    setText(v); setNote(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { writeDraft(p.me.id, t.key, v); onDraft(); }, 500);
  };
  // Discard (Derek, 2026-10-01: "struggling to close or cancel this draft"):
  // empties the box and the saved draft, with Undo, and closes an email reply.
  const discard = () => {
    const before = text, beforeFiles = files;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setText(""); setFiles([]); setNote(null); writeDraft(p.me.id, t.key, ""); onDraft();
    onClose?.();
    p.pushToast("Draft discarded", { label: "Undo", run: () => { setText(before); setFiles(beforeFiles); writeDraft(p.me.id, t.key, before); onDraft(); } });
  };
  const channelForAi = t.channel === "email" ? "email" : t.channel === "chat" ? "chat" : "sms";

  const improve = async () => {
    if (!text.trim()) return;
    setBusy("improve");
    try {
      const r = await p.inbox.improve(text, channelForAi);
      if (r.changed) { const before = text; change(r.text); setNote({ kind: "ai", text: "Fixed spelling, grammar and punctuation. Your words, just cleaner.", before }); }
      else setNote({ kind: "ai", text: "Looks good already. Nothing to fix." });
    } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : "Couldn't improve it." }); }
    finally { setBusy(null); }
  };

  const upload = async (list: FileList | null) => {
    if (!list) return;
    const prefix = t.clientId ? `messages/${t.clientId}` : `inbox/${p.me.id}`;
    for (const f of Array.from(list)) { const a = await p.onUpload(prefix, f); if (a) setFiles((x) => [...x, a]); }
  };

  const deliver = async (body: string) => {
    if (t.channel === "chat") return p.onSendChat(t, body);
    await p.inbox.send({
      threadKey: t.key.startsWith("gm:") || t.key.startsWith("ghl:") ? t.key : null,
      to: email ? (to.trim() || undefined) : undefined,
      ...(forward && t.subject ? { subject: /^fwd?:/i.test(t.subject) ? t.subject : `Fwd: ${t.subject}` } : {}),
      cc: cc.split(/[,\s]+/).filter(Boolean), bcc: bcc.split(/[,\s]+/).filter(Boolean),
      body, attachments: files.filter((f) => f.path).map((f) => ({ path: f.path!, name: f.name })),
    });
  };

  const send = async (skipNudge = false) => {
    const body = text.trim();
    if (!body) return;
    // A quick check before it goes: only when the AI is reachable and finds something.
    if (p.prefs.aiNudge && !skipNudge && note?.kind !== "ai") {
      setBusy("send");
      const r = await p.inbox.improve(body, channelForAi).catch(() => null);
      setBusy(null);
      if (r?.changed) { setNote({ kind: "nudge", text: r.text }); return; }
    }
    const clear = () => { setText(""); writeDraft(p.me.id, t.key, ""); setFiles([]); setNote(null); onDraft(); };
    const go = async () => {
      setBusy("send");
      try { await deliver(body); p.pushToast("Sent"); onSent(); }
      catch (e) { setText(body); writeDraft(p.me.id, t.key, body); onDraft(); p.pushToast(e instanceof Error ? e.message : "Couldn't send it."); }
      finally { setBusy(null); }
    };
    clear();
    if (p.prefs.undoSeconds > 0) {
      let cancelled = false;
      const timer = setTimeout(() => { if (!cancelled) go(); }, p.prefs.undoSeconds * 1000);
      p.pushToast(`Sending in ${p.prefs.undoSeconds} seconds`, { label: "Undo", run: () => { cancelled = true; clearTimeout(timer); setText(body); writeDraft(p.me.id, t.key, body); onDraft(); p.pushToast("Not sent. It's back in your reply."); } });
    } else go();
  };

  const later = async (at: Date) => {
    setLaterOpen(false);
    if (!p.onSchedule || !text.trim()) return;
    try { await p.onSchedule(t, text.trim(), at); setText(""); writeDraft(p.me.id, t.key, ""); onDraft(); p.pushToast(`Scheduled for ${at.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't schedule it."); }
  };
  const tomorrow8 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d; };
  const monday8 = () => { const d = snoozeUntil("monday"); d.setHours(8, 0, 0, 0); return d; };

  const from = email ? `From ${p.me.email ?? "your Gmail"}` : t.channel === "chat" ? "Reply in the task chat (the client sees it in their portal)" : t.channel === "call" ? "Text them back" : `Reply by ${CHANNEL_LABEL[t.channel]}`;
  return (
    // Under a chat Instagram or Facebook will not take a reply: one slim line
    // instead of the box, so the conversation keeps the room (Derek, 2026-10-01).
    compact && metaClosed ? (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold text-highlight">
        <span>🔒 {t.channel === "ig" ? "Instagram" : "Facebook"} reply window closed ({shortTime(lastIn!.at)}, 24 hours after their last message)</span>
        {altEmail && emailInstead && <button onClick={() => emailInstead(altEmail, text)} className="text-accent hover:underline">✉️ Email them instead</button>}
        {text.trim() && <button onClick={discard} className="text-muted hover:underline">🗑 Discard draft</button>}
      </div>
    ) :
    <div className={compact ? "" : "rounded-xl bg-surface p-3 ring-2 ring-accent/40"}>
      {answering && (
        <div className="mb-2 flex items-start gap-3 rounded-lg bg-background px-3 py-2">
          <span className="min-w-0 flex-1">
            <b>{mode === "forward" ? "Forwarding" : mode === "replyAll" ? "Replying to everyone on" : "Replying to"} {fromLabel(answering)}, {when(answering)}</b>
            <span className="block truncate text-muted">{(answering.body || "").replace(/\s+/g, " ").slice(0, 160)}</span>
          </span>
          {onClose && <button onClick={onClose} title="Close (your draft is kept)" aria-label="Close" className="text-muted hover:text-foreground">✕</button>}
        </div>
      )}
      {!compact && <div className="mb-1 text-muted">{from}</div>}
      {metaClosed && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg bg-highlight-soft px-3 py-2.5 font-semibold text-highlight">
          {t.channel === "ig" ? "Instagram" : "Facebook"} only allows a reply within 24 hours of their last message, and that was {shortTime(lastIn!.at)}.
          {altEmail && emailInstead && <button onClick={() => emailInstead(altEmail, text)} className="h-9 rounded-md px-3 ring-1 ring-current">✉️ Email them instead</button>}
        </div>
      )}
      {email && (
        <div className="flex flex-wrap items-center gap-2 border-b py-1.5">
          <span className="w-11 text-muted">To</span>
          {forward
            ? <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who to forward it to" className="h-8 min-w-0 flex-1 bg-transparent outline-none" />
            : <span className="min-w-0 flex-1 truncate">{t.peerAddress}</span>}
          <button onClick={() => setCcOpen(!ccOpen)} className="rounded-md px-2 py-1 font-semibold text-accent hover:bg-background">CC / BCC</button>
        </div>
      )}
      {email && ccOpen && <>
        <label className="flex items-center gap-2 border-b py-1.5"><span className="w-11 text-muted">CC</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Add people" className="h-8 min-w-0 flex-1 bg-transparent outline-none" /></label>
        <label className="flex items-center gap-2 border-b py-1.5"><span className="w-11 text-muted">BCC</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Add people" className="h-8 min-w-0 flex-1 bg-transparent outline-none" /></label>
      </>}
      {note && (
        <div className={`mt-2 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 font-semibold ${note.kind === "nudge" ? "bg-highlight-soft text-highlight" : note.kind === "error" ? "bg-danger-soft text-danger" : "bg-[#f3efff] text-[#7c3aed]"}`}>
          {note.kind === "nudge" ? <>
            ✨ A few typos spotted.
            <button onClick={() => { change(note.text); setNote({ kind: "ai", text: "Fixed. Press Send when ready." }); }} className="h-9 rounded-md px-3 ring-1 ring-current">Fix them</button>
            <button onClick={() => send(true)} className="h-9 rounded-md px-3 ring-1 ring-current">Send anyway</button>
          </> : <>
            ✨ {note.text}
            {note.before !== undefined && <button onClick={() => { change(note.before!); setNote(null); }} className="underline">Undo</button>}
          </>}
        </div>
      )}
      <textarea data-inbox-composer={t.key} autoFocus={!!answering && !forward} value={text} onChange={(e) => change(e.target.value)} placeholder={forward ? "Add a note (optional)" : `Write to ${t.peerName.split(/\s+/)[0]}`} rows={compact ? 1 : 4}
        onKeyDown={compact ? (e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } } : undefined}
        // Under a chat it starts at one line and grows with what you write, up to about six.
        ref={compact ? (el) => { if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; } } : undefined}
        className={compact ? "w-full resize-none overflow-y-auto rounded-2xl bg-background px-4 py-2.5 leading-relaxed outline-none ring-1 ring-[var(--border)] focus:ring-accent" : "mt-1 w-full resize-y bg-transparent py-2 leading-relaxed outline-none"} />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {files.map((f) => <span key={f.id} className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 ring-1 ring-[var(--border)]">{f.kind === "image" ? "🖼️" : "📄"} {f.name}<button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remove ${f.name}`} className="text-muted">✕</button></span>)}
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "pt-2" : "border-t pt-2.5"}`}>
        {t.channel !== "chat" && email && <>
          <button onClick={() => fileRef.current?.click()} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">📎 Attach</button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </>}
        <div className="relative">
          <button onClick={() => setRepliesOpen(!repliesOpen)} title="Saved replies" className={`${compact ? "h-9 px-2.5" : "h-10 px-3"} rounded-lg border font-semibold hover:bg-background`}>⚡<span className={compact ? "hidden sm:inline" : ""}> Saved replies</span></button>
          {repliesOpen && (
            <div className="absolute bottom-12 left-0 z-50 w-80 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              {p.prefs.replies.length ? p.prefs.replies.map((r) => (
                <button key={r.name} onClick={() => { change(text.trim() ? `${text.trim()}\n\n${r.text}` : r.text); setRepliesOpen(false); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">
                  <b className="block">{r.name}</b><span className="text-[14px] text-muted">{r.text.slice(0, 70)}{r.text.length > 70 ? "…" : ""}</span>
                </button>
              )) : <div className="px-3 py-2 text-muted">None yet. Add some in Settings.</div>}
            </div>
          )}
        </div>
        <button onClick={improve} disabled={busy !== null || !text.trim()} title="Improve with AI" className={`${compact ? "h-9 px-2.5" : "h-10 px-3"} rounded-lg bg-[#f3efff] font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50`}>{busy === "improve" ? "✨ Improving…" : <>✨<span className={compact ? "hidden sm:inline" : ""}> Improve with AI</span></>}</button>
        {(text.trim() || files.length > 0) && <button onClick={discard} title="Throw this draft away" className="h-10 rounded-lg px-3 font-semibold text-muted hover:bg-background hover:text-foreground">🗑 Discard</button>}
        <span className="flex-1" />
        {(t.channel === "sms" || t.channel === "call") && <span className="tabular-nums text-muted">{text.length} / 160</span>}
        <div className="relative flex">
          <button onClick={() => send()} disabled={busy !== null || !text.trim() || metaClosed} className={`h-10 bg-accent px-5 font-bold text-white disabled:opacity-50 ${p.onSchedule && t.clientId ? "rounded-l-lg" : "rounded-lg"}`}>{busy === "send" ? "Checking…" : "Send"}</button>
          {p.onSchedule && t.clientId && <>
            <button onClick={() => setLaterOpen(!laterOpen)} aria-label="Send later" className="h-10 rounded-r-lg border-l border-white/30 bg-accent px-2.5 text-white">▾</button>
            {laterOpen && (
              <div className="absolute bottom-12 right-0 z-50 w-64 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                <button onClick={() => later(tomorrow8())} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">Send tomorrow, 8 AM</button>
                <button onClick={() => later(monday8())} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">Send Monday, 8 AM</button>
              </div>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}

// ── Right side: the task, and who it is from ──────────────────────────────
// The side panel (Derek, 2026-10-01): the linked task you can work from here,
// the person's other open tasks and conversations, and how to reach them.
// Its width is dragged with the line to its left (SideResizer).
const SIDE_MIN = 260, SIDE_MAX = 560, SIDE_DEFAULT = 320;
const sideWidthStyle = (prefs: InboxPrefs) => ({ ["--side-w" as string]: `${Math.min(SIDE_MAX, Math.max(SIDE_MIN, prefs.sideWidth || SIDE_DEFAULT))}px` }) as React.CSSProperties;

function SideResizer({ p }: { p: InboxViewProps }) {
  const ref = useRef<HTMLButtonElement>(null);
  const width = Math.min(SIDE_MAX, Math.max(SIDE_MIN, p.prefs.sideWidth || SIDE_DEFAULT));
  const set = (w: number) => p.setPrefs({ sideWidth: Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w))) });
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = ref.current, grid = el?.parentElement;
    if (!el || !grid) return;
    el.setPointerCapture(e.pointerId);
    const right = grid.getBoundingClientRect().right;
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    // While dragging only the CSS moves; the setting is saved once, at the end.
    let w = width;
    const move = (ev: PointerEvent) => { w = Math.min(SIDE_MAX, Math.max(SIDE_MIN, right - ev.clientX - 4)); grid.style.setProperty("--side-w", `${w}px`); };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      set(w);
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  };
  return (
    <button ref={ref} role="separator" aria-orientation="vertical" aria-label="Side panel width" aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX} aria-valuenow={width}
      title="Drag to resize. Double-click to reset." onPointerDown={down} onDoubleClick={() => set(SIDE_DEFAULT)}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); set(width + 20); } if (e.key === "ArrowRight") { e.preventDefault(); set(width - 20); } }}
      className="group relative hidden cursor-col-resize touch-none 2xl:block">
      <span className="absolute inset-y-0 left-[3px] w-0.5 bg-[var(--border)] transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
    </button>
  );
}

async function copyText(text: string, p: InboxViewProps) {
  try { await navigator.clipboard.writeText(text); p.pushToast("Copied"); }
  catch { p.pushToast("Couldn't copy. Select it and copy by hand."); }
}

function SidePanel({ p, t, linkSearchRef, onOpenOther }: { p: InboxViewProps; t: InboxThread; linkSearchRef: React.RefObject<HTMLInputElement | null>; onOpenOther: (key: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  // Mark done remembers what it was, so Undo puts it back.
  const [before, setBefore] = useState<TaskStatus | null>(null);
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  const client = p.clientName(t.clientId);
  const contact = t.contactId ? p.contacts.find((x) => x.id === t.contactId) ?? null : null;
  const person = contact?.name || t.peerName;
  const first = person.split(/\s+/)[0];
  const conv = t.ghlConversationId ? p.inbox.convs.get(t.ghlConversationId) : undefined;
  const email = contact?.email || (t.peerAddress?.includes("@") ? t.peerAddress : null) || conv?.email || null;
  const phone = contact?.phone || (t.peerAddress && !t.peerAddress.includes("@") ? t.peerAddress : null) || conv?.phone || null;
  const ghlUrl = t.contactId ? p.ghlUrlFor(t.contactId) : null;
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return p.tasks
      .filter((x) => x.status !== "done" && (!t.clientId || x.clientId === t.clientId || words.length > 0))
      .filter((x) => words.every((w) => x.title.toLowerCase().includes(w) || (p.clientName(x.clientId) ?? "").toLowerCase().includes(w)))
      .slice(0, 6);
  }, [q, p, t.clientId]);
  // Their other open work: tasks on this contact or this client, soonest due first.
  const otherTasks = useMemo(() => p.tasks
    .filter((x) => x.id !== t.taskId && x.status !== "done" && !x.private && ((t.contactId && x.contactId === t.contactId) || (t.clientId && x.clientId === t.clientId)))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .slice(0, 3), [p.tasks, t.taskId, t.contactId, t.clientId]);
  // Their other conversations here: texts, other email threads, calls.
  const otherConvs = useMemo(() => p.inbox.threads
    .filter((x) => x.key !== t.key && !x.trashed && ((t.contactId && x.contactId === t.contactId) || (t.peerAddress && x.peerAddress === t.peerAddress) || (t.clientId && x.clientId === t.clientId && x.clientId !== null)))
    .slice(0, 3), [p.inbox.threads, t.key, t.contactId, t.peerAddress, t.clientId]);
  const link = async (taskId: string | null) => {
    setBusy(true);
    try { await p.inbox.linkTask(t.key, taskId); p.pushToast(taskId ? "Linked. New messages here land on the task too." : "Unlinked"); setQ(""); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't link it."); }
    finally { setBusy(false); }
  };
  const owner = task?.assigneeId ? (task.assigneeId === p.me.id ? "You" : p.team.find((x) => x.id === task.assigneeId)?.name ?? null) : null;
  const dueLabel = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : null);
  const card = "rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]";
  const label = "mb-1.5 text-[14px] font-bold tracking-wide text-muted";
  const linkBtn = "font-semibold text-accent hover:underline";
  return (
    <aside className="min-w-0 space-y-3 p-4">
      <div className={card}>
        <div className={label}>{task ? "LINKED TASK" : "LINK TO A TASK"}</div>
        {task ? <>
          <b className="block text-[18px] leading-snug">{task.title}</b>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="relative">
              <button onClick={() => setStatusOpen(!statusOpen)} className="h-8 rounded-full px-3 font-semibold" style={{ background: STATUS_META[task.status].chip }}>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: STATUS_META[task.status].dot }} />{STATUS_META[task.status].label} ▾
              </button>
              {statusOpen && (
                <Menu onClose={() => setStatusOpen(false)}>
                  {STATUS_ORDER.filter((st) => !HIDDEN_STATUSES.has(st)).map((st) => (
                    <button key={st} onClick={() => { setStatusOpen(false); p.onPatchTask(task.id, { status: st }); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-background">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[st].dot }} />{STATUS_META[st].label}{st === task.status ? " ✓" : ""}
                    </button>
                  ))}
                </Menu>
              )}
            </span>
            {task.due && <span className="h-8 rounded-full bg-background px-3 leading-8 ring-1 ring-[var(--border)]">📅 {dueLabel(task.due)}</span>}
            {task.waitingOnClient && <span className="h-8 rounded-full bg-highlight-soft px-3 font-semibold leading-8 text-highlight">Waiting on client</span>}
          </div>
          {(task.followUpAt || owner) && (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              {task.followUpAt && <><dt className="text-muted">Follow up</dt><dd>{dueLabel(task.followUpAt.slice(0, 10))}</dd></>}
              {owner && <><dt className="text-muted">On</dt><dd>{owner}</dd></>}
            </dl>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {task.status === "done"
              ? <button onClick={() => { p.onPatchTask(task.id, { status: before ?? "todo" }); setBefore(null); }} className="h-9 rounded-lg px-3 font-semibold text-muted ring-1 ring-[var(--border)] hover:bg-background">✓ Done · Undo</button>
              : <button onClick={() => { setBefore(task.status); p.onPatchTask(task.id, { status: "done" }); p.pushToast("Marked done"); }} className="h-9 rounded-lg bg-success px-3 font-bold text-white">✓ Mark done</button>}
            <button onClick={() => p.onOpenTask(task.id, t.subject || t.peerName)} className={linkBtn}>Open task</button>
            <button disabled={busy} onClick={() => link(null)} className={linkBtn}>Unlink</button>
          </div>
        </> : <>
          <p className="mb-2 text-muted">Link it and every new message here lands on the task too.</p>
          <input ref={linkSearchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={client ? `Search ${client}'s tasks` : "Search tasks"} className="h-10 w-full rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
          {q && <div className="mt-1.5 space-y-1">
            {matches.map((x) => (
              <button key={x.id} disabled={busy} onClick={() => link(x.id)} className="block w-full rounded-lg bg-background px-3 py-2 text-left hover:bg-accent-soft">
                {x.title}<span className="block text-[14px] text-muted">{p.clientName(x.clientId)}{x.due ? `, due ${x.due}` : ""}</span>
              </button>
            ))}
          </div>}
        </>}
      </div>

      <div className={card}>
        <div className={label}>{(task ? `${first.toUpperCase()}'S OTHER OPEN TASKS` : `${first.toUpperCase()}'S OPEN TASKS`)}</div>
        {otherTasks.length === 0 && <p className="text-muted">None open.</p>}
        {otherTasks.map((x) => (
          <div key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t py-2 first-of-type:border-t-0">
            <button onClick={() => p.onOpenTask(x.id, t.subject || t.peerName)} className="min-w-0 text-left">
              <span className="block truncate font-semibold">{x.title}</span>
              <span className="block truncate text-muted">{STATUS_META[x.status].label}{x.due ? ` · ${dueLabel(x.due)}` : ""}</span>
            </button>
            <button disabled={busy} onClick={() => link(x.id)} className={`${linkBtn} whitespace-nowrap`}>Link here</button>
          </div>
        ))}
        <button disabled={busy} onClick={async () => { setBusy(true); const id = await p.onNewTask(t); if (id) await link(id); setBusy(false); }} className={`${linkBtn} mt-2`}>＋ New task from this</button>
      </div>

      {otherConvs.length > 0 && (
        <div className={card}>
          <div className={label}>OTHER CONVERSATIONS WITH {first.toUpperCase()}</div>
          {otherConvs.map((x) => (
            <button key={x.key} onClick={() => onOpenOther(x.key)} className="grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-t py-2 text-left first-of-type:border-t-0 hover:bg-background">
              <span>{CHANNEL_ICON[x.channel]}</span>
              <span className="min-w-0">
                <span className={`block truncate ${x.unread ? "font-bold" : "font-semibold"}`}>{x.subject || CHANNEL_LABEL[x.channel]}</span>
                <span className="block truncate text-muted">{(x.latest.body || "").replace(/\s+/g, " ").slice(0, 80)}</span>
              </span>
              <span className="whitespace-nowrap text-muted">{shortTime(x.latest.at)}</span>
            </button>
          ))}
        </div>
      )}

      <div className={card}>
        <div className={label}>{contact || client ? "CONTACT" : "FROM"}</div>
        <b className="block text-[18px]">{person}</b>
        {(contact?.company || (client && client !== person)) && <div className="text-muted">🏢 {contact?.company || client}</div>}
        {(email || phone) && (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
            {email && <><span className="break-all">{email}</span><button onClick={() => copyText(email, p)} className={linkBtn}>Copy</button></>}
            {phone && <><span>{phone}</span><button onClick={() => copyText(phone, p)} className={linkBtn}>Copy</button></>}
          </div>
        )}
        {client ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {t.clientId && <button onClick={() => p.onOpenClient(t.clientId!)} className={linkBtn}>Open client</button>}
            {ghlUrl && <a href={ghlUrl} target="_blank" rel="noopener noreferrer" className={linkBtn}>Open in GoHighLevel</a>}
          </div>
        ) : <AddToClient p={p} t={t} />}
      </div>
    </aside>
  );
}

// Someone who wrote in but is not a contact yet: put them on a client you
// have, or make a new one (admins). Their messages move onto it, and what they
// send next lands there by itself.
function AddToClient({ p, t }: { p: InboxViewProps; t: InboxThread }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? p.clients.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 6) : [];
  const add = async (to: { clientId?: string; newClientName?: string }, label: string) => {
    setBusy(true);
    try { await p.inbox.addContact(t.key, to); p.pushToast(`Added to ${label}`); setOpen(false); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't add them."); }
    finally { setBusy(false); }
  };
  if (!open) return (
    <div className="mt-1 grid gap-2">
      <div className="rounded-md bg-highlight-soft px-2 py-1 font-semibold text-highlight">Not a contact yet</div>
      <button onClick={() => setOpen(true)} className="h-10 rounded-lg bg-accent font-bold text-white">＋ Add to a client</button>
    </div>
  );
  return (
    <div className="mt-2 grid gap-2">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your clients" className="h-10 rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
      {hits.map((c) => <button key={c.id} disabled={busy} onClick={() => add({ clientId: c.id }, c.name)} className="rounded-lg bg-background px-3 py-2 text-left hover:bg-accent-soft">🏢 {c.name}</button>)}
      {p.canAdmin && <button disabled={busy} onClick={() => add({ newClientName: q.trim() || t.peerName }, q.trim() || t.peerName)} className="h-10 rounded-lg border font-semibold hover:bg-background">＋ New client “{q.trim() || t.peerName}”</button>}
      <button onClick={() => setOpen(false)} className="text-muted hover:underline">Cancel</button>
    </div>
  );
}

// ── A new message: an email or a text to anyone in GoHighLevel ────────────
// Search every contact by name, email, company or phone, or type any email
// address (Derek, 2026-10-01). Fills the page; CC, BCC, files, and the task
// it belongs to, so the conversation lands there from the first message.
type Pick = { contactId?: string; name: string; address: string };
function NewMessage({ p, start, onClose }: { p: InboxViewProps; start: { to?: string; body?: string }; onClose: () => void }) {
  const [kind, setKind] = useState<"email" | "text">("email");
  const [to, setTo] = useState<Pick | null>(start.to ? { name: start.to, address: start.to } : null);
  const [q, setQ] = useState("");
  const [ccOpen, setCcOpen] = useState(false);
  const [cc, setCc] = useState(""); const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(""); const [body, setBody] = useState(start.body ?? "");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [taskQ, setTaskQ] = useState("");
  const [busy, setBusy] = useState<"send" | "ai" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(() => {
    if (!words.length) return [];
    const digits = q.replace(/\D/g, "");
    return p.contacts.filter((c) => (kind === "email" ? !!c.email : !!c.phone) && words.every((w) =>
      `${c.name} ${c.email ?? ""} ${c.company ?? ""}`.toLowerCase().includes(w) || (digits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(digits))))
      .slice(0, 8);
  }, [q, kind, p.contacts]); // eslint-disable-line react-hooks/exhaustive-deps
  const typedEmail = kind === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.trim()) ? q.trim() : null;
  const taskHits = taskQ.trim() ? p.tasks.filter((t) => t.status !== "done" && `${t.title} ${p.clientName(t.clientId) ?? ""}`.toLowerCase().includes(taskQ.trim().toLowerCase())).slice(0, 6) : [];

  const upload = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) { const a = await p.onUpload(`inbox/${p.me.id}`, f); if (a) setFiles((x) => [...x, a]); }
  };
  const send = async () => {
    if (!to || !body.trim()) return;
    setBusy("send");
    try {
      const r = kind === "email"
        ? await p.inbox.send({ to: to.address, cc: cc.split(/[,\s]+/).filter(Boolean), bcc: bcc.split(/[,\s]+/).filter(Boolean), subject, body, attachments: files.filter((f) => f.path).map((f) => ({ path: f.path!, name: f.name })) })
        : await p.inbox.send({ channel: "sms", contactId: to.contactId, body });
      if (task && r.threadKey) await p.inbox.linkTask(r.threadKey, task.id).catch(() => null);
      p.pushToast(task ? `Sent, and linked to ${task.title}` : "Sent");
      onClose();
    } catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't send it."); }
    finally { setBusy(null); }
  };
  const row = "flex items-center gap-3 border-b py-2";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-5 lg:px-7">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={onClose} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">← Back</button>
        <h1 className="text-[26px] font-extrabold">New message</h1>
        <span className="inline-flex gap-1 rounded-lg bg-background p-1">
          <button onClick={() => { setKind("email"); setTo(null); }} className={`rounded-md px-3 py-1.5 font-semibold ${kind === "email" ? "bg-surface ring-1 ring-[var(--border)]" : ""}`}>✉️ Email</button>
          <button onClick={() => { setKind("text"); setTo(null); }} className={`rounded-md px-3 py-1.5 font-semibold ${kind === "text" ? "bg-surface ring-1 ring-[var(--border)]" : ""}`}>💬 Text</button>
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 min-w-0 flex-col rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
          <div className="mb-1 text-muted">{kind === "email" ? "From your Gmail" : "From the contact's GoHighLevel number"}</div>
          <div className={`relative ${row}`}>
            <span className="w-16 shrink-0 text-muted">To</span>
            {to ? (
              <span className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate rounded-full bg-accent-soft px-3 py-1 font-semibold text-accent">{to.name}{to.name !== to.address ? ` · ${to.address}` : ""}</span><button onClick={() => setTo(null)} aria-label="Remove" className="text-muted">✕</button></span>
            ) : (
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "email" ? "Search contacts, or type an email" : "Search contacts by name or phone"}
                onKeyDown={(e) => { if (e.key === "Enter" && typedEmail) { setTo({ name: typedEmail, address: typedEmail }); setQ(""); } }}
                className="h-9 min-w-0 flex-1 bg-transparent outline-none" />
            )}
            {kind === "email" && <button onClick={() => setCcOpen(!ccOpen)} className="shrink-0 rounded-md px-2 py-1 font-semibold text-accent hover:bg-background">CC / BCC</button>}
            {!to && (hits.length > 0 || typedEmail) && (
              <div className="absolute left-16 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                {typedEmail && <button onClick={() => { setTo({ name: typedEmail, address: typedEmail }); setQ(""); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">Send to <b>{typedEmail}</b></button>}
                {hits.map((c) => (
                  <button key={c.id} onClick={() => { setTo({ contactId: c.id, name: c.name, address: (kind === "email" ? c.email : c.phone) ?? "" }); setQ(""); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">
                    <b className="block">{c.name}{c.company && c.company !== c.name ? <span className="font-normal text-muted"> · {c.company}</span> : null}</b>
                    <span className="text-[14px] text-muted">{kind === "email" ? c.email : c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {kind === "email" && ccOpen && <>
            <label className={row}><span className="w-16 shrink-0 text-muted">CC</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Add people, separated by commas" className="h-9 min-w-0 flex-1 bg-transparent outline-none" /></label>
            <label className={row}><span className="w-16 shrink-0 text-muted">BCC</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Add people, separated by commas" className="h-9 min-w-0 flex-1 bg-transparent outline-none" /></label>
          </>}
          {kind === "email" && <label className={row}><span className="w-16 shrink-0 text-muted">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 min-w-0 flex-1 bg-transparent outline-none" /></label>}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "email" ? "Write your email" : "Write a text"} className="min-h-48 w-full flex-1 resize-none bg-transparent py-3 leading-relaxed outline-none" />
          {files.length > 0 && <div className="flex flex-wrap gap-2 pb-2">{files.map((f) => <span key={f.id} className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 ring-1 ring-[var(--border)]">{f.kind === "image" ? "🖼️" : "📄"} {f.name}<button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remove ${f.name}`} className="text-muted">✕</button></span>)}</div>}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {kind === "email" && <>
              <button onClick={() => fileRef.current?.click()} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">📎 Attach</button>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </>}
            <button disabled={busy !== null || !body.trim()} onClick={async () => { setBusy("ai"); const r = await p.inbox.improve(body, kind === "email" ? "email" : "sms").catch(() => null); setBusy(null); if (r?.changed) setBody(r.text); p.pushToast(r ? (r.changed ? "Fixed spelling and grammar" : "Looks good already") : "Couldn't improve it"); }} className="h-10 rounded-lg bg-[#f3efff] px-3 font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50">{busy === "ai" ? "✨ Improving…" : "✨ Improve with AI"}</button>
            <span className="flex-1" />
            {kind === "text" && <span className="tabular-nums text-muted">{body.length} / 160</span>}
            <button disabled={busy !== null || !to || !body.trim()} onClick={send} className="h-10 rounded-lg bg-accent px-6 font-bold text-white disabled:opacity-50">{busy === "send" ? "Sending…" : "Send"}</button>
          </div>
        </div>
        <aside className="min-w-0 space-y-3">
          <div className="rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
            <div className="mb-2 text-[14px] font-bold tracking-wide text-accent">LINK TO A TASK</div>
            {task ? (
              <div className="flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2.5"><span className="min-w-0 flex-1"><b className="block">{task.title}</b><span className="text-[14px] text-muted">{p.clientName(task.clientId)}</span></span><button onClick={() => setTask(null)} aria-label="Remove" className="text-muted">✕</button></div>
            ) : <>
              <p className="mb-2 text-muted">Optional. Replies land on the task too.</p>
              <input value={taskQ} onChange={(e) => setTaskQ(e.target.value)} placeholder="Search tasks" className="h-10 w-full rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
              <div className="mt-1.5 space-y-1">{taskHits.map((t) => <button key={t.id} onClick={() => { setTask(t); setTaskQ(""); }} className="block w-full rounded-lg bg-background px-3 py-2 text-left hover:bg-accent-soft">{t.title}<span className="block text-[14px] text-muted">{p.clientName(t.clientId)}</span></button>)}</div>
            </>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Switch({ on, set, label, help }: { on: boolean; set: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span><b className="block font-semibold">{label}</b>{help && <span className="text-muted">{help}</span>}</span>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-5 w-9 shrink-0 accent-[var(--accent)]" />
    </label>
  );
}
function Box({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 rounded-xl bg-surface p-5 ring-1 ring-[var(--border)]"><h2 className="text-[19px] font-bold">{title}</h2>{help && <p className="-mt-1 text-muted">{help}</p>}{children}</section>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────
function InboxSettings(p: InboxViewProps) {
  const { prefs, setPrefs } = p;
  const [name, setName] = useState(""); const [text, setText] = useState("");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid max-w-[1280px] gap-4 p-5 lg:p-7">
        <div><h1 className="text-[26px] font-extrabold">Inbox settings</h1><p className="text-muted">Yours only. Justin and Michaella keep their own.</p></div>
        <Box title="List">
          <Switch on={prefs.byDay} set={(v) => setPrefs({ byDay: v })} label="Group by day" help="Today, Yesterday, Earlier this week" />
          <Switch on={prefs.showClientAndTask} set={(v) => setPrefs({ showClientAndTask: v })} label="Show client and task on each row" help="Off keeps the subject and preview roomy" />
        </Box>
        <Box title="Email signature" help="Added under every email you send, from the Inbox and from tasks. Texts never get it.">
          <SignaturePanel />
        </Box>
        <Box title="Saved replies" help="Pick one from ⚡ Saved replies in any reply box.">
          {prefs.replies.map((r, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg bg-background px-3 py-2.5">
              <div className="min-w-0 flex-1"><b className="block">{r.name}</b><span className="text-muted">{r.text}</span></div>
              <button onClick={() => setPrefs({ replies: prefs.replies.filter((_, j) => j !== i) })} aria-label={`Delete ${r.name}`} className="text-muted">✕</button>
            </div>
          ))}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, like Running late" className="h-10 rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="The reply" rows={2} className="rounded-lg border bg-surface px-3 py-2 outline-none focus:border-accent" />
          <button disabled={!name.trim() || !text.trim()} onClick={() => { setPrefs({ replies: [...prefs.replies, { name: name.trim(), text: text.trim() }] }); setName(""); setText(""); }} className="h-10 rounded-lg border font-semibold hover:bg-background disabled:opacity-50">＋ Add saved reply</button>
        </Box>
        <Box title="Gmail" help="Keeps your Gmail in step with this Inbox, so its unread count matches. Texts and GoHighLevel messages are never changed.">
          <Switch on={prefs.gmailRead} set={(v) => setPrefs({ gmailRead: v })} label="Mark read in Gmail too" help="Opening a message here marks it read there; Mark as unread puts it back" />
          <Switch on={prefs.gmailArchive} set={(v) => setPrefs({ gmailArchive: v })} label="Archive here archives in Gmail too" help="It leaves your Gmail inbox but is never deleted; Undo puts it back" />
        </Box>
        <Box title="Blocked senders" help="Nothing from these shows in your Inbox. Block someone from the ⛔ Block button on their message.">
          {p.inbox.blocks.length ? p.inbox.blocks.map((b) => (
            <div key={b} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
              <span className="break-all">{b.startsWith("@") ? `Everyone at ${b.slice(1)}` : b}</span>
              <button onClick={() => p.inbox.unblock(b)} className="h-9 shrink-0 rounded-md border px-3 font-semibold hover:bg-surface">Unblock</button>
            </div>
          )) : <div className="text-muted">Nobody blocked.</div>}
        </Box>
        <Box title="Sending">
          <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
            <span><b className="block font-semibold">Undo send</b><span className="text-muted">Time to take a message back after Send</span></span>
            <span className="inline-flex gap-1 rounded-lg bg-background p-1">
              {([0, 5, 10, 30] as const).map((n) => <button key={n} onClick={() => setPrefs({ undoSeconds: n })} className={`rounded-md px-3 py-1.5 font-semibold ${prefs.undoSeconds === n ? "bg-surface ring-1 ring-[var(--border)]" : ""}`}>{n ? `${n} s` : "Off"}</button>)}
            </span>
          </div>
          <Switch on={prefs.aiNudge} set={(v) => setPrefs({ aiNudge: v })} label="Check for typos when I press Send" help="Offers a fix first if the AI finds spelling or grammar mistakes" />
        </Box>
        <Box title="Alerts">
          <Switch on={prefs.badge} set={(v) => setPrefs({ badge: v })} label="Unread count in the sidebar" />
          <Switch on={prefs.popup} set={(v) => { setPrefs({ popup: v }); if (v) askAlertPermission(); }} label="Pop up for new messages" help="A browser alert while ClickUpTasks is open in another tab" />
          <Switch on={prefs.sound} set={(v) => setPrefs({ sound: v })} label="Play a sound" />
        </Box>
        <Box title="Where messages come from" help="Your Gmail is read every 15 minutes, and GoHighLevel 7 minutes after. Tokens are in Settings, Integrations.">
          <div>✉️ <b>Gmail</b>: {p.me.email}</div>
          <div>💬 <b>GoHighLevel</b>: texts, calls, Facebook, Instagram, website chat and Google Business, for every connected sub-account</div>
        </Box>
      </div>
    </div>
  );
}

// "Justin is writing a reply right now": who has this conversation's reply
// box open with something typed, shared live through Supabase presence.
function usePresence(me: { id: string; name: string }, threadKey: string): string | null {
  const [others, setOthers] = useState<string | null>(null);
  useEffect(() => {
    const ch = supabase.channel("inbox-presence", { config: { presence: { key: me.id } } });
    const sync = () => {
      const state = ch.presenceState() as Record<string, { name: string; thread: string; typing: boolean }[]>;
      const who = Object.entries(state).filter(([k]) => k !== me.id).flatMap(([, v]) => v).find((v) => v.thread === threadKey && v.typing);
      setOthers(who?.name ?? null);
    };
    ch.on("presence", { event: "sync" }, sync).subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track({ name: me.name.split(/\s+/)[0], thread: threadKey, typing: false });
    });
    // Only this conversation's reply box counts, and only a change between
    // typing and not typing is sent, never every key.
    let typing = false;
    const onInput = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName !== "TEXTAREA" || el.getAttribute("data-inbox-composer") !== threadKey) return;
      const now = !!(el as HTMLTextAreaElement).value.trim();
      if (now === typing) return;
      typing = now;
      ch.track({ name: me.name.split(/\s+/)[0], thread: threadKey, typing });
    };
    document.addEventListener("input", onInput);
    return () => { document.removeEventListener("input", onInput); supabase.removeChannel(ch); };
  }, [me.id, me.name, threadKey]);
  return others;
}
