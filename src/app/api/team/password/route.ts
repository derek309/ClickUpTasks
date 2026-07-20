import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/serverAuth";
import { sendGmailAs, googleConfigured } from "@/lib/googleMail";

// Admin sets (or resets) a teammate's password directly — the resilient path
// when Supabase's own invite/reset email is stuck (rate-limited, wrong
// inbox, etc.): this needs no email delivery to work at all. The admin sees
// the password once after setting it and relays it themselves; the affected
// teammate just gets a heads-up email (no password in it — see below).
const SEND_DOMAIN = "clickuplocal.com";

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, password } = await req.json().catch(() => ({}));
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  if (!password || typeof password !== "string" || password.length < 8)
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  // email_confirm: true so this also unblocks an account still stuck in
  // "invited, never confirmed" limbo — the exact state a broken invite email
  // leaves someone in.
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(id, { password, email_confirm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Best-effort heads-up email — deliberately does NOT include the new
  // password (that lives only in the admin's one-time reveal + however they
  // relay it). A failure here (Google not configured, non-Workspace caller,
  // send error, or the affected user simply has no email on file yet) is
  // swallowed — the password change itself already succeeded.
  if (googleConfigured && caller.email.toLowerCase().endsWith(`@${SEND_DOMAIN}`) && data.user?.email) {
    const { data: senderProfile } = await supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle();
    const senderName = (senderProfile?.name as string | null)?.trim() || "An admin";
    sendGmailAs(caller.email, {
      to: data.user.email,
      subject: "Your ClickUpTasks password was updated",
      body: `${senderName} just set a new password on your ClickUpTasks account.\n\nIf you weren't expecting this, reach out to them directly.`,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
