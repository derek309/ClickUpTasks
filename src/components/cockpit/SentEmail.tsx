"use client";

// A sent email kept on its step's Client work (Derek, 2026-10-12: "keep the
// client box and just show sent, so it doesn't get lost and we can click to
// review"). It says whether the client has written back since; the whole box
// opens the email as it went out.
import { useState } from "react";
import { htmlToText, timeAgo, type Message } from "@/lib/data";
import { reviewTone } from "@/lib/reviewTone";

const CHANNEL_WORD: Partial<Record<Message["channel"], string>> = { email: "email", sms: "text", chat: "the portal" };

/** The client's first message on this task after the email went out. */
export function replyTo(sent: Message, messages: Message[] | null | undefined): Message | null {
  return (messages ?? [])
    .filter((m) => m.direction === "inbound" && m.at > sent.at && (m.taskId === sent.taskId
      || (!!sent.gmailThreadId && m.gmailThreadId === sent.gmailThreadId)
      || (!!sent.ghlConversationId && m.ghlConversationId === sent.ghlConversationId)))
    .sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
}

export function SentEmailBox({ message, messages, firstName, onRemove }: {
  message: Message;
  messages?: Message[] | null;
  firstName: string;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reply = replyTo(message, messages);
  const tone = reviewTone(reply ? "approved" : "with_client");
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="rounded-[5px] border" style={{ background: tone.chip, borderColor: tone.dot }}>
      <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter") toggle(); }} aria-expanded={open}
        className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2">
        <span aria-hidden className="text-[18px]">✉️</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">{message.subject?.trim() || "Email"}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[16px] text-muted">
            <span>Sent {timeAgo(message.at)}</span>
            <span aria-hidden>·</span>
            {reply
              ? <span className="font-semibold" style={{ color: tone.text }}>{firstName} replied by {CHANNEL_WORD[reply.channel] ?? reply.channel} {timeAgo(reply.at)}</span>
              : <span>No reply yet</span>}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-[16px] text-muted">{open ? "Hide" : "Read"}</span>
        {onRemove && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Take off this step (it stays in the conversation)" aria-label="Take this email off the step"
            className="shrink-0 rounded px-1 text-muted hover:text-danger">×</button>
        )}
      </div>
      {open && (
        <div className="max-h-[360px] overflow-y-auto whitespace-pre-wrap border-t bg-surface px-3 py-2.5 text-[16px] leading-relaxed [overflow-wrap:anywhere]">
          {htmlToText(message.body).trim()}
        </div>
      )}
    </div>
  );
}
