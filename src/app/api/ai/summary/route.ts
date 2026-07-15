import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";

// Generates a short "what's going on with this client" summary from their
// recent messages + open tasks, via Gemini. Only ever called when someone
// clicks "Regenerate" in the task drawer's AI tab (never on page load) —
// the result is cached on clients.ai_summary so re-opening the drawer is
// free. Server-only: GEMINI_API_KEY never reaches the browser.

const GEMINI_MODEL = "gemini-flash-latest";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI summary isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const { clientId } = (await req.json().catch(() => ({}))) as { clientId?: string };
  if (!clientId) return NextResponse.json({ error: "Missing clientId." }, { status: 400 });

  const { data: client } = await supabaseAdmin.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const { data: contacts } = await supabaseAdmin.from("contacts").select("id, name").eq("client_id", clientId);
  const contact = client.linked_contact_id ? contacts?.find((c) => c.id === client.linked_contact_id) : contacts?.[0];

  const { data: messages } = await supabaseAdmin
    .from("messages").select("channel, direction, body, at")
    .eq("client_id", clientId).order("at", { ascending: false }).limit(15);

  const { data: tasks } = await supabaseAdmin
    .from("tasks").select("title, status, priority, due")
    .eq("client_id", clientId).limit(40);

  const msgLines = (messages ?? []).map((m) =>
    `- [${m.direction === "inbound" ? "Them" : "Us"} · ${m.channel}] ${(m.body || "").slice(0, 300)} (${m.at})`
  ).join("\n") || "(none)";
  const taskLines = (tasks ?? []).map((t) =>
    `- ${t.title} — ${t.status}${t.priority && t.priority !== "none" ? `, ${t.priority} priority` : ""}${t.due ? `, due ${t.due}` : ""}`
  ).join("\n") || "(none)";

  const prompt = [
    "You are a concise CRM assistant summarizing a client relationship for a busy account manager.",
    "Write 2-4 short sentences covering: what's happened recently, what we're currently waiting on (from us or from them), and a suggested next action.",
    "Be specific, use the client's name, plain text only — no markdown, no headers, no preamble like \"Here's a summary\".",
    "",
    `Client: ${client.name} (status: ${client.status ?? "unknown"})${contact?.name ? `, primary contact: ${contact.name}` : ""}`,
    "",
    "Recent messages (most recent first):",
    msgLines,
    "",
    "Open/recent tasks:",
    taskLines,
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
    const summary: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!summary) return NextResponse.json({ error: "Gemini returned no summary text." }, { status: 502 });

    const generatedAt = new Date().toISOString();
    await supabaseAdmin.from("clients").update({ ai_summary: summary, ai_summary_at: generatedAt }).eq("id", clientId);
    return NextResponse.json({ summary, generatedAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gemini request failed." }, { status: 502 });
  }
}
