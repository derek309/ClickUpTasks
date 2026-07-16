import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible, visibleClientIds } from "@/lib/extensionApi";

// Common consumer email providers — a shared domain here says nothing about
// which business a sender belongs to, so domain-fallback matching only
// makes sense for custom business domains. Exact-email matching still works
// fine against these; only the fallback below skips them.
const FREEMAIL_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "live.com", "protonmail.com"]);

// Best-effort client suggestion for the extension's popup. Tries an exact
// (case-insensitive) email match against an existing Contact first; if that
// misses, falls back to matching the sender's domain against a visible
// client's contacts' domains — but only when exactly one client matches, so
// an ambiguous domain (shared by two different clients) doesn't guess
// wrong. Both paths are restricted to the caller's visible clients so a
// VA's token can't discover a client's existence via a match they can't
// otherwise see.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ match: null });

  const { data: contact } = await supabaseAdmin.from("contacts").select("client_id").ilike("email", email).limit(1).maybeSingle();
  if (contact && (await isClientVisible(caller, contact.client_id))) {
    const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("id", contact.client_id).maybeSingle();
    if (client) return NextResponse.json({ match: { clientId: client.id, clientName: client.name, matchType: "exact" } });
  }

  const domain = email.split("@")[1];
  if (!domain || FREEMAIL_DOMAINS.has(domain)) return NextResponse.json({ match: null });

  const visible = await visibleClientIds(caller);
  let contactsQuery = supabaseAdmin.from("contacts").select("client_id, email");
  if (visible !== "all") contactsQuery = contactsQuery.in("client_id", [...visible]);
  const { data: contacts } = await contactsQuery;

  const matchingClientIds = new Set((contacts ?? []).filter((c) => c.email?.toLowerCase().split("@")[1] === domain).map((c) => c.client_id));
  if (matchingClientIds.size !== 1) return NextResponse.json({ match: null }); // 0 or ambiguous — don't guess

  const [clientId] = matchingClientIds;
  const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ match: null });
  return NextResponse.json({ match: { clientId: client.id, clientName: client.name, matchType: "domain" } });
}
