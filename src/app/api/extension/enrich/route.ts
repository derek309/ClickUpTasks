import { NextRequest, NextResponse } from "next/server";
import { requireApiToken } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { normalizeEnriched, PRIORITIES, ISO_DATE } from "./normalize";

// Turns a raw scraped email into a task the Clipper can create without you
// correcting five fields first: a title and description, plus the priority,
// due date and follow-up date the email itself implies.
//
// Same call shape as the /api/ai routes (model, endpoint, plain fetch, no
// SDK), gated by requireApiToken because the caller is the Gmail extension
// rather than a logged-in browser session. The JSON contract, the enum
// whitelist and the date clamping are lifted from /api/ai/next-step, which
// already solved the same "do not trust what came back" problem.
//
// This IS called automatically now, once per email the side panel opens on
// (Derek, 2026-09-04). The panel keys the call on the Gmail message id so a
// refresh does not re-spend, and applies the result only to fields you have
// not typed in — but the cost shape is one call per email opened, not one per
// button press, which is why the timeout below is shorter than every other
// route's: nobody is sitting there waiting on this one.
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI enrichment isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject : "";
  const senderName = typeof body.senderName === "string" ? body.senderName : "";
  const senderEmail = typeof body.senderEmail === "string" ? body.senderEmail : "";
  const emailBody = typeof body.body === "string" ? body.body : "";
  // The panel sends its LOCAL date. Falling back to the server's UTC day is
  // better than nothing but is wrong for a whole evening in Pacific time, so
  // the panel always sends it.
  const today = typeof body.today === "string" && ISO_DATE.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  if (!subject && !emailBody) return NextResponse.json({ error: "Nothing to enrich — no subject or body." }, { status: 400 });

  const prompt = [
    "You are turning an email into a task in a project management tool.",
    "",
    "Rules:",
    "- title: short and specific, starting with a verb, under 80 characters.",
    "- description: 2 to 4 short sentences saying what is needed and any detail from the email that matters.",
    "- Never use a hyphen, an em dash, an en dash, or any other dash punctuation.",
    "",
    "Priority:",
    `- One of exactly: ${PRIORITIES.join(", ")}.`,
    "- \"urgent\" only when the email itself says so (urgent, ASAP, critical) or names a deadline within two days.",
    "- Most email is \"normal\". Use \"none\" only for something purely informational that still needs doing.",
    "",
    "Dates:",
    `- Today is ${today}. Return dates as yyyy-mm-dd.`,
    "- due is when this was promised. Read it from the email: a stated deadline, \"by Friday\", \"end of the month\".",
    "- followUpAt is when it should come back to your attention, which is never after due.",
    "- Never a date in the past, and never a Saturday or a Sunday.",
    "- Return null for either date when the email gives no signal at all. Do not invent one. Null is a good answer.",
    "",
    "Return ONLY a JSON object, no prose and no markdown fence:",
    '{"title": string, "description": string, "priority": "none"|"normal"|"urgent", "due": string|null, "followUpAt": string|null}',
    "",
    `Subject: ${subject || "(none)"}`,
    `From: ${senderName || "(unknown)"}${senderEmail ? ` <${senderEmail}>` : ""}`,
    "",
    "Email body:",
    emailBody || "(none)",
  ].join("\n");

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
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Gemini API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json();
    const raw: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });

    // responseMimeType usually gives clean JSON, but a fenced block still
    // shows up occasionally — strip it rather than failing the whole call.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    let parsed: unknown;
    try { parsed = JSON.parse(cleaned); } catch {
      return NextResponse.json({ error: "Couldn't read the AI's response." }, { status: 502 });
    }
    return NextResponse.json(normalizeEnriched(parsed, subject, today));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
