"use client";

// The Inbox (Derek, 2026-10-01): every email, text, social message, call and
// task chat in one place, so nobody has to check Gmail and two GoHighLevel
// logins. Laid out like Pipedrive's Sales Inbox, which Derek sent as the
// model: a folder list on the left, two line rows, and an open conversation
// that replaces the list, with the task it belongs to on the right.
// Mockup he picked: https://claude.ai/artifact/HQwjkE4nCCx4QqFWcPLFQX
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitQuotedEmail, tidyEmailText, type Attachment, type Message, type Task } from "@/lib/data";
import { authedFetch, supabase } from "@/lib/supabase";
import SignaturePanel from "../../SignaturePanel";
import {
  CHANNEL_ICON, CHANNEL_LABEL, bodyParts, isLinkHeavy, dayGroup, inFolder, matchesSearch, shortTime, snoozeUntil, whereIs,
  type Folder, type InboxThread,
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
  onOpenTask: (taskId: string) => void;
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
};

const FOLDERS: { id: Folder; label: string; icon: string }[] = [
  { id: "inbox", label: "Inbox", icon: "📥" }, { id: "drafts", label: "Drafts", icon: "📝" },
  { id: "snoozed", label: "Snoozed", icon: "⏰" }, { id: "sent", label: "Sent", icon: "📤" }, { id: "done", label: "Done", icon: "✓" },
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
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export default function InboxView(p: InboxViewProps) {
  const { inbox, prefs } = p;
  const [folder, setFolder] = useState<Folder | "settings">("inbox");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composeNew, setComposeNew] = useState(false);
  const [drafts, setDrafts] = useState<Set<string>>(() => draftKeys(p.me.id));
  const refreshDrafts = useCallback(() => setDrafts(draftKeys(p.me.id)), [p.me.id]);

  const visible = useMemo(() => {
    if (folder === "settings") return [];
    if (q.trim()) return inbox.threads.filter((t) => matchesSearch(t, q, p.clientName(t.clientId)));
    return inbox.threads.filter((t) => inFolder(t, folder, (k) => drafts.has(k)));
  }, [inbox.threads, folder, q, drafts, p]);
  const open = openKey ? inbox.threads.find((t) => t.key === openKey) ?? null : null;

  const count = (f: Folder) => f === "drafts" ? drafts.size : inbox.threads.filter((t) => t.unread && inFolder(t, f, () => false)).length;

  const undoToast = (text: string, undo: () => Promise<void> | void) => p.pushToast(text, { label: "Undo", run: () => { undo(); } });
  const done = async (keys: string[]) => {
    const undo = await inbox.markDone(keys);
    undoToast(keys.length > 1 ? `${keys.length} marked done` : "Marked done", undo);
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

  // Left hand keys, as in Gmail: J next, K previous, E done, R read, S snooze, T link.
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const linkSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || folder === "settings") return;
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 text-[16px]">
      {/* Folders */}
      <nav className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-background/40 p-3 md:flex">
        <button onClick={() => { setComposeNew(true); setOpenKey(null); setFolder("inbox"); }} className="mb-3 h-11 rounded-lg bg-accent font-semibold text-white">＋ New email</button>
        {FOLDERS.map((f) => <FolderButton key={f.id} f={f} active={folder === f.id && !q} count={prefs.badge || f.id !== "inbox" ? count(f.id) : 0} onClick={() => { setFolder(f.id); setOpenKey(null); setQ(""); }} />)}
        <div className="mx-3 mb-1 mt-4 text-[13px] font-bold tracking-wide text-muted">SHOW ONLY</div>
        {FILTERS.map((f) => <FolderButton key={f.id} f={f} active={folder === f.id && !q} count={count(f.id)} onClick={() => { setFolder(f.id); setOpenKey(null); setQ(""); }} />)}
        <div className="mt-auto border-t pt-3">
          <FolderButton f={{ id: "inbox", label: "Settings", icon: "⚙️" }} active={folder === "settings"} count={0} onClick={() => { setFolder("settings"); setOpenKey(null); }} />
        </div>
      </nav>

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Phone: folders as a menu */}
        <div className="flex gap-2 border-b p-3 md:hidden">
          <button onClick={() => { setComposeNew(true); setOpenKey(null); }} className="h-11 shrink-0 rounded-lg bg-accent px-4 font-semibold text-white">＋ New</button>
          <select aria-label="Folder" value={folder} onChange={(e) => { setFolder(e.target.value as Folder | "settings"); setOpenKey(null); }} className="h-11 min-w-0 flex-1 rounded-lg border bg-surface px-3 font-semibold">
            {[...FOLDERS, ...FILTERS].map((f) => <option key={f.id} value={f.id}>{f.label}{count(f.id) ? ` (${count(f.id)})` : ""}</option>)}
            <option value="settings">Settings</option>
          </select>
        </div>

        {folder === "settings" ? <InboxSettings {...p} />
          : composeNew ? <NewEmail p={p} onClose={() => setComposeNew(false)} />
          : open ? <ThreadView p={p} t={open} back={back} done={() => { back(); done([open.key]); }} del={() => { back(); del([open.key], open.trashed); }} snoozeOpen={snoozeOpen} setSnoozeOpen={setSnoozeOpen} linkSearchRef={linkSearchRef} onDraft={refreshDrafts} />
          : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                <input type="checkbox" aria-label="Select all" className="h-5 w-5" checked={selected.size > 0 && selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((t) => t.key)) : new Set())} />
                <button onClick={() => inbox.reload()} title="Refresh" className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">↻</button>
                {selected.size > 0 && <>
                  <button onClick={async () => { const undo = await inbox.markRead([...selected]); setSelected(new Set()); undoToast(`${selected.size} marked read`, undo); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">Mark read</button>
                  <button onClick={() => { done([...selected]); setSelected(new Set()); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">Done</button>
                  <button onClick={() => { del([...selected], folder === "trash"); setSelected(new Set()); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">{folder === "trash" ? "Restore" : "🗑 Delete"}</button>
                </>}
                <span className="ml-auto text-muted">{q.trim() ? `${visible.length} result${visible.length === 1 ? "" : "s"}` : `${visible.length} conversation${visible.length === 1 ? "" : "s"}`}</span>
                <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpenKey(null); }} placeholder="Search people, words, files" aria-label="Search the Inbox"
                  className="h-10 w-full rounded-lg border bg-surface px-3 outline-none focus:border-accent sm:w-72" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {inbox.error && <div className="m-4 rounded-lg bg-danger-soft p-3 text-danger">{inbox.error}</div>}
                {!inbox.loading && !visible.length && (
                  <div className="px-6 py-16 text-center text-muted">
                    <div className="text-[21px] font-bold text-foreground">{folder === "inbox" && !q ? "All caught up" : folder === "trash" ? "Trash is empty" : "Nothing here"}</div>
                    {folder === "inbox" && !q && <div className="mt-1">Every message is answered, snoozed or done.</div>}
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
                        onOpen={() => openThread(t)} />
                    </div>
                  );
                })}
              </div>
              <div className="hidden gap-4 border-t bg-background/40 px-5 py-2 text-[14px] text-muted lg:flex">
                <span><Kbd>J</Kbd> Next</span><span><Kbd>K</Kbd> Previous</span><span><Kbd>Space</Kbd> Open</span><span><Kbd>E</Kbd> Done</span><span><Kbd>D</Kbd> Delete</span><span><Kbd>R</Kbd> Read</span><span><Kbd>S</Kbd> Snooze</span><span><Kbd>T</Kbd> Link task</span>
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

function Row({ t, p, active, checked, draft, where, onCheck, onOpen }: { t: InboxThread; p: InboxViewProps; active: boolean; checked: boolean; draft: boolean; where: string | null; onCheck: (v: boolean) => void; onOpen: () => void }) {
  // Words first: links in the preview are just noise.
  const preview = bodyParts(splitQuotedEmail(t.latest.body || "").visible || t.latest.body || "")
    .map((x) => ("text" in x ? x.text : "")).join(" ").replace(/\s+/g, " ").replace(/\[\s*\]/g, "").trim();
  const client = p.clientName(t.clientId);
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  return (
    <div onClick={onOpen} className={`grid cursor-pointer grid-cols-[20px_40px_minmax(0,1fr)] items-center gap-3.5 border-b px-5 py-3 ${active ? "bg-accent-soft" : "hover:bg-background/60"}`}
      style={t.unread ? { boxShadow: "inset 3px 0 0 #2563eb" } : undefined}>
      <input type="checkbox" aria-label={`Select ${t.peerName}`} className="h-[18px] w-[18px]" checked={checked} onClick={(e) => e.stopPropagation()} onChange={(e) => onCheck(e.target.checked)} />
      <Avatar t={t} />
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`truncate ${t.unread ? "font-extrabold" : ""}`}>{t.peerName}</span>
          {t.count > 1 && <span className="text-[14px] text-muted">{t.count}</span>}
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 tabular-nums ${t.unread ? "font-bold text-[#2563eb]" : "text-muted"}`}>
            {t.hasFiles && <span title="Has attachments">📎</span>}
            {t.snoozed && t.snoozedUntil ? `⏰ ${shortTime(t.snoozedUntil)}` : shortTime(t.latest.at)}
          </span>
        </div>
        <div className="truncate text-muted">
          {draft && <span className="mr-2 font-bold text-danger">Draft</span>}
          {where && where !== "Inbox" && <span className="mr-2 rounded bg-background px-1.5 font-semibold">{where}</span>}
          {t.subject && <span className={`mr-2 text-foreground ${t.unread ? "font-extrabold" : "font-semibold"}`}>{t.subject}</span>}
          {preview}
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
function ThreadView({ p, t, back, done, del, snoozeOpen, setSnoozeOpen, linkSearchRef, onDraft }: {
  p: InboxViewProps; t: InboxThread; back: () => void; done: () => void; del: () => void;
  snoozeOpen: boolean; setSnoozeOpen: (v: boolean) => void; linkSearchRef: React.RefObject<HTMLInputElement | null>; onDraft: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
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
      <div className="relative flex flex-wrap gap-2 border-b px-4 py-2.5">
        <button onClick={back} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">← Back</button>
        <button onClick={done} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">✓ Done</button>
        <div className="relative">
          <button onClick={() => setSnoozeOpen(!snoozeOpen)} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">⏰ Snooze</button>
          {snoozeOpen && (
            <Menu onClose={() => setSnoozeOpen(false)}>
              {([["1h", "In 1 hour"], ["3h", "In 3 hours"], ["tomorrow", "Tomorrow, 9 AM"], ["monday", "Monday, 9 AM"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => snooze(k)} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">{l}</button>
              ))}
            </Menu>
          )}
        </div>
        <button onClick={async () => { await p.inbox.markUnread([t.key]); back(); }} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">Mark as unread</button>
        <button onClick={del} title={t.trashed ? "Bring it back" : t.channel === "email" ? "Moves it to Trash here and in Gmail (kept 30 days)" : "Moves it to Trash here"} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">{t.trashed ? "↩ Restore" : "🗑 Delete"}</button>
        {t.peerAddress && !t.trashed && (
          <div className="relative">
            <button onClick={() => setBlockOpen(!blockOpen)} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">⛔ Block</button>
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
        {isGhl && (
          <div className="relative">
            <button onClick={() => setAssignOpen(!assignOpen)} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">👤 Assign</button>
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
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
        <div className="min-w-0 px-5 py-5 lg:overflow-y-auto lg:px-7">
          <h1 className="mb-4 text-[26px] font-extrabold leading-tight" style={{ textWrap: "balance" }}>{t.subject || (t.channel === "email" ? t.peerName : `${CHANNEL_LABEL[t.channel]} with ${t.peerName}`)}</h1>
          {typing && <div className="mb-3 rounded-lg bg-highlight-soft px-4 py-2.5 font-semibold text-highlight">{typing} is writing a reply right now</div>}
          <Composer key={t.key} p={p} t={t} onSent={() => { onDraft(); }} onDraft={onDraft} />
          <div className="mt-5 space-y-3">
            {t.messages.map((m) => <MessageCard key={m.id} m={m} t={t} p={p} />)}
          </div>
        </div>
        <SidePanel p={p} t={t} linkSearchRef={linkSearchRef} />
      </div>
    </div>
  );
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-12 z-50 min-w-60 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">{children}</div>
    </>
  );
}

function MessageCard({ m, t, p }: { m: Message; t: InboxThread; p: InboxViewProps }) {
  const mine = m.direction === "outbound";
  const who = mine ? (p.team.find((x) => x.id === m.createdBy)?.name ?? "You") : t.peerName;
  return (
    <div className={`rounded-xl px-4 py-3.5 ring-1 ring-[var(--border)] ${mine ? "bg-background/50" : "bg-surface"}`}>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <b>{who}</b>
        <span className="text-muted">{new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        {m.channel !== t.channel && <span className="text-muted">{CHANNEL_ICON[m.channel]} {CHANNEL_LABEL[m.channel]}</span>}
        {(m.cc?.length ?? 0) > 0 && <span className="text-[14px] text-muted">CC {m.cc.join(", ")}</span>}
      </div>
      <EmailBody body={m.body} />
      {m.attachments?.length > 0 && <Files m={m} p={p} />}
    </div>
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
function Composer({ p, t, onSent, onDraft }: { p: InboxViewProps; t: InboxThread; onSent: () => void; onDraft: () => void }) {
  const email = isEmailThread(t);
  const [text, setText] = useState(() => readDraft(p.me.id, t.key));
  const [ccOpen, setCcOpen] = useState(false);
  const [cc, setCc] = useState(""); const [bcc, setBcc] = useState("");
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
      to: email ? (t.peerAddress ?? undefined) : undefined,
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
    <div className="rounded-xl bg-surface p-3 ring-1 ring-[var(--border)]">
      <div className="mb-1 text-muted">{from}</div>
      {email && (
        <div className="flex flex-wrap items-center gap-2 border-b py-1.5">
          <span className="w-11 text-muted">To</span><span className="min-w-0 flex-1 truncate">{t.peerAddress}</span>
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
      <textarea value={text} onChange={(e) => change(e.target.value)} placeholder={`Write to ${t.peerName.split(/\s+/)[0]}`} rows={4}
        className="mt-1 w-full resize-y bg-transparent py-2 leading-relaxed outline-none" />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {files.map((f) => <span key={f.id} className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 ring-1 ring-[var(--border)]">{f.kind === "image" ? "🖼️" : "📄"} {f.name}<button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remove ${f.name}`} className="text-muted">✕</button></span>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
        {t.channel !== "chat" && email && <>
          <button onClick={() => fileRef.current?.click()} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">📎 Attach</button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </>}
        <div className="relative">
          <button onClick={() => setRepliesOpen(!repliesOpen)} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">⚡ Saved replies</button>
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
        <button onClick={improve} disabled={busy !== null || !text.trim()} className="h-10 rounded-lg bg-[#f3efff] px-3 font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50">{busy === "improve" ? "✨ Improving…" : "✨ Improve with AI"}</button>
        <span className="flex-1" />
        {(t.channel === "sms" || t.channel === "call") && <span className="tabular-nums text-muted">{text.length} / 160</span>}
        <div className="relative flex">
          <button onClick={() => send()} disabled={busy !== null || !text.trim()} className={`h-10 bg-accent px-5 font-bold text-white disabled:opacity-50 ${p.onSchedule && t.clientId ? "rounded-l-lg" : "rounded-lg"}`}>{busy === "send" ? "Checking…" : "Send"}</button>
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
function SidePanel({ p, t, linkSearchRef }: { p: InboxViewProps; t: InboxThread; linkSearchRef: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  const client = p.clientName(t.clientId);
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return p.tasks
      .filter((x) => x.status !== "done" && (!t.clientId || x.clientId === t.clientId || words.length > 0))
      .filter((x) => words.every((w) => x.title.toLowerCase().includes(w) || (p.clientName(x.clientId) ?? "").toLowerCase().includes(w)))
      .slice(0, 6);
  }, [q, p, t.clientId]);
  const link = async (taskId: string | null) => {
    setBusy(true);
    try { await p.inbox.linkTask(t.key, taskId); p.pushToast(taskId ? "Linked. New messages here land on the task too." : "Unlinked"); setQ(""); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't link it."); }
    finally { setBusy(false); }
  };
  return (
    <aside className="space-y-3.5 border-t bg-background/40 p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
      <div className="rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
        <div className="mb-2 text-[14px] font-bold tracking-wide text-accent">{task ? "LINKED TASK" : "LINK TO A TASK"}</div>
        {task ? <>
          <div className="rounded-lg bg-success-soft px-3 py-2.5"><b className="block">{task.title}</b><span className="text-[14px] text-muted">{p.clientName(task.clientId)}</span></div>
          <button onClick={() => p.onOpenTask(task.id)} className="mt-2 h-10 w-full rounded-lg border font-semibold hover:bg-background">Open task</button>
          <button disabled={busy} onClick={() => link(null)} className="mt-2 h-10 w-full rounded-lg border font-semibold hover:bg-background">Unlink</button>
        </> : <>
          <p className="mb-2 text-muted">Link it and every new message here lands on the task too.</p>
          <input ref={linkSearchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={client ? `Search ${client}'s tasks` : "Search tasks"} className="h-10 w-full rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
          {(q || t.clientId) && <div className="mt-1.5 space-y-1">
            {matches.map((x) => (
              <button key={x.id} disabled={busy} onClick={() => link(x.id)} className="block w-full rounded-lg bg-background px-3 py-2 text-left hover:bg-accent-soft">
                {x.title}<span className="block text-[14px] text-muted">{p.clientName(x.clientId)}{x.due ? `, due ${x.due}` : ""}</span>
              </button>
            ))}
          </div>}
          <button disabled={busy} onClick={async () => { setBusy(true); const id = await p.onNewTask(t); if (id) await link(id); setBusy(false); }} className="mt-2 h-10 w-full rounded-lg bg-accent font-bold text-white">＋ New task from this</button>
        </>}
      </div>
      <div className="rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
        <div className="mb-1 text-[14px] font-bold tracking-wide text-accent">FROM</div>
        <b className="block text-[18px]">{t.peerName}</b>
        {t.peerAddress && t.peerAddress !== t.peerName && <div className="break-all text-muted">{t.peerAddress}</div>}
        {client ? <div className="text-muted">🏢 {client}</div> : <div className="mt-1 rounded-md bg-highlight-soft px-2 py-1 font-semibold text-highlight">Not a contact yet</div>}
        <div className="mt-1 text-muted">{CHANNEL_ICON[t.channel]} {CHANNEL_LABEL[t.channel]}</div>
      </div>
    </aside>
  );
}

// ── New email to anyone ───────────────────────────────────────────────────
function NewEmail({ p, onClose }: { p: InboxViewProps; onClose: () => void }) {
  const [to, setTo] = useState(""); const [cc, setCc] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await p.inbox.send({ to, cc: cc.split(/[,\s]+/).filter(Boolean), subject, body }); p.pushToast("Sent"); onClose(); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't send it."); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7">
      <div className="mb-4 flex items-center gap-3"><button onClick={onClose} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">← Back</button><h1 className="text-[26px] font-extrabold">New email</h1></div>
      <div className="max-w-3xl rounded-xl bg-surface p-3 ring-1 ring-[var(--border)]">
        <div className="mb-1 text-muted">From {p.me.email ?? "your Gmail"}</div>
        <label className="flex items-center gap-2 border-b py-1.5"><span className="w-16 text-muted">To</span><input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" className="h-8 min-w-0 flex-1 bg-transparent outline-none" /></label>
        <label className="flex items-center gap-2 border-b py-1.5"><span className="w-16 text-muted">CC</span><input value={cc} onChange={(e) => setCc(e.target.value)} className="h-8 min-w-0 flex-1 bg-transparent outline-none" /></label>
        <label className="flex items-center gap-2 border-b py-1.5"><span className="w-16 text-muted">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-8 min-w-0 flex-1 bg-transparent outline-none" /></label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Write your email" className="mt-1 w-full resize-y bg-transparent py-2 leading-relaxed outline-none" />
        <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
          <button disabled={busy || !body.trim()} onClick={async () => { const r = await p.inbox.improve(body, "email").catch(() => null); if (r?.changed) setBody(r.text); p.pushToast(r ? (r.changed ? "Fixed spelling and grammar" : "Looks good already") : "Couldn't improve it"); }} className="h-10 rounded-lg bg-[#f3efff] px-3 font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50">✨ Improve with AI</button>
          <span className="flex-1" />
          <button disabled={busy || !to.trim() || !body.trim()} onClick={send} className="h-10 rounded-lg bg-accent px-5 font-bold text-white disabled:opacity-50">{busy ? "Sending…" : "Send"}</button>
        </div>
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
          <Switch on={prefs.gmailArchive} set={(v) => setPrefs({ gmailArchive: v })} label="Done archives the email in Gmail" help="It leaves your Gmail inbox but is never deleted; Undo puts it back" />
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
          <Switch on={prefs.popup} set={(v) => setPrefs({ popup: v })} label="Pop up for new messages" help="A browser alert while ClickUpTasks is open in another tab" />
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
    const onInput = (e: Event) => { if ((e.target as HTMLElement)?.tagName === "TEXTAREA") ch.track({ name: me.name.split(/\s+/)[0], thread: threadKey, typing: !!(e.target as HTMLTextAreaElement).value.trim() }); };
    document.addEventListener("input", onInput);
    return () => { document.removeEventListener("input", onInput); supabase.removeChannel(ch); };
  }, [me.id, me.name, threadKey]);
  return others;
}
