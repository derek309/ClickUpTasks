import {
  viewerDueDate, effectivePriority, PRIORITY_META, STATUS_ORDER, userById,
  type Task,
} from "./data";
import type { SortBy } from "@/components/cockpit/ui";

// How a task list is ordered. Pure: everything it needs beyond the list comes
// in as options, so it can be exercised without a component around it.
//
// It has already been wrong once in a way nobody could see — the "unread reply
// outranks everything" boost was a hardcoded 4, which silently became a tie
// the day a priority tier was added at rank 4. That is the class of bug a test
// catches and a reading does not.

export type SortOptions = {
  sortBy: SortBy;
  sortDir: "asc" | "desc";
  /** A live reply thread outranks every priority tier. Passed in because it
   *  depends on notifications, which are not a property of the task. */
  hasUnreadReply?: (t: Task) => boolean;
  /** Just-added tasks, newest first, held at the top so each one lands under
   *  the Add task row rather than jumping to wherever it sorts. */
  pinnedIds?: string[];
  /** Who is looking. A delegated task sorts by the date its delegatee was
   *  given, not by the owner's. */
  viewerId?: string | null;
};

/** Order-preserving for everything unpinned, and a no-op once nothing is
 *  pinned. */
export function hoistPinned(arr: Task[], pinnedIds: string[] = []): Task[] {
  if (pinnedIds.length === 0) return arr;
  const pinned = pinnedIds.map((id) => arr.find((t) => t.id === id)).filter((t): t is Task => !!t);
  if (pinned.length === 0) return arr;
  const pinnedSet = new Set(pinned.map((t) => t.id));
  return [...pinned, ...arr.filter((t) => !pinnedSet.has(t.id))];
}

export function sortTasks(list: Task[], opts: SortOptions): Task[] {
  const { sortBy, sortDir, hasUnreadReply, pinnedIds, viewerId } = opts;
  const arr = [...list];
  if (sortBy === "manual") return hoistPinned(arr, pinnedIds);
  const dir = sortDir === "desc" ? -1 : 1;

  // Undated sorts last in both directions by borrowing a date no task has,
  // rather than being special-cased in every comparator.
  const NEVER = "9999";
  if (sortBy === "due") {
    arr.sort((a, b) => ((viewerDueDate(a, viewerId) ?? NEVER).localeCompare(viewerDueDate(b, viewerId) ?? NEVER)) * dir);
  } else if (sortBy === "followUp") {
    // The follow-up date alone, not the effective one: this column answers
    // "what comes back to me and when", so a task with no follow-up sorts to
    // the end rather than borrowing its due date.
    arr.sort((a, b) => ((a.followUpAt ?? NEVER).localeCompare(b.followUpAt ?? NEVER)) * dir);
  } else if (sortBy === "priority") {
    // Derived from the table rather than hardcoded. It used to be a literal 4,
    // which became a tie the day client_request was added at rank 4.
    const unreadRank = Math.max(...Object.values(PRIORITY_META).map((m) => m.rank)) + 1;
    const rank = (t: Task) => (hasUnreadReply?.(t) ? unreadRank : PRIORITY_META[effectivePriority(t)].rank);
    arr.sort((a, b) => (rank(b) - rank(a)) * dir);
  } else if (sortBy === "title") {
    arr.sort((a, b) => a.title.localeCompare(b.title) * dir);
  } else if (sortBy === "status") {
    arr.sort((a, b) => (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * dir);
  } else if (sortBy === "assignee") {
    arr.sort((a, b) => ((userById(a.assigneeId)?.name ?? "~").localeCompare(userById(b.assigneeId)?.name ?? "~")) * dir);
  } else if (sortBy === "comments") {
    arr.sort((a, b) => (b.comments.length - a.comments.length) * dir);
  } else if (sortBy === "created") {
    // Oldest first when ascending: "what has been sitting longest" is the
    // question a Created sort is asked.
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt) * dir);
  }
  return hoistPinned(arr, pinnedIds);
}
