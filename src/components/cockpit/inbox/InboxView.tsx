"use client";

// The Inbox (Derek, 2026-10-01): every email, text, social message, call and
// task chat in one place, so nobody has to check Gmail and two GoHighLevel
// logins. Laid out like Pipedrive's Sales Inbox, which Derek sent as the
// model: a folder list on the left, two line rows, and an open conversation
// that replaces the list, with the task it belongs to on the right.
// Mockup he picked: https://claude.ai/artifact/HQwjkE4nCCx4QqFWcPLFQX
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CLAUDE_ID, PERSONAL_CLIENT_ID, type Contact, WORKSPACE_CLIENT_ID, HIDDEN_STATUSES, STATUS_META, STATUS_ORDER, isOverdue, splitQuotedEmail, tidyEmailText, htmlToText, looksLikeHtml, plainTextToHtml, type Attachment, type Message, type Task } from "@/lib/data";
import { authedFetch, supabase } from "@/lib/supabase";
import { safeMessageHtml } from "@/lib/safeHtml";
import { createPortal } from "react-dom";
import SignaturePanel from "../../SignaturePanel";
import { RichTextEditor } from "../RichTextEditor";
import { SearchableSelect } from "../ui";
import { loadBookingLinks, type BookingLink } from "../useCalendar";
import { BookingLinkMenu } from "../BookingLinkMenu";
import { BookAppointment } from "../BookAppointment";
import type { Editor } from "@tiptap/react";
import {
  CHANNEL_ICON, CHANNEL_LABEL, CHAT_PAGE, chatItems, bodyParts, isLinkHeavy, dayGroup, dayLabel, inFolder, linksOnTask, matchesSearch, shortTime, snoozeUntil, whereIs,
  type ChatItem, type Folder, type InboxThread,
} from "./inboxModel";
import type { useInbox } from "./useInbox";
import { draftKeys, draftSaver, readDraft, writeDraft, type InboxPrefs } from "./inboxPrefs";
import { addPendingSend, removePendingSend, usePendingSends } from "./pendingSends";
import { allowEntry } from "@/lib/inbox";
import { isSignatureImage } from "@/lib/emailFiles";
import { guessFromSignature } from "@/lib/signature";
import { shortcut } from "@/lib/platform";
import { smsText } from "@/lib/smsText";

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
  openKey?: string | null;
  onOpenKey?: (key: string | null) => void;
  /** Makes a task for a conversation and returns its id. */
  onNewTask: (t: InboxThread, opts?: { title?: string; clientId?: string | null; projectId?: string | null; assigneeId?: string | null; due?: string | null }) => Promise<string | null>;
  /** Uploads a file the person attached; returns where it went. */
  onUpload: (prefix: string, file: File) => Promise<Attachment | null>;
  onSignedUrl: (path: string) => Promise<string | null>;
  /** Portal chat replies go through the app's own path. */
  onSendChat: (t: InboxThread, body: string) => Promise<void>;
  /** Send later, for a client's conversation (the app's scheduled sends). */
  onSchedule: ((t: InboxThread, body: string, at: Date) => Promise<void>) | null;
  pushToast: (text: string, action?: { label: string; run: () => void }, secondaryAction?: { label: string; run: () => void }, opts?: { quiet?: boolean }) => void;
  /** For Add to a client and a new text. */
  clients: { id: string; name: string }[];
  canAdmin: boolean;
  /** Everyone in GoHighLevel, for New message. */
  contacts: { id: string; name: string; email?: string | null; phone?: string | null; company?: string | null; ghlContactId?: string | null; additionalEmails?: string[] | null }[];
  /** A contact re-read from GoHighLevel (the card's refresh, or opening their details). */
  onContactUpdated?: (c: Contact) => void;
  /** The side panel's live task card: status, Mark done. */
  onPatchTask: (taskId: string, patch: Partial<Task>) => void;
  /** Emails written on a task or a client and not sent, shown in Drafts (2026-10-06). */
  workDrafts?: { id: string; taskId: string | null; clientId: string; subject: string; preview: string; at: string; where: string | null; clientName: string | null }[];
  onDeleteWorkDraft?: (d: { id: string; taskId: string | null; clientId: string }) => void | Promise<void>;
  /** Reviews the client sent changes back on: ours to act on, top of the Inbox. */
  reviewsBack?: { id: string; taskId: string; name: string; days: number | null; taskTitle: string | null; clientName: string | null }[];
  /** A draft written on a client (in its Journal), opened there. */
  onOpenClientDraft?: (clientId: string) => void;
  /** A client's lists, for the task card's List box. */
  listsFor: (clientId: string) => { id: string; name: string }[];
  /** Team chat: a task's chat (as a comment), a direct message, or the team group. */
  onSendTeam: (threadKey: string, body: string) => Promise<void>;
  /** 📌 Add to task: an email onto the linked task as a comment. */
  onAddComment: (taskId: string, body: string) => void;
  onOpenClient: (clientId: string) => void;
  /** The person in GoHighLevel, when they are a contact there. */
  ghlUrlFor: (contactId: string) => string | null;
};

