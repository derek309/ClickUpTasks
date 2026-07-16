import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";

// The full team roster for the extension's "Assign to" picker — mirrors
// TaskDrawer.tsx's own Assignee picker, which also shows every teammate
// unfiltered by role (not scoped to visible clients; assignment is a
// team-wide action in the main app too).
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin.from("profiles").select("member_id, name, role").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const members = (data ?? []).filter((p) => p.member_id).map((p) => ({ id: p.member_id, name: p.name, role: p.role }));
  return NextResponse.json({ members });
}
