import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// Rewrites an over-long, typed-in-a-hurry task title into a real title and
// hands back the full original text, proofread, so the caller can append it
// to the description — the long thought someone dumped into the title box is
// usually the actual brief, so it's preserved rather than summarised away
// (Derek, 2026-08-26: "keep it as close as possible to original message,
// just grammar and spelling check"). Same Gemini call shape and TITLE:/DESCRIPTION: parsing as
// /api/extension/enrich, but with no Supabase reads at all: everything it
// needs arrives in the request body, because this runs unattended right after
// a task is created rather than from a button the user is waiting on.
//
// Unlike the other AI routes this one gets a real per-call timeout. Nobody is
// watching it, so a Gemini call that hangs would hold a serverless invocation
// open for nothing.
//
// It was 9 seconds, and that was the bug behind "the AI grammar and spelling
// fix was removed": this prompt asks the model to reproduce the whole original
// text, so the response is as long as whatever got pasted into the title box.
// Timed against the real prompt and one of Derek's actual 500 character
// titles, the same call took 7.1s, 5.3s and 11.1s on three tries — the
// timeout was firing on the long ones, the route returned 502, and the client
// swallowed it. 25s covers the slow tail with room to spare.
//
// Thinking is also off: on this task it is the difference between 5s and 11s,
// and rewriting one sentence and proofreading a paragraph does not need it.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 25000;
// The serverless function has to outlive its own Gemini call.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI cleanup isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description : "";
  if (!title) return NextResponse.json({ error: "Nothing to clean up, no title was provided." }, { status: 400 });
  // The caller decides what counts as "too long" (the client checks before it
  // ever calls). If something calls this directly with an already short title,
  // hand it straight back rather than spending a Gemini call to confirm it is
  // already fine.
  if (title.length <= 80) return NextResponse.json({ title, description: "" });

  const prompt = [
    "You are tidying up a task title that someone typed in a hurry into a project management tool.",
    "The title below is too long because they dumped the whole thought into it.",
    "Rewrite it as a real task title: short, specific, and clear about the action, under 70 characters.",
    "Then write the original text out in full as the description, so nothing they typed is lost.",
    "The description is a proofread, NOT a summary and NOT a rewrite. Correct spelling, grammar,",
    "capitalisation and punctuation, and nothing else. Keep their own words, their own phrasing and",
    "their own order. Do not shorten it, do not tighten it, do not merge sentences, do not add a",
    "single word of your own, and never invent detail that is not already in the text.",
    "Never use a hyphen, an em dash, an en dash, or any other dash punctuation anywhere in your response. Write plain sentences instead.",
    "Respond in EXACTLY this format, plain text only, no markdown and no preamble:",
    "TITLE: <the shortened title>",
    "DESCRIPTION: <the full original text, spelling and grammar corrected, otherwise word for word>",
    "",
    `Title as typed: ${title}`,
    description ? `Description already on the task (do not repeat any of this):\n${description}` : "The task has no description yet.",
  ].join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Gemini API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });

    // Same labeled-format parsing as /api/extension/enrich. TITLE: is anchored
    // to a single line; DESCRIPTION: takes the rest. A response we can't parse
    // falls back to the original title, which the client then treats as "no
    // change needed" and leaves the task alone.
    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    const descMatch = text.match(/DESCRIPTION:\s*([\s\S]+)/i);
    const cleaned = titleMatch?.[1]?.trim() || title;
    const extracted = descMatch?.[1]?.trim() ?? "";
    // The prompt no longer offers NONE now that the description is a full
    // proofread copy rather than leftover detail, but the guard stays: a
    // model that answers with it anyway must never write the literal word
    // into someone's task.
    return NextResponse.json({ title: cleaned, description: /^none\.?$/i.test(extracted) ? "" : extracted });
  } catch (e) {
    // Covers the AbortSignal timeout too (a TimeoutError DOMException), which
    // is exactly the case this route has to fail quietly on.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
