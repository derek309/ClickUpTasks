import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rowToPlannerWeek } from "@/lib/db";
import { latestInviteStatus } from "@/lib/plannerPools";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";
import { fetchJoinFunnelServer } from "@/lib/joinFunnelServer";
import { resolveOrPromoteTrackedClient, upsertConversationTask } from "@/lib/ghlConversationTask";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY, ONE-TIME — delete this file after running it once. Backfills
// the same clearly-titled Conversation tasks the new webhooks/
// ensure-engagement-tasks would have created, for engagement that happened
// before that code shipped (2026-08-09, Derek: "Run the backfill for the
// past engagement"). Built as a real deployed route (not a local script)
// specifically because it needs the real WordPress credentials, which only
// exist as Vercel's own production env — a local script pulling them via
// `vercel env pull` gets them redacted before they ever reach a file this
// session can read. Gated on a one-off shared secret (BACKFILL_SECRET, set
// directly via `vercel env add`, never read back) rather than requireUser —
// no browser session is available to trigger this from.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const secret = req.headers.get("x-backfill-secret");
  if (!secret || secret !== process.env.BACKFILL_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";

  const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

  const { data: territories, error: terrErr } = await supabaseAdmin.from("territories").select("id, city, state");
  if (terrErr || !territories) return NextResponse.json({ error: terrErr?.message || "no territories" }, { status: 500 });

  const summary: Record<string, any> = {};

  for (const t of territories as { id: string; city: string; state: string }[]) {
    const label = `${t.city}, ${t.state}`;
    const entries: string[] = [];
    const noContact: string[] = [];
    let accepted = 0, clicked = 0, opened = 0, funnel = 0;

    const [{ data: weekRows }, listingsResult, funnelResult, { data: contactRows }] = await Promise.all([
      supabaseAdmin.from("planner_weeks").select("*").eq("territory_id", t.id),
      fetchDirectoryListingsServer(t.city, t.state),
      fetchJoinFunnelServer(t.id),
      supabaseAdmin.from("contacts").select("id, name, client_id, ghl_contact_id, phone, email"),
    ]);
    if ("error" in listingsResult) { summary[label] = { error: listingsResult.error }; continue; }
    const weeks = (weekRows ?? []).map(rowToPlannerWeek);
    const invites = latestInviteStatus(weeks);
    const listingById = new Map(listingsResult.listings.map((l: any) => [typeof l.id === "number" ? l.id : parseInt(String(l.id), 10), l] as const));

    const byGhlId = new Map<string, any>(), byPhone = new Map<string, any>(), byEmail = new Map<string, any>(), byName = new Map<string, any>();
    for (const c of contactRows ?? []) {
      if (c.ghl_contact_id) byGhlId.set(c.ghl_contact_id, c);
      const p = digits(c.phone); if (p) byPhone.set(p, c);
      const e = lc(c.email); if (e) byEmail.set(e, c);
      const n = lc(c.name); if (n && !byName.has(n)) byName.set(n, c);
    }
    const matchContact = (l: any) => (l.ghlContactId && byGhlId.get(l.ghlContactId)) || byPhone.get(digits(l.phone)) || byEmail.get(lc(l.email)) || byName.get(lc(l.name)) || null;

    for (const [gdPlaceId, inv] of invites) {
      // Decide whether this business even has a real engagement signal
      // BEFORE looking up a contact for it — a plain "invited, never
      // opened" business was never going to get a task either way, and
      // checking contact-match for it first only inflates noContact with
      // businesses that were correctly skipped, not actually blocked.
      let title: string | null = null;
      if (inv.status === "accepted") { title = "Accepted the invite — call or visit to close"; }
      else if (inv.clickedAt) { title = "Clicked the invite email — call or visit to close"; }
      else if (inv.openedAt) { title = "Opened the invite email — a nudge might help"; }
      if (!title) continue;
      const listing = listingById.get(gdPlaceId);
      if (!listing || listing.claimed) continue;
      const contact = matchContact(listing);
      if (!contact) { noContact.push(`${listing.name} (invite: ${inv.status})`); continue; }
      if (title.startsWith("Accepted")) accepted++;
      else if (title.startsWith("Clicked")) clicked++;
      else opened++;
      entries.push(`[invite] ${listing.name} -> ${title}`);
      if (!dryRun) {
        const trackedClientId = await resolveOrPromoteTrackedClient(contact);
        await upsertConversationTask({ id: contact.id, name: contact.name, client_id: trackedClientId }, listing.ghlContactId || contact.ghl_contact_id || "", { title });
      }
    }

    if (!("error" in funnelResult)) {
      const lastStepValue = funnelResult.steps[funnelResult.steps.length - 1]?.value;
      const stepRank = (v: string) => funnelResult.steps.findIndex((s) => s.value === v);
      for (const [gdPlaceIdStr, entry] of Object.entries(funnelResult.byGdPlaceId)) {
        if (entry.step === lastStepValue || stepRank(entry.step) <= 0) continue;
        const listing = listingById.get(Number(gdPlaceIdStr));
        if (!listing || listing.claimed) continue;
        const contact = matchContact(listing);
        if (!contact) { noContact.push(`${listing.name} (funnel: ${entry.label})`); continue; }
        const title = `Started the interest chat (reached "${entry.label}") — didn't finish, follow up`;
        entries.push(`[funnel] ${listing.name} -> ${title}`);
        if (!dryRun) {
          const trackedClientId = await resolveOrPromoteTrackedClient(contact);
          await upsertConversationTask({ id: contact.id, name: contact.name, client_id: trackedClientId }, listing.ghlContactId || contact.ghl_contact_id || "", { title });
        }
        funnel++;
      }
    }

    summary[label] = { accepted, clicked, opened, funnel, noContact, entries };
  }

  return NextResponse.json({ ok: true, dryRun, summary });
}
