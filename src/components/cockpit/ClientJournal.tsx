"use client";

// The "Journal" tab on a client or project — one reverse-chronological feed
// merging team notes (meeting notes, decisions, FYIs — anything worth
// keeping, images pasted right in), completed work, task comments, and
// (client-level only, when a GHL contact is linked) that contact's full
// email/SMS conversation — sent via GHL from right here, received via the
// inbound webhook — so there's no gap and no need to poll GHL for updates.
// Claude (via the MCP server's list_notes/add_note tools) reads and posts to
// the notes side of this too. The composer is one segmented control
// (Note/Email/SMS) instead of separate note and message composers, so
// writing here is a single "what kind of entry is this" decision rather
// than switching views first. The Filter menu's Photos/Links/Files plus a
// folder filter (see onSetNoteAttachmentFolder) are what a standalone Vault
// tab used to be — folded in here instead of keeping a whole second tab
// alive just to browse/file attachments.
import { useEffect, useRef, useState } from "react";
import {
  users, userById, timeAgo, dayLabel, STATUS_META, formatDue, isOverdue, isCompletionEvent, NOTE_TYPE_META, NOTE_TYPE_ORDER, MANUAL_NOTE_TYPES, noteTypeMeta, looksLikeHtml,
  type ClientNote, type NoteType, type Task, type Comment, type Message, type MessageChannel, type MessageDirection, type Me, type Attachment, type Contact, type ScheduledMessage, type VaultFolder,
  mentionCandidates, applyMention,
} from "@/lib/data";
import { safeMessageHtml } from "@/lib/safeHtml";
import { I, Avatar, CollapsibleText, newId, NotInGhlChip } from "./ui";
import { ConfirmModal, type ConfirmSpec } from "./modals";
import { AttachmentThumbs } from "./AttachmentThumbs";
import { SchedulePopover } from "./SchedulePopover";
import { shortcut } from "@/lib/platform";

// A2: the old ten equal pills (note kinds, Message, Task Activity, attachment
// types) mixed three different axes into one row. Split into a primary
// segment (what family of entry) and a secondary sub-filter (which kind
// within it, or which attachment type) — two independent controls instead
// of one flat list.
type JournalSegment = "all" | "conversation" | "decisions" | "activity";
type JournalSubFilter = "all" | NoteType | "photos" | "links" | "files";

type JournalItem =
  | { kind: "note"; at: string; note: ClientNote }
  | { kind: "message"; at: string; message: Message }
  | { kind: "activity"; at: string; comment: Comment & { taskId: string; taskTitle: string } }
  | { kind: "completion"; at: string; comment: Comment & { taskId: string; taskTitle: string } };

// Display-only row shape built from the filtered JournalItems — inserts day
// dividers and clusters adjacent same-channel/same-direction messages into
// one card (a fast SMS back-and-forth otherwise renders as a wall of
// identical bordered cards; grouping keeps the header chrome to once per
// burst). Filtering itself still happens on the underlying JournalItem[],
// this is purely a presentation transform on top of that.
type FeedRow =
  | { kind: "divider"; key: string; label: string }
  | { kind: "note"; at: string; note: ClientNote }
  | { kind: "activity"; at: string; comment: Comment & { taskId: string; taskTitle: string } }
  | { kind: "completion"; at: string; comment: Comment & { taskId: string; taskTitle: string } }
  | { kind: "message-group"; key: string; channel: MessageChannel; direction: MessageDirection; messages: Message[] };

function buildFeedRows(items: JournalItem[]): FeedRow[] {
  const rows: FeedRow[] = [];
  let lastDayKey = "";
  for (const item of items) {
    const dk = new Date(item.at).toDateString();
    if (dk !== lastDayKey) { rows.push({ kind: "divider", key: dk, label: dayLabel(item.at) }); lastDayKey = dk; }
    if (item.kind === "message") {
      const last = rows[rows.length - 1];
      if (last?.kind === "message-group" && last.channel === item.message.channel && last.direction === item.message.direction) {
        last.messages.push(item.message);
        continue;
      }
      rows.push({ kind: "message-group", key: item.message.id, channel: item.message.channel, direction: item.message.direction, messages: [item.message] });
      continue;
    }
    rows.push(item);
  }
  return rows;
}

