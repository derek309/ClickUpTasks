import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { visibleClientIds, isClientVisible } from "@/lib/extensionApi";
import { WORKSPACE_CLIENT_ID } from "@/lib/data";

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: clients, error } = await supabaseAdmin.from("clients").select("id, name, ghl_location_id, linked_contact_id").eq("type", "client").like("id", "cl_%").neq("id", WORKSPACE_CLIENT_ID).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const visible = await visibleClientIds(caller);
  const filtered = visible === "all" ? (clients ?? []) : (clients ?? []).filter((c) => visible.has(c.id));

  // Resolve each client's primary contact name for the picker — same
  // convention as contactForClient in Cockpit.tsx: an explicit
  // linked_contact_id wins, otherwise the client id itself encodes the
  // contact id ("cl_" + contact id).
  const contactIdFor = (c: { id: string; linked_contact_id: string | null }) => c.linked_contact_id || (c.id.startsWith("cl_") ? c.id.slice(3) : null);
  const contactIds = filtered.map(contactIdFor).filter((id): id is string => !!id);
  const { data: contacts } = contactIds.length ? await supabaseAdmin.from("contacts").select("id, name").in("id", contactIds) : { data: [] };
  const contactNameById = new Map((contacts ?? []).map((c) => [c.id, c.name]));

  const clientResults = filtered.map((c) => {
    const contactId = contactIdFor(c);
    return {
      id: c.id,
      name: c.name,
      kind: "client" as const,
      company: c.ghl_location_id || null,
      contactName: contactId ? contactNameById.get(contactId) ?? null : null,
    };
  });

  // Internal/workspace projects (Administration, Idea board, etc. — same
  // ones the main app's sidebar "Projects" section shows) are also valid
  // task-creation targets, not just real GHL clients. Same visibility check
  // as a normal client, since visibleClientIds already treats the workspace
  // pseudo-client the same way a real client would be (a task assigned
  // there, or being followed, makes it visible).
  let projectResults: { id: string; name: string; kind: "project"; clientId: string }[] = [];
  if (await isClientVisible(caller, WORKSPACE_CLIENT_ID)) {
    const { data: workspaceProjects } = await supabaseAdmin.from("projects").select("id, name").eq("client_id", WORKSPACE_CLIENT_ID).order("name");
    projectResults = (workspaceProjects ?? []).map((p) => ({ id: p.id, name: p.name, kind: "project" as const, clientId: WORKSPACE_CLIENT_ID }));
  }

  return NextResponse.json({ clients: [...clientResults, ...projectResults] });
}
