"use client";

// The "Journal" tab on a client or project — one reverse-chronological feed
// merging team notes (meeting notes, decisions, FYIs — anything worth
// keeping, images pasted right in), completed work, task comments, and
// (client-level only, when a GHL contact is linked) that contact's full
// email/SMS conversation — sent via GHL from right here, received via the
// inbound webhook — so there's no gap and no need to poll GHL for updates.
// Claude (via the MCP server's list_notes/add_note tools) reads and posts to
// the notes side of this too. Every image attached here also shows up in the
// Vault tab. The composer is one segmented control (Note/Email/SMS) instead
// of separate note and message composers, so writing here is a single
// "what kind of entry is this" decision rather than switching views first.
import { useEffect, useRef, useState } from "react";
import {
  users, userById, timeAgo, dayLabel, isCompletionEvent, NOTE_TYPE_META, NOTE_TYPE_ORDER, MANUAL_NOTE_TYPES, noteTypeMeta, htmlToText, looksLikeHtml, plainTextToHtml,
  type ClientNote, type NoteType, type Task, type Comment, type Message, type MessageChannel, type MessageDirection, type Me, type Attachment, type Contact,
} from "@/lib/data";
import { I, Avatar, CollapsibleText, newId } from "./ui";
import { ConfirmModal, type ConfirmSpec } from "./modals";
import { AttachmentThumbs } from "./AttachmentThumbs";
import { RichTextEditor } from "./RichTextEditor";
import { RecipientField } from "./TaskDrawer";

type JournalFilter = "all" | NoteType | "message" | "activity" | "photos" | "links" | "files";

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

