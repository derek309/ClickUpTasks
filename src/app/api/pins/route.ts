import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";

// Starred clients/lists (the sidebar's Pinned section) — per-user, DB-backed
// so it survives a cross-origin iframe context (see supabase/pins.sql) the
// same way /api/notifications/prefs already does. Same "caller can only
// read/write their own row (auth.uid())" shape as that route.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("starred_client_ids, starred_list_ids")
    .eq("id", caller.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    starredClientIds: data?.starred_client_ids ?? [],
    starredListIds: data?.starred_list_ids ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  // Ids only, and a sane number of them. "It is an array" was the whole check,
  // so anything at all could be stored in the caller's own profile row and read
  // back as a pinned id on every load.
  const MAX_PINS = 200;
  const ids = (v: unknown): string[] | null =>
    Array.isArray(v) && v.length <= MAX_PINS && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 100)
      ? (v as string[]) : null;
  const patch: Record<string, string[]> = {};
  const clientIds = ids(body.starredClientIds);
  const listIds = ids(body.starredListIds);
  if (clientIds) patch.starred_client_ids = clientIds;
  if (listIds) patch.starred_list_ids = listIds;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", caller.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
