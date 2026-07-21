"use client";

// Workspace-wide Team Chat — internal team talk that isn't tied to any
// client or project (see supabase/team-chat.sql).
//
// Renders two ways off one implementation:
//   • embedded (no onClose) — fills the Team Chat page's Chat tab. This is
//     the only mount today: "the inbox is really where you review task
//     comments and chat with the team."
//   • overlay (onClose given) — the original modal shell, same as
//     SettingsHub. Currently unused; kept because it's a few lines and the
//     obvious shape for a future quick-peek from another view.
import { useEffect, useRef, useState } from "react";
import { type Me, type TeamMessage, users, userById, timeAgo } from "@/lib/data";
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

  // @mention autocomplete — same idiom as TaskDrawer's and ClientJournal's
  // comment composers. This isn't just a convenience: Cockpit's
  // sendTeamMessage notifies on an exact `@Full Name` match, so picking from
  // this list is what actually makes the mention reach the person. Typing
  // "@justin" by hand matches nobody.
  // The @ must start the draft or follow whitespace, so an email address
  // ("derek@", "me@clickuplocal.com") never opens the picker and never gets
  // its Enter key hijacked into a name completion.
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const mentionMatch = /(^|\s)@([\w]*)$/.exec(draft);
  const mentionCands = mentionMatch && !mentionDismissed ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[2].toLowerCase())) : [];
  const mentionOpen = mentionCands.length > 0;
  const pickMention = (name: string) => setDraft(draft.replace(/(^|\s)@([\w]*)$/, (_m, pre: string) => `${pre}@${name} `));

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
            const isMe = m.authorId === me.id;
            const canDelete = me.role === "admin" || m.authorId === me.id;
            return (
              <div key={m.id} className={`group/msg flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                {!isMe && <Avatar id={m.authorId} size={28} />}
                <div className={`flex min-w-0 max-w-[70%] flex-col ${isMe ? "items-end" : "items-start"}`}>
                  <div className={`flex items-baseline gap-1.5 px-1 ${isMe ? "flex-row-reverse" : ""}`}>
                    {!isMe && <span className="text-[12px] font-semibold">{author?.name ?? "Someone"}</span>}
                    <span className="text-[11px] text-muted">{timeAgo(m.at)}</span>
                    {canDelete && (
                      <button onClick={() => onDelete(m.id)} title="Delete" className="rounded p-0.5 text-muted opacity-0 hover:text-danger group-hover/msg:opacity-100"><I.trash /></button>
                    )}
                  </div>
                  <p className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[14px] ${isMe ? "bg-accent text-white" : "bg-background"}`}>{m.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="relative border-t p-3">
          {mentionOpen && (
            // max-h + scroll: the embedded wrapper is overflow-hidden, so an
            // unbounded list would get clipped at the top and be unreachable
            // once the roster outgrows the window.
            <div className="absolute bottom-full left-3 mb-1 z-10 max-h-56 w-56 overflow-y-auto rounded-lg border bg-surface shadow-lg">
              {mentionCands.map((u) => (
                <button key={u.id} onClick={() => pickMention(u.name)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] hover:bg-background">
                  <Avatar id={u.id} size={22} /> <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  {u.role === "va" && <span className="shrink-0 text-[13px] text-muted">VA</span>}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMentionDismissed(false); }}
            onKeyDown={(e) => {
              // ⌘↵/Ctrl↵ always sends — checked first, so mentioning someone
              // and sending in one motion doesn't silently swallow the send.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); return; }
              if (e.key === "Escape" && mentionOpen) { e.preventDefault(); setMentionDismissed(true); return; }
              // Plain Enter picks the top match only while the list is open.
              if (e.key === "Enter" && !e.shiftKey && mentionOpen) { e.preventDefault(); pickMention(mentionCands[0].name); return; }
            }}
            placeholder="Message the team… (type @ to mention, ⌘↵ to send)"
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
