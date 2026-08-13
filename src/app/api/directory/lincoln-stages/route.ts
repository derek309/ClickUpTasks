import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";
import { fetchJoinFunnelServer } from "@/lib/joinFunnelServer";
import { rowToClient, rowToPlannerWeek } from "@/lib/db";
import { computeBusinessStage } from "@/components/cockpit/TerritoryDirectory";
import type { Client } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY — delete after the Lincoln opportunity restage.
// Returns the SAME funnel stage the Businesses page shows, for every Lincoln
// listing, keyed by GHL contact id so it can be joined to opportunities.
//
// Deliberately calls computeBusinessStage itself rather than reimplementing
// it: the stage is derived from four inputs (WP listing claimed flag, the
// matched client's status, the planner invite's open/click, and the WP
// join-chat funnel step), and any second copy of that logic would drift from
// what the UI actually shows — which is the thing being treated as truth here.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!process.env.PROBE_SECRET || req.nextUrl.searchParams.get("secret") !== process.env.PROBE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const city = req.nextUrl.searchParams.get("city") || "Lincoln";
  const state = req.nextUrl.searchParams.get("state") || "CA";

  const { data: terrRows } = await supabaseAdmin.from("territories").select("id, city, state");
  const terr = (terrRows ?? []).find((t: any) => String(t.city).toLowerCase() === city.toLowerCase());
  if (!terr) return NextResponse.json({ error: "territory not found" }, { status: 400 });

  const [listingsResult, funnel, clientRows, contactRows, weekRows] = await Promise.all([
    fetchDirectoryListingsServer(city, state),
    fetchJoinFunnelServer(terr.id),
    supabaseAdmin.from("clients").select("*").then((r) => r.data ?? []),
    supabaseAdmin.from("contacts").select("id, name, phone, email, ghl_contact_id, client_id").then((r) => r.data ?? []),
    supabaseAdmin.from("planner_weeks").select("*").eq("territory_id", terr.id).then((r) => r.data ?? []),
  ]);
  if ("error" in listingsResult) return NextResponse.json({ error: listingsResult.error }, { status: 502 });

  const clients: Client[] = clientRows.map(rowToClient);
  const clientById = new Map(clients.map((c) => [c.id, c] as const));

  // Same match chain the Businesses page uses: ghlContactId first, then
  // phone / email / name, so a listing whose contact predates the id still
  // resolves to its client.
  const digits = (s?: string) => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s?: string) => (s ?? "").trim().toLowerCase();
  const byGhl = new Map<string, any>(), byPhone = new Map<string, any>(), byEmail = new Map<string, any>(), byName = new Map<string, any>();
  for (const c of contactRows) {
    if (c.ghl_contact_id) byGhl.set(c.ghl_contact_id, c);
    const p = digits(c.phone); if (p && !byPhone.has(p)) byPhone.set(p, c);
    const e = lc(c.email); if (e && !byEmail.has(e)) byEmail.set(e, c);
    const n = lc(c.name); if (n && !byName.has(n)) byName.set(n, c);
  }

  // Latest invite per listing, newest wins (a business can be re-invited).
  const invites = new Map<number, any>();
  for (const w of weekRows.map(rowToPlannerWeek)) {
    for (const inv of w.invited ?? []) {
      const prev = invites.get(inv.gdPlaceId);
      if (!prev || String(inv.at) > String(prev.at)) invites.set(inv.gdPlaceId, inv);
    }
  }
  const funnelByGd: Record<number, any> = ("error" in funnel) ? {} : (funnel.byGdPlaceId as any) ?? {};

  const out: any[] = [];
  for (const l of listingsResult.listings) {
    const gd = typeof l.id === "number" ? l.id : parseInt(String(l.id), 10);
    const contact =
      (l.ghlContactId && byGhl.get(l.ghlContactId)) ||
      byPhone.get(digits(l.phone)) || byEmail.get(lc(l.email)) || byName.get(lc(l.name)) || null;
    const client = contact ? (clientById.get("cl_" + contact.id) ?? clientById.get(contact.client_id) ?? null) : null;
    const stage = computeBusinessStage(l, client, invites.get(gd), funnelByGd[gd]);
    out.push({
      gdPlaceId: gd,
      name: l.name,
      ghlContactId: l.ghlContactId || contact?.ghl_contact_id || null,
      claimed: Boolean(l.claimed),
      clientStatus: client?.status ?? null,
      invited: Boolean(invites.get(gd)),
      funnelStep: funnelByGd[gd]?.step ?? null,
      stage,
    });
  }
  const counts: Record<string, number> = {};
  for (const r of out) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
  return NextResponse.json({ city, total: out.length, counts, businesses: out });
}
