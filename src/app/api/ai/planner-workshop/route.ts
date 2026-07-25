import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// The Content Planner's AI co-pilot — rebuilt on ClickUpTasks' own Gemini
// integration (same pattern as draft-message/draft-description) rather than
// proxying WordPress's cul_sales_rest_assistant, per the plan's Phase 5
// design decision. Two families of mode:
//   - Freeform text (angles/draft/feature/ask) — plain completions, {text}.
//   - Structured suggest_* modes — strict JSON out ({options}/{categories}/
//     {suggestions}), parsed leniently the same way WordPress's
//     events-online-finder.php parses its own Gemini JSON responses (fenced
//     code block first, then a bare-JSON fallback).
const GEMINI_MODEL = "gemini-flash-latest";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TEXT_MODES = new Set(["angles", "draft", "feature", "ask"]);
const STRUCTURED_MODES = new Set(["suggest_theme", "suggest_categories", "suggest_slot", "suggest_story", "suggest_events"]);
// suggest_story/suggest_events need live web search — Gemini's google_search
// tool, the exact grounding pattern already proven in production by
// WordPress's events-online-finder.php (site: query fan-out + strict JSON
// out) and sales-tool.php's business-health-audit call.
const GROUNDED_MODES = new Set(["suggest_story", "suggest_events"]);
const SLOT_LABELS: Record<string, string> = { spotlight: "Business Spotlight", gem: "Hidden Gem", gem2: "Hidden Gem 2", gem3: "Hidden Gem 3" };
const MODES = new Set([...TEXT_MODES, ...STRUCTURED_MODES]);
// Grounded, multi-step search runs 20-60s+ in WordPress's own real-world
// timeout budget (90-180s there) — well past the default serverless limit.
export const maxDuration = 60;

