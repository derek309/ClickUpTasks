"use client";

// The client's Conversation (Derek, 2026-10-14, client header mockup): their
// emails, texts and portal chats in time order as a chat, theirs on the left
// and ours on the right, a divider for each day, the task they are on said
// once when it changes (a click opens that task), automatic messages folded
// to one muted line each, and "New since you last looked" above what came in
// since you last opened it; the drafts not sent yet at the bottom, dashed, to
// edit and send right here; and one box to write a new message by email,
// text or chat, on the task picked under it. Beside the task list on a
// desktop, a panel over it on a tablet, the whole screen on a phone. The
// messages are the ones already in memory (the Journal's), nothing is
// fetched here.
import { useEffect, useMemo, useRef, useState } from "react";
import { looksLikeHtml, type Attachment, type Message } from "@/lib/data";
import { safeMessageHtml } from "@/lib/safeHtml";
import { automaticKind, clockTime, feedRows, isTalk, plainLine, shortDay, type ConversationDraft, type TalkChannel } from "@/lib/clientConversation";
import { CollapsibleText, I } from "./ui";
import { AttachmentThumbs } from "./AttachmentThumbs";
import { DraftMessageBox } from "./DraftMessageBox";
import { useEscapeToClose } from "./useEscapeToClose";
import { buildFeedDrafts, type FeedDraftDeps } from "./clientFeedDrafts";

const TZ = "America/Los_Angeles";
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

export function ClientConversation({ first, meId, nameOf, messages, taskTitle, onOpenTask, onOpenFile, draftDeps, channels, whereFor, taskOptions, answering, onSend, onFullEmail, showAutomatic, onShowAutomatic, seenAt, onSeen, onClose }: {
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
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [channel, setChannel] = useState<TalkChannel | null>(channels[0] ?? null);
  const ch = channel && channels.includes(channel) ? channel : channels[0] ?? null;
  const [subject, setSubject] = useState<string | null>(null);
  const [text, setText] = useState("");
  const talk = useMemo(() => messages.filter(isTalk).sort((a, b) => a.at.localeCompare(b.at)), [messages]);
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

  // The newest at the bottom, in view, as it opens and as messages come in.
  const scroller = useRef<HTMLDivElement>(null);
  const count = rows.length + shownDrafts.length;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [count]);

  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    try { await f(); } finally { setBusy(null); }
  };
  const send = () => {
    if (!ch || !canSendHere || !text.trim()) return;
    void run("compose", async () => {
      const ok = await onSend(ch, ch === "email" ? emailSubject.trim() : "", text.trim(), ch === "email" ? answering?.id ?? null : null, onTask);
      if (ok) { setText(""); setSubject(null); }
    });
  };
  const whoOf = (m: Message) => (m.direction === "inbound" ? first : !m.createdBy || m.createdBy === meId ? "You" : (nameOf(m.createdBy) ?? "").split(/\s+/)[0] || "We");
  const divider = "flex items-center gap-2 text-[16px] font-semibold";
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
          const mine = m.direction === "outbound";
          const html = m.channel === "email" && looksLikeHtml(m.body);
          const full = open.has(m.id);
          const words = plainLine(m.body);
          return (
            <div key={r.key} className={`max-w-[88%] rounded-[5px] px-3 py-2 ${mine ? "self-end bg-accent-soft" : "self-start bg-surface ring-1 ring-[var(--border)]"} ${auto ? "opacity-80" : ""}`}>
              <div className="text-[16px] text-muted">
                {auto ? (mine ? "Automatic" : `${whoOf(m)}, automatic`) : whoOf(m)} · {WORD[m.channel as TalkChannel]} · <span title={dayTime(m.at)}>{clockTime(m.at)}</span>
                {!mine && !m.read && <b className="ml-1.5 text-accent">New</b>}
                {r.kind === "auto" && <button onClick={() => setOpenAuto((s) => { const n = new Set(s); n.delete(m.id); return n; })} className="ml-1.5 font-semibold text-accent hover:underline">Fold</button>}
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
            <label className="flex min-w-0 flex-1 items-center gap-1 text-[16px] text-muted">
              <span className="shrink-0">On:</span>
              <select value={onTask ?? ""} onChange={(e) => setPicked(e.target.value)} aria-label="The task this message goes on"
                className="h-10 min-w-0 flex-1 truncate rounded-[5px] bg-surface px-1 text-[16px] font-semibold text-accent outline-none hover:bg-background">
                {options.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                <option value="" disabled={ch === "chat"}>No task (the conversation)</option>
              </select>
            </label>
          </div>
          {ch === "chat" && !onTask && <p className="mt-1 text-[16px] text-muted">A portal chat shows on a task, so pick one.</p>}
          {ch === "email" && onFullEmail && (
            <button onClick={() => onFullEmail(emailSubject, text)} className={`${link} mt-1.5 text-[16px]`}>Open the full email window</button>
          )}
        </>}
      </div>
      {editingDraft?.editEmail?.(() => setEditing(null))}
    </aside>
  );
}
