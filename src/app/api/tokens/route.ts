import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";

// Personal API tokens for external clients (the Gmail Chrome extension) that
// can't do an interactive login — see requireApiToken in serverAuth.ts. Only
// a hash is ever stored; the raw token is returned once, on creation.

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
  const rawToken = "cut_" + randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const id = "tok_" + randomUUID();
  const { error } = await supabaseAdmin.from("api_tokens").insert({ id, owner_id: caller.id, name, token_hash: tokenHash });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // The only time the raw token is ever returned — the UI must show it once
  // and warn it can't be retrieved again (only the hash is kept).
  return NextResponse.json({ id, name, token: rawToken });
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
