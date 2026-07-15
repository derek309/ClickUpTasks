import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("profiles").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Flag accounts that have never signed in (i.e. invite still pending) so the
  // UI can show "Invite pending" and offer to revoke.
  let pendingIds = new Set<string>();
  try {
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    pendingIds = new Set((users?.users ?? []).filter((u) => !u.last_sign_in_at).map((u) => u.id));
  } catch { /* pending flag is best-effort */ }

  return NextResponse.json({ profiles: (data ?? []).map((p) => ({ ...p, pending: pendingIds.has(p.id) })) });
}

export async function PATCH(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (body.role) patch.role = body.role;
  if (typeof body.can_send_messages === "boolean") patch.can_send_messages = body.can_send_messages;
  const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// Remove a team member entirely (revoke a pending invite or delete an account).
// Deletes the auth user; the profiles row cascades. Admins can't delete themselves.
export async function DELETE(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  if (id === caller.id) return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
