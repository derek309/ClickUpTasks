"use client";

// The task drawer's communications area — a single merged feed spanning
// Team/Chat/Email/SMS instead of one tab per channel, with type filters,
// search, inline replies, and on-demand compose buttons. Exposed as a hook
// (not a component) because the three drawer layouts (light task, full-page
// split, stacked drawer) genuinely nest this content differently in the DOM
// — feedArea always scrolls with whatever's around it, composerFooter is a
// pinned element that sits OUTSIDE that scroll area — so TaskDrawer places
// the two pieces itself rather than this module dictating layout.
import { Fragment, useRef, useState } from "react";
import {
  users, userById, timeAgo, htmlToText, looksLikeHtml, plainTextToHtml, describeEvent, eventTopic, foldRuns,
  mentionCandidates, applyMention,
  type Task, type Client, type Contact, type Attachment, type MessageChannel, type Message, type Comment,
  TaskAction, TaskActionKind, TASK_ACTION_META, splitQuotedEmail, tidyEmailText,
} from "@/lib/data";
import { I, Avatar, CollapsibleText, LinkedText, newId } from "./ui";
import { AttachmentThumbs } from "./AttachmentThumbs";
import { AttachmentTile } from "./AttachmentTile";
import { SchedulePopover } from "./SchedulePopover";

// A field change as a plain sentence with the new value in bold. Coloured
// value pills made a run of status changes louder than the client's own
// email beside them (2026-09-14 drawer redesign).
function EventText({ body }: { body: string }) {
  const { text, value } = describeEvent(body);
  return <><LinkedText text={text} />{value && <> <b className="font-semibold text-foreground">{value}</b></>}</>;
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
    // A "label<url>" link loses its URL above and would leave "label<>".
    .replace(/<\s*>/g, "")
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
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[16px] text-white opacity-0 group-hover:opacity-100">{urlFilename(url)}</span>
    </a>
  );
}
// Any other bare URL in a body → a small chip naming just the domain,
// never the raw link text (acceptance: no raw URL over 40 chars visible).
function UrlLinkChip({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[5px] border bg-background px-2 py-0.5 text-[16px] font-medium text-accent hover:underline">
      <I.link className="h-3 w-3" /> {urlDomain(url)}
    </a>
  );
}

type Channel = "activity" | "chat" | "email" | "sms";

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
  onUploadMessageImage?: (file: File) => Promise<Attachment | null>;
  onSendTaskMessage?: (channel: MessageChannel, subject: string, body: string, attachments?: Attachment[], cc?: string[], bcc?: string[], replyToMessageId?: string | null) => void;
  onScheduleTaskMessage?: (channel: MessageChannel, subject: string, body: string, scheduledAt: string, attachments?: Attachment[], cc?: string[], bcc?: string[], replyToMessageId?: string | null) => void;
  sendingMessage?: boolean;
  onDraftMessage?: (channel: "email" | "sms" | "chat", prompt?: string, context?: string) => Promise<{ subject?: string; body: string } | null>;
  draftingMessage?: boolean;
  canAdmin?: boolean;
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, body: string, subject?: string | null) => void;
  onRegenerateAiSummary?: () => void;
  hasMessaging: boolean;
}

// Presentation only, so data.ts stays free of anything that only makes sense
// on screen. Mirrors the dock's own set.
const ACTION_ICON: Record<TaskActionKind, string> = {
  note: "📝", team: "👥", chat: "🗨", email: "✉", sms: "💬", call: "☎", met: "👥", meeting: "📅", delegate: "🤝",
};

// Long action bodies (a summarised meeting, a note someone wrote properly)
// collapse to six lines with a toggle. Short ones render with no affordance
// at all, so the common case stays plain text.
/** A pasted message, made readable without rewriting it.
 *
 *  Runs of blank lines collapse: three newlines is still just a paragraph
 *  break, and stacked ones turned five sentences into a screenful of gaps.
 *
 *  A line holding nothing but a link joins the line above it. People write
 *  "And the automations" then paste the URL on the next line, and the link
 *  chip then sat alone on a line of its own with the rest of the row empty
 *  (Derek: "why are the links wrapping when there is plenty of space"). The
 *  URL is the object of that sentence, so it belongs on the end of it. A
 *  link after a blank line is left where it is: that one is deliberate.
 */
