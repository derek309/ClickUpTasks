import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// The Content Planner's AI co-pilot — rebuilt on ClickUpTasks' own Gemini
// integration (same pattern as draft-message/draft-description) rather than
// proxying WordPress's cul_sales_rest_assistant, per the plan's Phase 5
// design decision. Four modes: angles/draft/feature/ask, all plain
// completions. "research" (grounded live web search) is a separate,
// currently-unbuilt capability — see the plan's Phase 5b note — and isn't
// one of the modes here.

const GEMINI_MODEL = "gemini-flash-latest";
const MODES = new Set(["angles", "draft", "feature", "ask"]);

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI Workshop isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string; cityName?: string; theme?: string; categories?: string[]; notes?: string;
    filledSlots?: string[]; candidateNames?: string[]; prompt?: string;
  };
  const mode = String(body.mode ?? "");
  if (!MODES.has(mode)) return NextResponse.json({ error: "Missing or unknown mode." }, { status: 400 });
  const instruction = (body.prompt ?? "").trim();
  if (mode === "ask" && !instruction) return NextResponse.json({ error: "Ask needs a question." }, { status: 400 });

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

  const prompt = [
    "You're a co-pilot helping an editor plan a local weekly newsletter issue.",
    "Respond in plain text only — no markdown, no preamble, just the answer.",
    modePrompt,
    "",
    "Context:",
    context,
  ].join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) { const text = await res.text().catch(() => ""); return NextResponse.json({ error: `Gemini API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 }); }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
