// SERVER ONLY. Claude Code access for one teammate (Derek, 2026-10-07: "is
// there a way in settings that we can just turn it on for him ... he already
// has a login"). The switch in Settings, Team is a personal token named
// CLAUDE_CODE_TOKEN: on makes one for them, off deletes it, which cuts them
// off at once. The MCP endpoint accepts that token (besides the shared
// MCP_CONNECTOR_SECRET) and acts as its owner, so their tasks are theirs and
// what they do is logged as them. Their own Settings copies the command with
// it filled in (see ApiTokensPanel).

import { supabaseAdmin } from "./supabaseAdmin";
import { randomUUID } from "node:crypto";
import { hashToken, mintToken } from "./tokenCrypto";

export const CLAUDE_CODE_TOKEN = "Claude Code";

/** The teammate a "Claude Code" token belongs to, or null. */
export async function memberForClaudeToken(raw: string): Promise<string | null> {
  if (!raw.startsWith("cut_")) return null;
  const { data: row } = await supabaseAdmin.from("api_tokens").select("id, owner_id").eq("token_hash", hashToken(raw)).eq("name", CLAUDE_CODE_TOKEN).maybeSingle();
  if (!row) return null;
  const { data: profile } = await supabaseAdmin.from("profiles").select("id, member_id").eq("id", row.owner_id).maybeSingle();
  if (!profile) return null;
  void supabaseAdmin.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id).then(() => {});
  return (profile.member_id as string | null) || (profile.id as string);
}

/** Whose Claude Code access is on (profile ids). */
export async function claudeCodeOwners(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("api_tokens").select("owner_id").eq("name", CLAUDE_CODE_TOKEN);
  return new Set((data ?? []).map((r) => r.owner_id as string));
}

/** Turn it on (one token, made if they have none) or off (their tokens deleted). */
export async function setClaudeCodeAccess(profileId: string, on: boolean): Promise<{ error?: string }> {
  if (!on) {
    const { error } = await supabaseAdmin.from("api_tokens").delete().eq("owner_id", profileId).eq("name", CLAUDE_CODE_TOKEN);
    return error ? { error: error.message } : {};
  }
  const { data: had } = await supabaseAdmin.from("api_tokens").select("id").eq("owner_id", profileId).eq("name", CLAUDE_CODE_TOKEN).limit(1);
  if (had?.length) return {};
  const { hash, enc } = mintToken("cut_");
  if (!enc) return { error: "TOKEN_ENC_KEY isn't set, so they couldn't copy their command. Set it on the server first." };
  const { error } = await supabaseAdmin.from("api_tokens").insert({ id: "tok_" + randomUUID(), owner_id: profileId, name: CLAUDE_CODE_TOKEN, token_hash: hash, token_enc: enc });
  return error ? { error: error.message } : {};
}
