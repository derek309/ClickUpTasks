"use client";

// Reminders (Derek and Justin, 2026-10-15, client-reminders-mockup.html):
// every reminder to a client in one place, under Inbox in the sidebar.
// Nothing goes out unseen (REMINDERS_REVIEW_ALL): three parts,
//   To review   waiting now, by client: Approve and send, Edit, Skip, and
//               Approve all for a client
//   Coming up   what the rules will queue on the next few business days if
//               nothing is answered (nothing is made until its day)
//   Sent        newest first, by client if picked
// Each row links to the step it is about. /api/reminders holds the data.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { authedFetch } from "@/lib/supabase";
import { safeMessageHtml } from "@/lib/safeHtml";
import { formatDayDate, htmlToText } from "@/lib/data";
import { RichTextEditor } from "./RichTextEditor";

export type ReminderRow = {
  id: string; clientId: string; clientName: string; to: string | null; taskId: string | null; taskTitle: string | null; stepId: string | null; ask: string | null;
  stage: string; subject: string; body: string; from: string | null; at: string; status: string;
};
export type ComingRow = { day: string; clientId: string; clientName: string; stage: string; ask: string | null; taskTitle: string | null; taskId?: string | null; stepId: string | null; overdue: number; request?: { taskId: string } | null };
export type RemindersData = { toReview: ReminderRow[]; comingUp: ComingRow[]; sent: ReminderRow[] };

/** The link a reminder opens: its task over its client, steps in view
 *  (Derek, 2026-10-15), not the step's own page. */
export const stepHref = (clientId: string, taskId: string) =>
  `/?client=${encodeURIComponent(clientId)}&task=${encodeURIComponent(taskId)}`;

const stageTone = (stage: string) => (/late|summary/.test(stage) ? "text-danger" : /due today/.test(stage) ? "text-highlight" : "text-muted");
const whenSent = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const COMING_STAGE: Record<string, string> = { asked: "asked", reminder: "reminder", due: "due today", late: "late", summary: "summary" };

function StepLink({ row, onOpenStep, children, className }: { row: { clientId: string; taskId: string | null; stepId: string | null }; onOpenStep: (clientId: string, taskId: string, stepId: string | null) => void; children: ReactNode; className?: string }) {
  if (!row.taskId) return <span className={className}>{children}</span>;
  const taskId = row.taskId;
  return (
    <a href={stepHref(row.clientId, taskId)} className={className}
      onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onOpenStep(row.clientId, taskId, row.stepId); }}>{children}</a>
  );
}

