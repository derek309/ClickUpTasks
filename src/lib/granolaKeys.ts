// SERVER-ONLY: each teammate's own Granola key (Derek, 2026-10-12: "per person
// keys"). A personal key reads every note its owner has, whatever folder it
// sits in, so nobody has to file meetings into a shared space. The table is
// supabase/granola-keys.sql; the key and webhook secret are encrypted.
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { decryptToken, encryptToken } from "./tokenCrypto";
import { granolaConfigured } from "./granolaClient";

export type GranolaKey = { userId: string; key: string };

/** Everyone's keys that still decrypt. */
export async function allGranolaKeys(): Promise<GranolaKey[]> {
  const { data } = await supabaseAdmin.from("granola_keys").select("user_id, key_enc");
  return (data ?? []).flatMap((r: { user_id: string; key_enc: string }) => {
    const key = decryptToken(r.key_enc);
    return key ? [{ userId: r.user_id, key }] : [];
  });
}

export async function granolaKeyFor(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin.from("granola_keys").select("key_enc").eq("user_id", userId).maybeSingle();
  return decryptToken(data?.key_enc as string | undefined);
}

/** The row a webhook delivery names, with its secret to check it against. */
export async function granolaHook(hookId: string): Promise<{ userId: string; key: string; secret: string } | null> {
  const { data } = await supabaseAdmin.from("granola_keys").select("user_id, key_enc, webhook_secret_enc").eq("hook_id", hookId).maybeSingle();
  const key = decryptToken(data?.key_enc as string | undefined);
  const secret = decryptToken(data?.webhook_secret_enc as string | undefined);
  return data && key && secret ? { userId: data.user_id as string, key, secret } : null;
}

export const newHookId = () => randomBytes(18).toString("base64url");
export const encryptGranola = (plain: string) => encryptToken(plain);

/** Whether any Granola source is set up: the deployment's key or anyone's own. */
export async function granolaAnywhere(): Promise<boolean> {
  if (granolaConfigured) return true;
  const { count } = await supabaseAdmin.from("granola_keys").select("user_id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}
