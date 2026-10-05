"use client";

// The window for texting a client, built like the email window (Derek,
// 2026-10-05: "make it better and clean like email"). Opens over the page from
// the client's Messages box, Request a meeting, and the Journal's SMS. The
// draft is kept in this browser per client until it sends or is discarded.
import { useEffect, useRef, useState } from "react";
import { timeAgo, type Message } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import { BookingLinkMenu } from "./BookingLinkMenu";
import { SchedulePopover } from "./SchedulePopover";
import { WorkItemWindow, quietButton as quiet } from "./TaskWorkItem";

const key = (clientId: string) => `cut:text-draft:${clientId}`;
const readDraft = (clientId: string) => { try { return localStorage.getItem(key(clientId)) ?? ""; } catch { return ""; } };
const writeDraft = (clientId: string, v: string) => { try { if (v.trim()) localStorage.setItem(key(clientId), v); else localStorage.removeItem(key(clientId)); } catch { /* private window */ } };

// One text is 160 plain characters, or 70 once an emoji or accent is in it;
// longer ones go as several parts joined back together on their phone.
function segments(text: string): { per: number; parts: number } {
  const unicode = /[^\x00-\x7F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { per: single, parts: text.length <= single ? 1 : Math.ceil(text.length / multi) };
}

export function TextWindow({ clientId, clientName, toName, toPhone, start, history, meId, onClose, onSend, onSchedule, onAiDraft, pushToast }: {
  clientId: string;
  clientName: string;
  toName: string;
  toPhone: string | null;
  /** Words to start with (Request a meeting); a saved draft asks first. */
  start?: string;
  /** Their recent texts, newest last, shown beside the box. */
  history: Message[];
  meId: string;
  onClose: () => void;
  onSend?: (body: string) => Promise<unknown> | void;
  onSchedule?: (body: string, whenIso: string) => Promise<unknown> | void;
  onAiDraft?: (instruction: string) => Promise<{ body: string } | null>;
  pushToast: (text: string) => void;
}) {
  const [body, setBody] = useState(() => {
    const saved = readDraft(clientId);
    if (start && saved.trim() && saved !== start && !window.confirm(`You already started a text to ${toName}. Replace it with this one?`)) return saved;
    return start ?? saved;
  });
  const [busy, setBusy] = useState<"send" | "ai" | null>(null);
  const [ai, setAi] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { writeDraft(clientId, body); }, [clientId, body]);
  useEffect(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);

  const insert = (text: string) => {
    const el = box.current;
    if (!el) { setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}${text}`); return; }
    const a = el.selectionStart ?? body.length, z = el.selectionEnd ?? a;
    const before = body.slice(0, a), after = body.slice(z);
    const pad = before && !/\s$/.test(before) ? " " : "";
    setBody(`${before}${pad}${text}${after}`);
    requestAnimationFrame(() => { el.focus(); const at = (before + pad + text).length; el.setSelectionRange(at, at); });
  };
  const cannot = !toPhone ? "No phone number on this contact yet" : !onSend ? "You can't message this client" : !body.trim() ? "Write something first" : null;
  const send = async () => {
    if (cannot || busy) return;
    setBusy("send");
    try { await onSend!(body.trim()); writeDraft(clientId, ""); onClose(); }
    catch { pushToast("Couldn't send the text."); }
    finally { setBusy(null); }
  };
  const schedule = async (whenIso: string) => {
    if (cannot || !onSchedule) return;
    await onSchedule(body.trim(), whenIso);
    writeDraft(clientId, ""); onClose();
  };
  const writeWithAi = async () => {
    if (!onAiDraft) return;
    setBusy("ai");
    try { const r = await onAiDraft(ai.trim()); if (r?.body) { setBody(r.body.replace(/<[^>]+>/g, "").trim()); setAi(""); } }
    finally { setBusy(null); }
  };
  const shorter = async () => {
    if (!body.trim()) return;
    setBusy("ai");
    try {
      const r = await authedFetch("/api/ai/improve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body, channel: "sms", mode: "shorter" }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.text) setBody(j.text); else pushToast(j.error ?? "Couldn't shorten it.");
    } finally { setBusy(null); }
  };
  const { per, parts } = segments(body);

  return (
    <WorkItemWindow icon="💬" onClose={onClose}
      title={<div><p className="px-1 text-[22px] font-bold leading-tight">Text</p><p className="truncate px-1 text-[16px] text-muted">{clientName}</p></div>}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {onAiDraft && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 px-3 py-2">
              <span aria-hidden className="text-[18px]">✨</span>
              <input value={ai} onChange={(e) => setAi(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void writeWithAi(); } }}
                placeholder="Tell AI what this text should say, or leave it blank for a status update" aria-label="Tell AI what to write" disabled={busy !== null}
                className="min-w-0 flex-1 bg-transparent py-1 text-[16px] outline-none" />
              <button onClick={() => void writeWithAi()} disabled={busy !== null} className="rounded-lg bg-accent px-4 py-1.5 text-[16px] font-semibold text-white disabled:opacity-50">{busy === "ai" ? "Writing…" : "Write with AI"}</button>
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border bg-surface shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-[16px] sm:px-6">
              <span className="w-12 shrink-0 font-semibold text-muted sm:w-16">To</span>
              {toPhone ? <span className="min-w-0 flex-1">{toName} <span className="text-muted">· {toPhone}</span></span>
                : <span className="min-w-0 flex-1 text-danger">No phone number on this contact yet, so this can&apos;t be sent.</span>}
            </div>
            <textarea ref={box} value={body} onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
              placeholder={`Write your text to ${toName.split(/\s+/)[0] || "them"}…`} aria-label="Your text"
              className="block min-h-[220px] w-full resize-y bg-transparent px-4 py-4 text-[18px] leading-relaxed outline-none! sm:px-6" />
            <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-[15px] text-muted sm:px-6">
              <span className={parts > 1 ? "font-semibold text-highlight" : ""}>{body.length} / {per}{parts > 1 ? ` · goes as ${parts} texts` : ""}</span>
              <span className="flex-1" />
              <button onClick={() => void shorter()} disabled={busy !== null || !body.trim()} className="font-semibold text-accent hover:underline disabled:opacity-50">✂️ Make it shorter</button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2.5 sm:gap-3">
            <button onClick={() => void send()} disabled={!!cannot || busy !== null} title={cannot ?? "Send (⌘Enter)"}
              className="rounded-lg bg-accent px-6 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">{busy === "send" ? "Sending…" : "Send"}</button>
            {onSchedule && toPhone && <SchedulePopover disabled={!!cannot} onSchedule={(w) => void schedule(w)} />}
            <span className="text-[16px] text-muted">{body.trim() ? "Draft kept until you send" : ""}</span>
            <button onClick={() => { setBody(""); writeDraft(clientId, ""); onClose(); }} className={`ml-auto ${quiet} hover:text-danger`}>Discard</button>
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-0">
          <BookingLinkMenu me={meId} inline label="Add a booking link" title="Put a booking page link in the text" onPick={(l) => insert(l.url)} />
          <div className="rounded-xl border bg-surface p-3">
            <div className="mb-2 text-[14px] font-bold uppercase tracking-wide text-muted">Recent texts</div>
            {history.length ? (
              <div className="space-y-2">
                {history.slice(-6).map((m) => (
                  <div key={m.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-[15px] ${m.direction === "outbound" ? "ml-auto bg-accent text-white" : "bg-background"}`}>
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`mt-0.5 text-[13px] ${m.direction === "outbound" ? "text-white/75" : "text-muted"}`}>{timeAgo(m.at)}</div>
                  </div>
                ))}
              </div>
            ) : <p className="text-[15px] text-muted">No texts with {toName.split(/\s+/)[0] || "them"} yet.</p>}
          </div>
        </div>
      </div>
    </WorkItemWindow>
  );
}
