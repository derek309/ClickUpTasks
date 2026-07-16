// SERVER-ONLY auth guards for API routes. Verifies the caller's Supabase JWT
// (sent as `Authorization: Bearer <access_token>`) and, where required, that
// their profile role is admin. Uses the service-role client so it works with
// RLS enabled.
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "./supabaseAdmin";

export type AuthedUser = { id: string; email: string; role: "admin" | "va"; canSendMessages: boolean };

/** Returns the signed-in user or null. */
export async function requireUser(req: NextRequest): Promise<AuthedUser | null> {
  if (!adminConfigured) return null;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data.user) return null;
  const { data: profile } = await supabaseAdmin.from("profiles").select("role, can_send_messages").eq("id", data.user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  return { id: data.user.id, email: data.user.email ?? "", role: isAdmin ? "admin" : "va", canSendMessages: isAdmin || !!profile?.can_send_messages };
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
  const { data: profile } = await supabaseAdmin.from("profiles").select("email, role, can_send_messages").eq("id", row.owner_id).maybeSingle();
  if (!profile) return null;
  const isAdmin = profile.role === "admin";
  return { id: row.owner_id, email: profile.email ?? "", role: isAdmin ? "admin" : "va", canSendMessages: isAdmin || !!profile.can_send_messages };
}
