import { NextRequest, NextResponse } from "next/server";
import { requireUser, callerCanSeeTask } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { copyEmailFilesToTask } from "@/lib/emailFilesServer";
import { isSignatureImage } from "@/lib/emailFiles";

/* eslint-disable @typescript-eslint/no-explicit-any */

// An email's files onto a task (Derek, 2026-10-07: a task made from Kelly's
// email with five photos "didn't pull the images attachments into the task").
// New task from this calls it once the task is saved: each file is read from
// the mailbox the email is in (same rule as /api/inbox/attachment) and stored
// as the task's own file, as if it had been dropped on the task.
//
// POST { message: <messages.id>, taskId }  →  { attachments }

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
  // Signature logos stay behind, and a file already on the task is not added
  // again (the copy happens by itself once the thread is linked, too).
  const files = ((row.attachments as any[]) ?? []).filter((a) => a?.gmailAttachmentId && !isSignatureImage(a));
  if (!files.length || !row.gmail_message_id) return NextResponse.json({ attachments: [] });
  const { data: owner } = await supabaseAdmin.from("profiles").select("email").eq("member_id", row.mailbox_member_id ?? "-").maybeSingle();
  if (!owner?.email) return NextResponse.json({ error: "That email's mailbox isn't connected." }, { status: 409 });
  const { added, skipped } = await copyEmailFilesToTask(supabaseAdmin, message, taskId);
  return NextResponse.json({ attachments: added, skipped });
}
