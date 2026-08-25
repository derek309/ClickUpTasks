"use client";

// The task drawer's communications area — a single merged feed spanning
// Team/Chat/Email/SMS instead of one tab per channel, with type filters,
// search, inline replies, and on-demand compose buttons. Exposed as a hook
// (not a component) because the three drawer layouts (light task, full-page
// split, stacked drawer) genuinely nest this content differently in the DOM
// — feedArea always scrolls with whatever's around it, composerFooter is a
// pinned element that sits OUTSIDE that scroll area — so TaskDrawer places
// the two pieces itself rather than this module dictating layout.
import { useRef, useState } from "react";
import {
  users, userById, timeAgo, htmlToText, looksLikeHtml, plainTextToHtml, parseEventDiff, STATUS_META, PRIORITY_META,
  type Task, type Client, type Contact, type Attachment, type MessageChannel, type Message, type Comment,
} from "@/lib/data";
import { I, Avatar, CollapsibleText } from "./ui";
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
  aiSummaryBusy?: boolean;
  hasMessaging: boolean;
}

export function useTaskMessaging(p: TaskMessagingProps): { feedArea: React.ReactNode; composerFooter: React.ReactNode } {
  const { task, client, comment, setComment, onPatch, onAddComment, onUploadCommentImage, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds,
    attImageUrls, openPreview, attachToTask, messages, onMarkChannelRead, messageDest, ccContacts, onUploadMessageImage,
    onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, onGetTaskLink, canAdmin,
    onDeleteMessage, onEditMessage, onRegenerateAiSummary, aiSummaryBusy, hasMessaging } = p;

  const [visibleChannels, setVisibleChannels] = useState<Set<Channel>>(new Set(["activity", "chat", "email", "sms"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; channel: Channel } | null>(null);
  const [composingChannel, setComposingChannel] = useState<Channel | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

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
  const [isDraftReviewCompose, setIsDraftReviewCompose] = useState(false);

  const resetComposer = () => {
    setMsgSubject(""); setMsgBody(""); setPendingMsgAtts([]); setMsgCc([]); setMsgBcc([]); setShowCcBcc(false); setDraftPrompt("");
  };
  const closeComposers = () => { setReplyingTo(null); setComposingChannel(null); setIsDraftReviewCompose(false); resetComposer(); };

  const openReply = (id: string, channel: Channel, subject?: string | null) => {
    setComposingChannel(null);
    setIsDraftReviewCompose(false);
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
    setIsDraftReviewCompose(false);
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

  // A reply closes back to the feed after sending (it was answering one
  // specific message). A fresh CTA-triggered compose instead just clears
  // itself and stays open, same as the old pinned composer did — so a quick
  // back-and-forth doesn't mean re-clicking the CTA button every message.
  const submitTaskMessage = () => {
    const channel = activeComposeChannel;
    if (!channel || channel === "activity" || (!hasComposedMessage && pendingMsgAtts.length === 0) || !onSendTaskMessage) return;
    const cc = channel === "email" ? msgCc : undefined;
    const bcc = channel === "email" ? msgBcc : undefined;
    const subject = channel === "email" ? (msgSubject.trim() || task.title) : msgSubject;
    onSendTaskMessage(channel, subject, channel === "email" ? msgBody : msgBody.trim(), pendingMsgAtts.length ? pendingMsgAtts : undefined, cc, bcc);
    if (replyingTo || isDraftReviewCompose) closeComposers(); else resetComposer();
  };
  const submitScheduledTaskMessage = (whenIso: string) => {
    const channel = activeComposeChannel;
    if (!channel || channel === "activity" || channel === "chat" || (!hasComposedMessage && pendingMsgAtts.length === 0) || !onScheduleTaskMessage) return;
    const cc = channel === "email" ? msgCc : undefined;
    const bcc = channel === "email" ? msgBcc : undefined;
    const subject = channel === "email" ? (msgSubject.trim() || task.title) : msgSubject;
    onScheduleTaskMessage(channel, subject, channel === "email" ? msgBody : msgBody.trim(), whenIso, pendingMsgAtts.length ? pendingMsgAtts : undefined, cc, bcc);
    if (replyingTo || isDraftReviewCompose) closeComposers(); else resetComposer();
  };

  // Admin-only correction for a message that already sent wrong.
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
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
    setIsDraftReviewCompose(true);
    setMsgSubject(task.draftEmail.subject);
    setMsgBody(task.draftEmail.body);
    setEmailFocusNonce((n) => n + 1);
    onPatch({ draftEmail: null });
  };
  const draftEmailCard = task.draftEmail ? (
    <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft/20 p-4">
      <div className="mb-1 flex items-center gap-1.5 text-[16px] font-semibold text-accent"><span aria-hidden>✉️</span> Draft email ready</div>
      <div className="truncate text-[15px] font-medium">{task.draftEmail.subject || "(no subject)"}</div>
      <div className="mt-0.5 line-clamp-2 text-[14px] text-muted">{htmlToText(task.draftEmail.body)}</div>
      <div className="mt-2 flex items-center gap-2">
        {hasMessaging ? (
          <button onClick={openDraftEmail} className="rounded-md bg-accent px-2.5 py-1.5 text-[14px] font-medium text-white">Review &amp; send</button>
        ) : (
          <span className="text-[13px] text-muted" title="No linked GoHighLevel contact to send to yet">Can&apos;t send — no linked contact for this client</span>
        )}
        <button onClick={() => onPatch({ draftEmail: null })} className="rounded-md px-2.5 py-1.5 text-[14px] font-medium text-muted hover:bg-background hover:text-foreground">Discard</button>
      </div>
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
  const mentionMatch = /@([\w]*)$/.exec(comment);
  const mentionCands = mentionMatch ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[1].toLowerCase())) : [];
  const teamComposer = (
    <div className="relative max-h-[50vh] shrink-0 overflow-y-auto rounded-xl border-t-2 p-3" style={{ borderTopColor: channelColor.activity, background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}>
      {mentionMatch && mentionCands.length > 0 && (
        <div className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-lg border bg-surface shadow-lg">
          {mentionCands.map((u) => (
            <button key={u.id} onClick={() => setComment(comment.replace(/@([\w]*)$/, `@${u.name} `))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-background">
              <Avatar id={u.id} size={22} /> <span className="min-w-0 flex-1 truncate">{u.name}</span>{u.role === "va" && <span className="shrink-0 text-[14px] text-muted">VA</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mb-2 shrink-0 text-[14px] text-muted">Note — internal only, nobody outside the team sees this.</div>
      {(pendingCommentAtts.length > 0 || uploadingCommentAtt) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <AttachmentThumbs items={pendingCommentAtts} onRemove={(id) => setPendingCommentAtts((a) => a.filter((x) => x.id !== id))} />
          {uploadingCommentAtt && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
        </div>
      )}
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} onPaste={handleCommentPaste} autoFocus
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitComment(); } }}
        placeholder="Write a team message… (⌘↵ to send, paste to attach an image)"
        className="min-h-[100px] w-full resize-none rounded-xl border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[14px] text-muted">{wordCount(comment)} word{wordCount(comment) === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1.5">
          <button onClick={closeComposers} className="rounded-lg px-2.5 py-1.5 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>
          <button onClick={submitComment} disabled={!comment.trim() && pendingCommentAtts.length === 0} className="rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Send</button>
        </span>
      </div>
    </div>
  );

  // ---- Merged feed ----
  type FeedItem =
    | { at: string; kind: "comment" | "event"; channel: "activity"; comment: Comment }
    | { at: string; kind: "message"; channel: "chat" | "email" | "sms"; message: Message; dupeCount?: number };

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
    ...(visibleChannels.has("activity") ? task.comments.map((c) => ({ at: c.at, kind: (c.kind === "event" ? "event" : "comment") as "event" | "comment", channel: "activity" as const, comment: c })) : []),
    ...(messages ?? [])
      .filter((m): m is Message & { channel: "chat" | "email" | "sms" } => m.channel !== "call" && visibleChannels.has(m.channel))
      .map((m) => ({ at: m.at, kind: "message" as const, channel: m.channel, message: m })),
  ]
    .filter((item) => {
      if (!q) return true;
      if (item.kind === "message") return (item.message.subject ?? "").toLowerCase().includes(q) || htmlToText(item.message.body).toLowerCase().includes(q);
      if (item.kind === "comment") return item.comment.body.toLowerCase().includes(q);
      return false;
    })
    .sort((a, b) => a.at.localeCompare(b.at)));

  const commentCount = task.comments.filter((c) => c.kind !== "event").length;
  const chatMsgCount = (messages ?? []).filter((m) => m.channel === "chat").length;
  const emailMsgCount = (messages ?? []).filter((m) => m.channel === "email").length;
  const smsMsgCount = (messages ?? []).filter((m) => m.channel === "sms").length;
  const chatUnread = (messages ?? []).some((m) => m.channel === "chat" && m.direction === "inbound" && !m.read);
  const emailUnread = (messages ?? []).some((m) => m.channel === "email" && m.direction === "inbound" && !m.read);
  const smsUnread = (messages ?? []).some((m) => m.channel === "sms" && m.direction === "inbound" && !m.read);

  const channelMeta: Record<Channel, { label: string; unread: boolean; icon: React.ReactNode }> = {
    activity: { label: `Note · ${commentCount}`, unread: false, icon: <I.comment /> },
    chat: { label: `Chat${chatMsgCount ? ` · ${chatMsgCount}` : ""}`, unread: chatUnread, icon: <I.chatBubbles /> },
    email: { label: `Email${emailMsgCount ? ` · ${emailMsgCount}` : ""}`, unread: emailUnread, icon: <I.mail /> },
    sms: { label: `SMS${smsMsgCount ? ` · ${smsMsgCount}` : ""}`, unread: smsUnread, icon: <I.phone /> },
  };
  const toggleChannel = (ch: Channel) => setVisibleChannels((s) => {
    const next = new Set(s);
    if (next.has(ch)) next.delete(ch); else next.add(ch);
    if (next.size === 0) next.add(ch); // never allow filtering to zero channels
    if (ch !== "activity" && !s.has(ch)) onMarkChannelRead?.(ch); // opening a channel on clears its unread dot
    return next;
  });

  const filterBar = (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {(["activity", "chat", "email", "sms"] as Channel[]).filter((ch) => ch === "activity" || hasMessaging).map((ch) => {
        const active = visibleChannels.has(ch);
        const color = channelColor[ch];
        return (
          <button key={ch} onClick={() => toggleChannel(ch)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[14px] font-medium ${active ? "" : "text-muted hover:text-foreground"}`}
            style={active ? { background: color + "1a", color } : undefined}>
            {channelMeta[ch].icon} {channelMeta[ch].label}
            {channelMeta[ch].unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />}
          </button>
        );
      })}
      {onRegenerateAiSummary && (
        <button onClick={() => setAiPanelOpen(true)} className="ml-auto rounded-md border border-accent/30 px-2.5 py-1.5 text-[14px] font-medium text-accent hover:bg-accent-soft">✨ AI summary</button>
      )}
      <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[140px]">
        <I.search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search messages…"
          className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-[14px] outline-none focus:border-accent" />
      </div>
    </div>
  );

  const aiSlideOver = aiPanelOpen && (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setAiPanelOpen(false)} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[380px] flex-col border-l bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-[16px] font-semibold">✨ AI summary</span>
          <button onClick={() => setAiPanelOpen(false)} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[14px] font-medium text-muted">{client.aiSummaryAt ? `Updated ${timeAgo(client.aiSummaryAt)}` : "No summary yet"}</span>
            <button onClick={onRegenerateAiSummary} disabled={aiSummaryBusy} className="inline-flex items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-[14px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50">
              {aiSummaryBusy ? "Summarizing…" : client.aiSummary ? "Regenerate" : "Summarize"}
            </button>
          </div>
          {client.aiSummary ? (
            <p className="whitespace-pre-wrap text-[16px] leading-relaxed">{client.aiSummary}</p>
          ) : (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-7 text-center text-muted">
              <span className="text-[16px]">No AI summary yet</span>
              <span className="text-[14px]">Pulls from this client&apos;s recent messages and tasks.</span>
            </div>
          )}
        </div>
      </div>
    </>
  );

  // Chat has no compose surface of its own on this side, so a reply to a
  // chat message goes out over email instead — same reasoning the old
  // replyToEmail carried. "call" has no compose surface at all.
  const replyableChannel = (ch: MessageChannel): Channel | undefined =>
    ch === "chat" ? "email" : ch === "email" || ch === "sms" ? ch : undefined;

  const renderMessageItem = (m: Message, gap: string, dupeCount?: number) => {
    const dotColor = m.channel === "email" ? "#3b82f6" : m.channel === "chat" ? "#e87722" : "#22c55e";
    const channelLabel = m.channel === "email" ? "Email" : m.channel === "chat" ? "Chat" : "SMS";
    const isReplyingHere = replyingTo?.id === m.id;
    const rawBodyText = m.body?.trim() ? (looksLikeHtml(m.body) ? htmlToText(m.body) : m.body) : "";
    const { cleanText, imageUrls, linkUrls } = splitMessageUrls(rawBodyText);
    return (
      <div key={m.id} className={`relative ${gap}`}>
        <div className="relative flex gap-3">
          <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full border-2 border-surface" style={{ background: dotColor }} /></div>
          <div className={`min-w-0 flex-1 rounded-xl border border-l-4 p-3 ${m.direction === "inbound" ? "bg-highlight-soft" : "bg-surface"}`} style={{ borderLeftColor: m.direction === "inbound" ? "var(--highlight)" : "var(--accent)" }}>
            <div className="flex items-center gap-2 text-[14px] text-muted">
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0 font-medium" style={{ background: dotColor + "1a", color: dotColor }}>{channelLabel}</span>
              <span className="font-medium" style={{ color: m.direction === "inbound" ? "var(--highlight)" : "var(--accent)" }}>{m.direction === "inbound" ? "Received" : "Sent"}</span>
              {m.direction === "outbound" && m.createdBy && (
                <span className="inline-flex items-center gap-1"><Avatar id={m.createdBy} size={14} /> {userById(m.createdBy)?.name ?? "Unknown"}</span>
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
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {replyableChannel(m.channel) && onSendTaskMessage && editingMsgId !== m.id && (
                  <button onClick={() => openReply(m.id, replyableChannel(m.channel)!, m.subject)} className="rounded-md border border-accent/30 px-2 py-0.5 text-[13px] font-medium text-accent hover:bg-accent-soft">Reply</button>
                )}
                {canAdmin && onEditMessage && editingMsgId !== m.id && (
                  <button onClick={() => startEditMessage(m)} title="Edit (this doesn't unsend anything already delivered)" className="rounded-md border px-2 py-0.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">Edit</button>
                )}
                {canAdmin && onDeleteMessage && (
                  <button
                    onClick={() => { if (window.confirm("Delete this message? This only removes it from ClickUpTasks and the client's waiting page — it does not unsend a real email or text already delivered.")) onDeleteMessage(m.id); }}
                    title="Delete" className="rounded-md border px-2 py-0.5 text-[13px] font-medium text-muted hover:border-red-300 hover:bg-red-50 hover:text-red-600">Delete</button>
                )}
              </span>
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
                {cleanText && <CollapsibleText text={cleanText} className="mt-1 text-[16px]" />}
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

  const commentsFeed = (
    <div className="relative">
      {mergedFeedItems.length > 0 && <div className="absolute bottom-2 left-4 top-2 w-px bg-border" />}
      {mergedFeedItems.map((item, i) => {
        const gap = i === mergedFeedItems.length - 1 ? "" : "pb-3";
        if (item.kind === "message") return renderMessageItem(item.message, gap, item.dupeCount);
        if (item.kind === "event") {
          const c = item.comment; const u = userById(c.authorId); const diff = parseEventDiff(c.body);
          return (
            <div key={c.id} className={`relative flex gap-3 ${gap}`}>
              <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full border-2 border-surface" style={{ background: diff ? eventAccentColor(diff) : "var(--muted)" }} /></div>
              <div className="min-w-0 flex-1 pt-1.5 text-[16px] text-muted">
                <span className="font-medium text-foreground">{u?.name}</span>{" "}
                {diff ? <>updated {diff.field} to <EventValuePill diff={diff} /></> : c.body}
                {" · "}<span className="text-[15px]">{timeAgo(c.at)}</span>
              </div>
            </div>
          );
        }
        const c = item.comment;
        const u = userById(c.authorId);
        return (
          <div key={c.id} className={`relative flex gap-3 ${gap}`}>
            <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><Avatar id={c.authorId} size={28} /></div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[15px]"><span className="font-medium">{u?.name}</span> <span className="text-[13px] text-muted">· {timeAgo(c.at)}</span></div>
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
      {mergedFeedItems.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-7 text-center text-muted">
          <I.comment />
          <span className="text-[16px]">{(visibleChannels.size < 4 || q) ? "No messages match these filters" : "No activity yet"}</span>
          <span className="text-[14px]">{(visibleChannels.size < 4 || q) ? "Try a different filter or search." : "Type @ to mention a teammate, or use a button below to reach out."}</span>
        </div>
      )}
    </div>
  );

  // Lives in the pinned footer slot, not in the scrolling feed, so the way to
  // start a message is always on screen instead of only after scrolling to
  // the bottom of a long thread (Derek, 2026-08-11).
  const ctaRow = !replyingTo && !composingChannel ? (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-surface px-3 py-2.5">
      <button onClick={() => openCompose("activity")} className="rounded-md border px-2.5 py-1.5 text-[14px] font-medium text-muted hover:bg-background hover:text-foreground"><I.comment className="inline -mt-0.5 mr-1" />Note</button>
      {hasMessaging && <button onClick={() => openCompose("chat")} className="rounded-md border px-2.5 py-1.5 text-[14px] font-medium hover:bg-background" style={{ color: channelColor.chat, borderColor: channelColor.chat + "55" }}><I.chatBubbles className="inline -mt-0.5 mr-1" />Chat</button>}
      {hasMessaging && <button onClick={() => openCompose("email")} className="rounded-md border px-2.5 py-1.5 text-[14px] font-medium hover:bg-background" style={{ color: channelColor.email, borderColor: channelColor.email + "55" }}><I.mail className="inline -mt-0.5 mr-1" />Email</button>}
      {hasMessaging && <button onClick={() => openCompose("sms")} className="rounded-md border px-2.5 py-1.5 text-[14px] font-medium hover:bg-background" style={{ color: channelColor.sms, borderColor: channelColor.sms + "55" }}><I.phone className="inline -mt-0.5 mr-1" />SMS</button>}
    </div>
  ) : null;

  const feedArea = (
    <>
      {draftEmailCard}
      {filterBar}
      {commentsFeed}
      {aiSlideOver}
      <input ref={msgFileRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { handleMsgFileSelect(e.target.files); e.target.value = ""; }} />
    </>
  );

  // The footer is always occupied: the active composer while writing,
  // otherwise the compose buttons. Keeping the buttons here rather than at
  // the end of the feed is what makes them always reachable without
  // scrolling a long thread first.
  const composerFooter = composingChannel
    ? (composingChannel === "activity" ? teamComposer : channelComposer(composingChannel, closeComposers))
    : ctaRow;

  void mentionMatch; void mentionCands; // reserved: team @-mention affordance can be reintroduced here if needed

  return { feedArea, composerFooter };
}
