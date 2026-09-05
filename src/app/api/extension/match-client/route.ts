import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible, visibleClientIds } from "@/lib/extensionApi";

// Common consumer email providers — a shared domain here says nothing about
// which business a sender belongs to, so domain-fallback matching only
// makes sense for custom business domains. Exact-email matching still works
// fine against these; only the fallback below skips them.
const FREEMAIL_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "live.com", "protonmail.com"]);
const stripWww = (d: string) => d.replace(/^www\./, "");

// Best-effort client suggestion for the extension's side panel — either from
// a Gmail sender's email, or (review mode) directly from the domain of the
// page being reviewed. Three tiers, in order:
//
//   remembered  someone has explicitly filed this exact address before
//   exact       an existing Contact has this email
//   domain      exactly one visible client's contacts share this domain
//
// The domain tier only fires on a single match, so an ambiguous domain shared
// by two clients doesn't guess wrong. EVERY tier is restricted to the caller's
// visible clients so a VA's token can't discover a client's existence via a
// match they can't otherwise see — that applies to the remembered tier too,
// which is why a teammate's mapping is filtered rather than trusted.
//
// A remembered mapping that no longer resolves (client deleted, or no longer
// visible to this caller) falls THROUGH to the tiers below rather than
// returning nothing: stale memory should degrade to a guess, not to a blank.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  const domainParam = req.nextUrl.searchParams.get("domain")?.trim().toLowerCase();

  // Hoisted: the remembered tier and the domain tier both need it, and it is
  // two queries for a non-admin.
  const visible = await visibleClientIds(caller);
  const canSee = (id: string) => visible === "all" || visible.has(id);

  if (email) {
    const { data: remembered } = await supabaseAdmin
      .from("sender_client_memory").select("client_id, entry_id, owner_id, updated_at").eq("sender_email", email);
    // Your own filing always wins for you. Failing that, the most recently
    // taught mapping from a teammate, but only for a client you can see.
    const mine = (remembered ?? []).find((r) => r.owner_id === caller.id && canSee(r.client_id));
    const theirs = (remembered ?? [])
      .filter((r) => r.owner_id !== caller.id && canSee(r.client_id))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    const hit = mine ?? theirs;
    if (hit) {
      const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("id", hit.client_id).maybeSingle();
      // No client row means it was deleted out from under the mapping; fall
      // through to the tiers below rather than reporting a match to nothing.
      if (client) return NextResponse.json({ match: { clientId: client.id, clientName: client.name, entryId: hit.entry_id ?? null, matchType: "remembered" } });
    }

    const { data: contact } = await supabaseAdmin.from("contacts").select("client_id").ilike("email", email).limit(1).maybeSingle();
    if (contact && canSee(contact.client_id)) {
      const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("id", contact.client_id).maybeSingle();
      if (client) return NextResponse.json({ match: { clientId: client.id, clientName: client.name, entryId: null, matchType: "exact" } });
    }
  }

  const domain = domainParam ? stripWww(domainParam) : email?.split("@")[1];
  if (!domain || FREEMAIL_DOMAINS.has(domain)) return NextResponse.json({ match: null });

  let contactsQuery = supabaseAdmin.from("contacts").select("client_id, email");
  if (visible !== "all") contactsQuery = contactsQuery.in("client_id", [...visible]);
  const { data: contacts } = await contactsQuery;

  const matchingClientIds = new Set((contacts ?? []).filter((c) => stripWww(c.email?.toLowerCase().split("@")[1] || "") === domain).map((c) => c.client_id));
  if (matchingClientIds.size !== 1) return NextResponse.json({ match: null }); // 0 or ambiguous — don't guess

  const [clientId] = matchingClientIds;
  const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ match: null });
  return NextResponse.json({ match: { clientId: client.id, clientName: client.name, entryId: null, matchType: "domain" } });
}

// Teach the remembered tier: "mail from this address is this client's work".
//
// Only ever called when a person picked the client themselves. An auto-match
// must never write here, or one wrong domain guess becomes permanent — that
// was the bug in the browser-local version this replaces.
//
// The composite primary key IS the correction mechanism: filing the same
// sender somewhere else is the same upsert, so there is no separate forget.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const entryId = typeof body.entry_id === "string" && body.entry_id ? body.entry_id : null;
  if (!email || !clientId) return NextResponse.json({ error: "Missing email or client_id." }, { status: 400 });
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  // An entry id is a workspace project to re-select. Confirm it really belongs
  // to that client, the same check the task-create route does — otherwise a
  // token holder could have an arbitrary list pre-selected for a sender.
  if (entryId) {
    const { data: project } = await supabaseAdmin.from("projects").select("id").eq("id", entryId).eq("client_id", clientId).maybeSingle();
    if (!project) return NextResponse.json({ error: "That list does not belong to that client." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("sender_client_memory").upsert({
    owner_id: caller.id, sender_email: email, client_id: clientId, entry_id: entryId, updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id,sender_email" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
