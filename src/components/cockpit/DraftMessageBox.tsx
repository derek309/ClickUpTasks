"use client";

// A text or portal chat for the client, held on its step like the draft email
// (Derek, 2026-10-13: "we should be completing this task, going up to the
// actions, and then creating an email or an SMS"). Read it, edit it, send it;
// sending finishes the step. Saved as you leave the box, not on every key.
import { useState } from "react";

export function DraftMessageBox({ channel, body, firstName, tone, onSave, onSend, onDiscard }: {
  channel: "sms" | "chat";
  body: string;
  firstName: string;
  /** The step's colour while it is the work to do (TaskDrawer stepTone). */
  tone?: { rowTone: string; sayTone: string } | null;
  onSave: (body: string) => void;
  onSend: (body: string) => void;
  onDiscard: () => void;
}) {
  const [text, setText] = useState(body);
  const what = channel === "sms" ? `Text to ${firstName}` : `Chat in ${firstName}'s portal`;
  return (
    <div className={`flex flex-col gap-2 rounded-[5px] border px-3 py-2.5 ${tone ? `${tone.rowTone} pl-4` : "bg-surface"}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden>{channel === "sms" ? "📱" : "💬"}</span>
        <span className={`min-w-0 flex-1 truncate text-[16px] font-semibold ${tone ? tone.sayTone : ""}`}>{what}{text.trim() ? ", ready to read and send" : ""}</span>
        <button onClick={onDiscard} title="Throw this draft away" aria-label="Discard the draft" className="shrink-0 rounded px-1 text-muted hover:text-danger">×</button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== body) onSave(text); }} rows={3} autoFocus={!body}
        placeholder={channel === "sms" ? `What to text ${firstName}` : `What to say to ${firstName}`} aria-label={what}
        className="w-full resize-y rounded-[5px] border bg-surface px-2.5 py-2 text-[16px] outline-none focus:border-accent" />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[16px] text-muted">{channel === "sms" ? "Goes to their phone." : "Shows in their portal."}</span>
        <button onClick={() => { const t = text.trim(); if (t) onSend(t); }} disabled={!text.trim()}
          className="h-9 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-40">Send</button>
      </div>
    </div>
  );
}
