"use client";

// Texting a client, laid out like the Messages app on a phone (Derek,
// 2026-10-05: "build it"): the conversation fills the window, newest at the
// bottom, their texts on the left and ours on the right, the box docked under
// it. Opens over the page from the client's Messages box, Request a meeting
// and the Journal's SMS. The draft is kept in this browser per client until it
// sends or is discarded.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Message } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import { BookingLinkMenu } from "./BookingLinkMenu";
import { SchedulePopover } from "./SchedulePopover";
import { WorkItemWindow, quietButton as quiet } from "./TaskWorkItem";

const TZ = "America/Los_Angeles";
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

// GoHighLevel's own texts (invoices, payment receipts, booking confirmations,
// campaigns) carry no author, so they are told apart by their words. Shown
// small and grey, so what we actually said stands out.
const AUTOMATIC = /\b(invoice|payment of|confirmed your payment|appointment is confirmed|reply stop|text stop|unsubscribe|opt out)\b/i;
const isAutomatic = (m: Message) => m.direction === "outbound" && (m.bulk === true || (!m.createdBy && AUTOMATIC.test(m.body)));

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

export function TextWindow({ clientId, clientName, toName, toPhone, start, history, meId, onClose, onSend, onSchedule, onAiDraft, onPageLink, pushToast }: {
  clientId: string;
  clientName: string;
  toName: string;
  toPhone: string | null;
  /** Words to start with (Request a meeting); a saved draft asks first. */
  start?: string;
  /** Every text with them, oldest first. */
  history: Message[];
  meId: string;
  onClose: () => void;
  onSend?: (body: string) => Promise<unknown> | void;
  onSchedule?: (body: string, whenIso: string) => Promise<unknown> | void;
  onAiDraft?: (instruction: string) => Promise<{ body: string } | null>;
  /** Their client page link, made the first time it's asked for. */
  onPageLink?: () => string | null;
  pushToast: (text: string) => void;
}) {
  const first = toName.split(/\s+/)[0] || "them";
  const [body, setBody] = useState(() => {
    const saved = readDraft(clientId);
    if (start && saved.trim() && saved !== start && !window.confirm(`You already started a text to ${toName}. Replace it with this one?`)) return saved;
    return start ?? saved;
  });
  const [busy, setBusy] = useState<"send" | "ai" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [ai, setAi] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const [today] = useState(() => dayKey(new Date().toISOString()));
  const [yesterday] = useState(() => dayKey(new Date(Date.now() - 86_400_000).toISOString()));

  useEffect(() => { writeDraft(clientId, body); }, [clientId, body]);
  useEffect(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);
  // Newest at the bottom, where you're typing.
  useLayoutEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [history.length]);
  // The box grows with the text, from three lines to about ten.
  useLayoutEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 280)}px`; }, [body]);

  const insert = (text: string) => {
    const el = box.current;
    const a = el?.selectionStart ?? body.length, z = el?.selectionEnd ?? a;
    const before = body.slice(0, a), after = body.slice(z);
    const pad = before && !/\s$/.test(before) ? " " : "";
    setBody(`${before}${pad}${text}${after}`);
    requestAnimationFrame(() => { if (!el) return; el.focus(); const at = (before + pad + text).length; el.setSelectionRange(at, at); });
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
    try { const r = await onAiDraft(ai.trim()); if (r?.body) { setBody(r.body.replace(/<[^>]+>/g, "").trim()); setAi(""); setAiOpen(false); } }
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
  const dayLabel = (k: string) => k === today ? "Today" : k === yesterday ? "Yesterday"
    : new Date(`${k}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(k.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
  const tool = "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[15px] font-semibold text-muted hover:bg-background hover:text-foreground disabled:opacity-50";

  return (
    <WorkItemWindow icon="💬" onClose={onClose}
      title={<div><p className="px-1 text-[22px] font-bold leading-tight">{clientName}</p><p className="truncate px-1 text-[16px] text-muted">{toPhone ? `Text to ${toName} · ${toPhone}` : `${toName} has no phone number yet`}</p></div>}
      actions={<button onClick={() => { setBody(""); writeDraft(clientId, ""); onClose(); }} className={`${quiet} hover:text-danger`}>Discard</button>}>
      <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-[780px] flex-col">
        {/* The conversation, oldest at the top. */}
        <div ref={thread} className="min-h-0 flex-1 overflow-y-auto pb-4 pr-1">
          {history.length === 0 && <p className="py-16 text-center text-muted">No texts with {first} yet. Say hello below.</p>}
          {history.map((m, i) => {
            const k = dayKey(m.at);
            const newDay = i === 0 || dayKey(history[i - 1].at) !== k;
            const auto = isAutomatic(m);
            const ours = m.direction === "outbound";
            return (
              <div key={m.id}>
                {newDay && <div className="my-4 flex items-center gap-3 text-[14px] font-semibold text-muted"><span className="h-px flex-1 bg-[var(--border)]" />{dayLabel(k)}<span className="h-px flex-1 bg-[var(--border)]" /></div>}
                <div className={`mb-2 flex flex-col ${ours ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 ${auto ? "bg-surface text-[15px] text-muted ring-1 ring-[var(--border)]" : ours ? "rounded-br-md bg-accent text-[16px] text-white" : "rounded-bl-md bg-surface text-[16px] ring-1 ring-[var(--border)]"}`}>{m.body}</div>
                  <span className="mt-0.5 px-1 text-[13px] text-muted">{auto ? "Automatic · " : ""}{timeOf(m.at)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* The box, docked under the conversation. */}
        <div className="shrink-0 rounded-2xl border bg-surface shadow-sm">
          {aiOpen && onAiDraft && (
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span aria-hidden>✨</span>
              <input autoFocus value={ai} onChange={(e) => setAi(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void writeWithAi(); } if (e.key === "Escape") { e.stopPropagation(); setAiOpen(false); } }}
                placeholder="What should it say? Leave blank for a status update" aria-label="Tell AI what to write" disabled={busy !== null}
                className="min-w-0 flex-1 bg-transparent py-1 text-[16px] outline-none" />
              <button onClick={() => void writeWithAi()} disabled={busy !== null} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-semibold text-white disabled:opacity-50">{busy === "ai" ? "Writing…" : "Write it"}</button>
            </div>
          )}
          <textarea ref={box} rows={3} value={body} onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
            placeholder={`Text ${first}…`} aria-label="Your text"
            className="block w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[17px] leading-relaxed outline-none!" />
          <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
            <BookingLinkMenu me={meId} up icon="📅" label="Booking link" title="Put a booking page link in the text" onPick={(l) => insert(l.url)} />
            {onPageLink && <button onClick={() => { const u = onPageLink(); if (u) insert(u); }} title={`${first}'s page: what we need from them and what's in progress`} className={tool}>🔗 Their page</button>}
            {onAiDraft && <button onClick={() => setAiOpen(!aiOpen)} aria-pressed={aiOpen} className={`${tool} ${aiOpen ? "bg-accent-soft text-accent" : ""}`}>✨ AI</button>}
            <button onClick={() => void shorter()} disabled={busy !== null || !body.trim()} className={tool}>✂️ Shorter</button>
            <span className="flex-1" />
            <span className={`px-1 text-[14px] ${parts > 1 ? "font-semibold text-highlight" : "text-muted"}`}>{body.length}/{per}{parts > 1 ? ` · ${parts} texts` : ""}</span>
            {onSchedule && toPhone && <SchedulePopover disabled={!!cannot} onSchedule={(w) => void schedule(w)} />}
            <button onClick={() => void send()} disabled={!!cannot || busy !== null} title={cannot ?? "Send (⌘Enter)"}
              className={`h-9 rounded-md px-5 text-[15px] font-bold ${cannot ? "bg-background text-muted" : "bg-accent text-white hover:opacity-90"}`}>{busy === "send" ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </div>
    </WorkItemWindow>
  );
}
