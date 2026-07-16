import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { visibleClientIds } from "@/lib/extensionApi";
import { WORKSPACE_CLIENT_ID } from "@/lib/data";

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: clients, error } = await supabaseAdmin.from("clients").select("id, name").eq("type", "client").like("id", "cl_%").neq("id", WORKSPACE_CLIENT_ID).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const visible = await visibleClientIds(caller);
  const result = visible === "all" ? (clients ?? []) : (clients ?? []).filter((c) => visible.has(c.id));
  return NextResponse.json({ clients: result });
}
