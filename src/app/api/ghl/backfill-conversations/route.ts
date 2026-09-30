import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { createLocator } from "@/lib/ghlLocate";
import { pullContactConversations } from "@/lib/ghlPull";

// Give historical GoHighLevel messages their conversation id.
//
// Nothing stored before ghl_conversation_id existed has a thread key, so a
// reply to any of those conversations still falls through to a generic "Reply
// to <client>" task rather than the task the exchange belongs to. New messages
// bind themselves; three thousand old ones cannot.
//
// The id can only come from GoHighLevel — the API does not hand it back for a
// message we already have — so this walks each contact through the same pull
// the client-level button runs (lib/ghlPull), which heals old rows as it reads.
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

  // Contacts with no linked message at all — not every contact with an
  // unlinked one.
  //
  // The point of this is that a reply arriving on a conversation can find the
  // task it belongs to, and that needs one linked message per conversation,
  // not all of them. Refreshing a contact walks every conversation it has and
  // links the recent window of each, which makes all of them discoverable.
  //
  // Queueing on "has an unlinked message" instead does not converge: one
  // contact here has nine hundred old messages and a hundred recent ones, so
  // it would be picked, link the same recent window, and be picked again
  // forever. Stamping every historical row would mean paging back through
  // years of a conversation for no gain anyone can see.
  const { data: linkedRows } = await supabaseAdmin
    .from("messages").select("contact_id")
    .not("ghl_conversation_id", "is", null).not("contact_id", "is", null)
    .limit(5000);
  const alreadyLinked = new Set((linkedRows ?? []).map((r) => r.contact_id as string));

  // Excluded in the query, not after it. Filtering afterwards meant the
  // thousand-row window filled up with the one contact that has nine hundred
  // unlinked messages — all of them already-linked contacts — and the pass
  // came back with nothing to do while forty seven contacts waited.
  // One chain rather than a reassigned builder: reassigning it makes the
  // client's generic type recurse until the compiler gives up. A sentinel id
  // keeps the filter valid when nothing is linked yet.
  const exclude = alreadyLinked.size ? [...alreadyLinked] : ["__none__"];
  const { data: pending, error } = await supabaseAdmin
    .from("messages")
    .select("contact_id, client_id")
    .not("ghl_message_id", "is", null)
    .is("ghl_conversation_id", null)
    .not("contact_id", "is", null)
    .not("contact_id", "in", `(${exclude.join(",")})`)
    .order("contact_id", { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byContact = new Map<string, string>();
  for (const r of pending ?? []) {
    const cid = r.contact_id as string;
    if (!byContact.has(cid)) byContact.set(cid, r.client_id as string);
  }

  // Which sub-account each contact actually lives in: asked of each token,
  // never read from clients.ghl_location_id (see lib/ghlLocate).
  const contactIds = [...byContact.keys()];
  const { data: contactRows } = await supabaseAdmin
    .from("contacts").select("id, ghl_contact_id").in("id", contactIds);
  const ghlContactOf = new Map((contactRows ?? []).map((r) => [r.id as string, r.ghl_contact_id as string | null]));
  const { locationForContact } = createLocator();

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

  const results: { contactId: string; bound?: number; error?: string }[] = [];
  let bound = 0;

  for (const { contactId, clientId, ghlContactId, locationId } of reachable) {
    try {
      const r = await pullContactConversations({ contactId, clientId, locationId, ghlContactId, raiseTasks: false });
      bound += r.bound;
      results.push({ contactId, bound: r.bound });
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