const FOLDERS: { id: Folder; label: string; icon: string }[] = [
  { id: "inbox", label: "Inbox", icon: "📥" }, { id: "updates", label: "Updates", icon: "📰" }, { id: "starred", label: "Starred", icon: "⭐" }, { id: "drafts", label: "Drafts", icon: "📝" },
  { id: "snoozed", label: "Snoozed", icon: "⏰" }, { id: "sent", label: "Sent", icon: "🚀" }, { id: "done", label: "Archive", icon: "🗄" },
  { id: "trash", label: "Trash", icon: "🗑" },
];
const FILTERS: { id: Folder; label: string; icon: string }[] = [
  { id: "email", label: "Email", icon: "✉️" }, { id: "sms", label: "Texts", icon: "💬" },
  { id: "social", label: "Social", icon: "👥" }, { id: "call", label: "Calls", icon: "📞" }, { id: "team", label: "Team", icon: "🤝" }, { id: "chat", label: "Client chats", icon: "🗂️" },
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
  // Held by the Cockpit when it passes it, so the open conversation is in
  // the URL (?view=mail&thread=…) and a link opens it.
  const [localKey, setLocalKey] = useState<string | null>(null);
  const openKey = p.openKey !== undefined ? p.openKey : localKey;
  const setOpenKey = p.onOpenKey ?? setLocalKey;
  // The highlighted row, and where it was: when it leaves the list (archived,
  // deleted, snoozed) the one that slides into its place is highlighted, so you
  // work down the list without reaching for the mouse (Derek, 2026-10-05).
  const [cursorAt, setCursorAt] = useState<{ key: string | null; i: number }>({ key: null, i: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [composeNew, setComposeNew] = useState<false | NewStart>(false);
  // A person card's Text button opens New message as a text to them.
  useEffect(() => {
    const onCompose = (e: Event) => { const d = (e as CustomEvent<NewStart>).detail; setOpenKey(null); setComposeNew(d); };
    window.addEventListener("inbox-compose", onCompose);
    return () => window.removeEventListener("inbox-compose", onCompose);
  }, [setOpenKey]);
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
    const list = inbox.threads.filter((t) => inFolder(t, folder, (k) => drafts.has(k)) && (!p.prefs.unreadOnly || t.unread));
    // Starred conversations stay pinned at the top (Derek, 2026-10-02: "front and center").
    return folder === "starred" ? list : [...list.filter((t) => t.starred), ...list.filter((t) => !t.starred)];
  }, [inbox.threads, folder, q, drafts, p.clientName, p.prefs.unreadOnly]); // eslint-disable-line react-hooks/exhaustive-deps -- only these props matter here
  const open = openKey ? inbox.threads.find((t) => t.key === openKey) ?? null : null;
  const cursor = cursorAt.key && visible.some((t) => t.key === cursorAt.key) ? cursorAt.key
    : cursorAt.key ? visible[Math.min(cursorAt.i, visible.length - 1)]?.key ?? null : null;
  const setCursor = (key: string | null) => setCursorAt({ key, i: Math.max(0, visible.findIndex((t) => t.key === key)) });

  const queued = p.prefs.queuedDrafts ?? [];
  const workDrafts = p.workDrafts ?? [];
  const reviewsBack = p.reviewsBack ?? [];
  // Gmail checked every minute while this Inbox is on screen (the 5 minute
  // timer covers everyone else). Only when the tab is showing.
  const pullGmail = inbox.pullGmail;
  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") void pullGmail(); }, 60_000);
    return () => clearInterval(i);
  }, [pullGmail]);
  const count = (f: Folder) => f === "drafts" ? drafts.size + queued.length + workDrafts.length : inbox.threads.filter((t) => t.unread && inFolder(t, f, () => false)).length;

  const undoToast = (text: string, undo: () => Promise<void> | void) => p.pushToast(text, { label: "Undo", run: () => { undo(); } });
  const done = async (keys: string[]) => {
    const undo = await inbox.markDone(keys);
    undoToast(keys.length > 1 ? `${keys.length} archived` : "Archived", undo);
  };
  // Delete: to the Trash here, and to Gmail's Trash for an email.
  const del = async (keys: string[], restore = false) => {
    const { undo, gmailNote } = await inbox.trash(keys, restore);
    const what = keys.length > 1 ? `${keys.length} conversations` : "Conversation";
    // A delete shows nothing: the Trash keeps it, and ⌘Z still brings the last one back.
    p.pushToast(restore ? `${what} restored` : `${what} moved to Trash${gmailNote ? ` (Gmail: ${gmailNote})` : ""}`, { label: "Undo", run: () => { undo(); } }, undefined, { quiet: !restore && !gmailNote });
  };
  // From the list, S or the row's ⏰: until tomorrow morning.
  const snoozeRow = async (key: string) => {
    const until = snoozeUntil("tomorrow");
    const undo = await inbox.snooze([key], until);
    undoToast(`Snoozed until ${until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, undo);
  };
  const openThread = (t: InboxThread) => {
    setOpenKey(t.key); setCursor(t.key); setComposeNew(false);
    if (t.unread) inbox.markRead([t.key]);
  };
  // A reply Claude wrote to a conversation (draft_email_reply) opens in that
  // conversation as your reply, not as a new message; anything else, or a
  // conversation not loaded here, opens as a new message as before.
  const openQueued = (d: NonNullable<InboxPrefs["queuedDrafts"]>[number]) => {
    const th = d.threadKey ? inbox.threads.find((x) => x.key === d.threadKey) : null;
    if (th) { setFolder("inbox"); openThread(th); return; }
    setOpenKey(null); setComposeNew({ kind: d.kind, to: d.to, name: d.name, contactId: d.contactId ?? undefined, subject: d.subject, body: d.body, queuedId: d.id });
  };
  const step = (d: 1 | -1) => {
    if (!visible.length) return;
    const cur = openKey ?? cursor;
    const i = visible.findIndex((t) => t.key === cur);
    const n = visible[i < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, i + d))];
    if (openKey) openThread(n); else setCursor(n.key);
  };
  const back = () => { if (openKey) setCursor(openKey); setOpenKey(null); setComposeNew(false); };
  // Archive, delete or snooze an open conversation and the next one opens, so
  // you work straight through (Derek, 2026-10-05). The one below, else the one
  // above, else back to the list.
  const leave = (key: string) => {
    const i = visible.findIndex((t) => t.key === key);
    const n = i < 0 ? null : visible[i + 1] ?? visible[i - 1] ?? null;
    if (n) openThread(n); else back();
  };

  // → next, ← previous (Derek, 2026-10-02: arrows instead of J and K), and
  // left hand keys as in Gmail: E archive, R read, S snooze, T link, F star.
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const linkSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || folder === "settings") return;
      // A task open over the Inbox has the keys; Escape closes it, not this.
      // A panel or photo open over the Inbox has the keys (its arrows are its own).
      if (document.querySelector('.inbox-slide, [role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === "arrowright" || (k === "arrowdown" && !openKey)) { e.preventDefault(); step(1); }
      else if (k === "arrowleft" || (k === "arrowup" && !openKey)) { e.preventDefault(); step(-1); }
      else if ((k === " " || k === "enter") && !openKey && cursor) { e.preventDefault(); const t = visible.find((x) => x.key === cursor); if (t) openThread(t); }
      else if (k === "escape" && openKey) back();
      else if (k === "e" && (open || cursor)) { e.preventDefault(); const key = open?.key ?? cursor!; if (open) leave(key); done([key]); }
      else if (k === "d" && (open || cursor)) { e.preventDefault(); const key = open?.key ?? cursor!; if (open) leave(key); del([key]); }
      else if (k === "r" && open) { e.preventDefault(); if (open.unread) inbox.markRead([open.key]); else inbox.markUnread([open.key]); }
      else if (k === "s" && open) { e.preventDefault(); setSnoozeOpen(true); }
      else if (k === "s" && cursor) { e.preventDefault(); snoozeRow(cursor); }
      else if (k === "t" && open) { e.preventDefault(); linkSearchRef.current?.focus(); }
      else if (k === "f" && (open || cursor)) { e.preventDefault(); const t = open ?? visible.find((x) => x.key === cursor); if (t) inbox.star([t.key], !t.starred); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const slim = !!prefs.railCollapsed;
  return (
    <div onClickCapture={prefs.popup ? askAlertPermission : undefined} className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden text-[16px]">
      {/* Folders */}
      {/* Folds to icons only, and remembers it (Derek, 2026-10-02). */}
      <nav className={`hidden shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden border-r bg-background/40 md:flex ${slim ? "w-[68px] items-center px-2 py-3" : "w-48 p-2.5"}`}>
        <button onClick={() => { setComposeNew({}); setOpenKey(null); setFolder("inbox"); }} title="New message" aria-label="New message"
          className={`mb-3 h-11 shrink-0 rounded-lg bg-accent font-semibold text-white ${slim ? "w-11 text-[20px]" : "w-full"}`}>{slim ? "＋" : "＋ New message"}</button>
        {FOLDERS.map((f) => <FolderButton key={f.id} f={f} slim={slim} active={folder === f.id && !q} count={prefs.badge || f.id !== "inbox" ? count(f.id) : 0} onClick={() => { setFolder(f.id); setOpenKey(null); setQ(""); setComposeNew(false); if (f.id === "drafts") window.dispatchEvent(new Event("inbox-check-drafts")); }} />)}
        {slim ? <div className="my-2 h-px w-8 bg-[var(--border)]" /> : <div className="mx-2.5 mb-1 mt-3 text-[13px] font-bold tracking-wide text-muted">SHOW ONLY</div>}
        {FILTERS.filter((f) => !(prefs.hideKinds ?? []).includes(f.id)).map((f) => <FolderButton key={f.id} f={f} slim={slim} active={folder === f.id && !q} count={count(f.id)} onClick={() => { setFolder(f.id); setOpenKey(null); setQ(""); setComposeNew(false); }} />)}
        <div className={`mt-auto border-t pt-3 ${slim ? "flex w-full flex-col items-center gap-0.5" : ""}`}>
          <FolderButton f={{ id: "inbox", label: "Settings", icon: "⚙️" }} slim={slim} active={folder === "settings"} count={0} onClick={() => { setFolder("settings"); setOpenKey(null); setComposeNew(false); }} />
          <FolderButton f={{ label: slim ? "Show folder names" : "Icons only", icon: slim ? "»" : "«" }} slim={slim} active={false} count={0} onClick={() => p.setPrefs({ railCollapsed: !slim })} />
        </div>
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Phone: folders as a menu */}
        {/* Hidden while a conversation is open: it is the list's, and the phone needs the room. */}
        <div className={`gap-2 border-b p-3 md:hidden ${open || composeNew ? "hidden" : "flex"}`}>
          <button onClick={() => { setComposeNew({}); setOpenKey(null); }} className="h-11 shrink-0 rounded-lg bg-accent px-4 font-semibold text-white">＋ New</button>
          <select aria-label="Folder" value={folder} onChange={(e) => { setFolder(e.target.value as Folder | "settings"); setOpenKey(null); setComposeNew(false); }} className="h-11 min-w-0 flex-1 rounded-lg border bg-surface px-3 font-semibold">
            {[...FOLDERS, ...FILTERS.filter((f) => !(prefs.hideKinds ?? []).includes(f.id))].map((f) => <option key={f.id} value={f.id}>{f.label}{count(f.id) ? ` (${count(f.id)})` : ""}</option>)}
            <option value="settings">Settings</option>
          </select>
        </div>

        {folder === "settings" ? <InboxSettings {...p} />
          : composeNew ? <NewMessage key={JSON.stringify(composeNew)} p={p} start={composeNew} onClose={() => setComposeNew(false)} />
          : open ? <ThreadView key={open.key} onOpenOther={(k) => { const x = inbox.threads.find((y) => y.key === k); if (x) openThread(x); }} emailInstead={(to, body) => { setOpenKey(null); setComposeNew({ to, body }); }} p={p} t={open} back={back} leave={() => leave(open.key)} done={() => { leave(open.key); done([open.key]); }} del={() => { leave(open.key); del([open.key], open.trashed); }} snoozeOpen={snoozeOpen} setSnoozeOpen={setSnoozeOpen} linkSearchRef={linkSearchRef} onDraft={refreshDrafts} />
          : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                <input type="checkbox" aria-label="Select all" className="h-5 w-5" checked={selected.size > 0 && selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((t) => t.key)) : new Set())} />
                <button onClick={async () => { setPulling(true); await inbox.pullNow(); setPulling(false); }} disabled={pulling} title="Check for new email, texts and messages now" aria-label="Check for new messages now" className="h-10 rounded-lg border px-3 font-semibold hover:bg-background disabled:opacity-60"><span className={pulling ? "inline-block animate-spin" : ""}>↻</span></button>
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
                {folder === "inbox" && !q && p.canAdmin && <RemindersGoingOut p={p} />}
                {/* Every draft waiting on you in one list, one look, newest first
                    (Derek, 2026-10-10: the Claude cards and the task rows "feel
                    off or duplicates"): a Claude chat's, and an email written on a
                    task or client. One you've written to them since is hidden. */}
                {folder === "drafts" && !q && (queued.length > 0 || workDrafts.length > 0) && (
                  <DraftList p={p} queued={queued} workDrafts={workDrafts} onOpenQueued={openQueued} />
                )}
                {/* Reviews a client sent changes back on: yours to act on (2026-10-06). */}
                {folder === "inbox" && !q && reviewsBack.length > 0 && (
                  // Orange: the client is waiting on us.
                  <div className="border-b border-l-[6px] bg-highlight-soft/50" style={{ borderLeftColor: "var(--highlight)" }}>
                    <div className="px-4 pb-1 pt-3 text-[13px] font-bold uppercase tracking-wide text-highlight">Changes sent back · {reviewsBack.length}</div>
                    {reviewsBack.map((r) => (
                      <button key={r.id} onClick={() => p.onOpenTask(r.taskId, "Inbox")} className="flex w-full items-start gap-3 border-t px-4 py-2.5 text-left hover:bg-background">
                        <span aria-hidden className="mt-0.5 text-[18px]">↩️</span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate">{r.clientName ? `${r.clientName.split(/\s+/)[0]} sent changes back: ` : "Changes sent back: "}{r.name}</b>
                          <span className="block truncate text-[14px] text-muted">{r.taskTitle ?? "Open the task"}</span>
                        </span>
                        {/* How long they've waited: grey, orange from 3 days, red past 7. */}
                        {r.days !== null && <span className={`shrink-0 rounded-[5px] px-2 py-0.5 text-[14px] font-semibold ${r.days > 7 ? "bg-danger text-white" : r.days >= 3 ? "bg-highlight text-white" : "bg-background text-muted"}`}>{r.days === 0 ? "Today" : `${r.days} ${r.days === 1 ? "day" : "days"}`}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {!inbox.loading && !visible.length && !(folder === "drafts" && (queued.length || workDrafts.length)) && !(folder === "inbox" && !q && reviewsBack.length) && (
                  <div className="px-6 py-16 text-center text-muted">
                    <div className="text-[21px] font-bold text-foreground">{folder === "inbox" && !q ? "All caught up" : folder === "trash" ? "Trash is empty" : "Nothing here"}</div>
                    {folder === "inbox" && !q && <div className="mt-1">{p.prefs.unreadOnly ? "Nothing unread." : "Every message is answered, snoozed or archived."}</div>}
                  </div>
                )}
                {visible.map((t, i) => {
                  const pinnedTop = !q && folder !== "starred" && visible.some((x) => x.starred);
                  const prevT = visible[i - 1];
                  // Pinned stars first, then everything else (by day when that is on).
                  const section = pinnedTop && t.starred && i === 0 ? "★ Starred"
                    : pinnedTop && !t.starred && prevT?.starred ? (prefs.byDay ? dayGroup(t.latest.at) : "Everything else")
                    : null;
                  const day = !section && prefs.byDay && !q && !t.starred ? dayGroup(t.latest.at) : null;
                  const showDay = day && (i === 0 || prevT?.starred || dayGroup(prevT.latest.at) !== day);
                  const head = section ?? (showDay ? day : null);
                  return (
                    <div key={t.key}>
                      {head && <div className="border-b px-5 pb-2 pt-4 text-[14px] font-extrabold uppercase tracking-wider text-muted">{head}</div>}
                      <Row t={t} p={p} active={cursor === t.key} checked={selected.has(t.key)} draft={drafts.has(t.key)} where={q.trim() ? whereIs(t) : null}
                        onCheck={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(t.key); else n.delete(t.key); return n; })}
                        onOpen={() => openThread(t)} picking={selected.size > 0}
                        onArchive={() => done([t.key])} onDelete={() => del([t.key], t.trashed)}
                        onSnooze={() => snoozeRow(t.key)} />
                    </div>
                  );
                })}
              </div>
              <div className="hidden gap-4 border-t bg-background/40 px-5 py-2 text-[14px] text-muted lg:flex">
                <span><Kbd>↓</Kbd> Next</span><span><Kbd>↑</Kbd> Previous</span><span><Kbd>Space</Kbd> Open</span><span><Kbd>E</Kbd> Archive</span><span><Kbd>F</Kbd> Star</span><span><Kbd>D</Kbd> Delete</span><span><Kbd>R</Kbd> Read</span><span><Kbd>S</Kbd> Snooze</span><span><Kbd>T</Kbd> Link task</span>
              </div>
            </>
          )}
      </section>
    </div>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="mr-1 inline-block min-w-6 rounded border border-b-2 bg-surface px-1.5 text-center font-sans text-[13px] text-foreground">{children}</kbd>;

// Reminder emails going out (Derek, 2026-10-07): the Monday and Wednesday
// client reminders and the document review nudges wait here until someone has
// read them. Edit fixes the words; nothing goes until Send.
type HeldReminder = { id: string; clientId: string; clientName: string; to: string | null; taskId: string | null; subject: string; body: string; from: string; at: string };
/** 8 AM that many days from now, in this browser's time. */
function nextAt(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days); d.setHours(8, 0, 0, 0);
  return d.toISOString();
}
/** The coming Monday, 8 AM (next week's when today is Monday). */
function nextMonday(): string {
  const d = new Date(); const add = ((8 - d.getDay()) % 7) || 7;
  return nextAt(add);
}

function RemindersGoingOut({ p }: { p: InboxViewProps }) {
  const [list, setList] = useState<HeldReminder[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [pickAt, setPickAt] = useState("");
  // Read on open and every five minutes, for a reminder queued while it's open.
  useEffect(() => {
    let live = true;
    const load = () => authedFetch("/api/inbox/reminders").then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j?.reminders) setList(j.reminders); }, () => {});
    load();
    const i = setInterval(load, 5 * 60_000);
    return () => { live = false; clearInterval(i); };
  }, []);
  const act = async (id: string, action: "send" | "drop" | "save" | "schedule", extra?: { subject?: string; body?: string; at?: string }) => {
    setBusy(id);
    const r = await authedFetch("/api/inbox/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) { p.pushToast(j.error ?? "That didn't work. Try again."); return false; }
    const who = list.find((x) => x.id === id)?.clientName ?? "them";
    if (action === "save") { setList((l) => l.map((x) => (x.id === id ? { ...x, subject: extra?.subject ?? x.subject, body: extra?.body ?? x.body } : x))); setEdit(null); p.pushToast("Saved. It still waits for Send."); }
    else {
      setList((l) => l.filter((x) => x.id !== id)); if (open === id) setOpen(null); setScheduleFor(null);
      p.pushToast(action === "send" ? `Reminder sent to ${who}` : action === "schedule" ? `Reminder to ${who} goes ${new Date(extra!.at!).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : `Reminder to ${who} won't go out`);
    }
    return true;
  };
  if (!list.length) return null;
  const fromName = (id: string) => (id === p.me.id ? "you" : p.team.find((m) => m.id === id)?.name ?? "the team");
  return (
    // Blue: yours to send (Derek, 2026-10-08: colours to tell the sections apart).
    <section aria-label="Reminder emails going out" className="border-b border-l-[6px] bg-accent-soft/50 p-3" style={{ borderLeftColor: "var(--accent)" }}>
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <b className="text-[16px]">📬 Reminder emails going out ({list.length})</b>
        <span className="text-muted">Nothing goes until you send it.</span>
      </div>
      <div className="space-y-2">
        {list.map((r) => {
          const isOpen = open === r.id;
          const editing = edit?.id === r.id ? edit : null;
          return (
            <div key={r.id} className="rounded-lg bg-surface ring-1 ring-[var(--border)]">
              <button onClick={() => { setOpen(isOpen ? null : r.id); setEdit(null); }} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                <span aria-hidden className="text-[20px]">✉️</span>
                <span className="min-w-0 flex-1">
                  <b className="flex items-center gap-2 truncate"><span className="truncate">{r.clientName}: {r.subject}</span><span className="shrink-0 rounded-[5px] bg-accent px-2 text-[14px] font-semibold text-white">Review &amp; send</span></b>
                  <span className="block truncate text-[14px] text-muted">To {r.to ?? "nobody (no email on file)"} · from {fromName(r.from)} · {htmlToText(r.body).slice(0, 110)}</span>
                </span>
              </button>
              {isOpen && (
                <div className="border-t px-3 pb-3 pt-2">
                  {editing ? (<>
                    <input value={editing.subject} onChange={(e) => setEdit({ ...editing, subject: e.target.value })} aria-label="Subject"
                      className="mb-2 h-10 w-full rounded-lg border bg-surface px-3 font-semibold outline-none focus:border-accent" />
                    <div className="rounded-lg border bg-surface p-2"><RichTextEditor key={`rem-${r.id}`} variant="email" value={editing.body} onChange={(v) => setEdit((x) => (x ? { ...x, body: v } : x))} /></div>
                  </>) : (
                    <div className="rte-content max-h-[50vh] overflow-y-auto rounded-lg bg-background px-4 py-3 text-[16px]" dangerouslySetInnerHTML={{ __html: safeMessageHtml(r.body) }} />
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {editing ? (<>
                      <button disabled={busy === r.id} onClick={() => void act(r.id, "save", { subject: editing.subject, body: editing.body })} className="h-10 rounded-lg bg-accent px-4 font-bold text-white disabled:opacity-50">Save</button>
                      <button onClick={() => setEdit(null)} className="h-10 rounded-lg px-3 font-semibold text-muted hover:bg-background">Cancel</button>
                    </>) : (<>
                      <button disabled={busy === r.id || !r.to} onClick={() => void act(r.id, "send")} className="h-10 rounded-lg bg-accent px-4 font-bold text-white disabled:opacity-50">{busy === r.id ? "Sending…" : "Send"}</button>
                      {/* Later instead of now (Derek, 2026-10-08: "this one I want to go tomorrow"). */}
                      <span className="relative">
                        <button disabled={busy === r.id || !r.to} onClick={() => { setScheduleFor(scheduleFor === r.id ? null : r.id); setPickAt(""); }} aria-expanded={scheduleFor === r.id}
                          className="h-10 rounded-lg px-3 font-semibold ring-1 ring-[var(--border)] hover:bg-background disabled:opacity-50">Schedule ▾</button>
                        {scheduleFor === r.id && (<>
                          <div className="fixed inset-0 z-30" onClick={() => setScheduleFor(null)} />
                          <div className="absolute left-0 top-11 z-40 w-64 rounded-lg bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                            {[["Tomorrow, 8 AM", nextAt(1)], ["Monday, 8 AM", nextMonday()]].map(([label, at]) => (
                              <button key={label} onClick={() => void act(r.id, "schedule", { at })} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">{label}</button>
                            ))}
                            <div className="mt-1 border-t px-2 pt-2">
                              <input type="datetime-local" value={pickAt} onChange={(e) => setPickAt(e.target.value)} aria-label="Send at" className="h-10 w-full rounded-md border bg-background px-2 text-[16px] outline-none focus:border-accent" />
                              <button disabled={!pickAt} onClick={() => void act(r.id, "schedule", { at: new Date(pickAt).toISOString() })} className="mt-1.5 h-10 w-full rounded-md bg-accent font-semibold text-white disabled:opacity-40">Schedule</button>
                            </div>
                          </div>
                        </>)}
                      </span>
                      <button onClick={() => setEdit({ id: r.id, subject: r.subject, body: r.body })} className="h-10 rounded-lg px-3 font-semibold ring-1 ring-[var(--border)] hover:bg-background">Edit</button>
                      {/* The task it's about, to check or change before it goes (Derek, 2026-10-08). */}
                      {r.taskId && <AppLink href={taskHref(r.taskId)} onOpen={() => p.onOpenTask(r.taskId!, "Inbox")} className="inline-flex h-10 items-center rounded-lg px-3 font-semibold text-accent hover:bg-background">Open task</AppLink>}
                      <AppLink href={clientHref(r.clientId)} onOpen={() => p.onOpenClient(r.clientId)} className="inline-flex h-10 items-center rounded-lg px-3 font-semibold text-accent hover:bg-background">Open their tasks</AppLink>
                      <span className="flex-1" />
                      <button disabled={busy === r.id} onClick={() => void act(r.id, "drop")} className="h-10 rounded-lg px-3 font-semibold text-muted hover:text-danger">Don&apos;t send</button>
                    </>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

let pendingSeq = 0;
const newPendingId = () => `ps_${Date.now()}_${++pendingSeq}`;

/** Replies inside their undo window, at the bottom of the conversation: the
 *  message, faded, and a small Undo tab under it until it goes. */
function PendingSends({ t }: { t: InboxThread }) {
  const list = usePendingSends(t.key);
  if (!list.length) return null;
  const chat = !isEmailThread(t);
  return (
    <div className="mt-2 space-y-3">
      {list.map((x) => (
        <div key={x.id} className={chat ? "flex flex-col items-end" : ""}>
          {chat
            ? <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-white opacity-70">{x.rich ? htmlToText(x.body) : x.body}</div>
            : <div className="rounded-xl border px-4 py-3 opacity-70"><b className="block">You</b>{x.rich ? <div className="rte-content mt-1 text-[16px]" dangerouslySetInnerHTML={{ __html: safeMessageHtml(x.body) }} /> : <div className="mt-1 whitespace-pre-wrap">{x.body}</div>}</div>}
          <button onClick={x.undo} className={`-mt-px rounded-b-lg bg-surface px-3 py-1 text-[14px] font-semibold text-accent ring-1 ring-[var(--border)] hover:bg-background ${chat ? "mr-3" : "ml-4"}`}>
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}

function FolderButton({ f, active, count, onClick, slim = false }: { f: { id?: string; label: string; icon: string }; active: boolean; count: number; onClick: () => void; slim?: boolean }) {
  if (slim) return (
    <button onClick={onClick} title={count > 0 ? `${f.label} (${count})` : f.label} aria-label={f.label}
      className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[18px] ${active ? "bg-accent-soft" : "hover:bg-background"}`}>
      {f.icon}
      {count > 0 && <span className={`absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] font-bold ${active ? "bg-accent text-white" : "bg-[#2563eb] text-white"}`}>{count > 99 ? "99+" : count}</span>}
    </button>
  );
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${active ? "bg-accent-soft font-bold text-accent" : "font-medium hover:bg-background"}`}>
      <span className="w-5 text-center">{f.icon}</span><span className="truncate">{f.label}</span>
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
  const author = t.channel === "team" ? (t.latest.direction === "outbound" ? "You" : (t.latest.peerName ?? "").split(/\s+/)[0]) : "";
  const latestText = looksLikeHtml(t.latest.body || "") ? htmlToText(t.latest.body) : (t.latest.body || "");
  const preview = (author ? `${author}: ` : "") + bodyParts(splitQuotedEmail(latestText).visible || latestText)
    .map((x) => ("text" in x ? x.text : "")).join(" ").replace(/\s+/g, " ").replace(/\[\s*\]/g, "").trim();
  const client = p.clientName(t.clientId);
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  // Room between them so a quick move doesn't hit the wrong one (Derek, 2026-10-02).
  const act = "grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface hover:text-foreground hover:ring-1 hover:ring-[var(--border)]";
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  // The highlighted row stays on screen as the arrows move it.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: "nearest" }); }, [active]);
  return (
    <div ref={ref} onClick={onOpen} aria-current={active || undefined} className={`group relative grid cursor-pointer grid-cols-[40px_minmax(0,1fr)] items-center gap-3 border-b px-5 py-2.5 ${checked ? "bg-accent-soft" : active ? "bg-accent-soft/60 shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-background/60"}`}>
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
            <span className="hidden gap-2 font-normal sm:group-hover:flex">
              <button onClick={stop(onArchive)} title="Archive (E)" aria-label="Archive" className={act}>🗄</button>
              <button onClick={stop(onSnooze)} title="Snooze until tomorrow, 9 AM (S)" aria-label="Snooze" className={act}>⏰</button>
              <button onClick={stop(onDelete)} title={t.trashed ? "Restore" : "Delete (D)"} aria-label={t.trashed ? "Restore" : "Delete"} className={act}>{t.trashed ? "↩" : "🗑"}</button>
            </span>
            <button onClick={stop(() => p.inbox.star([t.key], !t.starred))} aria-label={t.starred ? "Unstar" : "Star"} title={t.starred ? "Unstar (F)" : "Star (F)"}
              className={`ml-1.5 w-6 text-[19px] font-normal leading-none ${t.starred ? "text-[#d97706]" : "invisible text-muted/50 hover:text-[#d97706] group-hover:visible"}`}>{t.starred ? "★" : "☆"}</button>
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
function ThreadView({ p, t, back, leave, done, del, snoozeOpen, setSnoozeOpen, linkSearchRef, onDraft, emailInstead, onOpenOther }: {
  p: InboxViewProps; t: InboxThread; back: () => void; leave: () => void; done: () => void; del: () => void; emailInstead: (to: string, body: string) => void; onOpenOther: (key: string) => void;
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
  // A reply Claude drafted for this conversation (mcp draft_email_reply) is
  // in the reply box when it opens, inline (Derek, 2026-10-09), unless you've
  // started your own or have written to them since it was drafted.
  const claudeDraft = (p.prefs.queuedDrafts ?? []).find((d) => d.threadKey === t.key) ?? null;
  const claudeStale = !!claudeDraft && t.messages.some((m) => m.direction === "outbound" && m.at > claudeDraft.createdAt);
  const [compose, setCompose] = useState<{ mode: ComposeMode; m: Message } | null>(() => {
    if (claudeDraft && !claudeStale && !readDraft(p.me.id, t.key)) writeDraft(p.me.id, t.key, claudeDraft.body);
    return readDraft(p.me.id, t.key) ? { mode: "reply", m: lastFromThem } : null;
  });
  // Sent or thrown away here, or answered since: Claude's draft is done, and
  // its copy in Gmail goes too so it can't be sent twice.
  const dropClaude = () => {
    if (!claudeDraft) return;
    void authedFetch("/api/inbox/claude-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: claudeDraft.id }) }).catch(() => null)
      .finally(() => p.setPrefs({ queuedDrafts: (p.prefs.queuedDrafts ?? []).filter((x) => x.id !== claudeDraft.id) }));
  };
  const draftChanged = () => { onDraft(); if (claudeDraft && !readDraft(p.me.id, t.key)) dropClaude(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it opens
  useEffect(() => { if (claudeStale) dropClaude(); }, []);
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
    leave();
    const undo = await p.inbox.snooze([t.key], until);
    p.pushToast(`Snoozed until ${until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, { label: "Undo", run: () => { undo(); } });
  };
  // The side panel sits beside the conversation when the conversation area
  // itself has room (1000px), not the whole window: with the folders folded
  // to icons a laptop has room too (Derek, 2026-10-02).
  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="relative flex flex-wrap gap-0.5 border-b px-2 py-1.5 sm:px-3">
        <button onClick={back} title="Back to the list (Esc)" aria-label="Back" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">←<span className="hidden sm:inline"> Back</span></button>
        <button onClick={done} title="Archive (E): out of your Inbox and your Gmail inbox; never deleted" aria-label="Archive" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">🗄<span className="hidden sm:inline"> Archive</span></button>
        <button onClick={() => p.inbox.star([t.key], !t.starred)} aria-pressed={t.starred} aria-label={t.starred ? "Starred" : "Star"} title={t.starred ? "Starred (F)" : "Star (F)"} className={`h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground ${t.starred ? "text-[#d97706]" : ""}`}>{t.starred ? "★" : "☆"}<span className="hidden sm:inline">{t.starred ? " Starred" : " Star"}</span></button>
        <div className="relative">
          <button onClick={() => setSnoozeOpen(!snoozeOpen)} title="Snooze (S)" aria-label="Snooze" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">⏰<span className="hidden sm:inline"> Snooze</span></button>
          {snoozeOpen && (
            <Menu onClose={() => setSnoozeOpen(false)}>
              {([["1h", "In 1 hour"], ["3h", "In 3 hours"], ["tomorrow", "Tomorrow, 9 AM"], ["monday", "Monday, 9 AM"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => snooze(k)} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">{l}</button>
              ))}
            </Menu>
          )}
        </div>
        <button onClick={async () => { await p.inbox.markUnread([t.key]); back(); }} title="Mark as unread (R)" aria-label="Mark as unread" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">✉<span className="hidden sm:inline"> Mark as unread</span></button>
        <button onClick={del} title={t.trashed ? "Bring it back" : t.channel === "email" ? "Delete (D): to Trash here and in Gmail (kept 30 days)" : "Delete (D): to Trash here"} aria-label={t.trashed ? "Restore" : "Delete"} className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground">{t.trashed ? "↩" : "🗑"}<span className="hidden sm:inline">{t.trashed ? " Restore" : " Delete"}</span></button>
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
                {t.channel === "email" && <>
                  <div className="my-1 border-t" />
                  <button onClick={() => { setBlockOpen(false); letIn(p, t.peerAddress!); }} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">📥 Always to Inbox: {t.peerAddress}</button>
                  {domain && !/@(gmail|yahoo|hotmail|outlook|icloud|aol|me|msn|live)\./i.test(domain) && (
                    <button onClick={() => { setBlockOpen(false); letIn(p, domain); }} className="block w-full rounded-md px-3 py-2.5 text-left hover:bg-background">📥 Always to Inbox: everyone at {domain.slice(1)}</button>
                  )}
                </>}
              </Menu>
            )}
          </div>
        )}
        {/* The conversation's link and the whole of it for a Claude chat, up
            with the other things done to the conversation, as icons (Derek,
            2026-10-09: "same line ... left aligned with just icons"). */}
        <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)]" />
        <button onClick={() => navigator.clipboard.writeText(threadLink(t)).then(() => p.pushToast("Link copied"), () => p.pushToast("Couldn't copy"))}
          title="Copy link to this conversation" aria-label="Copy link" className="h-9 rounded-md px-2.5 text-muted hover:bg-background hover:text-foreground">🔗</button>
        <button onClick={() => navigator.clipboard.writeText(threadForClaude(t, p)).then(() => p.pushToast("Copied. Paste it into Claude."), () => p.pushToast("Couldn't copy"))}
          title="Copy for Claude: the whole conversation, to paste into a Claude chat" aria-label="Copy for Claude" className="h-9 rounded-md px-2.5 font-bold text-[#7c3aed] hover:bg-background">✳</button>
        {t.updates && t.peerAddress && (
          <button onClick={() => letIn(p, t.peerAddress!)} title="Their email goes to your Inbox from now on, not Updates" className="h-9 rounded-md px-2.5 font-semibold text-accent hover:bg-background">📥<span className="hidden sm:inline"> To Inbox</span></button>
        )}
        <button onClick={() => setDetails(true)} title="Task, contact and other conversations" aria-label="Details" className="h-9 rounded-md px-2.5 font-semibold text-muted hover:bg-background hover:text-foreground @min-[1000px]:hidden">ⓘ<span className="hidden sm:inline"> Details</span></button>
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
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[100%] overflow-y-auto @min-[1000px]:grid-cols-[minmax(0,1fr)_8px_var(--side-w)] @min-[1000px]:overflow-hidden" style={sideWidthStyle(p.prefs)}>
          <ChatView p={p} t={t} typing={typing} onDraft={draftChanged} emailInstead={emailInstead} onArchive={done} />
          <SideResizer p={p} />
          <div className="hidden min-h-0 overflow-y-auto bg-background/40 @min-[1000px]:block">{t.channel === "team" ? <TeamPanel p={p} t={t} /> : <SidePanel p={p} t={t} linkSearchRef={linkSearchRef} onOpenOther={onOpenOther} />}</div>
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[1000px]:grid-cols-[minmax(0,1fr)_8px_var(--side-w)] @min-[1000px]:overflow-hidden" style={sideWidthStyle(p.prefs)}>
        <EmailThread p={p} t={t} typing={typing} compose={compose} setCompose={setCompose} onDraft={draftChanged} onArchive={done} claude={claudeDraft && !claudeStale ? claudeDraft : null} />
        <SideResizer p={p} />
        <div className="hidden min-h-0 overflow-y-auto bg-background/40 @min-[1000px]:block">{t.channel === "team" ? <TeamPanel p={p} t={t} /> : <SidePanel p={p} t={t} linkSearchRef={linkSearchRef} onOpenOther={onOpenOther} />}</div>
      </div>
      )}
      {details && <DetailsPanel onClose={() => setDetails(false)}>{t.channel === "team" ? <TeamPanel p={{ ...p, onOpenTask: (id, from) => { setDetails(false); p.onOpenTask(id, from); } }} t={t} /> : <SidePanel p={{ ...p, onOpenTask: (id, from) => { setDetails(false); p.onOpenTask(id, from); } }} t={t} linkSearchRef={linkSearchRef} onOpenOther={(k) => { setDetails(false); onOpenOther(k); }} />}</DetailsPanel>}
    </div>
  );
}

// ── A text conversation as a chat ─────────────────────────────────────────
function ChatView({ p, t, typing, onDraft, emailInstead, onArchive }: {
  p: InboxViewProps; t: InboxThread; typing: string | null; onDraft: () => void; emailInstead: (to: string, body: string) => void; onArchive?: () => void;
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
    : t.channel === "chat" || (t.channel === "team" && !t.key.startsWith("team:dm:")) ? (m.peerName || t.peerName) : null), [visible, p.me.id, teamName, t.channel, t.peerName, t.key]);
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
        <PendingSends t={t} />
        {typing && <div className="mt-3 italic text-muted">{typing} is writing a reply…</div>}
      </div>
      <div className="border-t px-3 py-3 sm:px-4">
        <Composer key={t.key} p={p} t={t} compact onSent={() => { onDraft(); }} onDraft={onDraft} emailInstead={emailInstead} onArchive={onArchive} />
      </div>
    </div>
  );
}

function ChatGroup({ g, t, p }: { g: Extract<ChatItem, { kind: "group" }>; t: InboxThread; p: InboxViewProps }) {
  const mine = g.side === "mine";
  const last = g.messages[g.messages.length - 1];
  return (
    <div className={`mt-2.5 flex w-fit flex-col gap-[3px] ${g.messages.some((m) => m.channel === "call") ? "max-w-full" : "max-w-[85%] sm:max-w-[75%]"} ${mine ? "ml-auto items-end" : "items-start"}`}>
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
              ? <div className="w-[min(22rem,calc(100vw-2.5rem))] max-w-full rounded-2xl bg-surface px-3 py-1.5 ring-1 ring-[var(--border)]"><CallPlayer m={m} peerName={t.peerName} /></div>
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
  // One sent with HTML in it shows as the words it should have been.
  const parts = useMemo(() => bodyParts(smsText(text)), [text]);
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
  // The contact's own name only when this message is theirs: a conversation
  // can hold several people (Wendy introducing Russell).
  const c = m.contactId ? p.contacts.find((x) => x.id === m.contactId) : null;
  const theirs = !!c && (!m.peerAddress || !c.email || c.email.toLowerCase() === m.peerAddress.toLowerCase());
  const name = (theirs ? c!.name : null) || m.peerName || m.peerAddress || t.peerName;
  const org = theirs ? c!.company || p.clientName(m.clientId) : null;
  return { name, org: org && org.toLowerCase() !== name.toLowerCase() ? org : null };
}
const fullTime = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ── An email conversation (Derek, 2026-10-01, mockup
// https://claude.ai/artifact/Tei4W4znGdehdTpFJAxBP1): oldest first, older
// emails folded to one line, the newest open at the bottom with Reply under it.
function EmailThread({ p, t, typing, compose, setCompose, onDraft, onArchive, claude = null }: {
  claude?: NonNullable<InboxPrefs["queuedDrafts"]>[number] | null;
  p: InboxViewProps; t: InboxThread; typing: string | null; onDraft: () => void; onArchive?: () => void;
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
    ? <div className="mt-3">{claude && <div className="mb-1.5 flex items-center gap-2 font-semibold text-[#7c3aed]">✳ Claude drafted this reply{claude.gmailDraftId ? <span className="font-normal text-muted">· also in your Gmail Drafts, sending here removes it there</span> : null}</div>}<Composer key={`${t.key}:${compose.mode}:${m.id}`} p={p} t={t} mode={compose.mode} answering={m} onClose={() => setCompose(null)} onSent={() => { onDraft(); setCompose(null); }} onDraft={onDraft} onUndone={() => { const back = compose; setCompose(back); }} onArchive={onArchive} /></div>
    : null;
  return (
    <div className="min-w-0 px-4 py-4 sm:px-6 @min-[1000px]:overflow-y-auto">
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
      <PendingSends t={t} />
      {compose?.m.id === last.id ? composer(last) : (
        <div className="flex flex-wrap gap-2 pt-4">
          <button onClick={() => setCompose({ mode: "reply", m: last.direction === "inbound" ? last : (oldestFirst.slice().reverse().find((m) => m.direction === "inbound") ?? last) })} className="h-9 rounded-full bg-accent px-3.5 font-bold text-white sm:px-4">↩ Reply</button>
          <button onClick={() => setCompose({ mode: "replyAll", m: last.direction === "inbound" ? last : (oldestFirst.slice().reverse().find((m) => m.direction === "inbound") ?? last) })}className="h-9 rounded-full px-3.5 font-semibold ring-1 ring-[var(--border)] hover:bg-background sm:px-4">↩↩ <span className="hidden sm:inline">Reply </span>All</button>
          <button onClick={() => setCompose({ mode: "forward", m: last })} className="h-9 rounded-full px-3.5 font-semibold ring-1 ring-[var(--border)] hover:bg-background sm:px-4">→ Forward</button>
        </div>
      )}
    </div>
  );
}

// The conversation as plain text to paste into a Claude chat ("here's the
// email I want you to respond to", Derek, 2026-10-09): who, the linked
// task with its id so Claude can open it through the ClickUpTasks tools,
// then every email oldest first with the quoted history left off.
const threadLink = (t: InboxThread) => `${window.location.origin}/?view=mail&thread=${encodeURIComponent(t.key)}`;
function threadForClaude(t: InboxThread, p: InboxViewProps): string {
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const head = [
    `Email conversation from ClickUpTasks: ${t.subject || "(no subject)"}`,
    `With: ${t.peerName}${t.peerAddress ? ` <${t.peerAddress}>` : ""}`,
    `Link: ${threadLink(t)}`,
    task ? `Linked task: ${task.title} (task id ${task.id})` : null,
    task && p.clientName(task.clientId) ? `Client: ${p.clientName(task.clientId)}` : null,
  ].filter(Boolean).join("\n");
  const emails = [...t.messages].reverse().map((m) => {
    const raw = looksLikeHtml(m.body || "") ? htmlToText(m.body) : m.body || "";
    const body = splitQuotedEmail(tidyEmailText(raw)).visible || "(no text)";
    const who = m.direction === "outbound" ? `${whoWrote(m, t, p).name} (us)` : `${whoWrote(m, t, p).name}${m.peerAddress ? ` <${m.peerAddress}>` : ""}`;
    const files = (m.attachments ?? []).filter((a) => !isSignatureImage(a)).map((a) => a.name);
    return [`--- ${who} · ${when(m.at)}`, m.cc?.length ? `Cc: ${m.cc.join(", ")}` : null, "", body, files.length ? `\n[Attached: ${files.join(", ")}]` : null].filter((x) => x !== null).join("\n");
  });
  return `${head}\n\n${emails.join("\n\n")}\n`;
}

function EmailItem({ m, t, p, open, onToggle, onAnswer, first }: {
  m: Message; t: InboxThread; p: InboxViewProps; open: boolean; first: boolean; onToggle: () => void; onAnswer: (mode: ComposeMode) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [asText, setAsText] = useState(false);
  const isHtmlEmail = m.channel === "email" && !!m.gmailMessageId && !!m.mailboxMemberId;
  const { name, org } = whoWrote(m, t, p);
  const mine = m.direction === "outbound";
  // A reply written in the app is saved as HTML: its one line shows the words.
  const plainBody = looksLikeHtml(m.body || "") ? htmlToText(m.body) : (m.body || "");
  const snippet = plainBody.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  // Your own email says who it really went to when that wasn't the person
  // the conversation is with (an earlier reply to Wendy on Russell's thread).
  const sentTo = m.peerAddress && m.peerAddress.toLowerCase() !== (t.peerAddress ?? "").toLowerCase() ? m.peerAddress : t.peerName;
  const sentCc = (m.cc ?? []).filter((a) => a && a.toLowerCase() !== (m.peerAddress ?? "").toLowerCase());
  const to = mine ? `to ${sentTo}${sentCc.length > 0 ? `, ${sentCc.join(", ")}` : ""}` : `to you${(m.cc?.length ?? 0) > 0 ? `, ${m.cc.join(", ")}` : ""}`;
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
          <span className="mr-1 whitespace-nowrap text-muted">{open ? <><span className="sm:hidden">{shortTime(m.at)}</span><span className="hidden sm:inline">{fullTime(m.at)}</span></> : shortTime(m.at)}</span>
          {open && <>
            <button onClick={pin} title="Add this email to the task" aria-label="Add this email to the task" className="hidden h-8 rounded-md px-1.5 text-muted hover:bg-background sm:inline-block">📌</button>
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
          {isHtmlEmail ? <EmailHtml m={m} p={p} asText={asText} signer={mine ? p.me.name : name} />
            : m.channel === "call" && m.ghlMessageId && m.ghlConversationId ? <CallPlayer m={m} peerName={t.peerName} />
            : <EmailBody body={m.body} signer={mine ? p.me.name : name} />}
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
          {selected && !copied && <span className="self-center text-muted">Selected. Press {shortcut("C")} to copy.</span>}
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
// The signature folds behind the same ••• as the quoted history (Derek,
// 2026-10-09): name, title, links, phone and a logo were taller than what
// the person wrote, and the header already says who they are.
const SIG_CSS = ".gmail_signature,.gmail_signature_prefix,[data-smartmail=gmail_signature],#Signature,#x_Signature{display:none!important}";
// Show as text lives in the email's ⋯ menu (Derek, 2026-10-01), so the
// switch is held by the email above this (EmailItem).
function EmailHtml({ m, p, asText = false, signer }: { m: Message; p: InboxViewProps; asText?: boolean; signer?: string | null }) {
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
    // The body's own height, not the page's: the page is never shorter than
    // the frame, so a fold (••• hiding the signature) would leave the gap.
    const size = () => setHeight(Math.min(6000, Math.max(60, Math.ceil(doc.body?.getBoundingClientRect().height ?? doc.documentElement.scrollHeight))));
    size();
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", size, { once: true }));
  };
  if (html === undefined) return <p className="text-muted">Loading the email…</p>;
  if (html === null || asText) return (
    <>
      <EmailBody body={m.body} signer={signer} />
    </>
  );
  const hasQuote = /gmail_quote|<blockquote|yahoo_quoted|divRplyFwdMsg|gmail_signature|id="(x_)?Signature"/i.test(html);
  const sender = (m.peerAddress ?? "").toLowerCase();
  const remote = REMOTE_IMAGES.test(html);
  // Your own sent mail shows as it is, and so does mail from one of your
  // contacts: hiding pictures is about strangers learning you opened it, and
  // a contact already knows you (Derek, 2026-10-09).
  const fromContact = !!m.contactId || (!!sender && p.contacts.some((c) => (c.email ?? "").toLowerCase() === sender
    || (c.additionalEmails ?? []).some((e) => e.toLowerCase() === sender)));
  const showImages = !remote || m.direction !== "inbound" || imagesOn || fromContact || (!!sender && (p.prefs.imageSenders ?? []).includes(sender));
  const csp = showImages ? "" : `<meta http-equiv="Content-Security-Policy" content="img-src data: blob:">`;
  const doc = `<!doctype html><html><head><meta charset="utf-8">${csp}<meta name="referrer" content="no-referrer"><base target="_blank"><style>html,body{margin:0;padding:0;background:#ffffff;color:#1c2030;font:16px/1.5 Inter,system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}${quoted ? "" : QUOTE_CSS + SIG_CSS}</style></head><body>${html}</body></html>`;
  return (
    <>
      {!showImages && (
        // One short line (Derek, 2026-10-05); the why and the address are in the hover.
        <div className="mb-2 flex items-center gap-4 whitespace-nowrap rounded-lg bg-background px-3 py-1.5 text-muted" title="Pictures are hidden so the sender can't tell you opened this.">
          <span>🖼 Pictures hidden</span>
          <button onClick={() => setImagesOn(true)} className="font-semibold text-accent hover:underline">Show</button>
          {sender && <button onClick={() => p.setPrefs({ imageSenders: [...(p.prefs.imageSenders ?? []), sender] })} title={`Always show pictures from ${sender}`} className="font-semibold text-accent hover:underline">Always show from this sender</button>}
        </div>
      )}
      <div className="overflow-hidden bg-white">
        <iframe key={showImages ? "on" : "off"} ref={frame} title="Email" srcDoc={doc} onLoad={fit} style={{ height }}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="block w-full border-0" />
      </div>
      {hasQuote && (
        <div className="mt-2">
          <button onClick={() => setQuoted(!quoted)} title={quoted ? "Hide the signature and earlier messages" : "Show the signature and earlier messages"} className="rounded-full bg-background px-3 font-bold tracking-widest text-muted hover:text-foreground">•••</button>
        </div>
      )}
    </>
  );
}

// What the person wrote, readable: tracking links show as their website,
// earlier messages quoted underneath fold away, and the email exactly as it
// came is one click off (Derek, 2026-10-01: "emails that look like all links").
// Where the signature starts in plain text: the "-- " line mail programs
// put above one, else the last line near the end that is just their name.
function signatureAt(text: string, signer?: string | null): number {
  const lines = text.split("\n");
  const from = Math.max(1, lines.length - 15);
  for (let i = lines.length - 1; i >= from; i--) if (/^--\s*$/.test(lines[i])) return lines.slice(0, i).join("\n").length;
  const name = (signer ?? "").trim().toLowerCase();
  if (name.split(/\s+/).length < 2) return -1;
  for (let i = lines.length - 1; i >= from; i--) {
    const l = lines[i].replace(/[*_]/g, "").trim().toLowerCase();
    if (l === name || l === `- ${name}` || l === `-${name}`) return lines.slice(0, i).join("\n").length;
  }
  return -1;
}
function EmailBody({ body, signer }: { body: string; signer?: string | null }) {
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
  const visible = split.visible || text;
  const sigAt = signatureAt(visible, signer);
  const trimmed = sigAt > 0 ? visible.slice(0, sigAt).trimEnd() : visible;
  const shown = quoted ? text : trimmed;
  const more = (!!split.quoted && !!split.visible) || trimmed !== visible;
  return (
    <>
      <p className="whitespace-pre-wrap break-words leading-relaxed">
        {bodyParts(shown).map((part, i) => "url" in part
          ? <a key={i} href={part.url} target="_blank" rel="noopener noreferrer nofollow" title={part.url} className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 align-baseline text-[15px] font-semibold text-accent hover:underline">🔗 {part.label}</a>
          : <span key={i}>{part.text}</span>)}
      </p>
      <div className="mt-2 flex flex-wrap gap-4">
        {more && <button onClick={() => setQuoted(!quoted)} title={quoted ? "Hide the signature and earlier messages" : "Show the signature and earlier messages"} className="rounded-full bg-background px-3 font-bold tracking-widest text-muted hover:text-foreground">•••</button>}
        {isLinkHeavy(text) && <button onClick={() => setOriginal(true)} className="font-semibold text-muted hover:underline">Show original</button>}
      </div>
    </>
  );
}

// Photos show as previews; anything else is a card to open (Derek,
// 2026-10-01: "show a preview if there are images").
// A small "image.png" on an email stored before signatures were left out:
// a logo or social icon from the signature, not a file anyone sent.
// The same test the server uses before copying files onto a task.

function Files({ m, p }: { m: Message; p: InboxViewProps }) {
  const imgs = m.attachments.filter((a) => a.kind === "image" && !isSignatureImage(a));
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
      {big !== null && <FileLightbox items={imgs.map((a) => ({ a, m }))} index={big} onIndex={setBig} onClose={() => setBig(null)} p={p} />}
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
// Saves the file under its own name. A signed storage link is on another
// host, where the browser ignores a download name and just opens it, so the
// file is fetched first and saved from here.
async function saveFile(a: Attachment, m: Message, p: InboxViewProps) {
  const url = await fileUrl(a, m, p, true);
  if (!url) { p.pushToast(`Couldn't download ${a.name}`); return; }
  let href = url;
  if (!url.startsWith("blob:")) {
    try { const res = await fetch(url); if (!res.ok) throw new Error(); href = URL.createObjectURL(await res.blob()); }
    catch { href = url; }
  }
  const link = document.createElement("a");
  link.href = href; link.download = a.name; link.rel = "noopener noreferrer";
  if (href === url && !url.startsWith("blob:")) link.target = "_blank";
  link.click();
  if (href !== url) setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
// Puts the picture on the clipboard to paste into a task, a chat or Canva.
// The clipboard only takes PNG, so anything else is redrawn as one.
async function copyImage(a: Attachment, m: Message, p: InboxViewProps) {
  try {
    const url = await fileUrl(a, m, p);
    if (!url) throw new Error();
    const png = (async () => {
      const blob = await (await fetch(url)).blob();
      if (blob.type === "image/png") return blob;
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error())), "image/png"));
    })();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    p.pushToast("Picture copied");
  } catch { p.pushToast(`Couldn't copy ${a.name}. Try Download.`); }
}

/** One picture full screen, with the rest of the set a click or an arrow away
 *  (Derek, 2026-10-09: the side panel's files open here too, with Download
 *  and Copy right on it). */
function FileLightbox({ items, index, onIndex, onClose, p }: {
  items: { a: Attachment; m: Message }[]; index: number; onIndex: (i: number) => void; onClose: () => void; p: InboxViewProps;
}) {
  const it = items[index];
  if (!it) return null;
  const n = items.length;
  const go = (d: number) => onIndex((index + d + n) % n);
  const btn = "h-10 rounded-lg border border-white/40 px-3 font-semibold text-white hover:bg-white/10";
  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col bg-black/85" onClick={onClose} role="dialog" aria-modal="true" aria-label={it.a.name}
      tabIndex={-1} ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        else if (e.key === "ArrowRight" && n > 1) go(1);
        else if (e.key === "ArrowLeft" && n > 1) go(-1);
      }}>
      <div onClick={(e) => e.stopPropagation()} className="flex flex-wrap items-center gap-2 px-4 py-3 text-white">
        <span className="min-w-0 flex-1 truncate font-medium">
          {it.a.name}{n > 1 ? `  ·  ${index + 1} of ${n}` : ""}
          <span className="ml-2 text-white/60">{[it.m.direction === "inbound" ? (it.m.peerName || it.m.peerAddress) : "You", new Date(it.m.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }), it.a.size].filter(Boolean).join(" · ")}</span>
        </span>
        <button onClick={() => saveFile(it.a, it.m, p)} className="h-10 rounded-lg bg-white px-4 font-semibold text-black hover:bg-white/90">⬇ Download</button>
        {typeof ClipboardItem !== "undefined" && <button onClick={() => copyImage(it.a, it.m, p)} className={btn}>Copy</button>}
        <button onClick={() => openFile(it.a, it.m, p, false)} className={btn}>Open in new tab</button>
        <button onClick={onClose} className={btn}>✕ Close</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        {n > 1 && <button onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous picture" className="absolute left-3 z-10 rounded-full bg-white/15 px-4 py-2 text-[28px] text-white hover:bg-white/25">‹</button>}
        <span onClick={(e) => e.stopPropagation()} className="contents">
          <FileImage key={`${it.m.id}:${it.a.id}`} a={it.a} m={it.m} p={p} className="max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-7rem)] rounded-lg bg-white object-contain shadow-2xl" />
        </span>
        {n > 1 && <button onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next picture" className="absolute right-3 z-10 rounded-full bg-white/15 px-4 py-2 text-[28px] text-white hover:bg-white/25">›</button>}
      </div>
    </div>,
    document.body,
  );
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

type WorkDraft = NonNullable<InboxViewProps["workDrafts"]>[number];
type QueuedDraftRow = NonNullable<InboxPrefs["queuedDrafts"]>[number];
const titleCase = (n: string) => (n === n.toLowerCase() ? n.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : n);
function DraftList({ p, queued, workDrafts, onOpenQueued }: { p: InboxViewProps; queued: QueuedDraftRow[]; workDrafts: WorkDraft[]; onOpenQueued: (d: QueuedDraftRow) => void }) {
  const [showOld, setShowOld] = useState(false);
  // What we've sent, to tell a draft you've already gone past.
  const sent = useMemo(() => p.inbox.threads.flatMap((t) => t.messages.filter((m) => m.direction === "outbound").map((m) => ({ key: t.key, to: (m.peerAddress ?? t.peerAddress ?? "").toLowerCase(), taskId: m.taskId ?? null, at: m.at }))), [p.inbox.threads]);
  const nameFor = (d: QueuedDraftRow) => {
    const c = (d.contactId && p.contacts.find((x) => x.id === d.contactId)) || p.contacts.find((x) => (x.email ?? "").toLowerCase() === d.to.toLowerCase());
    return c?.name || titleCase(d.name || d.to);
  };
  const rows = [
    ...queued.map((d) => ({
      id: d.id, at: d.createdAt, icon: d.kind === "email" ? "✉️" : "💬", who: nameFor(d), subject: d.subject || (d.kind === "text" ? "Text" : "(no subject)"),
      preview: htmlToText(d.body).slice(0, 160), tag: d.by && d.by !== "Claude" ? d.by : "Claude", claude: true,
      old: sent.some((s) => s.at > d.createdAt && (d.threadKey ? s.key === d.threadKey : !!s.to && s.to === d.to.toLowerCase())),
      open: () => onOpenQueued(d),
      del: () => {
        if (d.gmailDraftId) void authedFetch("/api/inbox/claude-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) }).catch(() => null);
        p.setPrefs({ queuedDrafts: queued.filter((x) => x.id !== d.id) });
      },
    })),
    ...workDrafts.map((d) => ({
      id: d.id, at: d.at, icon: "📝", who: d.clientName ?? "", subject: d.subject || "(no subject)", preview: d.preview,
      tag: d.where ? `On ${d.where}` : "On the client", claude: false,
      old: !!d.taskId && sent.some((s) => s.taskId === d.taskId && s.at > d.at),
      open: () => (d.taskId ? p.onOpenTask(d.taskId, "Drafts") : p.onOpenClientDraft?.(d.clientId)),
      del: p.onDeleteWorkDraft ? () => void p.onDeleteWorkDraft!(d) : null,
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  const fresh = rows.filter((r) => !r.old);
  const old = rows.filter((r) => r.old);
  const row = (r: (typeof rows)[number]) => (
    <div key={r.id} className={`group flex w-full items-start border-t hover:bg-background ${r.old ? "opacity-60" : ""}`}>
      <button onClick={r.open} className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-4 text-left">
        <span aria-hidden className="mt-0.5 text-[18px]">{r.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <b className="min-w-0 truncate">{r.who ? `${r.who}: ` : ""}{r.subject}</b>
            <span className={`shrink-0 rounded-[5px] px-1.5 text-[13px] font-semibold ${r.claude ? "bg-[#f3efff] text-[#7c3aed]" : "bg-background text-muted ring-1 ring-[var(--border)]"}`}>{r.claude ? `✳ ${r.tag}` : r.tag}</span>
          </span>
          {r.preview && <span className="block truncate text-[14px] text-muted">{r.preview}</span>}
        </span>
        <span className="shrink-0 pr-1 text-[14px] text-muted">{new Date(r.at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      </button>
      {r.del && <button onClick={r.del} title="Delete this draft" className="m-2 shrink-0 rounded-md px-2 py-1 text-[14px] font-semibold text-muted hover:text-danger">Delete</button>}
    </div>
  );
  return (
    <div className="border-b">
      {fresh.map(row)}
      {old.length > 0 && (
        <div className="border-t px-4 py-2 text-[14px] text-muted">
          <button onClick={() => setShowOld(!showOld)} className="font-semibold hover:text-foreground">
            {showOld ? "Hide" : "Show"} {old.length} older {old.length === 1 ? "draft" : "drafts"}
          </button>{" "}you&apos;ve written to them since
        </div>
      )}
      {showOld && old.map(row)}
    </div>
  );
}

// ── The reply box ─────────────────────────────────────────────────────────
// The AI helpers in one menu (Derek, 2026-10-05: fold them). Suggest times
// opens its calendar list in the same menu.
function AiMenu({ busy, hasText, canDraft, canSuggest, meId, defaultId, hidden = [], starredIds = [], onDraft, onImprove, onShorter, onSuggest }: {
  busy: string | null; hasText: boolean; canDraft: boolean; canSuggest: boolean; meId: string; defaultId?: string | null; hidden?: string[]; starredIds?: string[];
  onDraft: () => void; onImprove: () => void; onShorter: () => void; onSuggest: (l: BookingLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"main" | "times">("main");
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const [more, setMore] = useState(false);
  const close = () => { setOpen(false); setStep("main"); setMore(false); };
  const toTimes = () => { setStep("times"); if (links === null) loadBookingLinks().then(setLinks); };
  const seen = new Set<string>();
  const calendars = [...(links ?? [])].sort((a, b) => Number(b.calendarId === defaultId) - Number(a.calendarId === defaultId) || Number(starredIds.includes(b.calendarId)) - Number(starredIds.includes(a.calendarId)) || Number(b.memberId === meId) - Number(a.memberId === meId) || a.label.localeCompare(b.label))
    .filter((l) => (seen.has(l.calendarId) ? false : (seen.add(l.calendarId), true)));
  const shownCals = calendars.filter((l) => !hidden.includes(l.calendarId));
  const calList = more || !shownCals.length ? calendars : shownCals;
  const working = busy === "improve" ? "Improving…" : busy === "shorter" ? "Cutting…" : busy === "draft" ? "Drafting…" : busy === "times" ? "Finding times…" : null;
  const item = "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-background disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="relative">
      <button onClick={() => (open ? close() : setOpen(true))} disabled={busy === "send"} title="AI helpers"
        className="h-10 rounded-lg bg-[#f3efff] px-3 font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50">✨<span className="hidden sm:inline"> {working ?? "AI"} ▾</span></button>
      {open && <>
        <div className="fixed inset-0 z-40" onClick={close} />
        <div className="absolute bottom-12 left-0 z-50 max-h-96 w-[min(20rem,80vw)] overflow-y-auto rounded-lg bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
          {step === "main" ? <>
            {canDraft && <button disabled={busy !== null} onClick={() => { close(); onDraft(); }} className={item}><span>✍️</span><span><b className="block font-semibold">Draft a reply</b><span className="text-[14px] text-muted">From their email and the task</span></span></button>}
            {canSuggest && <button disabled={busy !== null} onClick={toTimes} className={item}><span>🗓</span><span className="flex-1"><b className="block font-semibold">Suggest times</b><span className="text-[14px] text-muted">Three open times and a booking link</span></span><span className="text-muted">›</span></button>}
            <button disabled={busy !== null || !hasText} onClick={() => { close(); onImprove(); }} className={item}><span>✨</span><span><b className="block font-semibold">Fix spelling and grammar</b><span className="text-[14px] text-muted">Your words, cleaned up</span></span></button>
            <button disabled={busy !== null || !hasText} onClick={() => { close(); onShorter(); }} className={item}><span>✂️</span><span><b className="block font-semibold">Make it shorter</b><span className="text-[14px] text-muted">Keeps your links and bold</span></span></button>
          </> : <>
            <button onClick={() => setStep("main")} className="w-full rounded-md px-3 py-1.5 text-left font-semibold text-muted hover:bg-background">‹ Suggest times from…</button>
            {links === null ? <div className="px-3 py-2 text-muted">Reading GoHighLevel…</div>
              : calList.length ? calList.map((l) => (
                <button key={l.calendarId} onClick={() => { close(); onSuggest(l); }} className={item}>
                  <span className="min-w-0"><b className="block truncate font-semibold">{l.label}</b><span className="text-[14px] text-muted">{l.calendarId === defaultId ? "★ default · " : ""}{l.minutes} min{l.shared ? " · shared" : l.memberId === meId ? " · yours" : ""}</span></span>
                </button>
              )) : <div className="px-3 py-2 text-muted">No calendars found.</div>}
            {links !== null && shownCals.length > 0 && calendars.length > shownCals.length && (
              <button onClick={() => setMore(!more)} className="w-full rounded-md px-3 py-1.5 text-left font-semibold text-muted hover:bg-background">{more ? "▴ Fewer" : `▸ More (${calendars.length - shownCals.length})`}</button>
            )}
          </>}
        </div>
      </>}
    </div>
  );
}

// Your signature, read once and kept for the session, so the email box can
// show what goes under your words (the send route adds it).
let signatureCache: Promise<string> | null = null;
const loadSignature = () => (signatureCache ??= authedFetch("/api/signature").then((r) => (r.ok ? r.json() : null)).then((j) => (typeof j?.signature === "string" ? j.signature : "")).catch(() => ""));

function Composer({ p, t, onSent, onDraft, mode = "reply", answering, onClose, emailInstead, compact = false, onUndone, onArchive }: {
  p: InboxViewProps; t: InboxThread; onSent: () => void; onDraft: () => void;
  mode?: ComposeMode; answering?: Message; onClose?: () => void; emailInstead?: (to: string, body: string) => void;
  /** Under a chat: two lines to start, Enter sends, Shift+Enter is a new line. */
  compact?: boolean;
  /** Undo on a reply still in its undo window: open the reply box again. */
  onUndone?: () => void;
  /** Archive the conversation and go back to the list (Send and archive). */
  onArchive?: () => void;
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
  // An email reply is written with formatting (Derek, 2026-10-02): the box
  // holds HTML. Chats and texts stay plain.
  const rich = email && !compact;
  const asRich = (v: string) => (rich && v && !looksLikeHtml(v) ? plainTextToHtml(v) : v);
  // A forward quotes the email under a "Forwarded message" line. An email
  // written in the app is stored as HTML, so it goes in as formatting, not as
  // its tags spelled out (Derek, 2026-10-07: the forward showed <p> and <a>).
  const forwardStart = (m: Message) => {
    const head = `Forwarded message from ${m.direction === "outbound" ? p.me.name : t.peerName}, ${when(m)}:`;
    if (!rich) return `\n\n${head}\n${m.body}`;
    const body = looksLikeHtml(m.body) ? safeMessageHtml(m.body) : plainTextToHtml(m.body);
    return `<p></p>${plainTextToHtml(head)}${body}`;
  };
  const [text, setText] = useState(() => asRich(readDraft(p.me.id, t.key) || (forward && answering ? forwardStart(answering) : "")));
  // The words alone, for "is there anything to send" and for the AI.
  const plain = rich ? htmlToText(text) : text;
  const hasText = !!plain.trim();
  // The editor reads its value when it starts, so text put in from outside
  // (Undo, a saved reply, the AI) starts it again.
  const [nonce, setNonce] = useState(0);
  const put = (v: string) => { setText(v); setNonce((n) => n + 1); };
  const [signature, setSignature] = useState("");
  useEffect(() => { if (rich) loadSignature().then(setSignature); }, [rich]);
  const [big, setBig] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  // Reply all: everyone else who was on it, besides the person you answer.
  const allOthers = (answering?.cc ?? []).filter((a) => a && a.toLowerCase() !== (t.peerAddress ?? "").toLowerCase() && a.toLowerCase() !== (p.me.email ?? "").toLowerCase());
  const [to, setTo] = useState(forward ? "" : t.peerAddress ?? "");
  const [ccOpen, setCcOpen] = useState(mode === "replyAll" && allOthers.length > 0);
  const [cc, setCc] = useState(mode === "replyAll" ? allOthers.join(", ") : ""); const [bcc, setBcc] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [note, setNote] = useState<{ kind: "ai" | "error"; text: string; before?: string } | null>(null);
  const [busy, setBusy] = useState<"improve" | "shorter" | "draft" | "times" | "send" | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // Whether this box is still open, for an Undo after it closed.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Insert from task (Derek, 2026-10-02): the linked task's review links,
  // other links and files, one click into the email.
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) ?? null : null;
  const [taskOpen, setTaskOpen] = useState(false);
  const [reviews, setReviews] = useState<{ id: string; name: string; url: string; opened: boolean }[] | null>(null);
  const [askReplace, setAskReplace] = useState(false);
  // Log in GoHighLevel: on for someone who is a contact, off for a stranger, so
  // a newsletter reply doesn't make a contact there.
  // Shown to everyone: the address is the sub-account's, and one teammate saving it covers all.
  const hasBcc = true;
  const [ghlLog, setGhlLog] = useState(!!t.contactId);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Keyed by the conversation, so one saver for as long as the box is open.
  const [saver] = useState(() => draftSaver(p.me.id, t.key));
  const change = (v: string) => {
    setText(v); setNote(null);
    saver.later(rich && !htmlToText(v).trim() ? "" : v, onDraft);
  };
  const putAndKeep = (v: string) => { change(v); setNonce((n) => n + 1); };
  // Discard (Derek, 2026-10-01: "struggling to close or cancel this draft"):
  // empties the box and the saved draft, with Undo, and closes an email reply.
  const discard = () => {
    const before = text, beforeFiles = files;
    put(""); setFiles([]); setNote(null); saver.now(""); onDraft();
    onClose?.();
    p.pushToast("Draft discarded", { label: "Undo", run: () => { put(before); setFiles(beforeFiles); saver.now(before); onDraft(); } });
  };
  const channelForAi = t.channel === "email" ? "email" : t.channel === "chat" ? "chat" : "sms";

  const words = (v: string) => (rich ? htmlToText(v) : v).split(/\s+/).filter(Boolean).length;
  // Improve fixes, Shorter tightens. The email box sends its HTML, so bold,
  // lists and links come back as they were.
  const improve = async (mode: "fix" | "shorter" = "fix") => {
    if (!hasText) return;
    setBusy(mode === "shorter" ? "shorter" : "improve");
    try {
      const r = await p.inbox.improve(rich ? text : plain, channelForAi, mode);
      if (r.changed) {
        const before = text;
        const next = rich ? (looksLikeHtml(r.text) ? r.text : asRich(r.text)) : r.text;
        putAndKeep(next);
        setNote({ kind: "ai", text: mode === "shorter" ? `Cut from ${words(before)} words to ${words(next)}.` : "Fixed spelling and grammar.", before });
      } else setNote({ kind: "ai", text: mode === "shorter" ? "It's already short. Nothing to cut." : "Looks good already. Nothing to fix." });
    } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : "Couldn't do that." }); }
    finally { setBusy(null); }
  };
  // Draft a reply from their email and the linked task. Over words already
  // written it asks first.
  const draft = async (replace = false) => {
    if (hasText && !replace) { setAskReplace(true); return; }
    setAskReplace(false); setBusy("draft");
    try {
      const r = await p.inbox.draftReply(t.key, t.taskId ?? null);
      const before = text;
      putAndKeep(asRich(r.text));
      setNote({ kind: "ai", text: r.usedTask && task ? `Drafted from their email and the task "${task.title}". Check it before you send.` : "Drafted from their email. Check it before you send.", before });
    } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : "Couldn't draft it." }); }
    finally { setBusy(null); }
  };
  // Suggest times (Phase 4, Derek, 2026-10-05): three real open times from the
  // chosen calendar and its booking page, written into the reply where the
  // cursor is. A draft to check and send; nothing is booked.
  const suggestTimes = async (l: BookingLink) => {
    setBusy("times"); setNote(null);
    try {
      const r = await p.inbox.proposeTimes(t.key, l.calendarId);
      const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const linkHtml = r.url ? `<a href="${r.url.replace(/"/g, "&quot;")}">book a time here</a>` : "";
      let html = r.text.split(/\n{2,}/).map((para) => para.trim()).filter(Boolean).map((para) => {
        const lines = para.split("\n").map((x) => x.trim());
        if (lines.every((x) => /^- /.test(x))) return `<ul>${lines.map((x) => `<li><p>${esc(x.slice(2))}</p></li>`).join("")}</ul>`;
        return `<p>${lines.map(esc).join("<br>")}</p>`;
      }).join("");
      html = html.includes("[[LINK]]") ? html.replace(/\[\[LINK\]\]/g, linkHtml) : html + (linkHtml ? `<p>Or pick any open time: ${linkHtml}</p>` : "");
      const before = text;
      const ed = editorRef.current;
      if (ed && !ed.isDestroyed && hasText) ed.chain().focus().insertContent(html).run();
      else putAndKeep(html);
      setNote({ kind: "ai", text: `Offered 3 open times from ${r.calendarName ?? "your calendar"}. Check them before you send.`, before });
    } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : "Couldn't suggest times." }); }
    finally { setBusy(null); }
  };
  const openTaskMenu = () => {
    setTaskOpen(!taskOpen);
    if (!taskOpen && task && reviews === null) p.inbox.taskReviews(task.id).then(setReviews).catch(() => setReviews([]));
  };
  const taskLinks = useMemo(() => (task ? linksOnTask(task).filter((l) => !(reviews ?? []).some((r) => r.url === l.url)) : []), [task, reviews]);
  const taskFiles = (task?.attachments ?? []).filter((a) => a.path);
  const insertLink = (url: string, label: string) => {
    setTaskOpen(false);
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) ed.chain().focus().insertContent([{ type: "text", text: label, marks: [{ type: "link", attrs: { href: url } }] }, { type: "text", text: " " }]).run();
    else putAndKeep(`${hasText ? text : ""}<p><a href="${url.replace(/"/g, "&quot;")}">${label.replace(/</g, "&lt;")}</a></p>`);
  };
  const attachFromTask = (a: Attachment) => {
    setTaskOpen(false);
    if (!files.some((f) => f.path === a.path)) setFiles((x) => [...x, a]);
    p.pushToast(`${a.name} attached`);
  };

  const upload = async (list: FileList | File[] | null) => {
    if (!list) return;
    const prefix = t.clientId ? `messages/${t.clientId}` : `inbox/${p.me.id}`;
    for (const f of Array.from(list)) { const a = await p.onUpload(prefix, f); if (a) setFiles((x) => [...x, a]); }
  };

  const deliver = async (body: string) => {
    if (t.channel === "chat") return p.onSendChat(t, body);
    if (t.channel === "team") return p.onSendTeam(t.key, body);
    await p.inbox.send({
      threadKey: t.key.startsWith("gm:") || t.key.startsWith("ghl:") ? t.key : null,
      to: email ? (to.trim() || undefined) : undefined,
      ...(forward && t.subject ? { subject: /^fwd?:/i.test(t.subject) ? t.subject : `Fwd: ${t.subject}` } : {}),
      cc: cc.split(/[,\s]+/).filter(Boolean), bcc: bcc.split(/[,\s]+/).filter(Boolean),
      body, attachments: files.filter((f) => f.path).map((f) => ({ path: f.path!, name: f.name })),
      ...(email ? { ghlLog: hasBcc && ghlLog } : {}),
    });
  };

  // Send sends: no typo check in the way (Derek, 2026-10-02: "it's already
  // been read and approved"). Improve with AI is the button for that.
  // archive: Send and archive (the ▾'s choice, remembered as the default).
  const send = async (archive = !!p.prefs.sendAndArchive && !!onArchive) => {
    const body = rich ? text : text.trim();
    if (!hasText) return;
    const clear = () => { put(""); saver.now(""); setFiles([]); setNote(null); onDraft(); };
    const go = async () => {
      setBusy("send");
      try { await deliver(body); p.pushToast("Sent"); onSent(); if (archive) onArchive?.(); }
      catch (e) { put(body); saver.now(body); onDraft(); p.pushToast(e instanceof Error ? e.message : "Couldn't send it."); }
      finally { setBusy(null); }
    };
    clear();
    if (p.prefs.undoSeconds > 0) {
      // The reply goes up into the conversation with Undo under it, no pop up
      // (Derek, 2026-10-07); it sends when the undo window ends.
      const id = newPendingId();
      let cancelled = false;
      const timer = setTimeout(async () => {
        if (cancelled) return;
        removePendingSend(id);
        try { await deliver(body); }
        catch (e) { writeDraft(p.me.id, t.key, body); onDraft(); onUndone?.(); if (mounted.current) put(body); p.pushToast(e instanceof Error ? `Not sent: ${e.message}` : "Couldn't send it. It's back in your reply."); }
      }, p.prefs.undoSeconds * 1000);
      addPendingSend({ id, threadKey: t.key, body, rich, undo: () => {
        cancelled = true; clearTimeout(timer); removePendingSend(id);
        writeDraft(p.me.id, t.key, body); onDraft();
        if (mounted.current) put(body); else onUndone?.();
      } });
      onSent();
      // Back to the list at once; it still sends when the undo window ends.
      if (archive) onArchive?.();
    } else go();
  };

  const later = async (at: Date) => {
    setLaterOpen(false);
    if (!p.onSchedule || !hasText) return;
    try { await p.onSchedule(t, rich ? text : text.trim(), at); put(""); saver.now(""); onDraft(); p.pushToast(`Scheduled for ${at.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`); }
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
        {hasText && <button onClick={discard} className="text-muted hover:underline">🗑 Discard draft</button>}
      </div>
    ) :
    <div className={compact ? "" : "rounded-xl bg-surface p-3 ring-2 ring-accent/40"}>
      {rich && (
        // One line on top (Derek, 2026-10-02): who it goes to, CC and BCC, and
        // close. What they wrote folds out from the arrow.
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-2" title={from}>
          <span className="shrink-0 font-semibold text-muted">{forward ? "↪ Forward to" : mode === "replyAll" ? "↩ Reply all to" : "↩ To"}</span>
          {forward
            ? <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who to forward it to" className="h-8 min-w-0 flex-1 bg-transparent outline-none" />
            : <span className="min-w-0 flex-1 truncate"><b>{t.peerName}</b>{t.peerAddress && t.peerAddress !== t.peerName && <span className="text-muted"> {t.peerAddress}</span>}</span>}
          {answering && !forward && <button onClick={() => setQuoteOpen(!quoteOpen)} title="What they wrote" aria-expanded={quoteOpen} className="rounded-md px-2 py-1 font-semibold text-muted hover:bg-background">{quoteOpen ? "▴" : "···"}</button>}
          <button onClick={() => setCcOpen(!ccOpen)} className="rounded-md px-2 py-1 font-semibold text-accent hover:bg-background">CC / BCC</button>
          <button onClick={() => setBig(!big)} title={big ? "Smaller" : "More room to write"} aria-label={big ? "Smaller" : "More room to write"} className="rounded-md px-2 py-1 text-muted hover:bg-background hover:text-foreground">{big ? "⤡" : "⤢"}</button>
          {onClose && <button onClick={onClose} title="Close (your draft is kept)" aria-label="Close" className="rounded-md px-2 py-1 text-muted hover:bg-background hover:text-foreground">✕</button>}
          {quoteOpen && answering && <div className="w-full rounded-lg bg-background px-3 py-2 text-muted"><b className="text-foreground">{fromLabel(answering) === "you" ? "You" : t.peerName}, {when(answering)}:</b> {(answering.body || "").replace(/\s+/g, " ").slice(0, 400)}</div>}
        </div>
      )}
      {!rich && answering && (
        <div className="mb-2 flex items-start gap-3 rounded-lg bg-background px-3 py-2">
          <span className="min-w-0 flex-1">
            <b>{mode === "forward" ? "Forwarding" : mode === "replyAll" ? "Replying to everyone on" : "Replying to"} {fromLabel(answering)}, {when(answering)}</b>
            <span className="block truncate text-muted">{(answering.body || "").replace(/\s+/g, " ").slice(0, 160)}</span>
          </span>
          {onClose && <button onClick={onClose} title="Close (your draft is kept)" aria-label="Close" className="text-muted hover:text-foreground">✕</button>}
        </div>
      )}
      {!compact && !rich && <div className="mb-1 text-muted">{from}</div>}
      {metaClosed && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg bg-highlight-soft px-3 py-2.5 font-semibold text-highlight">
          {t.channel === "ig" ? "Instagram" : "Facebook"} only allows a reply within 24 hours of their last message, and that was {shortTime(lastIn!.at)}.
          {altEmail && emailInstead && <button onClick={() => emailInstead(altEmail, text)} className="h-9 rounded-md px-3 ring-1 ring-current">✉️ Email them instead</button>}
        </div>
      )}
      {email && !rich && (
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
        // One slim line after Improve with AI: what it did, and Undo.
        <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-1.5 font-semibold ${note.kind === "error" ? "bg-danger-soft text-danger" : "bg-[#f3efff] text-[#7c3aed]"}`}>
          ✨ {note.text}
          {note.before !== undefined && <button onClick={() => { putAndKeep(note.before!); setNote(null); }} className="underline">Undo</button>}
        </div>
      )}
      {askReplace && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[#f3efff] px-3 py-1.5 font-semibold text-[#7c3aed]">
          ✍️ Replace what you wrote with a draft?
          <button onClick={() => draft(true)} className="underline">Replace</button>
          <button onClick={() => setAskReplace(false)} className="underline">Keep mine</button>
        </div>
      )}
      {rich ? (
        // Files dragged on, or a screenshot pasted, attach to the email.
        <div data-inbox-composer={t.key}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false); }}
          onDropCapture={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); setDropping(false); upload(e.dataTransfer.files); } }}
          onPasteCapture={(e) => { const f = Array.from(e.clipboardData.files); if (f.length && !e.clipboardData.getData("text/plain")) { e.preventDefault(); e.stopPropagation(); upload(f); } }}
          className={`relative mt-2 rounded-lg ${dropping ? "ring-2 ring-accent" : ""} ${big ? "[&_.rte-content]:min-h-[55vh]" : "[&_.rte-content]:min-h-[130px]"} [&_.rte-toolbar]:border-0 [&_.ProseMirror]:outline-none! [&_.ProseMirror]:px-1`}>
          <RichTextEditor key={`inbox-${t.key}-${nonce}`} variant="email" value={text} onChange={change} onEditor={(e) => { editorRef.current = e; }} autoFocus={!!answering && !forward}
            placeholder={forward ? "Add a note (optional)" : `Write to ${t.peerName.split(/\s+/)[0]}`} />
          {dropping && <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-accent-soft/80 font-bold text-accent">Drop to attach</div>}
          {/* What goes under your words: the send adds it, so there's no need to type it. */}
          <div className="mt-1 border-t border-dashed pt-2 text-muted">
            {signature.trim()
              ? <div className="opacity-70 [&_a]:underline" title="Your signature, added when it sends. Change it in Settings." dangerouslySetInnerHTML={{ __html: looksLikeHtml(signature) ? signature : plainTextToHtml(signature) }} />
              : <span>No signature yet. Add one in Settings and it goes on every email.</span>}
          </div>
        </div>
      ) : <textarea data-inbox-composer={t.key} autoFocus={!!answering && !forward} value={text} onChange={(e) => change(e.target.value)} placeholder={forward ? "Add a note (optional)" : `Write to ${t.peerName.split(/\s+/)[0]}`} rows={compact ? 1 : 4}
        onKeyDown={compact ? (e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } } : undefined}
        // Under a chat it starts at one line and grows with what you write, up to about six.
        ref={compact ? (el) => { if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; } } : undefined}
        className={compact ? "w-full resize-none overflow-y-auto rounded-lg bg-background px-4 py-2.5 leading-relaxed outline-none ring-1 ring-[var(--border)] focus:ring-accent" : "mt-1 w-full resize-y bg-transparent py-2 leading-relaxed outline-none"} />}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {files.map((f) => <span key={f.id} className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 ring-1 ring-[var(--border)]">{f.kind === "image" ? "🖼️" : "📄"} {f.name}<button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remove ${f.name}`} className="text-muted">✕</button></span>)}
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "pt-2" : "border-t pt-2.5"}`}>
        {t.channel !== "chat" && email && <>
          <button onClick={() => fileRef.current?.click()} title="Attach files (or drag them onto the box)" className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">📎{!rich && " Attach"}</button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </>}
        <div className="relative">
          <button onClick={() => setRepliesOpen(!repliesOpen)} title="Saved replies" className={`${compact ? "h-9 px-2.5" : "h-10 px-3"} rounded-lg border font-semibold hover:bg-background`}>⚡<span className={compact ? "hidden sm:inline" : rich ? "hidden" : ""}> Saved replies</span></button>
          {repliesOpen && (
            <div className="absolute bottom-12 left-0 z-50 w-80 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              {p.prefs.replies.length ? p.prefs.replies.map((r) => (
                <button key={r.name} onClick={() => { putAndKeep(rich ? (hasText ? text : "") + plainTextToHtml(r.text) : text.trim() ? `${text.trim()}\n\n${r.text}` : r.text); setRepliesOpen(false); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">
                  <b className="block">{r.name}</b><span className="text-[14px] text-muted">{r.text.slice(0, 70)}{r.text.length > 70 ? "…" : ""}</span>
                </button>
              )) : <div className="px-3 py-2 text-muted">None yet. Add some in Settings.</div>}
            </div>
          )}
        </div>
        {rich && task && (
          <div className="relative">
            <button onClick={openTaskMenu} title="Put in a link or file from the task" className={`h-10 rounded-lg px-3 font-semibold ring-1 ${taskOpen ? "bg-success-soft text-success ring-success" : "text-success ring-success/60 hover:bg-success-soft"}`}>🔗<span className="hidden sm:inline"> From task</span></button>
            {taskOpen && (
              <div className="absolute bottom-12 left-0 z-50 max-h-96 w-[min(22rem,80vw)] overflow-y-auto rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                <div className="truncate px-3 py-1.5 text-[14px] font-bold tracking-wide text-muted">ON &ldquo;{task.title.toUpperCase()}&rdquo;</div>
                {reviews === null && <div className="px-3 py-2 text-muted">Looking for review links…</div>}
                {(reviews ?? []).map((r) => (
                  <button key={r.id} onClick={() => insertLink(r.url, r.name)} className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-accent-soft">
                    <span>🔍</span><span className="min-w-0"><b className="block truncate">{r.name}</b><span className="text-muted">Review link · {r.opened ? "opened" : "not opened yet"}</span></span>
                  </button>
                ))}
                {taskLinks.map((l) => (
                  <button key={l.url} onClick={() => insertLink(l.url, l.label)} className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-accent-soft">
                    <span>🔗</span><span className="min-w-0"><b className="block truncate">{l.label}</b><span className="block truncate text-muted">{l.url.replace(/^https?:\/\//, "")}</span></span>
                  </button>
                ))}
                {taskFiles.map((a) => (
                  <button key={a.id} onClick={() => attachFromTask(a)} className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-accent-soft">
                    <span>{a.kind === "image" ? "🖼️" : "📄"}</span><span className="min-w-0"><b className="block truncate">{a.name}</b><span className="text-muted">File · attaches to the email</span></span>
                  </button>
                ))}
                {reviews !== null && !reviews.length && !taskLinks.length && !taskFiles.length && <div className="px-3 py-2 text-muted">Nothing on this task to put in yet: no live review links, links or files.</div>}
              </div>
            )}
          </div>
        )}
        {rich && <BookingLinkMenu me={p.me.id} hidden={p.prefs.hiddenBookingLinks} starred={[...(p.prefs.starredBookingLinks ?? []), ...(p.prefs.defaultCalendarId ? [p.prefs.defaultCalendarId] : [])]} onPick={(l) => insertLink(l.url, "book a time here")} />}
        {compact
          ? <button onClick={() => improve()} disabled={busy !== null || !hasText} title="Improve with AI" className="h-9 rounded-lg bg-[#f3efff] px-2.5 font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50">{busy === "improve" ? "✨ Improving…" : <>✨<span className="hidden sm:inline"> Improve with AI</span></>}</button>
          : <AiMenu busy={busy} hasText={hasText} canDraft={rich} canSuggest={rich && /^(gm|ghl):/.test(t.key)} meId={p.me.id} defaultId={p.prefs.defaultCalendarId} hidden={p.prefs.hiddenBookingLinks} starredIds={p.prefs.starredBookingLinks}
              onDraft={() => draft()} onImprove={() => improve()} onShorter={() => improve("shorter")} onSuggest={suggestTimes} />}
        {rich && hasBcc && (
          <label title="A hidden copy goes to your GoHighLevel Auto BCC Sync address, so it's logged on the contact" className="flex h-10 cursor-pointer items-center gap-2 px-1 font-semibold text-muted">
            <input type="checkbox" checked={ghlLog} onChange={(e) => setGhlLog(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />Log in GoHighLevel
          </label>
        )}
        {(hasText || files.length > 0) && <button onClick={discard} title="Throw this draft away" className="h-10 rounded-lg px-3 font-semibold text-muted hover:bg-background hover:text-foreground">🗑{!rich && " Discard"}</button>}
        <span className="flex-1" />
        {(t.channel === "sms" || t.channel === "call") && <span className="tabular-nums text-muted">{text.length} / 160</span>}
        <div className="relative flex">
          {/* Send, or Send and archive: the ▾ picks one, sends, and keeps it as
              the button's default (Derek, 2026-10-07). Send later lives there too. */}
          <button onClick={() => send()} disabled={busy !== null || !hasText || metaClosed} className="h-10 rounded-l-lg bg-accent px-5 font-bold text-white disabled:opacity-50">{busy === "send" ? "Checking…" : p.prefs.sendAndArchive && onArchive ? "Send & archive" : "Send"}</button>
          <button onClick={() => setLaterOpen(!laterOpen)} aria-label="More ways to send" aria-expanded={laterOpen} className="h-10 rounded-r-lg border-l border-white/30 bg-accent px-2.5 text-white">▾</button>
          {laterOpen && (<>
            <div className="fixed inset-0 z-40" onClick={() => setLaterOpen(false)} />
            <div className="absolute bottom-12 right-0 z-50 w-64 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              {([[false, "Send"], [true, "Send and archive"]] as const).filter(([a]) => !a || onArchive).map(([a, label]) => (
                <button key={label} disabled={busy !== null || !hasText || metaClosed}
                  onClick={() => { setLaterOpen(false); p.setPrefs({ sendAndArchive: a }); void send(a); }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-background disabled:opacity-50">
                  <span className="w-4 text-accent">{!!p.prefs.sendAndArchive === a ? "✓" : ""}</span>{label}
                </button>
              ))}
              {p.onSchedule && t.clientId && <>
                <div className="my-1 border-t" />
                <button onClick={() => later(tomorrow8())} className="block w-full rounded-md px-3 py-2.5 pl-9 text-left hover:bg-background">Send tomorrow, 8 AM</button>
                <button onClick={() => later(monday8())} className="block w-full rounded-md px-3 py-2.5 pl-9 text-left hover:bg-background">Send Monday, 8 AM</button>
              </>}
            </div>
          </>)}
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
      className="group relative hidden cursor-col-resize touch-none @min-[1000px]:block">
      <span className="absolute inset-y-0 left-[3px] w-0.5 bg-[var(--border)] transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
    </button>
  );
}

async function copyText(text: string, p: InboxViewProps) {
  try { await navigator.clipboard.writeText(text); p.pushToast("Copied"); }
  catch { p.pushToast("Couldn't copy. Select it and copy by hand."); }
}

function SidePanel({ p, t, linkSearchRef }: { p: InboxViewProps; t: InboxThread; linkSearchRef: React.RefObject<HTMLInputElement | null>; onOpenOther: (key: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Change contact: everyone outside the team on the conversation.
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [adding, setAdding] = useState<{ address: string; name: string | null } | null>(null);
  const people = useMemo(() => {
    const seen = new Map<string, string | null>();
    const add = (a: string | null | undefined, n?: string | null) => {
      const k = (a ?? "").trim().toLowerCase();
      if (!k.includes("@") || k.endsWith("@clickuplocal.com")) return;
      if (!seen.has(k) || (!seen.get(k) && n)) seen.set(k, n ?? null);
    };
    for (const m of t.messages) { add(m.peerAddress, m.direction === "inbound" ? m.peerName : null); (m.cc ?? []).forEach((c) => add(c)); }
    return [...seen].map(([address, name]) => ({ address, name }));
  }, [t.messages]);
  // Any of their addresses, the main one first (contactEmails.ts).
  const contactFor = (address: string) => p.contacts.find((c) => (c.email ?? "").toLowerCase() === address)
    ?? p.contacts.find((c) => (c.additionalEmails ?? []).includes(address)) ?? null;
  // The person the conversation is filed on: its contact, or for someone new
  // the one it came from.
  const isMain = (x: { address: string }) => (t.contactId ? contactFor(x.address)?.id === t.contactId || (!!contact?.email && contact.email.toLowerCase() === x.address) : (t.peerAddress ?? "").toLowerCase() === x.address);
  const changeTo = async (x: { address: string; name: string | null }) => {
    setBusy(true);
    try {
      const j = await p.inbox.addContact(t.key, { address: x.address, name: x.name ?? undefined });
      if (j.needsClient) setAdding({ address: x.address, name: j.name ?? x.name });
      else p.pushToast(`This conversation is now with ${x.name || x.address}`);
    } catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't change it."); }
    finally { setBusy(false); }
  };
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  // The conversation's other tasks (Derek, 2026-10-07: a client replies on the
  // same email with more to do). The main one above is where new replies land.
  const { loadMoreTasks } = p.inbox;
  useEffect(() => { loadMoreTasks(t.key); }, [t.key, loadMoreTasks]);
  const others = (p.inbox.moreTasks.get(t.key) ?? []).map((id) => p.tasks.find((x) => x.id === id)).filter((x): x is Task => !!x);
  const linkedKey = [t.taskId, ...others.map((x) => x.id)].filter(Boolean).join(",");
  const linked = useMemo(() => new Set(linkedKey.split(",").filter(Boolean)), [linkedKey]);
  const [addOpen, setAddOpen] = useState(false);
  const client = p.clientName(t.clientId);
  const contact = t.contactId ? p.contacts.find((x) => x.id === t.contactId) ?? null : null;
  const person = contact?.name || t.peerName;
  const conv = t.ghlConversationId ? p.inbox.convs.get(t.ghlConversationId) : undefined;
  const email = contact?.email || (t.peerAddress?.includes("@") ? t.peerAddress : null) || conv?.email || null;
  const phone = contact?.phone || (t.peerAddress && !t.peerAddress.includes("@") ? t.peerAddress : null) || conv?.phone || null;
  const ghlUrl = t.contactId ? p.ghlUrlFor(t.contactId) : null;
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return p.tasks
      .filter((x) => x.status !== "done" && !linked.has(x.id) && (!t.clientId || x.clientId === t.clientId || words.length > 0))
      .filter((x) => words.every((w) => x.title.toLowerCase().includes(w) || (p.clientName(x.clientId) ?? "").toLowerCase().includes(w)))
      .slice(0, 6);
  }, [q, p, t.clientId, linked]);
  // Whose it is: the conversation's client, else the one picked here, else a
  // guess from the sender's name ("Pamela Macias (via Google Drive)" is Pamela
  // Macias), so her lists show without matching her email (Derek, 2026-10-06).
  const [pickedClient, setPickedClient] = useState("");
  // Personal and the agency's own projects (ClickUpLocal) first, then every
  // client (Derek, 2026-10-07: "how do I add something to personal or projects").
  const clientOptions = useMemo(() => [
    { value: PERSONAL_CLIENT_ID, label: "Personal", sub: "Only you see it" },
    { value: WORKSPACE_CLIENT_ID, label: "ClickUpLocal", sub: "Our own projects" },
    ...[...p.clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name })),
  ], [p.clients]);
  const guessedClient = useMemo(() => {
    const name = t.peerName.replace(/\s*\(via [^)]*\)\s*$/i, "").trim().toLowerCase();
    return name ? p.clients.find((c) => c.name.toLowerCase() === name)?.id ?? "" : "";
  }, [t.peerName, p.clients]);
  const whose = t.clientId || pickedClient || guessedClient;
  const whoseLists = whose ? p.listsFor(whose) : [];
  // Their open tasks (this contact's, else this client's), soonest due first.
  const theirs = useMemo(() => p.tasks
    .filter((x) => x.status !== "done" && !x.private && !linked.has(x.id) && ((t.contactId && x.contactId === t.contactId) || (whose && x.clientId === whose)))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")), [p.tasks, t.contactId, whose, linked]);
  const [searchOpen, setSearchOpen] = useState(false);
  const link = async (taskId: string | null) => {
    setBusy(true);
    const add = !!taskId && !!t.taskId && taskId !== t.taskId;
    try {
      await p.inbox.linkTask(t.key, taskId, add);
      // Another task gets their newest email as a comment, so whoever does it
      // can read the request there (Derek, 2026-10-07).
      const last = add ? t.messages.find((m) => m.direction === "inbound") : null;
      if (last && taskId) {
        const from = whoWrote(last, t, p).name;
        p.onAddComment(taskId, `📌 Email from ${from}, ${fullTime(last.at)}${last.subject ? `\n${last.subject}` : ""}\n\n${(last.body || "").trim().slice(0, 4000)}`);
      }
      p.pushToast(add ? "Linked, with their email added to the task" : taskId ? "Linked. New messages here land on the task too." : "Unlinked");
      setQ(""); setAddOpen(false);
    }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't link it."); }
    finally { setBusy(false); }
  };
  const unlink = async (taskId: string) => {
    setBusy(true);
    try { await p.inbox.unlinkTask(t.key, taskId); p.pushToast("Unlinked"); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't unlink it."); }
    finally { setBusy(false); }
  };
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newList, setNewList] = useState("");
  const [newOn, setNewOn] = useState("");
  const [newDue, setNewDue] = useState("");
  // Open the new task form, on a list: the title from the email, on you, due today.
  const startNew = (listId: string) => {
    const last = [...t.messages].reverse().find((m) => m.direction === "inbound");
    const firstLine = (last?.body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
    const subject = (t.subject ?? "").replace(/^(re|fwd?):\s*/i, "").replace(/^(item|file|folder) shared with you:\s*/i, "");
    setNewTitle(subject || firstLine || `Follow up with ${t.peerName.split(/\s+/)[0]}`);
    setNewList(listId); setNewOn(p.me.id); setNewDue(new Date().toLocaleDateString("en-CA")); setNewOpen(true);
  };
  const ownerMember = task?.assigneeId ? p.team.find((x) => x.id === task.assigneeId) ?? (task.assigneeId === CLAUDE_ID ? { id: CLAUDE_ID, name: "Claude" } : null) : null;
  const owner = task?.assigneeId ? (task.assigneeId === p.me.id ? "You" : ownerMember?.name ?? null) : null;
  const dueLabel = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : null);
  const card = "rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]";
  const label = "mb-1.5 text-[14px] font-bold tracking-wide text-muted";
  const linkBtn = "font-semibold text-accent hover:underline";
  const picker = <>
          {/* Her lists first, one click to add a task there (Derek, 2026-10-06:
              "see what list she has, click on the list and then add here").
              Search waits behind a link. */}
          {!t.clientId && (
            // Searchable (Derek, 2026-10-07): a plain select of every client
            // was a long scroll to find one.
            <div className="mb-2 flex items-center gap-2"><span className="shrink-0 text-muted">Whose</span>
              <SearchableSelect value={whose} options={clientOptions} onChange={(v) => { setPickedClient(v); setNewOpen(false); }}
                placeholder="Pick a client" searchPlaceholder="Search clients…" title="Whose is it"
                className="h-9 min-w-0 flex-1 rounded-md bg-surface px-2 text-left ring-1 ring-[var(--border)]" /></div>
          )}
          {whoseLists.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-muted">Add a task to {p.clientName(whose)?.split(/\s+/)[0] ?? "their"} list</div>
              <div className="flex flex-wrap gap-1.5">
                {whoseLists.map((l) => (
                  <button key={l.id} disabled={busy} onClick={() => startNew(l.id)}
                    className={`rounded-md px-3 py-1.5 font-semibold ring-1 disabled:opacity-50 ${newOpen && newList === l.id ? "bg-accent text-white ring-accent" : "bg-surface text-accent ring-[var(--border)] hover:ring-accent"}`}>＋ {l.name}</button>
                ))}
              </div>
            </div>
          )}
          {!newOpen && <p className="mb-1.5 text-muted">{task ? "Their newest email is added to the task you pick." : theirs.length ? "Or link it to one of their open tasks:" : "Link it and every new message here lands on the task too."}</p>}
          {searchOpen || !whose ? <input ref={linkSearchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={client ? `Search ${client}'s tasks` : "Search tasks"} className="h-10 w-full rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
            : null}
          {/* Their open tasks, one click to link (Derek, 2026-10-02: "quick"):
              three, then Show more; typing searches every task. */}
          <div className="mt-1.5 space-y-1">
            {(q ? matches : theirs.slice(0, showAll ? 12 : 3)).map((x) => (
              <div key={x.id} className="flex items-center gap-2 rounded-lg bg-background py-1.5 pl-3 pr-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{x.title}</span>
                  <span className="block truncate text-[14px] text-muted">{q ? p.clientName(x.clientId) : STATUS_META[x.status].label}{x.due ? ` · due ${new Date(`${x.due}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</span>
                </span>
                <button disabled={busy} onClick={() => link(x.id)} title="Link this email to it" aria-label={`Link to ${x.title}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-[20px] font-bold text-white disabled:opacity-50">＋</button>
              </div>
            ))}
            {!q && theirs.length === 0 && !whose && <p className="text-muted">No open tasks for them yet.</p>}
            {!q && theirs.length > 3 && !showAll && <button onClick={() => setShowAll(true)} className={linkBtn}>Show {Math.min(theirs.length, 12) - 3} more</button>}
            {whose && !searchOpen && <button onClick={() => setSearchOpen(true)} className={`${linkBtn} block`}>Search all tasks</button>}
          </div>
          {/* Type the task, then create it (Derek, 2026-10-06: "more custom
              control"): title, list, who it's on and when it's due. */}
          {!newOpen ? (
            <button disabled={busy} onClick={() => startNew(whoseLists[0]?.id ?? "")} className={`${linkBtn} mt-2`}>＋ New task from this</button>
          ) : (
            <form className="mt-3 grid gap-2 rounded-lg bg-background p-3" onSubmit={async (e) => {
              e.preventDefault();
              if (!newTitle.trim()) return;
              setBusy(true);
              const id = await p.onNewTask(t, { title: newTitle.trim(), clientId: whose || null, projectId: newList || null, assigneeId: newOn || null, due: newDue || null });
              if (id) await link(id);
              setBusy(false); setNewOpen(false);
            }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setNewOpen(false); } }}>
              <b className="text-[14px] font-bold uppercase tracking-wide text-muted">New task</b>
              <textarea autoFocus rows={2} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} aria-label="What needs doing"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                placeholder="What needs doing?" className="w-full resize-none rounded-md bg-surface px-3 py-2 text-[16px] font-semibold outline-none ring-1 ring-[var(--border)] focus:ring-accent" />
              {whoseLists.length > 0 && (
                <label className="flex items-center gap-2"><span className="w-12 shrink-0 text-muted">List</span>
                  <select value={newList} onChange={(e) => setNewList(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md bg-surface px-2 ring-1 ring-[var(--border)]">
                    {whoseLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select></label>
              )}
              <label className="flex items-center gap-2"><span className="w-12 shrink-0 text-muted">On</span>
                <select value={newOn} onChange={(e) => setNewOn(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md bg-surface px-2 ring-1 ring-[var(--border)]">
                  {[...p.team].sort((a, b) => (a.id === p.me.id ? -1 : b.id === p.me.id ? 1 : a.name.localeCompare(b.name))).map((m) => <option key={m.id} value={m.id}>{m.id === p.me.id ? "You" : m.name}</option>)}
                  <option value={CLAUDE_ID}>Claude</option>
                  <option value="">Nobody yet</option>
                </select></label>
              <label className="flex items-center gap-2"><span className="w-12 shrink-0 text-muted">Due</span>
                <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md bg-surface px-2 ring-1 ring-[var(--border)]" /></label>
              <div className="mt-1 flex items-center gap-2">
                <button type="submit" disabled={busy || !newTitle.trim()} className="h-9 rounded-md bg-accent px-4 font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Create task"}</button>
                <button type="button" onClick={() => setNewOpen(false)} className="h-9 px-2 font-semibold text-muted hover:text-foreground">Cancel</button>
              </div>
            </form>
          )}
  </>;
  // Straight to their task list, the first thing in the panel (Derek,
  // 2026-10-07: "I need a way to get to their main task list quickly").
  const whoseName = whose && whose !== PERSONAL_CLIENT_ID ? p.clientName(whose) : null;
  // When they wrote last, how long they've been waiting on us (Derek,
  // 2026-10-09): amber after a day, red after two.
  const newest = t.messages[0];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(i); }, []);
  const waiting = useMemo(() => {
    if (!newest || newest.direction !== "inbound") return null;
    const mins = Math.max(0, Math.round((now - new Date(newest.at).getTime()) / 60_000));
    const days = mins / 1440;
    const age = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} hr` : `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"}`;
    return { who: whoWrote(newest, t, p).name.split(/\s+/)[0], age, days };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p is a fresh object every render
  }, [newest, t, now]);
  return (
    <aside className="min-w-0 space-y-3 p-4">
      {task ? (
        // The task IS the bar once it's linked (Derek, 2026-10-09, mockup C):
        // what it is, where it stands, one click to the task to change it.
        // The five boxes that were here are edits the drawer already does.
        <div className="space-y-2">
          {/* Label left, the jump right, same as the sections under it
              (Derek, 2026-10-09: "some consistency"). */}
          <div className="flex items-center gap-2 px-1 pt-1">
            <span className="flex-1 text-[14px] font-bold tracking-wide text-muted">{others.length ? "LINKED TASKS" : "LINKED TASK"}</span>
            {whoseName && <AppLink href={clientHref(whose)} onOpen={() => p.onOpenClient(whose)} title={`Open ${whoseName}'s task list`} className="text-[14px] font-semibold text-accent hover:underline">{whoseName.split(/\s+/)[0]}&apos;s tasks →</AppLink>}
          </div>
          <AppLink href={taskHref(task.id)} onOpen={() => p.onOpenTask(task.id, t.subject || t.peerName)} title="Open the task to view or change it"
            className="block w-full rounded-xl bg-accent px-4 py-3 text-left text-white hover:opacity-90">
            <span className="flex items-start gap-2">
              <b className="min-w-0 flex-1 text-[17px] leading-snug">{task.title}</b>
              <span aria-hidden className="text-[18px] leading-snug">→</span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-white/85">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70" style={{ background: STATUS_META[task.status].dot }} />
              {[
                STATUS_META[task.status].label + (task.waitingOnClient ? ", waiting on client" : ""),
                owner,
                task.due ? `${task.status !== "done" && isOverdue(task.due) ? "overdue" : "due"} ${dueLabel(task.due)}` : null,
                task.followUpAt ? `follow up ${dueLabel(task.followUpAt.slice(0, 10))}` : null,
              ].filter(Boolean).join(" · ")}
            </span>
            {waiting && (
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-[5px] px-2 py-0.5 text-[15px] font-semibold ${waiting.days >= 2 ? "bg-[#dc2626] text-white" : waiting.days >= 1 ? "bg-[#fbbf24] text-[#1c2030]" : "bg-white/15 text-white"}`}>
                ⏱ {waiting.who} waiting {waiting.age}
              </span>
            )}
          </AppLink>
          {others.map((x) => (
            <div key={x.id} className="flex items-center gap-2 rounded-xl bg-surface py-1.5 pl-3 pr-1.5 ring-1 ring-[var(--border)]">
              <AppLink href={taskHref(x.id)} onOpen={() => p.onOpenTask(x.id, t.subject || t.peerName)} className="min-w-0 flex-1 text-left" title="Open task">
                <span className="block truncate font-semibold">{x.title}</span>
                <span className="flex items-center gap-1.5 truncate text-muted"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_META[x.status].dot }} />{STATUS_META[x.status].label}{x.due ? ` · due ${dueLabel(x.due)}` : ""}</span>
              </AppLink>
              <button disabled={busy} onClick={() => unlink(x.id)} title="Unlink from this conversation" aria-label={`Unlink ${x.title}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-background hover:text-danger disabled:opacity-50"><BrokenLinkIcon /></button>
            </div>
          ))}
          {addOpen ? (
            <div className={card}>
              <div className="mb-2 flex items-center"><span className={`${label} mb-0 flex-1`}>ANOTHER TASK</span>
                <button onClick={() => { setAddOpen(false); setNewOpen(false); setQ(""); }} className="font-semibold text-muted hover:text-foreground">Cancel</button></div>
              {picker}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
              <button onClick={() => setAddOpen(true)} className={linkBtn}>＋ Link another</button>
              <button disabled={busy} onClick={() => unlink(task.id)} title="Unlink from this conversation"
                className="ml-auto flex items-center gap-1 font-semibold text-muted hover:text-danger disabled:opacity-50"><BrokenLinkIcon /> Unlink</button>
            </div>
          )}
        </div>
      ) : <>
        {whoseName && (
          <AppLink href={clientHref(whose)} onOpen={() => p.onOpenClient(whose)} title={`Open ${whoseName}'s task list`}
            className="flex h-11 w-full items-center justify-between gap-2 rounded-xl bg-accent px-4 text-left text-[16px] font-bold text-white hover:opacity-90">
            <span className="min-w-0 truncate">Open {whoseName}&apos;s tasks</span><span aria-hidden>→</span>
          </AppLink>
        )}
        <div className={card}>
          <div className={label}>LINK TO A TASK</div>
          {picker}
        </div>
      </>}

      {/* Just the task and the people (Derek, 2026-10-02): the person's other
          tasks and conversations were more than this needs. */}
      {t.channel === "email" && people.length > 0 ? (
        // Everyone outside the team on the email, a card each (Derek, 2026-10-02,
        // mockup https://claude.ai/artifact/3Sp1HavTj7KLFJYaK8QuyN): the one
        // replies go to first. Click a name to see and change the contact.
        <>
          <div className="px-1 pt-1 text-[14px] font-bold tracking-wide text-muted">PEOPLE ON THIS EMAIL</div>
          {[...people].sort((a, b) => Number(isMain(b)) - Number(isMain(a))).map((x) => (
            <PersonCard key={x.address} p={p} t={t} x={x} contact={contactFor(x.address)} main={isMain(x)} busy={busy}
              clientId={isMain(x) ? t.clientId : null} onMakeMain={() => changeTo(x)} />
          ))}
        </>
      ) : (
      <div className={card}>
        <div className="flex items-start justify-between gap-2">
          <div className={label}>{contact || client ? "CONTACT" : "FROM"}</div>
          {people.length > 1 && (
            <span className="relative">
              <button onClick={() => setPeopleOpen(!peopleOpen)} className={`${linkBtn} text-[15px]`}>Change ▾</button>
              {peopleOpen && (
                <Menu onClose={() => setPeopleOpen(false)} right>
                  <div className="px-3 pb-1 pt-1.5 text-[14px] text-muted">Who is this conversation with?</div>
                  {people.map((x) => (
                    <button key={x.address} disabled={busy} onClick={() => { setPeopleOpen(false); changeTo(x); }} className="block w-full rounded-md px-3 py-2 text-left hover:bg-background">
                      <b className="block">{x.name || x.address}</b>{x.name && <span className="text-[14px] text-muted">{x.address}</span>}
                    </button>
                  ))}
                </Menu>
              )}
            </span>
          )}
        </div>
        <b className="block text-[18px]">{person}</b>
        {(contact?.company || (client && client !== person)) && <div className="text-muted">🏢 {contact?.company || client}</div>}
        {(email || phone) && (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
            {email && <><span className="break-all">{email}</span><span className="flex gap-3">
              {/* Email them from any conversation, a text one included (Derek, 2026-10-06). */}
              {t.channel !== "email" && <button onClick={() => window.dispatchEvent(new CustomEvent("inbox-compose", { detail: { kind: "email", to: email, contactId: contact?.id, name: person ?? undefined } }))} title={`Write an email to ${person ?? email}`} className={`${linkBtn} font-semibold`}>Email</button>}
              <button onClick={() => copyText(email, p)} className={linkBtn}>Copy</button></span></>}
            {phone && <><span>{phone}</span><button onClick={() => copyText(phone, p)} className={linkBtn}>Copy</button></>}
          </div>
        )}
        {client ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {t.clientId && <AppLink href={clientHref(t.clientId)} onOpen={() => p.onOpenClient(t.clientId!)} className={linkBtn}>Open client</AppLink>}
            {ghlUrl && <a href={ghlUrl} target="_blank" rel="noopener noreferrer" className={linkBtn}>Open in GoHighLevel</a>}
          </div>
        ) : !adding && <AddToClient p={p} t={t} />}
        {adding && <AddToClient p={p} t={t} person={adding} onDone={() => setAdding(null)} />}
      </div>
      )}
      <ThreadFiles p={p} t={t} />
    </aside>
  );
}

// Every file in the conversation under the people, newest first, so a
// screenshot from three emails back is one click away (Derek, 2026-10-09).
// Pictures as a gallery with no names (Derek, same day: "just do a gallery
// view"); a click opens the lightbox with Download and Copy. Other files are
// small tiles. Signature logos are left out, same as under each email.
function ThreadFiles({ p, t }: { p: InboxViewProps; t: InboxThread }) {
  const files = t.messages.flatMap((m) => (m.attachments ?? []).filter((a) => !isSignatureImage(a)).map((a) => ({ a, m })))
    .sort((x, y) => y.m.at.localeCompare(x.m.at));
  const imgs = files.filter((f) => f.a.kind === "image");
  const docs = files.filter((f) => f.a.kind !== "image");
  const [big, setBig] = useState<number | null>(null);
  const [zipping, setZipping] = useState(false);
  const saveable = files.filter((f) => f.a.kind !== "link");
  // Every file in one zip, named after the subject.
  const downloadAll = async () => {
    setZipping(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const used = new Set<string>();
      let missed = 0;
      for (const { a, m } of saveable) {
        const url = await fileUrl(a, m, p, true);
        const res = url ? await fetch(url).catch(() => null) : null;
        if (!res?.ok) { missed++; continue; }
        let name = a.name, i = 1;
        while (used.has(name)) name = a.name.replace(/(\.[^.]*)?$/, (ext) => ` (${i++})${ext}`);
        used.add(name);
        zip.file(name, await res.blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href; link.download = `${(t.subject || "Attachments").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "Attachments"}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      if (missed) p.pushToast(`${missed} file${missed === 1 ? "" : "s"} couldn't be added`);
    } catch { p.pushToast("Couldn't make the zip"); }
    finally { setZipping(false); }
  };
  if (!files.length) return null;
  return (
    <>
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className="flex-1 text-[14px] font-bold tracking-wide text-muted">ATTACHMENTS · {files.length}</span>
        {saveable.length > 1 && (
          <button onClick={downloadAll} disabled={zipping} className="text-[14px] font-semibold text-accent hover:underline disabled:opacity-50">
            {zipping ? "Zipping…" : "⬇ Download all"}
          </button>
        )}
      </div>
      {imgs.length > 0 && (
        <div className="columns-2 gap-1.5 [&>*]:mb-1.5">
          {imgs.map((f, i) => (
            <button key={`${f.m.id}:${f.a.id}`} onClick={() => setBig(i)} aria-label={`Preview ${f.a.name}`}
              title={`${f.a.name} · ${new Date(f.m.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
              className="block w-full break-inside-avoid overflow-hidden rounded-md bg-surface ring-1 ring-[var(--border)] transition hover:ring-2 hover:ring-accent">
              <FileImage a={f.a} m={f.m} p={p} className="block min-h-16 w-full" />
            </button>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {docs.map(({ a, m }) => {
            const opens = a.kind === "pdf" || a.kind === "link";
            return (
              <button key={`${m.id}:${a.id}`} onClick={() => openFile(a, m, p, !opens)} title={`${opens ? "Open" : "Download"} ${a.name}`}
                className="flex max-w-full items-center gap-2 rounded-md bg-surface py-1 pl-1 pr-2.5 ring-1 ring-[var(--border)] hover:ring-accent">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-danger-soft text-[11px] font-extrabold text-danger">{a.kind === "pdf" ? "PDF" : a.kind === "sheet" ? "XLS" : a.kind === "link" ? "LINK" : "DOC"}</span>
                <span className="truncate text-[14px] font-semibold">{a.name}</span>
              </button>
            );
          })}
        </div>
      )}
      {big !== null && <FileLightbox items={imgs} index={big} onIndex={setBig} onClose={() => setBig(null)} p={p} />}
    </>
  );
}

// ── The side panel of a team chat: the task, and who is in the chat ─────
function TeamPanel({ p, t }: { p: InboxViewProps; t: InboxThread }) {
  const task = t.taskId ? p.tasks.find((x) => x.id === t.taskId) : null;
  const [statusOpen, setStatusOpen] = useState(false);
  const nameOf = (id: string) => p.team.find((m) => m.id === id)?.name ?? "Teammate";
  // In the chat: whoever has written in it, the task's owner, the other side
  // of a direct message, or everyone for the group.
  const inChat = useMemo(() => {
    if (t.key === "team:group") return p.team.map((m) => m.id);
    const ids = new Set<string>([p.me.id]);
    if (t.key.startsWith("team:dm:")) ids.add(t.key.slice(8));
    t.messages.forEach((m) => { if (m.createdBy) ids.add(m.createdBy); });
    if (task?.assigneeId) ids.add(task.assigneeId);
    return [...ids].filter((id) => p.team.some((m) => m.id === id));
  }, [t, task, p.team, p.me.id]);
  const card = "rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]";
  const label = "mb-1.5 text-[14px] font-bold tracking-wide text-muted";
  const linkBtn = "font-semibold text-accent hover:underline";
  const dueLabel = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : null);
  // Adding someone to a task chat mentions them on the task, which tells them.
  const addPerson = async (id: string) => {
    try { await p.onSendTeam(t.key, `@${nameOf(id)} joining this chat`); p.pushToast(`${nameOf(id).split(/\s+/)[0]} added`); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't add them."); }
  };
  return (
    <aside className="min-w-0 space-y-3 p-4">
      {task ? (
        <div className={card}>
          <div className={label}>TASK</div>
          <b className="block text-[18px] leading-snug">{task.title}</b>
          {p.clientName(task.clientId) && <div className="text-muted">🏢 {p.clientName(task.clientId)}</div>}
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
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {task.status !== "done" && <button onClick={() => { p.onPatchTask(task.id, { status: "done" }); p.pushToast("Marked done"); }} className="h-9 rounded-lg bg-success px-3 font-bold text-white">✓ Mark done</button>}
            <AppLink href={taskHref(task.id)} onOpen={() => p.onOpenTask(task.id, t.peerName)} className={linkBtn}>Open task →</AppLink>
          </div>
        </div>
      ) : (
        <div className={card}>
          <div className={label}>{t.key === "team:group" ? "GROUP CHAT" : "DIRECT MESSAGE"}</div>
          <p className="text-muted">Just a chat. Talk about a task in that task&apos;s own chat, so it stays with the work.</p>
        </div>
      )}
      <div className={card}>
        <div className={label}>IN THIS CHAT</div>
        {inChat.map((id) => (
          <div key={id} className="flex items-center gap-2.5 py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white" style={{ background: avatarColor(nameOf(id)) }}>{initials(nameOf(id))}</span>
            <b className="truncate">{nameOf(id)}</b>{id === p.me.id && <span className="text-muted">(you)</span>}
          </div>
        ))}
        {task && p.team.filter((m) => !inChat.includes(m.id)).map((m) => (
          <button key={m.id} onClick={() => addPerson(m.id)} className={`${linkBtn} mt-1.5 block`}>＋ Add {m.name.split(/\s+/)[0]}</button>
        ))}
      </div>
    </aside>
  );
}

// ── A person on an email ──────────────────────────────────────────────────
const ICO: Record<string, string> = {
  mail: "M4 4h16v16H4zM22 6l-10 7L2 6",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  copy: "M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  building: "M4 2h16v20H4zM9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01",
  reply: "M9 17l-5-5 5-5M20 18v-2a4 4 0 0 0-4-4H4",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  ext: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  check: "M20 6 9 17l-5-5",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9z",
  text: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  calendar: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
};
// A real link for the ways into a task or a client, so right click offers
// Open Link in Split View and New Tab, and ⌘ click opens a tab (Derek,
// 2026-10-07: "set it up so I can right click to open in split view"). A
// plain click still opens it in place.
const taskHref = (id: string) => `/?task=${encodeURIComponent(id)}`;
const clientHref = (id: string) => `/?client=${encodeURIComponent(id)}`;
function AppLink({ href, onOpen, children, ...rest }: { href: string; onOpen: () => void; children: ReactNode; className?: string; title?: string; "aria-label"?: string }) {
  return (
    <a href={href} {...rest} onClick={(e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onOpen();
    }}>{children}</a>
  );
}

function BrokenLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L5 9" /><path d="M15 9l1.5-1.5a3.5 3.5 0 0 1 5 5L19 15" />
      <path d="M8 3v3M3 8h3M16 21v-3M21 16h-3" />
    </svg>
  );
}

function Ico({ n, className = "" }: { n: keyof typeof ICO; className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 fill-none stroke-current ${className}`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={ICO[n]} /></svg>;
}
type Person = { address: string; name: string | null };
type ContactLite = InboxViewProps["contacts"][number];

function PersonCard({ p, t, x, contact, main, busy, clientId, onMakeMain }: {
  p: InboxViewProps; t: InboxThread; x: Person; contact: ContactLite | null; main: boolean; busy: boolean; clientId: string | null; onMakeMain: () => void;
}) {
  const [show, setShow] = useState<"email" | "phone" | null>(null);
  const [form, setForm] = useState(false);
  const [booking, setBooking] = useState(false);
  const name = contact?.name || x.name || x.address;
  const company = contact?.company || (main ? p.clientName(clientId) : null);
  // A word on each button (Derek, 2026-10-09): icons alone meant hovering
  // to find out which one the lightning was.
  const ib = "flex h-9 items-center gap-1.5 rounded-lg px-2 text-muted hover:bg-background hover:text-foreground";
  // Open in GoHighLevel: the server finds which sub-account they live in. The
  // tab opens on the click (so no popup blocker), then goes there.
  const openGhl = async () => {
    if (!contact) return;
    const quick = p.ghlUrlFor(contact.id);
    if (quick) { window.open(quick, "_blank", "noopener,noreferrer"); return; }
    const tab = window.open("about:blank", "_blank");
    const res = await authedFetch(`/api/inbox/person?contactId=${encodeURIComponent(contact.id)}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (j?.ghlUrl && tab) { tab.opener = null; tab.location.href = j.ghlUrl; }
    else { tab?.close(); p.pushToast("Couldn't find them in GoHighLevel."); }
  };
  const val = show === "email" ? (contact?.email || x.address) : show === "phone" ? contact?.phone ?? null : null;
  // Their other addresses, under the main one (Derek, 2026-10-07).
  const otherEmails = show === "email" ? (contact?.additionalEmails ?? []).filter((e) => e !== (val ?? "").toLowerCase()) : [];
  // Re-read them from GoHighLevel, for a change made there.
  const [syncing, setSyncing] = useState(false);
  const resync = async () => {
    if (!contact) return;
    setSyncing(true);
    const res = await authedFetch(`/api/inbox/person?contactId=${encodeURIComponent(contact.id)}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    setSyncing(false);
    if (j?.contact) { p.onContactUpdated?.(j.contact); p.pushToast(`Updated ${j.contact.name} from GoHighLevel`); }
    else p.pushToast(j?.error ?? "Couldn't reach GoHighLevel. Try again in a moment.");
  };
  const mini = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-foreground hover:ring-1 hover:ring-[var(--border)]";
  return (
    <div className="rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: avatarColor(name) }}>{initials(name)}</span>
        <div className="min-w-0 flex-1">
          <button onClick={() => { setForm(!form); setShow(null); }} aria-expanded={form} title={contact ? "See and change this contact" : "Add as a contact"}
            className="block max-w-full truncate text-left text-[18px] font-bold leading-tight underline decoration-transparent underline-offset-[3px] transition hover:decoration-current">{name}</button>
          {company && company.toLowerCase() !== name.toLowerCase() && <div className="flex items-start gap-1.5 text-muted"><Ico n="building" className="mt-1 h-4 w-4 shrink-0" /><span className="line-clamp-2">{company}</span></div>}
        </div>
        {!contact ? <span className="shrink-0 rounded-full bg-highlight-soft px-2.5 py-0.5 font-semibold text-highlight">New</span>
          : main && <span title="Replies go to them" aria-label="Replies go to them" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Ico n="reply" className="h-4 w-4" /></span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-0.5">
        <button onClick={() => setShow(show === "email" ? null : "email")} title="Email" aria-label="Email" className={`${ib} ${show === "email" ? "bg-accent-soft text-accent" : ""}`}><Ico n="mail" /><span>Email</span></button>
        {contact && <button onClick={() => setShow(show === "phone" ? null : "phone")} title="Phone" aria-label="Phone" className={`${ib} ${show === "phone" ? "bg-accent-soft text-accent" : ""}`}><Ico n="phone" /><span>Phone</span></button>}
        {main && clientId && <AppLink href={clientHref(clientId)} onOpen={() => p.onOpenClient(clientId)} title="Open client" aria-label="Open client" className={ib}><Ico n="building" /><span>Client</span></AppLink>}
        {contact && <button onClick={openGhl} title="Open in GoHighLevel" aria-label="Open in GoHighLevel" className={ib}><Ico n="bolt" /><span>GoHighLevel</span></button>}
        {contact?.ghlContactId && <button onClick={() => setBooking(true)} title={`Book ${name.split(/\s+/)[0]} in GoHighLevel`} aria-label="Book a time" className={ib}><Ico n="calendar" /><span>Book</span></button>}
        {contact && !main && <button disabled={busy} onClick={onMakeMain} title={`Send replies to ${name}`} aria-label={`Send replies to ${name}`} className={ib}><Ico n="reply" /><span>Reply to</span></button>}
        {contact?.ghlContactId && <button disabled={syncing} onClick={resync} title="Refresh from GoHighLevel" aria-label="Refresh from GoHighLevel" className={`ml-auto grid h-9 w-9 place-items-center rounded-lg text-[18px] leading-none text-muted hover:bg-background hover:text-foreground disabled:opacity-50 ${syncing ? "animate-spin" : ""}`}>↻</button>}
      </div>
      {show && (
        // One line: the address or number, then small buttons (names on hover).
        <div className="mt-2 flex items-center gap-1 rounded-lg bg-background py-1 pl-3 pr-1">
          <span className="min-w-0 flex-1 truncate font-semibold" title={val ?? ""}>{val || "None on file"}</span>
          {val && <button onClick={() => copyText(val, p)} title="Copy" aria-label="Copy" className={mini}><Ico n="copy" /></button>}
          {val && show === "phone" && <a href={`tel:${val}`} title="Call" aria-label="Call" className={mini}><Ico n="phone" /></a>}
          {val && show === "phone" && contact && <button onClick={() => window.dispatchEvent(new CustomEvent("inbox-compose", { detail: { kind: "text", contactId: contact.id, name, to: val } }))} title={`Text ${name.split(/\s+/)[0]}`} aria-label="Text" className={mini}><Ico n="text" /></button>}
          {contact && <button onClick={() => { setForm(true); setShow(null); }} title={val ? "Change" : "Add one"} aria-label={val ? "Change" : "Add one"} className={mini}><Ico n="user" /></button>}
        </div>
      )}
      {otherEmails.map((e) => (
        <div key={e} className="mt-1 flex items-center gap-1 rounded-lg bg-background py-1 pl-3 pr-1" title="Another address of theirs">
          <span className="min-w-0 flex-1 truncate text-muted">{e}</span>
          <button onClick={() => copyText(e, p)} title="Copy" aria-label="Copy" className={mini}><Ico n="copy" /></button>
        </div>
      ))}
      {!contact && main && !form && <ConnectContact p={p} t={t} x={x} />}
      {form && (contact
        ? <ContactForm p={p} contact={contact} onClose={() => setForm(false)} />
        : <AddPersonForm p={p} t={t} x={x} onClose={() => setForm(false)} />)}
      {booking && contact?.ghlContactId && <BookAppointment target={{ kind: "book", ghlContactId: contact.ghlContactId, name }} meId={p.me.id} defaultCalendarId={p.prefs.defaultCalendarId ?? null} onSetDefault={(id) => p.setPrefs({ defaultCalendarId: id })} onClose={() => setBooking(false)} onDone={() => {}} pushToast={(m) => p.pushToast(m)} />}
    </div>
  );
}

/** Someone new on an email who is really a contact you have: Pamela sharing a
 *  file through Google Drive comes from Google's address (Derek, 2026-10-06).
 *  Connecting moves the conversation onto her and her client, so her tasks and
 *  lists show; Google's address is not added to her. */
function ConnectContact({ p, t, x }: { p: InboxViewProps; t: InboxThread; x: Person }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const bare = (x.name || t.peerName || "").replace(/\s*\(via [^)]*\)\s*$/i, "").trim().toLowerCase();
  const guess = bare ? p.contacts.find((c) => (c.name ?? "").trim().toLowerCase() === bare) ?? null : null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? p.contacts.filter((c) => words.every((w) => `${c.name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(w))).slice(0, 5) : [];
  const connect = async (c: ContactLite) => {
    setBusy(true);
    try { await p.inbox.addContact(t.key, { useContactId: c.id }); p.pushToast(`This conversation is now with ${c.name}`); }
    catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't connect them."); }
    finally { setBusy(false); }
  };
  const row = (c: ContactLite) => (
    <div key={c.id} className="flex items-center gap-2 rounded-lg bg-background py-1.5 pl-3 pr-1.5">
      <span className="min-w-0 flex-1"><b className="block truncate">{c.name}</b>{c.email && <span className="block truncate text-[14px] text-muted">{c.email}</span>}</span>
      <button disabled={busy} onClick={() => connect(c)} className="h-9 shrink-0 rounded-lg bg-accent px-3 font-semibold text-white disabled:opacity-50">Connect</button>
    </div>
  );
  return (
    <div className="mt-3 grid gap-1.5 border-t pt-3">
      <span className="font-semibold">{guess ? `Is this ${guess.name}?` : "Connect to a contact you have"}</span>
      {guess && row(guess)}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={guess ? "Someone else? Search contacts" : "Search contacts"} aria-label="Search contacts"
        className="h-10 rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
      {hits.filter((c) => c.id !== guess?.id).map(row)}
    </div>
  );
}

const fieldCls = "h-10 min-w-0 rounded-lg border bg-surface px-3 outline-none focus:border-accent";
type Details = { firstName: string; lastName: string; companyName: string; email: string; phone: string; website: string; extras: { key: string; id: string; label: string; value: string }[] };
const EXTRA_PLACEHOLDER: Record<string, string> = { title: "Job title", facebook: "Facebook page", instagram: "Instagram", linkedin: "LinkedIn" };

/** A contact as GoHighLevel holds it, changed in place and saved there. */
function ContactForm({ p, contact, onClose }: { p: InboxViewProps; contact: ContactLite; onClose: () => void }) {
  const [d, setD] = useState<Details | null>(null);
  const [ghlUrl, setGhlUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    authedFetch(`/api/inbox/person?contactId=${encodeURIComponent(contact.id)}`).then((r) => r.json()).then((j) => {
      if (!live) return;
      if (j.details) { setD(j.details); setGhlUrl(j.ghlUrl ?? null); if (j.contact) p.onContactUpdated?.(j.contact); } else setError(j.error ?? "Couldn't load this contact.");
    }, () => live && setError("Couldn't load this contact."));
    return () => { live = false; };
    // Once per contact; p is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id]);
  const set = (k: keyof Omit<Details, "extras">, v: string) => setD((x) => (x ? { ...x, [k]: v } : x));
  const save = async () => {
    if (!d) return;
    setSaving(true);
    const res = await authedFetch("/api/inbox/person", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: contact.id, details: { ...d, extras: Object.fromEntries(d.extras.map((e) => [e.key, e.value])) } }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) { setError(j.error ?? "Couldn't save it."); return; }
    if (j.contact) p.onContactUpdated?.(j.contact);
    p.pushToast("Saved here and in GoHighLevel");
    onClose();
  };
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <b>Contact</b>
        {ghlUrl && <a href={ghlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">Open in GoHighLevel <Ico n="ext" className="h-4 w-4" /></a>}
      </div>
      {error && <div className="rounded-lg bg-danger-soft px-3 py-2 font-semibold text-danger">{error}</div>}
      {!d && !error && <div className="text-muted">Loading from GoHighLevel…</div>}
      {d && <>
        <div className="grid grid-cols-2 gap-2">
          <input value={d.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name" aria-label="First name" className={fieldCls} />
          <input value={d.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Last name" aria-label="Last name" className={fieldCls} />
        </div>
        <input value={d.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Company" aria-label="Company" className={fieldCls} />
        <input value={d.email} onChange={(e) => set("email", e.target.value)} placeholder="Email" aria-label="Email" className={fieldCls} />
        {(contact.additionalEmails ?? []).length > 0 && (
          <div className="text-muted">Also: {(contact.additionalEmails ?? []).join(", ")}<span className="block">Add or remove those in GoHighLevel, then ↻.</span></div>
        )}
        <input value={d.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" aria-label="Phone" className={fieldCls} />
        <input value={d.website} onChange={(e) => set("website", e.target.value)} placeholder="Website" aria-label="Website" className={fieldCls} />
        {d.extras.map((x) => (
          <input key={x.key} value={x.value} onChange={(e) => setD((cur) => (cur ? { ...cur, extras: cur.extras.map((y) => (y.key === x.key ? { ...y, value: e.target.value } : y)) } : cur))}
            placeholder={EXTRA_PLACEHOLDER[x.key] ?? x.label} aria-label={x.label} className={fieldCls} />
        ))}
        <div className="flex flex-wrap gap-2">
          <button disabled={saving} onClick={save} className="h-10 rounded-lg bg-accent px-4 font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save to GoHighLevel"}</button>
          <button onClick={onClose} className="h-10 rounded-lg px-3 font-semibold text-muted hover:bg-surface">Cancel</button>
        </div>
      </>}
    </div>
  );
}

/** A new person: filled in from their email signature, checked for anyone
 *  GoHighLevel already has with that email or phone, then added to Agency or
 *  Directory and a client. */
function AddPersonForm({ p, t, x, onClose }: { p: InboxViewProps; t: InboxThread; x: Person; onClose: () => void }) {
  const theirs = t.messages.find((m) => m.direction === "inbound" && (m.peerAddress ?? "").toLowerCase() === x.address);
  const guess = useMemo(() => guessFromSignature(theirs?.body ?? "", { name: x.name, email: x.address }), [theirs?.body, x.name, x.address]);
  const [d, setD] = useState({ firstName: guess.firstName, lastName: guess.lastName, companyName: guess.companyName, phone: guess.phone, website: guess.website, title: guess.title });
  const filled = !!(guess.title || guess.phone || guess.companyName);
  const [sub, setSub] = useState<"agency" | "directory">("agency");
  const [q, setQ] = useState(() => (guess.companyName || "").replace(/,?\s*(LLC|Inc\.?|Ltd\.?|Corp\.?)$/i, ""));
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<{ id: string; name: string; email: string | null; phone: string | null; where: string | null; sameEmail: boolean }[]>([]);
  // Anyone GoHighLevel already has with this email or phone.
  const checkDupes = useCallback(async (phone: string) => {
    const res = await authedFetch(`/api/inbox/person?email=${encodeURIComponent(x.address)}&phone=${encodeURIComponent(phone)}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    setDupes(j?.matches ?? []);
  }, [x.address]);
  useEffect(() => {
    let live = true;
    authedFetch(`/api/inbox/person?email=${encodeURIComponent(x.address)}&phone=${encodeURIComponent(guess.phone)}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setDupes(j?.matches ?? []); }, () => null);
    return () => { live = false; };
  }, [x.address, guess.phone]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? p.clients.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 5) : [];
  const who = `${d.firstName} ${d.lastName}`.trim() || x.address;
  // The client it goes on: picked by hand, else the one whose name matches.
  const [pick, setPick] = useState<{ clientId?: string; newClientName?: string; label: string } | null>(null);
  const exact = hits.find((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  const newName = q.trim() || d.companyName || "";
  const chosen = pick ?? (exact ? { clientId: exact.id, label: exact.name } : null);
  const add = async (to: { clientId?: string; newClientName?: string; useContactId?: string }, label: string) => {
    setBusy(true);
    try {
      await p.inbox.addContact(t.key, {
        address: x.address, name: who, sub, ...to,
        details: { firstName: d.firstName, lastName: d.lastName, companyName: d.companyName, phone: d.phone, website: d.website, extras: { title: d.title } },
      });
      p.pushToast(to.useContactId ? `Using ${label}` : `Added ${who} to ${sub === "agency" ? "Agency" : "Directory"} and ${label}`);
      onClose();
    } catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't add them."); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof d, v: string) => setD((cur) => ({ ...cur, [k]: v }));
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-background p-3">
      <b>Add as a contact</b>
      {filled && <div className="flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-1.5 font-semibold text-success"><Ico n="check" className="h-4 w-4" />Filled in from their email signature</div>}
      {dupes.length > 0 && (
        <div className="grid gap-1.5 rounded-lg bg-highlight-soft px-3 py-2 text-highlight">
          <b>Already in GoHighLevel?</b>
          {dupes.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0"><b className="block truncate">{m.name}</b><span className="block truncate text-[15px]">{m.sameEmail ? "Same email" : "Same phone"}{m.where ? ` · ${m.where}` : ""}</span></span>
              <button disabled={busy} onClick={() => add({ useContactId: m.id }, m.name)} className="h-9 shrink-0 rounded-lg bg-surface px-3 font-semibold text-foreground ring-1 ring-[var(--border)]">Use this one</button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input value={d.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name" aria-label="First name" className={fieldCls} />
        <input value={d.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Last name" aria-label="Last name" className={fieldCls} />
      </div>
      <input value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Job title" aria-label="Job title" className={fieldCls} />
      <input value={d.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Company" aria-label="Company" className={fieldCls} />
      <input value={x.address} readOnly aria-label="Email" className={`${fieldCls} text-muted`} />
      <input value={d.phone} onChange={(e) => set("phone", e.target.value)} onBlur={() => checkDupes(d.phone)} placeholder="Phone" aria-label="Phone" className={fieldCls} />
      <input value={d.website} onChange={(e) => set("website", e.target.value)} placeholder="Website" aria-label="Website" className={fieldCls} />
      <span className="mt-1 text-muted">Into GoHighLevel</span>
      <span className="inline-flex gap-1 rounded-lg bg-surface p-1 ring-1 ring-[var(--border)]">
        {(["agency", "directory"] as const).map((k) => (
          <button key={k} onClick={() => setSub(k)} title={k === "agency" ? "Anyone buying from us: website, marketing, a prospect" : "A business listed in the directory"}
            className={`flex-1 rounded-md px-3 py-1.5 font-semibold ${sub === k ? "bg-accent-soft text-accent" : "text-muted"}`}>{k === "agency" ? "Agency" : "Directory"}</button>
        ))}
      </span>
      <span className="mt-1 text-muted">Client</span>
      <input value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder="Search your clients" aria-label="Search your clients" className={fieldCls} />
      {/* Pick one, then Add: nothing is added until the button. */}
      <div className="grid gap-1" role="radiogroup" aria-label="Client">
        {hits.map((c) => {
          const on = chosen?.clientId === c.id;
          return (
            <button key={c.id} role="radio" aria-checked={on} onClick={() => setPick({ clientId: c.id, label: c.name })}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left ring-1 ${on ? "bg-accent-soft font-semibold text-accent ring-accent" : "bg-surface ring-[var(--border)] hover:bg-accent-soft"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-accent bg-accent text-white" : "border-[var(--border)]"}`}>{on && <Ico n="check" className="h-3 w-3" />}</span>
              <span className="truncate">{c.name}</span>
            </button>
          );
        })}
        {p.canAdmin && newName && !exact && (
          <button role="radio" aria-checked={!!chosen?.newClientName} onClick={() => setPick({ newClientName: newName, label: newName })}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left ring-1 ${chosen?.newClientName ? "bg-accent-soft font-semibold text-accent ring-accent" : "bg-surface ring-[var(--border)] hover:bg-accent-soft"}`}>
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-[var(--border)]">＋</span>
            <span className="min-w-0 truncate">New client: {newName}</span>
          </button>
        )}
      </div>
      <button disabled={busy || !chosen} onClick={() => chosen && add(chosen.clientId ? { clientId: chosen.clientId } : { newClientName: chosen.newClientName }, chosen.label)}
        className="mt-1 h-11 rounded-lg bg-accent font-bold text-white disabled:opacity-50">{busy ? "Adding…" : `Add to GoHighLevel (${sub === "agency" ? "Agency" : "Directory"})`}</button>
      <button onClick={onClose} className="justify-self-center px-2 text-muted hover:underline">Cancel</button>
    </div>
  );
}

// Someone who wrote in but is not a contact yet: put them on a client you
// have, or make a new one (admins). Their messages move onto it, and what they
// send next lands there by itself.
function AddToClient({ p, t, person, onDone }: { p: InboxViewProps; t: InboxThread; person?: { address: string; name: string | null }; onDone?: () => void }) {
  const [open, setOpen] = useState(!!person);
  // Which GoHighLevel sub-account a new email person goes into: Agency for
  // anyone buying from us, Directory only for a listed business (Derek, 2026-10-02).
  const [sub, setSub] = useState<"agency" | "directory">("agency");
  const isEmail = t.channel === "email";
  const who = person?.name || person?.address || t.peerName;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? p.clients.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 6) : [];
  const add = async (to: { clientId?: string; newClientName?: string }, label: string) => {
    setBusy(true);
    try { await p.inbox.addContact(t.key, { ...to, ...(person ? { address: person.address, name: person.name ?? undefined } : {}), ...(isEmail ? { sub } : {}) }); p.pushToast(`Added ${who} to ${label}`); setOpen(false); onDone?.(); }
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
      {person && <div className="font-semibold">Add {who}</div>}
      {isEmail && (
        <div className="grid gap-1">
          <span className="text-muted">Into GoHighLevel</span>
          <span className="inline-flex gap-1 rounded-lg bg-background p-1">
            {(["agency", "directory"] as const).map((k) => (
              <button key={k} onClick={() => setSub(k)} title={k === "agency" ? "Anyone buying from us: website, marketing, a prospect" : "A business listed in the directory"}
                className={`flex-1 rounded-md px-3 py-1.5 font-semibold ${sub === k ? "bg-surface ring-1 ring-[var(--border)]" : "text-muted"}`}>{k === "agency" ? "Agency" : "Directory"}</button>
            ))}
          </span>
        </div>
      )}
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your clients" className="h-10 rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
      {hits.map((c) => <button key={c.id} disabled={busy} onClick={() => add({ clientId: c.id }, c.name)} className="rounded-lg bg-background px-3 py-2 text-left hover:bg-accent-soft">🏢 {c.name}</button>)}
      {p.canAdmin && <button disabled={busy} onClick={() => add({ newClientName: q.trim() || who }, q.trim() || who)} className="h-10 rounded-lg border font-semibold hover:bg-background">＋ New client “{q.trim() || who}”</button>}
      <button onClick={() => { setOpen(false); onDone?.(); }} className="text-muted hover:underline">Cancel</button>
    </div>
  );
}

// New message to the team: who, then the task it's about (or none). With a
// task it goes in that task's chat, naming the person so they hear about it;
// without one it's a direct message, or the group when it's everyone.
function TeamNew({ p, onClose }: { p: InboxViewProps; onClose: () => void }) {
  const others = p.team.filter((m) => m.id !== p.me.id);
  const [to, setTo] = useState<string>(others[0]?.id ?? "all");
  const [q, setQ] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  // The task is optional, so its search stays folded until asked for
  // (Derek, 2026-10-05: "I'm not sure what to do on this page").
  const [aboutOpen, setAboutOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const open = p.tasks.filter((t) => t.status !== "done" && !t.private);
  const hits = (words.length ? open.filter((t) => words.every((w) => `${t.title} ${p.clientName(t.clientId) ?? ""}`.toLowerCase().includes(w))) : open.filter((t) => t.assigneeId === to || t.assigneeId === p.me.id)).slice(0, 3);
  const picked = taskId ? p.tasks.find((t) => t.id === taskId) ?? null : null;
  const name = (id: string) => p.team.find((m) => m.id === id)?.name ?? "";
  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      if (picked) await p.onSendTeam(`team:task:${picked.id}`, to === "all" ? text : `@${name(to)} ${text}`);
      else await p.onSendTeam(to === "all" ? "team:group" : `team:dm:${to}`, text);
      p.pushToast(picked ? `Sent, on "${picked.title}"` : "Sent");
      onClose();
    } catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't send it."); }
    finally { setBusy(false); }
  };
  const chip = (on: boolean) => `inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 font-semibold ring-1 ${on ? "bg-accent-soft text-accent ring-accent" : "ring-[var(--border)] hover:bg-background"}`;
  const first = (id: string) => name(id).split(/\s+/)[0];
  // Where it goes, said plainly before you send.
  const where = picked
    ? (to === "all" ? `Posts in the chat on "${picked.title}". Everyone on the task sees it there.` : `Posts in the chat on "${picked.title}" and tags ${first(to)}, so it lands in their Inbox. It stays with the task.`)
    : to === "all" ? "Goes to the team group chat. Everyone sees it in their Inbox, under Team." : `A private message to ${first(to)}. Only the two of you see it, in your Inboxes under Team.`;
  return (
    <div className="grid max-w-2xl gap-4 rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
      <div className="grid gap-2">
        <span className="font-semibold">Who is it for?</span>
        <div className="flex flex-wrap gap-2">
          {others.map((m) => (
            <button key={m.id} onClick={() => setTo(m.id)} className={chip(to === m.id)}>
              <span className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: avatarColor(m.name) }}>{initials(m.name)}</span>{m.name}
            </button>
          ))}
          <button onClick={() => setTo("all")} className={chip(to === "all")}><span className="grid h-7 w-7 place-items-center rounded-full bg-background">🤝</span>Everyone</button>
        </div>
      </div>
      <textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={to === "all" ? "Write to everyone" : `Write to ${first(to)}`}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
        className="rounded-lg border bg-surface px-3 py-2 leading-relaxed outline-none focus:border-accent" />
      {picked ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-success-soft px-3 py-2 font-semibold text-success">
          <span className="min-w-0 truncate">📌 About: {picked.title}</span>
          <button onClick={() => setTaskId(null)} title="Not about a task" aria-label="Not about a task" className="shrink-0 text-muted">✕</button>
        </div>
      ) : !aboutOpen ? (
        <button onClick={() => setAboutOpen(true)} className="justify-self-start font-semibold text-accent hover:underline">📌 Is it about a task? Pick one (optional)</button>
      ) : (
        <div className="grid gap-1.5 rounded-lg bg-background p-2.5">
          <div className="flex items-center gap-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks or clients" aria-label="Search tasks" className="h-10 min-w-0 flex-1 rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
            <button onClick={() => { setAboutOpen(false); setQ(""); }} className="shrink-0 px-2 font-semibold text-muted hover:text-foreground">Not about a task</button>
          </div>
          {!words.length && hits.length > 0 && <span className="px-1 text-[15px] text-muted">{to === "all" ? "Your open tasks" : `Open tasks for ${first(to)} or you`}</span>}
          {hits.map((t) => (
            <button key={t.id} onClick={() => { setTaskId(t.id); setQ(""); setAboutOpen(false); }} className="rounded-lg bg-surface px-3 py-2 text-left ring-1 ring-[var(--border)] hover:bg-accent-soft">
              <b className="block truncate">{t.title}</b><span className="text-[15px] text-muted">{p.clientName(t.clientId)}</span>
            </button>
          ))}
          {words.length > 0 && !hits.length && <span className="px-1 text-muted">No open task matches.</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <span className="min-w-0 flex-1 text-muted">{picked ? "💬" : to === "all" ? "🤝" : "🔒"} {where}</span>
        <button disabled={busy || !body.trim()} onClick={send} className="h-10 shrink-0 rounded-lg bg-accent px-5 font-bold text-white disabled:opacity-50">{busy ? "Sending…" : picked ? "Post on task" : to === "all" ? "Send to everyone" : `Send to ${first(to)}`}</button>
      </div>
    </div>
  );
}

// ── A new message: an email or a text to anyone in GoHighLevel ────────────
// Search every contact by name, email, company or phone, or type any email
// address (Derek, 2026-10-01). Fills the page; CC, BCC, files, and the task
// it belongs to, so the conversation lands there from the first message.
type Pick = { contactId?: string; name: string; address: string };
/** How New message opens: blank, an email to someone, or a text to a contact. */
type NewStart = { to?: string; body?: string; kind?: "email" | "text" | "team"; contactId?: string; name?: string; subject?: string; queuedId?: string };
function NewMessage({ p, start, onClose }: { p: InboxViewProps; start: NewStart; onClose: () => void }) {
  const [kind, setKind] = useState<"email" | "text" | "team">(start.kind ?? "email");
  const [to, setTo] = useState<Pick | null>(start.to ? { contactId: start.contactId, name: start.name || start.to, address: start.to } : null);
  const [q, setQ] = useState("");
  const [ccOpen, setCcOpen] = useState(false);
  const [cc, setCc] = useState(""); const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(start.subject ?? "");
  // An email is written with formatting, like a reply (Derek, 2026-10-05); a
  // text stays plain. A Claude draft may already be formatted.
  const [body, setBody] = useState(() => ((start.kind ?? "email") === "email" && start.body ? (looksLikeHtml(start.body) ? start.body : plainTextToHtml(start.body)) : start.body ?? ""));
  const [nonce, setNonce] = useState(0);
  const put = (v: string) => { setBody(v); setNonce((n) => n + 1); };
  const newEditor = useRef<Editor | null>(null);
  const insertBooking = (l: BookingLink) => {
    const ed = newEditor.current;
    if (ed && !ed.isDestroyed) ed.chain().focus().insertContent([{ type: "text", text: "book a time here", marks: [{ type: "link", attrs: { href: l.url } }] }, { type: "text", text: " " }]).run();
    else put(`${body}<p><a href="${l.url}">book a time here</a></p>`);
  };
  const plain = kind === "email" ? htmlToText(body) : body;
  const hasText = !!plain.trim();
  const [signature, setSignature] = useState("");
  useEffect(() => { loadSignature().then(setSignature); }, []);
  const hasBcc = true;
  // Unchecked for a typed address: it may be nobody GoHighLevel should hold.
  const [ghlLog, setGhlLog] = useState(true);
  const logIt = hasBcc && ghlLog && !!to?.contactId;
  const switchKind = (k: "email" | "text" | "team") => {
    if (k === kind) return;
    if (k === "email" && kind === "text") put(body.trim() ? plainTextToHtml(body) : "");
    if (k === "text" && kind === "email") put(htmlToText(body));
    setKind(k); setTo(null);
  };
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
  // Their open tasks, most recently touched first, ready to click (Derek,
  // 2026-10-06: "always list their most recent"): by the contact, or the
  // client made from them.
  const toContact = to?.contactId ? p.contacts.find((c) => c.id === to.contactId) ?? null : (to ? p.contacts.find((c) => (c.email ?? "").toLowerCase() === to.address.toLowerCase() || (c.additionalEmails ?? []).includes(to.address.toLowerCase())) ?? null : null);
  const toClient = toContact?.ghlContactId ? `cl_ct_ghl_${toContact.ghlContactId}` : null;
  const theirTasks = toContact ? p.tasks
    .filter((t) => t.status !== "done" && !t.private && (t.contactId === toContact.id || (!!toClient && t.clientId === toClient)))
    .sort((a, b) => (b.lastActivityAt ?? b.createdAt ?? "").localeCompare(a.lastActivityAt ?? a.createdAt ?? ""))
    .slice(0, 5) : [];

  const upload = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) { const a = await p.onUpload(`inbox/${p.me.id}`, f); if (a) setFiles((x) => [...x, a]); }
  };
  const send = async () => {
    if (!to || !hasText) return;
    setBusy("send");
    try {
      const r = kind === "email"
        ? await p.inbox.send({ to: to.address, cc: cc.split(/[,\s]+/).filter(Boolean), bcc: bcc.split(/[,\s]+/).filter(Boolean), subject, body, attachments: files.filter((f) => f.path).map((f) => ({ path: f.path!, name: f.name })), ghlLog: logIt })
        : await p.inbox.send({ channel: "sms", contactId: to.contactId, body: body.trim() });
      if (task && r.threadKey) await p.inbox.linkTask(r.threadKey, task.id).catch(() => null);
      p.pushToast(task ? `Sent, and linked to ${task.title}` : "Sent");
      // A Claude draft leaves Drafts once it has gone.
      if (start.queuedId) p.setPrefs({ queuedDrafts: (p.prefs.queuedDrafts ?? []).filter((d) => d.id !== start.queuedId) });
      onClose();
    } catch (e) { p.pushToast(e instanceof Error ? e.message : "Couldn't send it."); }
    finally { setBusy(null); }
  };
  const row = "flex items-center gap-3 border-b py-1.5";
  // Room inside each box, and a soft fill instead of the heavy focus frame.
  const field = "h-10 min-w-0 flex-1 rounded-md bg-transparent px-2.5 outline-none! hover:bg-background focus:bg-background";
  const ai = async (mode: "fix" | "shorter") => {
    setBusy("ai");
    const r = await p.inbox.improve(kind === "email" ? body : plain, kind === "email" ? "email" : "sms", mode).catch(() => null);
    setBusy(null);
    if (r?.changed) put(kind === "email" ? (looksLikeHtml(r.text) ? r.text : plainTextToHtml(r.text)) : r.text);
    p.pushToast(!r ? "Couldn't do that." : !r.changed ? (mode === "shorter" ? "It's already short." : "Looks good already.") : mode === "shorter" ? "Made it shorter" : "Fixed spelling and grammar");
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-5 lg:px-7">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={onClose} className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">← Back</button>
        <h1 className="text-[26px] font-extrabold">New message</h1>
        <span className="inline-flex gap-1 rounded-lg bg-background p-1">
          <button onClick={() => switchKind("email")} className={`rounded-md px-3 py-1.5 font-semibold ${kind === "email" ? "bg-surface ring-1 ring-[var(--border)]" : ""}`}>✉️ Email</button>
          <button onClick={() => switchKind("text")} className={`rounded-md px-3 py-1.5 font-semibold ${kind === "text" ? "bg-surface ring-1 ring-[var(--border)]" : ""}`}>💬 Text</button>
          <button onClick={() => switchKind("team")} className={`rounded-md px-3 py-1.5 font-semibold ${kind === "team" ? "bg-surface ring-1 ring-[var(--border)]" : ""}`}>🤝 Team</button>
        </span>
      </div>
      {kind === "team" ? <TeamNew p={p} onClose={onClose} /> : <>
      {/* Side by side only when the conversation area has the room, not the window. */}
      <div className="@container">
      <div className="grid grid-cols-1 items-start gap-4 @min-[880px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
          <div className={row}><span className="w-16 shrink-0 text-muted">From</span><span className="min-w-0 flex-1 truncate px-2.5">{kind === "email" ? (p.me.email ?? "Your Gmail") : "Their sub-account's GoHighLevel number"}</span></div>
          <div className={`relative ${row}`}>
            <span className="w-16 shrink-0 text-muted">To</span>
            {to ? (
              <span className="flex min-w-0 flex-1 items-center gap-2 px-1"><span className="truncate rounded-full bg-accent-soft px-3 py-1 font-semibold text-accent">{to.name}{to.name !== to.address ? ` · ${to.address}` : ""}</span><button onClick={() => setTo(null)} aria-label="Remove" className="text-muted">✕</button></span>
            ) : (
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "email" ? "Search contacts, or type an email" : "Search contacts by name or phone"}
                onKeyDown={(e) => { if (e.key === "Enter" && typedEmail) { setTo({ name: typedEmail, address: typedEmail }); setQ(""); } }}
                className={field} />
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
            <label className={row}><span className="w-16 shrink-0 text-muted">CC</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Add people, separated by commas" className={field} /></label>
            <label className={row}><span className="w-16 shrink-0 text-muted">BCC</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Add people, separated by commas" className={field} /></label>
          </>}
          {kind === "email" && <label className={row}><span className="w-16 shrink-0 text-muted">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What it's about" className={field} /></label>}
          {kind === "email" ? (
            <div className="flex-1 pt-2 [&_.rte-content]:min-h-48 [&_.ProseMirror]:px-2.5 [&_.ProseMirror]:outline-none! [&_.rte-toolbar]:border-0"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
              onDropCapture={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); upload(e.dataTransfer.files); } }}>
              <RichTextEditor key={`new-${nonce}`} variant="email" value={body} onChange={setBody} placeholder="Write your email" onEditor={(e) => { newEditor.current = e; }} />
              <div className="mt-1 border-t border-dashed px-2.5 pt-2 text-muted">
                {signature.trim()
                  ? <div className="opacity-70 [&_a]:underline" title="Your signature, added when it sends. Change it in Settings." dangerouslySetInnerHTML={{ __html: looksLikeHtml(signature) ? signature : plainTextToHtml(signature) }} />
                  : <span>No signature yet. Add one in Settings and it goes on every email.</span>}
              </div>
            </div>
          ) : (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a text"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
              className="min-h-48 w-full flex-1 resize-none rounded-md bg-transparent px-2.5 py-3 leading-relaxed outline-none!" />
          )}
          {files.length > 0 && <div className="flex flex-wrap gap-2 pb-2">{files.map((f) => <span key={f.id} className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 ring-1 ring-[var(--border)]">{f.kind === "image" ? "🖼️" : "📄"} {f.name}<button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remove ${f.name}`} className="text-muted">✕</button></span>)}</div>}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {kind === "email" && <>
              <button onClick={() => fileRef.current?.click()} title="Attach files (or drag them onto the email)" className="h-10 rounded-lg border px-3 font-semibold hover:bg-background">📎 Attach</button>
              <BookingLinkMenu me={p.me.id} hidden={p.prefs.hiddenBookingLinks} starred={[...(p.prefs.starredBookingLinks ?? []), ...(p.prefs.defaultCalendarId ? [p.prefs.defaultCalendarId] : [])]} onPick={insertBooking} />
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </>}
            <button disabled={busy !== null || !hasText} onClick={() => ai("fix")} title="Fix spelling and grammar" className="h-10 rounded-lg bg-[#f3efff] px-3 font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50">{busy === "ai" ? "✨ Working…" : "✨ Improve"}</button>
            <button disabled={busy !== null || !hasText} onClick={() => ai("shorter")} title="Make it shorter" className="h-10 rounded-lg bg-[#f3efff] px-3 font-semibold text-[#7c3aed] ring-1 ring-[#7c3aed] disabled:opacity-50">✂️ Shorter</button>
            {kind === "email" && hasBcc && (
              <label title={to && !to.contactId ? "Only for someone who is a contact" : "A hidden copy goes to your GoHighLevel Auto BCC Sync address, so it's logged on the contact"} className={`flex h-10 items-center gap-2 px-1 font-semibold text-muted ${to && !to.contactId ? "opacity-50" : "cursor-pointer"}`}>
                <input type="checkbox" disabled={!!to && !to.contactId} checked={logIt || (!to && ghlLog)} onChange={(e) => setGhlLog(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />Log in GoHighLevel
              </label>
            )}
            <span className="flex-1" />
            {/* Throw it away from here, not only from the Drafts list (Derek, 2026-10-06:
                "how do I cancel this draft?"). A Claude draft leaves Drafts; Undo puts it back. */}
            <button onClick={() => {
              const was = p.prefs.queuedDrafts ?? [];
              if (start.queuedId) {
                p.setPrefs({ queuedDrafts: was.filter((d) => d.id !== start.queuedId) });
                p.pushToast("Draft deleted", { label: "Undo", run: () => p.setPrefs({ queuedDrafts: was }) });
              }
              onClose();
            }} title={start.queuedId ? "Delete this draft" : "Throw this message away"} className="h-10 rounded-lg px-3 font-semibold text-muted hover:bg-background hover:text-danger">🗑 {start.queuedId ? "Delete draft" : "Discard"}</button>
            {kind === "text" && <span className="tabular-nums text-muted">{body.length} / 160</span>}
            <button disabled={busy !== null || !to || !hasText} onClick={send} title={`Send (${shortcut("Enter")})`} className="h-10 rounded-lg bg-accent px-6 font-bold text-white disabled:opacity-50">{busy === "send" ? "Sending…" : "Send"}</button>
          </div>
        </div>
        <aside className="min-w-0 space-y-3">
          <div className="rounded-xl bg-surface p-4 ring-1 ring-[var(--border)]">
            <div className="mb-2 text-[14px] font-bold tracking-wide text-muted">LINK TO A TASK</div>
            {task ? (
              <div className="flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2.5"><span className="min-w-0 flex-1"><b className="block">{task.title}</b><span className="text-[14px] text-muted">{p.clientName(task.clientId)}</span></span><button onClick={() => setTask(null)} aria-label="Remove" className="text-muted">✕</button></div>
            ) : <>
              <p className="mb-2 text-muted">Optional. Their replies land on the task too.</p>
              <input value={taskQ} onChange={(e) => setTaskQ(e.target.value)} placeholder={theirTasks.length ? "Or search any task" : "Search tasks"} className="h-10 w-full rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
              <div className="mt-1.5 space-y-1">{(taskQ.trim() ? taskHits : theirTasks).map((t) => <button key={t.id} onClick={() => { setTask(t); setTaskQ(""); }} className="block w-full rounded-lg bg-background px-3 py-2 text-left hover:bg-accent-soft">{t.title}<span className="block text-[14px] text-muted">{taskQ.trim() ? p.clientName(t.clientId) : `${STATUS_META[t.status].label}${t.due ? ` · due ${new Date(`${t.due}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}`}</span></button>)}</div>
              {!taskQ.trim() && to && !theirTasks.length && <p className="mt-1.5 text-[14px] text-muted">No open tasks for them. Search any task above.</p>}
            </>}
          </div>
        </aside>
      </div>
      </div>
      </>}
    </div>
  );
}

// ── Always let in (Derek, 2026-10-02: "emails I want to hit my inbox that are
// not"). The Gmail sync reads only the Primary tab and leaves out mail that
// looks automated; these senders come in anyway. Kept with Inbox settings, and
// adding one checks the last two weeks of Gmail for them.
async function letIn(p: InboxViewProps, raw: string) {
  const entry = allowEntry(raw);
  if (!entry) { p.pushToast("That isn't an email address or a domain."); return; }
  const list = p.prefs.allowSenders ?? [];
  if (!list.includes(entry)) p.setPrefs({ allowSenders: [...list, entry] });
  const who = entry.startsWith("@") ? `everyone at ${entry.slice(1)}` : entry;
  p.pushToast(`${who[0].toUpperCase()}${who.slice(1)} now goes to your Inbox. Checking the last 2 weeks of your Gmail…`);
  // The setting saves a moment after it changes; the check reads it from there.
  await new Promise((r) => setTimeout(r, 1500));
  const res = await authedFetch("/api/google/poll-replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 14, member: p.me.id }) }).catch(() => null);
  const j = res?.ok ? await res.json().catch(() => null) : null;
  p.inbox.reload();
  const found = (j?.strangers ?? 0) + (j?.ingested ?? 0);
  p.pushToast(j ? (found ? `Found ${found} new ${found === 1 ? "email" : "emails"} from them.` : "Done. Nothing new from them in the last 2 weeks; what they send next comes in.") : "Saved. What they send next comes in.");
}

function AllowBox({ p }: { p: InboxViewProps }) {
  const [v, setV] = useState("");
  const list = p.prefs.allowSenders ?? [];
  const add = () => { const e = allowEntry(v); if (!e) { p.pushToast("Type an email address, or a domain like acme.com."); return; } setV(""); letIn(p, e); };
  return (
    <Box title="Always to Inbox" help="Everything in your Gmail comes in. Mail Gmail files outside Primary, or that looks automated, goes to Updates; these senders always go to your Inbox instead.">
      <div className="flex gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="jane@acme.com, or acme.com for everyone there"
          className="h-10 min-w-0 flex-1 rounded-lg border bg-surface px-3 outline-none focus:border-accent" />
        <button onClick={add} disabled={!v.trim()} className="h-10 shrink-0 rounded-lg border px-3 font-semibold hover:bg-background disabled:opacity-50">＋ Add</button>
      </div>
      {list.length ? list.map((a) => (
        <div key={a} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
          <span className="break-all">{a.startsWith("@") ? `Everyone at ${a.slice(1)}` : a}</span>
          <button onClick={() => p.setPrefs({ allowSenders: list.filter((x) => x !== a) })} className="h-9 shrink-0 rounded-md border px-3 font-semibold hover:bg-surface">Remove</button>
        </div>
      )) : <div className="text-muted">Nobody yet. Or press 📥 To Inbox on an email in Updates.</div>}
    </Box>
  );
}

// Each person's GoHighLevel Auto BCC Sync addresses (Derek, 2026-10-05: emails
// sent from here weren't reaching GoHighLevel). Saved on blur.
function GhlBccBox({ prefs, setPrefs }: { prefs: InboxPrefs; setPrefs: (patch: Partial<InboxPrefs>) => void }) {
  const saved = prefs.ghlBcc ?? {};
  const [agency, setAgency] = useState(saved.agency ?? "");
  const [directory, setDirectory] = useState(saved.directory ?? "");
  const ok = (v: string) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const save = () => { if (ok(agency) && ok(directory)) setPrefs({ ghlBcc: { agency: agency.trim(), directory: directory.trim() } }); };
  const input = "h-10 min-w-0 flex-1 rounded-lg border bg-surface px-3 outline-none focus:border-accent";
  return (
    <Box title="Log emails in GoHighLevel" help="Emails you send from here go out through your Gmail, and GoHighLevel doesn't see them. Paste the Auto BCC Sync address from each sub-account and every email sent from here gets a hidden copy there, so it's logged on the contact. It is the sub-account's address, so one person saving it covers the whole team. Left empty, the usual ones are used: 7B0Y8xCOblcTHzYnM1Kc@email.usercontent.site for Agency, GN4HK1ybbTBWcolEjLHl@email.usercontent.site for Directory.">
      <label className="grid gap-1"><b className="font-semibold">Agency sub-account</b><input value={agency} onChange={(e) => setAgency(e.target.value)} onBlur={save} placeholder="Paste the address" className={input} /></label>
      <label className="grid gap-1"><b className="font-semibold">Directory sub-account</b><input value={directory} onChange={(e) => setDirectory(e.target.value)} onBlur={save} placeholder="Paste the address" className={input} /></label>
      {(!ok(agency) || !ok(directory)) && <span className="font-semibold text-danger">That isn&apos;t an email address.</span>}
      <span className="text-muted">A listed business is logged in Directory, everyone else in Agency. Uncheck &ldquo;Log in GoHighLevel&rdquo; on an email to skip it.</span>
    </Box>
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
        <Box title="What shows in my Inbox" help="Turn off what you don't need here. It stays out of your Inbox, its count and its pop ups, and you can still read it on the task. Team and client chats always show.">
          {([["email", "Email"], ["sms", "Texts"], ["social", "Social (Facebook, Instagram, website chat, Google)"], ["call", "Calls"]] as const).map(([k, label]) => (
            <Switch key={k} on={!(prefs.hideKinds ?? []).includes(k)} set={(v) => setPrefs({ hideKinds: v ? (prefs.hideKinds ?? []).filter((x) => x !== k) : [...(prefs.hideKinds ?? []), k] })} label={label} />
          ))}
        </Box>
        <Box title="Gmail" help="Keeps your Gmail in step with this Inbox, so its unread count matches. Texts and GoHighLevel messages are never changed.">
          <Switch on={prefs.gmailRead} set={(v) => setPrefs({ gmailRead: v })} label="Mark read in Gmail too" help="Opening a message here marks it read there; Mark as unread puts it back" />
          <Switch on={prefs.gmailArchive} set={(v) => setPrefs({ gmailArchive: v })} label="Archive here archives in Gmail too" help="It leaves your Gmail inbox but is never deleted; Undo puts it back" />
        </Box>
        <GhlBccBox prefs={prefs} setPrefs={setPrefs} />
        <Box title="Blocked senders" help="Nothing from these shows in your Inbox. Block someone from the ⛔ Block button on their message.">
          {p.inbox.blocks.length ? p.inbox.blocks.map((b) => (
            <div key={b} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
              <span className="break-all">{b.startsWith("@") ? `Everyone at ${b.slice(1)}` : b}</span>
              <button onClick={() => p.inbox.unblock(b)} className="h-9 shrink-0 rounded-md border px-3 font-semibold hover:bg-surface">Unblock</button>
            </div>
          )) : <div className="text-muted">Nobody blocked.</div>}
        </Box>
        <AllowBox p={p} />
        <Box title="Sending">
          <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
            <span><b className="block font-semibold">Undo send</b><span className="text-muted">Time to take a message back after Send</span></span>
            <span className="inline-flex gap-1 rounded-lg bg-background p-1">
              {([0, 5, 10, 30] as const).map((n) => <button key={n} onClick={() => setPrefs({ undoSeconds: n })} className={`rounded-md px-3 py-1.5 font-semibold ${prefs.undoSeconds === n ? "bg-surface ring-1 ring-[var(--border)]" : ""}`}>{n ? `${n} s` : "Off"}</button>)}
            </span>
          </div>
        </Box>
        <Box title="Alerts">
          <Switch on={prefs.badge} set={(v) => setPrefs({ badge: v })} label="Unread count in the sidebar" />
          <Switch on={prefs.popup} set={(v) => { setPrefs({ popup: v }); if (v) askAlertPermission(); }} label="Pop up for new messages" help="A browser alert while ClickUpTasks is open in another tab" />
          <Switch on={prefs.sound} set={(v) => setPrefs({ sound: v })} label="Play a sound" />
        </Box>
        <Box title="Where messages come from" help="Your Gmail is read every 15 minutes, and GoHighLevel 7 minutes after. Tokens are in Settings, Integrations.">
          <div>✉️ <b>Gmail</b>: {p.me.email ? `${p.me.email}, every tab (Primary to Inbox, the rest to Updates)` : "your Google Workspace mailbox, every tab"}</div>
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
