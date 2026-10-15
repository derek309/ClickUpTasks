import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { pushConfigured } from "@/lib/push";
import { parsePushSubscription } from "@/lib/pushPayload";

// This phone's notifications (Settings, Notifications): POST saves or
// refreshes the signed in person's subscription for this device, DELETE
// removes it. Keyed on the endpoint, which is unique per browser install, so
// the same phone turned on twice is one row, and a phone signed into by
// someone else becomes theirs. The service role writes it after the session
// check, as every other per person route here does (/api/tokens);
// supabase/push-subscriptions.sql keeps RLS on as a second wall.

export async function POST(req: NextRequest) {
  if (!pushConfigured()) return NextResponse.json({ error: "Notifications are not set up yet." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = parsePushSubscription(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { endpoint, p256dh, auth } = parsed.sub;
  const { error } = await supabaseAdmin.from("push_subscriptions").upsert({
    user_id: caller.id, endpoint, p256dh, auth,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
    last_used_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof b?.endpoint === "string" ? b.endpoint.trim() : "";
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  const { error } = await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", caller.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
