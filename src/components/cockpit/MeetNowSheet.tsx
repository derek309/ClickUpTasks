"use client";

// Meet now (Derek, 2026-10-14): "when a client says let's meet, start a
// meeting right away and send them the link". Opening this starts the
// meeting (api/calendar/meet-now), then offers the link to send: Email or
// Text, whichever the client has, written for them and editable, sent with
// Send like the task's other sends. Nothing goes until Send. On a phone it is
// a sheet along the bottom of the screen.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authedFetch } from "@/lib/supabase";
import { cleanMeetingLink, meetNowEmail, meetNowText } from "@/lib/meetNow";
import { useEscapeToClose } from "./useEscapeToClose";

type Started = { url: string; via: "meet" | "link"; calendar: boolean; again?: boolean; taskId?: string; stepId?: string | null; title?: string };

export function MeetNowSheet({ clientId, taskId, stepId, first, email, phone, savedLink, onSaveLink, onSend, onStarted, onClose, pushToast }: {
  clientId: string;
  /** Started from a task: the steps go on it. From the client page: their open task. */
  taskId?: string | null;
  /** The step it was picked on, which becomes the meeting when it is empty. */
  stepId?: string | null;
  first: string;
  /** The ways to reach them: only these are offered. */
  email: string | null;
  phone: string | null;
  /** Your own meeting link from Settings (Zoom personal room or Meet). */
  savedLink: string | null;
  onSaveLink: (link: string) => void;
  /** Sends through the app's usual email or text path. True once it went. */
  onSend: ((channel: "email" | "sms", subject: string, body: string) => Promise<unknown> | unknown) | null;
  onStarted?: (r: Started) => void;
  onClose: () => void;
  pushToast: (text: string) => void;
}) {
  const [state, setState] = useState<{ kind: "starting" } | { kind: "needLink"; google: boolean } | { kind: "error"; text: string } | ({ kind: "ready" } & Started)>({ kind: "starting" });
  const [linkDraft, setLinkDraft] = useState(savedLink ?? "");
  const [linkError, setLinkError] = useState<string | null>(null);
  const channels = [...(email ? ["email" as const] : []), ...(phone ? ["sms" as const] : [])];
  const [channel, setChannel] = useState<"email" | "sms" | null>(channels[0] ?? null);
  const [subject, setSubject] = useState("Join me now");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  useEscapeToClose(onClose);

  const start = async (link?: string) => {
    setState({ kind: "starting" });
    const res = await authedFetch("/api/calendar/meet-now", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, taskId: taskId ?? undefined, stepId: stepId ?? undefined, link: link ?? savedLink ?? undefined }),
    }).catch(() => null);
    const j = (res ? await res.json().catch(() => ({})) : {}) as Partial<Started> & { needLink?: boolean; google?: boolean; error?: string };
    if (res?.ok && j.needLink) { setState({ kind: "needLink", google: !!j.google }); return; }
    if (!res?.ok || !j.url) { setState({ kind: "error", text: j.error ?? "The meeting couldn't be started." }); return; }
    const r: Started = { url: j.url, via: j.via === "meet" ? "meet" : "link", calendar: !!j.calendar, again: j.again, taskId: j.taskId, stepId: j.stepId ?? null, title: j.title };
    setBody(meetNowText(first, r.url));
    setState({ kind: "ready", ...r });
    onStarted?.(r);
  };
  // Once, as it opens (a ref, so a second render never starts a second meeting).
  const began = useRef(false);
  useEffect(() => {
    if (began.current) return;
    began.current = true;
    void start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAndStart = () => {
    const link = cleanMeetingLink(linkDraft);
    if (!link) { setLinkError("That isn't a link. Paste the whole address, like https://zoom.us/j/1234567890."); return; }
    setLinkError(null);
    onSaveLink(link);
    void start(link);
  };
  const send = async () => {
    if (!onSend || !channel || !body.trim()) return;
    setSending(true);
    const ok = await Promise.resolve(channel === "email" ? onSend("email", subject.trim() || "Join me now", meetNowEmail(body).html) : onSend("sms", "", body.trim())).catch(() => false);
    setSending(false);
    if (ok === false) return; // the send path said why
    pushToast(`Sent the link to ${first} by ${channel === "email" ? "email" : "text"}.`);
    onClose();
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); pushToast("Link copied."); }
    catch { window.prompt("Copy this:", url); }
  };

  const field = "w-full rounded-[5px] bg-surface px-3 text-[16px] outline-none ring-1 ring-inset ring-border focus:ring-accent";
  const quiet = "h-10 rounded-[5px] px-3 text-[16px] font-semibold text-muted hover:bg-background";
  const dark = "h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-50";
  const light = "inline-flex h-10 shrink-0 items-center rounded-[5px] bg-surface px-3 text-[16px] font-semibold text-accent ring-1 ring-inset ring-border hover:bg-background";
  const ready = state.kind === "ready" ? state : null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div role="dialog" aria-label={`Meet with ${first} now`}
        className="fixed inset-x-3 bottom-3 z-[61] grid max-h-[85vh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[5px] bg-surface pb-[env(safe-area-inset-bottom,0px)] text-[16px] text-foreground shadow-2xl ring-1 ring-[var(--border)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-20 sm:w-[min(34rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:pb-0">
        <div className="flex items-start gap-3 border-b px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-bold leading-tight">{ready ? `Meeting with ${first} is on` : `Meet with ${first} now`}</h2>
            <p className="text-muted">
              {state.kind === "starting" ? "Starting the meeting…"
                : ready ? (ready.again ? "Already started. Here is its link again."
                  : ready.via === "meet" ? `Google Meet, on your calendar with ${first} as a guest, for 30 minutes from now.`
                  : `Your meeting link${ready.calendar ? ", on your calendar" : ""}, for 30 minutes from now.`)
                : state.kind === "needLink" ? "Paste your meeting link once and it's kept for next time."
                : "Nothing was started."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-[5px] text-muted hover:bg-background">✕</button>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
          {state.kind === "needLink" && (
            <label className="grid gap-1.5">
              <span className="font-semibold">Your meeting link (Zoom or Meet)</span>
              <input value={linkDraft} onChange={(e) => { setLinkDraft(e.target.value); setLinkError(null); }} onKeyDown={(e) => { if (e.key === "Enter") saveAndStart(); }}
                placeholder="https://zoom.us/j/1234567890" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus className={`${field} h-11`} />
              <span className="text-muted">{state.google ? "Google didn't make a Meet link this time." : "Google Meet links aren't switched on for the team yet."} Your Zoom personal room or a Meet link you reuse works. Change it any time in Settings, Account.</span>
              {linkError && <span className="font-semibold text-danger">{linkError}</span>}
            </label>
          )}
          {state.kind === "error" && <div className="rounded-[5px] bg-danger-soft px-3 py-2 font-semibold text-danger">{state.text}</div>}
          {ready && <>
            <div className="flex min-w-0 items-center gap-2">
              <a href={ready.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-accent underline-offset-4 hover:underline" title={ready.url}>{ready.url.replace(/^https?:\/\//, "")}</a>
              <button onClick={() => void copy(ready.url)} className={light}>Copy</button>
              <a href={ready.url} target="_blank" rel="noopener noreferrer" className={light}>Join now</a>
            </div>
            {channels.length > 0 && onSend ? <>
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="font-semibold">Send the link by</span>
                <span role="radiogroup" aria-label="Send the link by" className="flex gap-1.5">
                  {channels.map((c) => (
                    <button key={c} role="radio" aria-checked={channel === c} onClick={() => setChannel(c)}
                      className={`h-10 rounded-[5px] px-3 text-[16px] font-semibold ring-inset ${channel === c ? "bg-accent-soft text-accent ring-2 ring-accent" : "bg-surface ring-1 ring-border hover:ring-accent"}`}>{c === "email" ? "Email" : "Text"}</button>
                  ))}
                </span>
              </div>
              <span className="text-muted">To {channel === "email" ? email : phone}</span>
              {channel === "email" && (
                <label className="grid gap-1"><span className="font-semibold">Subject</span>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${field} h-10`} /></label>
              )}
              <label className="grid gap-1"><span className="font-semibold">Message</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "sms" ? 3 : 4} className={`${field} resize-y py-2 leading-snug`} /></label>
            </> : (
              <div className="rounded-[5px] bg-background px-3 py-2 text-muted">{onSend ? `No email or phone for ${first}, so copy the link and send it your own way.` : `You can't message ${first} from here, so copy the link and send it your own way.`}</div>
            )}
          </>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
          {state.kind === "needLink" ? <>
            <button onClick={onClose} className={quiet}>Cancel</button>
            <button onClick={saveAndStart} disabled={!linkDraft.trim()} className={dark}>Start the meeting</button>
          </> : ready && channel && onSend ? <>
            <button onClick={onClose} className={quiet}>Not now</button>
            <button onClick={() => void send()} disabled={sending || !body.trim()} className={dark}>{sending ? "Sending…" : channel === "email" ? "Send email" : "Send text"}</button>
          </> : (
            <button onClick={onClose} className={quiet}>Close</button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** On a Meet now step: Join now, and when it started (Derek, 2026-10-14). */
export function JoinNowLine({ meeting }: { meeting: { url: string; start: string; end: string } }) {
  const at = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[16px]">
      <a href={meeting.url} target="_blank" rel="noopener noreferrer" title={meeting.url}
        className="inline-flex h-10 items-center rounded-[5px] bg-surface px-4 font-semibold text-accent ring-1 ring-inset ring-accent/50 hover:bg-background">Join now</a>
      <span className="text-muted">Started {at(meeting.start)}, until {at(meeting.end)}</span>
    </div>
  );
}
