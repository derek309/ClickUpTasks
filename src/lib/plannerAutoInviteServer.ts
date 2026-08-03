// Daily auto-invite — "the system should just send them, we don't want to
// sit here and click invites" (Derek, Aug 3 follow-up). For each territory
// with a daily_invite_cap set, sends the same real prospecting email a
// manual "Invite" click sends, to the N most-overdue UNCLAIMED businesses —
// same due-ness ranking already shown in the Planner's own invite queue
// (isDue/inviteHistory), so the cron only ever sends what an ambassador
// would already see at the top of that list. Fired by
// /api/cron/planner-auto-invite (see vercel.json).
//
// Scoped to unclaimed businesses only: the invite here is "come claim your
// listing," not "you're randomly featured in the newsletter" — auto-sending
// the latter to an already-claimed business is a separate, more delicate
// decision (the Aug 3 call's "featured queue" idea) that hasn't been asked
// for yet, so claimed businesses are left to the manual "→ Spotlight/Hidden
// Gem" flow.
import { supabaseAdmin } from "./supabaseAdmin";
import { plannerWeekToRow, rowToPlannerWeek } from "./db";
import { plannerWeekOf, todayIso, type PlannerWeek } from "./data";
import { randomUUID } from "node:crypto";
import { inviteHistory, isDue } from "./plannerPools";
import { fetchDirectoryListingsServer } from "./directoryListingsServer";
import { sendPlannerInviteServer } from "./plannerInviteServer";
import { isWithinBusinessHours } from "./businessHours";

type TerritoryRow = { id: string; city: string; state: string; daily_invite_cap: number | null };

async function findOrCreateTodayWeek(territoryId: string, weekIso: string): Promise<PlannerWeek> {
  const { data } = await supabaseAdmin.from("planner_weeks").select("*").eq("territory_id", territoryId).eq("week", weekIso).maybeSingle();
  if (data) return rowToPlannerWeek(data);
  const w: PlannerWeek = {
    id: "pw_" + randomUUID(), territoryId, week: weekIso, themeOverride: "", themeDescription: "", categories: [], notes: "", weatherNote: "",
    picks: {}, dismissed: [], invited: [], supportLocalExcluded: [], supportLocalAdded: [], archived: false, sentDate: null, wpPushedAt: null, createdAt: new Date().toISOString(),
  };
  await supabaseAdmin.from("planner_weeks").upsert(plannerWeekToRow(w));
  return w;
}

export async function runPlannerAutoInvite(): Promise<{ ran: boolean; reason?: string; territories: { territoryId: string; city: string; sent: number; error?: string }[] }> {
  // One check for the whole run — every send below hits the exact same
  // gate anyway, so failing every one of them individually to discover this
  // would just be noise.
  if (!isWithinBusinessHours(new Date())) return { ran: false, reason: "outside_business_hours", territories: [] };

  const { data: territoryRows } = await supabaseAdmin.from("territories").select("id, city, state, daily_invite_cap").not("daily_invite_cap", "is", null).gt("daily_invite_cap", 0);
  const territories = (territoryRows ?? []) as TerritoryRow[];
  if (!territories.length) return { ran: true, reason: "no_territories_configured", territories: [] };

  const todayWeekIso = plannerWeekOf(todayIso());
  const results: { territoryId: string; city: string; sent: number; error?: string }[] = [];

  for (const t of territories) {
    const cap = t.daily_invite_cap ?? 0;
    if (cap <= 0) continue;
    try {
      const [week, allWeeks, listingsResult] = await Promise.all([
        findOrCreateTodayWeek(t.id, todayWeekIso),
        supabaseAdmin.from("planner_weeks").select("*").eq("territory_id", t.id).then(({ data }) => (data ?? []).map(rowToPlannerWeek)),
        fetchDirectoryListingsServer(t.city, t.state),
      ]);
      if ("error" in listingsResult) { results.push({ territoryId: t.id, city: t.city, sent: 0, error: listingsResult.error }); continue; }

      const invited = inviteHistory(allWeeks);
      const today = todayIso();
      const candidates = listingsResult.listings
        .filter((l) => !l.claimed)
        .map((l) => ({ l, gdPlaceId: typeof l.id === "number" ? l.id : parseInt(String(l.id), 10) }))
        .filter((c): c is { l: typeof listingsResult.listings[number]; gdPlaceId: number } => Number.isFinite(c.gdPlaceId))
        .map((c) => ({ ...c, lastAt: invited.get(c.gdPlaceId)?.lastAt ?? null }))
        .filter((c) => isDue(c.lastAt, today))
        .sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? "")) // never-invited ("") first, then oldest
        .slice(0, cap);

      const newEntries: PlannerWeek["invited"] = [];
      for (const c of candidates) {
        const r = await sendPlannerInviteServer(t.id, week.week, c.gdPlaceId, week.themeDescription);
        if (r.ok) newEntries.push({ gdPlaceId: c.gdPlaceId, at: new Date().toISOString(), status: "invited" });
        // A mid-run business-hours flip (the cron straddling the 6pm
        // boundary) or a hard config error stops the rest of this
        // territory's batch rather than burning through every remaining
        // candidate on a failure that won't resolve.
        else if (r.error === "outside_business_hours" || r.error.startsWith("Invite sending isn't configured")) break;
        await new Promise((res) => setTimeout(res, 250)); // same stagger the manual bulk-invite path uses
      }

      if (newEntries.length) {
        const fresh = await supabaseAdmin.from("planner_weeks").select("*").eq("id", week.id).maybeSingle();
        const current = fresh.data ? rowToPlannerWeek(fresh.data) : week;
        await supabaseAdmin.from("planner_weeks").upsert(plannerWeekToRow({ ...current, invited: [...current.invited, ...newEntries] }));
      }
      results.push({ territoryId: t.id, city: t.city, sent: newEntries.length });
    } catch (e) {
      results.push({ territoryId: t.id, city: t.city, sent: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ran: true, territories: results };
}
