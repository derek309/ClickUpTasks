import {
  TODAY, TOMORROW, THIS_WEEK_END, NEXT_WEEK_END, THIS_MONTH_END,
  effectiveDueDate, effectivePriority, PRIORITY_META, type Task,
} from "./data";

// How urgent a client, a project or a task is, as one sortable key.
//
// The board sorts by tier first, then by the soonest date inside it, then by
// the strongest priority sitting on that date. It was written out twice in
// Cockpit — once for clients, once for projects — as two copies that had to
// stay in step by hand. The tail of both was identical.

/** Lower is more urgent. Named because a bare 0..10 in a sort comparator is
 *  unreadable, and two of these tiers mean "nothing to do" rather than
 *  "not due for a while", which is a difference worth being able to see. */
export const URGENCY_TIER = {
  needsReview: 0,
  newMessage: 1,
  overdue: 2,
  today: 3,
  tomorrow: 4,
  thisWeek: 5,
  nextWeek: 6,
  thisMonth: 7,
  later: 8,
  /** Open work, but nobody has said when. */
  noDate: 9,
  /** Nothing open at all. */
  clear: 10,
} as const;

export type UrgencyKey = { tier: number; due: string; priorityRank: number };

export function tierForDate(soonest: string): number {
  if (soonest < TODAY) return URGENCY_TIER.overdue;
  if (soonest === TODAY) return URGENCY_TIER.today;
  if (soonest === TOMORROW) return URGENCY_TIER.tomorrow;
  if (soonest <= THIS_WEEK_END) return URGENCY_TIER.thisWeek;
  if (soonest <= NEXT_WEEK_END) return URGENCY_TIER.nextWeek;
  if (soonest <= THIS_MONTH_END) return URGENCY_TIER.thisMonth;
  return URGENCY_TIER.later;
}

/** The date a task counts as urgent on: its follow-up date when it has one,
 *  its due date otherwise. A snoozed task is not urgent today — counting it at
 *  the date it comes back keeps it on the board at the moment it is actually
 *  actionable, with nothing to remember. */
export const urgencyDateOf = (t: Task): string | null => effectiveDueDate(t);

/** The shared tail of every urgency key: given the open tasks, the soonest
 *  date among them and the strongest priority sitting on that date. */
export function urgencyKeyFrom(open: Task[]): UrgencyKey {
  const candidates = open
    .map((t) => ({ date: urgencyDateOf(t), priorityRank: PRIORITY_META[effectivePriority(t)].rank }))
    .filter((c): c is { date: string; priorityRank: number } => !!c.date);
  if (candidates.length === 0) {
    // Nothing open at all and open-but-undated are different states, and the
    // board treats them differently: one is finished, the other is unplanned.
    if (open.length === 0) return { tier: URGENCY_TIER.clear, due: "", priorityRank: 0 };
    return { tier: URGENCY_TIER.noDate, due: "", priorityRank: Math.max(...open.map((t) => PRIORITY_META[effectivePriority(t)].rank)) };
  }
  const soonest = candidates.reduce((a, b) => (b.date < a.date ? b : a)).date;
  // The strongest priority among the tasks due on that same day — not the
  // strongest overall, which would let something due next month jump a client
  // up the board.
  const atSoonest = candidates.filter((c) => c.date === soonest);
  return { tier: tierForDate(soonest), due: soonest, priorityRank: Math.max(...atSoonest.map((c) => c.priorityRank)) };
}
