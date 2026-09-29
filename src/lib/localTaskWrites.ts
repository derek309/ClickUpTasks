// Which tasks this tab has written lately, so the focus refetch does not put an
// older snapshot over them.
//
// The refetch takes a second or more. A tick made in that window (click back
// into the tab, tick straight away) was replaced on screen by the row as the
// fetch read it, and the live update that would have corrected it is skipped
// because it carries this user's own updated_by. The next save then worked out
// its changed columns against the stale row. Every task write in db.ts notes
// the id here; the refetch leaves those rows as they are on screen.
//
// A stop gap until tasks have an updated_at column and the merge can keep
// whichever row is newer (audit 2026-09-29, wave 3.1).

const lastWrite = new Map<string, number>();

/** How far before the refetch starts a write still counts: a save that left
 *  just before the fetch may land in the database after the fetch read it. */
export const WRITE_SETTLE_MS = 10_000;

export function noteTaskWrite(...ids: string[]) {
  const now = Date.now();
  for (const id of ids) lastWrite.set(id, now);
}

export function tasksWrittenSince(ms: number): Set<string> {
  const ids = new Set<string>();
  for (const [id, at] of lastWrite) if (at >= ms) ids.add(id);
  return ids;
}

/** Adds and updates by id, never removes. Rows in `keep` stay as they are on
 *  screen when they are already there. */
export function mergeFetched<T extends { id: string }>(prev: T[], incoming: T[], keep: ReadonlySet<string> = new Set()): T[] {
  const byId = new Map(prev.map((x) => [x.id, x]));
  for (const x of incoming) if (!(keep.has(x.id) && byId.has(x.id))) byId.set(x.id, x);
  return [...byId.values()];
}