export function ClientJournal({ notes, tasks, messages, me, onAdd, onEdit, onDelete, onOpenTask, onOpenMessages, onSendMessage, toContact, ccContacts, sendingMessage, onUploadImage, onOpenFile, canAdmin, canMessage, onToggleCanMessage, onDraftMessage, draftingMessage, onRefreshContact, refreshingContact, onRefreshMessages, refreshingMessages, onWhatsNext, whatsNextBusy, composeIntent }: {
  notes: ClientNote[];
  tasks: Task[]; // already scoped by the caller to the current client/project
  messages?: Message[] | null; // null/undefined = no linked GHL contact at this scope, so no Email/SMS
  me: Me;
  onAdd: (type: NoteType, body: string, attachments?: Attachment[]) => void;
  onEdit: (note: ClientNote, body: string) => void;
  onDelete: (note: ClientNote) => void;
  onOpenTask: (taskId: string) => void;
  onOpenMessages?: () => void; // fires once when a message is first visible, to mark them read
  onSendMessage?: (channel: MessageChannel, subject: string, body: string, cc?: string[], bcc?: string[]) => void;
  toContact?: Contact | null; // the recipient (client's linked GHL contact), shown as the To line
  ccContacts?: Contact[]; // searchable contacts for the email Cc/Bcc pickers
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
  composeIntent?: { mode: "email" | "sms"; nonce: number } | null;
}) {
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [composeMode, setComposeMode] = useState<"note" | "email" | "sms">("note");
  const [draftType, setDraftType] = useState<NoteType>("note");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const msgBodyRef = useRef<HTMLTextAreaElement>(null);
  const draftPromptRef = useRef<HTMLTextAreaElement>(null);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgCc, setMsgCc] = useState<string[]>([]);
  const [msgBcc, setMsgBcc] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  // Forces the email RichTextEditor to remount (see its `key` below) so it
  // re-runs its boot-time autofocus — the msgBodyRef trick below only
  // reaches the SMS textarea, since a TipTap editor isn't a ref-focusable
  // form element.
  const [composeFocusNonce, setComposeFocusNonce] = useState(0);
  // A header Email/SMS button flips the composer into that mode and focuses it.
  useEffect(() => {
    if (composeIntent && onSendMessage) {
      setComposeMode(composeIntent.mode);
      setComposeFocusNonce((n) => n + 1);
      requestAnimationFrame(() => msgBodyRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeIntent?.nonce]);
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

  // Resizable composer sidebar — same drag-to-resize-the-left-edge pattern
  // as TaskDrawer's Activity column, so this tab reads the same way:
  // content (the feed) on the left, an input sidebar on the right.
  const [composerW, setComposerW] = useState(340);
  useEffect(() => { try { const w = parseInt(localStorage.getItem("cut_chatComposerW") ?? "", 10); if (w >= 280 && w <= 560) setComposerW(w); } catch {} }, []);
  const startComposerResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setComposerW(Math.min(560, Math.max(280, window.innerWidth - ev.clientX)));
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try { localStorage.setItem("cut_chatComposerW", String(Math.min(560, Math.max(280, window.innerWidth - ev.clientX)))); } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // One merged, oldest-first feed — notes, messages, task comments, and
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
  const filteredItems = journalItems.filter((it) => {
    const passesType = filter === "all" ? true
      : filter === "message" ? it.kind === "message"
      : filter === "activity" ? (it.kind === "activity" || it.kind === "completion")
      : filter === "photos" ? hasKind(it, ["image"])
      : filter === "links" ? hasKind(it, ["link"])
      : filter === "files" ? hasKind(it, ["pdf", "doc", "sheet"])
      : (it.kind === "note" && it.note.type === filter);
    return passesType && matchesSearch(it);
  });
  // Newest AI recap ("recently done / next up") — pinned as a highlighted
  // card atop the unfiltered feed so the freshest "where does this stand"
  // read is always one glance away. Excluded from the chronological list
  // while pinned so it isn't shown twice; older recaps still flow inline.
  const latestRecap = notes.filter((n) => n.type === "ai_summary").sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const pinnedRecap = latestRecap && filter === "all" && !q ? latestRecap : null;
  const feedRows = buildFeedRows(pinnedRecap ? filteredItems.filter((it) => !(it.kind === "note" && it.note.id === pinnedRecap.id)) : filteredItems);

  const canModify = (n: ClientNote) => me.role === "admin" || n.authorId === me.id;

  // Same @mention pattern as task comments: type @ to search teammates, pick
  // one to insert "@Name ", and onAdd's caller notifies them on send.
  const mentionMatch = /@([\w]*)$/.exec(draft);
  const mentionCands = mentionMatch ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[1].toLowerCase())) : [];

  useEffect(() => { feedEndRef.current?.scrollIntoView({ block: "end" }); }, [journalItems.length]);
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
  // Clicking Reply switches to Email mode and pre-fills "Re: subject" so it
  // threads correctly — no quoted body. GHL sends it as a reply on the same
  // conversation and the recipient's client already shows the prior message
  // via the thread itself, so re-pasting it inline would just be clutter.
  // SMS has no equivalent (it's one continuous thread, no per-message reply
  // concept), so this is email-only.
  // Email and SMS share one msgBody, but email's is real HTML and SMS's is
  // plain — switching between them (via the mode buttons, not the
  // header-triggered composeIntent effect, which always starts fresh)
  // converts in whichever direction is needed so the target composer never
  // shows raw tags (going to sms) or one unformatted line (going to email).
  // Note has its own separate `draft` state, so switching to/from it never
  // touches msgBody at all.
  const switchComposeMode = (mode: "note" | "email" | "sms") => {
    if (mode === "email" && !looksLikeHtml(msgBody)) { setMsgBody((b) => plainTextToHtml(b)); setComposeFocusNonce((n) => n + 1); }
    else if (mode === "sms" && looksLikeHtml(msgBody)) setMsgBody((b) => htmlToText(b));
    setComposeMode(mode);
  };
  const replyToEmail = (m: Message) => {
    setComposeMode("email");
    const subj = m.subject ?? "";
    setMsgSubject(/^re:/i.test(subj) ? subj : `Re: ${subj}`.trim());
    setMsgBody("");
    setComposeFocusNonce((n) => n + 1);
    requestAnimationFrame(() => msgBodyRef.current?.focus());
  };
  // Email's msgBody is real HTML (RichTextEditor) — "is there anything to
  // send" has to look past empty tags (TipTap's empty doc is "<p></p>",
  // which .trim() alone doesn't catch), same reasoning behind htmlToText's
  // other callers.
  const hasComposedBody = composeMode === "email" ? !!htmlToText(msgBody).trim() : !!msgBody.trim();
  const submitMessage = () => {
    if (!hasComposedBody || !onSendMessage || (composeMode !== "email" && composeMode !== "sms")) return;
    // Cc/Bcc ride along only on email; SMS ignores them.
    const cc = composeMode === "email" ? msgCc : undefined;
    const bcc = composeMode === "email" ? msgBcc : undefined;
    onSendMessage(composeMode, msgSubject, composeMode === "email" ? msgBody : msgBody.trim(), cc, bcc);
    setMsgSubject(""); setMsgBody(""); setMsgCc([]); setMsgBcc([]); setShowCcBcc(false);
    setComposeFocusNonce((n) => n + 1); // fresh empty editor, not the just-sent one lingering
  };
  // "Prompt Claude" draft. On success it fills the email/SMS and clears the
  // prompt box (also collapsing the auto-grown textarea back to one line).
  const runDraft = async () => {
    if (!onDraftMessage || (composeMode !== "email" && composeMode !== "sms")) return;
    const d = await onDraftMessage(composeMode, draftPrompt.trim() || undefined);
    if (d) {
      if (composeMode === "email") setMsgSubject(d.subject ?? "");
      // The AI drafter only ever returns plain text — give the email editor
      // real paragraphs instead of one run-on line with literal \n's in it.
      setMsgBody(composeMode === "email" ? plainTextToHtml(d.body) : d.body);
      setComposeFocusNonce((n) => n + 1); // remount so the new content actually shows (same editor instance won't re-read `value` after its own onUpdate loop)
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-surface px-4 py-2 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setFilter("all")} className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${filter === "all" ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-background"}`}>All</button>
          {NOTE_TYPE_ORDER.map((t) => {
            const m = NOTE_TYPE_META[t];
            const on = filter === t;
            return (
              <button key={t} onClick={() => setFilter(t)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${on ? "text-white" : "border-transparent text-muted hover:bg-background"}`} style={on ? { background: m.color, borderColor: m.color } : {}}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "#fff" : m.color }} /> {m.label}
              </button>
            );
          })}
          {messages != null && (
            <button onClick={() => setFilter("message")} className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${filter === "message" ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-background"}`}>Message</button>
          )}
          <button onClick={() => setFilter("activity")} className={`rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${filter === "activity" ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-background"}`}>Task Activity</button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button onClick={() => setFilter("photos")} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${filter === "photos" ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-background"}`}>Photos</button>
          <button onClick={() => setFilter("links")} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${filter === "links" ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-background"}`}><I.link /> Links</button>
          <button onClick={() => setFilter("files")} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-medium transition ${filter === "files" ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-background"}`}><I.clip /> Files</button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <I.search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search…"
              className="w-32 rounded-md border bg-background py-1.5 pl-7 pr-2 text-[13px] outline-none placeholder:text-muted focus:w-48 focus:border-accent sm:w-40 sm:focus:w-56" />
          </div>
          {onWhatsNext && (
            <button onClick={onWhatsNext} disabled={whatsNextBusy}
              title="Generate an up-to-date 'recently done / next up' recap for this client"
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-50">
              <span aria-hidden>✨</span> {whatsNextBusy ? "Thinking…" : "What's next"}
            </button>
          )}
          {onRefreshMessages && messages != null && (
            <button onClick={onRefreshMessages} disabled={refreshingMessages} title="Pull any GoHighLevel emails/texts our webhook missed"
              className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground disabled:opacity-40">
              <I.repeat className={refreshingMessages ? "animate-spin" : ""} />
            </button>
          )}
          {canAdmin && onRefreshContact && (
            <button onClick={onRefreshContact} disabled={refreshingContact} title="Re-pull this contact's info from GoHighLevel"
              className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground disabled:opacity-40">
              <I.user className={refreshingContact ? "animate-pulse" : ""} />
            </button>
          )}
          {canAdmin && messages != null && onToggleCanMessage && (
            <div className="relative">
              <button onClick={() => setPermPopoverOpen((o) => !o)} title="Who can message this client" className="rounded-md border bg-background p-1.5 text-muted hover:text-foreground"><I.bolt /></button>
              {permPopoverOpen && (<>
                <div className="fixed inset-0 z-30" onClick={() => setPermPopoverOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border bg-surface p-3 shadow-xl">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Can send email/SMS</div>
                  <div className="grid grid-cols-2 gap-0.5">
                    {users.filter((u) => u.role === "va").map((u) => {
                      const on = (canMessage ?? []).includes(u.id);
                      return (
                        <button key={u.id} onClick={() => onToggleCanMessage(u.id)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on && <I.check />}</span>
                          <Avatar id={u.id} size={18} /> <span className="truncate text-[13px]">{u.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 text-[13px] text-muted">Admins can always send.</div>
                </div>
              </>)}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mx-auto max-w-3xl space-y-3">
            {pinnedRecap && (
              <div className="rounded-xl border border-accent/40 bg-accent-soft/40 p-3.5 shadow-soft">
                <div className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-accent">
                  <span aria-hidden>✨</span> What&apos;s next
                  <span className="ml-auto font-normal text-muted">Updated {timeAgo(pinnedRecap.at)}{userById(pinnedRecap.authorId)?.name ? ` · ${userById(pinnedRecap.authorId)!.name}` : ""}</span>
                </div>
                <CollapsibleText text={pinnedRecap.body} className="whitespace-pre-wrap text-[15px] leading-relaxed" />
              </div>
            )}
            {filteredItems.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.comment /></span>
                {q ? (<>
                  <span className="text-[15px] font-medium">No results for &quot;{searchQuery.trim()}&quot;</span>
                  <span className="max-w-[260px] text-[13px] leading-relaxed">Try a different search, or clear it to see everything.</span>
                </>) : (<>
                  <span className="text-[15px] font-medium">Nothing here yet</span>
                  <span className="max-w-[260px] text-[13px] leading-relaxed">Notes, emails, texts, and completed work show up here as they happen — for the team and for Claude.</span>
                </>)}
              </div>
            )}
            {feedRows.map((row) => {
              if (row.kind === "divider") {
                return (
                  <div key={row.key} className="sticky top-0 z-[5] flex items-center justify-center py-1">
                    <span className="rounded-full border bg-background px-3 py-0.5 text-[12px] font-medium text-muted shadow-soft">{row.label}</span>
                  </div>
                );
              }
              if (row.kind === "note") {
                const n = row.note;
                const u = userById(n.authorId);
                const m = noteTypeMeta(n.type);
                return (
                  <div key={n.id} className="group/note flex gap-2.5 rounded-xl border bg-surface p-3 shadow-soft">
                    <Avatar id={n.authorId} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[14px]">
                        <span className="font-medium">{u?.name ?? "Unknown"}</span>
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0 text-[12px] font-medium" style={{ background: m.color + "1a", color: m.color }}>{m.label}</span>
                        <span className="text-[12px] text-muted">· {timeAgo(n.at)}</span>
                        {canModify(n) && (
                          <span className="ml-auto flex items-center gap-1 opacity-0 group-hover/note:opacity-100">
                            <button onClick={() => startEdit(n)} title="Edit" className="rounded p-0.5 text-muted hover:bg-background hover:text-foreground"><I.pencil /></button>
                            <button onClick={() => askDelete(n)} title="Delete" className="rounded p-0.5 text-muted hover:bg-background hover:text-danger"><I.trash /></button>
                          </span>
                        )}
                      </div>
                      {editingId === n.id ? (
                        <div className="mt-1.5">
                          <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} autoFocus
                            className="w-full resize-none rounded-lg border bg-background px-2 py-1.5 text-[15px] outline-none focus:border-accent" />
                          <div className="mt-1.5 flex gap-2">
                            <button onClick={() => saveEdit(n)} className="rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-white">Save</button>
                            <button onClick={() => setEditingId(null)} className="rounded-md px-2.5 py-1 text-[13px] text-muted hover:bg-background">Cancel</button>
                          </div>
                        </div>
                      ) : (<>
                        {n.body && <CollapsibleText text={n.body} className="mt-1 whitespace-pre-wrap text-[15px]" />}
                        {n.attachments && n.attachments.length > 0 && (
                          <div className="mt-1.5"><AttachmentThumbs items={n.attachments} onOpen={onOpenFile} /></div>
                        )}
                      </>)}
                    </div>
                  </div>
                );
              }
              if (row.kind === "message-group") {
                const channelColor = row.channel === "email" ? "#3b82f6" : "#22c55e";
                return (
                  // Solid bg-surface for both directions — a translucent
                  // accent tint on outbound (bg-accent-soft/30) let the page
                  // background show through and read as washed-out; the
                  // Sent/Received label already carries that distinction.
                  <div key={row.key} className="flex gap-2.5 rounded-xl border bg-surface p-3 shadow-soft">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white" style={{ background: channelColor }}><I.bolt /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] text-muted">
                        <span className="font-medium" style={{ color: channelColor }}>{row.channel === "email" ? "Email" : "SMS"}</span>
                        <span>{row.direction === "inbound" ? "Received" : "Sent"}</span>
                      </div>
                      <div className="mt-1.5 space-y-2.5">
                        {row.messages.map((m) => (
                          <div key={m.id} className={row.messages.length > 1 ? "border-t pt-2 first:border-t-0 first:pt-0" : ""}>
                            {m.subject && <div className="text-[15px] font-medium">{m.subject}</div>}
                            {/* Email sent through the rich-text composer stores real HTML
                                (always starts with a tag — see looksLikeHtml); everything
                                else (SMS, and any email predating that composer) is plain
                                text through the usual collapsible/autolink treatment. */}
                            {looksLikeHtml(m.body)
                              ? <div className="rte-content mt-0.5 text-[15px]" dangerouslySetInnerHTML={{ __html: m.body }} />
                              : <CollapsibleText text={m.body} className="mt-0.5 whitespace-pre-wrap text-[15px]" />}
                            {m.attachments && m.attachments.length > 0 && (
                              <div className="mt-1.5"><AttachmentThumbs items={m.attachments} onOpen={onOpenFile} /></div>
                            )}
                            <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
                              <span>{timeAgo(m.at)}</span>
                              {m.direction === "outbound" && m.createdBy && (
                                <span className="inline-flex items-center gap-1"><Avatar id={m.createdBy} size={14} /> {userById(m.createdBy)?.name ?? "Unknown"}</span>
                              )}
                              {unreadAtOpen.has(m.id) && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0 text-[11px] font-semibold text-accent">
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> New
                                </span>
                              )}
                              {m.channel === "email" && onSendMessage && (
                                <button onClick={() => replyToEmail(m)} className="ml-auto shrink-0 rounded-md border border-accent/30 px-2 py-0.5 text-[12px] font-medium text-accent hover:bg-accent-soft">Reply</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }
              if (row.kind === "completion") {
                const c = row.comment;
                return (
                  <button key={c.id} onClick={() => onOpenTask(c.taskId)} className="flex w-full items-center gap-2.5 rounded-xl border bg-success-soft p-3 text-left shadow-soft hover:opacity-90">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white"><I.check /></span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-success">{c.taskTitle}</span>
                    <span className="shrink-0 text-[12px] text-muted">Completed · {timeAgo(c.at)}</span>
                  </button>
                );
              }
              // activity — a real comment left on one of this scope's tasks
              const c = row.comment;
              const u = userById(c.authorId);
              return (
                <button key={c.id} onClick={() => onOpenTask(c.taskId)} className="flex w-full gap-2.5 rounded-xl border bg-surface p-3 text-left shadow-soft hover:border-accent">
                  <Avatar id={c.authorId} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[14px]">
                      <span className="font-medium">{u?.name ?? "Unknown"}</span>
                      <span className="text-[12px] text-muted">· {timeAgo(c.at)}</span>
                      <span className="ml-auto min-w-0 truncate text-[13px] text-muted">{c.taskTitle}</span>
                    </div>
                    {c.body && <CollapsibleText text={c.body} className="mt-1 whitespace-pre-wrap text-[15px]" />}
                    {c.attachments && c.attachments.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[13px] text-muted"><I.clip /> {c.attachments.length} attachment{c.attachments.length === 1 ? "" : "s"}</div>
                    )}
                  </div>
                </button>
              );
            })}
            <div ref={feedEndRef} />
          </div>
        </div>
        {filteredItems.length > 0 && (
          <button onClick={() => feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })} title="Scroll to latest"
            className="absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-surface text-muted shadow-soft-md hover:text-foreground">
            <I.chevron className="-rotate-90" />
          </button>
        )}
        </div>

        {/* Full-width and stacked under the feed on mobile; fixed, resizable
            side column at md+. The inline width rides a CSS var so a Tailwind
            responsive class can override it below md (inline styles otherwise
            always win). */}
        <div className="relative flex w-full flex-col border-t bg-surface md:w-[var(--composer-w)] md:shrink-0 md:border-l md:border-t-0"
          style={{ "--composer-w": `${composerW}px` } as React.CSSProperties}>
          <div onMouseDown={startComposerResize} title="Drag to resize"
            className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent/30 active:bg-accent/40 md:block" />
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="text-[13px] font-semibold text-muted">Write</span>
            {onSendMessage && (
              <div className="inline-flex overflow-hidden rounded-md border">
                <button onClick={() => switchComposeMode("note")} className={`px-2 py-1 text-[12px] font-medium ${composeMode === "note" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Note</button>
                <button onClick={() => switchComposeMode("email")} className={`px-2 py-1 text-[12px] font-medium ${composeMode === "email" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Email</button>
                <button onClick={() => switchComposeMode("sms")} className={`px-2 py-1 text-[12px] font-medium ${composeMode === "sms" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>SMS</button>
              </div>
            )}
          </div>
          {composeMode === "note" ? (
            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) handleNoteFiles(e.dataTransfer.files); }}
              className="flex min-h-0 flex-1 flex-col p-3">
              <select value={draftType} onChange={(e) => setDraftType(e.target.value as NoteType)}
                className="mb-2 shrink-0 rounded-md border bg-background px-1.5 py-1.5 text-[13px] outline-none">
                {MANUAL_NOTE_TYPES.map((t) => (<option key={t} value={t}>{NOTE_TYPE_META[t].label}</option>))}
              </select>
              {(pendingAtts.length > 0 || uploadingAtt) && (
                <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
                  <AttachmentThumbs items={pendingAtts} onRemove={(id) => setPendingAtts((a) => a.filter((x) => x.id !== id))} />
                  {uploadingAtt && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
                </div>
              )}
              <div className="relative min-h-0 flex-1">
                {mentionMatch && mentionCands.length > 0 && (
                  <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-lg border bg-surface shadow-lg">
                    {mentionCands.map((u) => (
                      <button key={u.id} onClick={() => setDraft(draft.replace(/@([\w]*)$/, `@${u.name} `))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[15px] hover:bg-background">
                        <Avatar id={u.id} size={22} /> <span className="min-w-0 flex-1 truncate">{u.name}</span>{u.role === "va" && <span className="shrink-0 text-[13px] text-muted">VA</span>}
                      </button>
                    ))}
                  </div>
                )}
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onPaste={handlePaste}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(mentionMatch && mentionCands.length)) { e.preventDefault(); submit(); } }}
                  placeholder="Message the team… (Enter to send, Shift+Enter for a new line, type @ to mention, paste or drop a file to attach). Or add just a link below."
                  className="h-full min-h-[160px] w-full resize-none rounded-xl border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
              </div>
              {linkOpen && (
                <div className="mt-2 flex shrink-0 flex-col gap-1.5 rounded-lg border bg-background p-2">
                  <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } if (e.key === "Escape") setLinkOpen(false); }} placeholder="Paste a link (Google Doc, Drive, any URL)…" className="rounded-md border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent" />
                  <div className="flex items-center gap-1.5">
                    <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} placeholder="Label (optional)" className="min-w-0 flex-1 rounded-md border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent" />
                    <button onClick={addLink} className="shrink-0 rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[13px] font-medium text-white">Add</button>
                    <button onClick={() => { setLinkOpen(false); setLinkUrl(""); setLinkLabel(""); }} className="shrink-0 rounded-md border px-2.5 py-1.5 text-[13px] text-muted hover:text-foreground">Cancel</button>
                  </div>
                </div>
              )}
              <div className="mt-2 flex shrink-0 items-center gap-1.5">
                <button onClick={() => noteFileRef.current?.click()} title="Attach a file (image, PDF, doc)" className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[13px] text-muted hover:bg-background hover:text-foreground"><I.clip /> Attach</button>
                <button onClick={() => setLinkOpen((o) => !o)} title="Add a link" className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[13px] ${linkOpen ? "border-accent text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}><I.link /> Link</button>
                <input ref={noteFileRef} type="file" multiple className="hidden" onChange={(e) => { handleNoteFiles(e.target.files); e.target.value = ""; }} />
                <button onClick={submit} disabled={!draft.trim() && pendingAtts.length === 0}
                  className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Send</button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              {/* Recipient (the client's linked GHL contact) — read-only, so
                  it's clear who the email/SMS is going to before you send. */}
              <div className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-[13px]">
                <span className="shrink-0 font-medium uppercase tracking-wide text-muted">To</span>
                {(() => {
                  const target = composeMode === "sms" ? toContact?.phone : toContact?.email;
                  return target
                    ? <span className="min-w-0 flex-1 truncate text-foreground">{toContact?.name ? `${toContact.name} · ` : ""}{target}</span>
                    : <span className="min-w-0 flex-1 truncate text-muted">{composeMode === "sms" ? "No phone number on file for this client" : "No linked contact email for this client"}</span>;
                })()}
              </div>
              {onDraftMessage && (
                <div className="mb-2 flex shrink-0 items-start gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/40 p-1.5">
                  <span aria-hidden className="pt-1 pl-1 text-[13px]">✨</span>
                  <textarea ref={draftPromptRef} value={draftPrompt} rows={1}
                    onChange={(e) => { setDraftPrompt(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey || draftingMessage || (composeMode !== "email" && composeMode !== "sms")) return;
                      e.preventDefault();
                      runDraft();
                    }}
                    placeholder="Tell Claude what to say… (Enter to write, Shift+Enter for a new line)"
                    className="max-h-[200px] min-w-0 flex-1 resize-none self-center overflow-y-auto bg-transparent px-1 py-1 text-[13px] leading-snug outline-none placeholder:text-muted" />
                  <button onClick={runDraft}
                    disabled={draftingMessage} title={draftPrompt.trim() ? "Draft this with Claude" : "Draft a status update from recent activity — review before sending"}
                    className="mt-0.5 shrink-0 rounded-md border border-accent/40 bg-surface px-2.5 py-1 text-[13px] font-medium text-accent disabled:opacity-40">
                    {draftingMessage ? "Drafting…" : draftPrompt.trim() ? "Write it" : "Status update"}
                  </button>
                </div>
              )}
              {composeMode === "email" && (<>
                <div className="mb-2 flex shrink-0 items-center gap-2">
                  <input value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} placeholder="Subject"
                    className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-1.5 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
                  {!showCcBcc && <button onClick={() => setShowCcBcc(true)} className="shrink-0 text-[12px] font-medium text-accent hover:underline">Cc / Bcc</button>}
                </div>
                {showCcBcc && (
                  <div className="mb-2 flex shrink-0 flex-col gap-1.5">
                    <RecipientField label="Cc" value={msgCc} onChange={setMsgCc} contacts={ccContacts ?? []} />
                    <RecipientField label="Bcc" value={msgBcc} onChange={setMsgBcc} contacts={ccContacts ?? []} />
                  </div>
                )}
              </>)}
              {/* Email gets the same rich-text editor task descriptions use
                  (RichTextEditor already supplies its own bordered chrome
                  and toolbar) — SMS stays plain text, since a text message
                  can't render formatting anyway. Both live under one ⌘↵-to-
                  send capture: contentEditable keydowns bubble like any DOM
                  event, so this needs no wiring inside RichTextEditor itself. */}
              <div className="relative min-h-[160px] flex-1 overflow-auto"
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitMessage(); } }}>
                {composeMode === "email" ? (
                  <RichTextEditor key={`email-compose-${composeFocusNonce}`} value={msgBody} onChange={setMsgBody} placeholder="Write an email… (⌘↵ to send)" autoFocus />
                ) : (
                  <textarea ref={msgBodyRef} value={msgBody} onChange={(e) => setMsgBody(e.target.value)}
                    placeholder="Write a text… (⌘↵ to send, Enter for a new line)"
                    className="h-full min-h-[160px] w-full resize-none rounded-xl border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
                )}
              </div>
              <div className="mt-2 flex shrink-0 items-center gap-2">
                <button onClick={submitMessage} disabled={!hasComposedBody || sendingMessage}
                  className="ml-auto shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{sendingMessage ? "Sending…" : "Send"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  );
}
