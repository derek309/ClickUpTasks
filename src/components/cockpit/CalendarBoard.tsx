"use client";

// Calendar (Derek, 2026-10-05): the next two weeks for Derek and Justin, read
// live from GoHighLevel, as an agenda by day. GoHighLevel stays the calendar:
// this shows it, and hands out booking links. Nothing is booked from here.
import { useMemo, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { useCalendar, type BookingLink, type CalendarEvent, type CalendarPerson } from "./useCalendar";
import { BookAppointment, pacificToIso, type BookTarget } from "./BookAppointment";

const TZ = "America/Los_Angeles";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const minutes = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
// A day or more of blocked time is a working location (Home, Office): it goes
// on one line under the day's heading, not in the list. GoHighLevel stores some
// at midnight UTC, which is 5 PM the day before here, so those keep their own date.
const isAllDay = (e: { start: string; end: string }) => Date.parse(e.end) - Date.parse(e.start) >= 23 * 3_600_000;
const allDayKey = (iso: string) => { const d = new Date(iso); return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? d.toISOString().slice(0, 10) : dayKey(iso); };
// "10–10:30 AM": the first time drops AM or PM when both share it.
const clock = (ms: number, suffix: boolean) => {
  const t = new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return suffix ? t : t.replace(/\s?[AP]M$/, "");
};
const meridiem = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric" }).slice(-2);
const range = (a: number, b: number) => `${clock(a, meridiem(a) !== meridiem(b))}–${clock(b, true)}`;
// Overlapping stretches joined into one.
const merge = (spans: [number, number][]) => spans.sort((x, y) => x[0] - y[0]).reduce<[number, number][]>((out, [a, b]) => {
  const last = out[out.length - 1];
  if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  return out;
}, []);
const STATUS_LABEL: Record<string, string> = { confirmed: "Confirmed", showed: "Showed", noshow: "No show", cancelled: "Cancelled", invalid: "Invalid" };
const STATUS_TONE: Record<string, string> = { showed: "text-success", noshow: "text-danger", invalid: "text-muted" };
// Free time is looked for between 9 and 5, Pacific.
const WORK_FROM = "09:00", WORK_TO = "17:00";
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
  /** Contacts to book, searched by name, email or company. */
  contacts: { id: string; name: string; email?: string | null; company?: string | null; ghlContactId?: string | null }[];
  defaultCalendarId?: string | null;
  onSetDefault?: (id: string | null) => void;
  /** Links folded under Hidden, and how to change that (saved with Inbox settings). */
  hiddenLinks?: string[];
  onSetHidden?: (ids: string[]) => void;
  /** Links starred to the top (Derek, 2026-10-05), saved with Inbox settings. */
  starredLinks?: string[];
  onSetStarred?: (ids: string[]) => void;
  pushToast: (text: string) => void;
  /** "14 waiting on James · 5 overdue" for a client, shown under its meetings. */
  clientNote?: (clientId: string) => string | null;
};

