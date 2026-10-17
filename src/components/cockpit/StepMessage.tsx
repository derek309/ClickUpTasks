"use client";

// One link on a teammate's live step, both ways (Derek, 2026-10-17): the
// giver sees "Message Michaella", she sees "Message Derek". It opens a small
// box that posts on the step's own messages, so the back and forth stays on
// the step. Typing @ brings in a teammate (the same picker as task comments,
// lib/data mentionCandidates); the client can't be mentioned here, the thread
// is team only. Whose turn it is never changes.
import { useState } from "react";
import { applyMention, mentionCandidates, type User } from "@/lib/data";
import { Avatar } from "./ui";

export function StepMessage({ toFirst, roster, onSend, startOpen = false, placeholder }: {
  /** Who it goes to, by first name. */
  toFirst: string;
  /** Teammates the @ picker offers (no client, no Claude). */
  roster: User[];
  onSend: (body: string) => void;
  /** Open already: a question waiting on the person looking. */
  startOpen?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState("");
  const cands = mentionCandidates(draft, roster);
  const send = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
    setOpen(false);
  };
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} data-no-open
      className="self-center text-[16px] font-semibold text-accent underline-offset-4 hover:underline sm:self-auto">Message {toFirst}</button>
  );
  return (
    <div data-no-open className="relative w-full min-w-0 sm:flex-1">
      {cands.length > 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-60 overflow-hidden rounded-[5px] border bg-surface shadow-lg">
          {cands.map((u) => (
            <button key={u.id} type="button" onClick={() => setDraft(applyMention(draft, u.name))}
              className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[16px] hover:bg-background">
              <Avatar id={u.id} size={22} /><span className="min-w-0 flex-1 truncate">{u.name.split(" ")[0]}</span>
            </button>
          ))}
        </div>
      )}
      <label htmlFor="step-message" className="sr-only">Message {toFirst}</label>
      <textarea id="step-message" autoFocus={!startOpen} value={draft} rows={2} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); setOpen(false); return; }
          if (e.key === "Enter" && !e.shiftKey && cands.length) { e.preventDefault(); setDraft(applyMention(draft, cands[0].name)); return; }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
        }}
        placeholder={placeholder ?? `What do you need from ${toFirst}? Type @ to bring in a teammate`}
        className="w-full resize-none rounded-[5px] bg-surface px-3 py-2 text-[16px] outline-none ring-1 ring-inset ring-border placeholder:text-muted focus:ring-2 focus:ring-accent" />
      <div className="mt-2 flex items-center justify-end gap-3">
        <button type="button" onClick={() => { setOpen(false); setDraft(""); }} className="text-[16px] font-medium text-muted hover:text-foreground">Cancel</button>
        <button type="button" onClick={send} disabled={!draft.trim()}
          className="min-h-11 rounded-[5px] border bg-surface px-4 text-[16px] font-semibold text-accent hover:bg-background disabled:opacity-40">Send to {toFirst}</button>
      </div>
    </div>
  );
}
