import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { todayIso, type Attachment } from "@/lib/data";
import { sanitizeWaitingAttachments } from "@/lib/waitingAttachments";

// Public, token-gated — lets the client raise a brand-new task themselves
// ("need something else?"), not just reply to something we're already
// waiting on them for. Mirrors ../respond/route.ts's reassignment logic
// exactly (first client-following team member, else the first admin) and
// stamps the request onto the new task's client_response field so it
// renders through the exact same "Client response" panel in TaskDrawer and
// the exact same "Submitted" card on this public page — no separate
// rendering path needed for a client-originated task vs. a client-answered
// one. Lands as a normal status:"todo" task (not a distinct pipeline
// stage) — the highlighted client_response panel is what flags it as
// needing a look, same as everywhere else in this feature.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, assigned_to").eq("share_token", token).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await req.json().catch(() => null) as { body?: string; attachments?: Attachment[]; projectId?: string } | null;
  const text = (payload?.body ?? "").slice(0, 10000).trim();
  // Never trust the caller's attachment objects — rebuild each from a storage
  // path we can prove belongs to this client (see sanitizeWaitingAttachments).
  const attachments = sanitizeWaitingAttachments(payload?.attachments, client.id);
  if (!text && attachments.length === 0) return NextResponse.json({ error: "Add a note or attachment before sending." }, { status: 400 });

  // The client can name which of their own lists this is for (the page
  // offers a picker once there's more than one) — but never trust the id
  // outright, same reasoning as attachments above: confirm it's actually
  // one of THIS client's projects before writing into it, so a crafted
  // request can't land a task under a different client's list.
  let projectId: string | null = null;
  if (payload?.projectId) {
    const { data: owned } = await supabaseAdmin.from("projects").select("id").eq("id", payload.projectId).eq("client_id", client.id).maybeSingle();
    if (owned) projectId = owned.id;
  }
  // No (valid) project named — reuse (or create) the client's default
  // "Tasks" list, same find-or-create idiom mcp/server.mjs's create_task
  // and the GHL webhook already use.
  if (!projectId) {
    const { data: existingProjects } = await supabaseAdmin.from("projects").select("id").eq("client_id", client.id).limit(1);
    if (existingProjects?.length) {
      projectId = existingProjects[0].id;
    } else {
      projectId = "p_" + randomUUID();
      const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: client.id, name: "Tasks", description: "" });
      if (projErr) return NextResponse.json({ error: projErr.message }, { status: 400 });
    }
  }

  const followers: string[] = Array.isArray(client.assigned_to) ? client.assigned_to : [];
  let assignee: string | null = followers[0] ?? null;
  if (!assignee) {
    const { data: admin } = await supabaseAdmin
      .from("profiles").select("member_id").eq("role", "admin").not("member_id", "is", null)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    assignee = admin?.member_id ?? null;
  }

  const title = text ? (text.length > 80 ? text.slice(0, 77) + "…" : text) : "New request";
  const taskId = "t_" + randomUUID();
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from("tasks").insert({
    id: taskId, project_id: projectId, client_id: client.id, title, description: "",
    status: "todo", priority: "none", assignee_id: assignee,
    contact_id: client.id.startsWith("cl_") ? client.id.slice(3) : null,
    due: todayIso(),
    client_response: { body: text, attachments, submittedAt: nowIso },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (assignee) {
    await supabaseAdmin.from("notifications").insert({
      id: "n_" + randomUUID(), recipient_id: assignee,
      text: `${client.name} requested a new task: "${title}"`,
      task_id: taskId, actor_id: null, client_id: client.id, project_id: projectId,
      at: nowIso, read: false, kind: "activity",
    });
  }

  return NextResponse.json({ ok: true });
}
