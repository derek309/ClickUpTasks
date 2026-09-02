"use client";

// The task drawer's communications area — a single merged feed spanning
// Team/Chat/Email/SMS instead of one tab per channel, with type filters,
// search, inline replies, and on-demand compose buttons. Exposed as a hook
// (not a component) because the three drawer layouts (light task, full-page
// split, stacked drawer) genuinely nest this content differently in the DOM
// — feedArea always scrolls with whatever's around it, composerFooter is a
// pinned element that sits OUTSIDE that scroll area — so TaskDrawer places
// the two pieces itself rather than this module dictating layout.
import { useEffect, useRef, useState } from "react";
import {
  users, userById, timeAgo, htmlToText, looksLikeHtml, plainTextToHtml, parseEventDiff, STATUS_META, PRIORITY_META,
  mentionCandidates, applyMention,
  type Task, type Client, type Contact, type Attachment, type MessageChannel, type Message, type Comment,
  TaskAction, TaskActionKind, TASK_ACTION_META, daysUntilDue, formatDue, splitQuotedEmail,
} from "@/lib/data";
import { I, Avatar, CollapsibleText, LinkedText, newId } from "./ui";
import { AttachmentThumbs } from "./AttachmentThumbs";
import { AttachmentTile } from "./AttachmentTile";
import { RichTextEditor } from "./RichTextEditor";
import { SchedulePopover } from "./SchedulePopover";

// Status/priority reuse the field's own STATUS_META/PRIORITY_META token (the
// diff's "to" value is already the rendered label, so match it back against
// the meta table rather than re-deriving from the raw enum) — a status
// change to Done reads green, to Change Requests reads red, same colors
// those values already carry everywhere else in the app. Assignee/due date
// have no natural per-value color, so they get one fixed neutral accent
// each, just enough to tell field types apart at a glance.
function eventAccentColor(diff: { field: string; to: string }): string {
  if (diff.field === "status") return Object.values(STATUS_META).find((m) => m.label === diff.to)?.dot ?? "#94a3b8";
  if (diff.field === "priority") return Object.values(PRIORITY_META).find((m) => m.label === diff.to)?.color ?? "#94a3b8";
  if (diff.field === "assignee") return "#14b8a6";
  if (diff.field === "due date") return "#f59e0b";
  return "#94a3b8";
}
// One inline pill for the new value — folded straight into the event
// line ("Derek updated due date to [Aug 18] · 1d ago") instead of a
// separate two-line boxed card underneath it (Derek: "the due date label
// is not good... make the timestamps cleaner").
function EventValuePill({ diff }: { diff: { field: string; to: string } }) {
  const color = eventAccentColor(diff);
  return (
    <span className="inline-flex items-center rounded-[5px] px-2 py-0.5 text-[15px] font-medium" style={{ background: color + "1a", color }}>{diff.to}</span>
  );
}

// GHL message bodies routinely embed a raw media URL inline in the text
// (e.g. a logo/invoice send is "Location logo [https://storage...png]
// INVOICE FOR BRIAN Hi..."), which used to render as three lines of URL
// ahead of one line of actual content. Pulled out here so any bare URL
// becomes either an image card or a domain chip instead of raw text.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|bmp|heic)(\?[^\s]*)?$/i;

function splitMessageUrls(rawText: string): { cleanText: string; imageUrls: string[]; linkUrls: string[] } {
  const imageUrls: string[] = [];
  const linkUrls: string[] = [];
  const cleanText = rawText
    .replace(URL_RE, (url) => {
      (IMAGE_URL_RE.test(url) ? imageUrls : linkUrls).push(url);
      return "";
    })
    // Gmail (and most clients) build the text/plain half of an HTML email by
    // marking bold as *like this*, so an inbound email arrived reading
    // "*Hi Derek!* *I'm currently updating...*" — the markers are noise, not
    // punctuation (Derek: "the format is broken making it hard to read").
    // Conservative on purpose: the * must hug non-space on both sides, so a
    // "* " bullet at the start of a line survives, and a lone asterisk or a
    // 3 * 4 stays put.
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
  return { cleanText, imageUrls, linkUrls };
}

