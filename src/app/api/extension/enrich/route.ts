import { NextRequest, NextResponse } from "next/server";
import { requireApiToken } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";

// Turns a raw scraped email into a cleaner task title + description via
// Gemini — same call shape as /api/ai/summary (model, endpoint, plain fetch,
// no SDK), but gated by requireApiToken (the caller is the Gmail extension,
// not a logged-in browser session) and with a task-authoring prompt instead
// of a relationship-summary one. Only ever called from the popup's explicit
// "Enrich with AI" button — never automatically, so opening the popup never
// spends money.
const GEMINI_MODEL = "gemini-flash-latest";

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
  if (!subject && !emailBody) return NextResponse.json({ error: "Nothing to enrich — no subject or body." }, { status: 400 });

  const prompt = [
    "You are a concise task-authoring assistant turning an email into a task for a project management tool.",
    "Respond in EXACTLY this format, plain text only — no markdown, no preamble like \"Here's the task\":",
    "TITLE: <a short, specific task title, action-oriented, under 80 characters>",
    "DESCRIPTION: <2-4 short sentences summarizing what's needed and any relevant details from the email>",
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
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Gemini API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });

    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    const descMatch = text.match(/DESCRIPTION:\s*([\s\S]+)/i);
    const title = titleMatch?.[1]?.trim() || subject;
    const description = descMatch?.[1]?.trim() || text;
    return NextResponse.json({ title, description });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
