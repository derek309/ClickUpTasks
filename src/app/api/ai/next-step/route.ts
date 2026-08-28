import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// Proposes the next step after you log an action on a task (Derek: "we can
// use Gemini to help keep us organised and on track").
//
// It only ever RETURNS a suggestion. The dock pre-fills the field with it and
// you edit or clear it before anything is saved, so a bad guess costs a
// glance rather than a wrong follow-up date sitting in My Work.
//
// The prompt is deliberately narrow: one sentence and one date. Asking a
// model to "plan the work" produces confident paragraphs nobody reads; asking
// it for the single next move is a question it can actually answer, because
// the answer is usually implied by what just happened.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 12000;
const MAX_HISTORY = 8;

export type NextStepSuggestion = { nextStep: string; nextStepDue: string | null; reason: string };

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const b = await req.json().catch(() => ({}));
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 300) : "";
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 2000) : "";
  const clientName = typeof b.clientName === "string" ? b.clientName.trim().slice(0, 120) : "";
  const kind = typeof b.kind === "string" ? b.kind.slice(0, 20) : "";
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 2000) : "";
  const due = typeof b.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null;
  const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  const history: string[] = Array.isArray(b.history)
    ? b.history.filter((h: unknown) => typeof h === "string").slice(0, MAX_HISTORY)
    : [];
  if (!title) return NextResponse.json({ error: "No task to work from." }, { status: 400 });

  const prompt = [
    "You are helping someone stay on top of client work. They just logged an action on a task.",
    "Suggest the single next move, and the day they should check back on it.",
    "",
    "Rules:",
    "- One next step. The immediate next move, not a plan.",
    "- Phrase it as an instruction to themselves, starting with a verb, under 60 characters.",
    `- Today is ${today}. Return the check-back day as yyyy-mm-dd.`,
    due ? `- The task is due ${due}. Never suggest checking back after the due date.` : "- The task has no due date.",
    "- Waiting on the client usually means 2 to 4 days. Their own work usually means tomorrow or the next working day.",
    "- Never suggest a date in the past, and never a Saturday or Sunday.",
    "- If the action they logged finished the work, return an empty nextStep and a null date.",
    "- Never use a hyphen, an em dash, an en dash, or any other dash punctuation.",
    "",
    "Return ONLY JSON, no prose and no markdown fence:",
    '{"nextStep": string, "nextStepDue": string|null, "reason": string}',
    "reason is one short clause saying why that day, shown to the user.",
    "",
    `Task: ${title}`,
    description ? `Details: ${description}` : "",
    clientName ? `Client: ${clientName}` : "",
    `They just did: ${kind}`,
    note ? `Their note: ${note}` : "",
    history.length ? `Recent history, newest first:\n${history.join("\n")}` : "",
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
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
      return NextResponse.json({ error: "Couldn't read the AI's suggestion." }, { status: 502 });
    }

    // Clamped rather than trusted. A date in the past would surface the task
    // as already late the instant it was saved, and one past the due date
    // would quietly park work beyond the day it was promised — the exact
    // failure the follow-up date was added to stop.
    const nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep.trim().slice(0, 200) : "";
    let nextStepDue = typeof parsed.nextStepDue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.nextStepDue) ? parsed.nextStepDue : null;
    if (nextStepDue && nextStepDue < today) nextStepDue = today;
    if (nextStepDue && due && nextStepDue > due) nextStepDue = due;
    if (!nextStep) nextStepDue = null;

    const suggestion: NextStepSuggestion = {
      nextStep,
      nextStepDue,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 200) : "",
    };
    return NextResponse.json(suggestion);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
