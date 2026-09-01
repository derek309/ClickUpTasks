import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// Proposes the next step after you log an action on a task (Derek: "we can
// use Gemini to help keep us organised and on track").
//
// It only ever RETURNS a suggestion. The dock pre-fills the field with it and
// you edit or clear it before anything is saved, so a bad guess costs a
// glance rather than a wrong follow-up date sitting in My Work.
//
// The prompt is deliberately narrow: one sentence, one date, one stage, one
// size. Asking a model to "plan the work" produces confident paragraphs
// nobody reads; asking it for the single next move is a question it can
// actually answer, because the answer is usually implied by what just
// happened. The stage and the size are the same kind of question: what does
// what you just did imply about where this task now sits, and how big is the
// next move. Every one of them is a suggestion the dock shows you before
// anything is written.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 12000;
const MAX_HISTORY = 8;

export type NextStepSuggestion = {
  nextStep: string;
  /** The follow-up date. Called that everywhere now: it IS the task's
   *  followUpAt, which is what pulls the task back up the list. */
  followUpAt: string | null;
  status: string | null;
  /** Only ever suggested when the task has no size yet — an estimate someone
   *  already made is theirs, not something to overwrite with a guess. */
  size: string | null;
  reason: string;
};

const STATUSES = ["todo", "get_started", "in_progress", "review", "changes_requested", "waiting", "approved"];
const SIZES = ["quick", "hour", "h2", "h3", "half", "full", "multi"];

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
  const status = typeof b.status === "string" ? b.status.slice(0, 30) : "";
  // Only asked for when the task has none. A size someone set by hand is an
  // estimate they made; replacing it with a guess would be worse than useless.
  const needsSize = b.needsSize === true;
  const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  const history: string[] = Array.isArray(b.history)
    ? b.history.filter((h: unknown) => typeof h === "string").slice(0, MAX_HISTORY)
    : [];
  if (!title) return NextResponse.json({ error: "No task to work from." }, { status: 400 });

  const prompt = [
    "You are helping someone stay on top of client work. They just logged an action on a task.",
    "Suggest the single next move, the day they should follow up, and the stage the task now sits in.",
    needsSize ? "Nobody has estimated this task yet, so also suggest how long the next move will take." : "",
    "",
    "Rules:",
    "- One next step. The immediate next move, not a plan.",
    "- Phrase it as an instruction to themselves, starting with a verb, under 60 characters.",
    `- Today is ${today}. Return the follow-up day as yyyy-mm-dd.`,
    due ? `- The task is due ${due}. Never suggest checking back after the due date.` : "- The task has no due date.",
    "- Waiting on the client usually means 2 to 4 days. Their own work usually means tomorrow or the next working day.",
    "- Never suggest a date in the past, and never a Saturday or Sunday.",
    `- status is one of: ${STATUSES.join(", ")}. Pick the one the task is in AFTER what they just did.`,
    "- Sending something to a client for a decision means waiting. Starting the work means in_progress. A client saying yes means approved.",
    status ? `- It is currently ${status}. Return that same value if what they did does not change it.` : "",
    needsSize
      ? `- size is one of: ${SIZES.join(", ")} meaning 30 minutes, 1 hour, 2 hours, 3 hours, half a day, a full day, more than a day. Size the NEXT STEP, not the whole task.`
      : "- Return null for size.",
    "- There is always a next step until the work is done, so never return an empty nextStep. If the work looks finished, say so as the step, for example Confirm it is done and close it.",
    "- Never use a hyphen, an em dash, an en dash, or any other dash punctuation.",
    "",
    "Return ONLY JSON, no prose and no markdown fence:",
    '{"nextStep": string, "followUpAt": string|null, "status": string|null, "size": string|null, "reason": string}',
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
    let followUpAt = typeof parsed.followUpAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.followUpAt) ? parsed.followUpAt : null;
    if (followUpAt && followUpAt < today) followUpAt = today;
    if (followUpAt && due && followUpAt > due) followUpAt = due;
    if (!nextStep) followUpAt = null;

    const suggestion: NextStepSuggestion = {
      nextStep,
      followUpAt,
      // Checked against the real lists rather than passed through: a model
      // that invents "blocked" would otherwise write a status the app cannot
      // render and the column would go blank.
      status: typeof parsed.status === "string" && STATUSES.includes(parsed.status) ? parsed.status : null,
      size: needsSize && typeof parsed.size === "string" && SIZES.includes(parsed.size) ? parsed.size : null,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 200) : "",
    };
    return NextResponse.json(suggestion);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
