import { NextRequest, NextResponse } from "next/server";
import { granolaConfigured } from "@/lib/granolaClient";
import { requireUser } from "@/lib/serverAuth";

// Whether Granola is wired up on the server. Two booleans, no secrets — but it
// is read by the same admin-only integrations tab as the GoHighLevel status
// route beside it, and there is no reason for an anonymous caller to learn
// which integrations a deployment runs.
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller || caller.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ apiKeyConfigured: granolaConfigured, webhookConfigured: !!process.env.GRANOLA_WEBHOOK_SECRET });
}
