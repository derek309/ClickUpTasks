import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { PERSONAL_CLIENT_ID } from "@/lib/data";
import { APP_URL } from "@/lib/appUrl";

// The client's public portal (/waiting/<share_token>), for the Brain Box
// plugin's "Your projects" link in the owner's menu. The extension token says
// who is asking, not which client, so the site names its client (the same
// client_id it already files feedback under) and the token must be able to see
// it, as on every other extension route.
//
// A client with no share link yet gets one, the same 32 hex characters
// getClientShareUrl (src/components/cockpit/useShareLinks.ts), the portal
// reminders and the MCP get_client_link mint, so the link always exists.
// Personal is refused outright, as everywhere: its tasks are every teammate's
// private list, and a share link would publish them.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = (req.nextUrl.searchParams.get("client_id") ?? "").trim();
  if (!clientId) return NextResponse.json({ error: "client_id is required." }, { status: 400 });
  if (clientId === PERSONAL_CLIENT_ID) return NextResponse.json({ error: "Personal tasks can't be shared." }, { status: 400 });
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  const { data: client } = await supabaseAdmin.from("clients").select("id, share_token").eq("id", clientId).is("deleted_at", null).maybeSingle();
  if (!client) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 404 });

  let token = (client.share_token as string | null) ?? null;
  if (!token) {
    token = randomUUID().replace(/-/g, "");
    const { error } = await supabaseAdmin.from("clients").update({ share_token: token }).eq("id", clientId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ url: `${APP_URL}/waiting/${token}` });
}
