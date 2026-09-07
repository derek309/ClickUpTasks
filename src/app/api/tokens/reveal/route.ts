import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { decryptToken } from "@/lib/tokenCrypto";

// Hands back one of your own tokens in the clear, for the Copy button.
//
// Its own route rather than a branch of /api/tokens because it is the one
// place in the app that returns a live credential, and that deserves to be a
// file you can open and read in full.
//
// Three things hold here:
//   - requireUser, not requireApiToken. A signed-in browser session can read
//     your tokens; a token itself cannot be used to read other tokens, which
//     would turn one leaked credential into all of them.
//   - owner_id is in the query, so the worst a guessed id gets you is a 404.
//   - POST, not GET. A GET invites logging, prefetching, and a URL that ends
//     up in browser history with a token id in it.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json().catch(() => ({}));
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Missing token id." }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("api_tokens").select("name, token_enc")
    .eq("id", id).eq("owner_id", caller.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Token not found." }, { status: 404 });

  const token = decryptToken(data.token_enc);
  // Null covers every "cannot": created before tokens were stored
  // recoverably, written under a different key, or tampered with. None of
  // those is an error the caller can fix, and all of them have the same
  // answer, so say the thing that actually helps.
  if (!token) {
    return NextResponse.json({ error: "This token was created before tokens could be copied. Rotate it to get a value you can copy." }, { status: 409 });
  }
  return NextResponse.json({ id, name: data.name, token });
}
