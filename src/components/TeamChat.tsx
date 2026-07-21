"use client";

// Workspace-wide Team Chat — internal team talk that isn't tied to any
// client or project (see supabase/team-chat.sql).
//
// Renders two ways off one implementation:
//   • embedded (no onClose) — fills the Team Chat page's Chat tab, which is
//     its primary home: "the inbox is really where you review task comments
//     and chat with the team."
//   • overlay (onClose given) — the original lightweight modal, same shell as
//     SettingsHub, still used for quick access from anywhere.
import { useEffect, useRef, useState } from "react";
import { type Me, type TeamMessage, userById, timeAgo } from "@/lib/data";
import { I, Avatar } from "./cockpit/ui";

export default function TeamChat({ me, messages, onSend, onDelete, onClose }: {
  me: Me;
  messages: TeamMessage[];
  onSend: (body: string) => void;
  onDelete: (id: string) => void;
  onClose?: () => void; // omit to embed inline instead of as an overlay
}) {
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));

  // Auto-scroll to the newest message on open and whenever a new one arrives.
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }); }, [sorted.length]);

  const submit = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  // The feed + composer, identical in both modes — only the chrome around
  // them differs (page pane vs centered modal).
  const inner = (
    <>
        <div ref={feedRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {sorted.length === 0 && (
            <div className="py-10 text-center text-[13px] text-muted">No messages yet — say hi 👋</div>
          )}
          {sorted.map((m) => {
            const author = userById(m.authorId);
            const canDelete = me.role === "admin" || m.authorId === me.id;
            return (
              <div key={m.id} className="group/msg flex items-start gap-2.5">
                <Avatar id={m.authorId} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] font-semibold">{author?.name ?? "Someone"}</span>
                    <span className="text-[11px] text-muted">{timeAgo(m.at)}</span>
                    {canDelete && (
                      <button onClick={() => onDelete(m.id)} title="Delete" className="ml-auto shrink-0 rounded p-0.5 text-muted opacity-0 hover:text-danger group-hover/msg:opacity-100"><I.trash /></button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[14px]">{m.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } }}
            placeholder="Message the team… (@name to mention, ⌘↵ to send)"
            rows={2}
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[14px] outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex justify-end">
            <button onClick={submit} disabled={!draft.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">Send</button>
          </div>
        </div>
    </>
  );

  // Embedded: fill the pane. No backdrop, and no title bar — the Team Chat
  // page already has its own header and tabs, so repeating it would be noise.
  if (!onClose) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">{inner}</div>;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold"><I.comment /> Team Chat</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
        </div>
        {inner}
      </div>
    </>
  );
}
