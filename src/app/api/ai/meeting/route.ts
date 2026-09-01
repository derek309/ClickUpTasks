import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// Turns a pasted meeting transcript into the two things a task needs from it:
// what was decided, and what happens next.
//
// A transcript is the wrong thing to store in a feed. It is thousands of
// words of "yeah, right, mm-hm" that nobody re-reads, and pasting one into
// the activity log buries every other entry around it. So this returns a
// short record instead, and the caller stores that.
//
// Deliberately does NOT return tasks. There is already a reviewed path for
// that (api/ai/parse-tasks feeding the bulk add modal, where you edit before
// anything is created), and silently creating tasks off a transcript is how
// you end up with forty of them nobody asked for.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 25000;
const MAX_INPUT_CHARS = 60000;

export type MeetingSummary = { summary: string; nextStep: string; nextStepDue: string | null };

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const b = await req.json().catch(() => ({}));
  const transcript = typeof b.transcript === "string" ? b.transcript.trim().slice(0, MAX_INPUT_CHARS) : "";
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 300) : "";
  const clientName = typeof b.clientName === "string" ? b.clientName.trim().slice(0, 120) : "";
  const due = typeof b.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null;
  const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  if (!transcript) return NextResponse.json({ error: "Nothing to read — paste the transcript first." }, { status: 400 });

  const prompt = [
    "You are reading a meeting transcript or a set of meeting notes and writing the record of it for a task.",
    "",
    "Return two things:",
    "1. summary — what was decided and what was agreed, in at most 5 short lines, one point per line, starting each with '· '.",
    "   Decisions and commitments only. No pleasantries, no recap of who said hello, no restating the agenda.",
    "   Name who owns something when the transcript says so.",
    "2. nextStep — the single next move for the person whose task this is, as an instruction to themselves,",
    "   starting with a verb, under 60 characters. Empty string if the meeting settled everything.",
    `3. nextStepDue — the day to follow up, yyyy-mm-dd. Today is ${today}.`,
    due ? `The task is due ${due}; never suggest a date after it.` : "The task has no due date.",
    "   Never a past date, never a Saturday or Sunday. Null when nextStep is empty.",
    "",
    "Never use a hyphen, an em dash, an en dash, or any other dash punctuation.",
    "Return ONLY JSON, no prose and no markdown fence:",
    '{"summary": string, "nextStep": string, "nextStepDue": string|null}',
    "",
    title ? `The task: ${title}` : "",
    clientName ? `The client: ${clientName}` : "",
    "",
    "The transcript:",
    transcript,
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: `Gemini API ${res.status}: ${t.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json();
    const raw: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });

    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(cleaned) as Record<string, unknown>; } catch {
      return NextResponse.json({ error: "Couldn't read the AI's summary." }, { status: 502 });
    }

    // Same clamping as api/ai/next-step: a suggested date in the past would
    // land the task already late, and one past the due date parks work beyond
    // the day it was promised.
    const nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep.trim().slice(0, 200) : "";
    let nextStepDue = typeof parsed.nextStepDue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.nextStepDue) ? parsed.nextStepDue : null;
    if (nextStepDue && nextStepDue < today) nextStepDue = today;
    if (nextStepDue && due && nextStepDue > due) nextStepDue = due;
    if (!nextStep) nextStepDue = null;

    const out: MeetingSummary = {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 3000) : "",
      nextStep,
      nextStepDue,
    };
    if (!out.summary) return NextResponse.json({ error: "Couldn't find anything decided in that transcript." }, { status: 422 });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
