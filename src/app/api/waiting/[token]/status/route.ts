import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { todayIso } from "@/lib/data";
import { rateLimit } from "@/lib/rateLimit";
import { resolveNotifyRecipient } from "@/lib/waitingNotify";

// Public, token-gated — lets the client set a task's review outcome directly
// (Aug 3 Derek/Justin call: "needs changes" or "approved," right in the chat,
// instead of writing a message and waiting on the team to reclassify it).
// Only these two values are ever accepted from an unauthenticated caller —
// every other TaskStatus stays internal-only.
const ALLOWED_STATUSES = new Set(["changes_requested", "done"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimit(req, token, "status");
  if (limited) return limited;

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, assigned_to").eq("share_token", token).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await req.json().catch(() => null) as { taskId?: string; status?: string } | null;
  const taskId = payload?.taskId;
  const status = payload?.status;
  if (!taskId || !status || !ALLOWED_STATUSES.has(status)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, project_id, title, status, waiting_on_client").eq("id", taskId).maybeSingle();
  if (!task || task.client_id !== client.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.status === "done") return NextResponse.json({ error: "This item has already been completed." }, { status: 400 });

  const notifyRecipient = await resolveNotifyRecipient(client.assigned_to as string[] | null);
  const patch: Record<string, unknown> = { status };
  // Same "answering the call" reasoning as respond/route.ts — setting a
  // status is itself a response, so a task that was waiting on the client
  // reopens for the team the same way replying to it would.
  if (task.waiting_on_client === true) {
    patch.waiting_on_client = false;
    patch.assignee_id = notifyRecipient;
    patch.due = todayIso();
  }

  const { error } = await supabaseAdmin.from("tasks").update(patch).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (notifyRecipient) {
    // Bell only, no companion email. Setting a review outcome is a status
    // event — the board already shows it, and it fired on every approval,
    // which is noise. A client actually WRITING something still emails (see
    // waiting/[token]/messages and waiting/[token]/respond, both untouched).
    //
    // Written inline rather than through notifyTeamOfClientActivity because
    // that helper always sends its email, and sends it under the subject
    // `X replied on "<task>"` — wording that was wrong here in the first
    // place: nobody replied, a status was set. The bell text below says what
    // actually happened. Reverting is a one-line swap back to the helper.
    await supabaseAdmin.from("notifications").insert({
      id: "n_" + randomUUID(),
      recipient_id: notifyRecipient,
      text: status === "done" ? `${client.name} approved "${task.title}".` : `${client.name} requested changes on "${task.title}".`,
      task_id: taskId,
      actor_id: null,
      client_id: client.id,
      project_id: task.project_id ?? null,
      at: new Date().toISOString(),
      read: false,
      kind: "activity",
    });
  }

  return NextResponse.json({ ok: true });
}
