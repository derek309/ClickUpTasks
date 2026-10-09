import type { Attachment } from "@/lib/data";

// An email's files and the task its conversation is linked to (Derek,
// 2026-10-09: "any file sent in an email conversation linked to a task should
// land on the task", so the task holds everything the client sent). The pure
// half lives here so the Inbox can use isSignatureImage too; the copying is in
// emailFilesServer.ts.

type FileLike = Pick<Attachment, "name" | "size"> & Partial<Pick<Attachment, "kind" | "gmailAttachmentId" | "path" | "emailSource">>;

/** "120 KB" / "1.4 MB" as kilobytes. Sizes are written either way (1000 or
 *  1024 based) depending on who stored them; close enough for a threshold. */
export const kbOf = (size: string) => {
  const n = parseFloat(size);
  if (!Number.isFinite(n)) return 0;
  if (/mb/i.test(size)) return n * 1000;
  if (/^\s*[\d.]+\s*b\s*$/i.test(size)) return n / 1000;
  return n;
};

/** An email signature's logo: a small image Gmail named image001.png and the
 *  like. Never worth showing as a file, or copying onto a task. */
export const isSignatureImage = (a: FileLike) =>
  a.kind === "image" && !!a.gmailAttachmentId && /^image\d*\.(png|jpe?g|gif)$/i.test(a.name) && kbOf(a.size || "0") < 100;

/** Larger than this is left in the email (same cap as /api/inbox/attachment/to-task). */
export const EMAIL_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** At most this many files are copied from one email in one go. */
export const EMAIL_FILE_MAX_COUNT = 20;

/** One email, the same in every mailbox it is in: its Message-ID header when
 *  stored, else its Gmail id, else the row id. Derek's and Justin's copies of
 *  one email share the first, so a file is not copied once per mailbox. */
export function emailMessageKey(row: { id: string; rfc822_message_id?: string | null; gmail_message_id?: string | null }): string {
  const rfc = (row.rfc822_message_id ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
  return rfc ? `rfc:${rfc}` : row.gmail_message_id ? `gm:${row.gmail_message_id}` : `msg:${row.id}`;
}

/** Each file's marker on the task: the email and the file's name, numbered
 *  when one email carries two files of the same name. Gmail attachment ids
 *  are not stable between reads, and sizes are rounded differently by each
 *  path, so neither is part of it. */
export function emailFileSources(messageKey: string, files: { name: string }[]): string[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const name = String(f.name || "attachment").toLowerCase();
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `email:${messageKey}:${name}${n > 1 ? `#${n}` : ""}`;
  });
}

/** Which of an email's files still need copying onto a task: not a signature
 *  logo, something that can be fetched (in Gmail or in storage), not too big,
 *  and not already on the task (by marker, or the very same stored file). */
export function planEmailFileCopy<T extends FileLike>(messageKey: string, files: T[], existing: Pick<Attachment, "path" | "emailSource">[]) {
  const have = new Set(existing.map((a) => a.emailSource).filter(Boolean));
  const paths = new Set(existing.map((a) => a.path).filter(Boolean));
  const sources = emailFileSources(messageKey, files);
  const out: { file: T; source: string }[] = [];
  files.forEach((file, i) => {
    if (!file.gmailAttachmentId && !file.path) return;
    if (isSignatureImage(file)) return;
    if (kbOf(file.size || "0") * 1000 > EMAIL_FILE_MAX_BYTES) return;
    if (have.has(sources[i]) || (file.path && paths.has(file.path))) return;
    out.push({ file, source: sources[i] });
  });
  return out.slice(0, EMAIL_FILE_MAX_COUNT);
}
