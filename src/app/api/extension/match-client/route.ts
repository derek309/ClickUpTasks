import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";

// Best-effort client suggestion for the extension's popup — exact
// (case-insensitive) match on the Gmail sender's email against an existing
// Contact. Restricted to the caller's visible clients so a VA's token can't
// discover a client's existence via a match they can't otherwise see.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ match: null });

  const { data: contact } = await supabaseAdmin.from("contacts").select("client_id").ilike("email", email).limit(1).maybeSingle();
  if (!contact) return NextResponse.json({ match: null });
  if (!(await isClientVisible(caller, contact.client_id))) return NextResponse.json({ match: null });

  const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("id", contact.client_id).maybeSingle();
  if (!client) return NextResponse.json({ match: null });
  return NextResponse.json({ match: { clientId: client.id, clientName: client.name } });
}
