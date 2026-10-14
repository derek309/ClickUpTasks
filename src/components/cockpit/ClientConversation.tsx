"use client";

// The client's Conversation (Derek, 2026-10-14, client header mockup): their
// emails, texts and portal chats in time order, each saying its channel, its
// day and the task it is on (a click opens that task); the drafts not sent
// yet at the bottom, dashed, to edit and send right here; and one box to
// write a new message by email, text or chat. Beside the task list on a
// desktop, a panel over it on a tablet, the whole screen on a phone. The
// messages are the ones already in memory (the Journal's), nothing is
// fetched here.
import { useEffect, useMemo, useRef, useState } from "react";
import { looksLikeHtml, type Attachment, type Message } from "@/lib/data";
import { safeMessageHtml } from "@/lib/safeHtml";
import { isTalk, plainLine, type ConversationDraft, type TalkChannel } from "@/lib/clientConversation";
import { CollapsibleText, I } from "./ui";
import { AttachmentThumbs } from "./AttachmentThumbs";
import { DraftMessageBox } from "./DraftMessageBox";
import { useEscapeToClose } from "./useEscapeToClose";
import { buildFeedDrafts, type FeedDraftDeps } from "./clientFeedDrafts";

const TZ = "America/Los_Angeles";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const WORD: Record<TalkChannel, string> = { email: "email", sms: "text", chat: "chat" };

/** One draft in the feed, with what Edit and Send do for it. */
export type FeedDraft = {
  d: ConversationDraft;
  /** Under the draft: "on Reply to Pamela", "from Claude". */
  where: string;
  /** Send it as it is, here. Null when it has to go from its task. */
  send: (() => Promise<unknown>) | null;
  /** Edit an email in its window over the page. */
  editEmail?: (close: () => void) => React.ReactNode;
  /** Edit by opening the window the app already has for it. */
  openEdit?: () => void;
  /** Edit a text or chat right here. */
  editText?: { save: (body: string) => void; send: (body: string) => Promise<unknown>; discard: () => void };
  /** Its send asks or starts a review on the task: Send opens the task with it. */
  onTask?: () => void;
};

