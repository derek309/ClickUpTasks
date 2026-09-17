// Shared by the server and every review page: where a pin sits on an image, a web
// page or a video review, and which version files the client has been shown. See
// supabase/task-image-reviews.sql, task-page-reviews.sql and
// task-video-comments.sql.
//
// A pin is either a SPOT or a MOMENT, never both and never neither. An image or
// page pin is a spot (x and y, and on a page an anchor); a video pin is a moment
// (t, the second it was left at), because there is nothing useful to point at in a
// moving picture. The database check says the same thing.

/** Where a pin sits on a web page, so it stays put when the page reflows: the
 *  element it was dropped on (numbered by the server, src/lib/pageHtml.ts), the
 *  spot inside that element's box, and the page width at the time. */
export type PinAnchor = { node: number; nx: number; ny: number; width: number };

/** A pin: which version file, then either a spot on it or a moment in it.
 *  x and y are the spot as a share of the file's width and height (on a page, the
 *  fallback when the anchored element is gone); they are null on a video.
 *  t is the second into a video the comment was left at; it is null on the rest. */
export type ReviewPin = {
  fileId: string;
  x: number | null;
  y: number | null;
  anchor: PinAnchor | null;
  t: number | null;
};

const FILE_ID = /^tdf_[0-9a-f-]{36}$/;

/** A moment in words: "0:42", or "1:05:03" once a video runs past an hour. */
export function formatPinTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const ss = String(s % 60).padStart(2, "0");
  const mm = Math.floor(s / 60) % 60;
  const hh = Math.floor(s / 3600);
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}
export const MIN_PAGE_WIDTH = 200;
export const MAX_PAGE_WIDTH = 4000;

/** A spot as a share of a width or height, kept to four places. */
const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10_000) / 10_000 : null);

/** The longest video a pin can sit in. Generous on purpose: the point is to refuse
 *  nonsense, not to guess how long Derek's videos are. */
export const MAX_PIN_SECONDS = 24 * 3600;
/** A moment in a video, in seconds, kept to a tenth. A tenth is finer than anyone
 *  can pause to and keeps the number short to read. */
const seconds = (v: unknown) =>
  (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_PIN_SECONDS ? Math.round(v * 10) / 10 : null);
const wholeIn = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** An anchor as a browser sends it, or null for anything that is not one. */
export function cleanAnchor(raw: unknown): PinAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const { node, nx, ny, width } = raw as Record<string, unknown>;
  const n = wholeIn(node, 0, 1_000_000);
  const x = share(nx);
  const y = share(ny);
  const w = wholeIn(width, MIN_PAGE_WIDTH, MAX_PAGE_WIDTH);
  return n === null || x === null || y === null || w === null ? null : { node: n, nx: x, ny: y, width: w };
}

/** A pin as a browser sends it: a version file id, then either a spot on it (with,
 *  on a page, an anchor) or a moment in it. Null for anything else, including an
 *  anchor that is there but broken, and including a spot and a moment together. */
export function cleanPin(raw: unknown): ReviewPin | null {
  if (!raw || typeof raw !== "object") return null;
  const { fileId, x, y, t, anchor } = raw as Record<string, unknown>;
  if (typeof fileId !== "string" || !FILE_ID.test(fileId)) return null;
  const cleaned = anchor == null ? null : cleanAnchor(anchor);
  if (anchor != null && !cleaned) return null;

  const at = seconds(t);
  if (at !== null) {
    // A moment carries nothing else: a video has no spot and no element to anchor to.
    return x == null && y == null && cleaned === null ? { fileId, x: null, y: null, anchor: null, t: at } : null;
  }
  if (t != null) return null;
  const px = share(x);
  const py = share(y);
  if (px === null || py === null) return null;
  return { fileId, x: px, y: py, anchor: cleaned, t: null };
}

/** The version files the client has been shown, oldest first and each once, so
 *  the first is "Version 1". Every published version counts: a sent image or
 *  page, and a page the client edited. A client's answer that publishes the same
 *  file again adds nothing. */
export function publishedFiles(versions: { version: number; body: string }[]): string[] {
  const out: string[] = [];
  for (const v of [...versions].sort((a, b) => a.version - b.version)) {
    if (v.body && !out.includes(v.body)) out.push(v.body);
  }
  return out;
}
