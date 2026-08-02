import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isWithinBusinessHours, OUTSIDE_BUSINESS_HOURS } from "@/lib/businessHours";
import { advanceInvitedToOutreach } from "@/lib/ghlOpportunities";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Sends WordPress's existing "invite this business to be featured" email
// (GHL Conversations API) for one candidate — proxies WordPress's own
// cul_sales_rest_outreach_send, which already owns the real work (GHL
// contact upsert + send + activity logging on its own per-(city,week)
// outreach record). ClickUpTasks is just the trigger button here, per
// /Users/derekfox/.claude/plans/twinkly-puzzling-prism.md — the outreach
// board itself stays WordPress-owned, unlike the Content Planner's own data.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
const configured = Boolean(WP_BASE && WP_KEY);
// WordPress now generates this week's email template on the fly (a Gemini
// call) when none has been saved yet, instead of failing with no_template —
// bump past the default serverless timeout for that extra latency.
export const maxDuration = 60;

// Rough JS approximation of WordPress's PHP sanitize_title() — same fallback
// /api/planner/push/route.ts uses when a territory has no wp_city_slug override.
function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!configured) return NextResponse.json({ error: "Invite sending isn't configured yet (missing CUL_WP_BASE_URL/CLICKUPTASKS_API_KEY)." }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const territoryId = String(body?.territoryId ?? "").trim();
  const week = String(body?.week ?? "").trim();
  const gdPlaceId = Number(body?.gdPlaceId);
  const themeDescription = String(body?.themeDescription ?? "").trim();
  if (!territoryId || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(gdPlaceId)) {
    return NextResponse.json({ error: "territoryId, week (yyyy-mm-dd), and gdPlaceId are required" }, { status: 400 });
  }

  // Don't land an invite in a business owner's inbox at 2am. Checked here
  // rather than in the UI because this route is the single choke point both
  // the single and bulk invite paths go through — a stale client can't route
  // around it. 200 with {ok:false}, matching how WordPress's own expected
  // failures (no_email, ghl_not_connected) are passed through below rather
  // than thrown; PlannerPanel's humanizeInviteError turns it into a sentence.
  // Blocked, not deferred: nothing in this stack has a send queue, so there's
  // nowhere to park it until morning.
  if (!isWithinBusinessHours(new Date())) {
    return NextResponse.json({ ok: false, error: OUTSIDE_BUSINESS_HOURS });
  }

  const { data: territory } = await supabaseAdmin.from("territories").select("city, wp_city_slug, assigned_to").eq("id", territoryId).maybeSingle();
  if (!territory) return NextResponse.json({ error: "Territory not found" }, { status: 404 });
  const citySlug = (territory.wp_city_slug as string | null) || slugify(String(territory.city ?? ""));
  if (!citySlug) return NextResponse.json({ error: "This territory has no city name or wp_city_slug to invite through." }, { status: 400 });

  // The territory's own assigned ambassador signs the email — there's no
  // logged-in WP user to resolve a signature from when ClickUpTasks is the
  // one triggering the send.
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
    return NextResponse.json({ error: "Invite send failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: data?.error || `WordPress responded ${res.status}` }, { status: 502 });
  // WordPress returns 200 with {ok:false, error:'no_email'|'ghl_not_connected'|...}
  // for expected failure cases — pass those through as-is rather than
  // reinterpreting them, per the plan.
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error || "Send failed" });

  // Close the gap between the two funnels: this business just got invited
  // (planner_weeks.picks.__invited), so it should also show as "In Outreach"
  // in the GHL Prospects pipeline, not just here. See advanceInvitedToOutreach's
  // doc comment for the forward-only rule. Awaited (not fire-and-forget) since
  // a serverless function stops running once the response is sent.
  if (data.ghl_contact_id) await advanceInvitedToOutreach(String(data.ghl_contact_id));

  return NextResponse.json({ ok: true, ghlContactId: data.ghl_contact_id ?? null });
}
