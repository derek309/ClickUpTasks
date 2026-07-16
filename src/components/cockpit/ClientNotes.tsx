"use client";

// The "Chat" tab on a client or project — a live team chat feed (meeting
// notes, decisions, FYIs — anything worth keeping, images pasted right in),
// a read-only rollup of every comment left on that scope's tasks, and
// (client-level only, when a GHL contact is linked) that contact's full
// email/SMS conversation — sent via GHL from right here, received via the
// inbound webhook — so there's no gap and no need to poll GHL for updates.
// Claude (via the MCP server's list_notes/add_note tools) reads and posts to
// the chat too. Every image attached here also shows up in the Vault tab.
import { useEffect, useRef, useState } from "react";
import { users, userById, timeAgo, NOTE_TYPE_META, NOTE_TYPE_ORDER, type ClientNote, type NoteType, type Task, type Message, type MessageChannel, type Me, type Attachment } from "@/lib/data";
import { I, Avatar, CollapsibleText } from "./ui";
import { ConfirmModal, type ConfirmSpec } from "./modals";
import { AttachmentThumbs } from "./AttachmentThumbs";

export function ClientNotes({ notes, tasks, messages, me, onAdd, onEdit, onDelete, onOpenTask, onOpenMessages, onSendMessage, sendingMessage, onUploadImage, onOpenFile }: {
  notes: ClientNote[];
  tasks: Task[]; // already scoped by the caller to the current client/project
  messages?: Message[] | null; // null/undefined = no linked GHL contact at this scope, so no Messages tab
  me: Me;
  onAdd: (type: NoteType, body: string, attachments?: Attachment[]) => void;
  onEdit: (note: ClientNote, body: string) => void;
  onDelete: (note: ClientNote) => void;
  onOpenTask: (taskId: string) => void;
  onOpenMessages?: () => void; // fires once when the Messages tab is opened, to mark them read
  onSendMessage?: (channel: MessageChannel, subject: string, body: string) => void;
  sendingMessage?: boolean;
  onUploadImage: (file: File) => Promise<Attachment | null>;
  onOpenFile: (path: string) => void;
}) {
  const [view, setView] = useState<"chat" | "activity" | "messages">("chat");
  const [filter, setFilter] = useState<NoteType | "all">("all");
  const [draftType, setDraftType] = useState<NoteType>("note");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const [msgChannel, setMsgChannel] = useState<MessageChannel>("email");
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [pendingAtts, setPendingAtts] = useState<Attachment[]>([]);
  const [uploadingAtt, setUploadingAtt] = useState(false);

  // Resizable composer sidebar — same drag-to-resize-the-left-edge pattern
  // as TaskDrawer's Activity column, so the Chat tab reads the same way:
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

  // notes arrives newest-first (matches every other feed in the app); a chat
  // reads oldest-to-newest, so flip it just for display.
  const filtered = filter === "all" ? notes : notes.filter((n) => n.type === filter);
  const chatOrder = [...filtered].reverse();
  const canModify = (n: ClientNote) => me.role === "admin" || n.authorId === me.id;

  // Same @mention pattern as task comments: type @ to search teammates, pick
  // one to insert "@Name ", and onAdd's caller notifies them on send.
  const mentionMatch = /@([\w]*)$/.exec(draft);
  const mentionCands = mentionMatch ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[1].toLowerCase())) : [];

  useEffect(() => { if (view === "chat") feedEndRef.current?.scrollIntoView({ block: "end" }); }, [notes.length, view]);

  const submit = () => {
    if (!draft.trim() && pendingAtts.length === 0) return;
    onAdd(draftType, draft.trim(), pendingAtts.length ? pendingAtts : undefined);
    setDraft(""); setPendingAtts([]);
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
  const submitMessage = () => {
    if (!msgBody.trim() || !onSendMessage) return;
    onSendMessage(msgChannel, msgSubject, msgBody.trim());
    setMsgSubject(""); setMsgBody("");
  };
  const startEdit = (n: ClientNote) => { setEditingId(n.id); setEditBody(n.body); };
  const saveEdit = (n: ClientNote) => { if (editBody.trim()) onEdit(n, editBody.trim()); setEditingId(null); };
  const askDelete = (n: ClientNote) => setConfirmDialog({
    title: "Delete this message?", message: "This can't be undone.", confirmLabel: "Delete",
    onConfirm: () => { setConfirmDialog(null); onDelete(n); },
  });

  // Every real comment (not system "moved status"-style events) across the
  // in-scope tasks, newest first, each linking back to its task.
  const activity = tasks
    .flatMap((t) => t.comments.filter((c) => c.kind !== "event").map((c) => ({ ...c, taskId: t.id, taskTitle: t.title })))
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between border-b bg-surface px-4 py-2 sm:px-5">
        <div className="inline-flex overflow-hidden rounded-md border">
          <button onClick={() => setView("chat")} className={`px-2.5 py-1.5 text-[13px] font-medium ${view === "chat" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Chat</button>
          <button onClick={() => setView("activity")} className={`px-2.5 py-1.5 text-[13px] font-medium ${view === "activity" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Task Activity · {activity.length}</button>
          {messages != null && (
            <button onClick={() => { setView("messages"); onOpenMessages?.(); }} className={`px-2.5 py-1.5 text-[13px] font-medium ${view === "messages" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Messages · {messages.length}</button>
          )}
        </div>
        {view === "chat" && (
          <div className="flex flex-wrap justify-end gap-1.5">
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
          </div>
        )}
      </div>

      {view === "chat" ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="mx-auto max-w-3xl space-y-3">
              {chatOrder.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><I.comment /></span>
                  <span className="text-[15px] font-medium">No messages yet</span>
                  <span className="max-w-[260px] text-[13px] leading-relaxed">Meeting notes, decisions, FYIs — anything worth keeping lives here, for the team and for Claude.</span>
                </div>
              )}
              {chatOrder.map((n) => {
                const u = userById(n.authorId);
                const m = NOTE_TYPE_META[n.type];
                return (
                  <div key={n.id} className="group/note flex gap-2.5">
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
                            className="w-full resize-none rounded-lg border bg-surface px-2 py-1.5 text-[15px] outline-none focus:border-accent" />
                          <div className="mt-1.5 flex gap-2">
                            <button onClick={() => saveEdit(n)} className="rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-white">Save</button>
                            <button onClick={() => setEditingId(null)} className="rounded-md px-2.5 py-1 text-[13px] text-muted hover:bg-background">Cancel</button>
                          </div>
                        </div>
                      ) : (<>
                        {n.body && <CollapsibleText text={n.body} className="mt-1 whitespace-pre-wrap rounded-xl rounded-tl-sm border bg-surface px-3 py-2 text-[15px] shadow-soft" />}
                        {n.attachments && n.attachments.length > 0 && (
                          <div className="mt-1.5"><AttachmentThumbs items={n.attachments} onOpen={onOpenFile} /></div>
                        )}
                      </>)}
                    </div>
                  </div>
                );
              })}
              <div ref={feedEndRef} />
            </div>
          </div>

          <div className="relative flex shrink-0 flex-col border-l bg-surface" style={{ width: composerW }}>
            <div onMouseDown={startComposerResize} title="Drag to resize"
              className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/30 active:bg-accent/40" />
            <div className="border-b px-3 py-2.5 text-[13px] font-semibold text-muted">Write a message</div>
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <select value={draftType} onChange={(e) => setDraftType(e.target.value as NoteType)}
                className="mb-2 shrink-0 rounded-md border bg-background px-1.5 py-1.5 text-[13px] outline-none">
                {NOTE_TYPE_ORDER.map((t) => (<option key={t} value={t}>{NOTE_TYPE_META[t].label}</option>))}
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
                  placeholder="Message the team… (Enter to send, Shift+Enter for a new line, type @ to mention, paste to attach an image)"
                  className="h-full min-h-[160px] w-full resize-none rounded-xl border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
              </div>
              <button onClick={submit} disabled={!draft.trim() && pendingAtts.length === 0}
                className="mt-2 shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Send</button>
            </div>
          </div>
        </div>
      ) : view === "activity" ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mx-auto max-w-3xl space-y-2.5">
            {activity.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-10 text-center text-muted">
                <I.comment />
                <span className="text-[15px]">No task comments yet</span>
                <span className="text-[13px]">Every comment left on this scope&apos;s tasks shows up here.</span>
              </div>
            )}
            {activity.map((c) => {
              const u = userById(c.authorId);
              return (
                <button key={c.id} onClick={() => onOpenTask(c.taskId)} className="flex w-full gap-2.5 rounded-xl border bg-surface p-3 text-left hover:border-accent">
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
          </div>
        </div>
      ) : (<>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mx-auto max-w-3xl space-y-2.5">
            {(!messages || messages.length === 0) && (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-10 text-center text-muted">
                <I.bolt />
                <span className="text-[15px]">No messages yet</span>
                <span className="text-[13px]">Emails and texts with this contact — sent from here, received via GoHighLevel — show up in one conversation.</span>
              </div>
            )}
            {[...(messages ?? [])].sort((a, b) => a.at.localeCompare(b.at)).map((m) => (
              <div key={m.id} className={`rounded-xl border p-3 ${m.direction === "inbound" ? "bg-surface" : "bg-accent-soft/40"}`}>
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0 font-medium" style={{ background: (m.channel === "email" ? "#3b82f6" : "#22c55e") + "1a", color: m.channel === "email" ? "#3b82f6" : "#22c55e" }}>
                    {m.channel === "email" ? "Email" : "SMS"}
                  </span>
                  <span>{m.direction === "inbound" ? "Received" : "Sent"}</span>
                  <span>· {timeAgo(m.at)}</span>
                </div>
                {m.subject && <div className="mt-1 text-[15px] font-medium">{m.subject}</div>}
                <CollapsibleText text={m.body} className="mt-1 whitespace-pre-wrap text-[15px]" />
              </div>
            ))}
          </div>
        </div>

        {onSendMessage && (
          <div className="shrink-0 border-t bg-surface p-3">
            <div className="mx-auto max-w-3xl">
              <div className="mb-2 inline-flex overflow-hidden rounded-md border">
                <button onClick={() => setMsgChannel("email")} className={`px-2.5 py-1 text-[13px] font-medium ${msgChannel === "email" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>Email</button>
                <button onClick={() => setMsgChannel("sms")} className={`px-2.5 py-1 text-[13px] font-medium ${msgChannel === "sms" ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}>SMS</button>
              </div>
              {msgChannel === "email" && (
                <input value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} placeholder="Subject"
                  className="mb-2 w-full rounded-lg border bg-background px-3 py-1.5 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
              )}
              <div className="flex items-end gap-2">
                <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitMessage(); } }}
                  placeholder={msgChannel === "email" ? "Write an email… (Enter to send)" : "Write a text… (Enter to send)"} rows={1}
                  className="max-h-72 min-h-[38px] flex-1 resize-y rounded-xl border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
                <button onClick={submitMessage} disabled={!msgBody.trim() || sendingMessage} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{sendingMessage ? "Sending…" : "Send"}</button>
              </div>
            </div>
          </div>
        )}
      </>)}
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  );
}
