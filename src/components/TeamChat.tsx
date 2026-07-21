"use client";

// Team Chat + Direct Messages — one component renders both. Team Chat is the
// workspace-wide feed (see supabase/team-chat.sql); a DM is a private 1:1
// thread with one teammate (see supabase/dm-chat.sql). The `scope` prop is
// the only thing that differs structurally: which feed, who to notify, and
// whether @mention makes sense at all (a DM has exactly one addressee by
// construction, so mentioning is meaningless there).
//
// Also carries quote-reply, file/image attachments, and pin — see
// supabase/chat-reply-attachments-pins.sql. Reply and attachments mirror the
// task-comment composer's staging-area pattern (TaskDrawer.tsx); pin is a
// shared team curation flag anyone can toggle, not message ownership.
//
// Renders two ways off one implementation (orthogonal to `scope`):
//   • embedded (no onClose) — fills the Chat hub's pane. This is the only
//     mount today: "the inbox is really where you review task comments and
//     chat with the team."
//   • overlay (onClose given) — the original modal shell, same as
//     SettingsHub. Currently unused; kept because it's a few lines and the
//     obvious shape for a future quick-peek from another view.
import { useEffect, useRef, useState } from "react";
import { type Me, type User, type Attachment, type TeamMessage, type DmMessage, users, userById, timeAgo } from "@/lib/data";
import { I, Avatar, renderRichText } from "./cockpit/ui";
import { AttachmentThumbs } from "./cockpit/AttachmentThumbs";

type Scope = { type: "team" } | { type: "dm"; other: User };
type ChatMessage = TeamMessage | DmMessage;

