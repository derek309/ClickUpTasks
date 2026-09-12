// Shared by the server and both review pages: where a pin sits on an image
// review, and which uploaded images the client was sent. See
// supabase/task-image-reviews.sql.

export type ImagePin = { fileId: string; x: number; y: number };

const FILE_ID = /^tdf_[0-9a-f-]{36}$/;

/** A spot as a share of the image's width or height, kept to four places. */
const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10_000) / 10_000 : null);

/** A pin as a browser sends it: an image file id and a spot on that image.
 *  Null for anything else. */
export function cleanPin(raw: unknown): ImagePin | null {
  if (!raw || typeof raw !== "object") return null;
  const { fileId, x, y } = raw as Record<string, unknown>;
  const px = share(x);
  const py = share(y);
  if (typeof fileId !== "string" || !FILE_ID.test(fileId) || px === null || py === null) return null;
  return { fileId, x: px, y: py };
}

/** The images the client was sent, oldest first and each once, so the first is
 *  "Version 1". A client's changes or approval publish the same image again, so
 *  document versions and images are not one to one. */
export function sentImages(versions: { version: number; kind: string; body: string }[]): string[] {
  const out: string[] = [];
  for (const v of [...versions].sort((a, b) => a.version - b.version)) {
    if (v.kind === "sent" && v.body && !out.includes(v.body)) out.push(v.body);
  }
  return out;
}
