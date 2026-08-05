import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { todayPacific } from "@/lib/ghlConversationTask";
import { addDaysIso, formatDue } from "@/lib/data";

// "We reached out, now we're waiting to hear back" for one open
// Conversation-priority task — the Businesses page's Followed up button.
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
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, status, priority").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });
  // Scoped deliberately narrow: this only ever means anything for the open
  // Conversation task that put a business in the attention group, so anything
  // else (a closed one, an ordinary task) is refused rather than silently
  // having its due date moved.
  if (task.status === "done" || task.priority !== "conversation") {
    return NextResponse.json({ error: "That isn't an open conversation to follow up on." }, { status: 400 });
  }
  // Same gate the other service-role task routes use (see /api/extension/
  // tasks/[id]/comment) — admins act on any client, a VA only on the clients
  // they already work. No new permission concept.
  if (!(await isClientVisible(caller, task.client_id))) return NextResponse.json({ error: "Unknown or inaccessible task." }, { status: 403 });

  const today = todayPacific();
  const due = addDaysIso(today, FOLLOW_UP_DAYS);
  // updated_by: null is required on every server-side write — without it the
  // browser's Realtime handler can mistake this for an echo of the rep's own
  // last edit and drop it (see Cockpit.tsx's onTask).
  const { error } = await supabaseAdmin.from("tasks").update({ due, updated_by: null }).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Who did it, resolved the same way /api/directory/call resolves the rep
  // identity it hands GoHighLevel: roster profile name, falling back to the
  // email on the token.
  let repName = caller.email;
  if (caller.memberId) {
    const { data: profile } = await supabaseAdmin.from("profiles").select("name").eq("member_id", caller.memberId).maybeSingle();
    if (profile?.name) repName = profile.name;
  }
  // Same comment shape appendCommentDb writes (src/lib/db.ts), posted through
  // the atomic append_comment RPC so a teammate commenting at the same moment
  // can't lose either write. kind "event" because this is a logged field
  // change, not a chat message — it renders as a compact activity line and
  // stays out of the task's comment count.
  await supabaseAdmin.rpc("append_comment", {
    task_id: taskId,
    comment: {
      id: "cm_" + randomUUID(),
      authorId: caller.memberId,
      body: `Followed up by ${repName} on ${formatDue(today)}. Checking back ${formatDue(due)} if nothing comes of it.`,
      at: new Date().toISOString(),
      kind: "event",
    },
  });

  return NextResponse.json({ ok: true, due });
}
