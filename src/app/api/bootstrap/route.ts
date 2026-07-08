import { NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";

// One-time bootstrap: promotes the founder account to admin. Hardcoded to a
// single email so it can't be abused to escalate arbitrary accounts.
const FOUNDER_EMAIL = "derek@clickuplocal.com";

export async function POST() {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });

  const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 400 });
  const user = data.users.find((u) => (u.email ?? "").toLowerCase() === FOUNDER_EMAIL);
  if (!user) return NextResponse.json({ error: `No auth user for ${FOUNDER_EMAIL}` }, { status: 404 });

  const { error } = await supabaseAdmin.from("profiles").upsert({
    id: user.id, email: user.email, name: "Derek Fox", role: "admin", member_id: "u_derek", color: "#a855f7",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, promoted: user.email });
}
