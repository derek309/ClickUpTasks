import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";

// Self-service per-user email signature — same shape as
// /api/notifications/prefs: a caller can only ever read/write their OWN row
// (auth.uid()), never someone else's. The value is appended server-side to
// outbound client email (see src/lib/emailSignature.ts), so this is the only
// place it can be set.

// The same as the Settings box allows (SignaturePanel): it is HTML, so links and
// bold add up fast. It was 2000 here and 4000 there, and a signature between
// the two would not save (Derek, 2026-10-05: "Justin cannot save").
const MAX_LEN = 10000;

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email_signature")
    .eq("id", caller.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ signature: data?.email_signature ?? "" });
}

// The email window's inline signature editor POSTs; Settings PATCHes. Same thing.
export async function POST(req: NextRequest) {
  return PATCH(req);
}

export async function PATCH(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.signature !== "string") return NextResponse.json({ error: "signature must be a string." }, { status: 400 });
  // Empty string clears it (stored as null so "unset" is one value, not two).
  const trimmed = body.signature.trim();
  if (trimmed.length > MAX_LEN) return NextResponse.json({ error: `Signature is too long (max ${MAX_LEN} characters).` }, { status: 400 });
  // A picture pasted in as data, not a link, would make every email heavy.
  if (/src=["']data:/i.test(trimmed)) return NextResponse.json({ error: "A pasted picture can't go in the signature. Use a picture from a link instead (for example your logo from your website)." }, { status: 400 });
  const { data: saved, error } = await supabaseAdmin.from("profiles").update({ email_signature: trimmed || null }).eq("id", caller.id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!saved?.length) return NextResponse.json({ error: "Your profile wasn't found, so the signature didn't save. Sign out and back in, then try again." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
