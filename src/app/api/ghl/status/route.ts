import { NextRequest, NextResponse } from "next/server";
import { configuredLocations } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";

// Reports which GoHighLevel sub-accounts have a token configured on the server.
// Tokens themselves are never returned to the browser.
//
// Admin-only. It was unauthenticated, which meant anyone who knew the URL could
// enumerate every sub-account id this agency works with — not credentials, but
// a client list, and one that maps straight onto GoHighLevel URLs. Its only
// caller is the integrations tab, which is already behind canAdmin in the UI;
// this makes the server agree with that rather than trusting the UI to hold.
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller || caller.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const locations = await configuredLocations();
  return NextResponse.json({ configured: locations.length > 0 || Boolean(process.env.GHL_TOKEN), locations });
}
