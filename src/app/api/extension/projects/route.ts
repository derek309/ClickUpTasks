import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";

// Projects ("lists") for a client, for the extension's optional project
// picker — same {id, name} shape as GET /api/extension/clients.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Missing client_id." }, { status: 400 });
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  const { data: projects, error } = await supabaseAdmin.from("projects").select("id, name").eq("client_id", clientId).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ projects: projects ?? [] });
}
