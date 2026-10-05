"use client";

// Calendar (Derek, 2026-10-05): the next two weeks for Derek and Justin, read
// live from GoHighLevel, as an agenda by day. GoHighLevel stays the calendar:
// this shows it, and hands out booking links. Nothing is booked from here.
import { useMemo, useState } from "react";
import { useCalendar, type BookingLink, type CalendarEvent, type CalendarPerson } from "./useCalendar";

const TZ = "America/Los_Angeles";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const minutes = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
// A day or more of blocked time is a working location (Home, Office): it goes
// on one line under the day's heading, not in the list. GoHighLevel stores some
// at midnight UTC, which is 5 PM the day before here, so those keep their own date.
const isAllDay = (e: { start: string; end: string }) => Date.parse(e.end) - Date.parse(e.start) >= 23 * 3_600_000;
const allDayKey = (iso: string) => { const d = new Date(iso); return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? d.toISOString().slice(0, 10) : dayKey(iso); };
const length = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

export type CalendarBoardProps = {
  people: CalendarPerson[];
  events: CalendarEvent[];
  links: BookingLink[];
  loading: boolean;
  error: string | null;
  meId: string;
  colorOf: (memberId: string) => string;
  clientName: (clientId: string) => string | null;
  onOpenClient: (clientId: string) => void;
  onRefresh: () => void;
  pushToast: (text: string) => void;
};

