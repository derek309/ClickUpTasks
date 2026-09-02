import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";

// Give historical GoHighLevel messages their conversation id.
//
// Nothing stored before ghl_conversation_id existed has a thread key, so a
// reply to any of those conversations still falls through to a generic "Reply
// to <client>" task rather than the task the exchange belongs to. New messages
// bind themselves; three thousand old ones cannot.
//
// The id can only come from GoHighLevel — the API does not hand it back for a
// message we already have — so this walks each contact through the same
// refresh the client-level button runs, which now heals old rows as it reads.
// Doing it that way rather than reimplementing the walk means there is one
// piece of GHL paging in this codebase, not two that drift.
//
// Admin only, and one contact at a time on purpose: this is dozens of calls to
// someone else's API, and a run that is slow and finishes beats a run that is
// fast and gets rate limited half way.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  // A ceiling so one call cannot run for five minutes against a cold cache.
  // Call it again to continue: already-bound rows are skipped, so re-running
  // is cheap and safe.
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 50) : 25;

  // Only contacts this can actually do something about.
  //
  // The first run taught this the hard way: nine of ten contacts failed with
  // "no token for this sub-account", and because a failure changes nothing in
  // the database, the next run picked the same nine again. A queue that keeps
  // reserving work it cannot do never drains.
  //
  // Most of these conversations live in sub-accounts nobody holds a token for.
  // That is not an error to retry, it is a fact to report.
  const { data: pending, error } = await supabaseAdmin
    .from("messages")
    .select("contact_id, client_id")
    .not("ghl_message_id", "is", null)
    .is("ghl_conversation_id", null)
    .not("contact_id", "is", null)
    // Ordered so the window is stable rather than whatever the planner felt
    // like returning — without it the same rows come back every time and the
    // run cannot move past them.
    .order("contact_id", { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byContact = new Map<string, string>();
  for (const r of pending ?? []) {
    const cid = r.contact_id as string;
    if (!byContact.has(cid)) byContact.set(cid, r.client_id as string);
  }

  // Which sub-account each contact actually lives in.
  //
  // Not from clients.ghl_location_id: that field is a real location id on the
  // sub-account rows, and on ordinary clients it has been repurposed to hold
  // the company name shown on the Clients board ("BibBoards", "eXp Realty").
  // Reading it as a location id is why the first run reported forty three
  // clients as having no token — they were never in a sub-account by that
  // name, and the question was wrong rather than the data.
  //
  // api/ghl/contact solved this already: a Private Integration token is scoped
  // to one location and GET /contacts/{id} takes no location, so asking each
  // connected token in turn and seeing which one knows the contact identifies
  // the location. Read-only, so trying several is harmless — the same
  // reasoning that route sets out, and the reason this does not guess for
  // anything that writes.
  const contactIds = [...byContact.keys()];
  const { data: contactRows } = await supabaseAdmin
    .from("contacts").select("id, ghl_contact_id").in("id", contactIds);
  const ghlContactOf = new Map((contactRows ?? []).map((r) => [r.id as string, r.ghl_contact_id as string | null]));
  const locations = await configuredLocations();

  async function locationForContact(ghlContactId: string): Promise<string | null> {
    for (const loc of locations) {
      const token = await tokenForLocation(loc);
      if (!token) continue;
      try {
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(ghlContactId)}`, {
          headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        // A 404 means this location genuinely does not have the contact, so
        // keep asking. Anything else is inconclusive and also worth moving on
        // from — the next run will try again.
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.contact) return loc;
        }
      } catch { /* network or timeout: treat as not found here */ }
    }
    return null;
  }

  const reachable: { contactId: string; clientId: string; ghlContactId: string; locationId: string }[] = [];
  let noIds = 0;
  let notInAnySubAccount = 0;
  for (const [contactId, clientId] of [...byContact].slice(0, limit)) {
    const ghlContactId = ghlContactOf.get(contactId);
    if (!ghlContactId) { noIds++; continue; }
    const locationId = await locationForContact(ghlContactId);
    if (!locationId) { notInAnySubAccount++; continue; }
    reachable.push({ contactId, clientId, ghlContactId, locationId });
  }

  const origin = req.nextUrl.origin;
  const auth = req.headers.get("authorization") ?? "";
  const results: { contactId: string; bound?: number; error?: string }[] = [];
  let bound = 0;

  for (const { contactId, clientId, ghlContactId, locationId } of reachable) {
    try {
      const res = await fetch(`${origin}/api/ghl/refresh-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ clientId, contactId, locationId, ghlContactId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { results.push({ contactId, error: String(j?.error ?? res.status) }); continue; }
      bound += j?.bound ?? 0;
      results.push({ contactId, bound: j?.bound ?? 0 });
    } catch (e) {
      results.push({ contactId, error: e instanceof Error ? e.message : "request failed" });
    }
  }

  // Reported separately because they are different problems. remaining is work
  // left to do; blocked is work nobody can do until a token is added, and
  // rolling the two together is how the first version looked stuck.
  return NextResponse.json({
    contactsProcessed: results.length,
    remaining: Math.max(0, byContact.size - limit),
    bound,
    blockedNoToken: notInAnySubAccount,
    blockedNoIds: noIds,
    results,
  });
}
