// Assembles a week's picks into the markdown handoff brief — a pure port of
// WordPress's cul_sales_rest_week_picks_brief (sales-tool.php), so a
// Content Planner week produces the same shape of brief it always did, now
// generated client-side with no server round-trip (every input already
// lives in the open week's own state).
import { plannerWeekLabel, type PlannerWeek, type PlannerSection, type PlannerEvent, type PlannerSlot } from "./data";

const SLOT_HEADINGS: Record<PlannerSlot, string> = {
  spotlight: "Business Spotlight (new business)",
  gem: "Hidden Gem (secondary spotlight)",
  gem2: "Hidden Gem 2 (secondary spotlight)",
  gem3: "Hidden Gem 3 (secondary spotlight)",
  story: "The Story (local news)",
};

// Minimal shape the brief needs for "Support Local" — decoupled from
// DirectoryListing (a component-file type) so this stays a plain lib module.
export type BriefListing = { name: string; category: string; claimed: boolean; hasOffer: boolean; offerTitle?: string };

export function generatePlannerBrief(opts: {
  cityName: string;
  week: PlannerWeek;
  sections: PlannerSection[];
  events: PlannerEvent[];
  listings: BriefListing[];
}): string {
  const { cityName, week, sections, events, listings } = opts;
  const pubName = `${cityName || "Lincoln"} Weekly`;
  const lines: string[] = [`# Brief — The ${pubName}`, ""];
  if (week.week) lines.push(`- Ships: ${plannerWeekLabel(week.week)} (${week.week})`);
  if (week.themeOverride) lines.push(`- Theme: ${week.themeOverride}`);
  if (week.categories.length) lines.push(`- Theme categories: ${week.categories.join(", ")}`);
  if (week.notes.trim()) { lines.push("", "## Notes", week.notes.trim()); }
  lines.push("");

  const emit = (label: string, biz: PlannerWeek["picks"][PlannerSlot] | undefined) => {
    lines.push(`## ${label}`);
    if (biz?.name) {
      lines.push(`- Name: ${biz.name}`);
      if (biz.cat) lines.push(`- Category: ${biz.cat}`);
      if (biz.url) lines.push(`- Listing: ${biz.url}`);
      if (biz.note) lines.push(`- Note: ${biz.note}`);
    } else {
      lines.push("_(not filled)_");
    }
    lines.push("");
  };
  emit(SLOT_HEADINGS.spotlight, week.picks.spotlight);
  (["gem", "gem2", "gem3"] as const).forEach((g) => { if (week.picks[g]?.name) emit(SLOT_HEADINGS[g], week.picks[g]); });
  if (week.picks.story?.name) emit(SLOT_HEADINGS.story, week.picks.story);

  for (const sec of sections) {
    if (!sec.type.trim() && !sec.text.trim() && !sec.biz?.name) continue;
    lines.push(`## ${sec.type.trim() || "Section"}`);
    if (sec.text.trim()) lines.push(sec.text.trim());
    if (sec.biz?.name) lines.push(`- Business: ${sec.biz.name}${sec.biz.url ? ` (${sec.biz.url})` : ""}`);
    lines.push("");
  }

  lines.push("## Events");
  const realEvents = events.filter((e) => e.text.trim() || e.biz?.name);
  if (realEvents.length) {
    for (const ev of realEvents) {
      lines.push(`### ${ev.biz?.name || "Event"}`);
      if (ev.text.trim()) lines.push(ev.text.trim());
      if (ev.biz?.name && ev.biz.url) lines.push(`- Business listing: ${ev.biz.url}`);
      lines.push("");
    }
  } else {
    lines.push("_(none this week)_", "");
  }

  const featuredNames = new Set(
    (["spotlight", "gem", "gem2", "gem3"] as const).map((s) => week.picks[s]?.name?.toLowerCase().trim()).filter(Boolean) as string[]
  );
  lines.push("## Support Local (claimed businesses with active offers, by category)");
  const catsLower = week.categories.map((c) => c.toLowerCase());
  const supportRows = listings.filter((l) =>
    l.claimed && l.hasOffer && !featuredNames.has(l.name.toLowerCase().trim())
    && (catsLower.length === 0 || catsLower.includes(l.category.toLowerCase()))
  );
  if (supportRows.length) {
    for (const l of supportRows.slice(0, 20)) lines.push(`- ${l.name}${l.offerTitle ? ` — ${l.offerTitle}` : ""}`);
    lines.push("");
  } else {
    lines.push("_(no other claimed offers in these categories yet)_", "");
  }

  lines.push("## Weather", week.weatherNote || `A short local outlook for ${cityName || "this city"} (not fetched yet — use the Weather section's Get weather button).`, "");
  lines.push("## Blog + Social", "Generated downstream from the picks above (the spotlight gets a dedicated blog post; social posts are derived from the week's picks distributed across 7 days).", "");
  lines.push("---", `Generated from the Content Planner. Drop in \`Newsletter/${(cityName || "lincoln").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${week.week}/brief.md\` and tell Claude Code to build.`);

  return lines.join("\n");
}
