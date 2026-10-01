import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { aiRateLimit, GEMINI_URL, geminiHeaders } from "@/lib/ai";
import { improvePrompt, cleanImproved } from "@/lib/improveText";

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Improve with AI" in the Inbox's reply box (Derek, 2026-10-01: "check
// grammar and spelling etc when sending an sms or email"). It cleans up what
// the person wrote and nothing more: their words, their voice, their meaning.
// Returns text only; nothing is sent from here.

const MAX = 6000;

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await aiRateLimit(caller.id);
  if (limited) return limited;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const b = (await req.json().catch(() => ({}))) as { text?: string; channel?: string };
  const text = (b.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Nothing to improve yet." }, { status: 400 });
  if (text.length > MAX) return NextResponse.json({ error: "That message is too long to improve in one go." }, { status: 400 });
  const channel = b.channel === "sms" || b.channel === "chat" ? b.channel : "email";

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST", headers: geminiHeaders(apiKey),
      body: JSON.stringify({ contents: [{ parts: [{ text: improvePrompt(text, channel) }] }], generationConfig: { temperature: 0.1 } }),
    });
    if (!res.ok) { const t = await res.text().catch(() => ""); return NextResponse.json({ error: `Gemini API ${res.status}: ${t.slice(0, 240)}` }, { status: 502 }); }
    const json: any = await res.json();
    const out: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out?.trim()) return NextResponse.json({ error: "The AI returned nothing. Try again." }, { status: 502 });
    const improved = cleanImproved(out);
    return NextResponse.json({ text: improved, changed: improved !== text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
}
