// What is out with a client right now, across every client at once.
//
// Everything a review needs was already recorded — when it was sent, whether the
// client opened it, whether they came back with changes — and there was nowhere
// to see it. You had to remember which task carried which review and open them
// one at a time, so the one nobody had touched in nine days was the one nobody
// looked at.
//
// Pure: rows in, ordered groups out, no React and no database, so the ordering
// and the counting can be tested on their own.
import { type ReviewKind, kindTitle } from "./reviewKinds";

/** A review's stage while it is still somebody's move. The other two stages,
 *  draft and approved, are not open: one has not been sent and the other is
 *  finished (supabase/task-documents.sql). */
export type OpenReviewStatus = "with_client" | "client_submitted";

/** One row of task_documents, as the board needs it. */
export type OpenReviewDoc = {
  id: string;
  taskId: string;
  kind: ReviewKind;
  title: string | null;
  status: OpenReviewStatus;
  version: number;
  /** When the client first opened the link, or null if they never have. */
  clientViewedAt: string | null;
};

/** One row of task_document_versions: a send, a client's changes, an approval. */
export type ReviewVersionRow = {
  documentId: string;
  kind: "sent" | "client_submitted" | "client_approved";
  createdAt: string;
};

export type OpenReview = OpenReviewDoc & {
  /** What to call it: its own name, or the kind's if nobody named it. */
  name: string;
  /** The moment the clock started: when we sent it, or when they replied. */
  at: string | null;
  /** Whole days since then. Null when there is no send on record. */
  days: number | null;
  /** The client has opened the link at least once. */
  opened: boolean;
};

/** The board, in the order it is read. */
export type OpenReviewGroups = {
  /** They have sent changes back. Ours to act on. */
  yourMove: OpenReview[];
  /** Sent, and we are waiting. */
  withClient: OpenReview[];
};

const DAY_MS = 86_400_000;

/** Whole days between two moments, never negative. */
export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** Its name on the board. An unnamed review would otherwise read as a blank
 *  row, and several on one task would all read as the task's own title. */
export const reviewName = (doc: Pick<OpenReviewDoc, "title" | "kind">): string =>
  (doc.title ?? "").trim() || kindTitle(doc.kind);

/** The newest version of a kind for one document, or null. */
function latest(versions: ReviewVersionRow[], documentId: string, kind: ReviewVersionRow["kind"]): string | null {
  let best: string | null = null;
  for (const v of versions) {
    if (v.documentId !== documentId || v.kind !== kind) continue;
    if (best === null || v.createdAt > best) best = v.createdAt;
  }
  return best;
}

/**
 * The board. Whose move it is decides the group; how long it has been sitting
 * decides the order inside it.
 *
 * Waiting on the client reads oldest first, which is the opposite of most
 * lists here and is the point: the one sent nine days ago is the one at risk
 * of being forgotten, and a list that buries it under this morning's send is
 * the situation this replaces. Ours reads newest first, because that is the
 * one they are waiting on a reply to.
 */
export function buildOpenReviews(docs: OpenReviewDoc[], versions: ReviewVersionRow[], now: number = Date.now()): OpenReviewGroups {
  const rows = docs.map((doc): OpenReview => {
    // A sent review is timed from the send. One they have replied to is timed
    // from the reply, which is when it became ours.
    const at = doc.status === "client_submitted"
      ? latest(versions, doc.id, "client_submitted") ?? latest(versions, doc.id, "sent")
      : latest(versions, doc.id, "sent");
    return { ...doc, name: reviewName(doc), at, days: daysSince(at, now), opened: !!doc.clientViewedAt };
  });

  // Anything with no date at all goes last rather than first: it is the least
  // certain row on the board, not the most urgent.
  const byAge = (a: OpenReview, b: OpenReview, oldestFirst: boolean) => {
    if (a.at === null || b.at === null) return a.at === b.at ? 0 : a.at === null ? 1 : -1;
    return oldestFirst ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at);
  };

  return {
    yourMove: rows.filter((r) => r.status === "client_submitted").sort((a, b) => byAge(a, b, false)),
    withClient: rows.filter((r) => r.status === "with_client").sort((a, b) => byAge(a, b, true)),
  };
}

/** How many reviews are open in total, for the tab's own count. */
export const openReviewCount = (g: OpenReviewGroups): number => g.yourMove.length + g.withClient.length;

/** How long it has been waiting, for a person to read. */
export function waitedFor(days: number | null): string {
  if (days === null) return "not sent yet";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
