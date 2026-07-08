import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/serverAuth";

// Admin-only: invites a teammate by email via Supabase Auth's built-in invite
// flow (creates the auth user + profile row immediately, role defaults to
// 'va'; emails them a magic link to set a password). This is now the ONLY
// way new accounts get created — public self-serve signup was removed.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email, name } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string" || !email.includes("@"))
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
    redirectTo: req.nextUrl.origin,
    data: name ? { name: String(name).trim() } : undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, email: data.user?.email });
}
