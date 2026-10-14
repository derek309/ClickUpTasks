// The order of a client's lists (Derek, 2026-10-14: "rearrange the tabs").
//
// Lists showed A to Z (2026-10-08). An admin can now put them in any order,
// by dragging a tab or with Move left / Move right / Move to first on its ⋮
// menu. A rearranged list is saved at PLACED or above, so a client nobody
// has rearranged keeps showing A to Z: the positions saved before this
// (creation order, or 0) never meant an order anyone chose.
//
// Rule: lists placed by hand first, in their saved order; then every other
// list A to Z (a list made after a rearrange lands at the end, next to + List).

export const PLACED = 1000;

type Orderable = { name: string; position?: number | null };

const placed = (l: Orderable) => (l.position ?? 0) >= PLACED;
const byName = (a: Orderable, b: Orderable) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** A client's lists in the order the tabs, the By list groups and the portal show them. */
export function orderLists<T extends Orderable>(lists: T[]): T[] {
  return [...lists].sort((a, b) => {
    const pa = placed(a), pb = placed(b);
    if (pa && pb) return (a.position ?? 0) - (b.position ?? 0) || byName(a, b);
    if (pa !== pb) return pa ? -1 : 1;
    return byName(a, b);
  });
}

/** The position to save for the list at index i of a rearranged order. */
export const placedPosition = (i: number) => PLACED + i;

/** Move one id to just before or just after another. Unknown ids leave the order as it is. */
export function moveNextTo(ids: string[], moving: string, target: string, side: "before" | "after"): string[] {
  if (moving === target || !ids.includes(moving) || !ids.includes(target)) return ids;
  const rest = ids.filter((id) => id !== moving);
  const at = rest.indexOf(target) + (side === "after" ? 1 : 0);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** Move one id a step left (-1) or right (+1); at an end it stays put. */
export function moveBy(ids: string[], id: string, step: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Move one id to the front. */
export function moveToFirst(ids: string[], id: string): string[] {
  if (!ids.includes(id)) return ids;
  return [id, ...ids.filter((x) => x !== id)];
}

export const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