export function ClientConversation({ first, meId, nameOf, messages, taskTitle, onOpenTask, onOpenFile, draftDeps, channels, whereFor, answering, onSend, onFullEmail, onClose }: {
  first: string;
  meId: string;
  nameOf: (memberId: string) => string | null;
  /** The client's messages, any order; only emails, texts and chats show. */
  messages: Message[];
  /** The task a message is on, by id; null when it is gone. */
  taskTitle: (taskId: string) => string | null;
  onOpenTask: (taskId: string) => void;
  onOpenFile?: (path: string) => void;
  /** What the drafts are made from, and how each sends (clientFeedDrafts). */
  draftDeps: FeedDraftDeps;
  /** The channels the client has. Empty when messages are off for them. */
  channels: TalkChannel[];
  /** Where a new message on this channel goes, said under Send. */
  whereFor: (channel: TalkChannel) => { taskId: string | null; says: string };
  /** Their newest email when it is waiting on our answer: a new email answers it. */
  answering: { id: string; subject: string } | null;
  /** Sends through the app's usual path. True once it went. */
  onSend: (channel: TalkChannel, subject: string, text: string, replyTo: string | null, taskId: string | null) => Promise<boolean>;
  /** The full email window (files, copies, AI), started with what is typed. */
  onFullEmail?: (subject: string, text: string) => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const drafts = buildFeedDrafts(draftDeps);
  const [filter, setFilter] = useState<"all" | TalkChannel>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [channel, setChannel] = useState<TalkChannel | null>(channels[0] ?? null);
  const ch = channel && channels.includes(channel) ? channel : channels[0] ?? null;
  const [subject, setSubject] = useState<string | null>(null);
  const [text, setText] = useState("");
  const talk = useMemo(() => messages.filter(isTalk).sort((a, b) => a.at.localeCompare(b.at)), [messages]);
  const has = new Set(talk.map((m) => m.channel));
  const shown = filter === "all" ? talk : talk.filter((m) => m.channel === filter);
  const shownDrafts = filter === "all" ? drafts : drafts.filter((x) => x.d.kind === filter);
  const where = ch ? whereFor(ch) : null;
  const canSendHere = !!ch && !!where && (ch !== "chat" || !!where.taskId);
  const emailSubject = subject ?? answering?.subject ?? "";

  // The newest at the bottom, in view, as it opens and as messages come in.
  const scroller = useRef<HTMLDivElement>(null);
  const count = shown.length + shownDrafts.length;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [count]);

  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    try { await f(); } finally { setBusy(null); }
  };
  const send = () => {
    if (!ch || !where || !text.trim()) return;
    void run("compose", async () => {
      const ok = await onSend(ch, ch === "email" ? emailSubject.trim() : "", text.trim(), ch === "email" ? answering?.id ?? null : null, where.taskId);
      if (ok) { setText(""); setSubject(null); }
    });
  };
  const whoOf = (m: Message) => (m.direction === "inbound" ? first : !m.createdBy || m.createdBy === meId ? "You" : (nameOf(m.createdBy) ?? "").split(/\s+/)[0] || "We");
  const link = "font-semibold text-accent hover:underline disabled:opacity-40";
  const editingDraft = drafts.find((x) => x.d.id === editing) ?? null;

  return (
    <aside aria-label={`Conversation with ${first}`}
      className="fixed inset-0 z-50 flex flex-col bg-surface text-[16px] sm:inset-y-0 sm:left-auto sm:right-0 sm:z-40 sm:w-[420px] sm:max-w-[92vw] sm:border-l sm:shadow-xl lg:static lg:z-auto lg:max-w-none lg:shrink-0 lg:shadow-none">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <b className="min-w-0 flex-1 truncate text-[17px]">{first} · {(["email", "sms", "chat"] as const).filter((c) => has.has(c) || channels.includes(c)).map((c) => WORD[c]).join(", ") || "no messages yet"}</b>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show"
          className="h-9 rounded-[5px] border bg-surface px-2 text-[16px] font-semibold text-accent">
          <option value="all">All</option>
          <option value="email">Emails</option>
          <option value="sms">Texts</option>
          <option value="chat">Chats</option>
        </select>
        <button onClick={onClose} aria-label="Close the conversation" title="Close (Esc)" className="grid h-9 w-9 place-items-center rounded-[5px] text-muted ring-1 ring-[var(--border)] hover:bg-background hover:text-foreground"><I.close /></button>
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden px-4 py-3">
        {!shown.length && !shownDrafts.length && <p className="my-auto text-center text-muted">{filter === "all" ? `Nothing said with ${first} yet.` : `No ${WORD[filter]}s with ${first} yet.`}</p>}
        {shown.map((m) => {
          const mine = m.direction === "outbound";
          const title = m.taskId ? taskTitle(m.taskId) : null;
          const html = m.channel === "email" && looksLikeHtml(m.body);
          const full = open.has(m.id);
          const words = plainLine(m.body);
          return (
            <div key={m.id} className={`max-w-[88%] rounded-[5px] px-3 py-2 ${mine ? "self-end bg-accent-soft" : "self-start bg-surface ring-1 ring-[var(--border)]"}`}>
              <div className="text-[16px] text-muted">
                {whoOf(m)} · {WORD[m.channel as TalkChannel]} · <span title={dayTime(m.at)}>{day(m.at)}</span>
                {title && <> · on <button onClick={() => onOpenTask(m.taskId!)} className="text-left font-semibold text-accent hover:underline">&ldquo;{title}&rdquo;</button></>}
                {!mine && !m.read && <b className="ml-1.5 text-accent">New</b>}
              </div>
              {m.channel === "email" && m.subject && <b className="block break-words">{m.subject}</b>}
              {m.channel === "email" ? (full
                ? (html ? <div className="rte-content break-words text-[16px]" dangerouslySetInnerHTML={{ __html: safeMessageHtml(m.body) }} /> : <p className="whitespace-pre-wrap break-words">{m.body}</p>)
                : <p className="line-clamp-3 break-words">{words}</p>)
                : <CollapsibleText text={m.body} className="whitespace-pre-wrap break-words text-[16px]" />}
              {m.channel === "email" && words.length > 160 && (
                <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} className={`${link} text-[16px]`}>{full ? "Show less" : "Show all"}</button>
              )}
              {(m.attachments?.length ?? 0) > 0 && <div className="mt-1.5"><AttachmentThumbs items={m.attachments as Attachment[]} onOpen={onOpenFile} /></div>}
            </div>
          );
        })}

        {shownDrafts.map((x) => {
          const { d } = x;
          const what = `Draft ${d.kind === "email" ? "email" : d.kind === "sms" ? "text" : "chat"}`;
          if (editing === d.id && x.editText) return (
            <div key={d.id} className="self-stretch">
              <DraftMessageBox channel={d.kind === "chat" ? "chat" : "sms"} body={d.body} firstName={first} light
                onSave={x.editText.save} onDiscard={() => { setEditing(null); x.editText!.discard(); }}
                onSend={(body) => void run(d.id, async () => { await x.editText!.send(body); setEditing(null); })} />
              <button onClick={() => setEditing(null)} className={`${link} mt-1 text-[16px]`}>Done editing</button>
            </div>
          );
          return (
            <div key={d.id} className="max-w-[88%] self-end rounded-[5px] border-[1.5px] border-dashed border-highlight bg-highlight-soft px-3 py-2">
              <div className="font-semibold text-highlight">{what} · {x.where} · not sent</div>
              {d.subject && <b className="block break-words">{d.subject}</b>}
              <p className="line-clamp-3 break-words">{d.text || <span className="text-muted">Nothing written yet</span>}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5">
                <button onClick={() => { if (x.editEmail || x.editText) setEditing(d.id); else x.openEdit?.(); }} className={link}>Edit</button>
                <span className="text-muted">·</span>
                {x.send ? (
                  <button disabled={busy === d.id} onClick={() => void run(d.id, x.send!)} className={link}>{busy === d.id ? "Sending…" : "Send"}</button>
                ) : x.onTask ? (
                  <button onClick={x.onTask} title="It asks about to dos or starts a review, so it goes from its task" className={link}>Send on the task</button>
                ) : <span className="text-muted">Can&apos;t send from here</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* A new message: Email, Text or Chat (only the ways they have), and one Send. */}
      <div className="shrink-0 border-t px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
        {!ch ? <p className="text-muted">Messages are off for {first}, or there is no way to reach them yet.</p> : <>
          {channels.length > 1 && (
            <div className="mb-2 flex gap-1.5" role="group" aria-label="Send by">
              {channels.map((c) => (
                <button key={c} onClick={() => setChannel(c)} aria-pressed={ch === c}
                  className={`h-9 rounded-[5px] px-3 text-[16px] font-semibold ring-1 ${ch === c ? "bg-accent-soft text-accent ring-accent" : "bg-surface text-muted ring-[var(--border)] hover:text-foreground"}`}>{c === "email" ? "Email" : c === "sms" ? "Text" : "Chat"}</button>
              ))}
            </div>
          )}
          {ch === "email" && (
            <input value={emailSubject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject"
              className="mb-2 h-10 w-full rounded-[5px] border bg-surface px-2.5 text-[16px] outline-none focus:border-accent" />
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={`Write to ${first}`}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            placeholder={`Write to ${first}…`} className="w-full resize-y rounded-[5px] border bg-surface px-2.5 py-2 text-[16px] outline-none focus:border-accent" />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={send} disabled={!canSendHere || !text.trim() || busy === "compose" || (ch === "email" && !emailSubject.trim())}
              className="h-10 shrink-0 rounded-[5px] border border-accent bg-surface px-4 text-[16px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-40">{busy === "compose" ? "Sending…" : "Send"}</button>
            <span className="min-w-0 flex-1 text-[16px] leading-snug text-muted">{where?.says}</span>
          </div>
          {ch === "email" && onFullEmail && (
            <button onClick={() => onFullEmail(emailSubject, text)} className={`${link} mt-1.5 text-[16px]`}>Open the full email window</button>
          )}
        </>}
      </div>
      {editingDraft?.editEmail?.(() => setEditing(null))}
    </aside>
  );
}
