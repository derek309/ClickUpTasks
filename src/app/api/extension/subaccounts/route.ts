import { NextRequest, NextResponse } from "next/server";
import { requireApiToken } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";

// The GHL sub-account picker for POST .../contacts (create a new contact) —
// a sub-account Client row's id doesn't start with "cl_" (that prefix marks
// a promoted business), see subAccounts in Cockpit.tsx.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller.role !== "admin") return NextResponse.json({ error: "Only admins can create new GoHighLevel contacts." }, { status: 403 });

  const { data, error } = await supabaseAdmin.from("clients").select("id, name, ghl_location_id").not("id", "like", "cl_%").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const subAccounts = (data ?? []).filter((c) => c.ghl_location_id).map((c) => ({ id: c.id, name: c.name }));
  return NextResponse.json({ subAccounts });
}
