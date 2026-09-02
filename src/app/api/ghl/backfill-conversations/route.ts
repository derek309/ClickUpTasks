import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";

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

  // Resolve reachability in three bulk reads rather than per contact.
  const contactIds = [...byContact.keys()];
  const clientIds = [...new Set(byContact.values())];
  const [{ data: contactRows }, { data: clientRows }, { data: tokenRows }] = await Promise.all([
    supabaseAdmin.from("contacts").select("id, ghl_contact_id").in("id", contactIds),
    supabaseAdmin.from("clients").select("id, ghl_location_id").in("id", clientIds),
    supabaseAdmin.from("ghl_tokens").select("location_id"),
  ]);
  const ghlContactOf = new Map((contactRows ?? []).map((r) => [r.id as string, r.ghl_contact_id as string | null]));
  const locationOf = new Map((clientRows ?? []).map((r) => [r.id as string, r.ghl_location_id as string | null]));
  const tokened = new Set((tokenRows ?? []).map((r) => r.location_id as string));

  const reachable: { contactId: string; clientId: string; ghlContactId: string; locationId: string }[] = [];
  let noIds = 0;
  let noToken = 0;
  for (const [contactId, clientId] of byContact) {
    const ghlContactId = ghlContactOf.get(contactId);
    const locationId = locationOf.get(clientId);
    if (!ghlContactId || !locationId) { noIds++; continue; }
    if (!tokened.has(locationId)) { noToken++; continue; }
    reachable.push({ contactId, clientId, ghlContactId, locationId });
  }

  const origin = req.nextUrl.origin;
  const auth = req.headers.get("authorization") ?? "";
  const results: { contactId: string; bound?: number; error?: string }[] = [];
  let bound = 0;

  for (const { contactId, clientId, ghlContactId, locationId } of reachable.slice(0, limit)) {
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
    remaining: Math.max(0, reachable.length - results.length),
    bound,
    blockedNoToken: noToken,
    blockedNoIds: noIds,
    results,
  });
}