export default function TeamChat({ me, scope, messages, onSend, onDelete, onPin, onUploadFile, onOpenFile, onClose }: {
  me: Me;
  scope: Scope;
  messages: ChatMessage[];
  onSend: (body: string, attachments?: Attachment[], replyToId?: string | null) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onUploadFile: (file: File) => Promise<Attachment | null>;
  onOpenFile: (path: string) => void;
  onClose?: () => void; // omit to embed inline instead of as an overlay
}) {
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  // Resolves a replyToId to its original message regardless of the pinned
  // filter below — a reply should still show what it's replying to even
  // when browsing pinned-only.
  const byId = new Map(sorted.map((m) => [m.id, m]));
  const pinnedMessages = sorted.filter((m) => m.pinned);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const visible = showPinnedOnly ? pinnedMessages : sorted;

  // Auto-scroll to the newest message on open and whenever a new one arrives.
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }); }, [sorted.length]);

  // A reply-in-progress and staged attachments both live above the composer,
  // cleared together on send — same "stage, then send" shape as TaskDrawer's
  // comment composer (pendingCommentAtts).
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pendingAtts, setPendingAtts] = useState<Attachment[]>([]);
  const [uploadingAtt, setUploadingAtt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const attachFiles = async (files: FileList | File[]) => {
    setUploadingAtt(true);
    // onUploadFile (uploadOneImage) already toasts + returns null on an
    // oversized/failed upload — nothing more to check here.
    for (const f of Array.from(files)) {
      const att = await onUploadFile(f);
      if (att) setPendingAtts((a) => [...a, att]);
    }
    setUploadingAtt(false);
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const f = items[i].kind === "file" ? items[i].getAsFile() : null;
      if (f) files.push(f);
    }
    if (files.length === 0) return;
    e.preventDefault();
    attachFiles(files);
  };

  const submit = () => {
    if (!draft.trim() && pendingAtts.length === 0) return;
    onSend(draft, pendingAtts.length ? pendingAtts : undefined, replyTo?.id ?? null);
    setDraft(""); setPendingAtts([]); setReplyTo(null);
  };

  // @mention autocomplete — team-scope only. Same idiom as TaskDrawer's and
  // ClientJournal's comment composers. This isn't just a convenience:
  // Cockpit's sendTeamMessage notifies on an exact `@Full Name` match, so
  // picking from this list is what actually makes the mention reach the
  // person. Typing "@justin" by hand matches nobody. A DM has exactly one
  // addressee already, so there's nothing to mention.
  // The @ must start the draft or follow whitespace, so an email address
  // ("derek@", "me@clickuplocal.com") never opens the picker and never gets
  // its Enter key hijacked into a name completion.
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const mentionMatch = scope.type === "team" ? /(^|\s)@([\w]*)$/.exec(draft) : null;
  const mentionCands = mentionMatch && !mentionDismissed ? users.filter((u) => u.name.toLowerCase().includes(mentionMatch[2].toLowerCase())) : [];
  const mentionOpen = mentionCands.length > 0;
  const pickMention = (name: string) => setDraft(draft.replace(/(^|\s)@([\w]*)$/, (_m, pre: string) => `${pre}@${name} `));

  // The feed + composer, identical in both modes — only the chrome around
  // them differs (page pane vs centered modal).
  const inner = (
    <>
        {pinnedMessages.length > 0 && (
          <div className="flex shrink-0 items-center border-b bg-background/40 px-4 py-1.5">
            <button onClick={() => setShowPinnedOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium ${showPinnedOnly ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}>
              <I.bookmark filled className="h-3 w-3" /> {showPinnedOnly ? "Showing pinned only — click to show all" : `${pinnedMessages.length} pinned`}
            </button>
          </div>
        )}
        <div ref={feedRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {visible.length === 0 && (
            <div className="py-10 text-center text-[13px] text-muted">
              {scope.type === "dm" ? `No messages yet — say hi to ${scope.other.name} 👋` : "No messages yet — say hi 👋"}
            </div>
          )}
          {visible.map((m) => {
            const author = userById(m.authorId);
            const isMe = m.authorId === me.id;
            const canDelete = me.role === "admin" || m.authorId === me.id;
            const original = m.replyToId ? byId.get(m.replyToId) : null;
            return (
              <div key={m.id} className={`group/msg flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                {!isMe && <Avatar id={m.authorId} size={28} />}
                <div className={`flex min-w-0 max-w-[70%] flex-col ${isMe ? "items-end" : "items-start"}`}>
                  <div className={`flex items-baseline gap-1.5 px-1 ${isMe ? "flex-row-reverse" : ""}`}>
                    {/* In a DM the other person's name is already the thread header — repeating it per-bubble is redundant. */}
                    {!isMe && scope.type === "team" && <span className="text-[12px] font-semibold">{author?.name ?? "Someone"}</span>}
                    <span className="text-[11px] text-muted">{timeAgo(m.at)}</span>
                    <button onClick={() => setReplyTo(m)} title="Reply"
                      className="rounded p-0.5 text-muted opacity-0 hover:text-foreground group-hover/msg:opacity-100">↩</button>
                    <button onClick={() => onPin(m.id, !m.pinned)} title={m.pinned ? "Unpin" : "Pin"}
                      className={`rounded p-0.5 ${m.pinned ? "text-accent opacity-100" : "text-muted opacity-0 hover:text-foreground group-hover/msg:opacity-100"}`}>
                      <I.bookmark filled={m.pinned} className="h-3 w-3" />
                    </button>
                    {canDelete && (
                      <button onClick={() => onDelete(m.id)} title="Delete" className="rounded p-0.5 text-muted opacity-0 hover:text-danger group-hover/msg:opacity-100"><I.trash /></button>
                    )}
                  </div>
                  {m.replyToId && (
                    <div className={`mb-0.5 max-w-full truncate rounded-md border-l-2 border-muted/40 bg-background/60 px-2 py-1 text-[12px] text-muted`}>
                      {original ? <>↩ {userById(original.authorId)?.name ?? "Someone"}: {original.body || "Attachment"}</> : "↩ Original message deleted"}
                    </div>
                  )}
                  {m.body && (
                    <p className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[14px] ${isMe ? "bg-accent text-white [&_a]:!text-white [&_a]:underline" : "bg-background"}`}>{renderRichText(m.body)}</p>
                  )}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-1"><AttachmentThumbs items={m.attachments} onOpen={onOpenFile} /></div>
                  )}
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
          {replyTo && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-accent bg-background px-2.5 py-1.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-accent">Replying to {userById(replyTo.authorId)?.name ?? "Someone"}</div>
                <div className="truncate text-muted">{replyTo.body || "Attachment"}</div>
              </div>
              <button onClick={() => setReplyTo(null)} title="Cancel reply" className="shrink-0 rounded p-0.5 text-muted hover:text-foreground"><I.close className="h-3.5 w-3.5" /></button>
            </div>
          )}
          {(pendingAtts.length > 0 || uploadingAtt) && (
            <div className="mb-2">
              <AttachmentThumbs items={pendingAtts} onRemove={(id) => setPendingAtts((a) => a.filter((x) => x.id !== id))} />
              {uploadingAtt && <div className="mt-1 text-[12px] text-muted">Uploading…</div>}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMentionDismissed(false); }}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // ⌘↵/Ctrl↵ always sends — checked first, so mentioning someone
              // and sending in one motion doesn't silently swallow the send.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); return; }
              if (e.key === "Escape" && mentionOpen) { e.preventDefault(); setMentionDismissed(true); return; }
              // Plain Enter picks the top match only while the list is open.
              if (e.key === "Enter" && !e.shiftKey && mentionOpen) { e.preventDefault(); pickMention(mentionCands[0].name); return; }
            }}
            placeholder={scope.type === "dm" ? `Message ${scope.other.name}… (⌘↵ to send)` : "Message the team… (type @ to mention, ⌘↵ to send)"}
            rows={2}
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[14px] outline-none focus:border-accent"
          />
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) attachFiles(e.target.files); e.target.value = ""; }} />
          <div className="mt-1.5 flex items-center justify-between">
            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingAtt} title="Attach a file"
              className="shrink-0 rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground disabled:opacity-40"><I.clip /></button>
            <button onClick={submit} disabled={!draft.trim() && pendingAtts.length === 0} className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">Send</button>
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
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold"><I.comment /> {scope.type === "dm" ? scope.other.name : "Team Chat"}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
        </div>
        {inner}
      </div>
    </>
  );
}
