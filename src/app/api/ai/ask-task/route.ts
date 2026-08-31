import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// Answers a question about one task from that task's own record: its
// description, checklist, attachments, logged actions, notes and the emails
// and messages on it.
//
// The whole point is that it answers from what is on the task and nothing
// else. A transcript pasted three weeks ago holds the answer to "what are the
// specs" and nobody is going to scroll back for it, but a model that fills
// the gap with a plausible guess is worse than no answer at all — you cannot
// tell the two apart later. Hence the hard instruction to say when the task
// does not say, and a temperature of 0.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 25000;
const MAX_CONTEXT_CHARS = 120000;
const MAX_HISTORY = 8;

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const b = await req.json().catch(() => ({}));
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 1000) : "";
  // Oldest content is dropped first: the newest entries on a task are the
  // ones most likely to hold the answer, and truncating from the front would
  // throw those away to keep a stale description.
  const context = typeof b.context === "string" ? b.context.slice(-MAX_CONTEXT_CHARS) : "";
  const history: { q: string; a: string }[] = Array.isArray(b.history)
    ? b.history.filter((h: unknown) => h && typeof h === "object").slice(-MAX_HISTORY)
    : [];
  if (!question) return NextResponse.json({ error: "Ask something first." }, { status: 400 });
  if (!context.trim()) return NextResponse.json({ error: "There's nothing on this task to read yet." }, { status: 400 });

  const prompt = [
    "You are answering a question about one task, using only that task's own record below.",
    "",
    "Rules:",
    "- Answer only from the record. Never use outside knowledge and never guess.",
    "- If the record does not say, reply exactly what is missing, e.g. \"The task doesn't say what size the card is.\" Do not pad it out.",
    "- Be short. Two or three sentences, or a short list when the answer really is a list.",
    "- Quote specifics: sizes, dates, names, numbers, exactly as they appear.",
    "- Say where it came from when it helps, e.g. \"from the Aug 28 meeting\" or \"Brian's email\".",
    "- Never use a hyphen, an em dash, an en dash, or any other dash punctuation.",
    "",
    ...history.flatMap((h) => [`Earlier question: ${String(h.q).slice(0, 500)}`, `Your answer: ${String(h.a).slice(0, 1000)}`]),
    history.length ? "" : "",
    "The task record:",
    context,
    "",
    `Question: ${question}`,
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: `Gemini API ${res.status}: ${t.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json();
    const answer: string = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!answer) return NextResponse.json({ error: "Gemini returned no answer." }, { status: 502 });
    return NextResponse.json({ answer: answer.slice(0, 4000) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
