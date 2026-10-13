import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenCryptoReady, decryptToken } from "@/lib/tokenCrypto";
import { granolaCreateWebhookEndpoint, granolaDeleteWebhookEndpoint, granolaListNotesSince } from "@/lib/granolaClient";
import { encryptGranola, newHookId } from "@/lib/granolaKeys";

// Your own Granola key (Derek, 2026-10-12): paste it once in Settings,
// Granola, and your meetings come in from whatever folder you keep them in.
// Saving checks the key with Granola, then registers a webhook for it.

// GET: whether you are connected; for an admin, who on the team is.
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: mine } = await supabaseAdmin.from("granola_keys").select("created_at, webhook_id").eq("user_id", caller.id).maybeSingle();
  let team: { name: string; since: string }[] | undefined;
  if (caller.role === "admin") {
    const { data } = await supabaseAdmin.from("granola_keys").select("user_id, created_at");
    const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
    const { data: people } = ids.length ? await supabaseAdmin.from("profiles").select("id, name").in("id", ids) : { data: [] };
    team = (data ?? []).map((r: { user_id: string; created_at: string }) => ({ name: (people ?? []).find((p: { id: string; name: string }) => p.id === r.user_id)?.name ?? "Someone", since: r.created_at }));
  }
  return NextResponse.json({ connected: !!mine, since: mine?.created_at ?? null, webhook: !!mine?.webhook_id, team });
}

// POST { key }: check it, save it encrypted, register its webhook.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tokenCryptoReady()) return NextResponse.json({ error: "TOKEN_ENC_KEY is not set, so keys can't be stored safely." }, { status: 501 });
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const apiKey = (key ?? "").trim();
  if (!apiKey) return NextResponse.json({ error: "Paste your Granola key." }, { status: 400 });
  try {
    await granolaListNotesSince(new Date(Date.now() - 86400000).toISOString(), apiKey);
  } catch {
    return NextResponse.json({ error: "Granola didn't accept that key. Copy it again from Granola, Settings, Connectors, Personal API keys." }, { status: 400 });
  }
  const { data: old } = await supabaseAdmin.from("granola_keys").select("key_enc, webhook_id").eq("user_id", caller.id).maybeSingle();
  const oldKey = decryptToken(old?.key_enc as string | undefined);
  if (old?.webhook_id && oldKey) await granolaDeleteWebhookEndpoint(old.webhook_id as string, oldKey);

  const hookId = newHookId();
  let webhookId: string | null = null, secretEnc: string | null = null, note: string | undefined;
  try {
    const hook = await granolaCreateWebhookEndpoint(`${req.nextUrl.origin}/api/granola/webhook?h=${hookId}`, apiKey, ["personal"]);
    webhookId = hook.id; secretEnc = encryptGranola(hook.signing_secret);
  } catch (e) {
    note = `Saved, but Granola wouldn't register the webhook (${e instanceof Error ? e.message.slice(0, 120) : "error"}). Your meetings still come in through Sync.`;
  }
  const { error } = await supabaseAdmin.from("granola_keys").upsert({
    user_id: caller.id, hook_id: hookId, key_enc: encryptGranola(apiKey), webhook_id: webhookId, webhook_secret_enc: secretEnc,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, webhook: !!webhookId, note });
}

// DELETE: disconnect, and take the webhook with it.
export async function DELETE(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: old } = await supabaseAdmin.from("granola_keys").select("key_enc, webhook_id").eq("user_id", caller.id).maybeSingle();
  const oldKey = decryptToken(old?.key_enc as string | undefined);
  if (old?.webhook_id && oldKey) await granolaDeleteWebhookEndpoint(old.webhook_id as string, oldKey);
  await supabaseAdmin.from("granola_keys").delete().eq("user_id", caller.id);
  return NextResponse.json({ ok: true });
}
