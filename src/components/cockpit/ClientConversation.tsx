"use client";

// The client's Conversation (Derek, 2026-10-14, client header mockup): their
// emails, texts and portal chats in time order as a chat, theirs on the left
// and ours on the right, a divider for each day, the task they are on said
// once when it changes (a click opens that task), automatic messages folded
// to one muted line each, and "New since you last looked" above what came in
// since you last opened it; the drafts not sent yet at the bottom, dashed, to
// edit and send right here; and one box to write a new message by email,
// text or chat, on the task picked under it. The box is one line until you
// click it (Derek, 2026-10-14: "I don't like the email box always open"),
// answers the way the client wrote last, on the task they wrote on, and can
// draft the reply with AI. Beside the task list on a
// desktop, a panel over it on a tablet, the whole screen on a phone. The
// messages are the ones already in memory (the Journal's), whole; only a
// message's files are fetched, as its card comes into view.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { looksLikeHtml, type Attachment, type Message } from "@/lib/data";
import { safeMessageHtml } from "@/lib/safeHtml";
import { authedFetch } from "@/lib/supabase";
import { downloadUrlForFile, signedUrlForFile } from "@/lib/db";
import { automaticKind, byTime, defaultChannel, feedFileKey, feedFileSource, feedFiles, feedRows, isTalk, messageStamp, plainLine, shortDay, timeOf, waitingLine, waitingOnReply, type ConversationDraft, type TalkChannel } from "@/lib/clientConversation";
import { I, renderRichText } from "./ui";
import { EmailFiles } from "./SentEmail";
import { ImageLightbox } from "./TaskWorkItem";
import { DraftMessageBox } from "./DraftMessageBox";
import { useEscapeToClose } from "./useEscapeToClose";
import { buildFeedDrafts, type FeedDraftDeps } from "./clientFeedDrafts";

const TZ = "America/Los_Angeles";
const dayTime = (iso: string) => new Date(timeOf(iso)).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

