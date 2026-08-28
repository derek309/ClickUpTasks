"use client";

// "We're still waiting on these" — a nudge email built from the client's own
// outstanding items, with their portal link so they can answer in place
// (Derek: "when we review it, if we are still waiting on client tasks, can we
// send them a reminder email with the client link").
//
// Always shown for review before it goes. This is outbound client email: the
// app has never sent one without a human reading it first, and a reminder
// that fires at the wrong moment costs more than one that goes a day late.
import { useEffect, useState } from "react";
import { I } from "./ui";
import type { Task } from "@/lib/data";

export function RemindClientModal({ clientName, tasks, link, sending, onSend, onCancel }: {
  clientName: string;
  tasks: Task[];
  link: string | null;
  sending: boolean;
  onSend: (subject: string, body: string) => void;
  onCancel: () => void;
}) {
  const firstName = clientName.trim().split(/\s+/)[0] || "there";
  const [subject, setSubject] = useState(`Quick check on a few things for ${clientName}`);
  const [body, setBody] = useState(
    [
      `Hi ${firstName},`,
      "",
      "We are still waiting on a few things from you before we can move forward:",
      "",
      ...tasks.map((t) => `• ${t.title}`),
      "",
      link ? `You can reply or upload everything right here: ${link}` : "",
      "",
      "Thanks!",
    ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">Remind {clientName}</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {tasks.length} item{tasks.length === 1 ? "" : "s"} we&apos;re waiting on. Edit anything before it goes.
            </p>
          </div>
          <button onClick={onCancel} className="shrink-0 rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block text-[13px] font-medium text-muted">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-[16px] outline-none focus:border-accent" />
          <label className="mt-3 block text-[13px] font-medium text-muted">Message</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12}
            className="mt-1 w-full resize-y rounded-lg border bg-background px-3 py-2 text-[16px] leading-relaxed outline-none focus:border-accent" />
          {!link && (
            <p className="mt-2 text-[13px] text-danger">
              No portal link could be created for this client, so the message has no link in it. An admin needs to create the share link first.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
          <button onClick={() => onSend(subject.trim(), body.trim())} disabled={sending || !subject.trim() || !body.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">
            {sending ? "Sending…" : "Send reminder"}
          </button>
        </div>
      </div>
    </>
  );
}
