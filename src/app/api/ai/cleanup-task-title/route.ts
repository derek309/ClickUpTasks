import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// Rewrites an over-long, typed-in-a-hurry task title into a real title and
// hands back whatever detail got squeezed out so the caller can append it to
// the description. Same Gemini call shape and TITLE:/DESCRIPTION: parsing as
// /api/extension/enrich, but with no Supabase reads at all: everything it
// needs arrives in the request body, because this runs unattended right after
// a task is created rather than from a button the user is waiting on.
//
// Unlike the other AI routes this one gets a real per-call timeout. Nobody is
// watching it, so a Gemini call that hangs would hold a serverless invocation
// open for nothing; 9s is comfortably longer than a normal flash response and
// well under the platform ceiling.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 9000;

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
    "Everything that does not belong in a title but is worth keeping goes into the description instead.",
    "Preserve the original meaning exactly. Never invent details that are not in the text below.",
    "Never use a hyphen, an em dash, an en dash, or any other dash punctuation anywhere in your response. Write plain sentences instead.",
    "Respond in EXACTLY this format, plain text only, no markdown and no preamble:",
    "TITLE: <the shortened title>",
    "DESCRIPTION: <the detail that did not fit in the title, one or two short sentences, or the word NONE if the title already carries everything>",
    "",
    `Title as typed: ${title}`,
    description ? `Description already on the task (do not repeat any of this):\n${description}` : "The task has no description yet.",
  ].join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
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
    // "NONE" is the prompt's own way of saying nothing was left over, so it
    // must never reach the task as literal description text.
    return NextResponse.json({ title: cleaned, description: /^none\.?$/i.test(extracted) ? "" : extracted });
  } catch (e) {
    // Covers the AbortSignal timeout too (a TimeoutError DOMException), which
    // is exactly the case this route has to fail quietly on.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
