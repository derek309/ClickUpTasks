import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";

// Personal API tokens for external clients (the Gmail Chrome extension) that
// can't do an interactive login — see requireApiToken in serverAuth.ts. Only
// a hash is ever stored; the raw token is returned once, on creation or on a
// rotate.
//
// There is deliberately no way to read an existing token back. Storing them
// recoverably would mean a database read, a leaked backup or the service role
// key hands over every live credential in one go. Lost the value? Rotate it:
// same row, same name, new secret, and the old one dies on the spot.

// One generator for both POST and PATCH, so a rotated token can never end up
// shorter, differently prefixed, or hashed differently from a fresh one.
function mintToken() {
  const raw = "cut_" + randomBytes(32).toString("base64url");
  return { raw, hash: createHash("sha256").update(raw).digest("hex") };
}

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("api_tokens").select("id, name, created_at, last_used_at").eq("owner_id", caller.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Chrome extension";
  const { raw, hash } = mintToken();
  const id = "tok_" + randomUUID();
  const { error } = await supabaseAdmin.from("api_tokens").insert({ id, owner_id: caller.id, name, token_hash: hash });
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
  const { raw, hash } = mintToken();
  // owner_id in the filter is what stops one signed-in user rotating another
  // user's token by guessing an id, and `select` is what tells us whether the
  // row actually matched rather than silently updating nothing.
  const { data, error } = await supabaseAdmin
    .from("api_tokens")
    // last_used_at back to null: the new secret has not been used yet, and
    // leaving the old timestamp there would read as if it had.
    .update({ token_hash: hash, last_used_at: null })
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