const URL_ONLY = /^\s*(https?:\/\/\S+)\s*$/i;
export function tidyBody(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const url = line.match(URL_ONLY);
    const prev = out.length ? out[out.length - 1] : "";
    if (url && prev.trim() !== "" && !URL_ONLY.test(prev)) out[out.length - 1] = `${prev.trimEnd()} ${url[1]}`;
    else out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ActionBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  // Runs of blank lines are how a pasted message arrives, and they turned a
  // five sentence reply into a screenful of gaps. Two newlines is a
  // paragraph; three or more is still just a paragraph.
  const tidy = tidyBody(text);
  const long = tidy.length > 320 || tidy.split("\n").length > 6;
  return (
    <div className="mt-0.5">
      {/* Capped, but only just under the card: 68 characters read beautifully
          and left a visible strip of empty card beside every message, which
          reads as a bug rather than as typography (Derek: "why is Justin's
          message not taking the full width of box space"). 88 fills the card
          at any normal width and still stops a paragraph running the length
          of an ultrawide monitor. */}
      <div className={`max-w-[88ch] whitespace-pre-wrap text-[16px] leading-relaxed ${!open && long ? "line-clamp-6" : ""}`}><LinkedText text={tidy} chip /></div>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="mt-0.5 text-[16px] font-medium text-accent hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function useTaskMessaging(p: TaskMessagingProps & { actions?: TaskAction[]; onDeleteAction?: (id: string) => void; onEditAction?: (id: string, body: string) => void; onLogAction?: (a: TaskAction) => void; meId?: string | null; onSendDm?: (memberId: string, body: string) => void; onDeleteComment?: (id: string) => void; onMessageSent?: (channel: "chat" | "email" | "sms", body: string) => void; onComposeEmail?: (reply?: { subject?: string; replyTo?: string }) => void; onReplyInDock?: (id: string, channel: "chat" | "sms", preview: string) => void }): { feedArea: React.ReactNode; composerFooter: React.ReactNode; openCompose: (channel: Channel, body?: string) => void } {
  const { task, client, comment, setComment, onAddComment, onUploadCommentImage, onDownloadFile, onDownloadFileAs, onDownloadAll, zippingIds,
    attImageUrls, openPreview, attachToTask, messages, onMarkChannelRead, messageDest, onUploadMessageImage,
    onSendTaskMessage, onScheduleTaskMessage, sendingMessage, onDraftMessage, draftingMessage, canAdmin,
    onDeleteMessage, onEditMessage, hasMessaging, actions, onDeleteAction, onEditAction, onLogAction, meId, onSendDm, onDeleteComment, onMessageSent, onComposeEmail, onReplyInDock } = p;

  // Conversation first: what was said and done. The app's own record of field
  // changes is one tab over, and folded to single lines under Everything.
  // Channel tabs are gone: on a real task "Activity 14" filtered out almost
  // nothing, and search finds a message faster than a channel does.
  const [view, setView] = useState<"conversation" | "changes" | "all">("conversation");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; channel: Channel } | null>(null);
  // Which action entry has its reply box open, and what is typed in it. A
  // reply is a team action of its own, so the whole thread lives in the same
  // log rather than in a parallel comment stream.
  const [replyingAction, setReplyingAction] = useState<string | null>(null);
  const [actionReply, setActionReply] = useState("");
  // Which entry is open for editing, and the text being edited. A note is
  // typed in a hurry and read for months, so fixing a typo should not mean
  // deleting it and writing it again (Derek: "I want to be able to edit a
  // note").
  const [editingAction, setEditingAction] = useState<string | null>(null);
  const [actionEdit, setActionEdit] = useState("");
  const saveActionEdit = (id: string) => {
    const text = actionEdit.trim();
    if (text) onEditAction?.(id, text);
    setEditingAction(null);
    setActionEdit("");
  };
  const [composingChannel, setComposingChannel] = useState<Channel | null>(null);

  // One shared composer-state bundle — reply and fresh-compose are kept
  // mutually exclusive (opening one clears the other) rather than each
  // getting its own bundle, which would only matter for the edge case of
  // replying to an old message while also mid-draft on something fresh.
  const [msgBody, setMsgBody] = useState("");
  const [pendingMsgAtts, setPendingMsgAtts] = useState<Attachment[]>([]);
  const [uploadingMsgAtt, setUploadingMsgAtt] = useState(false);
  // A "Review & send" from a staged draftEmail is a one-off, not the start
  // of a back-and-forth — sending it should close the composer like a reply
  // does, instead of leaving an empty box open that needed a manual Cancel
  // (Derek, 2026-08-24: "it sent but didn't close").

  const resetComposer = () => { setMsgBody(""); setPendingMsgAtts([]); };
  const closeComposers = () => { setReplyingTo(null); setComposingChannel(null); resetComposer(); };

  // Email, a reply included, is written in the email window (EmailWindow.tsx,
  // through the task's draft email), so only texts and chats open this small box
  // (Derek, 2026-09-11: "make this the default look for emailing all around").
  const openReply = (id: string, channel: Channel, subject?: string | null, preview = "") => {
    onMarkChannelRead?.(channel === "activity" ? "chat" : channel);
    // A chat or text is answered in the reply box at the bottom of the screen.
    if ((channel === "chat" || channel === "sms") && onReplyInDock) { onReplyInDock(id, channel, preview); return; }
    if (channel === "email") {
      const s = (subject ?? "").trim();
      onComposeEmail?.({ subject: s ? (/^re:/i.test(s) ? s : `Re: ${s}`) : "", replyTo: id });
      return;
    }
    setComposingChannel(null);
    resetComposer();
    setReplyingTo({ id, channel });
  };
  const openCompose = (channel: Channel, body?: string) => {
    if (channel !== "activity") onMarkChannelRead?.(channel);
    if (channel === "email") { onComposeEmail?.(); return; }
    setReplyingTo(null);
    resetComposer();
    if (body) setMsgBody(body);
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
  const hasComposedMessage = !!msgBody.trim();

  // Sending always closes the composer now (Derek: "after the email is sent,
  // close the box for email"). It used to stay open after a fresh compose so
  // a quick back-and-forth didn't mean re-clicking the CTA button each time,
  // but that CTA row is gone: the dock reopens on "what's next?" the moment a
  // message goes out, so an empty composer left behind it is just a large
  // blank box sitting between you and the feed.
  const submitTaskMessage = () => {
    const channel = activeComposeChannel;
    if (!channel || channel === "activity" || channel === "email" || (!hasComposedMessage && pendingMsgAtts.length === 0) || !onSendTaskMessage) return;
    onSendTaskMessage(channel, "", msgBody.trim(), pendingMsgAtts.length ? pendingMsgAtts : undefined);
    // Hands off to the dock, which logs the action and asks what happens
    // next. Sending used to be a dead end: the message went out and nothing
    // scheduled the follow-up, which is exactly how work went quiet.
    onMessageSent?.(channel, msgBody.trim());
    closeComposers();
  };
  const submitScheduledTaskMessage = (whenIso: string) => {
    const channel = activeComposeChannel;
    if (channel !== "sms" || (!hasComposedMessage && pendingMsgAtts.length === 0) || !onScheduleTaskMessage) return;
    onScheduleTaskMessage(channel, "", msgBody.trim(), whenIso, pendingMsgAtts.length ? pendingMsgAtts : undefined);
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
  const channelComposer = (channel: "chat" | "sms", onCancel: () => void) => {
    const color = channelColor[channel];
    if (channel === "sms") return (
      <div className="shrink-0 rounded-xl border-t-2 p-3" style={{ borderTopColor: color, background: color + "0d" }}>
        <div className="mb-2 shrink-0 text-[16px] text-muted">Texting: <span className="font-medium text-foreground">{messageDest?.phone || "no phone on file"}</span></div>
        {msgAttBar}
        <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} onPaste={handleMsgPaste} autoFocus
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitTaskMessage(); } }}
          placeholder="Write a message… (⌘↵ to send, paste to attach an image)"
          className="min-h-[100px] w-full resize-none [field-sizing:content] rounded-xl border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[16px] text-muted">{wordCount(msgBody)} word{wordCount(msgBody) === 1 ? "" : "s"} · {smsSegments(msgBody).count} segment{smsSegments(msgBody).count === 1 ? "" : "s"}{smsSegments(msgBody).count > 0 ? ` (${smsSegments(msgBody).encoding})` : ""}</span>
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
    // chat
    return (
      <div className="shrink-0 rounded-xl border-t-2 p-3" style={{ borderTopColor: color, background: color + "0d" }}>
        <div className="mb-2 shrink-0 text-[16px] text-muted">Client chat. Shows up on {client.name}&apos;s waiting page, no email or text goes out.</div>
        {msgAttBar}
        <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} onPaste={handleMsgPaste} autoFocus
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitTaskMessage(); } }}
          placeholder="Type a message… (⌘↵ to send, paste to attach an image)"
          className="min-h-[100px] w-full resize-none [field-sizing:content] rounded-xl border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[16px] text-muted">{wordCount(msgBody)} word{wordCount(msgBody) === 1 ? "" : "s"}</span>
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
              <Avatar id={u.id} size={22} /> <span className="min-w-0 flex-1 truncate">{u.name}</span>{u.role === "va" && <span className="shrink-0 text-[16px] text-muted">VA</span>}
            </button>
          ))}
        </div>
      )}
    <div className="rounded-xl border-t-2 p-3" style={{ borderTopColor: channelColor.activity, background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}>
      <div className="mb-2 shrink-0 text-[16px] text-muted">Note, internal only: nobody outside the team sees this.</div>
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
        className="min-h-[100px] w-full resize-none [field-sizing:content] rounded-xl border bg-background px-3 py-2 text-[16px] outline-none placeholder:text-muted focus:border-accent" />
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[16px] text-muted">{wordCount(comment)} word{wordCount(comment) === 1 ? "" : "s"}</span>
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
  const allFeedItems: FeedItem[] = collapseDuplicateMessages([
    ...task.comments.map((c) => ({ at: c.at, kind: (c.kind === "event" ? "event" : "comment") as "event" | "comment", channel: "activity" as const, comment: c })),
    ...(messages ?? [])
      .filter((m): m is Message & { channel: "chat" | "email" | "sms" } => m.channel !== "call")
      .map((m) => ({ at: m.at, kind: "message" as const, channel: m.channel, message: m })),
    // Replies are actions too, but they belong under the entry they answer,
    // not loose in the feed at their own timestamp.
    ...(actions ?? []).filter((a) => !a.parentId).map((a) => ({ at: a.at, kind: "action" as const, channel: "activity" as const, action: a })),
  ]
    .filter((item) => {
      if (!q) return true;
      if (item.kind === "message") return (item.message.subject ?? "").toLowerCase().includes(q) || htmlToText(item.message.body).toLowerCase().includes(q);
      if (item.kind === "comment") return item.comment.body.toLowerCase().includes(q);
      if (item.kind === "action") return item.action.body.toLowerCase().includes(q) || (item.action.nextStep ?? "").toLowerCase().includes(q);
      return false;
    })
    // Newest first here; the conversation is turned to read oldest to newest
    // below, down into the reply box pinned at the bottom (Derek, 2026-09-16:
    // "feel like it's an inline chat").
    .sort((a, b) => b.at.localeCompare(a.at)));
  const isChange = (item: FeedItem) => item.kind === "event";
  const conversationCount = allFeedItems.filter((item) => !isChange(item)).length;
  const changesCount = allFeedItems.length - conversationCount;
  const mergedFeedItems = view === "all" ? allFeedItems : allFeedItems.filter((item) => isChange(item) === (view === "changes"));
  // Under Everything a run of changes between two real entries is one line.
  // The Changes tab lists every one, since reading them is why you went there.
  const foldedRows = view === "all" ? foldRuns(mergedFeedItems, isChange) : mergedFeedItems;
  // Like a chat: oldest at the top, newest just above the reply box. Changes
  // stays newest first, it is a log. A long thread shows its latest entries
  // with the rest one click away.
  const chatOrder = view !== "changes";
  const [earlierShown, setEarlierShown] = useState(false);
  const RECENT = 20;
  const orderedRows = chatOrder ? [...foldedRows].reverse() : foldedRows;
  const hiddenEarlier = chatOrder && !earlierShown && !q ? Math.max(0, orderedRows.length - RECENT) : 0;
  const displayRows = hiddenEarlier ? orderedRows.slice(hiddenEarlier) : orderedRows;

  const unreadChannels = hasMessaging
    ? (["chat", "email", "sms"] as const).filter((ch) => (messages ?? []).some((m) => m.channel === ch && m.direction === "inbound" && !m.read))
    : [];
  // Choosing a tab that shows messages is reading them, so it clears their dots.
  const selectView = (v: typeof view) => {
    setView(v);
    if (v !== "changes") unreadChannels.forEach((ch) => onMarkChannelRead?.(ch));
  };
  const tab = (v: typeof view, label: string, count: number, unread = false) => (
    <button role="tab" aria-selected={view === v} onClick={() => selectView(v)}
      className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2 pb-2.5 pt-1 text-[16px] font-medium sm:px-3 ${view === v ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>
      {label}<span className="font-normal text-muted">{count}</span>
      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="New messages" />}
    </button>
  );
  const closeSearch = () => { setSearchOpen(false); setSearchQuery(""); };
  const filterBar = (
    <div className="mb-4">
      <div role="tablist" className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b">
        {tab("conversation", "Conversation", conversationCount, unreadChannels.length > 0)}
        {tab("changes", "Changes", changesCount)}
        {tab("all", "Everything", allFeedItems.length)}
        <button onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))} title="Search this task's history" aria-label="Search this task's history"
          className={`mb-1.5 ml-auto shrink-0 rounded-lg p-2 ${searchOpen ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}><I.search /></button>
      </div>
      {searchOpen && (
        <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeSearch(); } }}
          placeholder="Search messages and notes"
          className="mt-3 w-full rounded-lg border bg-surface px-3 py-2 text-[16px] outline-none focus:border-accent" />
      )}
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
    const replies = (actions ?? []).filter((r) => r.parentId === a.id).sort((x, y) => x.at.localeCompare(y.at));
    const replyOpen = replyingAction === a.id;
    // An entry with nothing to read (a logged chat or call that only set the
    // next step) is one quiet line, not a card, so the real words stand out
    // (Derek, 2026-09-16: the page read "very flat").
    if (!a.body && replies.length === 0 && !replyOpen && editingAction !== a.id) {
      return (
        <div key={a.id} className={`group flex items-center gap-3 ${gap}`}>
          <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-[16px]" aria-hidden>{ACTION_ICON[a.kind]}</span>
          <div className="min-w-0 flex-1 text-[16px] text-muted">
            <span className="font-semibold text-foreground">{meta.verb}</span> · {who}{toName ? ` → ${toName}` : ""} · {timeAgo(a.at)}
            {a.nextStep && <span className={a.nextStepDoneAt ? "line-through" : ""}> · Next step: {a.nextStep}</span>}
            {onLogAction && (
              <button onClick={() => { setReplyingAction(a.id); setActionReply(""); }}
                className="ml-2 font-medium text-accent opacity-0 transition hover:underline focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">Reply</button>
            )}
            {onDeleteAction && (
              <button onClick={() => onDeleteAction(a.id)} title="Delete this entry"
                className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-danger group-hover:opacity-100">
                <I.trash className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      );
    }
    // A note is for the team only, so it reads as a pale yellow card with a
    // lock, never as something the client was sent (Derek, 2026-09-16).
    const teamNote = a.kind === "note";
    return (
      <div key={a.id} className={`group flex gap-3 ${gap} ${teamNote ? "mx-auto max-w-[680px]" : ""}`}>
        <span className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[16px] ${teamNote ? "bg-amber-100 dark:bg-amber-500/20" : "bg-accent-soft"}`} aria-hidden>{teamNote ? "🔒" : ACTION_ICON[a.kind]}</span>
        {/* Every entry is a white card on the feed's tinted ground (Derek:
            "add a white box around messages so it stands out" — "all of
            them"), so one entry never runs into the next. */}
        <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2 shadow-soft ${teamNote ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10" : "bg-surface"}`}>
          <span className="text-[16px] font-semibold">{teamNote ? "Note" : meta.verb}</span>
          {/* Who wrote it and who it was addressed to. "Messaged · Derek Fox"
              recorded that a teammate was messaged and lost which one, which
              is the only part of the entry anyone needs to act on. */}
          <span className="text-[16px] text-muted"> · {who}{toName ? ` → ${toName}` : ""} · {timeAgo(a.at)}{teamNote ? " · Only your team sees this" : ""}</span>
          {onEditAction && a.body && (
            <button onClick={() => { setEditingAction(a.id); setActionEdit(a.body); }} title="Edit this entry"
              className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-foreground group-hover:opacity-100">
              <I.pencil className="h-3 w-3" />
            </button>
          )}
          {onDeleteAction && (
            <button onClick={() => onDeleteAction(a.id)} title="Delete this entry"
              className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-danger group-hover:opacity-100">
              <I.trash className="h-3 w-3" />
            </button>
          )}
          {/* Clamped with a Show more, because a logged meeting can be five
              lines of decisions and there is no reason for it to push every
              other entry off the screen. */}
          {editingAction === a.id ? (
            <div className="mt-1.5 flex items-end gap-2">
              <textarea autoFocus value={actionEdit} rows={2}
                onChange={(e) => setActionEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setEditingAction(null); setActionEdit(""); return; }
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault(); saveActionEdit(a.id);
                }}
                className="max-h-[200px] min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border bg-surface px-2 py-1.5 text-[16px] leading-snug outline-none focus:border-accent" />
              <button onClick={() => saveActionEdit(a.id)} disabled={!actionEdit.trim()}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Save</button>
            </div>
          ) : a.body ? <ActionBody text={a.body} /> : null}
          {a.nextStep && (
            // What this entry committed to, said quietly. The open step is
            // shown once, on the Next step card at the top of the task; a
            // second copy here, with its own date and Mark done, is how the
            // two drifted apart (2026-09-14 redesign).
            <div className="mt-1.5 flex items-start gap-2 text-[16px] text-muted">
              <span aria-hidden>{a.nextStepDoneAt ? "✓" : "→"}</span>
              <span className={a.nextStepDoneAt ? "line-through" : ""}>Next step: {a.nextStep}</span>
            </div>
          )}
          {/* The thread. Every entry can be replied to, not just team
              messages: a note or a logged call is just as likely to be the
              thing someone wants to ask about, and the answer belongs on the
              entry rather than as a loose comment further down the feed. */}
          {/* Each reply is its own tinted block rather than another run of
              text under a bold name: a thread of four read as one wall, and
              the only thing separating them was a line break. */}
          {replies.length > 0 && (
            <div className="mt-2.5 space-y-2 border-l-2 pl-3">
              {replies.map((r) => (
                <div key={r.id} className="group/reply rounded-lg bg-background px-2.5 py-2">
                  <span className="text-[16px] font-semibold">{r.authorId ? (userById(r.authorId)?.name ?? "Someone") : "Someone"}</span>
                  <span className="text-[16px] text-muted"> · {timeAgo(r.at)}</span>
                  {/* Editable, like the entry above it. A reply is typed in a
                      hurry into a small box and read for months (Derek: "make
                      it so we can edit our messages"). */}
                  {onEditAction && (
                    <button onClick={() => { setEditingAction(r.id); setActionEdit(r.body); }} title="Edit this reply"
                      className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-foreground group-hover/reply:opacity-100">
                      <I.pencil className="h-3 w-3" />
                    </button>
                  )}
                  {onDeleteAction && (
                    <button onClick={() => onDeleteAction(r.id)} title="Delete this reply"
                      className="ml-1.5 rounded p-0.5 align-middle text-muted opacity-0 transition hover:text-danger group-hover/reply:opacity-100">
                      <I.trash className="h-3 w-3" />
                    </button>
                  )}
                  {editingAction === r.id ? (
                    <div className="mt-1.5 flex items-end gap-2">
                      <textarea autoFocus value={actionEdit} rows={2}
                        onChange={(e) => setActionEdit(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setEditingAction(null); setActionEdit(""); return; }
                          if (e.key !== "Enter" || e.shiftKey) return;
                          e.preventDefault(); saveActionEdit(r.id);
                        }}
                        className="max-h-[200px] min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border bg-surface px-2 py-1.5 text-[16px] leading-snug outline-none focus:border-accent" />
                      <button onClick={() => saveActionEdit(r.id)} disabled={!actionEdit.trim()}
                        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Save</button>
                    </div>
                  ) : <ActionBody text={r.body} />}
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
                className="max-h-[160px] min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border bg-surface px-2 py-1.5 text-[16px] leading-snug outline-none focus:border-accent" />
              <button onClick={() => sendActionReply(a)} disabled={!actionReply.trim()}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Reply</button>
            </div>
          ) : (
            <button onClick={() => { setReplyingAction(a.id); setActionReply(""); }}
              className="mt-1 text-[16px] font-medium text-accent hover:underline">Reply</button>
          ))}
        </div>
      </div>
    );
  };

  const renderMessageItem = (m: Message, gap: string, dupeCount?: number, continued = false) => {
    const isReplyingHere = replyingTo?.id === m.id;
    const rawBodyText = m.body?.trim() ? (looksLikeHtml(m.body) ? htmlToText(m.body) : m.body) : "";
    // The reply chain and the signature block under it are not what anyone
    // opened the task to read: one line of "I edited it. Its ready." was
    // rendering as a screen and a half of quoted history.
    const { visible: ownText, quoted } = splitQuotedEmail(tidyEmailText(rawBodyText));
    const { cleanText, imageUrls, linkUrls } = splitMessageUrls(ownText || rawBodyText);
    const quotedOpen = openQuotes.has(m.id);
    const mine = m.direction === "outbound";
    const email = m.channel === "email";
    const clientInitials = client.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const hoverTool = "flex h-8 w-8 items-center justify-center rounded-lg bg-background text-muted hover:bg-accent-soft hover:text-foreground";
    return (
      <div key={m.id} className={`group relative ${gap}`}>
        {/* Two sides, like a text thread: the client on the left, us on the
            right. An email is a letter, so it is a white card on its side
            rather than a bubble (Derek, 2026-09-16). */}
        <div className={`relative flex items-end gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
          <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center">
            {continued ? null : mine && m.createdBy ? <Avatar id={m.createdBy} size={30} /> : (
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[16px] font-bold text-white ${mine ? "bg-accent" : ""}`} style={mine ? undefined : { background: client.color }}>{mine ? "✳" : clientInitials}</span>
            )}
          </div>
          <div className={`min-w-0 ${email ? "w-full max-w-[640px] rounded-2xl border bg-surface p-3.5 shadow-soft" : `max-w-[min(620px,85%)] rounded-2xl px-3.5 py-2.5 ${mine ? "rounded-br-md bg-accent-soft" : "rounded-bl-md bg-highlight-soft/80"}`}`}>
            <div className={`flex flex-wrap items-center gap-x-2 text-[16px] text-muted ${continued && !email ? "hidden" : ""}`}>
              {email && <span className="rounded-[5px] bg-accent-soft px-1.5 font-semibold text-accent">Email</span>}
              <span className="font-semibold text-foreground">{mine ? (m.createdBy ? (userById(m.createdBy)?.name ?? "You") : "Sent") : client.name}</span>
              {!email && <span>· {m.channel === "sms" ? "Text" : "Chat"}</span>}
              <span>· {timeAgo(m.at)}</span>
              {dupeCount && dupeCount > 1 && (
                <span className="inline-flex items-center rounded-[5px] bg-background px-1.5 py-0 text-[16px] font-semibold text-muted" title={`Collapsed ${dupeCount} identical sends within 10 minutes`}>sent {dupeCount}×</span>
              )}
              {!m.read && (
                <span className="inline-flex items-center gap-1 rounded-[5px] bg-accent-soft px-1.5 py-0 text-[16px] font-semibold text-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> New
                </span>
              )}
            </div>
            {m.subject && <div className="mt-1 text-[16px] font-medium">{m.subject}</div>}
            {((m.cc && m.cc.length > 0) || (m.bcc && m.bcc.length > 0)) && (
              <div className="mt-0.5 text-[16px] text-muted">
                {m.cc && m.cc.length > 0 && <span>Cc: {m.cc.join(", ")}</span>}
                {m.cc && m.cc.length > 0 && m.bcc && m.bcc.length > 0 && <span> · </span>}
                {m.bcc && m.bcc.length > 0 && <span>Bcc: {m.bcc.join(", ")}</span>}
              </div>
            )}
            {editingMsgId === m.id ? (
              <div className="mt-1.5 space-y-1.5">
                <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={3} autoFocus
                  className="w-full rounded-lg border bg-background px-2.5 py-2 text-[16px] outline-none focus:border-accent" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingMsgId(null)} className="rounded-md px-2.5 py-1 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">Cancel</button>
                  <button onClick={() => saveEditMessage(m)} disabled={!editDraft.trim()} className="rounded-md bg-accent px-2.5 py-1 text-[16px] font-medium text-white disabled:opacity-40">Save</button>
                </div>
              </div>
            ) : !m.body?.trim() ? (
              // GHL's conversations/{id}/messages response omits the body on a
              // sizeable share of email messages (~1 in 3 as of 2026-08-11),
              // and refresh-messages stores that as "". Saying so beats
              // rendering an empty card that reads like the app lost the
              // message (Derek, 2026-08-11). Our own sends are never empty, so
              // this only ever labels a genuine gap in what GHL handed back.
              <div className="mt-1 text-[16px] italic text-muted">No content synced from GoHighLevel for this message.</div>
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
                      className="mt-1 rounded border px-1.5 py-0 text-[16px] leading-5 text-muted hover:bg-background hover:text-foreground"
                      title={quotedOpen ? "Hide the earlier thread" : "Show the earlier thread"}>···</button>
                    {/* A forwarded email's substance lives here, so it gets the same
                        link treatment as the text above: "label<tracking url>" shows
                        just the label as the link, and overflow-wrap keeps any long
                        leftover string inside the card instead of off its edge. */}
                    {quotedOpen && <div className="mt-1 whitespace-pre-wrap border-l-2 pl-2 text-[16px] text-muted [overflow-wrap:anywhere]"><LinkedText text={quoted} angleLabels /></div>}
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
                    className="mb-0.5 flex w-full items-center gap-1.5 text-[16px] font-medium text-accent hover:underline disabled:opacity-50">
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
          {/* Reply, Edit and Delete beside the bubble on hover, always shown on
              a touch screen, instead of a ⋯ menu to open first. */}
          {editingMsgId !== m.id && (
            <div className="flex shrink-0 gap-1 self-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              {replyableChannel(m.channel) && onSendTaskMessage && (
                <button onClick={() => openReply(m.id, replyableChannel(m.channel)!, m.subject, (cleanText || m.subject || "").slice(0, 120))} title="Reply" aria-label="Reply" className={hoverTool}>↩</button>
              )}
              {canAdmin && onEditMessage && (
                <button onClick={() => startEditMessage(m)} title="Edit (this doesn't unsend anything already delivered)" aria-label="Edit" className={hoverTool}><I.pencil className="h-3.5 w-3.5" /></button>
              )}
              {canAdmin && onDeleteMessage && (
                <button onClick={() => { if (window.confirm("Delete this message? This only removes it from ClickUpTasks and the client's waiting page. It does not unsend a real email or text already delivered.")) onDeleteMessage(m.id); }}
                  title="Delete" aria-label="Delete" className={`${hoverTool} hover:!bg-danger-soft hover:!text-danger`}><I.trash className="h-3.5 w-3.5" /></button>
              )}
            </div>
          )}
        </div>
        {isReplyingHere && replyingTo.channel !== "email" && <div className="ml-11 mt-2">{channelComposer(replyingTo.channel === "activity" ? "chat" : replyingTo.channel, closeComposers)}</div>}
      </div>
    );
  };

  const renderEventRow = (c: Comment, gap: string) => {
    const u = userById(c.authorId);
    return (
      <div key={c.id} className={`group relative flex gap-3 ${gap}`}>
        <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full border-2 border-surface bg-muted/50" /></div>
        <div className="min-w-0 flex-1 pt-1 text-[16px] text-muted">
          <span className="font-medium text-foreground">{u?.name}</span>{" "}<EventText body={c.body} />{" · "}{timeAgo(c.at)}
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

  // One row of the feed, in whichever order the tab reads.
  const renderRow = (item: (typeof displayRows)[number], i: number): React.ReactNode => {
        const gap = i === displayRows.length - 1 ? "" : "pb-3";
        if ("run" in item) {
          // A run of the app's own changes between two real entries, as one
          // quiet line that opens back into the changes. The feed is newest
          // first, so the first event is the latest one. The same change
          // twice in a run (a link added, removed, added) is shown once.
          const events = item.run.flatMap((r) => (r.kind === "event" ? [r.comment] : []));
          const unique = events.filter((c, idx) => events.findIndex((x) => x.body === c.body) === idx);
          if (unique.length === 1) return renderEventRow(unique[0], gap);
          const key = `eg_${unique[0].id}`;
          const topics = [...new Set(unique.map((c) => eventTopic(c.body)))].join(", ");
          const open = openEventGroups.has(key);
          return (
            <div key={key} className={gap}>
              <div className="flex gap-3">
                <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full border-2 border-surface bg-muted/50" /></div>
                <button onClick={() => toggleEventGroup(key)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 pt-1 text-left text-[16px] text-muted hover:text-foreground">
                  <I.chevron className={`h-3 w-3 shrink-0 transition-transform ${open ? "-rotate-90" : "rotate-180"}`} />
                  <span>{unique.length} changes · {topics} · {timeAgo(unique[0].at)}</span>
                </button>
              </div>
              {open && <div className="mt-2 space-y-1">{unique.map((c) => renderEventRow(c, ""))}</div>}
            </div>
          );
        }
        if (item.kind === "message") {
          // Back to back messages from the same person on the same channel read
          // as one group, with the name and time shown once.
          const prev = displayRows[i - 1];
          const continued = chatOrder && !!prev && !("run" in prev) && prev.kind === "message"
            && prev.message.direction === item.message.direction && prev.message.channel === item.message.channel
            && (prev.message.createdBy ?? null) === (item.message.createdBy ?? null)
            && Math.abs(Date.parse(item.at) - Date.parse(prev.at)) <= 10 * 60 * 1000;
          return renderMessageItem(item.message, continued ? "pb-1" : gap, item.dupeCount, continued);
        }
        if (item.kind === "action") return renderActionItem(item.action, gap);
        if (item.kind === "event") return renderEventRow(item.comment, gap);
        const c = item.comment;
        const u = userById(c.authorId);
        return (
          <div key={c.id} className={`group relative flex gap-3 ${gap}`}>
            <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center"><Avatar id={c.authorId} size={28} /></div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[16px]">
                <span className="font-medium">{u?.name}</span> <span className="text-[16px] text-muted">· {timeAgo(c.at)}</span>
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
                      className="mb-0.5 flex w-full items-center gap-1.5 text-[16px] font-medium text-accent hover:underline disabled:opacity-50">
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
  };
  // "Today", "Yesterday" or the date, between days in the conversation.
  const dayKey = (iso: string) => new Date(iso).toDateString();
  const dayName = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
  };
  const rowAt = (item: (typeof displayRows)[number]) => ("run" in item ? item.run[0].at : item.at);

  const commentsFeed = (
    <div className="relative">
      {!chatOrder && mergedFeedItems.length > 0 && <div className="absolute bottom-2 left-4 top-2 w-px bg-border" />}
      {chatOrder && mergedFeedItems.length > 0 && (
        <div className="pb-3 text-center text-[16px] text-muted">
          {hiddenEarlier > 0
            ? <button onClick={() => setEarlierShown(true)} className="font-medium text-accent hover:underline">Show {hiddenEarlier} earlier</button>
            : <>Start of your conversation with {client.name}</>}
        </div>
      )}
      {displayRows.map((item, i) => {
        const row = renderRow(item, i);
        if (!chatOrder || (i > 0 && dayKey(rowAt(item)) === dayKey(rowAt(displayRows[i - 1])))) return row;
        return (
          <Fragment key={`day_${rowAt(item)}_${i}`}>
            <div className="flex items-center gap-3 py-3 text-[16px] font-semibold text-muted" role="separator">
              <span className="h-px flex-1 bg-border" />{dayName(rowAt(item))}<span className="h-px flex-1 bg-border" />
            </div>
            {row}
          </Fragment>
        );
      })}
      {/* C6: a short thread otherwise leaves a few hundred blank px below the
          last entry, which reads as a stuck load rather than a finished
          history. Top-anchored on purpose — bottom-anchoring was tried and
          reverted (short threads looked broken); don't reintroduce it. */}
      {!chatOrder && mergedFeedItems.length > 0 && (
        <div className="pt-3 text-center text-[16px] text-muted">Start of your conversation with {client.name}</div>
      )}
      {mergedFeedItems.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-7 text-center text-muted">
          <I.comment />
          <span className="text-[16px]">{q ? "Nothing matches that search" : view === "changes" ? "No changes yet" : "Nothing here yet"}</span>
          <span className="text-[16px]">{q ? "Try other words." : "Write a note or log what you did in the box above."}</span>
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
      {composingChannel
        ? (composingChannel === "activity" ? teamComposer : composingChannel === "email" ? null : channelComposer(composingChannel, closeComposers))
        : ctaRow}
    </>
  );


  // openCompose goes out so the dock can drive this composer rather than
  // shipping a second, poorer one of its own.
  return { feedArea, composerFooter, openCompose };
}
