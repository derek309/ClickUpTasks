// Shared by the server, both review pages and Claude over MCP: an image or HTML
// review version that holds several files. An image review's front and back
// (Derek, 2026-09-14: "I will want to upload both the front and back files in
// one"), or an HTML review's two emails (Derek, 2026-09-16: "one Deliverable for
// HTML and then inside there two separate HTML blocks ... able to comment and
// copy code"). The format and every rule below are the same for both kinds; only
// the default names differ (itemLabel).
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

/** What a file in a set is called: its typed label, else a default by kind. An
 *  image review says Front and Back for two, Image for one and Image 1, 2, 3 for
 *  more; an HTML review says Page for one and Page 1, 2, 3 for more (two pages are
 *  rarely a front and a back: they are two emails, or two sections). */
export function imageLabel(items: ImageSetItem[], index: number, kind: "image" | "page" = "image"): string {
  const typed = items[index]?.label;
  if (typed) return typed;
  if (kind === "page") return items.length === 1 ? "Page" : `Page ${index + 1}`;
  if (items.length === 2) return index === 0 ? "Front" : "Back";
  return items.length === 1 ? "Image" : `Image ${index + 1}`;
}

/** Files added together, with one named "front" first and one named "back" after
 *  the rest, so a postcard's Front and Back land the right way round whatever order
 *  the picker hands them over in (Derek, 2026-09-14: Back.jpg came first). */
export function frontFirst<T extends { name: string }>(files: T[]): T[] {
  const rank = (name: string) => (/front/i.test(name) ? 0 : /back/i.test(name) ? 2 : 1);
  return files.map((file, i) => ({ file, i })).sort((a, b) => rank(a.file.name) - rank(b.file.name) || a.i - b.i).map((x) => x.file);
}

/** The label that tells a pin's image or page apart, from the newest body holding
 *  it, or null when that version holds only one (a pin number alone is clear then). */
export function pinImageLabel(bodiesNewestFirst: string[], fileId: string, kind: "image" | "page" = "image"): string | null {
  for (const body of bodiesNewestFirst) {
    const items = parseImageSet(body);
    const index = items.findIndex((i) => i.file === fileId);
    if (index >= 0) return items.length > 1 ? imageLabel(items, index, kind) : null;
  }
  return null;
}

/** A set with some of its files swapped for new ones, each keeping its place and
 *  label: the files an edit rewrote become the new files, the rest carry over. */
export function replaceSetFiles(items: ImageSetItem[], replaced: Record<string, string>): ImageSetItem[] {
  return items.map((item) => (replaced[item.file] ? { file: replaced[item.file], label: item.label } : item));
}
