import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { todayIso, type Attachment } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";
import { rateLimit } from "@/lib/rateLimit";
import { resolveNotifyRecipient, notifyTeamOfClientActivity } from "@/lib/waitingNotify";
import { resolveWaitingToken } from "@/lib/waitingToken";

// Public, token-gated — lets the client raise a brand-new task themselves
// ("need something else?"), not just reply to something we're already
// waiting on them for. Stamps the request onto the new task's
// client_response field so it renders through the exact same "Client
// response" panel in TaskDrawer and the exact same "Submitted" card on this
// public page — no separate rendering path needed for a client-originated
// task vs. a client-answered one. ALSO inserts it as a real `messages` row
// (channel: "chat") so the task's Activity feed and this page's own thread
// show it from the start — without this, a task the client raised had
// nothing in it to Reply to, since client_response alone never fed the
// messages table the chat feature reads. Lands as a normal status:"todo"
// task (not a distinct pipeline stage) — the highlighted client_response
// panel is what flags it as needing a look, same as everywhere else here.
//
// Unlike replying (./messages, ./respond), raising a task is NOT something
// every share link can do — it's per client, off by default, and switched on
// by an admin (clients.can_request_new_tasks, see
// supabase/client-request-new-tasks.sql). The page hides the composer when
// it's off, but that's only the courtesy; the check below is the gate, since
// the token alone is all a direct POST would need.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimit(req, token, "request");
  if (limited) return limited;

  const scope = await resolveWaitingToken(token);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Deliberately a plain "not for you" and not a 404: the link is valid and
  // the rest of the page still works, so the message says what to do instead
  // rather than implying the whole link is broken. A project-scoped token
  // always fails this — canRequestNewTasks is forced false for one by
  // resolveWaitingToken, since there's no single project a list link should
  // be trusted to name freely (see the projectId trust-check further down,
  // which this same route already applies to a CLIENT token's request).
  if (!scope.canRequestNewTasks) {
    return NextResponse.json({ error: "This isn't available for your account yet. Reply on one of your existing tasks, or reach out to us directly." }, { status: 403 });
  }

  const payload = await req.json().catch(() => null) as { body?: string; attachments?: Attachment[]; projectId?: string } | null;
  const text = (payload?.body ?? "").slice(0, 10000).trim();
  // Never trust the caller's attachment objects — rebuild each from a storage
  // path we can prove belongs to this client (see sanitizeWaitingAttachments).
  const attachments = sanitizeWaitingAttachments(payload?.attachments, scope.clientId);
  if (!text && attachments.length === 0) return NextResponse.json({ error: "Add a note or attachment before sending." }, { status: 400 });

  // The client can name which of their own lists this is for (the page
  // offers a picker once there's more than one) — but never trust the id
  // outright, same reasoning as attachments above: confirm it's actually
  // one of THIS client's projects before writing into it, so a crafted
  // request can't land a task under a different client's list.
  let projectId: string | null = null;
  if (payload?.projectId) {
    const { data: owned } = await supabaseAdmin.from("projects").select("id").eq("id", payload.projectId).eq("client_id", scope.clientId).maybeSingle();
    if (owned) projectId = owned.id;
  }
  // No (valid) project named — reuse (or create) the client's default
  // "Tasks" list, same find-or-create idiom mcp/server.mjs's create_task
  // and the GHL webhook already use.
  if (!projectId) {
    const { data: existingProjects } = await supabaseAdmin.from("projects").select("id").eq("client_id", scope.clientId).limit(1);
    if (existingProjects?.length) {
      projectId = existingProjects[0].id;
    } else {
      projectId = "p_" + randomUUID();
      const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: scope.clientId, name: "Tasks", description: "" });
      if (projErr) return NextResponse.json({ error: projErr.message }, { status: 400 });
    }
  }

  const assignee = await resolveNotifyRecipient(scope.assignedTo);
  const contactId = scope.clientId.startsWith("cl_") ? scope.clientId.slice(3) : null;

  const title = text ? (text.length > 80 ? text.slice(0, 77) + "…" : text) : "New request";
  const taskId = "t_" + randomUUID();
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from("tasks").insert({
    id: taskId, project_id: projectId, client_id: scope.clientId, title, description: "",
    // Top priority tier, above Urgent — a client is waiting on this. These
    // used to land as "No priority" and sort dead last, mixed in with our
    // own backlog. assignee falls back to the first admin when nobody owns
    // the client (see resolveNotifyRecipient), so it is never unassigned.
    status: "todo", priority: "client_request", assignee_id: assignee,
    contact_id: contactId,
    due: todayIso(),
    client_response: { body: text, attachments, submittedAt: nowIso },
    created_by: "client",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (contactId) {
    await supabaseAdmin.from("messages").insert({
      id: "msg_" + randomUUID(), contact_id: contactId, client_id: scope.clientId, task_id: taskId,
      channel: "chat", direction: "inbound", subject: null, body: text, attachments,
      created_by: null, created_at: nowIso,
    });
  }

  if (assignee) {
    await notifyTeamOfClientActivity({
      notifyRecipient: assignee, clientId: scope.clientId, taskId, projectId,
      clientName: scope.clientName, taskTitle: title,
      notifText: `${scope.clientName} requested a new task: "${title}".`,
      previewText: text || null,
      kind: "message",
    });
  }

  return NextResponse.json({ ok: true });
}
