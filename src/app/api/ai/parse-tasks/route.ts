import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// Turns a pasted blob (meeting notes, an action-item list, an email) into a
// set of discrete tasks for a human to review before anything is created
// (Derek, 2026-08-26: "instead of using Claude Code I would like to be able
// to just dump it a list and then it creates all the tasks for me").
//
// It only ever RETURNS structured tasks — the caller shows them for editing
// and does the creating. Nothing here writes to the database, so a bad parse
// costs a glance, not a cleanup.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 20000;
const MAX_INPUT_CHARS = 12000;
const MAX_TASKS = 40;

export type ParsedTask = {
  title: string;
  description: string;
  assignee: string | null; // a roster member's exact name, "client", or null
  due: string | null;      // yyyy-mm-dd
  priority: "none" | "normal" | "urgent";
};

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const b = await req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text.trim().slice(0, MAX_INPUT_CHARS) : "";
  const roster: string[] = Array.isArray(b.roster) ? b.roster.filter((n: unknown) => typeof n === "string").slice(0, 40) : [];
  const clientName = typeof b.clientName === "string" ? b.clientName.trim() : "";
  const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  if (!text) return NextResponse.json({ error: "Nothing to read — paste a list first." }, { status: 400 });

  const prompt = [
    "You are turning someone's pasted notes into tasks in a project management tool.",
    "Read the text and return every distinct action item as its own task.",
    "",
    "Rules:",
    "- One task per action. Do not merge two actions into one, and do not invent tasks that are not in the text.",
    "- Title: short and specific, starting with a verb, under 70 characters.",
    "- Description: any supporting detail from the text that does not fit the title. Empty string if the title already says everything.",
    "- Keep the author's own wording where you reasonably can. Fix spelling and grammar only.",
    `- Today is ${today}. Resolve any date mentioned in the text to yyyy-mm-dd. Use null when no date is stated. Never invent a date.`,
    "- priority is \"urgent\" only if the text says so (urgent, ASAP, critical). Otherwise \"normal\".",
    "- Never use a hyphen, an em dash, an en dash, or any other dash punctuation in the title or description.",
    "",
    "Assigning:",
    "- The text may group items under a person's name. Assign each task to whoever is meant to do it.",
    roster.length ? `- Teammates, use one of these EXACT names when the task is theirs: ${roster.join(", ")}` : "- There is no teammate roster available; use null.",
    clientName ? `- "${clientName}" is the CLIENT, not a teammate. If an item is for them to do, use the exact string "client".` : "",
    "- Use null when you genuinely cannot tell who it belongs to. Do not guess.",
    "",
    "Return ONLY a JSON array, no prose and no markdown fence. Each element:",
    '{"title": string, "description": string, "assignee": string|null, "due": string|null, "priority": "none"|"normal"|"urgent"}',
    "",
    "The text:",
    text,
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

    // responseMimeType usually gives clean JSON, but a fenced block still
    // shows up occasionally — strip it rather than failing the whole parse.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    let parsed: unknown;
    try { parsed = JSON.parse(cleaned); } catch {
      return NextResponse.json({ error: "Couldn't read the AI's response as a task list. Try again, or simplify the text." }, { status: 502 });
    }
    const arr = Array.isArray(parsed) ? parsed : (parsed as { tasks?: unknown })?.tasks;
    if (!Array.isArray(arr)) return NextResponse.json({ error: "The AI didn't return a task list." }, { status: 502 });

    // Normalize hard rather than trusting the model: a bad assignee name or a
    // malformed date must never reach the task-creation path.
    const rosterLower = new Map(roster.map((n) => [n.toLowerCase(), n]));
    const tasks: ParsedTask[] = arr.slice(0, MAX_TASKS).map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
      const rawAssignee = typeof o.assignee === "string" ? o.assignee.trim() : "";
      const assignee = rawAssignee.toLowerCase() === "client" ? "client" : (rosterLower.get(rawAssignee.toLowerCase()) ?? null);
      const due = typeof o.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due) ? o.due : null;
      const priority: ParsedTask["priority"] = o.priority === "urgent" ? "urgent" : o.priority === "none" ? "none" : "normal";
      return { title, description: typeof o.description === "string" ? o.description.trim().slice(0, 4000) : "", assignee, due, priority };
    }).filter((t) => t.title.length > 0);

    if (tasks.length === 0) return NextResponse.json({ error: "Couldn't find any action items in that text." }, { status: 422 });
    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
