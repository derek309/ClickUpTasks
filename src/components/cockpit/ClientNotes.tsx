"use client";

// The "Knowledge" tab on a client's page — a typed, freeform log distinct
// from task comments (meetings, content, deliverables, general notes).
// Ported from the "Dispatch" app's client-hub concept. Newest-first with the
// composer pinned at the top — this is a log/wiki, not a live conversation.
import { useState } from "react";
import { userById, timeAgo, NOTE_TYPE_META, NOTE_TYPE_ORDER, type ClientNote, type NoteType, type Me } from "@/lib/data";
import { I, Avatar } from "./ui";
import { ConfirmModal, type ConfirmSpec } from "./modals";

export function ClientNotes({ notes, me, onAdd, onEdit, onDelete }: {
  notes: ClientNote[];
  me: Me;
  onAdd: (type: NoteType, body: string) => void;
  onEdit: (note: ClientNote, body: string) => void;
  onDelete: (note: ClientNote) => void;
}) {
  const [filter, setFilter] = useState<NoteType | "all">("all");
  const [draftType, setDraftType] = useState<NoteType>("note");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);

  const visible = filter === "all" ? notes : notes.filter((n) => n.type === filter);
  const canModify = (n: ClientNote) => me.role === "admin" || n.authorId === me.id;

  const submit = () => {
    if (!draft.trim()) return;
    onAdd(draftType, draft.trim());
    setDraft("");
  };
  const startEdit = (n: ClientNote) => { setEditingId(n.id); setEditBody(n.body); };
  const saveEdit = (n: ClientNote) => { if (editBody.trim()) onEdit(n, editBody.trim()); setEditingId(null); };
  const askDelete = (n: ClientNote) => setConfirmDialog({
    title: "Delete this note?", message: "This can't be undone.", confirmLabel: "Delete",
    onConfirm: () => { setConfirmDialog(null); onDelete(n); },
  });

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border bg-surface p-3">
          <div className="flex items-center gap-2">
            <select value={draftType} onChange={(e) => setDraftType(e.target.value as NoteType)}
              className="rounded-md border bg-background px-2 py-1 text-[13px] outline-none">
              {NOTE_TYPE_ORDER.map((t) => (<option key={t} value={t}>{NOTE_TYPE_META[t].label}</option>))}
            </select>
            <span className="text-[13px] text-muted">Log a note for this client</span>
          </div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
            placeholder="What happened? (⌘Enter to save)" rows={2}
            className="mt-2 w-full resize-none rounded-lg border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
          <div className="mt-2 flex justify-end">
            <button onClick={submit} disabled={!draft.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Save note</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
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

        <div className="mt-3 space-y-2.5">
          {visible.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-10 text-center text-muted">
              <I.comment />
              <span className="text-[15px]">No notes yet</span>
              <span className="text-[13px]">Log meetings, content, and deliverables here as they happen.</span>
            </div>
          )}
          {visible.map((n) => {
            const u = userById(n.authorId);
            const m = NOTE_TYPE_META[n.type];
            return (
              <div key={n.id} className="group/note flex gap-2.5 rounded-xl border bg-surface p-3">
                <Avatar id={n.authorId} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="font-medium">{u?.name ?? "Unknown"}</span>
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0 text-[13px] font-medium" style={{ background: m.color + "1a", color: m.color }}>{m.label}</span>
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
                  ) : (
                    <div className="mt-1 whitespace-pre-wrap text-[15px]">{n.body}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  );
}
