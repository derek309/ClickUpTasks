import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { googleConfigured, resolveGmailThread, readGmailThread } from "@/lib/googleMail";

// Attach an existing email thread to a task, and keep it attached.
//
// Replies to mail the app SENT already find their way home: the outbound row
// carries both task_id and gmail_thread_id, and the reply poller matches the
// thread back to the task. Mail that started outside the app had no such row,
// so its replies fell through to a generic "Reply to <client>" task instead of
// the one you are actually working.
//
// This writes that missing row. From then on the watching is the existing
// cron's job and costs nothing new: resolveTaskForThread finds the thread,
// and every future reply lands on this task.
//
// The thread is resolved through Gmail rather than trusted from the browser
// (see resolveGmailThread) — the Clipper reads a rendered page, and a page can
// only ever make a claim about which thread it is.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace is not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const taskId = typeof b.task_id === "string" ? b.task_id : "";
  const messageId = typeof b.gmail_message_id === "string" ? b.gmail_message_id : null;
  const rfc822 = typeof b.rfc822_message_id === "string" ? b.rfc822_message_id : null;
  const fromEmail = typeof b.from_email === "string" ? b.from_email.trim().toLowerCase() : null;
  const subject = typeof b.subject === "string" ? b.subject.trim().slice(0, 400) : null;
  const backfill = b.backfill !== false;
  if (!taskId) return NextResponse.json({ error: "task_id is required." }, { status: 400 });
  if (!messageId && !rfc822 && !subject) {
    return NextResponse.json({ error: "Nothing to identify the thread by." }, { status: 400 });
  }

  // The task decides the client and contact, not the caller: a token that can
  // reach this route should not be able to file mail against a task it cannot
  // see, nor point it at someone else's contact.
  const { data: task } = await supabaseAdmin
    .from("tasks").select("id, client_id, contact_id, title").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });

  const thread = await resolveGmailThread(caller.email, { messageId, rfc822, fromEmail, subject });
  if (!thread) return NextResponse.json({ error: "Couldn't find that email in Gmail." }, { status: 404 });

  // The contact this mail belongs to: the task's own if it has one, otherwise
  // matched by the sender's address. Without a contact the message has nobody
  // to hang off and the reply poller could never match it either.
  let contactId: string | null = task.contact_id ?? null;
  if (!contactId && fromEmail) {
    const { data: ct } = await supabaseAdmin
      .from("contacts").select("id").ilike("email", fromEmail).limit(1).maybeSingle();
    contactId = ct?.id ?? null;
  }
  if (!contactId) return NextResponse.json({ error: "No contact on this task to file the email against." }, { status: 400 });

  const emails = backfill
    ? await readGmailThread(caller.email, thread.threadId).catch(() => [])
    : [];
  // With no backfill there is still one row to write, because the row IS the
  // binding: without it nothing links thread to task.
  const rows = (emails.length ? emails : [{
    gmailId: thread.messageId, threadId: thread.threadId, fromEmail: fromEmail ?? "",
    fromName: "", subject: thread.subject, body: "", internalDate: new Date().toISOString(),
    outbound: false, toEmails: [] as string[], auto: false,
  }]).map((e) => ({
    id: "m_" + randomUUID(), contact_id: contactId, client_id: task.client_id, task_id: taskId,
    channel: "email", direction: e.outbound ? "outbound" : "inbound",
    subject: e.subject || thread.subject, body: e.body,
    ghl_message_id: null, gmail_message_id: e.gmailId, gmail_thread_id: thread.threadId,
    // The member id, matching every other message row — created_by is read
    // back through userById, which keys on member ids, not profile ids.
    created_by: e.outbound ? (caller.memberId ?? caller.id) : null,
    // Imported history is not news: marking it unread would light the client
    // up as if every message in a month-old thread had just arrived.
    read: true,
    attachments: [], cc: [], bcc: [], created_at: e.internalDate,
  }));

  // Skip what is already here rather than relying on a conflict clause.
  // Attaching a thread twice, or one the reply poller already ingested, has to
  // be a no-op on the rows that exist and still write the ones that do not.
  //
  // Done as a read-then-insert because an ON CONFLICT arbiter is a promise
  // about an index, and this route already shipped once believing an index it
  // could not actually use — reporting three messages imported while the
  // insert failed with 42P10 every time. A select cannot fail that quietly.
  const ids = rows.map((r) => r.gmail_message_id).filter(Boolean) as string[];
  const { data: existing } = await supabaseAdmin
    .from("messages").select("gmail_message_id").in("gmail_message_id", ids);
  const have = new Set((existing ?? []).map((r) => r.gmail_message_id as string));
  const fresh = rows.filter((r) => !have.has(r.gmail_message_id as string));

  if (fresh.length) {
    const { error } = await supabaseAdmin.from("messages").insert(fresh);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true, threadId: thread.threadId, via: thread.via,
    // What actually landed, and what was already here. The first number said
    // "3 imported" for an import that wrote nothing, which is the kind of
    // reassurance that costs an afternoon.
    imported: fresh.length, alreadyHad: rows.length - fresh.length,
    subject: thread.subject,
    // "search" means we guessed from a subject line, so the caller can say so
    // rather than presenting a guess as a fact.
    confident: thread.via !== "search",
  });
}
