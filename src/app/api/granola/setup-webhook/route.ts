import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { granolaCreateWebhookEndpoint, granolaConfigured } from "@/lib/granolaClient";

// One-time setup: registers this deployment's /api/granola/webhook URL with
// Granola. Returns a signing_secret Granola only ever shows once — after
// calling this, that value must be added as GRANOLA_WEBHOOK_SECRET (env) and
// the app redeployed before the webhook route can verify anything. Admin-only,
// triggered by the "Connect Granola" button in Settings > Integrations.

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!granolaConfigured) return NextResponse.json({ error: "GRANOLA_API_KEY is not configured." }, { status: 501 });

  const origin = req.nextUrl.origin;
  try {
    const result = await granolaCreateWebhookEndpoint(`${origin}/api/granola/webhook`);
    return NextResponse.json({ ok: true, id: result.id, signingSecret: result.signing_secret });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Granola webhook registration failed." }, { status: 502 });
  }
}
