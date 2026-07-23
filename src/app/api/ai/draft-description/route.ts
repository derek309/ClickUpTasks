import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { htmlToText } from "@/lib/data";

// Drafts a task description via Gemini — never writes anything itself, just
// returns text for the human to review/edit before saving. Modeled on
// /api/ai/draft-message/route.ts's client-notes context pull, but returns a
// single body (no subject/channel split — a description isn't addressed to
// anyone).

const GEMINI_MODEL = "gemini-flash-latest";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI drafting isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const { clientId, title, description, prompt: userPrompt } = (await req.json().catch(() => ({}))) as
    { clientId?: string; title?: string; description?: string; prompt?: string };
  if (!clientId || !title) return NextResponse.json({ error: "Missing clientId or title." }, { status: 400 });
  const instruction = (userPrompt ?? "").trim();
  const existing = htmlToText(description ?? "").trim();

  const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const { data: notes } = await supabaseAdmin
    .from("client_notes").select("type, body, created_at").eq("client_id", clientId).is("project_id", null)
    .neq("type", "ai_summary").order("created_at", { ascending: false }).limit(5);
  const noteLines = (notes ?? []).map((n) => `- [${n.type}] ${(n.body || "").slice(0, 200)}`).join("\n") || "(none)";

  const prompt = [
    "You are drafting a task description for an internal work-tracking app — this is a note to the team doing the work, not client-facing copy.",
    "Respond in EXACTLY this format, plain text only — no markdown, no preamble:",
    "BODY: <the description, clear and actionable, a short paragraph or a few bullet points>",
    "",
    instruction
      ? `The teammate's instruction for this description: "${instruction}"\nWrite it to accomplish that. Use the context below for real facts — never invent anything not present below.`
      : "No specific instruction was given — write a clear, actionable description based on the task title and any existing draft below.",
    "",
    `Client: ${client.name}`,
    `Task title: ${title}`,
    existing ? `Existing draft description (revise/expand on this, don't ignore it):\n${existing}` : "No existing description yet.",
    "",
    "Recent internal notes for context (background only):", noteLines,
  ].join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) { const text = await res.text().catch(() => ""); return NextResponse.json({ error: `Gemini API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 }); }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });
    const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);
    return NextResponse.json({ body: bodyMatch?.[1]?.trim() || text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
