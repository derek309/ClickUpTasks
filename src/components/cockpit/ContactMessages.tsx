"use client";

// The "Messages" tab on a Contact (a "cl_" pseudo-client) — real email sent
// and received via GoHighLevel's Conversations API. Unlike ClientNotes, this
// is a genuine two-way conversation with the contact, not an internal log:
// messages are immutable (no edit/delete), shown oldest-first like a real
// thread, with the composer pinned at the bottom instead of the top.
import { useEffect, useRef, useState } from "react";
import { timeAgo, type Message } from "@/lib/data";
import { I } from "./ui";

export function ContactMessages({ messages, canSend, sending, onSend }: {
  messages: Message[];
  canSend: boolean;
  sending: boolean;
  onSend: (subject: string, body: string) => Promise<boolean>;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  const submit = async () => {
    if (!body.trim() || sending) return;
    setError(null);
    const ok = await onSend(subject.trim(), body.trim());
    if (ok) { setSubject(""); setBody(""); }
    else setError("Couldn't send that email. Check the sub-account's GoHighLevel connection in Settings.");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 sm:p-5">
        <div className="mx-auto max-w-3xl space-y-2.5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-10 text-center text-muted">
              <I.inbox />
              <span className="text-[15px]">No messages yet</span>
              <span className="text-[13px]">Email sent here goes out from GoHighLevel; replies show up automatically.</span>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-xl border p-3 ${m.direction === "outbound" ? "bg-accent-soft" : "bg-surface"}`}>
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <span className="font-medium text-foreground">{m.direction === "outbound" ? "You" : "Them"}</span>
                  <span>· {timeAgo(m.at)}</span>
                </div>
                {m.subject && <div className="mt-1 text-[14px] font-semibold">{m.subject}</div>}
                <div className="mt-1 whitespace-pre-wrap text-[15px]">{m.body}</div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {canSend ? (
        <div className="border-t bg-surface p-3 sm:p-4">
          <div className="mx-auto max-w-3xl">
            {error && <div className="mb-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[13px] text-danger">{error}</div>}
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
              className="mb-1.5 w-full rounded-lg border bg-background px-3 py-1.5 text-[14px] outline-none placeholder:text-muted focus:border-accent" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              placeholder="Write an email… (⌘Enter to send)" rows={3}
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent" />
            <div className="mt-2 flex justify-end">
              <button onClick={submit} disabled={!body.trim() || sending} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">
                {sending ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t bg-surface p-3 text-center text-[13px] text-muted">
          This contact isn&apos;t linked to a GoHighLevel contact yet, so email can&apos;t be sent from here.
        </div>
      )}
    </div>
  );
}
