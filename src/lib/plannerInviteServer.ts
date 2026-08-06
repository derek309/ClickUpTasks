// Shared core of POST /api/planner/invite/send — pulled out so the planner
// auto-invite cron (plannerAutoInviteServer.ts) can send the same real email
// WordPress already sends for a manual click, without a user session to
// authenticate. See that route for the requireUser/501-degrade wrapper.
import { supabaseAdmin } from "./supabaseAdmin";
import { isWithinBusinessHours, OUTSIDE_BUSINESS_HOURS } from "./businessHours";
// slugify only, not citySlugForTerritory: the select below already pulls
// assigned_to off the same territory row, so resolving the slug through the
// shared helper would cost a second round trip per invite send for nothing.
import { slugify } from "./wpCitySlug";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
export const plannerInviteConfigured = Boolean(WP_BASE && WP_KEY);

export type PlannerInviteResult = { ok: true; ghlContactId: string | null } | { ok: false; error: string };

export async function sendPlannerInviteServer(territoryId: string, week: string, gdPlaceId: number, themeDescription: string): Promise<PlannerInviteResult> {
  if (!plannerInviteConfigured) return { ok: false, error: "Invite sending isn't configured yet (missing CUL_WP_BASE_URL/CLICKUPTASKS_API_KEY)." };

  // Don't land an invite in a business owner's inbox at 2am — the single
  // choke point both the manual UI and the cron go through.
  if (!isWithinBusinessHours(new Date())) return { ok: false, error: OUTSIDE_BUSINESS_HOURS };

  const { data: territory } = await supabaseAdmin.from("territories").select("city, wp_city_slug, assigned_to").eq("id", territoryId).maybeSingle();
  if (!territory) return { ok: false, error: "Territory not found" };
  const citySlug = (territory.wp_city_slug as string | null) || slugify(String(territory.city ?? ""));
  if (!citySlug) return { ok: false, error: "This territory has no city name or wp_city_slug to invite through." };

  // The territory's own assigned ambassador signs the email — there's no
  // logged-in WP user to resolve a signature from when ClickUpTasks (or the
  // cron) is the one triggering the send.
  const assignedTo: string[] = Array.isArray(territory.assigned_to) ? (territory.assigned_to as string[]) : [];
  let repName = "";
  if (assignedTo[0]) {
    const { data: rep } = await supabaseAdmin.from("profiles").select("name").eq("member_id", assignedTo[0]).maybeSingle();
    repName = (rep?.name as string | undefined) ?? "";
  }

  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/outreach/send-external`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "X-ClickUpTasks-Key": WP_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ city: citySlug, week, listing_id: gdPlaceId, rep_name: repName, theme_description: themeDescription }),
    });
  } catch (e: any) {
    return { ok: false, error: `Invite send failed: ${String(e?.message ?? e)}` };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: data?.error || `WordPress responded ${res.status}` };
  // WordPress returns 200 with {ok:false, error:'no_email'|'ghl_not_connected'|...}
  // for expected failure cases — pass those through as-is rather than reinterpreting them.
  if (!data?.ok) return { ok: false, error: data?.error || "Send failed" };

  return { ok: true, ghlContactId: data.ghl_contact_id ?? null };
}
