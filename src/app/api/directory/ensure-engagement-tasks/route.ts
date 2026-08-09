import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { fetchJoinFunnelServer } from "@/lib/joinFunnelServer";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";
import { resolveOrPromoteTrackedClient, upsertConversationTask } from "@/lib/ghlConversationTask";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Ensures a Conversation task exists for any business that started the
// invite/interview chat but hasn't finished it — "they started the chat but
// didn't complete it" (Derek, 2026-08-09). Unlike accepted/clicked/opened,
// there's no inbound webhook for chat progression to hang this off:
// WordPress only exposes a read-only rollup (GET /sales/join-funnel, see
// joinFunnelServer.ts), no event fires as a business moves through it. So
// this follows the same "ensure on view" pattern already used elsewhere in
// this app (ensureTerritoryClient, syncTerritoryClients) — called from the
// Follow Up dashboard's own per-territory fetch, not a webhook.
//
// "Not finished" = past the funnel's first step (opened — merely opening the
// link isn't a chat signal, that's what the email-open webhook already
// covers) and short of its last step (booked — the funnel's own terminal
// success state, WordPress's own step order IS the funnel order per
// joinFunnelServer.ts's comment, so no separate "is this the last one"
// constant to keep in sync).
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const territoryId = String(body?.territoryId ?? "").trim();
  const city = String(body?.city ?? "").trim();
  const state = String(body?.state ?? "").trim();
  if (!territoryId || !city) return NextResponse.json({ error: "territoryId and city are required" }, { status: 400 });

  const [funnel, listingsResult] = await Promise.all([
    fetchJoinFunnelServer(territoryId),
    fetchDirectoryListingsServer(city, state),
  ]);
  if ("error" in funnel) return NextResponse.json({ ok: true, skipped: funnel.error });
  if ("error" in listingsResult) return NextResponse.json({ ok: true, skipped: listingsResult.error });

  const lastStepValue = funnel.steps[funnel.steps.length - 1]?.value;
  const stepRank = (v: string) => funnel.steps.findIndex((s) => s.value === v);
  // Split "started but didn't finish" in two (Derek, 2026-08-09): confirming
  // your info and someone who answered every question and is one click from
  // picking a time aren't the same urgency, but they used to share one
  // generic title/rank. Same boundary computeBusinessStage (TerritoryDirectory.tsx)
  // already draws between its own "clicked" and "completed" stages, so a
  // business's task title and its stage on the Businesses page agree.
  const LATE_FUNNEL_STEPS = new Set(["questions_done", "slots_shown", "contact_started"]);
  // Every candidate first, THEN one contacts query for all of them — same
  // reasoning as syncTerritoryClients batching in Cockpit.tsx: this can run
  // for a whole city's worth of businesses, not one at a time.
  const candidates = Object.entries(funnel.byGdPlaceId)
    .filter(([, entry]) => entry.step !== lastStepValue && stepRank(entry.step) > 0)
    .map(([gdPlaceId, entry]) => ({ gdPlaceId: Number(gdPlaceId), entry }));

  const listingById = new Map(listingsResult.listings.map((l) => [typeof l.id === "number" ? l.id : parseInt(String(l.id), 10), l] as const));

  const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();
  const { data: contactRows } = await supabaseAdmin.from("contacts").select("id, name, client_id, ghl_contact_id, phone, email");
  const byGhlId = new Map<string, any>(), byPhone = new Map<string, any>(), byEmail = new Map<string, any>(), byName = new Map<string, any>();
  for (const c of contactRows ?? []) {
    if (c.ghl_contact_id) byGhlId.set(c.ghl_contact_id, c);
    const p = digits(c.phone); if (p) byPhone.set(p, c);
    const e = lc(c.email); if (e) byEmail.set(e, c);
    const n = lc(c.name); if (n && !byName.has(n)) byName.set(n, c);
  }

  let ensured = 0;
  for (const { gdPlaceId, entry } of candidates) {
    const listing = listingById.get(gdPlaceId);
    if (!listing || listing.claimed) continue; // claimed+ businesses have their own follow-up path already
    const contact = (listing.ghlContactId && byGhlId.get(listing.ghlContactId)) || byPhone.get(digits(listing.phone)) || byEmail.get(lc(listing.email)) || byName.get(lc(listing.name)) || null;
    if (!contact) continue; // nothing to promote against — same honest gap as the Dashboard's own fallback
    const trackedClientId = await resolveOrPromoteTrackedClient(contact);
    const title = LATE_FUNNEL_STEPS.has(entry.step)
      ? `Nearly booked (reached "${entry.label}") — one more step, follow up`
      : `Started the interest chat (reached "${entry.label}") — didn't finish, follow up`;
    const ok = await upsertConversationTask(
      { id: contact.id, name: contact.name, client_id: trackedClientId },
      listing.ghlContactId || contact.ghl_contact_id || "",
      { title },
    );
    if (ok) ensured++;
  }

  // Self-heal contacts with a real open Conversation task but no city/state
  // (Derek, 2026-08-09 — "Client replies has all the things that should be
  // in Follow Up, those are all sales triggers"): handleEmailEngagement
  // promotes + tasks a contact off its GHL contact id alone, independent of
  // whether a matching WP listing was ever found (deliberately, so the
  // engagement isn't lost — see that function's own comment) — but Follow
  // Up's territory scoping (TerritoryDashboard.tsx) keys off contact.city/
  // state, so a contact whose territory match failed or hadn't been
  // attempted yet stays invisible there even though it has a real task.
  // Reuses the exact match chain (ghlContactId, then phone, then email)
  // against the listings this call already fetched for its own territory —
  // no extra WP round trip — so a rep's set of assigned territories gets
  // fully covered over the normal per-territory call cadence.
  const { data: openConvoTasks } = await supabaseAdmin.from("tasks").select("contact_id").eq("priority", "conversation").neq("status", "done").not("contact_id", "is", null);
  const openContactIds = Array.from(new Set((openConvoTasks ?? []).map((t) => t.contact_id as string)));
  let healed = 0;
  if (openContactIds.length) {
    const { data: orphaned } = await supabaseAdmin.from("contacts").select("id, ghl_contact_id, phone, email").in("id", openContactIds).is("city", null);
    for (const oc of orphaned ?? []) {
      const listing =
        (oc.ghl_contact_id && listingsResult.listings.find((l) => l.ghlContactId === oc.ghl_contact_id)) ??
        (digits(oc.phone) ? listingsResult.listings.find((l) => digits(l.phone) === digits(oc.phone)) : undefined) ??
        (oc.email ? listingsResult.listings.find((l) => lc(l.email) === lc(oc.email)) : undefined);
      if (!listing) continue;
      const { error } = await supabaseAdmin.from("contacts").update({ city, state }).eq("id", oc.id);
      if (!error) healed++;
    }
  }

  return NextResponse.json({ ok: true, ensured, healed });
}
