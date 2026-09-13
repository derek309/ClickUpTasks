// BROWSER. The messages between a web page review's sandboxed frame and the page
// around it (the team's window or the client's review page). The frame runs
// someone else's HTML, so everything it sends is checked here before it is used:
// it must come from that frame's window, carry the bridge's mark, and every field
// must be the right type and size. Nothing it sends is ever put into HTML.
// The other side is public/page-bridge.js.
import { cleanAnchor, type PinAnchor } from "./reviewPins";

/** A reworded piece of text: the element (its number in the page), which of its
 *  own text runs, the words before and after. */
export type PageEdit = { node: number; i: number; before: string; after: string };

export type FrameMessage =
  | { type: "ready" }
  | { type: "place"; x: number; y: number; anchor: PinAnchor | null }
  | { type: "pin-click"; id: string }
  | { type: "edit"; edit: PageEdit }
  | { type: "not-editable" }
  /** The page's full height, so the frame opens up to show all of it, and where
   *  its content sits across it (null when there is none), to zoom in on. */
  | { type: "size"; height: number; span: ContentSpan | null }
  /** Where a pin asked for with "focus" sits, down the page, so the window around scrolls to it. */
  | { type: "focus-at"; y: number };

/** The tallest page height the frame listens to. */
export const MAX_REPORTED_HEIGHT = 100_000;
/** From the page's left edge, in page pixels. */
export type ContentSpan = { left: number; right: number };
const MAX_REPORTED_WIDTH = 10_000;

export type FrameMode = "comment" | "edit" | "browse";
export type FramePin = { id: string; number: number; x: number; y: number; anchor: PinAnchor | null; done: boolean; active: boolean };

/** What the parent sends in. Only ids, numbers, the pins' spots and text the
 *  page already holds: never comment bodies, names or links. */
export type ParentMessage =
  | { cul: 1; type: "mode"; mode: FrameMode }
  | { cul: 1; type: "pins"; pins: FramePin[]; pending: { x: number; y: number; anchor: PinAnchor | null; number: number } | null }
  | { cul: 1; type: "focus"; id: string }
  | { cul: 1; type: "edits"; edits: PageEdit[] };

export const MAX_EDIT_CHARS = 5000;
/** The largest page a web page review takes: checked in the browser before an
 *  upload and again on the server (pageHtml.ts pageTooBig). */
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_TOO_BIG = "This page is over 2 MB. Link images by web address instead of embedding them.";
const share = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_EDIT_CHARS;

/** A reworded piece of text, or null for anything malformed. */
export function cleanEdit(raw: unknown): PageEdit | null {
  if (!raw || typeof raw !== "object") return null;
  const { node, i, before, after } = raw as Record<string, unknown>;
  if (typeof node !== "number" || !Number.isInteger(node) || node < 0 || node > 1_000_000) return null;
  if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i > 10_000) return null;
  if (!text(before) || !text(after) || !before.trim()) return null;
  return { node, i, before, after };
}

/** A message from the frame, or null when it did not come from this frame's
 *  window, lacks the bridge's mark, or is malformed in any way. */
export function readFrameMessage(event: { source: unknown; data: unknown }, frameWindow: unknown): FrameMessage | null {
  if (!frameWindow || event.source !== frameWindow) return null;
  const d = event.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || d.cul !== 1 || typeof d.type !== "string") return null;
  switch (d.type) {
    case "ready":
    case "not-editable":
      return { type: d.type };
    case "place": {
      if (!share(d.x) || !share(d.y)) return null;
      const anchor = d.anchor == null ? null : cleanAnchor(d.anchor);
      if (d.anchor != null && !anchor) return null;
      return { type: "place", x: d.x as number, y: d.y as number, anchor };
    }
    case "pin-click":
      return typeof d.id === "string" && /^tdm_[0-9a-f-]{36}$/.test(d.id) ? { type: "pin-click", id: d.id } : null;
    case "edit": {
      const edit = cleanEdit(d.edit);
      return edit ? { type: "edit", edit } : null;
    }
    case "size": {
      if (typeof d.height !== "number" || !Number.isFinite(d.height) || d.height < 1 || d.height > MAX_REPORTED_HEIGHT) return null;
      if (d.left === undefined && d.right === undefined) return { type: "size", height: Math.ceil(d.height), span: null };
      const edge = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_REPORTED_WIDTH;
      if (!edge(d.left) || !edge(d.right) || d.right <= d.left) return null;
      return { type: "size", height: Math.ceil(d.height), span: { left: d.left, right: d.right } };
    }
    case "focus-at":
      return typeof d.y === "number" && Number.isFinite(d.y) && d.y >= 0 && d.y <= MAX_REPORTED_HEIGHT ? { type: "focus-at", y: d.y } : null;
    default:
      return null;
  }
}

/** Keep the first "before" for each piece of text and the latest "after", and
 *  drop pieces put back as they were. The server checks "before" against the page. */
export function mergeEdits(edits: PageEdit[], next: PageEdit): PageEdit[] {
  const same = (e: PageEdit) => e.node === next.node && e.i === next.i;
  const earlier = edits.find(same);
  const merged = { ...next, before: earlier?.before ?? next.before };
  const rest = edits.filter((e) => !same(e));
  return merged.after.replace(/\s+/g, " ").trim() === merged.before.replace(/\s+/g, " ").trim() ? rest : [...rest, merged];
}
