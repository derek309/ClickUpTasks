import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser, callerCanSeeTask } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { readGmailAttachment } from "@/lib/googleMail";
import { TASK_FILES_BUCKET } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

// An email's files onto a task (Derek, 2026-10-07: a task made from Kelly's
// email with five photos "didn't pull the images attachments into the task").
// New task from this calls it once the task is saved: each file is read from
// the mailbox the email is in (same rule as /api/inbox/attachment) and stored
// as the task's own file, as if it had been dropped on the task.
//
// POST { message: <messages.id>, taskId }  →  { attachments }

const MAX_BYTES = 25 * 1024 * 1024;
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const kindOf = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  return "doc";
};

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { message, taskId } = (await req.json().catch(() => ({}))) as { message?: string; taskId?: string };
  if (!message || !taskId) return NextResponse.json({ error: "Which email and which task?" }, { status: 400 });
  if (!(await callerCanSeeTask(req, taskId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: row } = await supabaseAdmin.from("messages").select("client_id, gmail_message_id, mailbox_member_id, attachments").eq("id", message).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const allowed = caller.role === "admin" || (row.mailbox_member_id && row.mailbox_member_id === caller.memberId);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const files = ((row.attachments as any[]) ?? []).filter((a) => a?.gmailAttachmentId);
  if (!files.length || !row.gmail_message_id) return NextResponse.json({ attachments: [] });
  const { data: owner } = await supabaseAdmin.from("profiles").select("email").eq("member_id", row.mailbox_member_id ?? "-").maybeSingle();
  if (!owner?.email) return NextResponse.json({ error: "That email's mailbox isn't connected." }, { status: 409 });

  const added: any[] = [];
  const skipped: string[] = [];
  for (const a of files) {
    const name = String(a.name || "attachment");
    try {
      const bytes = await readGmailAttachment(owner.email as string, row.gmail_message_id as string, a.gmailAttachmentId as string);
      if (bytes.byteLength > MAX_BYTES) { skipped.push(name); continue; }
      const path = `${taskId}/f_${randomUUID().slice(0, 8)}-${name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).upload(path, bytes, { contentType: (a.mimeType as string) || "application/octet-stream", upsert: false });
      if (error) { skipped.push(name); continue; }
      added.push({ id: "a_" + randomUUID().slice(0, 12), name, size: size(bytes.byteLength), kind: kindOf(name), path });
    } catch { skipped.push(name); }
  }
  if (added.length) {
    const { data: task } = await supabaseAdmin.from("tasks").select("attachments").eq("id", taskId).maybeSingle();
    await supabaseAdmin.from("tasks").update({ attachments: [...((task?.attachments as any[]) ?? []), ...added], updated_by: null }).eq("id", taskId);
  }
  return NextResponse.json({ attachments: added, skipped });
}
