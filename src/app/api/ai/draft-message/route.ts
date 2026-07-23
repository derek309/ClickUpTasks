import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { isCompletionEvent } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Drafts a client-facing status-update email/SMS via Gemini — never sends
// anything itself, just returns text for the human to review and edit
// before hitting Send (which independently enforces the real per-client
// permission check in /api/ghl/message). Mirrors /api/extension/enrich's
// labeled-output-format style (not /api/ai/summary's free-prose style),
// since email needs a distinct subject/body split.

const GEMINI_MODEL = "gemini-flash-latest";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI drafting isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const { clientId, projectId, channel, prompt: userPrompt } = (await req.json().catch(() => ({}))) as { clientId?: string; projectId?: string; channel?: "email" | "sms"; prompt?: string };
  if (!clientId || !channel) return NextResponse.json({ error: "Missing clientId or channel." }, { status: 400 });
  const instruction = (userPrompt ?? "").trim();

  const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  // The prompt had no idea who's actually sending, so Gemini invented a
  // generic "Your Account Manager" sign-off — sign with the real teammate's
  // first name instead, matching how the email actually goes out (Gmail
  // send-as-self, see googleMail.ts).
  const { data: senderProfile } = await supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle();
  const senderFirstName = ((senderProfile?.name as string | null) ?? "").trim().split(/\s+/)[0] || null;

  const { data: tasksRows } = await supabaseAdmin.from("tasks").select("title, status, due, comments").eq("client_id", clientId).limit(60);
  const tasks = tasksRows ?? [];
  const completed = tasks
    .filter((t) => t.status === "done")
    .map((t) => {
      const evt = ((t.comments as any[]) ?? []).filter((c) => c.kind === "event" && isCompletionEvent(c.body)).sort((a, b) => b.at.localeCompare(a.at))[0];
      return { title: t.title as string, at: evt?.at ?? null };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 15);
  const open = tasks.filter((t) => t.status !== "done").sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, 15);

  // Client-level notes (project_id null) plus, when this draft was started
  // from a specific list, that list's own Journal notes too — previously
  // only client-level notes ever reached the prompt, so anything discussed
  // in a project's own Journal (the common case once a client has more than
  // one list going) never informed the draft.
  const { data: notes } = await supabaseAdmin
    .from("client_notes").select("type, body, created_at").eq("client_id", clientId).is("project_id", null)
    .neq("type", "ai_summary").order("created_at", { ascending: false }).limit(5);
  const { data: projectNotes } = projectId
    ? await supabaseAdmin.from("client_notes").select("type, body, created_at").eq("client_id", clientId).eq("project_id", projectId)
        .neq("type", "ai_summary").order("created_at", { ascending: false }).limit(5)
    : { data: null };

  const completedLines = completed.map((t) => `- ${t.title}`).join("\n") || "(none)";
  const openLines = open.map((t) => `- ${t.title}${t.due ? ` (due ${t.due})` : ""}`).join("\n") || "(none)";
  const noteLines = (notes ?? []).map((n) => `- [${n.type}] ${(n.body || "").slice(0, 200)}`).join("\n") || "(none)";
  const projectNoteLines = (projectNotes ?? []).map((n) => `- [${n.type}] ${(n.body || "").slice(0, 200)}`).join("\n") || "(none)";

  const prompt = [
    "You are drafting a client-facing message on behalf of an agency account manager.",
    "Respond in EXACTLY this format, plain text only — no markdown, no preamble:",
    channel === "email"
      ? "SUBJECT: <a short, specific subject line>\nBODY: <the email body, friendly and professional, 3-6 short paragraphs or bullet points>"
      : "BODY: <the text message, under 300 characters, friendly and concise>",
    "",
    // When the account manager typed an instruction, that steers the message;
    // otherwise fall back to the default "status update" behavior.
    instruction
      ? `The account manager's instruction for this message: "${instruction}"\nWrite the message to accomplish that. Use the context below for real facts — never invent anything not present below.`
      : "Structure the body around two things: what's been completed recently, and what (if anything) we're waiting on from the client. Never invent facts not present below — if there's nothing completed or nothing needed, say so briefly.",
    "",
    channel === "email"
      ? (senderFirstName
        ? `Sign off with the sender's actual first name: "${senderFirstName}" (e.g. "Best,\n${senderFirstName}"). Never use a placeholder title like "Your Account Manager" or "The Team".`
        : "Sign off with a brief, generic closing — no name is available, so don't invent one.")
      : null,
    "",
    `Client: ${client.name}`,
    "",
    "Recently completed tasks:", completedLines, "",
    "Currently open tasks:", openLines, "",
    "Recent internal notes for context (not client-facing, background only):", noteLines,
    projectId ? "" : null,
    projectId ? "Recent notes from this specific list's Journal (not client-facing, background only):" : null,
    projectId ? projectNoteLines : null,
  ].filter((l) => l !== null).join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) { const text = await res.text().catch(() => ""); return NextResponse.json({ error: `Gemini API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 }); }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return NextResponse.json({ error: "Gemini returned no text." }, { status: 502 });
    const subjectMatch = text.match(/SUBJECT:\s*(.+)/i);
    const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);
    return NextResponse.json({ subject: channel === "email" ? (subjectMatch?.[1]?.trim() || undefined) : undefined, body: bodyMatch?.[1]?.trim() || text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
