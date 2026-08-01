import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Admin-only correction for a message that already sent wrong — body/subject
// only, deliberately not exposed via RLS + column grants (see
// supabase/message-delete-policy.sql for why that doesn't compose cleanly
// with the existing assignee-can-mark-read policy). This does NOT unsend a
// real email or text already in the client's inbox/phone — it only changes
// what's displayed in ClickUpTasks and on their public waiting-page thread
// going forward. The caller is responsible for telling the client directly
// if the original already reached them incorrectly.
export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Admin only." }, { status: 403 });

  const b = await req.json().catch(() => null) as { id?: string; body?: string; subject?: string | null } | null;
  const { id, body, subject } = b ?? {};
  if (!id || typeof body !== "string" || !body.trim())
    return NextResponse.json({ error: "Missing id or body." }, { status: 400 });

  const patch: Record<string, unknown> = { body: body.slice(0, 20000) };
  if (subject !== undefined) patch.subject = subject?.trim() ? subject.slice(0, 200) : null;

  const { error } = await supabaseAdmin.from("messages").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