export function RemindersView({ nameOf, pushToast, onOpenStep, onCount, initial = null }: {
  nameOf: (memberId: string) => string;
  pushToast: (text: string) => void;
  onOpenStep: (clientId: string, taskId: string, stepId: string | null) => void;
  /** How many wait for review, for the sidebar's badge. */
  onCount?: (n: number) => void;
  /** Stand in data (the visual check); no fetching. */
  initial?: RemindersData | null;
}) {
  const [data, setData] = useState<RemindersData | null>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sentFor, setSentFor] = useState("");
  const [showSent, setShowSent] = useState(false);
  // Read on open, every five minutes, and after each change.
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (initial) return;
    let live = true;
    authedFetch("/api/reminders").then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setData(j as RemindersData); }, () => {});
    return () => { live = false; };
  }, [initial, nonce]);
  useEffect(() => {
    const i = setInterval(load, 5 * 60_000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => { if (data) onCount?.(data.toReview.length); }, [data, onCount]);

  const act = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    if (initial) { setBusy(null); return; }
    const r = await authedFetch("/api/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) { pushToast(j.error ?? "That didn't work. Try again."); return; }
    const row = data?.toReview.find((x) => x.id === body.id);
    if (body.action === "save") { setData((d) => d && { ...d, toReview: d.toReview.map((x) => (x.id === body.id ? { ...x, subject: String(body.subject), body: String(body.body) } : x)) }); setEdit(null); pushToast("Saved. It still waits for Approve."); return; }
    pushToast(body.action === "approve" ? `Sent to ${row?.clientName ?? "them"}` : body.action === "skip" ? `Skipped. ${row?.clientName ?? "They"} won't get that one` : `Sent ${j.sent ?? 0} to ${data?.toReview.find((x) => x.clientId === body.clientId)?.clientName ?? "them"}`);
    if (open === body.id) setOpen(null);
    load();
  };

  // The 8 AM run on demand (Derek, 2026-10-15: "send new reminders to
  // review"): what is due today is queued here for Approve; nothing is sent.
  const makeNow = async () => {
    if (initial) return;
    setBusy("make");
    const r = await authedFetch("/api/cron/portal-reminders?force=1", { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) { pushToast(j.error ?? "That didn't work. Try again."); return; }
    const made = (Number(j.requests?.queued) || 0) + (Number(j.queued) || 0);
    pushToast(made ? `${made} new to review` : "Nothing new is due today");
    load();
  };
  const groups = useMemo(() => {
    const m = new Map<string, ReminderRow[]>();
    for (const r of data?.toReview ?? []) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
    return [...m.values()].sort((a, b) => a[0].clientName.localeCompare(b[0].clientName));
  }, [data]);
  const comingByDay = useMemo(() => {
    const m = new Map<string, ComingRow[]>();
    for (const c of data?.comingUp ?? []) m.set(c.day, [...(m.get(c.day) ?? []), c]);
    return [...m.entries()];
  }, [data]);
  const sentClients = useMemo(() => [...new Map((data?.sent ?? []).map((r) => [r.clientId, r.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data]);
  const sent = (data?.sent ?? []).filter((r) => !sentFor || r.clientId === sentFor);

  if (!data) return <div className="p-6 text-[16px] text-muted">Reading the reminders…</div>;
  const btn = "inline-flex h-10 items-center rounded-[5px] px-3 text-[16px] font-semibold ring-1 ring-inset ring-[var(--border)] hover:bg-background disabled:opacity-50";
  const head = "flex flex-wrap items-baseline gap-x-2 text-[18px] font-bold";
  return (
    <div className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col gap-6 px-4 py-4 sm:px-6">
      <section aria-label="To review" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={head}>To review <span className="text-[16px] font-semibold text-muted">{data.toReview.length ? `${data.toReview.length} waiting for you` : "Nothing waiting"}</span></h2>
          <button disabled={busy === "make"} onClick={() => void makeNow()} title="Queues what is due today for review. Nothing is sent." className={btn}>{busy === "make" ? "Making…" : "Make today's reminders now"}</button>
        </div>
        {!data.toReview.length && <p className="text-[16px] text-muted">Every reminder waits here for Approve before it goes. New ones come at 8 AM, and when a client answers one, the next one about 10 minutes later.</p>}
        {groups.map((rows) => (
          <div key={rows[0].clientId} className="min-w-0 overflow-hidden rounded-[5px] ring-1 ring-inset ring-[var(--border)]">
            <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
              <b className="min-w-0 flex-1 truncate text-[16px]">{rows[0].clientName} <span className="font-semibold text-muted">· {rows.length}</span></b>
              {rows.length > 1 && <button disabled={busy === `all:${rows[0].clientId}`} onClick={() => void act({ action: "approve_all", clientId: rows[0].clientId }, `all:${rows[0].clientId}`)} className={btn}>Approve all</button>}
            </div>
            {rows.map((r) => {
              const isOpen = open === r.id;
              const editing = edit?.id === r.id ? edit : null;
              return (
                <div key={r.id} className="border-b last:border-b-0">
                  <button onClick={() => { setOpen(isOpen ? null : r.id); setEdit(null); }} aria-expanded={isOpen} className="flex w-full min-w-0 items-start gap-3 px-3 py-2.5 text-left hover:bg-background">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] font-semibold [overflow-wrap:anywhere]">{r.ask ?? r.taskTitle ?? (r.stage === "summary" ? "Everything we need" : r.stage === "counts" ? "What we need, in counts" : "Review reminder")}</span>
                      <span className="block truncate text-[16px] text-muted">{r.subject}</span>
                    </span>
                    <span className={`shrink-0 text-[16px] font-semibold ${stageTone(r.stage)}`}>{r.stage}</span>
                  </button>
                  {isOpen && (
                    <div className="flex min-w-0 flex-col gap-2 px-3 pb-3">
                      <div className="text-[16px] text-muted">To {r.to ?? "nobody (no email on file)"} · from {r.from ? nameOf(r.from) : "the team"}{r.taskId && <> · <StepLink row={r} onOpenStep={onOpenStep} className="font-semibold text-accent underline underline-offset-4">Open the task</StepLink></>}</div>
                      {editing ? (<>
                        <input value={editing.subject} onChange={(e) => setEdit({ ...editing, subject: e.target.value })} aria-label="Subject"
                          className="h-10 w-full min-w-0 rounded-[5px] bg-surface px-3 text-[16px] font-semibold outline-none ring-1 ring-inset ring-[var(--border)] focus:ring-accent" />
                        <div className="rounded-[5px] bg-surface p-2 ring-1 ring-inset ring-[var(--border)]"><RichTextEditor key={`rem-${r.id}`} variant="email" value={editing.body} onChange={(v) => setEdit((x) => (x ? { ...x, body: v } : x))} /></div>
                        <div className="flex flex-wrap gap-2">
                          <button disabled={busy === r.id} onClick={() => void act({ id: r.id, action: "save", subject: editing.subject, body: editing.body }, r.id)} className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-bold text-white disabled:opacity-50">Save</button>
                          <button onClick={() => setEdit(null)} className={btn}>Cancel</button>
                        </div>
                      </>) : (<>
                        <div className="rte-content max-h-[50vh] min-w-0 overflow-y-auto rounded-[5px] bg-background px-4 py-3 text-[16px] [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: safeMessageHtml(r.body) }} />
                        <div className="flex flex-wrap items-center gap-2">
                          <button disabled={busy === r.id || !r.to} onClick={() => void act({ id: r.id, action: "approve" }, r.id)} className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-bold text-white disabled:opacity-50">{busy === r.id ? "Sending…" : "Approve and send"}</button>
                          <button onClick={() => setEdit({ id: r.id, subject: r.subject, body: r.body })} className={btn}>Edit</button>
                          <span className="flex-1" />
                          <button disabled={busy === r.id} onClick={() => void act({ id: r.id, action: "skip" }, r.id)} className="h-10 rounded-[5px] px-3 text-[16px] font-semibold text-muted hover:text-danger">Skip</button>
                        </div>
                      </>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section aria-label="Coming up" className="flex min-w-0 flex-col gap-3">
        <h2 className={head}>Coming up <span className="text-[16px] font-semibold text-muted">if nothing is answered</span></h2>
        {!comingByDay.length && <p className="text-[16px] text-muted">Nothing is due to be asked in the next few business days.</p>}
        {comingByDay.map(([day, rows]) => (
          <div key={day} className="min-w-0 overflow-hidden rounded-[5px] ring-1 ring-inset ring-[var(--border)]">
            <div className="border-b bg-background px-3 py-2 text-[16px] font-bold">{formatDayDate(day)}</div>
            {rows.map((c, i) => {
              const taskId = c.request?.taskId ?? c.taskId ?? null;
              return (
                <StepLink key={`${c.clientId}-${i}`} row={{ clientId: c.clientId, taskId, stepId: c.stepId }} onOpenStep={onOpenStep}
                  className="flex min-w-0 items-start gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-background">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold [overflow-wrap:anywhere]">{c.stage === "summary" ? `${c.overdue} overdue, one summary` : c.ask ?? "A request"}</span>
                    <span className="block truncate text-[16px] text-muted">{c.clientName}{c.taskTitle ? ` · ${c.taskTitle}` : ""}</span>
                  </span>
                  <span className={`shrink-0 text-[16px] font-semibold ${stageTone(COMING_STAGE[c.stage] ?? c.stage)}`}>{COMING_STAGE[c.stage] ?? c.stage}</span>
                </StepLink>
              );
            })}
          </div>
        ))}
      </section>

      <section aria-label="Sent" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setShowSent(!showSent)} aria-expanded={showSent} className={`${head} hover:text-accent`}>{showSent ? "▾" : "▸"} Sent <span className="text-[16px] font-semibold text-muted">{sent.length}</span></button>
          {showSent && sentClients.length > 1 && (
            <select value={sentFor} onChange={(e) => setSentFor(e.target.value)} aria-label="Which client"
              className="h-10 min-w-0 max-w-full rounded-[5px] bg-surface px-2 text-[16px] ring-1 ring-inset ring-[var(--border)]">
              <option value="">Every client</option>
              {sentClients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
        {showSent && (
          <div className="min-w-0 overflow-hidden rounded-[5px] ring-1 ring-inset ring-[var(--border)]">
            {!sent.length && <div className="px-3 py-2.5 text-[16px] text-muted">Nothing sent yet.</div>}
            {sent.map((r) => (
              <StepLink key={r.id} row={r} onOpenStep={onOpenStep} className="flex min-w-0 items-start gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-background">
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold [overflow-wrap:anywhere]">{r.clientName}: {r.ask ?? r.taskTitle ?? htmlToText(r.subject)}</span>
                  <span className="block truncate text-[16px] text-muted">{r.subject}</span>
                </span>
                <span className="shrink-0 text-right text-[16px]">
                  <span className={`block font-semibold ${stageTone(r.stage)}`}>{r.stage}</span>
                  <span className="block text-muted">{r.status === "sent" ? whenSent(r.at) : r.status === "failed" ? "didn't send" : `goes ${whenSent(r.at)}`}</span>
                </span>
              </StepLink>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
