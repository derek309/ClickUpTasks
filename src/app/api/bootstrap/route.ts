import { NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";

// One-time bootstrap: promotes the founder account to admin. Hardcoded to a
// single email so it can't be abused to escalate arbitrary accounts.
const FOUNDER_EMAIL = "derek@clickuplocal.com";

export async function POST() {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });

  // Deliberately unauthenticated (there's no admin to authenticate as before
  // the first one exists), so it must be INERT once it has done its job —
  // otherwise anyone could POST repeatedly to reset the founder's name/role/
  // color back to these hardcoded values and to make the server enumerate
  // every auth user on each call. Once the founder profile is an admin,
  // there is nothing left to bootstrap: return early, touching nothing.
  const { data: existing } = await supabaseAdmin.from("profiles").select("id, role").ilike("email", FOUNDER_EMAIL).maybeSingle();
  if (existing?.role === "admin") return NextResponse.json({ ok: true, alreadyBootstrapped: true });

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
