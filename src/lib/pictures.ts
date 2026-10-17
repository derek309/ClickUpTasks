import type { Attachment } from "@/lib/data";
import { displayFileName } from "@/lib/attachFiles";

// A file that is a picture, by its kind or, when the kind says otherwise, by
// its name (Derek, 2026-10-14: a client's "m and m art.png" showed as a file
// chip). A mail program can send a PNG as application/octet-stream, and the
// kind was read from that, so the file was stored as a "doc". Only the types
// every browser draws; a HEIC or an SVG stays a file.
const PICTURE_EXT = /\.(png|jpe?g|gif|webp)$/i;

// Read through the clean name, so a clipped "rack.jpg:https://mail.google.com/…" counts.
export const isPictureName = (name: string) => PICTURE_EXT.test(displayFileName(name));

export function isPicture(a: Pick<Attachment, "kind" | "name"> & Partial<Pick<Attachment, "url">>): boolean {
  if (a.kind === "image") return true;
  if (a.kind === "link" || a.url) return false;
  return isPictureName(a.name || "");
}

/** The image type to store a picture under when the sender said only
 *  application/octet-stream, so it opens as a picture in a new tab too. */
export function pictureMime(name: string, mime?: string | null): string | null {
  const m = String(mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return m;
  if (m && m !== "application/octet-stream" && m !== "binary/octet-stream") return null;
  const ext = name.trim().split(".").pop()?.toLowerCase() ?? "";
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] ?? null;
}
