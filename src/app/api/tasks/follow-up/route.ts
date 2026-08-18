import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { todayPacific, upsertConversationTask } from "@/lib/ghlConversationTask";
import { addDaysIso, formatDue } from "@/lib/data";

// "We reached out, now we're waiting to hear back" for one open
// Conversation-priority task — the Businesses page's Followed up button, and
// (via clientId below) a "Log a follow-up" action scoped to a client.
//
// Before this, a business that replied sat in "Needs attention now" until
// someone closed its conversation task, so a walk-in or an email follow-up
// left no trace: the row looked identical to one nobody had touched, and
// closing the task was the only way to clear it (which throws away the fact
// that we're still waiting on an answer). This snoozes instead: the task
// stays OPEN on purpose and only its due date moves out, so the row parks in
// the calmer "Followed up" group and resurfaces on its own once that date
// passes with nothing having come of it.
//
// due is the field that carries this because it already doubles as "last
// touched" on these tasks (see upsertConversationTask in
// ghlConversationTask.ts) — no new column, and every inbound reply bumping it
// back to today is exactly the right behavior: a business that answers is
// cold-again-urgent, not still-waiting.
//
// The new date is computed here, never taken from the request, so the button
// can't be pointed at an arbitrary date.
const FOLLOW_UP_DAYS = 3;

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const taskId = String(body?.taskId ?? "").trim();
  const clientId = String(body?.clientId ?? "").trim();
  // Free-text note a rep typed when logging the touch — kept separate from
  // the auto-generated "Followed up by X on Y" line below rather than
  // replacing it, so the log always says what mechanically happened (due
  // date moved, by whom) even when nobody wrote anything, same as today.
  const note = String(body?.note ?? "").trim().slice(0, 2000);
  if (!taskId && !clientId) return NextResponse.json({ error: "taskId or clientId is required" }, { status: 400 });

  let task: { id: string; client_id: string; status: string; priority: string } | null = null;
  if (taskId) {
    const { data } = await supabaseAdmin.from("tasks").select("id, client_id, status, priority").eq("id", taskId).maybeSingle();
    task = data;
    if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });
    // Scoped deliberately narrow: this only ever means anything for the open
    // Conversation task that put a business in the attention group, so
    // anything else (a closed one, an ordinary task) is refused rather than
    // silently having its due date moved.
    if (task.status === "done" || task.priority !== "conversation") {
      return NextResponse.json({ error: "That isn't an open conversation to follow up on." }, { status: 400 });
    }
    if (!(await isClientVisible(caller, task.client_id))) return NextResponse.json({ error: "Unknown or inaccessible task." }, { status: 403 });
  } else {
    // clientId path — "Log a follow-up" on a claimed+ business that has never
    // had an inbound reply or booked appointment, so there may be no open
    // conversation task to bump yet. Resolve one, or create it on demand
    // (same shape the appointment sync and inbound webhook already use), so
    // logging a follow-up works from day one instead of only after something
    // else happened first.
    if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });
    const { data: openTask } = await supabaseAdmin.from("tasks").select("id, client_id, status, priority").eq("client_id", clientId).eq("priority", "conversation").neq("status", "done").limit(1).maybeSingle();
    if (openTask) {
      task = openTask;
    } else {
      // Contacts.client_id can't be trusted here: GHL-synced contacts sit in
      // a shared "c_directory" bucket on that field, never backfilled to the
      // real per-business client once one exists. The reliable link is the
      // id convention used elsewhere — client.id === "cl_" + contact.id — so
      // try that first and fall back to the client_id field for clients that
      // were never GHL-directory-synced (e.g. hand-created ones) and so rely
      // on it being set correctly.
      const contactId = clientId.startsWith("cl_") ? clientId.slice(3) : null;
      const { data: contact } = contactId
        ? await supabaseAdmin.from("contacts").select("id, name, client_id, ghl_contact_id").eq("id", contactId).maybeSingle()
        : { data: null };
      const resolved = contact ?? (await supabaseAdmin.from("contacts").select("id, name, client_id, ghl_contact_id").eq("client_id", clientId).limit(1).maybeSingle()).data;
      if (!resolved) return NextResponse.json({ error: "This business has no linked contact to log a follow-up against." }, { status: 400 });
      const newTaskId = await upsertConversationTask({ id: resolved.id, name: resolved.name, client_id: clientId }, resolved.ghl_contact_id ?? "");
      if (!newTaskId) return NextResponse.json({ error: "Couldn't create a follow-up task." }, { status: 500 });
      task = { id: newTaskId, client_id: clientId, status: "todo", priority: "conversation" };
    }
  }

  const today = todayPacific();
  const due = addDaysIso(today, FOLLOW_UP_DAYS);
  // updated_by: null is required on every server-side write — without it the
  // browser's Realtime handler can mistake this for an echo of the rep's own
  // last edit and drop it (see Cockpit.tsx's onTask).
  const { error } = await supabaseAdmin.from("tasks").update({ due, updated_by: null }).eq("id", task.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Who did it, resolved the same way /api/directory/call resolves the rep
  // identity it hands GoHighLevel: roster profile name, falling back to the
  // email on the token.
  let repName = caller.email;
  if (caller.memberId) {
    const { data: profile } = await supabaseAdmin.from("profiles").select("name").eq("member_id", caller.memberId).maybeSingle();
    if (profile?.name) repName = profile.name;
  }
  // The mechanical log line stays an "event" (compact activity line, doesn't
  // count toward the task's comment badge) exactly as before. A rep's own
  // note, when they wrote one, posts as a real "comment" right after it —
  // it's the actual content of the follow-up, not a system log, and should
  // read and count like any other note on the task.
  await supabaseAdmin.rpc("append_comment", {
    task_id: task.id,
    comment: {
      id: "cm_" + randomUUID(),
      authorId: caller.memberId,
      body: `Followed up by ${repName} on ${formatDue(today)}. Checking back ${formatDue(due)} if nothing comes of it.`,
      at: new Date().toISOString(),
      kind: "event",
    },
  });
  if (note) {
    await supabaseAdmin.rpc("append_comment", {
      task_id: task.id,
      comment: { id: "cm_" + randomUUID(), authorId: caller.memberId, body: note, at: new Date().toISOString(), kind: "comment" },
    });
  }

  return NextResponse.json({ ok: true, due, taskId: task.id });
}
