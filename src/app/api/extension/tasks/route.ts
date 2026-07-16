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

  const requestedProjectId = typeof body.project_id === "string" && body.project_id.trim() ? body.project_id.trim() : null;
  let projectId: string | undefined;
  if (requestedProjectId) {
    // Caller picked a specific list — confirm it actually belongs to this
    // client so a token can't be used to target an arbitrary project under
    // a different (possibly invisible-to-them) client.
    const { data: requested } = await supabaseAdmin.from("projects").select("id").eq("id", requestedProjectId).eq("client_id", clientId).maybeSingle();
    if (!requested) return NextResponse.json({ error: "That project doesn't belong to this client." }, { status: 400 });
    projectId = requested.id;
  } else {
    projectId = (
      await supabaseAdmin.from("projects").select("id").eq("client_id", clientId).limit(1).maybeSingle()
    ).data?.id;
    if (!projectId) {
      projectId = "p_" + randomUUID();
      const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: clientId, name: "Tasks", description: "" });
      if (projErr) return NextResponse.json({ error: projErr.message }, { status: 400 });
    }
  }

  const description = typeof body.description === "string" ? body.description : "";
  const due = typeof body.due === "string" && body.due ? body.due : null;
  const link = typeof body.link === "string" && body.link.trim() ? body.link.trim() : null;
  const screenshotPath = typeof body.screenshot_path === "string" && body.screenshot_path.trim() ? body.screenshot_path.trim() : null;
  const attachments = [
    ...(link ? [{ id: "at_" + randomUUID(), name: "Source link", kind: "link", size: "", url: link }] : []),
    ...(screenshotPath ? [{ id: "at_" + randomUUID(), name: "Screenshot", kind: "image", size: "", path: screenshotPath }] : []),
  ];
  // "conversation" is auto-assigned only (see isManuallyAssignable in
  // src/lib/data.ts) — reject it here rather than silently downgrading it,
  // same spirit as the MCP tool's create_task excluding it from its enum.
  const ALLOWED_PRIORITIES = new Set(["none", "normal", "urgent"]);
  const priority = typeof body.priority === "string" && ALLOWED_PRIORITIES.has(body.priority) ? body.priority : "normal";

  const id = "t_" + randomUUID();
  const { error } = await supabaseAdmin.from("tasks").insert({
    id, project_id: projectId, client_id: clientId, title, description,
    status: "todo", priority,
    // Self-assign by default — unlike the MCP tool's "unassigned, creating
    // on someone else's behalf" default, this route IS the person (their
    // own token) — but let them explicitly hand it to a teammate instead.
    assignee_id: typeof body.assignee_id === "string" && body.assignee_id ? body.assignee_id : caller.memberId,
    contact_id: clientId.startsWith("cl_") ? clientId.slice(3) : null,
    due, attachments,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id, title, clientId, projectId });
}

// Task search for the extension's "add to existing task" flow — open tasks
// for a client, most-recent-first, optionally narrowed by a title
// substring. No existing .ilike("title", ...) convention on tasks anywhere
// in this codebase to defer to, so this filters in JS after fetch, same
// idiom CommandK.tsx and the extension's own client picker already use.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Missing client_id." }, { status: 400 });
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  const { data, error } = await supabaseAdmin.from("tasks").select("id, title, status, created_at").eq("client_id", clientId).neq("status", "done").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const query = (req.nextUrl.searchParams.get("query") || "").trim().toLowerCase();
  const filtered = query ? (data ?? []).filter((t) => t.title.toLowerCase().includes(query)) : (data ?? []);
  return NextResponse.json({ tasks: filtered.slice(0, 30).map((t) => ({ id: t.id, title: t.title, status: t.status })) });
}
