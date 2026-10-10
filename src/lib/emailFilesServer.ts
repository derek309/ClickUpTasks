import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readGmailAttachment } from "@/lib/googleMail";
import { TASK_FILES_BUCKET } from "@/lib/db";
import type { Attachment } from "@/lib/data";
import { EMAIL_FILE_MAX_BYTES, emailMessageKey, planEmailFileCopy } from "@/lib/emailFiles";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Copies an email's files onto the task its conversation is linked to (Derek,
// 2026-10-09). Called when a thread is linked, when an email arrives in a
// linked thread, and when the team sends one from the Inbox. Every file is
// stored as the task's own (task-files/<taskId>/...), as if it had been
// dropped on the task, because a task file is opened and deleted by its task
// id: a file left at inbox/... or in Gmail would not open from the task.
// Signature logos are skipped, and a file already copied is not copied again
// (Attachment.emailSource).

type Db = typeof supabaseAdmin;

const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const kindOfName = (name: string): Attachment["kind"] => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  return "doc";
};
const taskPath = (taskId: string, name: string) => `${taskId}/f_${randomUUID().slice(0, 8)}-${name.replace(/[^\w.\-]+/g, "_")}`;

/** One email's files onto a task. Never throws: returns what it added and the
 *  names it could not copy. */
export async function copyEmailFilesToTask(db: Db, messageId: string, taskId: string): Promise<{ added: Attachment[]; skipped: string[] }> {
  const added: Attachment[] = [];
  const skipped: string[] = [];
  try {
    const { data: row } = await db.from("messages").select("id, gmail_message_id, rfc822_message_id, mailbox_member_id, attachments").eq("id", messageId).maybeSingle();
    const files = ((row?.attachments as any[] | null) ?? []).filter((a) => a && (a.gmailAttachmentId || a.path));
    if (!row || !files.length) return { added, skipped };
    const { data: task } = await db.from("tasks").select("attachments, deleted_at").eq("id", taskId).maybeSingle();
    if (!task || task.deleted_at) return { added, skipped };
    const key = emailMessageKey(row as any);
    const plan = planEmailFileCopy(key, files as Attachment[], (task.attachments as Attachment[] | null) ?? []);
    if (!plan.length) return { added, skipped };

    let mailbox: string | null = null;
    if (plan.some((p) => !p.file.path) && row.gmail_message_id && row.mailbox_member_id) {
      const { data: owner } = await db.from("profiles").select("email").eq("member_id", row.mailbox_member_id).maybeSingle();
      mailbox = (owner?.email as string | undefined) ?? null;
    }

    for (const { file, source } of plan) {
      const name = String(file.name || "attachment");
      try {
        let path: string;
        let bytes: number | null = null;
        if (file.path) {
          // Already stored (a file the team sent): a copy under the task, so
          // removing it from the task never takes it off the email.
          if (file.path.startsWith(`${taskId}/`)) path = file.path;
          else {
            path = taskPath(taskId, name);
            const { error } = await db.storage.from(TASK_FILES_BUCKET).copy(file.path, path);
            if (error) { skipped.push(name); continue; }
          }
        } else {
          if (!mailbox || !row.gmail_message_id) { skipped.push(name); continue; }
          const buf = await readGmailAttachment(mailbox, row.gmail_message_id as string, file.gmailAttachmentId as string);
          if (buf.byteLength > EMAIL_FILE_MAX_BYTES) { skipped.push(name); continue; }
          path = taskPath(taskId, name);
          const { error } = await db.storage.from(TASK_FILES_BUCKET).upload(path, buf, { contentType: file.mimeType || "application/octet-stream", upsert: false });
          if (error) { skipped.push(name); continue; }
          bytes = buf.byteLength;
        }
        added.push({
          id: "a_" + randomUUID().slice(0, 12), name, size: bytes !== null ? sizeLabel(bytes) : file.size, kind: file.kind && file.kind !== "link" ? file.kind : kindOfName(name),
          path, ...(file.mimeType ? { mimeType: file.mimeType } : {}), emailSource: source,
        });
      } catch { skipped.push(name); }
    }
    if (added.length) {
      // One statement that adds only what isn't there yet
      // (supabase/task-attachments-append.sql), so a file someone added while
      // these downloaded is never written over.
      const { data: kept, error: rpcError } = await db.rpc("append_task_attachments", { task_id: taskId, items: added });
      if (!rpcError) { added.splice(0, added.length, ...(((kept as Attachment[] | null) ?? []))); return { added, skipped }; }
      // The function isn't in the database yet: read again just before
      // writing, as before, so anything another copy added is kept.
      const { data: fresh } = await db.from("tasks").select("attachments").eq("id", taskId).maybeSingle();
      const current = ((fresh?.attachments as Attachment[] | null) ?? []);
      const have = new Set(current.map((a) => a.emailSource).filter(Boolean));
      const toAdd = added.filter((a) => !have.has(a.emailSource));
      if (toAdd.length) {
        const { error } = await db.from("tasks").update({ attachments: [...current, ...toAdd], updated_by: null }).eq("id", taskId);
        if (error) throw new Error(error.message);
      }
      added.splice(0, added.length, ...toAdd);
    }
  } catch (e) {
    console.error("[emailFiles] copy to task failed", messageId, taskId, e instanceof Error ? e.message : e);
  }
  return { added, skipped };
}

/** Every file in a conversation onto a task, oldest email first: linking an
 *  existing thread brings the earlier files too. Never throws. */
export async function copyThreadFilesToTask(db: Db, messageIds: string[], taskId: string): Promise<number> {
  let n = 0;
  try {
    if (!messageIds.length) return 0;
    const { data } = await db.from("messages").select("id, attachments, created_at").in("id", messageIds.slice(0, 500)).order("created_at", { ascending: true });
    const withFiles = ((data as any[] | null) ?? []).filter((m) => ((m.attachments as any[] | null) ?? []).some((a) => a?.gmailAttachmentId || a?.path)).slice(0, 25);
    for (const m of withFiles) n += (await copyEmailFilesToTask(db, m.id as string, taskId)).added.length;
  } catch (e) {
    console.error("[emailFiles] thread copy failed", taskId, e instanceof Error ? e.message : e);
  }
  return n;
}

/** Runs the copy after the response is sent when there is a request to hang
 *  it on (a webhook, a send), else straight away. Its failures are logged and
 *  go no further. */
export function copySoon(label: string, work: () => Promise<unknown>): Promise<void> | void {
  const run = () => work().then(() => undefined, (e) => console.error(`[emailFiles] ${label}`, e instanceof Error ? e.message : e));
  try { after(run); } catch { return run(); }
}
