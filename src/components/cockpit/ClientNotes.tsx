"use client";

// The "Knowledge" tab on a client or project — a live team chat feed (meeting
// notes, decisions, FYIs — anything worth keeping), a read-only rollup of
// every comment left on that scope's tasks, and (client-level only, when a
// GHL contact is linked) that contact's email/SMS history for reference —
// one place to catch up on everything without hunting through individual
// tasks or the GHL app. Claude (via the MCP server's list_notes/add_note
// tools) reads and posts to the chat too.
import { useEffect, useRef, useState } from "react";
import { users, userById, timeAgo, NOTE_TYPE_META, NOTE_TYPE_ORDER, type ClientNote, type NoteType, type Task, type Message, type Me } from "@/lib/data";
import { I, Avatar, renderMentions } from "./ui";
import { ConfirmModal, type ConfirmSpec } from "./modals";

export function ClientNotes({ notes, tasks, messages, me, onAdd, onEdit, onDelete, onOpenTask, onOpenMessages }: {
  notes: ClientNote[];
  tasks: Task[]; // already scoped by the caller to the current client/project
  messages?: Message[] | null; // null/undefined = no linked GHL contact at this scope, so no Messages tab
  me: Me;
  onAdd: (type: NoteType, body: string) => void;
  onEdit: (note: ClientNote, body: string) => void;
  onDelete: (note: ClientNote) => void;
  onOpenTask: (taskId: string) => void;
  onOpenMessages?: () => void; // fires once when the Messages tab is opened, to mark them read
}) {
  const [view, setView] = useState<"chat" | "activity" | "messages">("chat");
  const [filter, setFilter] = useState<NoteType | "all">("all");
  const [draftType, setDraftType] = useState<NoteType>("note");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

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
    if (!draft.trim()) return;
    onAdd(draftType, draft.trim());
    setDraft("");
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

      {view === "chat" ? (<>
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
                    ) : (
                      <div className="mt-1 whitespace-pre-wrap rounded-xl rounded-tl-sm border bg-surface px-3 py-2 text-[15px] shadow-soft">{renderMentions(n.body)}</div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={feedEndRef} />
          </div>
        </div>

        <div className="relative shrink-0 border-t bg-surface p-3">
          <div className="mx-auto max-w-3xl">
            {mentionMatch && mentionCands.length > 0 && (
              <div className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-lg border bg-surface shadow-lg">
                {mentionCands.map((u) => (
                  <button key={u.id} onClick={() => setDraft(draft.replace(/@([\w]*)$/, `@${u.name} `))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[15px] hover:bg-background">
                    <Avatar id={u.id} size={22} /> {u.name}{u.role === "va" && <span className="text-[13px] text-muted">VA</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <select value={draftType} onChange={(e) => setDraftType(e.target.value as NoteType)}
                className="mb-0.5 shrink-0 rounded-md border bg-surface px-1.5 py-1.5 text-[13px] outline-none">
                {NOTE_TYPE_ORDER.map((t) => (<option key={t} value={t}>{NOTE_TYPE_META[t].label}</option>))}
              </select>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(mentionMatch && mentionCands.length)) { e.preventDefault(); submit(); } }}
                placeholder="Message the team… (Enter to send, type @ to mention)" rows={1}
                className="max-h-72 min-h-[38px] flex-1 resize-y rounded-xl border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
              <button onClick={submit} disabled={!draft.trim()} className="mb-0.5 shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Send</button>
            </div>
          </div>
        </div>
      </>) : view === "activity" ? (
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
                    <div className="mt-1 whitespace-pre-wrap text-[15px]">{renderMentions(c.body)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mx-auto max-w-3xl space-y-2.5">
            {(!messages || messages.length === 0) && (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-10 text-center text-muted">
                <I.bolt />
                <span className="text-[15px]">No messages yet</span>
                <span className="text-[13px]">Emails and texts with this contact, synced from GoHighLevel, show up here for reference.</span>
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
                <div className="mt-1 whitespace-pre-wrap text-[15px]">{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  );
}
