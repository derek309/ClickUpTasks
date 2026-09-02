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
  // A caller that knows when it wants to see this again can say so. The
  // website feedback plugin does: its reports are due in three working days
  // and want looking at today, and without this they arrived with no dates at
  // all and sank in the list.
  const followUpAt = typeof body.follow_up_at === "string" && body.follow_up_at ? body.follow_up_at : null;
  const link = typeof body.link === "string" && body.link.trim() ? body.link.trim() : null;
  // The extension can attach more than one screenshot per task (e.g. several
  // areas of a page under review) — each becomes its own image attachment.
  const screenshotPaths: string[] = Array.isArray(body.screenshot_paths) ? body.screenshot_paths.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0) : [];
  // Real files carried over from the source (Gmail's own attachments), as
  // opposed to screenshots. Kept separate because these have a genuine
  // filename and type worth preserving — "Screenshot 2" is fine for a
  // capture, useless for contract-v3.pdf.
  const files: { path: string; name: string; kind: string }[] = Array.isArray(body.files)
    ? body.files
        .filter((f: unknown): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f: Record<string, unknown>) => ({
          path: typeof f.path === "string" ? f.path : "",
          name: typeof f.name === "string" && f.name.trim() ? f.name.trim().slice(0, 200) : "Attachment",
          kind: f.kind === "image" ? "image" : "file",
        }))
        .filter((f: { path: string }) => f.path.length > 0)
        .slice(0, 20)
    : [];
  const attachments = [
    // Named for what it does, not what it is: this is the one-click route
    // back to the original email (Derek: "I want the link to be easy to get
    // back to so I can reply quickly").
    ...(link ? [{ id: "at_" + randomUUID(), name: link.startsWith("https://mail.google.com/") ? "Open the email in Gmail" : "Source link", kind: "link", size: "", url: link }] : []),
    ...files.map((f) => ({ id: "at_" + randomUUID(), name: f.name, kind: f.kind, size: "", path: f.path })),
    ...screenshotPaths.map((path: string, i: number) => ({ id: "at_" + randomUUID(), name: screenshotPaths.length > 1 ? `Screenshot ${i + 1}` : "Screenshot", kind: "image", size: "", path })),
  ];
  // The auto-assigned-only tiers ("conversation", "client_request" — see
  // isManuallyAssignable in src/lib/data.ts) are rejected here rather than
  // silently downgraded, same spirit as the MCP create_task enum. This is a
  // whitelist, so a future auto tier stays excluded by default.
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
    due, follow_up_at: followUpAt, attachments, created_by: caller.memberId,
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

  const { data, error } = await supabaseAdmin.from("tasks").select("id, title, status, created_at, project_id").eq("client_id", clientId).neq("status", "done").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const query = (req.nextUrl.searchParams.get("query") || "").trim().toLowerCase();
  // Optional list filter: attaching an email to an existing task means one
  // task out of a client's whole open set, which for a busy client is dozens.
  // Narrowing by the list you already picked is the difference between
  // choosing and hunting.
  const projectId = req.nextUrl.searchParams.get("project_id");
  const inList = projectId ? (data ?? []).filter((t) => t.project_id === projectId) : (data ?? []);
  const filtered = query ? inList.filter((t) => t.title.toLowerCase().includes(query)) : inList;
  // project_id rides along so the picker can label each row with its list —
  // two tasks called "Website" under different lists are otherwise the same
  // row twice.
  return NextResponse.json({
    tasks: filtered.slice(0, 30).map((t) => ({ id: t.id, title: t.title, status: t.status, projectId: t.project_id })),
  });
}
