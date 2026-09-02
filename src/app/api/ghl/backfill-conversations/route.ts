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

  // Only contacts that still have unbound GoHighLevel messages. Once a
  // contact is done it drops out of this list, which is what makes repeated
  // calls converge instead of redoing the same work.
  const { data: pending, error } = await supabaseAdmin
    .from("messages")
    .select("contact_id, client_id")
    .not("ghl_message_id", "is", null)
    .is("ghl_conversation_id", null)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byContact = new Map<string, string>();
  for (const r of pending ?? []) {
    const cid = r.contact_id as string | null;
    if (cid && !byContact.has(cid)) byContact.set(cid, r.client_id as string);
  }

  const origin = req.nextUrl.origin;
  const auth = req.headers.get("authorization") ?? "";
  const results: { contactId: string; bound?: number; error?: string }[] = [];
  let bound = 0;

  for (const [contactId, clientId] of [...byContact].slice(0, limit)) {
    // The contact id is on the contact; the sub-account it belongs to is on
    // the client, which is where GoHighLevel's location id lives.
    const { data: contact } = await supabaseAdmin
      .from("contacts").select("ghl_contact_id").eq("id", contactId).maybeSingle();
    const { data: client } = await supabaseAdmin
      .from("clients").select("ghl_location_id").eq("id", clientId).maybeSingle();
    const ghlContactId = contact?.ghl_contact_id as string | undefined;
    const locationId = client?.ghl_location_id as string | undefined;
    if (!ghlContactId || !locationId) {
      results.push({ contactId, error: "no GoHighLevel ids on this contact" });
      continue;
    }
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

  // remaining is the honest number: how many contacts still have unbound
  // messages after this pass, so it is obvious whether to call again.
  return NextResponse.json({
    contactsProcessed: results.length,
    remaining: Math.max(0, byContact.size - results.length),
    bound,
    results,
  });
}
