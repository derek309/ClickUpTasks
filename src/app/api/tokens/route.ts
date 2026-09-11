import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { mintToken, tokenCryptoReady } from "@/lib/tokenCrypto";

// Personal API tokens for external clients (the Gmail Chrome extension) that
// can't do an interactive login — see requireApiToken in serverAuth.ts.
//
// Two copies of every token are stored, and they do different jobs:
//   token_hash  sha256, the only thing authentication ever compares against
//   token_enc   AES-256-GCM ciphertext, so an existing token can be copied
//               again rather than only rotated (Derek, 2026-09-06)
//
// The encryption key is an environment variable, never a database column, so
// reading this table is not the same as holding the tokens — see
// lib/tokenCrypto. Tokens created before that existed have no ciphertext and
// cannot be recovered; Rotate is still the answer for those.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("api_tokens").select("id, name, created_at, last_used_at, token_enc").eq("owner_id", caller.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // token_enc never leaves the server. The list only says whether a Copy
  // button should be offered, so the UI does not have to promise something it
  // will then fail to deliver.
  const tokens = (data ?? []).map(({ token_enc, ...t }) => ({ ...t, copyable: tokenCryptoReady() && !!token_enc }));
  return NextResponse.json({ tokens });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Chrome extension";
  const { raw, hash, enc } = mintToken("cut_");
  const id = "tok_" + randomUUID();
  const { error } = await supabaseAdmin.from("api_tokens").insert({ id, owner_id: caller.id, name, token_hash: hash, token_enc: enc });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // One of only two times the raw token is ever returned — the UI must show
  // it once and warn it can't be retrieved again (only the hash is kept).
  return NextResponse.json({ id, name, token: raw });
}

// Rotate: keep the row, replace the secret. Everything still pointed at the
// old value stops working the moment this returns, because requireApiToken is
// a straight hash lookup with no cache in front of it.
export async function PATCH(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Missing token id." }, { status: 400 });
  const { raw, hash, enc } = mintToken("cut_");
  // owner_id in the filter is what stops one signed-in user rotating another
  // user's token by guessing an id, and `select` is what tells us whether the
  // row actually matched rather than silently updating nothing.
  const { data, error } = await supabaseAdmin
    .from("api_tokens")
    // last_used_at back to null: the new secret has not been used yet, and
    // leaving the old timestamp there would read as if it had.
    .update({ token_hash: hash, token_enc: enc, last_used_at: null })
    .eq("id", id).eq("owner_id", caller.id)
    .select("id, name").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Token not found." }, { status: 404 });
  return NextResponse.json({ id: data.id, name: data.name, token: raw });
}

export async function DELETE(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Missing token id." }, { status: 400 });
  const { error } = await supabaseAdmin.from("api_tokens").delete().eq("id", id).eq("owner_id", caller.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