export function ClientJournal({ onOpenClientTasks, onBook, ghlUrl, notes, tasks, messages, me, onAdd, onEdit, onDelete, onOpenTask, onOpenMessages, onSendMessage, onScheduleMessage, onComposeEmail, onComposeText, scheduled, onLoadScheduled, onCancelScheduled, toContact, sendingMessage, onUploadImage, onOpenFile, canAdmin, canMessage, onToggleCanMessage, onDraftMessage, draftingMessage, onRefreshContact, refreshingContact, onRefreshMessages, refreshingMessages, onWhatsNext, whatsNextBusy, composeIntent, folders, onCreateFolder, onDeleteFolder, onSetNoteAttachmentFolder, initialFolderFilter }: {
  /** Their name in the side panel opens the client's task list (Derek, 2026-10-07). */
  onOpenClientTasks?: () => void;
  /** Book a time with them (GoHighLevel calendar); absent when they have no GHL contact. */
  onBook?: () => void;
  /** Their contact page in GoHighLevel. */
  ghlUrl?: string | null;
  notes: ClientNote[];
  tasks: Task[]; // already scoped by the caller to the current client/project
  messages?: Message[] | null; // null/undefined = no linked GHL contact at this scope, so no Email/SMS
  me: Me;
  onAdd: (type: NoteType, body: string, attachments?: Attachment[]) => void;
  onEdit: (note: ClientNote, body: string) => void;
  onDelete: (note: ClientNote) => void;
  onOpenTask: (taskId: string) => void;
  onOpenMessages?: () => void; // fires once when a message is first visible, to mark them read
  onSendMessage?: (channel: MessageChannel, subject: string, body: string) => void;
  onScheduleMessage?: (channel: MessageChannel, subject: string, body: string, scheduledAt: string) => void;
  /** Opens the email window for this client (ClientEmail.tsx); a subject makes it a new email, as for a reply. */
  onComposeEmail?: (reply?: { subject?: string; replyTo?: string }) => void;
  scheduled?: ScheduledMessage[]; // this client's pending scheduled sends
  onLoadScheduled?: () => void; // refetch `scheduled` — call on mount/client change
  onCancelScheduled?: (id: string) => void;
  toContact?: Contact | null; // the recipient (client's linked GHL contact), shown as the To line
  sendingMessage?: boolean;
  onUploadImage: (file: File) => Promise<Attachment | null>;
  onOpenFile: (path: string) => void;
  canAdmin?: boolean;
  canMessage?: string[]; // roster ids granted permission to send email/SMS as this client
  onToggleCanMessage?: (memberId: string) => void; // admin-only — manages canMessage
  onDraftMessage?: (channel: MessageChannel, prompt?: string) => Promise<{ subject?: string; body: string } | null>; // Gemini draft, never sends
  draftingMessage?: boolean;
  onRefreshContact?: () => void; // admin-only — re-pulls name/email/phone/etc. from GHL
  refreshingContact?: boolean;
  onRefreshMessages?: () => void; // backfills any GHL messages the webhook missed
  refreshingMessages?: boolean;
  // On-demand AI recap ("recently done / next up") — never runs on its own,
  // matching the app's "AI never spends without a click" rule. Result lands
  // as an ai_summary note, which the pinned-recap card above the feed picks
  // up automatically.
  onWhatsNext?: () => void;
  whatsNextBusy?: boolean;
  // A header Email/SMS button sets this to jump the composer straight into that
  // mode. `nonce` bumps on every click so the effect re-fires even when the
  // Journal is already open (the component isn't remounted then).
  /** SMS opens the Text window over the page (Derek, 2026-10-05). */
  onComposeText?: () => void;
  composeIntent?: { mode: "email" | "sms"; nonce: number; body?: string } | null;
  // Vault→Journal merge: the Filter menu's Photos/Links/Files already covers
  // "browse by kind" — folders are the one Vault capability without an
  // equivalent here, so they're folded straight into the same menu instead
  // of keeping a whole separate tab alive just for filing. Only note
  // attachments support filing (Vault never covered message attachments
  // either — see Cockpit.tsx's old vaultItems comment).
  folders?: VaultFolder[];
  onCreateFolder?: (name: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onSetNoteAttachmentFolder?: (note: ClientNote, attachmentId: string, folderId: string | null) => void;
  // From a deep link's ?folder= param — read once as the initial folder
  // filter, not a live-controlled prop (this component owns it after that).
  initialFolderFilter?: string | null;
}) {
  const [segment, setSegment] = useState<JournalSegment>("all");
  const [subFilter, setSubFilter] = useState<JournalSubFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string | "unfiled" | "all">(initialFolderFilter ?? "all");
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // Fall back to "all" once the filtered-on folder is actually gone. Driven
  // off `folders` rather than off the delete click, so cancelling the
  // delete confirm leaves the current filter alone.
  useEffect(() => {
    if (folderFilter === "all" || folderFilter === "unfiled") return;
    if (folders && !folders.some((f) => f.id === folderFilter)) setFolderFilter("all");
  }, [folders, folderFilter]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Email is written in the email window (ClientEmail.tsx, through onComposeEmail),
  // so this column holds Notes and texts (Derek, 2026-09-11).
  const [composeMode, setComposeMode] = useState<"note" | "sms">("note");
  const [draftType, setDraftType] = useState<NoteType>("note");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  // A7a: month index — keyed by each day-divider's own key (a toDateString,
  // already unique per calendar day) so "jump to month" can reuse the
  // dividers already in the feed instead of tagging every row a second way.
  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const msgBodyRef = useRef<HTMLTextAreaElement>(null);
  const draftPromptRef = useRef<HTMLInputElement>(null);
  const [msgBody, setMsgBody] = useState("");
  // A header Email button opens the email window; SMS opens the text box and focuses it.
  useEffect(() => {
    if (!composeIntent || !onSendMessage) return;
    if (composeIntent.mode === "email") { onComposeEmail?.(); return; }
    setComposeMode("sms");
    if (composeIntent.body) setMsgBody(composeIntent.body);
    requestAnimationFrame(() => msgBodyRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeIntent?.nonce]);
  // Pending scheduled sends aren't part of the global data load — fetch them
  // whenever this client/project's Journal mounts (key={activeProject ??
  // activeClient} on the caller already remounts this per client, so a plain
  // mount effect is enough — no dependency array needed beyond that).
  useEffect(() => { onLoadScheduled?.(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Free-text instruction for the "Prompt Claude" draft ("check in with them",
  // "let them know it's on hold", etc.). Empty = the default status-update draft.
  const [draftPrompt, setDraftPrompt] = useState("");
  const [pendingAtts, setPendingAtts] = useState<Attachment[]>([]);
  const [uploadingAtt, setUploadingAtt] = useState(false);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [permPopoverOpen, setPermPopoverOpen] = useState(false);
  // Snapshot of which messages were unread the moment this Journal opened —
  // the mark-read effect below flips message.read to true almost instantly,
  // so rendering off the live value would show "unread" for one flash and
  // never again. Lazy initializer runs once per mount; this component
  // remounts per client (key={activeProject ?? activeClient} at the call
  // site), so "once per mount" is exactly "once per client opened."
  const [unreadAtOpen] = useState<Set<string>>(() => new Set((messages ?? []).filter((m) => !m.read).map((m) => m.id)));

  // One merged feed, newest first (Derek, 2026-09-30: "reverse the conversation
  // order so that the latest message is at the top"): what just happened is the
  // reason the Journal was opened, and it used to be the furthest thing from
  // where the page lands. Notes, messages, task comments, and
  // task-completion events. Every other system event (assignee/due/priority
  // changes) is deliberately dropped here: it stays visible in the task's
  // own Activity tab, where it's already contextual, but including every
  // field tweak in this client-wide feed would dilute the "what's been
  // completed" signal this is meant to surface at a glance.
  const journalItems: JournalItem[] = [
    ...notes.map((n): JournalItem => ({ kind: "note", at: n.at, note: n })),
    ...(messages ?? []).map((m): JournalItem => ({ kind: "message", at: m.at, message: m })),
    ...tasks.flatMap((t) => t.comments.map((c): JournalItem | null => {
      if (c.kind === "event") return isCompletionEvent(c.body) ? { kind: "completion", at: c.at, comment: { ...c, taskId: t.id, taskTitle: t.title } } : null;
      return { kind: "activity", at: c.at, comment: { ...c, taskId: t.id, taskTitle: t.title } };
    }).filter((x): x is JournalItem => x !== null)),
  // Oldest first, newest at the bottom right above the reply box, as in the
  // Inbox (Derek, 2026-10-07, the Journal redesign). The page opens scrolled
  // to the bottom, so what just happened is still the first thing seen.
  ].sort((a, b) => a.at.localeCompare(b.at));

  const q = searchQuery.trim().toLowerCase();
  const matchesSearch = (it: JournalItem): boolean => {
    if (!q) return true;
    if (it.kind === "note") return it.note.body.toLowerCase().includes(q);
    if (it.kind === "message") return (it.message.subject ?? "").toLowerCase().includes(q) || it.message.body.toLowerCase().includes(q);
    return it.comment.body.toLowerCase().includes(q) || it.comment.taskTitle.toLowerCase().includes(q);
  };
  // Photos/Links/Files filter by attachment kind, across notes AND messages
  // (both can carry attachments). Photos = images, Files = pdf/doc/sheet.
  const itemAtts = (it: JournalItem): Attachment[] =>
    it.kind === "note" ? (it.note.attachments ?? [])
      : it.kind === "message" ? (it.message.attachments ?? [])
      : [];
  const hasKind = (it: JournalItem, kinds: string[]) => itemAtts(it).some((a) => kinds.includes(a.kind));
  // Only note attachments carry a folderId (see onSetNoteAttachmentFolder) —
  // an active folder filter naturally excludes messages/activity, same as
  // it did in Vault when an item had no folder concept at all.
  const passesFolder = (it: JournalItem) => {
    if (folderFilter === "all") return true;
    if (it.kind !== "note") return false;
    const atts = it.note.attachments ?? [];
    return folderFilter === "unfiled" ? atts.some((a) => !a.folderId) : atts.some((a) => a.folderId === folderFilter);
  };
  const filteredItems = journalItems.filter((it) => {
    const passesSegment = segment === "all" ? true
      : segment === "conversation" ? it.kind === "message"
      : segment === "decisions" ? it.kind === "note"
      : (it.kind === "activity" || it.kind === "completion"); // "activity"
    const passesSub = subFilter === "all" ? true
      : subFilter === "photos" ? hasKind(it, ["image"])
      : subFilter === "links" ? hasKind(it, ["link"])
      : subFilter === "files" ? hasKind(it, ["pdf", "doc", "sheet"])
      : (it.kind === "note" && it.note.type === subFilter);
    return passesSegment && passesSub && passesFolder(it) && matchesSearch(it);
  });
  // Newest AI recap ("recently done / next up") — pinned as a highlighted
  // card atop the unfiltered feed so the freshest "where does this stand"
  // read is always one glance away. Excluded from the chronological list
  // while pinned so it isn't shown twice; older recaps still flow inline.
  const latestRecap = notes.filter((n) => n.type === "ai_summary").sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const pinnedRecap = latestRecap && segment === "all" && subFilter === "all" && folderFilter === "all" && !q ? latestRecap : null;
  const feedRows = buildFeedRows(pinnedRecap ? filteredItems.filter((it) => !(it.kind === "note" && it.note.id === pinnedRecap.id)) : filteredItems);

  // A7a: one entry per month, newest first, each pointing at the day-divider
  // key of that month's latest entry (feedRows renders newest first, so
  // that divider is the one to scroll to — it's the top of that month's
  // block). Built from feedRows itself so the index only ever lists months
  // actually present under the current segment/sub-filter/search.
  const nowKey = new Date().toISOString().slice(0, 7);
  const monthGroups = (() => {
    const counts = new Map<string, number>();
    for (const it of filteredItems) {
      const d = new Date(it.at);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      counts.set(mKey, (counts.get(mKey) ?? 0) + 1);
    }
    const anchors = new Map<string, { anchorDayKey: string; label: string }>();
    for (const row of feedRows) {
      if (row.kind !== "divider") continue;
      const d = new Date(row.key);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!anchors.has(mKey)) anchors.set(mKey, { anchorDayKey: row.key, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count, anchorDayKey: anchors.get(key)?.anchorDayKey, label: anchors.get(key)?.label ?? key }))
      .filter((g): g is { key: string; count: number; anchorDayKey: string; label: string } => !!g.anchorDayKey)
      .sort((a, b) => b.key.localeCompare(a.key));
  })();
  const jumpToMonth = (anchorDayKey: string) => dayRefs.current.get(anchorDayKey)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const canModify = (n: ClientNote) => me.role === "admin" || n.authorId === me.id;

  // Same @mention pattern as task comments: type @ to search teammates, pick
  // one to insert "@Name ", and onAdd's caller notifies them on send.
  const mentionCands = mentionCandidates(draft, users);
  const mentionOpen = mentionCands.length > 0;

  useEffect(() => { if ((messages?.length ?? 0) > 0) onOpenMessages?.(); }, [messages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!draft.trim() && pendingAtts.length === 0) return;
    onAdd(draftType, draft.trim(), pendingAtts.length ? pendingAtts : undefined);
    setDraft(""); setPendingAtts([]);
  };
  // Attach any file (images, PDFs, docs) — onUploadImage handles any kind
  // (it kind-detects from the filename). Files flow to the Vault too.
  const handleNoteFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingAtt(true);
    for (const f of Array.from(files)) { const att = await onUploadImage(f); if (att) setPendingAtts((a) => [...a, att]); }
    setUploadingAtt(false);
  };
  // Add a link (any URL incl. Google Doc/Drive) as a journal attachment.
  const addLink = () => {
    const raw = linkUrl.trim();
    if (!raw) { setLinkOpen(false); return; }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let host = url; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
    setPendingAtts((a) => [...a, { id: newId("a_"), name: linkLabel.trim() || host, size: "", kind: "link", url }]);
    setLinkUrl(""); setLinkLabel(""); setLinkOpen(false);
  };
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) images.push(f); }
    }
    if (images.length === 0) return;
    e.preventDefault();
    setUploadingAtt(true);
    for (const f of images) { const att = await onUploadImage(f); if (att) setPendingAtts((a) => [...a, att]); }
    setUploadingAtt(false);
  };
  // Reply starts a new email with "Re: subject", no quoted body: GHL sends it on
  // the same conversation, so the client's mail app already shows the thread.
  const replyToEmail = (m: Message) => {
    const subj = (m.subject ?? "").trim();
    onComposeEmail?.({ subject: subj ? (/^re:/i.test(subj) ? subj : `Re: ${subj}`) : "", replyTo: m.id });
  };
  const hasComposedBody = !!msgBody.trim();
  // N, E and S start a note, an email or a text from anywhere on the page,
  // except while typing in a field.
  const noteBoxRef = useRef<HTMLTextAreaElement>(null);
  const startCompose = (mode: "note" | "email" | "sms") => {
    if (mode === "email") { onComposeEmail?.(); return; }
    if (mode === "sms" && onComposeText) { onComposeText(); return; }
    setComposeMode(mode);
    requestAnimationFrame(() => (mode === "note" ? noteBoxRef.current : msgBodyRef.current)?.focus());
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || !!target?.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "n") { e.preventDefault(); startCompose("note"); }
      else if (k === "e" && onSendMessage) { e.preventDefault(); startCompose("email"); }
      else if (k === "s" && onSendMessage) { e.preventDefault(); startCompose("sms"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSendMessage]);
  const submitMessage = () => {
    if (!hasComposedBody || !onSendMessage || composeMode !== "sms") return;
    onSendMessage("sms", "", msgBody.trim());
    setMsgBody("");
  };
  const submitScheduled = (whenIso: string) => {
    if (!hasComposedBody || !onScheduleMessage || composeMode !== "sms") return;
    onScheduleMessage("sms", "", msgBody.trim(), whenIso);
    setMsgBody("");
  };
  // "Prompt Claude" draft for a text. On success it fills the text and clears the
  // prompt box (also collapsing the auto-grown textarea back to one line).
  const runDraft = async () => {
    if (!onDraftMessage || composeMode !== "sms") return;
    const d = await onDraftMessage("sms", draftPrompt.trim() || undefined);
    if (d) {
      setMsgBody(d.body);
      setDraftPrompt("");
      if (draftPromptRef.current) draftPromptRef.current.style.height = "auto";
    }
  };
  const startEdit = (n: ClientNote) => { setEditingId(n.id); setEditBody(n.body); };
  const saveEdit = (n: ClientNote) => { if (editBody.trim()) onEdit(n, editBody.trim()); setEditingId(null); };
  const askDelete = (n: ClientNote) => setConfirmDialog({
    title: "Delete this message?", message: "This can't be undone.", confirmLabel: "Delete",
    onConfirm: () => { setConfirmDialog(null); onDelete(n); },
  });

  // Emails open in place like the Inbox's; the newest starts open.
  const newestEmailId = [...(messages ?? [])].filter((m) => m.channel === "email").sort((a, b) => b.at.localeCompare(a.at))[0]?.id ?? null;
  const [openEmails, setOpenEmails] = useState<Set<string>>(() => new Set(newestEmailId ? [newestEmailId] : []));
  const toggleEmail = (id: string) => setOpenEmails((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [moreOpen, setMoreOpen] = useState(false);
  // Opens at the bottom, where the newest is, and stays there as more comes in.
  const feedRef = useRef<HTMLDivElement>(null);
  const feedLen = feedRows.length;
  useEffect(() => { const el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }, [feedLen, segment, subFilter, folderFilter]);

  const counts = {
    all: journalItems.length,
    conversation: journalItems.filter((it) => it.kind === "message").length,
    decisions: journalItems.filter((it) => it.kind === "note").length,
    activity: journalItems.filter((it) => it.kind === "activity" || it.kind === "completion").length,
  };
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const theirName = toContact?.name?.trim() || "Them";
  const firstName = theirName.split(/\s+/)[0];
  // What they owe us, and the work still open, for the side panel.
  const waiting = tasks.filter((t) => t.waitingOnClient && t.status !== "done");
  const openTasks = tasks.filter((t) => !t.waitingOnClient && t.status !== "done")
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, 5);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const subLabel = subFilter !== "all"
    ? (subFilter === "photos" ? "Photos" : subFilter === "links" ? "Links" : subFilter === "files" ? "Files" : noteTypeMeta(subFilter as NoteType).label)
    : folderFilter !== "all" ? (folderFilter === "unfiled" ? "Unfiled" : (folders ?? []).find((f) => f.id === folderFilter)?.name ?? "Filter") : "Filter";
  const menuItem = (on: boolean) => `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[16px] ${on ? "bg-accent-soft font-semibold text-accent" : "hover:bg-background"}`;
  const cap = "mb-2.5 flex items-center gap-2 text-[14px] font-bold uppercase tracking-wide text-muted";
  const reachBtn = "flex h-12 items-center justify-center rounded-lg ring-1 ring-[var(--border)] text-accent hover:bg-background disabled:opacity-40";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* One row: what to show, a filter, search and the month. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-surface px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap gap-1 rounded-lg bg-background p-1" role="group" aria-label="Show">
          {([
            { key: "all", label: "Everything" },
            ...(messages != null ? [{ key: "conversation", label: "Texts and email" } as const] : []),
            { key: "decisions", label: "Notes and decisions" },
            { key: "activity", label: "Activity" },
          ] as { key: JournalSegment; label: string }[]).map((s) => (
            <button key={s.key} onClick={() => setSegment(s.key)} aria-pressed={segment === s.key}
              className={`rounded-md px-3 py-1.5 text-[16px] font-semibold ${segment === s.key ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>
              {s.label}<span className="ml-1.5 font-medium text-muted">{counts[s.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <button onClick={() => setFilterMenuOpen((v) => !v)}
            className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[16px] font-semibold ring-1 ring-[var(--border)] ${subFilter !== "all" || folderFilter !== "all" ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:text-foreground"}`}>
            <I.filter /> {subLabel}
          </button>
          {filterMenuOpen && (<>
            <div className="fixed inset-0 z-10" onClick={() => setFilterMenuOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 max-h-[70vh] w-60 overflow-y-auto rounded-xl bg-surface p-1 shadow-lg ring-1 ring-[var(--border)]">
              <button onClick={() => { setSubFilter("all"); setFolderFilter("all"); setFilterMenuOpen(false); }} className={menuItem(subFilter === "all" && folderFilter === "all")}>All</button>
              <div className="my-1 h-px bg-border" />
              {NOTE_TYPE_ORDER.map((t) => (
                <button key={t} onClick={() => { setSubFilter(t); setFilterMenuOpen(false); }} className={menuItem(subFilter === t)}>
                  <span className="h-2 w-2 rounded-full" style={{ background: NOTE_TYPE_META[t].color }} /> {NOTE_TYPE_META[t].label}
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <button onClick={() => { setSubFilter("photos"); setFilterMenuOpen(false); }} className={menuItem(subFilter === "photos")}>Photos</button>
              <button onClick={() => { setSubFilter("links"); setFilterMenuOpen(false); }} className={menuItem(subFilter === "links")}><I.link /> Links</button>
              <button onClick={() => { setSubFilter("files"); setFilterMenuOpen(false); }} className={menuItem(subFilter === "files")}><I.clip /> Files</button>
              {folders && (<>
                <div className="my-1 h-px bg-border" />
                <div className="px-3 pb-1 pt-1.5 text-[14px] font-bold uppercase tracking-wide text-muted">Folder</div>
                <button onClick={() => { setFolderFilter("unfiled"); setFilterMenuOpen(false); }} className={menuItem(folderFilter === "unfiled")}>Unfiled</button>
                {folders.map((f) => (
                  <div key={f.id} className={`group/jf flex items-center rounded-md pr-1 ${folderFilter === f.id ? "bg-accent-soft" : "hover:bg-background"}`}>
                    <button onClick={() => { setFolderFilter(f.id); setFilterMenuOpen(false); }} className={`min-w-0 flex-1 truncate px-3 py-2 text-left text-[16px] ${folderFilter === f.id ? "font-semibold text-accent" : ""}`}>{f.name}</button>
                    {onDeleteFolder && (
                      // Asks first; the folder leaving `folders` is what clears the filter.
                      <button onClick={(e) => { e.stopPropagation(); onDeleteFolder(f.id); }} title="Delete folder" aria-label={`Delete folder ${f.name}`} className="hidden shrink-0 rounded p-1.5 text-muted hover:text-danger group-hover/jf:block"><I.trash className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
                {onCreateFolder && (addingFolder ? (
                  <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newFolderName.trim()) { onCreateFolder(newFolderName.trim()); setNewFolderName(""); setAddingFolder(false); } if (e.key === "Escape") setAddingFolder(false); }}
                    onBlur={() => { if (newFolderName.trim()) onCreateFolder(newFolderName.trim()); setNewFolderName(""); setAddingFolder(false); }}
                    placeholder="Folder name" className="mt-0.5 w-full rounded-md bg-background px-3 py-2 text-[16px] outline-none ring-1 ring-accent" />
                ) : (
                  <button onClick={() => setAddingFolder(true)} className={menuItem(false)}><I.plus className="h-4 w-4" /> New folder</button>
                ))}
              </>)}
            </div>
          </>)}
        </div>
        <span className="hidden flex-1 lg:block" />
        {/* Search, month and More stay on one line together. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
        <div className="relative min-w-0 flex-1 lg:w-[280px] lg:flex-none">
          <I.search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} type="search" placeholder={toContact?.name ? `Search ${firstName}'s history` : "Search"} aria-label="Search"
            className="h-10 w-full rounded-lg bg-surface pl-9 pr-3 text-[16px] outline-none ring-1 ring-[var(--border)] placeholder:text-muted focus:ring-accent" />
        </div>
        {monthGroups.length > 1 && (
          <select aria-label="Jump to a month" value="" onChange={(e) => { if (e.target.value) jumpToMonth(e.target.value); }}
            className="h-10 w-[148px] shrink-0 rounded-lg bg-surface px-2 text-[16px] font-semibold ring-1 ring-[var(--border)]">
            <option value="">Month</option>
            {monthGroups.map((g) => <option key={g.key} value={g.anchorDayKey}>{g.label} ({g.count}){g.key === nowKey ? ", now" : ""}</option>)}
          </select>
        )}
        {(onRefreshMessages && messages != null) || (canAdmin && (onRefreshContact || (messages != null && onToggleCanMessage))) ? (
          <div className="relative">
            <button onClick={() => setMoreOpen((o) => !o)} aria-label="More" title="More" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface text-muted ring-1 ring-[var(--border)] hover:text-foreground"><I.dots /></button>
            {moreOpen && (<>
              <div className="fixed inset-0 z-30" onClick={() => { setMoreOpen(false); setPermPopoverOpen(false); }} />
              <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl bg-surface p-1 shadow-xl ring-1 ring-[var(--border)]">
                {onRefreshMessages && messages != null && (
                  <button onClick={() => { onRefreshMessages(); setMoreOpen(false); }} disabled={refreshingMessages} className={menuItem(false)}><I.repeat className={refreshingMessages ? "animate-spin" : ""} /> Pull missed emails and texts</button>
                )}
                {canAdmin && onRefreshContact && (
                  <button onClick={() => { onRefreshContact(); setMoreOpen(false); }} disabled={refreshingContact} className={menuItem(false)}><I.user /> Refresh their details from GoHighLevel</button>
                )}
                {canAdmin && messages != null && onToggleCanMessage && (<>
                  <button onClick={() => setPermPopoverOpen((o) => !o)} className={menuItem(permPopoverOpen)}><I.bolt /> Who can email and text them</button>
                  {permPopoverOpen && (
                    <div className="px-2 pb-2">
                      {users.filter((u) => u.role === "va").map((u) => {
                        const on = (canMessage ?? []).includes(u.id);
                        return (
                          <button key={u.id} onClick={() => onToggleCanMessage(u.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[16px] hover:bg-background">
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ring-1 ${on ? "bg-accent text-white ring-accent" : "ring-[var(--border)]"}`}>{on && <I.check />}</span>
                            <Avatar id={u.id} size={20} /> <span className="truncate">{u.name}</span>
                          </button>
                        );
                      })}
                      <div className="px-2 pt-1 text-[16px] text-muted">Admins can always send.</div>
                    </div>
                  )}
                </>)}
              </div>
            </>)}
          </div>
        ) : null}
        </div>
      </div>

      {/* The conversation with the reply box under it, and the side panel, as in the Inbox. */}
      {/* Below a wide screen the page scrolls as one column, cards first and the
          conversation (its own scroll, a screen tall) under them, as in the mockup. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section aria-label="Conversation" className="order-2 flex h-[85vh] min-w-0 shrink-0 flex-col bg-surface lg:order-none lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink lg:border-r">
          <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-1">
              {filteredItems.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.comment /></span>
                  {q ? (<>
                    <span className="text-[16px] font-semibold">No results for &quot;{searchQuery.trim()}&quot;</span>
                    <span className="max-w-[300px] text-[16px]">Try a different search, or clear it to see everything.</span>
                  </>) : (<>
                    <span className="text-[16px] font-semibold">Nothing here yet</span>
                    <span className="max-w-[300px] text-[16px]">Notes, emails, texts and finished work show up here as they happen, for the team and for Claude.</span>
                  </>)}
                </div>
              )}
              {feedRows.map((row) => {
                if (row.kind === "divider") return (
                  <div key={row.key} ref={(el) => { if (el) dayRefs.current.set(row.key, el); else dayRefs.current.delete(row.key); }}
                    className="flex items-center gap-3 pb-2 pt-5 text-[16px] font-semibold text-muted">
                    <span className="h-px flex-1 bg-border" />{row.label}<span className="h-px flex-1 bg-border" />
                  </div>
                );
                if (row.kind === "note") {
                  const n = row.note;
                  const m = noteTypeMeta(n.type);
                  return (
                    <div key={n.id} className="group/note my-1.5 rounded-xl bg-highlight-soft/70 px-4 py-3 text-[16px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <Avatar id={n.authorId} size={22} />
                        <b>{userById(n.authorId)?.name ?? "Unknown"}</b>
                        <span className="rounded px-1.5 font-semibold" style={{ background: m.color + "22", color: m.color }}>{m.label}</span>
                        <span className="text-muted">{timeOf(n.at)}</span>
                        {canModify(n) && (
                          <span className="ml-auto flex gap-1 sm:opacity-0 sm:group-hover/note:opacity-100">
                            <button onClick={() => startEdit(n)} title="Edit" aria-label="Edit" className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"><I.pencil /></button>
                            <button onClick={() => askDelete(n)} title="Delete" aria-label="Delete" className="rounded p-1 text-muted hover:bg-surface hover:text-danger"><I.trash /></button>
                          </span>
                        )}
                      </div>
                      {editingId === n.id ? (
                        <div className="mt-2">
                          <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} autoFocus
                            className="w-full resize-none rounded-lg bg-surface px-3 py-2 text-[16px] outline-none ring-1 ring-[var(--border)] focus:ring-accent" />
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => saveEdit(n)} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">Save</button>
                            <button onClick={() => setEditingId(null)} className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface">Cancel</button>
                          </div>
                        </div>
                      ) : (<>
                        {n.body && <CollapsibleText text={n.body} className="mt-1.5 whitespace-pre-wrap text-[16px]" />}
                        {n.attachments && n.attachments.length > 0 && (
                          <div className="mt-2"><AttachmentThumbs items={n.attachments} onOpen={onOpenFile} folders={folders} onSetFolder={onSetNoteAttachmentFolder ? (attId, folderId) => onSetNoteAttachmentFolder(n, attId, folderId) : undefined} /></div>
                        )}
                      </>)}
                    </div>
                  );
                }
                if (row.kind === "message-group") {
                  if (row.channel === "email") return (
                    <div key={row.key} className="flex flex-col gap-2 py-1.5">
                      {row.messages.map((m) => {
                        const mine = m.direction === "outbound";
                        const who = mine ? (m.createdBy === me.id ? "You" : userById(m.createdBy)?.name ?? "You") : (m.peerName || theirName);
                        const open = openEmails.has(m.id);
                        const snippet = (looksLikeHtml(m.body) ? m.body.replace(/<[^>]+>/g, " ") : m.body).replace(/\s+/g, " ").trim().slice(0, 160);
                        return (
                          <article key={m.id} className="overflow-hidden rounded-xl ring-1 ring-[var(--border)]">
                            <button onClick={() => toggleEmail(m.id)} aria-expanded={open} className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3 text-left hover:bg-background">
                              {mine && m.createdBy ? <Avatar id={m.createdBy} size={40} /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-[#7c3aed] font-bold text-white">{initialsOf(who)}</span>}
                              <span className="min-w-0">
                                <b className="block truncate">{who}{m.subject ? ` · ${m.subject}` : ""}</b>
                                {!open && <span className="block truncate text-muted">{mine ? `to ${firstName} · ` : ""}{snippet}</span>}
                              </span>
                              <span className="flex items-center gap-2 whitespace-nowrap text-muted">
                                {unreadAtOpen.has(m.id) && <span className="rounded-md bg-accent-soft px-1.5 font-semibold text-accent">New</span>}
                                {timeOf(m.at)}
                              </span>
                            </button>
                            {open && (
                              <div className="px-3.5 pb-3.5 sm:pl-[66px]">
                                {looksLikeHtml(m.body)
                                  // Sanitised: an email body is whatever a stranger decided to send.
                                  ? <div className="rte-content text-[16px]" dangerouslySetInnerHTML={{ __html: safeMessageHtml(m.body) }} />
                                  : <CollapsibleText text={m.body} className="whitespace-pre-wrap text-[16px]" />}
                                {m.attachments && m.attachments.length > 0 && <div className="mt-2"><AttachmentThumbs items={m.attachments} onOpen={onOpenFile} /></div>}
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-muted">
                                  <NotInGhlChip m={m} />
                                  <span className="flex-1" />
                                  {onSendMessage && onComposeEmail && <button onClick={() => replyToEmail(m)} className="rounded-full bg-accent px-4 py-1.5 font-semibold text-white">↩ Reply</button>}
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  );
                  // Texts, calls and portal chat: bubbles, theirs left and ours right.
                  const mine = row.direction === "outbound";
                  const last = row.messages[row.messages.length - 1]!;
                  const label = row.channel === "sms" ? "Text" : row.channel === "chat" ? "Portal chat" : "Call";
                  return (
                    <div key={row.key} className={`flex flex-col gap-1 py-1 ${mine ? "items-end" : "items-start"}`}>
                      {row.messages.map((m) => (
                        <div key={m.id} className={`max-w-[88%] sm:max-w-[72%] ${mine ? "rounded-[18px] rounded-br-md bg-accent px-3.5 py-2.5 text-white" : "rounded-[18px] rounded-bl-md bg-background px-3.5 py-2.5"}`}>
                          <CollapsibleText text={m.body} className="whitespace-pre-wrap break-words text-[16px]" />
                          {m.attachments && m.attachments.length > 0 && <div className="mt-1.5"><AttachmentThumbs items={m.attachments} onOpen={onOpenFile} /></div>}
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-2 px-1.5 text-muted">
                        <span className={`font-semibold ${row.channel === "sms" ? "text-success" : row.channel === "chat" ? "text-highlight" : ""}`}>● {label}</span>
                        {timeOf(last.at)}
                        {mine && last.createdBy && <span>· {userById(last.createdBy)?.name ?? "Unknown"}</span>}
                        {row.messages.some((m) => unreadAtOpen.has(m.id)) && <span className="rounded-md bg-accent-soft px-1.5 font-semibold text-accent">New</span>}
                        <NotInGhlChip m={last} />
                      </div>
                    </div>
                  );
                }
                if (row.kind === "completion") {
                  const c = row.comment;
                  return (
                    <button key={c.id} onClick={() => onOpenTask(c.taskId)} className="my-1 self-center rounded-full px-3 py-1 text-center text-[16px] text-muted hover:bg-background">
                      <span className="text-success">✓</span> <b className="font-semibold text-accent">{c.taskTitle}</b> finished · {timeOf(c.at)}
                    </button>
                  );
                }
                // A comment left on one of their tasks.
                const c = row.comment;
                return (
                  <button key={c.id} onClick={() => onOpenTask(c.taskId)} className="my-1 flex w-full gap-2.5 rounded-xl px-3 py-2 text-left text-[16px] ring-1 ring-[var(--border)] hover:ring-accent">
                    <Avatar id={c.authorId} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="text-muted"><b className="text-foreground">{userById(c.authorId)?.name ?? "Unknown"}</b> on <b className="text-accent">{c.taskTitle}</b> · {timeOf(c.at)}</span>
                      {c.body && <CollapsibleText text={c.body} className="mt-0.5 whitespace-pre-wrap text-[16px]" />}
                      {c.attachments && c.attachments.length > 0 && <span className="mt-0.5 flex items-center gap-1 text-muted"><I.clip /> {c.attachments.length} attachment{c.attachments.length === 1 ? "" : "s"}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* The reply box, under the newest. Email opens the email window; Text opens the text window when there is one. */}
          <div className="shrink-0 border-t bg-surface px-4 pb-4 pt-3 sm:px-6"
            onDragOver={(e) => { if (composeMode === "note") e.preventDefault(); }}
            onDrop={(e) => { if (composeMode === "note" && e.dataTransfer.files.length) { e.preventDefault(); handleNoteFiles(e.dataTransfer.files); } }}>
            <div className="mx-auto max-w-3xl">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {onSendMessage ? (
                  <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border)]" role="group" aria-label="Write">
                    {(["sms", "email", "note"] as const).map((k) => (
                      <button key={k} onClick={() => startCompose(k)} aria-pressed={composeMode === k}
                        className={`px-3.5 py-1.5 text-[16px] font-semibold ${composeMode === k ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>
                        {k === "sms" ? "Text" : k === "email" ? "Email" : "Note"}
                      </button>
                    ))}
                  </div>
                ) : <b className="text-[16px] text-muted">Note</b>}
                {composeMode === "note" ? (
                  <select value={draftType} onChange={(e) => setDraftType(e.target.value as NoteType)} aria-label="Kind of note"
                    className="h-9 rounded-lg bg-surface px-2 text-[16px] ring-1 ring-[var(--border)]">
                    {MANUAL_NOTE_TYPES.map((t) => <option key={t} value={t}>{NOTE_TYPE_META[t].label}</option>)}
                  </select>
                ) : (
                  <span className="min-w-0 truncate text-[16px] text-muted">To {toContact?.phone ? <><b className="text-foreground">{toContact.name || "them"}</b> · {toContact.phone}</> : "nobody: there's no phone number on file"}</span>
                )}
              </div>

              {composeMode === "note" ? (<>
                {(pendingAtts.length > 0 || uploadingAtt) && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <AttachmentThumbs items={pendingAtts} onRemove={(id) => setPendingAtts((a) => a.filter((x) => x.id !== id))} />
                    {uploadingAtt && <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
                  </div>
                )}
                <div className="relative">
                  {mentionOpen && (
                    <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-lg bg-surface shadow-lg ring-1 ring-[var(--border)]">
                      {mentionCands.map((u) => (
                        <button key={u.id} onClick={() => setDraft(applyMention(draft, u.name))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[16px] hover:bg-background">
                          <Avatar id={u.id} size={22} /> <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea ref={noteBoxRef} value={draft} onChange={(e) => setDraft(e.target.value)} onPaste={handlePaste} rows={2}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !mentionOpen) { e.preventDefault(); submit(); } }}
                    placeholder="A note for the team. Enter sends, @ mentions someone, paste or drop a file to attach."
                    className="max-h-48 min-h-[56px] w-full resize-y rounded-xl bg-background px-3 py-2 text-[16px] outline-none ring-1 ring-[var(--border)] placeholder:text-muted focus:ring-accent" />
                </div>
                {linkOpen && (
                  <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-background p-2">
                    <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } if (e.key === "Escape") setLinkOpen(false); }} placeholder="Paste a link (Google Doc, Drive, any address)" className="min-w-0 flex-[2] rounded-md bg-surface px-3 py-1.5 text-[16px] outline-none ring-1 ring-[var(--border)] focus:ring-accent" />
                    <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} placeholder="Label (optional)" className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-[16px] outline-none ring-1 ring-[var(--border)] focus:ring-accent" />
                    <button onClick={addLink} className="rounded-md bg-accent px-3 py-1.5 font-semibold text-white">Add</button>
                    <button onClick={() => { setLinkOpen(false); setLinkUrl(""); setLinkLabel(""); }} className="rounded-md px-3 py-1.5 text-muted hover:text-foreground">Cancel</button>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button onClick={() => noteFileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[16px] text-muted ring-1 ring-[var(--border)] hover:text-foreground"><I.clip /> Attach</button>
                  <button onClick={() => setLinkOpen((o) => !o)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[16px] ring-1 ${linkOpen ? "text-accent ring-accent" : "text-muted ring-[var(--border)] hover:text-foreground"}`}><I.link /> Link</button>
                  <input ref={noteFileRef} type="file" multiple className="hidden" onChange={(e) => { handleNoteFiles(e.target.files); e.target.value = ""; }} />
                  <span className="flex-1" />
                  <button onClick={submit} disabled={!draft.trim() && pendingAtts.length === 0} className="rounded-lg bg-accent px-5 py-2 text-[16px] font-bold text-white disabled:opacity-40">Add note</button>
                </div>
              </>) : (<>
                <div onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitMessage(); } }}>
                  <textarea ref={msgBodyRef} value={msgBody} onChange={(e) => setMsgBody(e.target.value)} rows={2}
                    placeholder={`Write to ${firstName} (${shortcut("Enter")} sends)`}
                    className="max-h-48 min-h-[56px] w-full resize-y rounded-xl bg-background px-3 py-2 text-[16px] outline-none ring-1 ring-[var(--border)] placeholder:text-muted focus:ring-accent" />
                </div>
                {onDraftMessage && (
                  <div className="mt-2 flex items-center gap-2 rounded-full bg-accent-soft/50 py-1 pl-3 pr-1 ring-1 ring-accent/30">
                    <span aria-hidden>✨</span>
                    <input ref={draftPromptRef} value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !draftingMessage) { e.preventDefault(); runDraft(); } }}
                      placeholder="Tell Claude what to say, or leave it empty for a status update" aria-label="Tell Claude what to say"
                      className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" />
                    <button onClick={runDraft} disabled={draftingMessage} className="shrink-0 rounded-full bg-surface px-3 py-1 font-semibold text-accent ring-1 ring-accent/40 disabled:opacity-40">
                      {draftingMessage ? "Writing…" : draftPrompt.trim() ? "Write it" : "Status update"}
                    </button>
                  </div>
                )}
                {scheduled && scheduled.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {scheduled.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 text-[16px] text-muted">
                        <I.clock className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Scheduled {s.channel === "sms" ? "text" : "email"}: {new Date(s.scheduledAt).toLocaleString()}</span>
                        <button onClick={() => onCancelScheduled?.(s.id)} className="shrink-0 font-semibold text-accent hover:underline">Cancel</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-end gap-2">
                  <span className="mr-auto text-[16px] text-muted">{msgBody.length} / 160</span>
                  {onScheduleMessage && <SchedulePopover disabled={!hasComposedBody || sendingMessage} onSchedule={submitScheduled} />}
                  <button onClick={submitMessage} disabled={!hasComposedBody || sendingMessage} className="rounded-lg bg-accent px-5 py-2 text-[16px] font-bold text-white disabled:opacity-40">{sendingMessage ? "Sending…" : "Send"}</button>
                </div>
              </>)}
            </div>
          </div>
        </section>

        {/* Side panel: who they are, what they owe us, what's next, their open work. */}
        <aside aria-label="About them" className="order-1 flex shrink-0 flex-col gap-3.5 p-4 lg:order-none lg:w-[360px] lg:overflow-y-auto">
          {toContact && (
            <div className="rounded-2xl bg-surface p-3.5 ring-1 ring-[var(--border)]">
              <div className={cap}>{firstName}</div>
              <button onClick={onOpenClientTasks} disabled={!onOpenClientTasks} title={onOpenClientTasks ? `Open ${firstName}'s tasks` : undefined}
                className="group flex w-full items-center gap-3 rounded-lg text-left disabled:cursor-default">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#7c3aed] font-bold text-white">{initialsOf(theirName)}</span>
                <span className="min-w-0">
                  <b className="block truncate text-[18px] group-enabled:group-hover:text-accent group-enabled:group-hover:underline">{theirName}</b>
                  <span className="block truncate text-muted">{toContact.email || toContact.phone || "No email on file"}</span>
                </span>
              </button>
              {/* Icons only (Derek, 2026-10-07); each says what it does on hover. */}
              <div className="mt-3 grid grid-cols-5 gap-1.5">
                <button onClick={() => startCompose("email")} disabled={!onComposeEmail || !toContact.email} title={toContact.email ? `Email ${toContact.email}` : "No email on file"} aria-label="Email" className={reachBtn}><I.mail className="h-6 w-6" /></button>
                <button onClick={() => startCompose("sms")} disabled={!onSendMessage || !toContact.phone} title={toContact.phone ? `Text ${toContact.phone}` : "No phone on file"} aria-label="Text" className={reachBtn}><I.chatBubbles className="h-6 w-6" /></button>
                {toContact.phone
                  ? <a href={`tel:${toContact.phone}`} title={`Call ${toContact.phone}`} aria-label="Call" className={reachBtn}><I.phone className="h-6 w-6" /></a>
                  : <button disabled title="No phone on file" aria-label="Call" className={reachBtn}><I.phone className="h-6 w-6" /></button>}
                <button onClick={onBook} disabled={!onBook} title="Book a time" aria-label="Book a time" className={reachBtn}><I.calendar className="h-6 w-6" /></button>
                {ghlUrl
                  ? <a href={ghlUrl} target="_blank" rel="noopener noreferrer" title="Open in GoHighLevel" aria-label="Open in GoHighLevel" className={reachBtn}><I.bolt className="h-6 w-6" /></a>
                  : <button disabled title="Not in GoHighLevel" aria-label="Open in GoHighLevel" className={reachBtn}><I.bolt className="h-6 w-6" /></button>}
              </div>
            </div>
          )}

          {waiting.length > 0 && (
            <div className="rounded-2xl bg-surface p-3.5 ring-1 ring-[var(--border)]">
              <div className={cap}>Waiting on {firstName}<span className="ml-auto rounded-full bg-highlight-soft px-2.5 normal-case tracking-normal text-highlight">{waiting.length}</span></div>
              <ul className="text-[16px]">
                {(showAllWaiting ? waiting : waiting.slice(0, 5)).map((t) => (
                  <li key={t.id} className="border-t first:border-t-0">
                    <button onClick={() => onOpenTask(t.id)} className="flex w-full items-start gap-2.5 py-2 text-left hover:text-accent">
                      <span className="mt-1 h-4 w-4 shrink-0 rounded ring-2 ring-[var(--border)]" />{t.title}
                    </button>
                  </li>
                ))}
              </ul>
              {waiting.length > 5 && <button onClick={() => setShowAllWaiting((v) => !v)} className="pt-1 font-semibold text-accent">{showAllWaiting ? "Show fewer" : `Show ${waiting.length - 5} more`}</button>}
            </div>
          )}

          {(onWhatsNext || latestRecap) && (
            <div className="rounded-2xl bg-surface p-3.5 ring-1 ring-[var(--border)]">
              <div className={cap}><span aria-hidden>✨</span> What&apos;s next
                {latestRecap && <span className="ml-auto font-medium normal-case tracking-normal">{timeAgo(latestRecap.at)}</span>}
              </div>
              {latestRecap
                ? <CollapsibleText text={latestRecap.body} className="whitespace-pre-wrap text-[16px]" />
                : <p className="m-0 text-[16px] text-muted">Claude reads everything here and says where things stand and what to do next.</p>}
              {onWhatsNext && (
                <button onClick={onWhatsNext} disabled={whatsNextBusy} className="mt-3 rounded-full bg-accent px-4 py-1.5 text-[16px] font-semibold text-white disabled:opacity-50">
                  {whatsNextBusy ? "Thinking…" : latestRecap ? "Update it" : "Ask Claude"}
                </button>
              )}
            </div>
          )}

          {openTasks.length > 0 && (
            <div className="rounded-2xl bg-surface p-3.5 ring-1 ring-[var(--border)]">
              <div className={cap}>Open tasks</div>
              {openTasks.map((t) => (
                <button key={t.id} onClick={() => onOpenTask(t.id)} className="grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2.5 border-t py-2 text-left text-[16px] first:border-t-0 hover:text-accent">
                  <span className="h-3 w-3 rounded-full" style={{ background: STATUS_META[t.status]?.dot ?? "#94a3b8" }} />
                  <span className="truncate">{t.title}</span>
                  {t.due && <span className={isOverdue(t.due) ? "font-semibold text-danger" : "text-muted"}>{formatDue(t.due)}</span>}
                </button>
              ))}
              {onOpenClientTasks && <button onClick={onOpenClientTasks} className="pt-1.5 font-semibold text-accent">All of {firstName}&apos;s tasks</button>}
            </div>
          )}
        </aside>
      </div>
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  );
}
