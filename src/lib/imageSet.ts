// Shared by the server, both review pages and Claude over MCP: an image review
// version that holds several images, like a postcard's front and back (Derek,
// 2026-09-14: "I will want to upload both the front and back files in one").
//
// A version's body names what the client reviews. For one image it is that image's
// file id, as every review made before this still is; for several it is a small
// JSON list, in the order they show, each with the label the team typed ("" when
// they didn't). One image with no label is always written as the plain id, so an
// HTML review and every older image review read as a set of one and nothing
// already stored changes. Bodies are written the same way every time, so two sends
// of the same images are one version.
//
// Derek's picks: shown stacked, up to 10 images, labels editable with Front and
// Back for two and Image 1, 2, 3 for more, and a new version can change one image
// while the others carry over (with their pins, which belong to the image).

export type ImageSetItem = { file: string; label: string };

export const MAX_SET_IMAGES = 10;
const MAX_LABEL_CHARS = 40;
const FILE_ID = /^tdf_[0-9a-f-]{36}$/;

/** A label as typed: one line, no dashes (the copy rule), at most 40 characters. */
export function cleanImageLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s*[-–—‐‑‒―]+\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_CHARS).trim();
}

/** The images a stored body holds, in order. A plain id is a set of one; anything
 *  unreadable is none. */
export function parseImageSet(body: unknown): ImageSetItem[] {
  if (typeof body !== "string" || !body) return [];
  if (!body.startsWith("[")) return [{ file: body, label: "" }];
  try {
    const raw = JSON.parse(body);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => (item && typeof item.file === "string" && item.file
      ? [{ file: item.file as string, label: typeof item.label === "string" ? item.label : "" }]
      : []));
  } catch {
    return [];
  }
}

/** The body for a set: the plain id for one unlabelled image, else the JSON list. */
export function formatImageSet(items: ImageSetItem[]): string {
  if (!items.length) return "";
  if (items.length === 1 && !items[0].label) return items[0].file;
  return JSON.stringify(items.map((i) => ({ file: i.file, label: i.label })));
}

/** A set as a browser or Claude sends it: 1 to 10 real, different file ids, labels
 *  cleaned. Null for anything else. */
export function cleanImageSet(raw: unknown): ImageSetItem[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SET_IMAGES) return null;
  const items: ImageSetItem[] = [];
  for (const item of raw) {
    const file = item && typeof item === "object" ? (item as Record<string, unknown>).file : undefined;
    if (typeof file !== "string" || !FILE_ID.test(file) || items.some((i) => i.file === file)) return null;
    items.push({ file, label: cleanImageLabel((item as Record<string, unknown>).label) });
  }
  return items;
}

/** The file ids a body holds. */
export const setFiles = (body: unknown): string[] => parseImageSet(body).map((i) => i.file);

/** What an image in a set is called: its typed label, else Front and Back for two,
 *  Image for one, and Image 1, 2, 3 for more. */
export function imageLabel(items: ImageSetItem[], index: number): string {
  const typed = items[index]?.label;
  if (typed) return typed;
  if (items.length === 2) return index === 0 ? "Front" : "Back";
  return items.length === 1 ? "Image" : `Image ${index + 1}`;
}

/** The label that tells a pin's image apart, from the newest body holding it, or
 *  null when that version has only one image (a pin number alone is clear then). */
export function pinImageLabel(bodiesNewestFirst: string[], fileId: string): string | null {
  for (const body of bodiesNewestFirst) {
    const items = parseImageSet(body);
    const index = items.findIndex((i) => i.file === fileId);
    if (index >= 0) return items.length > 1 ? imageLabel(items, index) : null;
  }
  return null;
}