function urlFilename(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); } catch { return url; }
}
function urlDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// An attachment card for a bare image URL found in a message body — same
// visual language as a real Attachment, but there's no Attachment record
// behind it (it's text GHL embedded, not a file we stored), so this is a
// lighter-weight standalone tile rather than reusing AttachmentTile.
function UrlImageCard({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="group relative block h-16 w-16 overflow-hidden rounded-lg border bg-background" title={urlFilename(url)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={urlFilename(url)} className="h-full w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100">{urlFilename(url)}</span>
    </a>
  );
}
// Any other bare URL in a body → a small chip naming just the domain,
// never the raw link text (acceptance: no raw URL over 40 chars visible).
function UrlLinkChip({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[5px] border bg-background px-2 py-0.5 text-[13px] font-medium text-accent hover:underline">
      <I.link className="h-3 w-3" /> {urlDomain(url)}
    </a>
  );
}

type Channel = "activity" | "chat" | "email" | "sms";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// A chip-style multi-recipient input for email Cc/Bcc — type to search the
// synced contact list by name or email, or type a raw address and hit Enter.
// Stores plain email strings (that's what GHL's emailCc/emailBcc expect).
export function RecipientField({ label, value, onChange, contacts }: { label: string; value: string[]; onChange: (next: string[]) => void; contacts: Contact[] }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matches = ql
    ? contacts.filter((c) => c.email && !value.includes(c.email) && (c.name.toLowerCase().includes(ql) || c.email.toLowerCase().includes(ql))).slice(0, 6)
    : [];
  const add = (email: string) => { const e = email.trim(); if (e && !value.includes(e)) onChange([...value, e]); setQ(""); };
  const remove = (email: string) => onChange(value.filter((x) => x !== email));
  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:border-accent">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        {value.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[13px] text-accent">
            {e}<button onClick={() => remove(e)} title="Remove" className="hover:text-foreground">×</button>
          </span>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && EMAIL_RE.test(q.trim())) { e.preventDefault(); add(q); }
            else if (e.key === "Backspace" && !q && value.length) { remove(value[value.length - 1]); }
          }}
          placeholder={value.length ? "" : "Search contacts or type an email…"}
          className="min-w-[150px] flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted" />
      </div>
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-surface shadow-soft-md">
          {matches.map((c) => (
            <button key={c.id} onClick={() => add(c.email)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-background">
              <span className="truncate text-[14px] font-medium">{c.name}</span>
              <span className="shrink-0 truncate text-[13px] text-muted">{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Rough SMS segment estimate, matching how carriers actually bill: GSM-7
// encoding (plain ASCII + a handful of accented/Greek chars) fits 160 chars
// in one segment or 153 per segment once concatenated across multiple;
// anything outside that set (emoji, curly quotes, etc.) forces UCS-2
// encoding at 70/67 chars instead.
const GSM7_RE = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
const smsSegments = (text: string): { count: number; encoding: string } => {
  if (!text) return { count: 0, encoding: "GSM-7" };
  const isGsm = GSM7_RE.test(text);
  const [single, multi] = isGsm ? [160, 153] : [70, 67];
  return { count: text.length <= single ? 1 : Math.ceil(text.length / multi), encoding: isGsm ? "GSM-7" : "Unicode" };
};
const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

const channelColor: Record<Channel, string> = { activity: "var(--accent)", chat: "#e87722", email: "#3b82f6", sms: "#22c55e" };

export interface TaskMessagingProps {
  task: Task;
  client: Client;
  comment: string; setComment: (v: string) => void;
  onPatch: (patch: Partial<Task>) => void;
  onAddComment: (body: string, attachments?: Attachment[]) => void;
  onUploadCommentImage: (file: File) => Promise<Attachment | null>;
  onDownloadFile: (path: string) => void;
  onDownloadFileAs: (path: string, filename: string) => void;
  onDownloadAll: (items: Attachment[], zipName: string, batchId: string) => void;
  zippingIds: Set<string>;
  attImageUrls: Record<string, string>;
  openPreview: (att: Attachment) => void;
  attachToTask: (att: Attachment) => void;
  messages?: Message[] | null;
  onMarkChannelRead?: (channel: MessageChannel) => void;
  messageDest?: Contact | null;
  ccContacts?: Contact[];
  onUploadMessageImage?: (file: File) => Promise<Attachment | null>;
  onSendTaskMessage?: (channel: MessageChannel, subject: string, body: string, attachments?: Attachment[], cc?: string[], bcc?: string[]) => void;
  onScheduleTaskMessage?: (channel: MessageChannel, subject: string, body: string, scheduledAt: string, attachments?: Attachment[], cc?: string[], bcc?: string[]) => void;
  sendingMessage?: boolean;
  onDraftMessage?: (channel: "email" | "sms" | "chat", prompt?: string) => Promise<{ subject?: string; body: string } | null>;
  draftingMessage?: boolean;
  onGetTaskLink?: () => string | null;
  canAdmin?: boolean;
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, body: string, subject?: string | null) => void;
  onRegenerateAiSummary?: () => void;
  hasMessaging: boolean;
}

// Presentation only, so data.ts stays free of anything that only makes sense
// on screen. Mirrors the dock's own set.
const ACTION_ICON: Record<TaskActionKind, string> = {
  note: "📝", team: "👥", chat: "🗨", email: "✉", sms: "💬", call: "☎", met: "👥", meeting: "📅",
};

// Long action bodies (a summarised meeting, a note someone wrote properly)
// collapse to six lines with a toggle. Short ones render with no affordance
// at all, so the common case stays plain text.
function ActionBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split("\n").length > 6;
  return (
    <div className="mt-0.5">
      <div className={`whitespace-pre-wrap text-[15px] ${!open && long ? "line-clamp-6" : ""}`}><LinkedText text={text} chip /></div>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="mt-0.5 text-[13px] font-medium text-accent hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function useTaskMessaging(p: TaskMessagingProps & { actions?: TaskAction[]; onSetNextStepDone?: (id: string, done: boolean) => void; onDeleteAction?: (id: string) => void; onLogAction?: (a: TaskAction) => void; meId?: string | null; onSendDm?: (memberId: string, body: string) => void; onDeleteComment?: (id: string) => void; onMessageSent?: (channel: "chat" | "email" | "sms", body: string) => void }): { feedArea: React.ReactNode; composerFooter: React.ReactNode; openCompose: (channel: Channel) => void } {
  const { task, client, comment, setComment, onPatch, onAddComment, onUploadCommentImage, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds,
    attImageUrls, openPreview, attachToTask, messages, onMarkChannelRead, messageDest, ccContacts, onUploadMessageImage,
    onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, onGetTaskLink, canAdmin,
    onDeleteMessage, onEditMessage, hasMessaging, actions, onSetNextStepDone, onDeleteAction, onLogAction, meId, onSendDm, onDeleteComment, onMessageSent } = p;

  // C3: was a Set of independently-toggled channels (all four on by default),
  // which is how "the active tab reads Chat while the pane shows an email
  // and field changes" happened — with everything simultaneously "active,"
  // there was no single answer to "which tab is on." One exclusive filter
  // has exactly one right answer at all times.
  const [activeFilter, setActiveFilter] = useState<Channel | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; channel: Channel } | null>(null);
  // Which action entry has its reply box open, and what is typed in it. A
  // reply is a team action of its own, so the whole thread lives in the same
  // log rather than in a parallel comment stream.
  const [replyingAction, setReplyingAction] = useState<string | null>(null);
  const [actionReply, setActionReply] = useState("");
  const [composingChannel, setComposingChannel] = useState<Channel | null>(null);

  // One shared composer-state bundle — reply and fresh-compose are kept
  // mutually exclusive (opening one clears the other) rather than each
  // getting its own bundle, which would only matter for the edge case of
  // replying to an old message while also mid-draft on something fresh.
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [emailFocusNonce, setEmailFocusNonce] = useState(0);
  const [msgCc, setMsgCc] = useState<string[]>([]);
  const [msgBcc, setMsgBcc] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [pendingMsgAtts, setPendingMsgAtts] = useState<Attachment[]>([]);
  const [uploadingMsgAtt, setUploadingMsgAtt] = useState(false);
  // A "Review & send" from a staged draftEmail is a one-off, not the start
  // of a back-and-forth — sending it should close the composer like a reply
  // does, instead of leaving an empty box open that needed a manual Cancel
  // (Derek, 2026-08-24: "it sent but didn't close").

  // The nonce bump is what actually clears the EMAIL body on screen:
  // RichTextEditor takes `value` as boot-time content only and never
  // re-reads it, so setMsgBody("") alone left the just-sent text sitting in
  // the editor (Derek: "after sending an email the field to write an email
  // should clear out but it is not"). Remounting via its `key` is the
  // documented way to reset it — see RichTextEditor's own comment.
  const resetComposer = () => {
    setMsgSubject(""); setMsgBody(""); setPendingMsgAtts([]); setMsgCc([]); setMsgBcc([]); setShowCcBcc(false); setDraftPrompt("");
    setEmailFocusNonce((n) => n + 1);
  };
  const closeComposers = () => { setReplyingTo(null); setComposingChannel(null); resetComposer(); };

  const openReply = (id: string, channel: Channel, subject?: string | null) => {
    setComposingChannel(null);
    resetComposer();
    if (channel === "email") {
      setMsgSubject((subject ?? "").trim() ? (/^re:/i.test((subject ?? "").trim()) ? (subject ?? "").trim() : `Re: ${(subject ?? "").trim()}`) : "");
      setEmailFocusNonce((n) => n + 1);
    }
    onMarkChannelRead?.(channel === "activity" ? "chat" : channel);
    setReplyingTo({ id, channel });
  };
  const openCompose = (channel: Channel) => {
    setReplyingTo(null);
    resetComposer();
    if (channel === "email") setEmailFocusNonce((n) => n + 1);
    if (channel !== "activity") onMarkChannelRead?.(channel);
    setComposingChannel(channel);
  };

  const handleMsgPaste = async (e: React.ClipboardEvent) => {
    if (!onUploadMessageImage) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) images.push(f); }
    }
    if (images.length === 0) return;
    e.preventDefault();
    setUploadingMsgAtt(true);
    for (const f of images) { const att = await onUploadMessageImage(f); if (att) setPendingMsgAtts((a) => [...a, att]); }
    setUploadingMsgAtt(false);
  };
  const handleMsgFileSelect = async (files: FileList | null) => {
    if (!files || !onUploadMessageImage) return;
    setUploadingMsgAtt(true);
    for (const f of Array.from(files)) { const att = await onUploadMessageImage(f); if (att) setPendingMsgAtts((a) => [...a, att]); }
    setUploadingMsgAtt(false);
  };
  const msgFileRef = useRef<HTMLInputElement>(null);

  const activeComposeChannel = replyingTo?.channel ?? composingChannel;
  const hasComposedMessage = activeComposeChannel === "email" ? !!htmlToText(msgBody).trim() : !!msgBody.trim();

  // Sending always closes the composer now (Derek: "after the email is sent,
  // close the box for email"). It used to stay open after a fresh compose so
  // a quick back-and-forth didn't mean re-clicking the CTA button each time,
  // but that CTA row is gone: the dock reopens on "what's next?" the moment a
  // message goes out, so an empty composer left behind it is just a large
  // blank box sitting between you and the feed.
  const submitTaskMessage = () => {
    const channel = activeComposeChannel;
    if (!channel || channel === "activity" || (!hasComposedMessage && pendingMsgAtts.length === 0) || !onSendTaskMessage) return;
    const cc = channel === "email" ? msgCc : undefined;
    const bcc = channel === "email" ? msgBcc : undefined;
    const subject = channel === "email" ? (msgSubject.trim() || task.title) : msgSubject;
    onSendTaskMessage(channel, subject, channel === "email" ? msgBody : msgBody.trim(), pendingMsgAtts.length ? pendingMsgAtts : undefined, cc, bcc);
    // Hands off to the dock, which logs the action and asks what happens
    // next. Sending used to be a dead end: the message went out and nothing
    // scheduled the follow-up, which is exactly how work went quiet.
    onMessageSent?.(channel, htmlToText(msgBody).trim());
    closeComposers();
  };
  const submitScheduledTaskMessage = (whenIso: string) => {
    const channel = activeComposeChannel;
    if (!channel || channel === "activity" || channel === "chat" || (!hasComposedMessage && pendingMsgAtts.length === 0) || !onScheduleTaskMessage) return;
    const cc = channel === "email" ? msgCc : undefined;
    const bcc = channel === "email" ? msgBcc : undefined;
    const subject = channel === "email" ? (msgSubject.trim() || task.title) : msgSubject;
    onScheduleTaskMessage(channel, subject, channel === "email" ? msgBody : msgBody.trim(), whenIso, pendingMsgAtts.length ? pendingMsgAtts : undefined, cc, bcc);
    // Scheduling closes too: the message is committed, there is nothing left
    // in the box worth keeping on screen.
    closeComposers();
  };

  // Admin-only correction for a message that already sent wrong.
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  // C4: Reply/Edit/Delete used to be 3 always-visible buttons crammed into
  // the card header alongside the channel badge, direction label, avatar,
  // and timestamp — broke badly at ~500px. One overflow trigger, keyed per
  // message so only one card's menu is ever open at a time.
  const [openMsgMenuId, setOpenMsgMenuId] = useState<string | null>(null);
  const [openEventGroups, setOpenEventGroups] = useState<Set<string>>(new Set());
  // Which messages have had their quoted thread expanded. Per message rather
  // than one flag, so opening one does not unfold every email in the feed.
  const [openQuotes, setOpenQuotes] = useState<Set<string>>(new Set());
  const toggleQuote = (id: string) => setOpenQuotes((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleEventGroup = (key: string) => setOpenEventGroups((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [editDraft, setEditDraft] = useState("");
  const startEditMessage = (m: Message) => { setEditingMsgId(m.id); setEditDraft(looksLikeHtml(m.body) ? htmlToText(m.body) : m.body); };
  const saveEditMessage = (m: Message) => {
    if (!onEditMessage || !editDraft.trim()) return;
    onEditMessage(m.id, looksLikeHtml(m.body) ? plainTextToHtml(editDraft.trim()) : editDraft.trim(), m.subject);
    setEditingMsgId(null);
  };

  // Claude Code (via the MCP server's draft_email tool) or the in-app AI
  // drafter below both stage an outbound email here for a human to review —
  // never sent automatically. Review loads it into the real composer.
  const openDraftEmail = () => {
    if (!task.draftEmail) return;
    openCompose("email");
    setMsgSubject(task.draftEmail.subject);
    setMsgBody(task.draftEmail.body);
    setEmailFocusNonce((n) => n + 1);
    onPatch({ draftEmail: null });
  };
  // C1: same subject + same body as something already sent to this client
  // is exactly what C0 turned up — a draft staged 11s before it went out via
  // a path that never cleared task.draftEmail, leaving a stale card behind.
  // Catching that here is what would have caught C0 on its own.
  const normalizeEmailText = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim().toLowerCase();
  const draftSentAlready = task.draftEmail ? (messages ?? []).find((m) =>
    m.channel === "email" && m.direction === "outbound" &&
    normalizeEmailText(m.subject ?? "") === normalizeEmailText(task.draftEmail!.subject) &&
    normalizeEmailText(m.body) === normalizeEmailText(task.draftEmail!.body)
  ) ?? null : null;
  // "The thread it continues" — the most recent email either direction, so
  // the card can name and link to what this draft is following up on.
  const latestPriorEmail = task.draftEmail
    ? [...(messages ?? [])].filter((m) => m.channel === "email").sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
    : null;
  const [draftOpen, setDraftOpen] = useState(false);
  // A draft whose subject AND body already went out is spent — it can only
  // cause a duplicate send from here. It used to sit there warning about that
  // forever, which is why Derek found a 2-day-old card still on screen
  // ("taking up a lot of space, not sure why that's there in the first
  // place"). Retire it instead of nagging. Idempotent, so two people with the
  // task open both writing null is harmless.
  useEffect(() => {
    if (task.draftEmail && draftSentAlready) onPatch({ draftEmail: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, !!task.draftEmail, draftSentAlready?.id]);

  // Collapsed to one row by default (Derek, 2026-08-26 — on an iPad the old
  // card stacked heading, subject, two-line preview, thread link and a button
  // row, eating most of a narrow messaging column). Subject and both actions
  // stay on the row; the preview and thread link are one tap away.
  const draftEmailCard = task.draftEmail ? (
    <div className="mb-2 rounded-xl border border-accent/30 bg-accent-soft/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <button onClick={() => setDraftOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={draftOpen ? "Hide the draft" : "Show the draft"}>
          <span aria-hidden>✉️</span>
          <span className="shrink-0 text-[15px] font-semibold text-accent">Draft email</span>
          <span className="min-w-0 flex-1 truncate text-[14px] text-muted">{task.draftEmail.subject || "(no subject)"}</span>
          <I.chevron className={`shrink-0 text-muted transition ${draftOpen ? "-rotate-90" : "rotate-180"}`} />
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          {hasMessaging ? (
            <button onClick={openDraftEmail} className="rounded-md bg-accent px-2.5 py-1.5 text-[13px] font-medium text-white">Review &amp; send</button>
          ) : (
            <span className="text-[13px] text-muted" title="No linked GoHighLevel contact to send to yet">No linked contact</span>
          )}
          <button onClick={() => onPatch({ draftEmail: null })} className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">Discard</button>
        </span>
      </div>
      {draftOpen && (
        <>
          <div className="mt-1.5 whitespace-pre-wrap text-[13px] text-muted">{htmlToText(task.draftEmail.body)}</div>
          {latestPriorEmail && (
            <button onClick={() => selectFilter("email")} className="mt-1 block text-[12px] font-medium text-accent hover:underline">
              Continues the email conversation from {timeAgo(latestPriorEmail.at)} · see thread
            </button>
          )}
        </>
      )}
    </div>
  ) : null;

  // "Prompt Claude" — type an intent, the AI drafter writes the message
  // (subject+body) from that + client context. Never sends. An email draft
  // is also persisted onto task.draftEmail the moment it's generated (the
  // same field the MCP draft_email tool writes to) so it survives a closed
  // drawer instead of only living in this composer's local state.
  const runDraft = async (channel: "email" | "sms") => {
    if (!onDraftMessage || draftingMessage) return;
    const d = await onDraftMessage(channel, draftPrompt.trim() || undefined);
    if (!d) return;
    if (channel === "email") setMsgSubject(d.subject ?? "");
    setMsgBody(channel === "email" ? plainTextToHtml(d.body) : d.body);
    if (channel === "email") {
      setEmailFocusNonce((n) => n + 1);
      onPatch({ draftEmail: { subject: d.subject ?? "", body: plainTextToHtml(d.body), createdAt: new Date().toISOString() } });
    }
  };
  // SMS/Chat's simpler "AI Write" button (Derek, 2026-08-19: type your
  // message, then Send it as-is or hand it to Claude) — no separate prompt
  // field like runDraft's; whatever's already typed in the composer IS the
  // instruction ("tell the client we're waiting on their logo files"), or,
  // typed blank, falls back to the same default "status update" draft.
  const aiWriteInto = async (channel: "sms" | "chat") => {
    if (!onDraftMessage || draftingMessage) return;
    const d = await onDraftMessage(channel, msgBody.trim() || undefined);
    if (!d) return;
    setMsgBody(d.body);
  };
  const promptClaudeBlock = (channel: "email" | "sms") => onDraftMessage ? (
    <div className="mb-2 flex shrink-0 items-start gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/40 p-1.5">
      <span aria-hidden className="pt-1 pl-1 text-[14px]">✨</span>
      <textarea value={draftPrompt} rows={1}
        onChange={(e) => { setDraftPrompt(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
        onKeyDown={(e) => { if (e.key !== "Enter" || e.shiftKey || draftingMessage) return; e.preventDefault(); runDraft(channel); }}
        placeholder="Tell Claude what to say… (Enter to write, Shift+Enter for a new line)"
        className="max-h-[200px] min-w-0 flex-1 resize-none self-center overflow-y-auto bg-transparent px-1 py-1 text-[14px] leading-snug outline-none placeholder:text-muted" />
      <button onClick={() => runDraft(channel)} disabled={draftingMessage}
        title={draftPrompt.trim() ? "Draft this with Claude" : "Draft a status update from recent activity"}
        className="mt-0.5 shrink-0 rounded-md border border-accent/40 bg-surface px-2.5 py-1 text-[14px] font-medium text-accent disabled:opacity-40">
        {draftingMessage ? "Drafting…" : draftPrompt.trim() ? "Write it" : "Status update"}
      </button>
    </div>
  ) : null;

  const fillFromTask = () => {
    const descText = htmlToText(task.description).trim();
    const link = onGetTaskLink?.() ?? null;
    const lines = [descText, link ? `You can view this and reply anytime here: ${link}` : null].filter(Boolean).join("\n\n");
    if (!msgSubject.trim()) setMsgSubject(task.title);
    setMsgBody(plainTextToHtml(lines));
    setEmailFocusNonce((n) => n + 1);
  };

  const msgAttBar = (pendingMsgAtts.length > 0 || uploadingMsgAtt) && (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
      <AttachmentThumbs items={pendingMsgAtts} onRemove={(id) => setPendingMsgAtts((a) => a.filter((x) => x.id !== id))} />
      {uploadingMsgAtt && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
    </div>
  );
  const msgAttachButton = onUploadMessageImage && (
    <button onClick={() => msgFileRef.current?.click()} title="Attach an image" className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"><I.clip /></button>
  );

  // The three real composers, parametrized by context instead of hardcoded
  // per always-visible tab — "reply" pre-fills from the source message and
  // sits inline under it in the feed; "fresh" is a blank composer pinned at
  // the bottom, opened from the CTA row. Same capabilities either way
  // (attachments, Cc/Bcc, scheduling, AI-assist) — replying never loses
  // features versus composing fresh.
  const channelComposer = (channel: "chat" | "sms" | "email", onCancel: () => void) => {
    const color = channelColor[channel];
    if (channel === "sms") return (
      <div className="max-h-[50vh] shrink-0 overflow-y-auto rounded-xl border-t-2 p-3" style={{ borderTopColor: color, background: color + "0d" }}>
        <div className="mb-2 shrink-0 text-[14px] text-muted">Texting: <span className="font-medium text-foreground">{messageDest?.phone || "no phone on file"}</span></div>
        {msgAttBar}
        <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} onPaste={handleMsgPaste} autoFocus
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitTaskMessage(); } }}
          placeholder="Write a message… (⌘↵ to send, paste to attach an image)"
          className="min-h-[100px] w-full resize-none rounded-xl border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[14px] text-muted">{wordCount(msgBody)} word{wordCount(msgBody) === 1 ? "" : "s"} · {smsSegments(msgBody).count} segment{smsSegments(msgBody).count === 1 ? "" : "s"}{smsSegments(msgBody).count > 0 ? ` (${smsSegments(msgBody).encoding})` : ""}</span>
          <span className="flex items-center gap-1.5">
            {msgAttachButton}
            <button onClick={onCancel} className="rounded-lg px-2.5 py-1.5 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>
            {onScheduleTaskMessage && <SchedulePopover disabled={(!hasComposedMessage && pendingMsgAtts.length === 0) || sendingMessage} onSchedule={submitScheduledTaskMessage} />}
            {onDraftMessage && <button onClick={() => aiWriteInto("sms")} disabled={draftingMessage} title="Write it as-typed, or hand what you typed to Claude as instructions" className="rounded-lg border border-accent/40 px-2.5 py-1.5 text-[16px] font-medium text-accent disabled:opacity-40">{draftingMessage ? "Writing…" : "✨ AI Write"}</button>}
            <button onClick={submitTaskMessage} disabled={(!hasComposedMessage && pendingMsgAtts.length === 0) || sendingMessage} className="rounded-lg px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40" style={{ background: color }}>{sendingMessage ? "Sending…" : "Send text"}</button>
          </span>
        </div>
      </div>
    );
    if (channel === "email") return (
      <div className="max-h-[60vh] shrink-0 overflow-y-auto rounded-xl border-t-2 p-3" style={{ borderTopColor: color, background: color + "0d" }}>
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[14px] text-muted">To: <span className="font-medium text-foreground">{messageDest?.email || "no email on file"}</span></span>
          <span className="flex shrink-0 items-center gap-2">
            <button onClick={fillFromTask} title="Fill in this task's title, description, and a client link to view/respond" className="text-[13px] font-medium text-accent hover:underline">Add task details + link</button>
            {!showCcBcc && <button onClick={() => setShowCcBcc(true)} className="text-[13px] font-medium text-accent hover:underline">Cc / Bcc</button>}
          </span>
        </div>
        <div className="mb-2">{promptClaudeBlock("email")}</div>
        {showCcBcc && (
          <div className="mb-2 flex shrink-0 flex-col gap-1.5">
            <RecipientField label="Cc" value={msgCc} onChange={setMsgCc} contacts={ccContacts ?? []} />
            <RecipientField label="Bcc" value={msgBcc} onChange={setMsgBcc} contacts={ccContacts ?? []} />
          </div>
        )}
        <input value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} placeholder="Subject"
          className="mb-2 w-full shrink-0 rounded-lg border bg-background px-3 py-2 text-[16px] font-medium outline-none placeholder:text-muted focus:border-accent" />
        {msgAttBar}
        <div className="min-h-[160px] overflow-auto" onPaste={handleMsgPaste} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitTaskMessage(); } }}>
          <RichTextEditor key={`task-email-${emailFocusNonce}`} value={msgBody} onChange={setMsgBody} placeholder="Write an email… (⌘↵ to send)" autoFocus />
        </div>
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[14px] text-muted">{wordCount(htmlToText(msgBody))} word{wordCount(htmlToText(msgBody)) === 1 ? "" : "s"}</span>
          <span className="flex items-center gap-1.5">
            {msgAttachButton}
            <button onClick={onCancel} className="rounded-lg px-2.5 py-1.5 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>
            {onScheduleTaskMessage && <SchedulePopover disabled={(!hasComposedMessage && pendingMsgAtts.length === 0) || sendingMessage} onSchedule={submitScheduledTaskMessage} />}
            <button onClick={submitTaskMessage} disabled={(!hasComposedMessage && pendingMsgAtts.length === 0) || sendingMessage} className="rounded-lg px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40" style={{ background: color }}>{sendingMessage ? "Sending…" : "Send email"}</button>
          </span>
        </div>
      </div>
    );
    // chat
    return (
      <div className="max-h-[50vh] shrink-0 overflow-y-auto rounded-xl border-t-2 p-3" style={{ borderTopColor: color, background: color + "0d" }}>
        <div className="mb-2 shrink-0 text-[14px] text-muted">Client chat — shows up on {client.name}&apos;s waiting page, no email or text goes out.</div>
        {msgAttBar}
        <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} onPaste={handleMsgPaste} autoFocus
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitTaskMessage(); } }}
          placeholder="Type a message… (⌘↵ to send, paste to attach an image)"
          className="min-h-[100px] w-full resize-none rounded-xl border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[14px] text-muted">{wordCount(msgBody)} word{wordCount(msgBody) === 1 ? "" : "s"}</span>
          <span className="flex items-center gap-1.5">
            {msgAttachButton}
            <button onClick={onCancel} className="rounded-lg px-2.5 py-1.5 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>
            {onDraftMessage && <button onClick={() => aiWriteInto("chat")} disabled={draftingMessage} title="Write it as-typed, or hand what you typed to Claude as instructions" className="rounded-lg border border-accent/40 px-2.5 py-1.5 text-[16px] font-medium text-accent disabled:opacity-40">{draftingMessage ? "Writing…" : "✨ AI Write"}</button>}
            <button onClick={submitTaskMessage} disabled={(!hasComposedMessage && pendingMsgAtts.length === 0) || sendingMessage} className="rounded-lg px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40" style={{ background: color }}>{sendingMessage ? "Sending…" : "Send"}</button>
          </span>
        </div>
      </div>
    );
  };

  // Plain internal team composer — unchanged from before, just relocated.
  const [pendingCommentAtts, setPendingCommentAtts] = useState<Attachment[]>([]);
  const [uploadingCommentAtt, setUploadingCommentAtt] = useState(false);
  const handleCommentPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) images.push(f); }
    }
    if (images.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setUploadingCommentAtt(true);
    for (const f of images) { const att = await onUploadCommentImage(f); if (att) setPendingCommentAtts((a) => [...a, att]); }
    setUploadingCommentAtt(false);
  };
  const submitComment = () => {
    if (!comment.trim() && pendingCommentAtts.length === 0) return;
    onAddComment(comment, pendingCommentAtts.length ? pendingCommentAtts : undefined);
    setComment("");
    setPendingCommentAtts([]);
  };
  const mentionCands = mentionCandidates(comment, users);
  const mentionOpen = mentionCands.length > 0;
  const pickMention = (name: string) => setComment(applyMention(comment, name));
  const teamComposer = (
    // The picker lives OUTSIDE the scrolling box (Derek, 2026-08-26 — "@ is
    // not working"). It was rendering all along, but `bottom-full` puts it
    // above the composer's top edge and the composer is an overflow-y-auto
    // scroll container, which clips in both axes — so the list was drawn and
    // immediately cut off, and there was no way to pick the exact "@Full
    // Name" the notifier looks for. Same shape ClientJournal already used.
    <div className="relative shrink-0">
      {mentionOpen && (
        <div className="absolute bottom-full left-3 z-20 mb-1 w-56 overflow-hidden rounded-lg border bg-surface shadow-lg">
          {mentionCands.map((u) => (
            <button key={u.id} onClick={() => pickMention(u.name)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-background">
              <Avatar id={u.id} size={22} /> <span className="min-w-0 flex-1 truncate">{u.name}</span>{u.role === "va" && <span className="shrink-0 text-[14px] text-muted">VA</span>}
            </button>
          ))}
        </div>
      )}
    <div className="max-h-[50vh] overflow-y-auto rounded-xl border-t-2 p-3" style={{ borderTopColor: channelColor.activity, background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}>
      <div className="mb-2 shrink-0 text-[14px] text-muted">Note — internal only, nobody outside the team sees this.</div>
      {(pendingCommentAtts.length > 0 || uploadingCommentAtt) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <AttachmentThumbs items={pendingCommentAtts} onRemove={(id) => setPendingCommentAtts((a) => a.filter((x) => x.id !== id))} />
          {uploadingCommentAtt && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
        </div>
      )}
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} onPaste={handleCommentPaste} autoFocus
        onKeyDown={(e) => {
          // ⌘↵ always sends, checked first — so mentioning someone as the
          // last thing you type can still be sent without picking.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitComment(); return; }
          if (e.key === "Enter" && !e.shiftKey && mentionOpen) { e.preventDefault(); pickMention(mentionCands[0].name); }
        }}
        placeholder="Write a team message… (type @ to mention a teammate, ⌘↵ to send, paste to attach an image)"
        className="min-h-[100px] w-full resize-none rounded-xl border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[14px] text-muted">{wordCount(comment)} word{wordCount(comment) === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1.5">
          <button onClick={closeComposers} className="rounded-lg px-2.5 py-1.5 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>
          <button onClick={submitComment} disabled={!comment.trim() && pendingCommentAtts.length === 0} className="rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Send</button>
        </span>
      </div>
    </div>
    </div>
  );

  // ---- Merged feed ----
  type FeedItem =
    | { at: string; kind: "comment" | "event"; channel: "activity"; comment: Comment }
    | { at: string; kind: "message"; channel: "chat" | "email" | "sms"; message: Message; dupeCount?: number }
    // An action logged from the dock. It sits in the same timeline as the
    // messages because they are the same story: what happened to this task,
    // in order. Keeping them in two lists forced you to read both and
    // interleave them yourself.
    | { at: string; kind: "action"; channel: "activity"; action: TaskAction };

  // C2: a display-only row shape layered on top of FeedItem — consecutive
  // same-field audit events (three due-date changes in a row) collapse into
  // one summarized row with a disclosure, instead of each occupying the same
  // visual weight as a real client email.
  type DisplayRow = FeedItem | { kind: "event-group"; key: string; field: string; events: Comment[] };
  function groupConsecutiveEvents(items: FeedItem[]): DisplayRow[] {
    const rows: DisplayRow[] = [];
    for (const item of items) {
      if (item.kind === "event") {
        const field = parseEventDiff(item.comment.body)?.field ?? item.comment.body;
        const last = rows[rows.length - 1];
        if (last && last.kind === "event-group" && last.field === field) { last.events.push(item.comment); continue; }
        if (last && "kind" in last && last.kind === "event" && (parseEventDiff(last.comment.body)?.field ?? last.comment.body) === field) {
          rows[rows.length - 1] = { kind: "event-group", key: `eg_${last.comment.id}`, field, events: [last.comment, item.comment] };
          continue;
        }
      }
      rows.push(item);
    }
    return rows;
  }
  // Natural phrasing per field — "Due date moved 3×" reads better than
  // "updated due date to 3×". Falls back to a generic verb for any field
  // that isn't one of the common ones.
  const FIELD_VERB: Record<string, string> = { status: "Status changed", priority: "Priority changed", assignee: "Assignee changed", "due date": "Due date moved" };

  // Two byte-identical sends (a genuine GHL double-send, not just a display
  // quirk — see the item-2 write-up) shouldn't read as two separate
  // messages. Collapses only truly adjacent messages in the sorted feed —
  // a comment or another channel's message in between breaks the run, same
  // as a person scanning the thread would expect. Display-layer only: the
  // underlying duplicate rows are untouched.
  function collapseDuplicateMessages(items: FeedItem[]): FeedItem[] {
    const out: FeedItem[] = [];
    for (const item of items) {
      const prev = out[out.length - 1];
      if (
        item.kind === "message" && prev?.kind === "message" &&
        item.channel === prev.channel && item.message.direction === prev.message.direction &&
        item.message.body.trim() === prev.message.body.trim() &&
        Math.abs(new Date(item.at).getTime() - new Date(prev.at).getTime()) <= 10 * 60 * 1000
      ) {
        prev.dupeCount = (prev.dupeCount ?? 1) + 1;
        continue;
      }
      out.push(item.kind === "message" ? { ...item } : item);
    }
    return out;
  }

  const q = searchQuery.trim().toLowerCase();
  const mergedFeedItems: FeedItem[] = collapseDuplicateMessages([
    ...(activeFilter === "all" || activeFilter === "activity" ? task.comments.map((c) => ({ at: c.at, kind: (c.kind === "event" ? "event" : "comment") as "event" | "comment", channel: "activity" as const, comment: c })) : []),
    ...(messages ?? [])
      .filter((m): m is Message & { channel: "chat" | "email" | "sms" } => m.channel !== "call" && (activeFilter === "all" || activeFilter === m.channel))
      .map((m) => ({ at: m.at, kind: "message" as const, channel: m.channel, message: m })),
    ...(activeFilter === "all" || activeFilter === "activity"
      // Replies are actions too, but they belong under the entry they answer,
      // not loose in the feed at their own timestamp.
      ? (actions ?? []).filter((a) => !a.parentId).map((a) => ({ at: a.at, kind: "action" as const, channel: "activity" as const, action: a }))
      : []),
  ]
    .filter((item) => {
      if (!q) return true;
      if (item.kind === "message") return (item.message.subject ?? "").toLowerCase().includes(q) || htmlToText(item.message.body).toLowerCase().includes(q);
      if (item.kind === "comment") return item.comment.body.toLowerCase().includes(q);
      if (item.kind === "action") return item.action.body.toLowerCase().includes(q) || (item.action.nextStep ?? "").toLowerCase().includes(q);
      return false;
    })
    // Newest first (Derek: "so we don't always have to scroll"). The chat
    // convention of oldest-first only pays off when the composer is pinned to
    // the bottom and you read downward into it; here the feed sits in the
    // document column and the newest thing is what you opened the task for.
    .sort((a, b) => b.at.localeCompare(a.at)));
  const displayRows: DisplayRow[] = groupConsecutiveEvents(mergedFeedItems);

  // C3: "activity" bundles both team notes AND field-change audit events (see
  // mergedFeedItems above) — its filter count has to reflect everything that
  // filter actually reveals, not just the notes, or picking it would show
  // more rows than its own count promised.
  const activityCount = task.comments.length;
  const chatMsgCount = (messages ?? []).filter((m) => m.channel === "chat").length;
  const emailMsgCount = (messages ?? []).filter((m) => m.channel === "email").length;
  const smsMsgCount = (messages ?? []).filter((m) => m.channel === "sms").length;
  const chatUnread = (messages ?? []).some((m) => m.channel === "chat" && m.direction === "inbound" && !m.read);
  const emailUnread = (messages ?? []).some((m) => m.channel === "email" && m.direction === "inbound" && !m.read);
  const smsUnread = (messages ?? []).some((m) => m.channel === "sms" && m.direction === "inbound" && !m.read);
  const totalCount = activityCount + chatMsgCount + emailMsgCount + smsMsgCount;

  const channelMeta: Record<Channel, { label: string; count: number; unread: boolean; icon: React.ReactNode }> = {
    activity: { label: "Activity", count: activityCount, unread: false, icon: <I.comment /> },
    chat: { label: "Chat", count: chatMsgCount, unread: chatUnread, icon: <I.chatBubbles /> },
    email: { label: "Email", count: emailMsgCount, unread: emailUnread, icon: <I.mail /> },
    sms: { label: "SMS", count: smsMsgCount, unread: smsUnread, icon: <I.phone /> },
  };
  const selectFilter = (f: Channel | "all") => {
    setActiveFilter(f);
    if (f !== "activity" && f !== "all") onMarkChannelRead?.(f); // selecting a channel clears its unread dot
  };

  // C3: one exclusive filter — "All" plus only the channels that actually
  // have content, so nothing reads as a tab advertising its own emptiness.
  const filterBar = (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <button onClick={() => selectFilter("all")}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[14px] font-medium ${activeFilter === "all" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>
        All · {totalCount}
      </button>
      {(["activity", "chat", "email", "sms"] as Channel[]).filter((ch) => (ch === "activity" || hasMessaging) && channelMeta[ch].count > 0).map((ch) => {
        const active = activeFilter === ch;
        const color = channelColor[ch];
        return (
          <button key={ch} onClick={() => selectFilter(ch)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[14px] font-medium ${active ? "" : "text-muted hover:text-foreground"}`}
            style={active ? { background: color + "1a", color } : undefined}>
            {channelMeta[ch].icon} {channelMeta[ch].label} · {channelMeta[ch].count}
            {channelMeta[ch].unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />}
          </button>
        );
      })}
      <div className="relative w-full sm:ml-auto sm:w-auto sm:flex-1 sm:min-w-[140px]">
        <I.search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search messages…"
          className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-[14px] outline-none focus:border-accent" />
      </div>
    </div>
  );

  // A reply goes out on the channel it came in on (Derek, 2026-09-01: "I
  // click reply on a chat, it opened an email format"). Chat used to be
  // redirected to email on the grounds that it had no compose surface of its
  // own; it has had one for a while, and channelComposer takes "chat"
  // directly. Answering a chat message with an email, subject line and all,
  // is not a reply to it. "call" genuinely has no compose surface.
  const replyableChannel = (ch: MessageChannel): Channel | undefined =>
    ch === "chat" || ch === "email" || ch === "sms" ? ch : undefined;

  // An action reads as a decision, not a note: what you did, and the
  // commitment it left behind with whether that commitment was kept. The
  // next-step strip is the part that makes the history worth scrolling.
  // A reply lands back in the log as a team action pointing at its parent,
  // and goes out as a DM to whoever is on the other end of the thread — the
  // parent's addressee if you wrote it, otherwise its author. Answering in
  // the drawer should reach the person, not just the record.
  const sendActionReply = (parent: TaskAction) => {
    const text = actionReply.trim();
    if (!text || !onLogAction) return;
    const other = parent.authorId === meId ? (parent.toId ?? null) : (parent.authorId ?? null);
    onLogAction({
      id: newId("ta_"), taskId: task.id, kind: "team", authorId: meId ?? null,
      toId: other, parentId: parent.id, body: text, at: new Date().toISOString(),
      nextStep: null, nextStepDue: null, nextStepDoneAt: null,
    });
    if (other && other !== meId && onSendDm) onSendDm(other, `${text}\n\nRe: ${task.title}`);
    setActionReply("");
    setReplyingAction(null);
  };

  const renderActionItem = (a: TaskAction, gap: string) => {
    const meta = TASK_ACTION_META[a.kind];
    const who = a.authorId ? (userById(a.authorId)?.name ?? "Someone") : "Someone";
    const toName = a.toId ? (userById(a.toId)?.name ?? null) : null;
    const late = a.nextStepDue && !a.nextStepDoneAt && (daysUntilDue(a.nextStepDue) ?? 0) < 0;
    const replies = (actions ?? []).filter((r) => r.parentId === a.id).sort((x, y) => x.at.localeCompare(y.at));
    const replyOpen = replyingAction === a.id;
    return (
      <div key={a.id} className={`group flex gap-3 ${gap}`}>
        <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px]" aria-hidden>{ACTION_ICON[a.kind]}</span>
        {/* Every entry is a white card on the feed's tinted ground (Derek:
            "add a white box around messages so it stands out" — "all of
            them"), so one entry never runs into the next. */}
        <div className="min-w-0 flex-1 rounded-xl border bg-surface px-3 py-2 shadow-soft">
          <span className="text-[15px] font-semibold">{meta.verb}</span>
          {/* Who wrote it and who it was addressed to. "Messaged · Derek Fox"
              recorded that a teammate was messaged and lost which one, which
              is the only part of the entry anyone needs to act on. */}
          <span className="text-[13px] text-muted"> · {who}{toName ? ` → ${toName}` : ""} · {timeAgo(a.at)}</span>
          {onDeleteAction && (
            <button onClick={() => onDeleteAction(a.id)} title="Delete this entry"
              className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-danger group-hover:opacity-100">
              <I.trash className="h-3 w-3" />
            </button>
          )}
          {/* Clamped with a Show more, because a logged meeting can be five
              lines of decisions and there is no reason for it to push every
              other entry off the screen. */}
          {a.body && <ActionBody text={a.body} />}
          {a.nextStep && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-r-lg border-l-[3px] bg-background px-2.5 py-1.5 text-[14px]">
              <span>↳ <b className="font-semibold">{a.nextStep}</b></span>
              {a.nextStepDue && <span className="text-muted">{formatDue(a.nextStepDue)}</span>}
              {a.nextStepDoneAt ? (
                <button onClick={() => onSetNextStepDone?.(a.id, false)} title="Reopen this next step"
                  className="rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-bold text-success">done</button>
              ) : (
                <>
                  {late && <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-bold text-danger">{Math.abs(daysUntilDue(a.nextStepDue!) ?? 0)}d late</span>}
                  <button onClick={() => onSetNextStepDone?.(a.id, true)} className="ml-auto rounded border bg-surface px-2 py-0.5 text-[13px] hover:bg-background">Mark done</button>
                </>
              )}
            </div>
          )}
          {/* The thread. Every entry can be replied to, not just team
              messages: a note or a logged call is just as likely to be the
              thing someone wants to ask about, and the answer belongs on the
              entry rather than as a loose comment further down the feed. */}
          {replies.length > 0 && (
            <div className="mt-2 space-y-2 border-l-2 pl-2.5">
              {replies.map((r) => (
                <div key={r.id} className="group/reply">
                  <span className="text-[13px] font-semibold">{r.authorId ? (userById(r.authorId)?.name ?? "Someone") : "Someone"}</span>
                  <span className="text-[13px] text-muted"> · {timeAgo(r.at)}</span>
                  {onDeleteAction && (
                    <button onClick={() => onDeleteAction(r.id)} title="Delete this reply"
                      className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-danger group-hover/reply:opacity-100">
                      <I.trash className="h-3 w-3" />
                    </button>
                  )}
                  <div className="whitespace-pre-wrap text-[14px] leading-relaxed"><LinkedText text={r.body} chip /></div>
                </div>
              ))}
            </div>
          )}
          {onLogAction && (replyOpen ? (
            <div className="mt-2 flex items-end gap-2">
              <textarea autoFocus value={actionReply} rows={1}
                onChange={(e) => { setActionReply(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setReplyingAction(null); setActionReply(""); return; }
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault(); sendActionReply(a);
                }}
                placeholder="Reply… (Enter to send, Shift+Enter for a new line)"
                className="max-h-[160px] min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border bg-surface px-2 py-1.5 text-[14px] leading-snug outline-none focus:border-accent" />
              <button onClick={() => sendActionReply(a)} disabled={!actionReply.trim()}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[14px] font-medium text-white disabled:opacity-40">Reply</button>
            </div>
          ) : (
            <button onClick={() => { setReplyingAction(a.id); setActionReply(""); }}
              className="mt-1 text-[13px] font-medium text-accent hover:underline">Reply</button>
          ))}
        </div>
      </div>
    );
  };

  const renderMessageItem = (m: Message, gap: string, dupeCount?: number) => {
    const dotColor = m.channel === "email" ? "#3b82f6" : m.channel === "chat" ? "#e87722" : "#22c55e";
    const channelLabel = m.channel === "email" ? "Email" : m.channel === "chat" ? "Chat" : "SMS";
    const isReplyingHere = replyingTo?.id === m.id;
    const rawBodyText = m.body?.trim() ? (looksLikeHtml(m.body) ? htmlToText(m.body) : m.body) : "";
    // The reply chain and the signature block under it are not what anyone
    // opened the task to read: one line of "I edited it. Its ready." was
    // rendering as a screen and a half of quoted history.
    const { visible: ownText, quoted } = splitQuotedEmail(rawBodyText);
    const { cleanText, imageUrls, linkUrls } = splitMessageUrls(ownText || rawBodyText);
    const quotedOpen = openQuotes.has(m.id);
    return (
      <div key={m.id} className={`relative ${gap}`}>
        <div className="relative flex gap-3">
          <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full border-2 border-surface" style={{ background: dotColor }} /></div>
          <div className={`min-w-0 flex-1 rounded-xl border border-l-4 p-3 ${m.direction === "inbound" ? "bg-highlight-soft" : "bg-surface"}`} style={{ borderLeftColor: m.direction === "inbound" ? "var(--highlight)" : "var(--accent)" }}>
            <div className="flex items-center gap-2 text-[14px] text-muted">
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0 font-medium" style={{ background: dotColor + "1a", color: dotColor }}>{channelLabel}</span>
              <span className="font-medium" style={{ color: m.direction === "inbound" ? "var(--highlight)" : "var(--accent)" }}>{m.direction === "inbound" ? "Received" : "Sent"}</span>
              {m.direction === "outbound" && m.createdBy && (
                <span className="inline-flex min-w-0 shrink items-center gap-1 truncate"><Avatar id={m.createdBy} size={14} /> <span className="truncate">{userById(m.createdBy)?.name ?? "Unknown"}</span></span>
              )}
              <span>· {timeAgo(m.at)}</span>
              {dupeCount && dupeCount > 1 && (
                <span className="inline-flex items-center rounded-[5px] bg-background px-1.5 py-0 text-[12px] font-semibold text-muted" title={`Collapsed ${dupeCount} identical sends within 10 minutes`}>sent {dupeCount}×</span>
              )}
              {!m.read && (
                <span className="inline-flex items-center gap-1 rounded-[5px] bg-accent-soft px-1.5 py-0 text-[12px] font-semibold text-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> New
                </span>
              )}
              {editingMsgId !== m.id && (replyableChannel(m.channel) && onSendTaskMessage || (canAdmin && (onEditMessage || onDeleteMessage))) && (
                <span className="relative ml-auto shrink-0">
                  <button onClick={() => setOpenMsgMenuId((id) => (id === m.id ? null : m.id))} title="More" className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"><I.dots /></button>
                  {openMsgMenuId === m.id && (<>
                    <div className="fixed inset-0 z-30" onClick={() => setOpenMsgMenuId(null)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border bg-surface py-1 shadow-lg">
                      {replyableChannel(m.channel) && onSendTaskMessage && (
                        <button onClick={() => { setOpenMsgMenuId(null); openReply(m.id, replyableChannel(m.channel)!, m.subject); }} className="block w-full px-3 py-1.5 text-left text-[13px] font-medium text-accent hover:bg-background">Reply</button>
                      )}
                      {canAdmin && onEditMessage && (
                        <button onClick={() => { setOpenMsgMenuId(null); startEditMessage(m); }} title="This doesn't unsend anything already delivered" className="block w-full px-3 py-1.5 text-left text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">Edit</button>
                      )}
                      {canAdmin && onDeleteMessage && (
                        <button
                          onClick={() => { setOpenMsgMenuId(null); if (window.confirm("Delete this message? This only removes it from ClickUpTasks and the client's waiting page — it does not unsend a real email or text already delivered.")) onDeleteMessage(m.id); }}
                          className="block w-full px-3 py-1.5 text-left text-[13px] font-medium text-muted hover:bg-red-50 hover:text-red-600">Delete</button>
                      )}
                    </div>
                  </>)}
                </span>
              )}
            </div>
            {m.subject && <div className="mt-1 text-[16px] font-medium">{m.subject}</div>}
            {((m.cc && m.cc.length > 0) || (m.bcc && m.bcc.length > 0)) && (
              <div className="mt-0.5 text-[13px] text-muted">
                {m.cc && m.cc.length > 0 && <span>Cc: {m.cc.join(", ")}</span>}
                {m.cc && m.cc.length > 0 && m.bcc && m.bcc.length > 0 && <span> · </span>}
                {m.bcc && m.bcc.length > 0 && <span>Bcc: {m.bcc.join(", ")}</span>}
              </div>
            )}
            {editingMsgId === m.id ? (
              <div className="mt-1.5 space-y-1.5">
                <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={3} autoFocus
                  className="w-full rounded-lg border bg-background px-2.5 py-2 text-[15px] outline-none focus:border-accent" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingMsgId(null)} className="rounded-md px-2.5 py-1 text-[14px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>
                  <button onClick={() => saveEditMessage(m)} disabled={!editDraft.trim()} className="rounded-md bg-accent px-2.5 py-1 text-[14px] font-medium text-white disabled:opacity-40">Save</button>
                </div>
              </div>
            ) : !m.body?.trim() ? (
              // GHL's conversations/{id}/messages response omits the body on a
              // sizeable share of email messages (~1 in 3 as of 2026-08-11),
              // and refresh-messages stores that as "". Saying so beats
              // rendering an empty card that reads like the app lost the
              // message (Derek, 2026-08-11). Our own sends are never empty, so
              // this only ever labels a genuine gap in what GHL handed back.
              <div className="mt-1 text-[15px] italic text-muted">No content synced from GoHighLevel for this message.</div>
            ) : (
              <>
                {/* Inbound gets a longer leash than outbound — it's the
                    client's words, not yours, so a preview worth reading
                    beats a two-line stub. Tightened from 12 lines/900 chars
                    to 6/400 (Derek, 2026-08-26: "make sure if it's long
                    there is a read more so not to take up all the space"):
                    those numbers were set when newlines still collapsed into
                    one block, so "12 lines" was rarely 12 lines on screen.
                    Now that line breaks actually render, the old limit let a
                    single email fill the pane. Outbound stays at 2 — you
                    wrote it, a "Show more" on your own message is noise. */}
                {cleanText && (
                  <CollapsibleText text={cleanText} className="mt-1 text-[16px]"
                    maxLines={m.direction === "inbound" ? 6 : 2}
                    maxChars={m.direction === "inbound" ? 400 : 180} />
                )}
                {quoted && (
                  <>
                    <button onClick={() => toggleQuote(m.id)}
                      className="mt-1 rounded border px-1.5 py-0 text-[13px] leading-5 text-muted hover:bg-background hover:text-foreground"
                      title={quotedOpen ? "Hide the earlier thread" : "Show the earlier thread"}>···</button>
                    {quotedOpen && <div className="mt-1 whitespace-pre-wrap border-l-2 pl-2 text-[14px] text-muted">{quoted}</div>}
                  </>
                )}
                {imageUrls.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {imageUrls.map((url) => <UrlImageCard key={url} url={url} />)}
                  </div>
                )}
                {linkUrls.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {linkUrls.map((url) => <UrlLinkChip key={url} url={url} />)}
                  </div>
                )}
              </>
            )}
            {m.attachments && m.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {/* A client dropping a dozen+ files into one message shouldn't mean
                    downloading them one at a time — zips everything with a path
                    into a single file. Only worth showing past 1 attachment. */}
                {m.attachments.filter((a) => a.path).length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); onDownloadAll(m.attachments, `${task.title || "attachments"} — ${timeAgo(m.at)}`, m.id); }}
                    disabled={zippingIds.has(m.id)}
                    className="mb-0.5 flex w-full items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline disabled:opacity-50">
                    <I.download className="h-3 w-3" /> {zippingIds.has(m.id) ? "Zipping…" : `Download all ${m.attachments.filter((a) => a.path).length}`}
                  </button>
                )}
                {m.attachments.filter((a) => a.kind === "image").length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {m.attachments.filter((a) => a.kind === "image").map((a) => (
                      <AttachmentTile key={a.id} item={a} small url={a.path ? attImageUrls[a.path] : undefined} onOpen={() => openPreview(a)}
                        actions={<>
                          {a.path && <button onClick={(e) => { e.stopPropagation(); onDownloadFileAs(a.path!, a.name); }} title="Download" className="flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.download className="h-2.5 w-2.5" /></button>}
                          <button onClick={(e) => { e.stopPropagation(); attachToTask(a); }} title="Add to task attachments" className="flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.plus className="h-2.5 w-2.5" /></button>
                        </>}
                      />
                    ))}
                  </div>
                )}
                {m.attachments.filter((a) => a.kind !== "image").length > 0 && <AttachmentThumbs items={m.attachments.filter((a) => a.kind !== "image")} onOpen={onDownloadFile} />}
              </div>
            )}
          </div>
        </div>
        {isReplyingHere && <div className="ml-11 mt-2">{channelComposer(replyingTo.channel === "activity" ? "chat" : replyingTo.channel, closeComposers)}</div>}
      </div>
    );
  };

  const renderEventRow = (c: Comment, gap: string) => {
    const u = userById(c.authorId); const diff = parseEventDiff(c.body);
    return (
      <div key={c.id} className={`group relative flex gap-3 ${gap}`}>
        <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full border-2 border-surface" style={{ background: diff ? eventAccentColor(diff) : "var(--muted)" }} /></div>
        <div className="min-w-0 flex-1 pt-1.5 text-[16px] text-muted">
          <span className="font-medium text-foreground">{u?.name}</span>{" "}
          {diff ? <>updated {diff.field} to <EventValuePill diff={diff} /></> : <LinkedText text={c.body} />}
          {" · "}<span className="text-[15px]">{timeAgo(c.at)}</span>
          {onDeleteComment && (
            <button onClick={() => onDeleteComment(c.id)} title="Delete this entry"
              className="ml-1.5 rounded p-0.5 align-middle opacity-0 transition hover:text-danger group-hover:opacity-100">
              <I.trash className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const commentsFeed = (
    <div className="relative">
      {mergedFeedItems.length > 0 && <div className="absolute bottom-2 left-4 top-2 w-px bg-border" />}
      {displayRows.map((item, i) => {
        const gap = i === displayRows.length - 1 ? "" : "pb-3";
        if (item.kind === "message") return renderMessageItem(item.message, gap, item.dupeCount);
        if (item.kind === "action") return renderActionItem(item.action, gap);
        if (item.kind === "event-group") {
          // C2: three consecutive same-field changes collapse into one quiet
          // row — grey, no avatar, no timeline dot — with a disclosure that
          // expands back into the individual changes on demand.
          const last = item.events[item.events.length - 1];
          const lastDiff = parseEventDiff(last.body);
          const open = openEventGroups.has(item.key);
          return (
            <div key={item.key} className={gap}>
              <div className="flex gap-3">
                <div className="w-8 shrink-0" />
                <button onClick={() => toggleEventGroup(item.key)} className="flex min-w-0 flex-1 items-center gap-1.5 pt-1 text-left text-[15px] text-muted hover:text-foreground">
                  <I.chevron className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : "rotate-180"}`} />
                  <span>{FIELD_VERB[item.field] ?? `${item.field} changed`} {item.events.length}×{lastDiff ? <> → <EventValuePill diff={lastDiff} /></> : null} · {timeAgo(last.at)}</span>
                </button>
              </div>
              {open && <div className="mt-1 space-y-1">{item.events.map((c) => renderEventRow(c, ""))}</div>}
            </div>
          );
        }
        if (item.kind === "event") return renderEventRow(item.comment, gap);
        const c = item.comment;
        const u = userById(c.authorId);
        return (
          <div key={c.id} className={`group relative flex gap-3 ${gap}`}>
            <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><Avatar id={c.authorId} size={28} /></div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[15px]">
                <span className="font-medium">{u?.name}</span> <span className="text-[13px] text-muted">· {timeAgo(c.at)}</span>
                {onDeleteComment && (
                  <button onClick={() => onDeleteComment(c.id)} title="Delete this entry"
                    className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-danger group-hover:opacity-100">
                    <I.trash className="h-3 w-3" />
                  </button>
                )}
              </div>
              {c.body && <CollapsibleText text={c.body} className="text-[16px]" />}
              {c.attachments && c.attachments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.attachments.filter((a) => a.path).length > 1 && (
                    <button onClick={(e) => { e.stopPropagation(); onDownloadAll(c.attachments!, `${task.title || "attachments"} — ${timeAgo(c.at)}`, c.id); }}
                      disabled={zippingIds.has(c.id)}
                      className="mb-0.5 flex w-full items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline disabled:opacity-50">
                      <I.download className="h-3 w-3" /> {zippingIds.has(c.id) ? "Zipping…" : `Download all ${c.attachments.filter((a) => a.path).length}`}
                    </button>
                  )}
                  {c.attachments.filter((a) => a.kind === "image").length > 0 && (
                    <div className="grid grid-cols-4 gap-1.5">
                      {c.attachments.filter((a) => a.kind === "image").map((a) => (
                        <AttachmentTile key={a.id} item={a} small url={a.path ? attImageUrls[a.path] : undefined} onOpen={() => openPreview(a)}
                          actions={<>
                            {a.path && <button onClick={(e) => { e.stopPropagation(); onDownloadFileAs(a.path!, a.name); }} title="Download" className="flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.download className="h-2.5 w-2.5" /></button>}
                            <button onClick={(e) => { e.stopPropagation(); attachToTask(a); }} title="Add to task attachments" className="flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white transition hover:bg-black/80"><I.plus className="h-2.5 w-2.5" /></button>
                          </>}
                        />
                      ))}
                    </div>
                  )}
                  {c.attachments.filter((a) => a.kind !== "image").length > 0 && <AttachmentThumbs items={c.attachments.filter((a) => a.kind !== "image")} onOpen={onDownloadFile} />}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {/* C6: a short thread otherwise leaves a few hundred blank px below the
          last entry, which reads as a stuck load rather than a finished
          history. Top-anchored on purpose — bottom-anchoring was tried and
          reverted (short threads looked broken); don't reintroduce it. */}
      {mergedFeedItems.length > 0 && (
        <div className="pt-3 text-center text-[13px] text-muted">Start of your conversation with {client.name}</div>
      )}
      {mergedFeedItems.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-7 text-center text-muted">
          <I.comment />
          <span className="text-[16px]">{(activeFilter !== "all" || q) ? "No messages match these filters" : "No activity yet"}</span>
          <span className="text-[14px]">{(activeFilter !== "all" || q) ? "Try a different filter or search." : "Type @ to mention a teammate, or use a button below to reach out."}</span>
        </div>
      )}
    </div>
  );

  // The Note/Chat/Email/SMS buttons that used to live here are gone: the
  // floating dock offers the same four actions and six more, so the drawer
  // was showing two ways to start the same message a few inches apart
  // (Derek: "there the Note Chat Email SMS buttons and also the floating
  // bar"). The dock opens THIS composer, so nothing was lost with them.
  const ctaRow = null;

  const feedArea = (
    <>
      {filterBar}
      {commentsFeed}
      <input ref={msgFileRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { handleMsgFileSelect(e.target.files); e.target.value = ""; }} />
    </>
  );

  // The footer is always occupied: the active composer while writing,
  // otherwise the compose buttons. Keeping the buttons here rather than at
  // the end of the feed is what makes them always reachable without
  // scrolling a long thread first.
  // C1: a draft is what hasn't happened yet, never a peer of the sent
  // messages in the feed above — it lives here, in the composer region,
  // above whichever composer/CTA row is currently showing.
  const composerFooter = (
    <>
      {draftEmailCard}
      {composingChannel
        ? (composingChannel === "activity" ? teamComposer : channelComposer(composingChannel, closeComposers))
        : ctaRow}
    </>
  );


  // openCompose goes out so the dock can drive this composer rather than
  // shipping a second, poorer one of its own.
  return { feedArea, composerFooter, openCompose };
}
