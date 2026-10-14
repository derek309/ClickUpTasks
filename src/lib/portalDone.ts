// The client portal's Done tab (Derek, 2026-10-13, mockup
// portal-done-by-month-mockup.html): the work done on a schedule as cards
// ("Ongoing work"), then everything finished by month, with repeats folded.
// Pure, so the page and the tests share it. The page is public, so this file
// imports nothing from the app.

export type DoneItem = {
  id: string; title: string; status: string; projectId: string | null;
  due: string | null;
  /** When it was finished (completed_at, else the last change). */
  doneAt?: string | null;
  /** How often it repeats in the app's words ("Every month"), or null. */
  repeat?: string | null;
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const SHORT: Record<string, string> = { "Every day": "daily", "Every week": "weekly", "Every month": "monthly", "Every year": "yearly" };

/** "Every 2 weeks" as "Every two weeks", and its short form for a row
 *  ("every two weeks"; "monthly" for "Every month"). */
export function repeatWords(repeat: string): { every: string; short: string } {
  const every = repeat.replace(/\b(\d{1,2})\b(?= (days|weeks|months|years)\b)/, (n) => NUMBER_WORDS[Number(n)] ?? n);
  const short = SHORT[every] ?? (/^Monthly\b/.test(every) ? "monthly" : every.charAt(0).toLowerCase() + every.slice(1));
  return { every, short };
}

const norm = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

export type OngoingCard = { key: string; title: string; every: string; lastDone: string | null; nextDue: string | null; nextId: string | null };

/** One card per recurring job. A new cycle is a new row with the same title
 *  (nextOccurrence), often filed under another list, so a series is the
 *  repeating rows of one client with the same title. Last done is its newest
 *  finished row; next due is its open row, unless that is on hold. Left out:
 *  a series never done whose open row is on hold, and one with no open row
 *  at all (it stopped repeating, or its next one was trashed) unless it was
 *  done in the last 30 days. */
export function ongoingWork(items: DoneItem[], now = new Date()): OngoingCard[] {
  const recent = new Date(now.getTime() - 30 * 86400000).toISOString();
  const series = new Map<string, DoneItem[]>();
  for (const t of items) {
    if (!t.repeat) continue;
    const k = norm(t.title);
    series.set(k, [...(series.get(k) ?? []), t]);
  }
  const cards: OngoingCard[] = [];
  for (const [key, rows] of series) {
    const done = rows.filter((r) => r.status === "done").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
    const open = rows.filter((r) => r.status !== "done").sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    const active = open.find((r) => r.status !== "on_hold") ?? null;
    if (!done.length && !active) continue;
    if (!open.length && (done[0]?.doneAt ?? "") < recent) continue;
    const latest = active ?? open[0] ?? done[0];
    cards.push({
      key, title: latest.title.trim(), every: repeatWords(latest.repeat ?? "").every,
      lastDone: done[0]?.doneAt ?? null, nextDue: active?.due ?? null, nextId: active?.id ?? null,
    });
  }
  // What is due soonest first, then the ones with no next date, newest done first.
  return cards.sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") || (b.lastDone ?? "").localeCompare(a.lastDone ?? ""));
}

export type DoneLine =
  | { kind: "task"; task: DoneItem; at: string; marker: string | null }
  | { kind: "fold"; key: string; label: string; count: number; at: string; tasks: DoneItem[] };

/** "Reply to Brian Goodell" and the like read as answering their emails. */
const isReply = (title: string) => /^reply to\b/i.test(title.trim());

/** The rows of one group: a recurring row with its marker ("monthly"), and a
 *  one off title done more than once folded into one line ("Answered your
 *  emails · 7 times this month"). Newest or oldest first. */
export function doneLines(items: DoneItem[], sort: "newest" | "oldest" = "newest"): DoneLine[] {
  const when = (t: DoneItem) => t.doneAt ?? t.due ?? "";
  const byTitle = new Map<string, DoneItem[]>();
  for (const t of items) if (!t.repeat) byTitle.set(norm(t.title), [...(byTitle.get(norm(t.title)) ?? []), t]);
  const lines: DoneLine[] = [];
  const folded = new Set<string>();
  for (const t of items) {
    const k = norm(t.title);
    const same = !t.repeat ? byTitle.get(k) ?? [] : [];
    if (same.length > 1) {
      if (folded.has(k)) continue;
      folded.add(k);
      const at = same.map(when).sort()[sort === "newest" ? same.length - 1 : 0];
      lines.push({ kind: "fold", key: k, label: isReply(t.title) ? "Answered your emails" : t.title.trim(), count: same.length, at, tasks: same });
      continue;
    }
    lines.push({ kind: "task", task: t, at: when(t), marker: t.repeat ? repeatWords(t.repeat).short : null });
  }
  return lines.sort((a, b) => (sort === "newest" ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
}

export type DoneMonth = { key: string; label: string; current: boolean; count: number; lines: DoneLine[] };

const monthKey = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 15).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

/** Finished work by month (by the month it was done), newest month first
 *  unless sorted oldest first. */
export function doneByMonth(items: DoneItem[], sort: "newest" | "oldest" = "newest", now = new Date()): DoneMonth[] {
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const months = new Map<string, DoneItem[]>();
  for (const t of items) {
    const k = monthKey(t.doneAt ?? t.due ?? "") || "earlier";
    months.set(k, [...(months.get(k) ?? []), t]);
  }
  const keys = [...months.keys()].sort((a, b) => (a === "earlier" ? 1 : b === "earlier" ? -1 : sort === "newest" ? b.localeCompare(a) : a.localeCompare(b)));
  return keys.map((k) => ({
    key: k, label: k === "earlier" ? "Earlier" : monthLabel(k), current: k === nowKey,
    count: months.get(k)!.length, lines: doneLines(months.get(k)!, sort),
  }));
}

/** "12 done so far" for this month, "21 done" for one that is over. */
export const monthCount = (m: Pick<DoneMonth, "count" | "current">) => `${m.count} done${m.current ? " so far" : ""}`;
