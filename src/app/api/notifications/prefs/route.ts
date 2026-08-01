import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";

// Self-service per-user email notification preferences — same shape as
// /api/tokens: a caller can only ever read/write their own row (auth.uid()),
// never someone else's. Only gates the best-effort EMAIL companion to a
// notification (see Cockpit.tsx's notify()); the in-app bell always fires.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email_notify_activity, email_notify_message, email_notify_dm")
    .eq("id", caller.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    emailNotifyActivity: data?.email_notify_activity ?? true,
    emailNotifyMessage: data?.email_notify_message ?? true,
    emailNotifyDm: data?.email_notify_dm ?? true,
  });
}

export async function PATCH(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, boolean> = {};
  if (typeof body.emailNotifyActivity === "boolean") patch.email_notify_activity = body.emailNotifyActivity;
  if (typeof body.emailNotifyMessage === "boolean") patch.email_notify_message = body.emailNotifyMessage;
  if (typeof body.emailNotifyDm === "boolean") patch.email_notify_dm = body.emailNotifyDm;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", caller.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
