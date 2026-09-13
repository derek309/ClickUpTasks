// Shared by the server and both review pages: where a pin sits on an image or a
// web page review, and which version files the client has been shown. See
// supabase/task-image-reviews.sql and supabase/task-page-reviews.sql.

/** Where a pin sits on a web page, so it stays put when the page reflows: the
 *  element it was dropped on (numbered by the server, src/lib/pageHtml.ts), the
 *  spot inside that element's box, and the page width at the time. */
export type PinAnchor = { node: number; nx: number; ny: number; width: number };

/** A pin: which version file, the spot as a share of its width and height (for
 *  a page, a fallback when the element is gone), and on a page its anchor. */
export type ReviewPin = { fileId: string; x: number; y: number; anchor: PinAnchor | null };

const FILE_ID = /^tdf_[0-9a-f-]{36}$/;
export const MIN_PAGE_WIDTH = 200;
export const MAX_PAGE_WIDTH = 4000;

/** A spot as a share of a width or height, kept to four places. */
const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10_000) / 10_000 : null);
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

/** A pin as a browser sends it: a version file id, a spot on it, and optionally an
 *  anchor. Null for anything else, including an anchor that is there but broken. */
export function cleanPin(raw: unknown): ReviewPin | null {
  if (!raw || typeof raw !== "object") return null;
  const { fileId, x, y, anchor } = raw as Record<string, unknown>;
  const px = share(x);
  const py = share(y);
  if (typeof fileId !== "string" || !FILE_ID.test(fileId) || px === null || py === null) return null;
  const cleaned = anchor == null ? null : cleanAnchor(anchor);
  if (anchor != null && !cleaned) return null;
  return { fileId, x: px, y: py, anchor: cleaned };
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