export function CalendarBoard({ people, events, links, loading, error, meId, clientName, clientNote, onOpenClient, onRefresh, pushToast, contacts, defaultCalendarId, onSetDefault, hiddenLinks = [], onSetHidden, starredLinks = [], onSetStarred }: CalendarBoardProps) {
  const starred = new Set([...starredLinks, ...(defaultCalendarId ? [defaultCalendarId] : [])]);
  // One click stars, one click unstars, the default calendar included.
  const toggleStar = (id: string) => {
    if (starred.has(id)) {
      if (starredLinks.includes(id)) onSetStarred?.(starredLinks.filter((x) => x !== id));
      if (id === defaultCalendarId) onSetDefault?.(null);
    } else onSetStarred?.([...starredLinks, id]);
  };
  // Only the links you use show; the rest fold under Hidden (Derek, 2026-10-05).
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const hidden = new Set(hiddenLinks);
  const toggleHidden = (id: string) => onSetHidden?.(hidden.has(id) ? hiddenLinks.filter((x) => x !== id) : [...hiddenLinks, id]);
  // Phase 2 (Derek, 2026-10-05): book, move and cancel, written to GoHighLevel.
  const [booking, setBooking] = useState<BookTarget | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  // A free time chip remembers its time for the booking it starts.
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  // Cancelled here: gone at once. GoHighLevel's list catches up a moment
  // later, so after any change the list reads again after a short wait.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const refreshSoon = () => setTimeout(onRefresh, 2500);
  const findWords = findQ.toLowerCase().split(/\s+/).filter(Boolean);
  const found = findWords.length ? contacts.filter((c) => c.ghlContactId && findWords.every((w) => `${c.name} ${c.email ?? ""} ${c.company ?? ""}`.toLowerCase().includes(w))).slice(0, 8) : [];
  const cancel = async (e: CalendarEvent) => {
    setCancelId(null);
    const r = await authedFetch(`/api/calendar/appointment?id=${encodeURIComponent(e.id)}`, { method: "DELETE" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    pushToast(r?.ok ? `Cancelled: ${e.title}` : j.error ?? "Couldn't cancel it.");
    if (r?.ok) { setGone((g) => new Set(g).add(e.id)); refreshSoon(); }
  };
  // How a meeting went (Derek, 2026-10-05), GoHighLevel's own status menu.
  const [statusOf, setStatusOf] = useState<Record<string, string>>({});
  const [menuId, setMenuId] = useState<string | null>(null);
  const setStatus = async (e: CalendarEvent, status: string) => {
    if (status === "cancelled") { setCancelId(e.id); return; }
    const before = statusOf[e.id] ?? e.status ?? "confirmed";
    setStatusOf((m) => ({ ...m, [e.id]: status }));
    const r = await authedFetch("/api/calendar/appointment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, status }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { pushToast(`${e.title}: ${STATUS_LABEL[status] ?? status}`); refreshSoon(); }
    else { setStatusOf((m) => ({ ...m, [e.id]: before })); pushToast(j.error ?? "Couldn't change the status."); }
  };
  const [who, setWho] = useState<string>("all");
  // Busy time folds into one grey line a day; this lists it in full (Derek, 2026-10-05, mockup
  // https://claude.ai/artifact/Ct4k8xUMqn97ghoUxRU1Xq).
  const [busyFull, setBusyFull] = useState(false);
  const [week, setWeek] = useState<0 | 1>(0);
  const [linkQ, setLinkQ] = useState("");
  const [now] = useState(() => Date.now());
  const nameOf = (id: string) => people.find((p) => p.memberId === id)?.name ?? "";
  const first = (id: string) => (id === meId ? "You" : nameOf(id).split(/\s+/)[0]);

  const shown = events.filter((e) => !gone.has(e.id) && (who === "all" || e.people.includes(who)));
  // This week runs from today to Sunday; next week is Monday to Sunday.
  const range7 = useMemo(() => {
    const today = dayKey(new Date(now).toISOString());
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const add = (k: string, n: number) => new Date(Date.parse(`${k}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const sunday = add(today, (7 - dow) % 7);
    const keys: string[] = [];
    if (week === 0) for (let k = today; k <= sunday; k = add(k, 1)) keys.push(k);
    else for (let i = 1; i <= 7; i++) keys.push(add(sunday, i));
    return { today, keys };
  }, [week, now]);
  const days = useMemo(() => range7.keys.map((key) => {
    const list: CalendarEvent[] = [], busy: CalendarEvent[] = [], allDay: CalendarEvent[] = [];
    for (const e of shown) {
      const all = isAllDay(e);
      if ((all ? allDayKey(e.start) : dayKey(e.start)) !== key) continue;
      // The same working location can come stored two ways; once a day is enough.
      if (all) { if (!allDay.some((x) => x.title === e.title && x.people.join() === e.people.join())) allDay.push(e); }
      else (e.busy ? busy : list).push(e);
    }
    list.sort((a, b) => a.start.localeCompare(b.start));
    const busySpans = merge(busy.map((e) => [Date.parse(e.start), Date.parse(e.end)] as [number, number]));
    // Open time between 9 and 5, after everything booked or blocked; half an hour or more.
    const from = Date.parse(pacificToIso(key, WORK_FROM) ?? ""), to = Date.parse(pacificToIso(key, WORK_TO) ?? "");
    const taken = merge([...busySpans.map((x) => [...x] as [number, number]), ...list.map((e) => [Date.parse(e.start), Date.parse(e.end)] as [number, number])]);
    const free: [number, number][] = [];
    let cursor = Math.max(from, key === range7.today ? Math.ceil(now / 1_800_000) * 1_800_000 : from);
    for (const [a, b] of taken) { if (a > cursor) free.push([cursor, Math.min(a, to)]); cursor = Math.max(cursor, b); if (cursor >= to) break; }
    if (cursor < to) free.push([cursor, to]);
    return { key, list, busy: busy.sort((a, b) => a.start.localeCompare(b.start)), busySpans, allDay, free: free.filter(([a, b]) => b - a >= 30 * 60_000) };
  }), [shown, range7, now]);
  const nextUp = shown.filter((e) => !e.busy && !isAllDay(e) && Date.parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
  const meetings = days.reduce((n, d) => n + d.list.length, 0);
  const openHours = Math.round(days.reduce((n, d) => n + d.free.reduce((m, [a, b]) => m + (b - a), 0), 0) / 3_600_000);
  const dayLabel = (key: string) => {
    const short = new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return key === range7.today ? `Today · ${short}` : short;
  };
  const whenLabel = (e: CalendarEvent) => {
    const mins = Math.round((Date.parse(e.start) - now) / 60_000);
    if (Date.parse(e.start) <= now) return "Happening now";
    if (mins < 90) return `In ${mins} min`;
    const k = dayKey(e.start);
    return k === range7.today ? `Today ${time(e.start)}` : `${new Date(`${k}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${time(e.start)}`;
  };
  // A meeting's clientId is its sub-account; the client is the GoHighLevel
  // contact's own page when there is one (cl_ct_ghl_<contact id>).
  const clientOf = (e: CalendarEvent): string | null => {
    const own = e.ghlContactId ? `cl_ct_ghl_${e.ghlContactId}` : null;
    return own && clientName(own) ? own : e.clientId;
  };
  // The calendar's name, unless it only repeats who's in the meeting.
  const calName = (e: CalendarEvent) => (e.calendarName && !e.people.some((id) => nameOf(id) === e.calendarName) ? e.calendarName : null);
  // The client's name leads a meeting's row; else the title, without the
  // "[ClickUpLocal]" GoHighLevel puts on it.
  const bare = (t: string) => t.replace(/\[[^\]]*\]/g, " ").replace(/clickuplocal/gi, " ").replace(/\s+/g, " ").trim();
  const headline = (e: CalendarEvent) => {
    const cid = clientOf(e);
    return (cid?.startsWith("cl_") ? clientName(cid) : null) ?? e.contactName ?? (bare(e.title) || e.title);
  };
  // What the meeting is: the title once the names are taken out ("Zoom
  // Meeting", "Check-In/Training"), else the calendar's own name.
  const purpose = (e: CalendarEvent, head: string) => {
    const names = [head, ...head.split(/\s+/), ...e.people.flatMap((id) => [nameOf(id), ...nameOf(id).split(/\s+/)])].filter((n) => n.length > 1);
    let t = bare(e.title);
    for (const n of names.sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
    t = t.replace(/(^|\s)[+&x|\/-](?=\s|$)/gi, " ").replace(/\s+/g, " ").trim();
    return t.length >= 3 ? t : calName(e) ?? "";
  };
  const weekend = (k: string) => { const d = new Date(`${k}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6; };

  const copy = async (l: Pick<BookingLink, "label" | "url">) => {
    try { await navigator.clipboard.writeText(l.url); pushToast(`Copied: ${l.label}`); }
    catch { pushToast("Couldn't copy. The link is " + l.url); }
  };
  // Booking links in a column on the right (Derek, 2026-10-05): A to Z, one
  // row per page (a shared one lists both people), and a search box.
  const starredKey = useMemo(() => new Set([...starredLinks, ...(defaultCalendarId ? [defaultCalendarId] : [])]), [starredLinks, defaultCalendarId]);
  const linkRows = useMemo(() => {
    const byUrl = new Map<string, { label: string; url: string; who: string[]; calendarId: string; group: string }>();
    for (const l of links) {
      const had = byUrl.get(l.url);
      if (had) { if (!had.who.includes(l.memberId)) had.who.push(l.memberId); }
      // Grouped by sub-account (Derek, 2026-10-05): "ClickUpLocal Agency" reads "Agency".
      else byUrl.set(l.url, { label: l.label, url: l.url, who: [l.memberId], calendarId: l.calendarId, group: (l.locationName || "Other").replace(/^ClickUpLocal\s+/i, "") });
    }
    // Starred ones (and the default calendar) on top, in a group of their own.
    const rows = [...byUrl.values()].map((r) => (starredKey.has(r.calendarId) ? { ...r, group: "★ Starred" } : r));
    return rows.sort((a, b) => Number(b.group === "★ Starred") - Number(a.group === "★ Starred") || a.group.localeCompare(b.group) || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [links, starredKey]);
  const linkWords = linkQ.toLowerCase().split(/\s+/).filter(Boolean);
  const linksShown = linkRows.filter((r) => linkWords.every((w) => `${r.label} ${r.who.map(nameOf).join(" ")}`.toLowerCase().includes(w)));
  const copyRow = (r: { label: string; url: string }) => copy(r);
  const tab = (on: boolean) => `h-9 rounded-md px-3 font-semibold ${on ? "bg-surface ring-1 ring-[var(--border)]" : "text-muted hover:text-foreground"}`;

  return (
    // The whole width (Derek, 2026-10-05): the agenda takes what the links column leaves.
    <div className="w-full px-4 py-5 text-[16px] sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex gap-1 rounded-lg bg-background p-1">
          <button onClick={() => setWeek(0)} className={tab(week === 0)}>This week</button>
          <button onClick={() => setWeek(1)} className={tab(week === 1)}>Next week</button>
        </span>
        <span className="inline-flex gap-1 rounded-lg bg-background p-1">
          <button onClick={() => setWho("all")} className={tab(who === "all")}>Both</button>
          {people.map((p) => <button key={p.memberId} onClick={() => setWho(p.memberId)} className={tab(who === p.memberId)}>{p.name.split(/\s+/)[0]}</button>)}
        </span>
        <span className="flex-1" />
        <span className="relative">
          <button onClick={() => { setFindOpen(!findOpen); setFindQ(""); setPendingStart(null); }} className="h-10 rounded-md bg-accent px-4 font-semibold text-white">＋ Book</button>
          {findOpen && <>
            <div className="fixed inset-0 z-40" onClick={() => setFindOpen(false)} />
            <div id="calendar-book-finder" className="absolute right-0 top-12 z-50 grid w-[min(22rem,90vw)] gap-1 rounded-lg bg-surface p-2 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              <input autoFocus value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder={pendingStart ? `Who are you booking at ${clock(Date.parse(pendingStart), true)}?` : "Who are you booking?"} aria-label="Search contacts"
                className="h-10 w-full rounded-md bg-surface px-3 outline-none ring-1 ring-[var(--border)] focus:ring-accent" />
              {found.map((c) => (
                <button key={c.id} onClick={() => { setFindOpen(false); setBooking({ kind: "book", ghlContactId: c.ghlContactId!, name: c.name, ...(pendingStart ? { start: pendingStart } : {}) }); }} className="rounded-md px-3 py-2 text-left hover:bg-background">
                  <b className="block truncate font-semibold">{c.name}</b>
                  <span className="block truncate text-[14px] text-muted">{[c.company, c.email].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
              {findWords.length > 0 && !found.length && <div className="px-3 py-2 text-muted">No GoHighLevel contact matches.</div>}
            </div>
          </>}
        </span>
        <button onClick={onRefresh} disabled={loading} title="Read GoHighLevel again" className="h-10 rounded-md px-3 font-semibold ring-1 ring-[var(--border)] hover:bg-background disabled:opacity-60"><span className={loading ? "inline-block animate-spin" : ""}>↻</span></button>
      </div>
      {/* The links column is as wide as its longest name needs, within reason. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,max-content)]">
      <div className="min-w-0">
      {error && <div className="mb-3 rounded-md bg-highlight-soft px-3 py-2 font-semibold text-highlight">{error}</div>}
      {loading && !events.length ? <div className="py-10 text-center text-muted">Reading GoHighLevel…</div> : (
        <div className="grid gap-1">
          {/* Next up (mockup): the next real meeting, with Join and the client. */}
          {nextUp && (
            <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl bg-accent px-5 py-4 text-white">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold uppercase tracking-wider text-white/70">Next up · {whenLabel(nextUp)}</div>
                <b className="block truncate text-[20px]">{nextUp.title}</b>
                <div className="text-white/80">{time(nextUp.start)}, {length(minutes(nextUp.start, nextUp.end))} · {nextUp.people.map(first).join(" and ")}{calName(nextUp) ? ` · ${calName(nextUp)}` : ""}</div>
              </div>
              {nextUp.joinUrl && <a href={nextUp.joinUrl} target="_blank" rel="noopener noreferrer" className="grid h-11 place-items-center rounded-lg bg-surface px-6 text-[16px] font-bold text-accent hover:opacity-90">Join</a>}
              {clientOf(nextUp) && <button onClick={() => onOpenClient(clientOf(nextUp)!)} className="h-11 rounded-lg px-4 font-semibold text-white ring-1 ring-white/40 hover:bg-white/10">Open {clientName(clientOf(nextUp)!) ?? nextUp.contactName ?? "client"}</button>}
            </div>
          )}
          {days.map(({ key, list, busy, busySpans, allDay, free }) => {
            const quietWeekend = weekend(key) && !list.length;
            if (quietWeekend && weekend(key) && new Date(`${key}T12:00:00Z`).getUTCDay() === 0 && !days.some((d) => d.key < key && weekend(d.key) && d.list.length)) {
              return <div key={key} className="mt-4 flex items-center gap-3 text-[14px] font-extrabold uppercase tracking-wider text-muted"><span>Weekend</span><span className="h-px flex-1 bg-[var(--border)]" /><span className="font-normal normal-case tracking-normal">Nothing booked</span></div>;
            }
            if (quietWeekend) return null;
            const where = allDay.map((e) => `${e.people.map(first).join(" & ")} at ${e.title}`).join(" · ");
            return (
              <section key={key}>
                {/* A date spacer between days (Derek, 2026-10-05: "easier on the
                    eye"); today's is the loud one. */}
                <div className={`flex items-center gap-3 ${key === range7.today ? "mb-2 mt-1" : "mb-1.5 mt-4"}`}>
                  <h2 className={key === range7.today ? "shrink-0 rounded-md bg-accent px-3 py-1 text-[16px] font-extrabold uppercase tracking-wider text-white" : "shrink-0 text-[14px] font-extrabold uppercase tracking-wider text-muted"}>{dayLabel(key)}</h2>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  <span className="shrink-0 text-[14px] text-muted">{[where, !list.length ? "No meetings" : ""].filter(Boolean).join(" · ")}</span>
                </div>
                <div className={`rounded-xl px-4 py-2 ${key === range7.today ? "bg-surface shadow-sm ring-2 ring-accent" : "bg-surface ring-1 ring-[var(--border)]"}`}>
                {list.map((e) => {
                  // Cleaner rows (Derek, 2026-10-05, mockup "Cleaner meeting rows"):
                  // the client's name leads, then what it is and who; Join and one ⋯
                  // menu; after it ends, Showed / No show in one click.
                  const st = statusOf[e.id] ?? e.status ?? "confirmed";
                  const upcoming = Date.parse(e.start) > now;
                  const over = Date.parse(e.end) <= now;
                  const head = headline(e);
                  const what = purpose(e, head);
                  const item = "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-background";
                  const cid = clientOf(e);
                  return (
                  <div key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2.5">
                    <span className="w-[5.5rem] shrink-0 tabular-nums"><b>{time(e.start)}</b><span className="block text-[14px] text-muted">{length(minutes(e.start, e.end))}</span></span>
                    <span className="min-w-0 flex-1">
                      {cid ? <button onClick={() => onOpenClient(cid)} title="Open their page" className="block max-w-full truncate text-left text-[16px] font-bold hover:text-accent hover:underline">{head}</button>
                        : <b className="block truncate text-[16px]">{head}</b>}
                      <span className="block truncate text-[15px] text-muted">{[what, e.people.map(first).join(" & "), cid && clientNote ? clientNote(cid) : null].filter(Boolean).join(" · ")}</span>
                      {cancelId === e.id && <span className="font-semibold text-danger">Cancel it? GoHighLevel tells them. <button onClick={() => cancel(e)} className="underline">Yes, cancel</button> <button onClick={() => setCancelId(null)} className="text-muted underline">Keep</button></span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {over && e.calendarId && st === "confirmed" ? <>
                        <span className="text-[14px] text-muted">How did it go?</span>
                        <button onClick={() => void setStatus(e, "showed")} className="h-9 rounded-md bg-success-soft px-3 font-bold text-success ring-1 ring-success/30 hover:ring-success">Showed</button>
                        <button onClick={() => void setStatus(e, "noshow")} className="h-9 rounded-md bg-danger-soft px-3 font-bold text-danger ring-1 ring-danger/30 hover:ring-danger">No show</button>
                      </> : <>
                        {st !== "confirmed" && <span className={`rounded-md bg-background px-2 py-1 text-[14px] font-semibold ${STATUS_TONE[st] ?? "text-muted"}`}>{STATUS_LABEL[st] ?? st}</span>}
                        {e.joinUrl && !over && <a href={e.joinUrl} target="_blank" rel="noopener noreferrer" className="grid h-9 place-items-center rounded-md bg-accent px-4 font-bold text-white hover:opacity-90">Join</a>}
                      </>}
                      {(e.calendarId || cid) && (
                        <span className="relative">
                          <button onClick={() => setMenuId(menuId === e.id ? null : e.id)} aria-expanded={menuId === e.id} aria-label="Status, move or cancel" title="Status, move or cancel"
                            className="grid h-9 w-9 place-items-center rounded-md text-[18px] text-muted ring-1 ring-[var(--border)] hover:bg-background hover:text-foreground">⋯</button>
                          {menuId === e.id && <>
                            <div className="fixed inset-0 z-40" onClick={() => setMenuId(null)} />
                            <div className="absolute right-0 top-10 z-50 w-60 rounded-lg bg-surface p-1.5 text-[15px] text-foreground shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
                              {e.calendarId && <>
                                <div className="px-3 pb-1 pt-0.5 text-[13px] font-bold uppercase tracking-wider text-muted">Status</div>
                                {Object.entries(STATUS_LABEL).filter(([v]) => v !== "cancelled").map(([v, l]) => (
                                  <button key={v} onClick={() => { setMenuId(null); if (v !== st) void setStatus(e, v); }} className={`${item} ${STATUS_TONE[v] ?? ""}`}>
                                    <span className="w-4 text-accent">{v === st ? "✓" : ""}</span>{l}
                                  </button>
                                ))}
                                <div className="my-1 border-t" />
                              </>}
                              {cid && <button onClick={() => { setMenuId(null); onOpenClient(cid); }} className={item}><span className="w-4" />Open {head.split(/\s+/)[0]}&apos;s page</button>}
                              {e.joinUrl && over && <a href={e.joinUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenuId(null)} className={item}><span className="w-4" />Join link</a>}
                              {upcoming && e.calendarId && <>
                                <button onClick={() => { setMenuId(null); setBooking({ kind: "move", appointmentId: e.id, calendarId: e.calendarId!, name: e.contactName ?? e.title, title: e.title }); }} className={item}><span className="w-4" />Move to another time…</button>
                                <button onClick={() => { setMenuId(null); setCancelId(e.id); }} className={`${item} text-danger`}><span className="w-4" />Cancel meeting…</button>
                              </>}
                            </div>
                          </>}
                        </span>
                      )}
                    </span>
                  </div>
                  );
                })}
                {/* Busy time, one quiet line; in full when asked. Someone else's
                    busy time never shows its title (it's their own life). */}
                {busyFull ? busy.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 border-b py-1.5 text-[15px] text-muted">
                    <span className="w-[5.5rem] tabular-nums">{time(e.start)}</span>
                    <span className="min-w-0 flex-1 truncate">{e.people.includes(meId) ? e.title : `Busy (${e.people.map(first).join(", ")})`}</span>
                  </div>
                )) : null}
                {/* Free time as chips; a chip starts a booking (mockup). */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2 text-[15px]">
                  {!busyFull && busySpans.length > 0 && <span className="min-w-0 text-muted/80">Busy {busySpans.map(([a, b]) => range(a, b)).join(", ")}</span>}
                  <span className="flex-1" />
                  {free.length > 0 ? <>
                    <span className="text-[14px] text-muted">Open</span>
                    {free.map(([a, b]) => (
                      <button key={a} onClick={() => { setPendingStart(new Date(a).toISOString()); setFindOpen(true); setFindQ(""); requestAnimationFrame(() => document.getElementById("calendar-book-finder")?.scrollIntoView({ behavior: "smooth", block: "nearest" })); }} title={`Book someone at ${clock(a, true)}`}
                        className="rounded-md bg-success-soft px-2.5 py-1 text-[14px] font-semibold text-success ring-1 ring-success/30 hover:ring-success">{range(a, b)}</button>
                    ))}
                  </> : <span className="text-muted">No open time between 9 and 5</span>}
                </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
      </div>
      <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg p-3 ring-1 ring-[var(--border)] lg:sticky lg:top-4 lg:max-w-[460px]">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-extrabold uppercase tracking-wider text-muted">📅 Booking links</h2>
          <span className="text-[14px] text-muted">{linkRows.length}</span>
        </div>
        <p className="-mt-1 text-[14px] text-muted">☆ keeps a link at the top. The eye hides it under Hidden.</p>
        <input value={linkQ} onChange={(e) => setLinkQ(e.target.value)} placeholder="Search booking links" aria-label="Search booking links"
          className="h-10 w-full min-w-0 rounded-md bg-surface px-3 outline-none ring-1 ring-[var(--border)] focus:ring-accent" />
        {(() => {
          type Row = (typeof linksShown)[number];
          const row = (r: Row, isHidden: boolean) => (
            <div key={r.url} className="group flex min-w-0 items-center gap-1.5 border-b py-1.5 last:border-0">
              <span className="min-w-0 flex-1">
                {/* The whole name, a size smaller (Derek, 2026-10-05: no cut off titles). */}
                {/* The name opens the booking page (Derek, 2026-10-05: no separate arrow). */}
                <a href={r.url} target="_blank" rel="noopener noreferrer" title={`Open the ${r.label} booking page`}
                  className={`block text-[15px] font-semibold leading-snug hover:text-accent hover:underline ${isHidden ? "text-muted" : ""}`}>{r.label}</a>
                <span className="text-[14px] text-muted">{r.who.map((id) => (id === meId ? "You" : nameOf(id).split(/\s+/)[0])).join(" & ")}{r.calendarId === defaultCalendarId ? " · default" : ""}</span>
              </span>
              {onSetStarred && <button onClick={() => toggleStar(r.calendarId)} title={starred.has(r.calendarId) ? "Starred. Click to unstar." : "Star it to keep it at the top"} aria-pressed={starred.has(r.calendarId)}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-[18px] hover:bg-background ${starred.has(r.calendarId) ? "text-amber-500" : "text-muted/70 hover:text-foreground"}`}>{starred.has(r.calendarId) ? "★" : "☆"}</button>}
              {/* Always there, small (Derek couldn't find it as a hover button). */}
              {onSetHidden && <button onClick={() => toggleHidden(r.calendarId)} title={isHidden ? "Show it in the list" : "Hide it (it stays under Hidden)"} aria-label={isHidden ? `Show ${r.label}` : `Hide ${r.label}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted/70 hover:bg-background hover:text-foreground">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {isHidden
                    ? <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                    : <path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22" />}
                </svg>
              </button>}
              <button onClick={() => copyRow(r)} title="Copy the booking link" aria-label={`Copy ${r.label}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-accent ring-1 ring-[var(--border)] hover:bg-background">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
            </div>
          );
          // Searching looks through every link, hidden or not.
          const visible = linkQ ? linksShown : linksShown.filter((r) => !hidden.has(r.calendarId));
          const folded = linkQ ? [] : linksShown.filter((r) => hidden.has(r.calendarId));
          return <>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
              {visible.map((r, i) => <div key={r.url} className="min-w-0">
                {(i === 0 || visible[i - 1].group !== r.group) && <div className={`pb-0.5 text-[14px] font-bold uppercase tracking-wider text-muted ${i ? "pt-3" : "pt-1"}`}>{r.group}</div>}
                {row(r, hidden.has(r.calendarId))}
              </div>)}
              {!visible.length && !folded.length && <div className="py-2 text-muted">{loading ? "Reading GoHighLevel…" : linkQ ? "No booking link matches." : "No booking pages found."}</div>}
              {!visible.length && folded.length > 0 && <div className="py-2 text-muted">All hidden. Open Hidden below, or search.</div>}
            </div>
            {folded.length > 0 && (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] border-t pt-1">
                <button onClick={() => setHiddenOpen(!hiddenOpen)} aria-expanded={hiddenOpen} className="flex items-center justify-between py-1.5 text-left font-semibold text-muted hover:text-foreground">
                  <span>{hiddenOpen ? "▾" : "▸"} Hidden</span><span className="text-[14px]">{folded.length}</span>
                </button>
                {hiddenOpen && folded.map((r, i) => <div key={r.url} className="min-w-0">
                  {(i === 0 || folded[i - 1].group !== r.group) && <div className="pb-0.5 pt-2 text-[14px] font-bold uppercase tracking-wider text-muted/80">{r.group}</div>}
                  {row(r, true)}
                </div>)}
              </div>
            )}
          </>;
        })()}
        <div className="mt-2 grid gap-1.5 border-t pt-3">
          <h2 className="text-[14px] font-extrabold uppercase tracking-wider text-muted">{week ? "Next week" : "This week"}</h2>
          <div className="flex justify-between"><span>Client meetings</span><b>{meetings}</b></div>
          <div className="flex justify-between"><span>Open hours to book</span><b>{openHours}</b></div>
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-[15px] text-muted"><input type="checkbox" checked={busyFull} onChange={(e) => setBusyFull(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />Show busy time in full</label>
        </div>
      </aside>
      </div>
      {booking && <BookAppointment target={booking} meId={meId} defaultCalendarId={defaultCalendarId} onSetDefault={onSetDefault} onClose={() => setBooking(null)} onDone={() => { onRefresh(); refreshSoon(); }} pushToast={pushToast} />}
    </div>
  );
}

/** The view as Cockpit shows it: reads GoHighLevel only while it is open. */
export function CalendarView(props: Omit<CalendarBoardProps, "people" | "events" | "links" | "loading" | "error" | "onRefresh">) {
  const cal = useCalendar();
  return <CalendarBoard {...props} people={cal.people} events={cal.events} links={cal.links} loading={cal.loading} error={cal.error} onRefresh={cal.reload} />;
}
