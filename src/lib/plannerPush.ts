// Maps a ClickUpTasks planner week (+ its sections/events) into the flat
// blob WordPress's cul_sales_week_picks_save expects, and posts it to the
// new /api/planner/push proxy. See supabase/planner.sql and the plan at
// /Users/derekfox/.claude/plans/twinkly-puzzling-prism.md.
import { authedFetch } from "./supabase";
import type { PlannerWeek, PlannerSection, PlannerEvent, PlannerBiz } from "./data";

const bizPayload = (b: PlannerBiz | null | undefined) => b ? { name: b.name, url: b.url, cat: b.cat, note: b.note } : null;

export function plannerPushPayload(week: PlannerWeek, sections: PlannerSection[], events: PlannerEvent[]) {
  const picks: Record<string, unknown> = {};
  for (const slot of ["spotlight", "gem", "gem2", "gem3", "story"] as const) {
    const b = bizPayload(week.picks[slot]);
    if (b) picks[slot] = b;
  }
  picks.__theme = week.themeOverride;
  picks.__cats = week.categories;
  picks.__notes = week.notes;
  picks.__dismissed = week.dismissed;
  picks.__sections = sections
    .filter((s) => s.type.trim() || s.text.trim() || s.biz?.name)
    .map((s) => ({ type: s.type, text: s.text, biz: bizPayload(s.biz) }));
  picks.__events_list = events
    .filter((e) => e.text.trim() || e.biz?.name)
    .map((e) => ({ text: e.text, biz: bizPayload(e.biz) }));
  return picks;
}

export async function pushPlannerWeek(week: PlannerWeek, sections: PlannerSection[], events: PlannerEvent[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authedFetch("/api/planner/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ territoryId: week.territoryId, week: week.week, picks: plannerPushPayload(week, sections, events) }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) return { ok: false, error: j.error || `Push failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Push failed" };
  }
}
