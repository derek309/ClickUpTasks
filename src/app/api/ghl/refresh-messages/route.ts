import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { resolveTrackedClientId } from "@/lib/ghlConversationTask";
import { pullContactConversations, GhlApiError } from "@/lib/ghlPull";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Backfills any GoHighLevel messages for a contact that our webhook never
// captured (webhook downtime, a message sent directly in GHL's own UI
// before the automation was wired up, etc.) — `messages` is realtime-
// subscribed, so any genuinely new row this inserts shows up in an open
// Journal automatically, no client-side merge needed here.
//
// Gated by requireUser (not admin) — reading/backfilling is lower-stakes
// than sending, matching the existing "any signed-in user" trust level on
// messages (see supabase/messages.sql's RLS comment).
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId, contactId, locationId, ghlContactId } = await req.json().catch(() => ({} as any));
  if (!clientId || !contactId || !locationId || !ghlContactId)
    return NextResponse.json({ error: "Missing clientId, contactId, locationId, or ghlContactId." }, { status: 400 });

  // All four ids are caller-supplied and, until now, mutually unrelated: this
  // route fetches a conversation out of GHL by ghlContactId/locationId and
  // INSERTS the result under whatever client_id/contact_id the caller named.
  // Two independent things have to hold, so both are checked.
  //
  // 1. The local contact must actually BE that GHL contact. Without this,
  //    someone could pull another client's entire message history out of GHL
  //    and have it written into a client they can see — a cross-client
  //    exfiltration, not just an unauthorized read. Enforced for admins too:
  //    it's a data-integrity binding (rows must be filed under the right
  //    contact), not only a permission check.
  const { data: contactRow } = await supabaseAdmin.from("contacts").select("id, client_id, ghl_contact_id").eq("id", contactId).maybeSingle();
  if (!contactRow || contactRow.ghl_contact_id !== ghlContactId)
    return NextResponse.json({ error: "That contact doesn't match this GoHighLevel contact." }, { status: 403 });
  // 2. ...and that contact must belong to the client the rows get filed under
  //    — either as the tracked client representing it (cl_<contactId>, a
  //    linked_contact_id, or a merge absorption) or as its own GHL
  //    sub-account, the two shapes the Journal actually passes.
  const trackedClientId = await resolveTrackedClientId(contactRow.id as string, contactRow.client_id as string);
  if (trackedClientId !== clientId && contactRow.client_id !== clientId)
    return NextResponse.json({ error: "That contact doesn't belong to this client." }, { status: 403 });
  // 3. And the caller must be able to see that client at all (admins pass).
  if (!(await isClientVisible(caller, clientId)))
    return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  // The pull itself lives in lib/ghlPull, shared with the 15 minute timer.
  // No sinceMs: a refresh reads the recent history of every conversation.
  try {
    const r = await pullContactConversations({ contactId, clientId, locationId, ghlContactId, raiseTasks: false });
    return NextResponse.json({ inserted: r.inserted, stamped: r.stamped, bound: r.bound });
  } catch (e) {
    if (e instanceof GhlApiError && e.status === 501) return NextResponse.json({ error: e.message }, { status: 501 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to refresh messages." }, { status: 502 });
  }
}