export function CalendarBoard({ people, events, links, loading, error, meId, colorOf, clientName, onOpenClient, onRefresh, pushToast }: CalendarBoardProps) {
  const [who, setWho] = useState<string>("all");
  const [showBusy, setShowBusy] = useState(true);
  const [linkQ, setLinkQ] = useState("");
  const nameOf = (id: string) => people.find((p) => p.memberId === id)?.name ?? "";
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  const shown = events.filter((e) => (who === "all" || e.people.includes(who)) && (showBusy || !e.busy));
  // Days with something on them, and today always.
  const days = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    const map = new Map<string, { list: CalendarEvent[]; allDay: CalendarEvent[] }>([[today, { list: [], allDay: [] }]]);
    for (const e of shown) {
      const all = isAllDay(e);
      const k = all ? allDayKey(e.start) : dayKey(e.start);
      if (k < today) continue;
      const day = map.get(k) ?? { list: [], allDay: [] };
      // The same working location can come stored two ways; once a day is enough.
      if (all && day.allDay.some((x) => x.title === e.title && x.people.join() === e.people.join())) continue;
      (all ? day.allDay : day.list).push(e);
      map.set(k, day);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, d]) => ({ key, list: d.list, allDay: d.allDay, today }));
  }, [shown]);
  // Today keeps its word; every other day is just its date (Derek, 2026-10-05).
  const dayLabel = (key: string, today: string) => {
    const long = new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    return key === today ? `Today · ${long}` : long;
  };

  const copy = async (l: BookingLink) => {
    try { await navigator.clipboard.writeText(l.url); pushToast(`Copied: ${l.label}`); }
    catch { pushToast("Couldn't copy. The link is " + l.url); }
  };
  // Booking links in a column on the right (Derek, 2026-10-05): A to Z, one
  // row per page (a shared one lists both people), and a search box.
  const linkRows = useMemo(() => {
    const byUrl = new Map<string, { label: string; url: string; who: string[] }>();
    for (const l of links) {
      const had = byUrl.get(l.url);
      if (had) { if (!had.who.includes(l.memberId)) had.who.push(l.memberId); }
      else byUrl.set(l.url, { label: l.label, url: l.url, who: [l.memberId] });
    }
    return [...byUrl.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [links]);
  const linkWords = linkQ.toLowerCase().split(/\s+/).filter(Boolean);
  const linksShown = linkRows.filter((r) => linkWords.every((w) => `${r.label} ${r.who.map(nameOf).join(" ")}`.toLowerCase().includes(w)));
  const copyRow = (r: { label: string; url: string }) => copy({ label: r.label, url: r.url, memberId: "", shared: false });
  const tab = (on: boolean) => `h-9 rounded-md px-3 font-semibold ${on ? "bg-surface ring-1 ring-[var(--border)]" : "text-muted hover:text-foreground"}`;

  return (
    // The whole width (Derek, 2026-10-05): the agenda takes what the links column leaves.
    <div className="w-full px-4 py-5 text-[16px] sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex gap-1 rounded-lg bg-background p-1">
          <button onClick={() => setWho("all")} className={tab(who === "all")}>Both</button>
          {people.map((p) => <button key={p.memberId} onClick={() => setWho(p.memberId)} className={tab(who === p.memberId)}>{p.name.split(/\s+/)[0]}</button>)}
        </span>
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-muted"><input type="checkbox" checked={showBusy} onChange={(e) => setShowBusy(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />Show busy time</label>
        <span className="flex-1" />
        <button onClick={onRefresh} disabled={loading} title="Read GoHighLevel again" className="h-10 rounded-md px-3 font-semibold ring-1 ring-[var(--border)] hover:bg-background disabled:opacity-60"><span className={loading ? "inline-block animate-spin" : ""}>↻</span></button>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
      {error && <div className="mb-3 rounded-md bg-highlight-soft px-3 py-2 font-semibold text-highlight">{error}</div>}
      {loading && !events.length ? <div className="py-10 text-center text-muted">Reading GoHighLevel…</div> : (
        <div className="grid gap-5">
          {days.map(({ key, list, allDay, today }) => (
            <section key={key}>
              <h2 className={`mb-1.5 border-b pb-1.5 text-[14px] font-extrabold uppercase tracking-wider ${key === today ? "text-accent" : "text-muted"}`}>{dayLabel(key, today)}</h2>
              {allDay.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-muted">
                  {allDay.map((e) => <span key={e.id + e.people.join()}>All day: <b className="font-semibold text-foreground/80">{e.title}</b> ({e.people.map((id) => nameOf(id).split(/\s+/)[0]).join(", ")})</span>)}
                </div>
              )}
              {!list.length && <div className="py-2 text-muted">Nothing booked.</div>}
              {list.map((e) => (
                <div key={e.id} className={`grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-3 border-b py-2.5 last:border-0 ${e.busy ? "text-muted" : ""}`}>
                  <span className="tabular-nums">
                    <b className={e.busy ? "font-semibold" : ""}>{time(e.start)}</b>
                    <span className="block text-[14px] text-muted">{length(minutes(e.start, e.end))}</span>
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate ${e.busy ? "" : "font-semibold"}`}>{e.busy && <span className="mr-1.5 rounded bg-background px-1.5 text-[14px] ring-1 ring-[var(--border)]">Busy</span>}{e.title}</span>
                    {!e.busy && (
                      <span className="flex flex-wrap items-center gap-x-3 text-[15px] text-muted">
                        {e.calendarName && <span>{e.calendarName}</span>}
                        {e.clientId && <button onClick={() => onOpenClient(e.clientId!)} className="font-semibold text-accent hover:underline">{clientName(e.clientId) ?? e.contactName ?? "Open client"}</button>}
                        {e.joinUrl && <a href={e.joinUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">Join ↗</a>}
                      </span>
                    )}
                  </span>
                  <span className="flex -space-x-1.5 pt-0.5">
                    {e.people.map((id) => (
                      <span key={id} title={nameOf(id)} className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold text-white ring-2 ring-surface" style={{ background: colorOf(id), opacity: e.busy ? 0.55 : 1 }}>{initials(nameOf(id))}</span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
      </div>
      <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg p-3 ring-1 ring-[var(--border)] lg:sticky lg:top-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-extrabold uppercase tracking-wider text-muted">📅 Booking links</h2>
          <span className="text-[14px] text-muted">{linkRows.length}</span>
        </div>
        <input value={linkQ} onChange={(e) => setLinkQ(e.target.value)} placeholder="Search booking links" aria-label="Search booking links"
          className="h-10 w-full min-w-0 rounded-md bg-surface px-3 outline-none ring-1 ring-[var(--border)] focus:ring-accent" />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
          {linksShown.map((r) => (
            <div key={r.url} className="flex min-w-0 items-center gap-2 border-b py-1.5 last:border-0">
              <span className="min-w-0 flex-1">
                <b className="block truncate font-semibold" title={r.label}>{r.label}</b>
                <span className="text-[14px] text-muted">{r.who.map((id) => (id === meId ? "You" : nameOf(id).split(/\s+/)[0])).join(" & ")}</span>
              </span>
              <a href={r.url} target="_blank" rel="noopener noreferrer" title="Open the booking page" className="shrink-0 rounded-md px-1.5 py-1 text-muted hover:text-foreground">↗</a>
              <button onClick={() => copyRow(r)} className="h-8 shrink-0 rounded-md px-3 font-semibold text-accent ring-1 ring-[var(--border)] hover:bg-background">Copy</button>
            </div>
          ))}
          {!linksShown.length && <div className="py-2 text-muted">{loading ? "Reading GoHighLevel…" : linkQ ? "No booking link matches." : "No booking pages found."}</div>}
        </div>
      </aside>
      </div>
    </div>
  );
}

/** The view as Cockpit shows it: reads GoHighLevel only while it is open. */
export function CalendarView(props: Omit<CalendarBoardProps, "people" | "events" | "links" | "loading" | "error" | "onRefresh">) {
  const cal = useCalendar();
  return <CalendarBoard {...props} people={cal.people} events={cal.events} links={cal.links} loading={cal.loading} error={cal.error} onRefresh={cal.reload} />;
}