export function ClientConversation({ first, meId, nameOf, messages, taskTitle, onOpenTask, onOpenFile, draftDeps, channels, whereFor, taskOptions, answering, onSend, onFullEmail, onAiDraft, showAutomatic, onShowAutomatic, seenAt, onSeen, onClose }: {
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
  /** Where a new message on this channel goes unless another task is picked. */
  whereFor: (channel: TalkChannel) => { taskId: string | null; says: string };
  /** The client's open tasks a new message can go on, newest activity first. */
  taskOptions: { id: string; title: string }[];
  /** Their newest email when it is waiting on our answer: a new email answers it. */
  answering: { id: string; subject: string } | null;
  /** Sends through the app's usual path. True once it went. */
  onSend: (channel: TalkChannel, subject: string, text: string, replyTo: string | null, taskId: string | null) => Promise<boolean>;
  /** The full email window (files, copies, AI), started with what is typed. */
  onFullEmail?: (subject: string, text: string) => void;
  /** Drafts a reply to what they said last, from the conversation and the
   *  task's directions and steps, in the channel's length (on the server,
   *  /api/ai/draft-message). Never sends. */
  onAiDraft?: (channel: TalkChannel, taskId: string | null) => Promise<{ subject?: string; body: string } | null>;
  /** Automatic messages whole, or one muted line each (kept per person). */
  showAutomatic: boolean;
  onShowAutomatic: (show: boolean) => void;
  /** When this person last opened this client's Conversation. */
  seenAt: string | null;
  /** Opened (and closed) now. */
  onSeen: () => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const drafts = buildFeedDrafts(draftDeps);
  const [filter, setFilter] = useState<"all" | TalkChannel>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Answer the way they wrote: the channel of their newest message, until
  // another is picked (Derek, 2026-10-14).
  const [channel, setChannel] = useState<TalkChannel | null>(null);
  const answerBy = useMemo(() => defaultChannel(messages, channels), [messages, channels]);
  const ch = channel && channels.includes(channel) ? channel : answerBy;
  const [subject, setSubject] = useState<string | null>(null);
  const [text, setText] = useState("");
  // The box is one line until it is clicked or focused.
  const [writing, setWriting] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (writing) box.current?.focus(); }, [writing]);
  const talk = useMemo(() => messages.filter(isTalk).sort(byTime), [messages]);
  // They wrote last and nobody answered yet: a red line above that message.
  const waiting = useMemo(() => waitingOnReply(messages), [messages]);
  const has = new Set(talk.map((m) => m.channel));
  const shown = useMemo(() => (filter === "all" ? talk : talk.filter((m) => m.channel === filter)), [talk, filter]);
  const shownDrafts = filter === "all" ? drafts : drafts.filter((x) => x.d.kind === filter);
  // When you last looked, as it was when this opened: opening it now is the
  // new last look, said on the way in and again on the way out.
  const [seenBefore] = useState(seenAt);
  const seenRef = useRef(onSeen);
  useEffect(() => { seenRef.current = onSeen; });
  useEffect(() => { seenRef.current(); return () => seenRef.current(); }, []);
  const rows = useMemo(() => feedRows(shown, { showAutomatic, seenAt: seenBefore }), [shown, showAutomatic, seenBefore]);
  const autoCount = useMemo(() => shown.filter((m) => automaticKind(m)).length, [shown]);
  const [openAuto, setOpenAuto] = useState<Set<string>>(new Set());
  const where = ch ? whereFor(ch) : null;
  // The task a new message goes on: picked under the box, else where the
  // newest message says (whereNewMessageGoes). "" is no task.
  const [picked, setPicked] = useState<string | null>(null);
  const onTask = picked === null ? where?.taskId ?? null : picked || null;
  const options = onTask && !taskOptions.some((t) => t.id === onTask) ? [{ id: onTask, title: taskTitle(onTask) ?? "This task" }, ...taskOptions] : taskOptions;
  const canSendHere = !!ch && (ch !== "chat" || !!onTask);
  const emailSubject = subject ?? answering?.subject ?? "";

  // The newest at the bottom, in view, as it opens, as messages come in and
  // as the box opens or folds (it takes room from the feed).
  const scroller = useRef<HTMLDivElement>(null);
  const count = rows.length + shownDrafts.length;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [count, writing]);
  // When the box grows (Email's subject, a bigger box, a draft from the AI),
  // the feed keeps what was at its bottom in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let h = el.clientHeight;
    const ro = new ResizeObserver(() => { const now = el.clientHeight; if (now < h) el.scrollTop += h - now; h = now; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    try { await f(); } finally { setBusy(null); }
  };
  const send = () => {
    if (!ch || !canSendHere || !text.trim()) return;
    void run("compose", async () => {
      const ok = await onSend(ch, ch === "email" ? emailSubject.trim() : "", text.trim(), ch === "email" ? answering?.id ?? null : null, onTask);
      if (ok) { setText(""); setSubject(null); setWriting(false); }
    });
  };
  const draftWithAi = async () => {
    if (!ch || !onAiDraft || aiBusy) return;
    setAiBusy(true);
    try {
      const d = await onAiDraft(ch, onTask);
      if (d?.body.trim()) {
        setText(d.body.trim());
        if (ch === "email" && d.subject && !emailSubject.trim()) setSubject(d.subject);
        box.current?.focus();
      }
    } finally { setAiBusy(false); }
  };
  const whoOf = (m: Message) => (m.direction === "inbound" ? first : !m.createdBy || m.createdBy === meId ? "You" : (nameOf(m.createdBy) ?? "").split(/\s+/)[0] || "We");
  const divider = "flex items-center gap-2 text-[16px] font-semibold";
  const link = "font-semibold text-accent hover:underline disabled:opacity-40";
  const editingDraft = drafts.find((x) => x.d.id === editing) ?? null;
  // The task a new message goes on, as small text under the box.
  const onPicker = (
    <label className="mt-1 flex min-w-0 items-center gap-1 text-[16px] text-muted">
      <span className="shrink-0">On:</span>
      <select value={onTask ?? ""} onChange={(e) => setPicked(e.target.value)} aria-label="The task this message goes on"
        className="h-8 min-w-0 flex-1 truncate rounded-[5px] bg-transparent px-1 text-[16px] font-semibold text-accent outline-none hover:bg-background">
        {options.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        <option value="" disabled={ch === "chat"}>No task (the conversation)</option>
      </select>
    </label>
  );

  return (
    <aside aria-label={`Conversation with ${first}`}
      className="safe-top fixed inset-0 z-50 flex flex-col bg-surface text-[16px] sm:inset-y-0 sm:left-auto sm:right-0 sm:z-40 sm:w-[420px] sm:max-w-[92vw] sm:border-l sm:shadow-xl lg:static lg:z-auto lg:max-w-none lg:shrink-0 lg:shadow-none">
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

      {autoCount > 0 && (
        <div className="flex shrink-0 items-center border-b px-4 py-1.5">
          <button onClick={() => onShowAutomatic(!showAutomatic)} aria-pressed={showAutomatic}
            className="flex items-center gap-2 text-left text-[16px] text-muted hover:text-foreground">
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] ring-1 ${showAutomatic ? "bg-accent text-white ring-accent" : "ring-[var(--border)]"}`}>{showAutomatic && <I.check />}</span>
            Show automatic messages ({autoCount})
          </button>
        </div>
      )}

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden px-4 py-3">
        {!shown.length && !shownDrafts.length && <p className="my-auto text-center text-muted">{filter === "all" ? `Nothing said with ${first} yet.` : `No ${WORD[filter]}s with ${first} yet.`}</p>}
        {rows.map((r) => {
          if (r.kind === "day") return (
            <div key={r.key} className={`${divider} my-1 text-muted`}><span className="h-px flex-1 bg-[var(--border)]" />{r.label}<span className="h-px flex-1 bg-[var(--border)]" /></div>
          );
          if (r.kind === "new") return (
            <div key={r.key} className={`${divider} text-accent`}><span className="h-px flex-1 bg-accent" />New since you last looked<span className="h-px flex-1 bg-accent" /></div>
          );
          if (r.kind === "task") {
            const title = r.taskId ? taskTitle(r.taskId) : null;
            return (
              <div key={r.key} className="mt-1 min-w-0 text-[16px] text-muted">
                {r.taskId && title ? <button onClick={() => onOpenTask(r.taskId!)} title="Open the task" className="group max-w-full break-words text-left">On: <span className="font-semibold text-accent group-hover:underline">{title} ›</span></button>
                  : r.taskId ? "On a task that is gone" : "Not on a task"}
              </div>
            );
          }
          if (r.kind === "auto" && !openAuto.has(r.m.id)) return (
            <button key={r.key} onClick={() => setOpenAuto((s) => new Set(s).add(r.m.id))} title={`${dayTime(r.m.at)}: ${plainLine(r.m.body).slice(0, 140) || r.m.subject || ""}`}
              className={`${r.m.direction === "outbound" ? "self-end text-right" : "self-start text-left"} max-w-full text-[16px] text-muted hover:text-foreground`}>
              Automatic: {r.label} <span className="whitespace-nowrap">· {shortDay(r.m.at)}</span>
            </button>
          );
          const m = r.m;
          const auto = r.kind === "auto" ? r.label : r.auto;
          const unanswered = waiting?.id === m.id ? (
            <p className="mt-1 self-start text-[16px] font-semibold text-danger">{waitingLine(first, m.at)}</p>
          ) : null;
          const mine = m.direction === "outbound";
          const bubble = (
            <div key={r.key} className={`max-w-[88%] rounded-[5px] px-3 py-2 ${mine ? "self-end bg-accent-soft" : "self-start bg-surface ring-1 ring-[var(--border)]"} ${auto ? "opacity-80" : ""}`}>
              <div className="text-[16px] text-muted">
                {auto ? (mine ? "Automatic" : `${whoOf(m)}, automatic`) : whoOf(m)} · {WORD[m.channel as TalkChannel]} · <span title={dayTime(m.at)}>{messageStamp(m.at)}</span>
                {!mine && !m.read && <b className="ml-1.5 text-accent">New</b>}
                {r.kind === "auto" && <button onClick={() => setOpenAuto((s) => { const n = new Set(s); n.delete(m.id); return n; })} className="ml-1.5 font-semibold text-accent hover:underline">Fold</button>}
              </div>
              {m.channel === "email" && m.subject && <b className="block break-words">{m.subject}</b>}
              <FeedBody m={m} link={link} />
              {(m.attachments?.length ?? 0) > 0 && <FeedFiles m={m} onOpenFile={onOpenFile} pushToast={draftDeps.pushToast} />}
            </div>
          );
          return unanswered ? <Fragment key={r.key}>{unanswered}{bubble}</Fragment> : bubble;
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

      {/* A new message. One line until clicked; open, it has Email, Text or
          Chat (only the ways they have), the subject for an email, the box,
          Send (the one dark button here), Draft a reply with AI, and the
          task it goes on. Escape on an empty box folds it again. */}
      <div className="shrink-0 border-t px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3"
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !writing) return;
          e.stopPropagation();
          if (!text.trim()) { setWriting(false); (document.activeElement as HTMLElement | null)?.blur?.(); }
        }}>
        {!ch ? <p className="text-muted">Messages are off for {first}, or there is no way to reach them yet.</p> : !writing ? <>
          <button onClick={() => setWriting(true)} onFocus={() => setWriting(true)} aria-label={`Write to ${first}`}
            className="flex h-11 w-full items-center rounded-[5px] border bg-surface px-3 text-left text-[16px] text-muted hover:border-accent">
            <span className="min-w-0 flex-1 truncate">{text.trim() ? text.trim() : `Write to ${first}…`}</span>
            <span className="shrink-0 pl-2">{ch === "email" ? "Email" : ch === "sms" ? "Text" : "Chat"}</span>
          </button>
          {onPicker}
        </> : <>
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
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={ch === "email" ? 5 : 3} aria-label={`Write to ${first}`}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            placeholder={`Write to ${first}…`} className="w-full resize-y rounded-[5px] border bg-surface px-2.5 py-2 text-[16px] outline-none focus:border-accent" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button onClick={send} disabled={!canSendHere || !text.trim() || busy === "compose" || (ch === "email" && !emailSubject.trim())}
              className="h-10 shrink-0 rounded-[5px] bg-accent px-5 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-40">{busy === "compose" ? "Sending…" : "Send"}</button>
            {onAiDraft && (
              <button onClick={() => void draftWithAi()} disabled={aiBusy} title={`Reads the last messages and the task, and writes a ${WORD[ch]} to edit. Nothing sends by itself.`}
                className={`${link} text-[16px]`}>{aiBusy ? "Drafting…" : "Draft a reply with AI"}</button>
            )}
            {ch === "email" && onFullEmail && (
              <button onClick={() => onFullEmail(emailSubject, text)} className="text-[16px] text-muted hover:text-accent hover:underline">Open the full email window</button>
            )}
          </div>
          {onPicker}
          {ch === "chat" && !onTask && <p className="mt-1 text-[16px] text-muted">A portal chat shows on a task, so pick one.</p>}
        </>}
      </div>
      {editingDraft?.editEmail?.(() => setEditing(null))}
    </aside>
  );
}

/** A message's words, cut to a few lines with Show all whenever anything is
 *  cut, ours or theirs, email, text or chat (Derek, 2026-10-14: "I need to be
 *  able to open to read all the email": Justin's reminder was cut at three
 *  lines, but Show all only came past 160 characters, so it never did). Cut
 *  is measured, not guessed from a length. Show all is the whole message as
 *  it is kept, an email with its own formatting. */
function FeedBody({ m, link }: { m: Message; link: string }) {
  const [full, setFull] = useState(false);
  const [cut, setCut] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const email = m.channel === "email";
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || full) return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, m.body]);
  const whole = !email ? <div className="whitespace-pre-wrap break-words">{renderRichText(m.body)}</div>
    : looksLikeHtml(m.body) ? <div className="rte-content break-words text-[16px]" dangerouslySetInnerHTML={{ __html: safeMessageHtml(m.body) }} />
    : <p className="whitespace-pre-wrap break-words">{renderRichText(m.body)}</p>;
  return (
    <>
      {full ? whole : email
        ? <div ref={box} className="line-clamp-3 break-words">{plainLine(m.body)}</div>
        : <div ref={box} className="line-clamp-6 whitespace-pre-wrap break-words">{renderRichText(m.body)}</div>}
      {(cut || full) && (
        <button onClick={() => setFull((f) => !f)} aria-expanded={full} className={`${link} text-[16px]`}>{full ? "Show less" : "Show all"}</button>
      )}
    </>
  );
}

/** A message's files (Derek, 2026-10-14: "Also can't see images"): each
 *  picture as itself, read when the card comes into view, a click opening the
 *  full size viewer with Download; any other file a chip that opens or
 *  downloads it. Stored files by a signed link, Gmail's through
 *  /api/inbox/attachment with the person's token, as the Inbox reads them. */
function FeedFiles({ m, onOpenFile, pushToast }: { m: Message; onOpenFile?: (path: string) => void; pushToast: (text: string) => void }) {
  const { pictures, files } = useMemo(() => feedFiles(m), [m]);
  // Read again only when its pictures change, not each time the feed's
  // messages are refreshed.
  const sig = `${m.id}:${pictures.map(feedFileKey).join("|")}`;
  const latest = useRef({ m, pictures });
  useEffect(() => { latest.current = { m, pictures }; });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [big, setBig] = useState<number | null>(null);
  // Read as the card comes into view (at once where that can't be told).
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setSeen(true); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    const { m, pictures } = latest.current;
    if (!seen || !pictures.length) return;
    let live = true;
    const made: string[] = [];
    void Promise.all(pictures.map(async (a): Promise<[string, string] | null> => {
      const src = feedFileSource(m, a);
      try {
        if (src?.from === "storage") { const u = await signedUrlForFile(src.path); return u ? [feedFileKey(a), u] : null; }
        if (src?.from === "gmail") {
          const res = await authedFetch(src.href);
          if (!res.ok) return null;
          const u = URL.createObjectURL(await res.blob());
          made.push(u);
          return [feedFileKey(a), u];
        }
      } catch { /* left as a chip */ }
      return null;
    })).then((got) => { if (live) setUrls(Object.fromEntries(got.filter((x): x is [string, string] => !!x))); });
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [seen, sig]);
  const shown = pictures.filter((a) => urls[feedFileKey(a)]);
  const saveAs = (href: string, name: string) => {
    const el = document.createElement("a");
    el.href = href; el.download = name || "file"; el.rel = "noopener noreferrer";
    document.body.appendChild(el); el.click(); el.remove();
  };
  // Another file: opened (stored, or a link) or saved under its own name (Gmail's).
  const openFile = async (a: Attachment) => {
    const src = feedFileSource(m, a, true);
    if (src?.from === "storage") { if (onOpenFile) onOpenFile(src.path); else { const u = await signedUrlForFile(src.path); if (u) window.open(u, "_blank", "noopener"); else pushToast(`Couldn't open ${a.name}`); } return; }
    if (src?.from === "link") { window.open(src.url, "_blank", "noopener,noreferrer"); return; }
    if (src?.from === "gmail") {
      const res = await authedFetch(src.href).catch(() => null);
      if (!res?.ok) { pushToast(`Couldn't download ${a.name}`); return; }
      const u = URL.createObjectURL(await res.blob());
      saveAs(u, a.name);
      setTimeout(() => URL.revokeObjectURL(u), 10_000);
      return;
    }
    pushToast(`${a.name} isn't kept anywhere the app can open it`);
  };
  const download = async (a: Attachment) => {
    const src = feedFileSource(m, a);
    if (src?.from === "storage") { const u = await downloadUrlForFile(src.path, a.name); if (u) window.open(u, "_blank", "noopener"); else pushToast(`Couldn't download ${a.name}`); return; }
    const u = urls[feedFileKey(a)];
    if (u) saveAs(u, a.name);
  };
  if (!pictures.length && !files.length) return null;
  return (
    <div ref={wrap} className="mt-1.5">
      <EmailFiles small files={[...pictures, ...files]} urls={urls}
        onOpenPicture={(a) => { const i = shown.indexOf(a); if (i >= 0) setBig(i); }}
        onOpenFile={(a) => void openFile(a)} />
      {big !== null && shown[big] && (
        <ImageLightbox images={shown.map((a) => ({ id: feedFileKey(a), name: a.name, url: urls[feedFileKey(a)] }))} index={big} onIndex={setBig} onClose={() => setBig(null)}
          onDownload={(img) => { const a = shown.find((x) => feedFileKey(x) === img.id); if (a) void download(a); }} />
      )}
    </div>
  );
}
