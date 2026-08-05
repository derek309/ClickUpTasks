// Shared core of GET /api/directory/funnel — the invite chat funnel for one
// city, straight from WordPress's own step tracking. Pulled out of the route
// (same shape as plannerInviteServer/directoryListingsServer) so a server-only
// caller can reach it without requireUser, which only ever authenticates a
// logged-in browser session.
//
// WordPress records, per business, the furthest step it ever reached in the
// /join chat (opened → confirmed info → questions → open times → picked a time
// → booked) and already resolves ONE winner per business across every week —
// so nothing here re-derives that. The `steps` array is ordered, and that
// order IS the funnel order.
import { citySlugForTerritory } from "./wpCitySlug";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
export const joinFunnelConfigured = Boolean(WP_BASE && WP_KEY);

export type JoinFunnelStep = { value: string; label: string };
export type JoinFunnelEntry = { step: string; label: string; at: number; week: string };
// A plain Record, not a Map: this crosses the JSON boundary to the browser,
// and a Map serializes to {}. Keys are the GeoDirectory place id as a string
// (JSON has no numeric keys) — the client coerces the same way it already
// does for invites.
export type JoinFunnel = { steps: JoinFunnelStep[]; byGdPlaceId: Record<number, JoinFunnelEntry> };

export async function fetchJoinFunnelServer(territoryId: string): Promise<JoinFunnel | { error: string; status: number }> {
  if (!joinFunnelConfigured) return { error: "Invite funnel not configured", status: 501 };
  if (!territoryId.trim()) return { error: "territoryId is required", status: 400 };

  const citySlug = await citySlugForTerritory(territoryId);
  if (!citySlug) return { error: "This territory has no city name or wp_city_slug to read the funnel for.", status: 400 };

  // No `weeks` param on purpose: WordPress treats absent/0 as "every week on
  // record", and this panel is a whole-city rollup, not a this-week snapshot.
  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/join-funnel?city=${encodeURIComponent(citySlug)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-ClickUpTasks-Key": WP_KEY, Accept: "application/json" },
      cache: "no-store",
    });
  } catch (e: any) {
    return { error: `Invite funnel fetch failed: ${String(e?.message ?? e)}`, status: 502 };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return { error: data?.error || `WordPress responded ${res.status}`, status: 502 };

  const steps: JoinFunnelStep[] = Array.isArray(data?.steps)
    ? data.steps.map((s: any) => ({ value: String(s?.value ?? ""), label: String(s?.label ?? "") })).filter((s: JoinFunnelStep) => s.value)
    : [];

  const byGdPlaceId: Record<number, JoinFunnelEntry> = {};
  for (const b of Array.isArray(data?.businesses) ? data.businesses : []) {
    const id = Number(b?.listing_id);
    const step = String(b?.furthest_step ?? "");
    if (!Number.isFinite(id) || !step) continue;
    byGdPlaceId[id] = {
      step,
      label: String(b?.furthest_step_label ?? "") || step,
      at: Number(b?.furthest_step_at) || 0,
      week: String(b?.week ?? ""),
    };
  }

  return { steps, byGdPlaceId };
}
