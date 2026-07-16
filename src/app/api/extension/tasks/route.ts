import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";

// Create a task on the token owner's behalf — the Gmail extension's core
// action. Mirrors the "reuse-or-create the client's default Tasks project"
// idiom already used identically by mcp/server.mjs's create_task and the GHL
// webhook's upsertConversationTask, rather than inventing a fourth variant.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!clientId || !title) return NextResponse.json({ error: "client_id and title are required." }, { status: 400 });
  // A leaked/stolen token shouldn't be able to create tasks under a client
  // that member can't see.
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  let projectId: string | undefined = (
    await supabaseAdmin.from("projects").select("id").eq("client_id", clientId).limit(1).maybeSingle()
  ).data?.id;
  if (!projectId) {
    projectId = "p_" + randomUUID();
    const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: clientId, name: "Tasks", description: "" });
    if (projErr) return NextResponse.json({ error: projErr.message }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description : "";
  const due = typeof body.due === "string" ? body.due : null;
  const link = typeof body.link === "string" && body.link.trim() ? body.link.trim() : null;
  const attachments = link ? [{ id: "at_" + randomUUID(), name: "Gmail message", kind: "link", size: "", url: link }] : [];

  const id = "t_" + randomUUID();
  const { error } = await supabaseAdmin.from("tasks").insert({
    id, project_id: projectId, client_id: clientId, title, description,
    status: "todo", priority: "normal",
    // Self-assign — unlike the MCP tool's "unassigned, creating on someone
    // else's behalf" default, this route IS the person (their own token).
    assignee_id: caller.memberId,
    contact_id: clientId.startsWith("cl_") ? clientId.slice(3) : null,
    due, attachments,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id, title, clientId, projectId });
}
