import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveTrackedClientId, SAFE_CONTACT_ID, upsertConversationTask } from "@/lib/ghlConversationTask";
import { completePlaybookStepServer } from "@/lib/playbookReconcileServer";
import { verifyClickUpTasksKey } from "@/lib/verifyBridgeKey";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Inbound webhook: WordPress -> ClickUpTasks, fired the instant a business
// finishes claiming its directory listing (functions.php's
// cul_claim_sync_to_ghl, via the cul_listing_claimed action and
// cul_notify_clickuptasks_listing_claimed()). Sales pipeline automation's
// other trigger, next to planner-interest/route.ts's invite-reply handling —
// both complete SALES_STAGE_STEPS' sales_invite stage (claiming is the
// strongest signal that a business is worked, and sales_invite now covers
// everything from first outreach through the claim).
//
// Deliberately its own route rather than folded into planner-interest: a
// claim isn't tied to any planner week/city context — an organic self-claim
// isn't tied to an invite at all (02-SOP-Sales-Process.md calls
// self-claim-straight-to-stage-4 "a valid path, not a gap") — so this
// doesn't share that route's required city/week or its planner_weeks
// bookkeeping.
//
// Auth: the same shared secret as every other WP -> CUT direction
// (X-ClickUpTasks-Key checked against CLICKUPTASKS_API_KEY).

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!verifyClickUpTasksKey(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const ghlContactId: string = String(body?.ghl_contact_id ?? "").trim();
  const businessName: string = String(body?.business_name ?? "").trim() || "Unknown business";
  const email: string = String(body?.email ?? "").trim();
  const phone: string = String(body?.phone ?? "").trim();
  // Reaches a PostgREST .or() filter string (via resolveTrackedClientId) and
  // into ids this route creates — same edge validation as every other route
  // keyed on a caller-supplied ghl_contact_id.
  if (!ghlContactId || !SAFE_CONTACT_ID.test(ghlContactId)) {
    return NextResponse.json({ error: "Missing or invalid ghl_contact_id" }, { status: 400 });
  }

  // Resolve (or create) the tracked client — identical pattern to
  // planner-interest/route.ts, so a business that replied to an invite
  // earlier and then claims resolves to the SAME client instead of a
  // duplicate, and a business that claims with no prior invite history at
  // all still gets a real, tracked client created here.
  const contactId = `ct_ghl_${ghlContactId}`;
  const { data: existingContact } = await supabaseAdmin.from("contacts").select("id, client_id").eq("ghl_contact_id", ghlContactId).maybeSingle();
  const fallbackClientId = existingContact?.client_id ?? `cl_${contactId}`;
  if (!existingContact) {
    await supabaseAdmin.from("contacts").upsert({ id: contactId, client_id: fallbackClientId, name: businessName, email: email || null, phone: phone || null, ghl_contact_id: ghlContactId });
  }
  let clientId = await resolveTrackedClientId(contactId, fallbackClientId);
  if (clientId === fallbackClientId) {
    const { data: existingClient } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!existingClient) {
      const { error } = await supabaseAdmin.from("clients").insert({ id: clientId, name: businessName, color: "#a855f7", ghl_location_id: "", status: "claimed", type: "prospect", assigned_to: [] });
      // A concurrent claim + invite-reply for the same never-before-seen
      // contact can lose this insert race — same recovery the toggle route
      // uses, fall back to whatever's resolvable now.
      if (error) clientId = await resolveTrackedClientId(contactId, fallbackClientId);
    }
  }

  const done = await completePlaybookStepServer(clientId, "sales_invite", "Automatically completed, listing claimed.");

  // Claiming is the strongest signal in the whole engagement ladder — "claimed
  // ... would be the most" valuable (Derek, 2026-08-09) — yet until now this
  // route only silently advanced a Playbook step, no Follow Up task, nothing
  // for a rep to see. Every weaker signal (opened/clicked/started-not-finished
  // chat) already gets one via the same helper, this just closes the gap at
  // the top of the ladder.
  await upsertConversationTask(
    { id: contactId, name: businessName, client_id: clientId },
    ghlContactId,
    { title: "Claimed their listing — say hello and get them started" },
  );

  return NextResponse.json({ ok: true, done });
}