// Lenient JSON extraction — Gemini is asked for a single fenced ```json
// block but sometimes wraps it in prose anyway.
type ParsedPayload = {
  options?: Array<{ title?: unknown; description?: unknown }>;
  suggestions?: Array<Record<string, unknown>>;
  categories?: unknown[];
};
function parseJsonBlock(text: string): ParsedPayload | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  try { return JSON.parse(text); } catch {}
  const bare = /\{[\s\S]*\}/.exec(text);
  if (bare) { try { return JSON.parse(bare[0]); } catch {} }
  return null;
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI Workshop isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string; cityName?: string; state?: string; theme?: string; categories?: string[]; notes?: string;
    filledSlots?: string[]; candidateNames?: string[]; prompt?: string;
    month?: number; weekIndex?: number; assignedTitle?: string; assignedCategories?: string[]; themeDescription?: string;
    slot?: string; candidates?: { name: string; cat: string; due: boolean; lastFeatured: string | null }[];
    dateFrom?: string; dateTo?: string;
  };
  const mode = String(body.mode ?? "");
  if (!MODES.has(mode)) return NextResponse.json({ error: "Missing or unknown mode." }, { status: 400 });
  const instruction = (body.prompt ?? "").trim();
  if (mode === "ask" && !instruction) return NextResponse.json({ error: "Ask needs a question." }, { status: 400 });
  if (mode === "suggest_categories" && !(body.theme ?? "").trim()) return NextResponse.json({ error: "suggest_categories needs a theme." }, { status: 400 });
  // No candidates = nothing to rank — a valid empty result, not a request error.
  if (mode === "suggest_slot" && !body.candidates?.length) return NextResponse.json({ suggestions: [] });

  let prompt: string;

  if (mode === "suggest_theme") {
    const monthName = MONTH_NAMES[(body.month ?? 1) - 1] ?? "this month";
    prompt = [
      "You're a co-pilot helping an editor plan a local weekly newsletter issue.",
      `City: ${body.cityName || "this city"}. Month: ${monthName}, week ${body.weekIndex ?? 1} of that month.`,
      body.assignedTitle ? `The seasonal theme calendar already assigns this slot: "${body.assignedTitle}"${body.assignedCategories?.length ? ` (categories: ${body.assignedCategories.join(", ")})` : ""}. Use it as a starting point, but offer real alternatives too — don't just restate it 4 times.` : "No calendar theme is assigned yet — invent options from scratch for this month/week.",
      "Stay seasonally grounded — real anchors for this time of year (e.g. Father's Day, Mother's Day, back-to-school, a local holiday), not generic filler.",
      "Return ONLY a fenced ```json code block with this exact shape, no other text:",
      '{"options": [{"title": "short theme title", "description": "one sentence on the angle"}]}',
      "Provide 3-4 options.",
    ].join("\n");
  } else if (mode === "suggest_slot") {
    const candidates = body.candidates ?? [];
    prompt = [
      "You're a co-pilot helping an editor plan a local weekly newsletter issue.",
      `City: ${body.cityName || "this city"}. Slot to fill: ${SLOT_LABELS[body.slot ?? ""] ?? body.slot}.`,
      body.theme ? `This week's theme: ${body.theme}` : null,
      body.categories?.length ? `Theme categories: ${body.categories.join(", ")}` : null,
      "Candidate businesses — pick ONLY from this list, never invent a business:",
      candidates.map((c) => `- ${c.name} (${c.cat}${c.due ? ", due for a feature" : c.lastFeatured ? `, last featured ${c.lastFeatured}` : ""})`).join("\n"),
      "Pick the 1-2 best fits for this slot, each with a one-sentence reason tied to the theme/categories or rotation status.",
      "Return ONLY a fenced ```json code block with this exact shape, no other text:",
      '{"suggestions": [{"name": "exact candidate name from the list", "rationale": "one sentence"}]}',
    ].filter(Boolean).join("\n");
  } else if (mode === "suggest_events") {
    const location = `${body.cityName || "this city"}${body.state ? `, ${body.state}` : ""}`;
    prompt = [
      `You are a research assistant. Find real, upcoming public events in ${location} between ${body.dateFrom ?? "this week"} and ${body.dateTo ?? "next week"}.`,
      "Search Google using many different queries, for example:",
      `  - "${location} events ${body.dateFrom ?? ""}"`,
      `  - "things to do in ${location} this week"`,
      `  - "${body.cityName || "this city"} city events calendar"`,
      `  - "${body.cityName || "this city"} chamber of commerce events"`,
      `  - "site:eventbrite.com ${location}"`,
      `  - "site:facebook.com/events ${location}"`,
      `  - "site:clickuplocal.com ${location} events"`,
      "Also check city government and venue websites.",
      "For each event, confirm the exact date, venue, and write a one-sentence description.",
      "Do NOT invent or guess values — only use information you actually found via search. Return up to 6 events; fewer well-confirmed events is better than many guessed ones.",
      "Return ONLY a fenced ```json code block with this exact shape, no other text:",
      '{"suggestions": [{"title": "event name", "summary": "one sentence", "startDate": "YYYY-MM-DD or YYYY-MM-DD HH:MM", "venue": "venue name", "sourceUrl": "https://..."}]}',
    ].join("\n");
  } else if (mode === "suggest_story") {
    const location = `${body.cityName || "this city"}${body.state ? `, ${body.state}` : ""}`;
    prompt = [
      `You are a research assistant. Find real, current local news or community happenings in ${location} from the past two weeks.`,
      "Search Google using many different queries, for example:",
      `  - "${location} local news"`,
      `  - "${body.cityName || "this city"} news this week"`,
      `  - "${body.cityName || "this city"} community"`,
      `  - "site:clickuplocal.com ${location}"`,
      "Also check local news outlets and the city's own government site.",
      "For each story, write a one-sentence summary suitable for a local newsletter blurb and note the source.",
      "Do NOT invent or guess values — only use information you actually found via search. Return up to 5 stories, real ones only.",
      "Return ONLY a fenced ```json code block with this exact shape, no other text:",
      '{"suggestions": [{"headline": "story headline", "summary": "one sentence", "sourceUrl": "https://...", "sourceName": "publication or site name"}]}',
    ].join("\n");
  } else if (mode === "suggest_categories") {
    prompt = [
      "You're a co-pilot helping an editor plan a local weekly newsletter issue.",
      `City: ${body.cityName || "this city"}. Chosen theme: "${body.theme}".${body.themeDescription ? ` (${body.themeDescription})` : ""}`,
      "List the business categories that best fit this theme — short phrases like a local directory would use (e.g. \"Bakeries\", \"Coffee and Cafes\", \"Family Entertainment\"), not full sentences.",
      "Return ONLY a fenced ```json code block with this exact shape, no other text:",
      '{"categories": ["Category One", "Category Two"]}',
      "Provide 3-6 categories.",
    ].join("\n");
  } else {
    const context = [
      `City: ${body.cityName || "this city"}`,
      body.theme ? `This week's theme: ${body.theme}` : null,
      body.categories?.length ? `Theme categories: ${body.categories.join(", ")}` : null,
      body.notes?.trim() ? `Notes so far: ${body.notes.trim()}` : null,
      body.filledSlots?.length ? `Already picked: ${body.filledSlots.join(", ")}` : "Nothing picked yet.",
      body.candidateNames?.length ? `Candidate businesses to consider: ${body.candidateNames.join(", ")}` : null,
    ].filter(Boolean).join("\n");

    const modePrompt =
      mode === "angles" ? "Suggest 4-6 short, punchy story angle ideas for this week's local newsletter issue, one per line, no numbering or preamble."
      : mode === "draft" ? "Write a short, warm draft write-up (2-4 sentences) suitable for a Business Spotlight or Hidden Gem section, using only the context given — never invent specifics not present below."
      : mode === "feature" ? "From the candidate businesses listed, recommend which 1-3 are the best fit to feature this week and why, in 2-3 short sentences total — reference only the candidates given, never invent a business."
      : `Answer this question about planning the week's newsletter: "${instruction}"`;

    prompt = [
      "You're a co-pilot helping an editor plan a local weekly newsletter issue.",
      "Respond in plain text only — no markdown, no preamble, just the answer.",
      modePrompt,
      "",
      "Context:",
      context,
    ].join("\n");
  }

  try {
    const requestBody: Record<string, unknown> = { contents: [{ parts: [{ text: prompt }] }] };
    if (GROUNDED_MODES.has(mode)) requestBody.tools = [{ google_search: {} }];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) { const errText = await res.text().catch(() => ""); return NextResponse.json({ error: `Gemini API ${res.status}: ${errText.slice(0, 240)}` }, { status: 502 }); }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });

    if (STRUCTURED_MODES.has(mode)) {
      const parsed = parseJsonBlock(text);
      if (mode === "suggest_theme") {
        const options = Array.isArray(parsed?.options) ? parsed.options.filter((o) => o?.title) : null;
        if (!options) return NextResponse.json({ error: "Gemini returned an unexpected format." }, { status: 502 });
        return NextResponse.json({ options });
      }
      if (mode === "suggest_slot" || mode === "suggest_events" || mode === "suggest_story") {
        const requiredKey = mode === "suggest_slot" ? "name" : mode === "suggest_events" ? "title" : "headline";
        const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions.filter((s) => s?.[requiredKey]) : null;
        if (!suggestions) return NextResponse.json({ error: "Gemini returned an unexpected format." }, { status: 502 });
        return NextResponse.json({ suggestions });
      }
      const categories = Array.isArray(parsed?.categories) ? parsed.categories.filter((c) => typeof c === "string" && c.trim()) : null;
      if (!categories) return NextResponse.json({ error: "Gemini returned an unexpected format." }, { status: 502 });
      return NextResponse.json({ categories });
    }
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
