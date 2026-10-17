import type { Attachment } from "@/lib/data";
import { extOf, isPreviewableImage } from "@/lib/uploadTypes";

// What an email can attach from its task, and how a task file's name reads
// (Derek, 2026-10-17: "what's attached, what's not attached", "titles are not
// helpful, we need to see the images"). Pure, so the email window, the inline
// reply and the Files list all agree.

/** %20 and the other escapes back to their letters; a broken escape stays. */
function decodeEscapes(s: string): string {
  try { return decodeURIComponent(s); } catch {
    return s.replace(/(?:%[0-9a-f]{2})+/gi, (m) => { try { return decodeURIComponent(m); } catch { return m; } });
  }
}

/** A task file's name as people read it. The old Gmail clipper saved names
 *  like "bibSNAP%20%20floor%20matt%20.png:https://mail.google.com/mail/u/0":
 *  URL escaped, with the start of Gmail's download link stuck on the end.
 *  This decodes the escapes, drops a trailing ":https://…" or ":http://…",
 *  collapses doubled spaces and keeps the real extension. Display only: the
 *  stored name is never rewritten. */
export function displayFileName(name: string | null | undefined): string {
  const raw = String(name ?? "");
  const stripUrl = (s: string) => s.replace(/:https?:\/\/[\s\S]*$/i, "");
  let s = stripUrl(raw);
  if (/%[0-9a-f]{2}/i.test(s)) s = stripUrl(decodeEscapes(s));
  s = s.replace(/\s+/g, " ").trim();
  // "floor matt .png": the space was before the extension, not part of the name.
  s = s.replace(/\s+(\.[A-Za-z0-9]{1,8})$/, "$1");
  return s || raw.trim() || "File";
}

/** The type a file tile shows when it has no picture: its extension, or its kind. */
export function fileTypeLabel(a: Pick<Attachment, "name" | "kind">): string {
  const ext = extOf(displayFileName(a.name));
  if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext.toUpperCase();
  return a.kind === "pdf" ? "PDF" : a.kind === "sheet" ? "SHEET" : a.kind === "image" ? "IMAGE" : "FILE";
}

const NOT_DRAWN = /\.(heic|heif|svg|tiff?|bmp|psd|ai|eps)$/i;
/** A stored picture every browser draws, so it shows as itself. A clipped
 *  "Screenshot" has no extension but is kept as an image. */
export function canShowPicture(a: Pick<Attachment, "name" | "kind" | "path">): boolean {
  if (!a.path) return false;
  const name = displayFileName(a.name);
  if (isPreviewableImage(name)) return true;
  return a.kind === "image" && !NOT_DRAWN.test(name);
}

/** A link rather than a file: the clipper's "Open the email in Gmail", a
 *  Drive link, a website. Never shown among an email's attachments. */
export function isLinkItem(a: Pick<Attachment, "kind" | "path" | "url" | "gmailAttachmentId">): boolean {
  if (a.path) return false;
  if (a.kind === "link") return true;
  return !!a.url && !a.gmailAttachmentId && !/mail\.google\.com\/.*[?&]view=att/i.test(a.url);
}

export type TaskAttachChoice = {
  item: Attachment;
  /** attached: in the email now; available: a tap attaches it; gmailOnly: the
   *  file was never stored with the task, so it can't go out from here. */
  state: "attached" | "available" | "gmailOnly";
};

/** The task's files offered under "Add from this task", in the task's order.
 *  Links are left out. A file with nothing stored (only in Gmail) is shown
 *  greyed, so it is clear why it can't be attached. One per stored file. */
export function taskAttachChoices(taskItems: Attachment[] | null | undefined, attached: Pick<Attachment, "path">[]): TaskAttachChoice[] {
  const on = new Set(attached.map((a) => a.path).filter(Boolean));
  const seen = new Set<string>();
  const out: TaskAttachChoice[] = [];
  for (const item of taskItems ?? []) {
    if (isLinkItem(item)) continue;
    if (item.path) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      out.push({ item, state: on.has(item.path) ? "attached" : "available" });
    } else if (item.gmailAttachmentId || item.url) {
      out.push({ item, state: "gmailOnly" });
    }
  }
  return out;
}

/** A task file going into an email: its own copy, under its readable name,
 *  so the client gets "floor matt.png" and the send route picks the type
 *  from a real extension. */
export function attachCopy(a: Attachment, id: string): Attachment {
  return { ...a, id, name: displayFileName(a.name) };
}
