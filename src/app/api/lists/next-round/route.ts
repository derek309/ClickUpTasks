import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { makeNextRoundFor } from "@/lib/listKindsServer";

// A repeating list's next round (mcp/listKinds.mjs, Derek 2026-10-17): the
// app asks after a round's last step is done, or a recipe is first saved. It
// makes one only when no round is open, and never the same round twice (the
// round's id is the list and its goes out day). The daily sweep
// (cron/purge-trash) catches a round finished anywhere else.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { projectId?: string };
  const projectId = typeof b.projectId === "string" ? b.projectId.trim() : "";
  if (!projectId) return NextResponse.json({ error: "projectId is needed." }, { status: 400 });
  const { data: p } = await supabaseAdmin.from("projects").select("client_id").eq("id", projectId).is("deleted_at", null).maybeSingle();
  if (!p || !(await isClientVisible(caller, (p as { client_id: string }).client_id))) return NextResponse.json({ error: "No such list." }, { status: 404 });
  const r = await makeNextRoundFor(projectId);
  return NextResponse.json({ ok: true, ...r });
}
