// SERVER-ONLY auth guards for API routes. Verifies the caller's Supabase JWT
// (sent as `Authorization: Bearer <access_token>`) and, where required, that
// their profile role is admin. Uses the service-role client so it works with
// RLS enabled.
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "./supabaseAdmin";

// `id` is the Supabase auth uuid (profiles.id) — use it for anything keyed
// against other auth/profile rows (e.g. api_tokens.owner_id). `memberId` is
// the roster id (e.g. "u_derek", profiles.member_id) that tasks.assignee_id
// and clients.assigned_to actually store — use THAT for anything comparing
// against a task's assignee or a client's followers. The two are easy to
// mix up since the client-side `Me.id` is actually the roster id (see
// App.tsx's `users.find(u => u.id === data?.member_id)`), not this uuid.
export type AuthedUser = { id: string; memberId: string | null; email: string; role: "admin" | "va"; canSendMessages: boolean };

/** Returns the signed-in user or null. */
export async function requireUser(req: NextRequest): Promise<AuthedUser | null> {
  if (!adminConfigured) return null;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data.user) return null;
  const { data: profile } = await supabaseAdmin.from("profiles").select("role, can_send_messages, member_id").eq("id", data.user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  return { id: data.user.id, memberId: profile?.member_id ?? null, email: data.user.email ?? "", role: isAdmin ? "admin" : "va", canSendMessages: isAdmin || !!profile?.can_send_messages };
}

/** Returns the signed-in user only if they are an admin; otherwise null. */
export async function requireAdmin(req: NextRequest): Promise<AuthedUser | null> {
  const user = await requireUser(req);
  return user?.role === "admin" ? user : null;
}

/** Verifies a long-lived personal API token (see /api/tokens), not a
 * Supabase session JWT — for external clients like the Gmail extension that
 * can't do an interactive login. Returns the same AuthedUser shape as
 * requireUser so callers don't need to care which kind of credential was
 * used. */
export async function requireApiToken(req: NextRequest): Promise<AuthedUser | null> {
  if (!adminConfigured) return null;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !token.startsWith("cut_")) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: row } = await supabaseAdmin.from("api_tokens").select("id, owner_id").eq("token_hash", hash).maybeSingle();
  if (!row) return null;
  void supabaseAdmin.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id).then(() => {});
  const { data: profile } = await supabaseAdmin.from("profiles").select("email, role, can_send_messages, member_id").eq("id", row.owner_id).maybeSingle();
  if (!profile) return null;
  const isAdmin = profile.role === "admin";
  return { id: row.owner_id, memberId: profile.member_id ?? null, email: profile.email ?? "", role: isAdmin ? "admin" : "va", canSendMessages: isAdmin || !!profile.can_send_messages };
}
