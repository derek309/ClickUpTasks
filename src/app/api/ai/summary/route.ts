import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { isCompletionEvent } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Generates a short "here's what we just did, and here's what's next" recap
// for a client from their recently-completed + open tasks and recent
// messages, via Gemini. Only ever called when someone clicks "What's next"
// (or "Regenerate" in the task drawer's AI tab) — never on page load — the
// result is cached on clients.ai_summary and logged as an ai_summary journal
// note. Server-only: GEMINI_API_KEY never reaches the browser.

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

  const { data: tasksRows } = await supabaseAdmin
    .from("tasks").select("title, status, priority, due, comments")
    .eq("client_id", clientId).limit(60);
  const tasks = tasksRows ?? [];
  // Recently completed — ordered by the completion event's timestamp (the
  // "changed status ... to Done" system comment), most recent first.
  const completed = tasks
    .filter((t) => t.status === "done")
    .map((t) => {
      const evt = ((t.comments as any[]) ?? []).filter((c) => c.kind === "event" && isCompletionEvent(c.body)).sort((a, b) => b.at.localeCompare(a.at))[0];
      return { title: t.title as string, at: evt?.at ?? null };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 12);
  const open = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .slice(0, 12);

  const msgLines = (messages ?? []).map((m) =>
    `- [${m.direction === "inbound" ? "Them" : "Us"} · ${m.channel}] ${(m.body || "").slice(0, 300)} (${m.at})`
  ).join("\n") || "(none)";
  const completedLines = completed.map((t) => `- ${t.title}${t.at ? ` (done ${t.at.slice(0, 10)})` : ""}`).join("\n") || "(none)";
  const openLines = open.map((t) =>
    `- ${t.title}${t.priority && t.priority !== "none" ? `, ${t.priority} priority` : ""}${t.due ? `, due ${t.due}` : ""}`
  ).join("\n") || "(none)";

  const prompt = [
    "You are a concise assistant briefing a busy account manager on where a client stands.",
    "Write a short recap in EXACTLY two labeled sections, plain text only — no markdown symbols, no preamble like \"Here's a summary\":",
    "Recently done: 1-3 short sentences (or brief bullet-style lines) on what was just completed or moved forward.",
    "Next up: 1-3 short sentences on what needs to happen next and what we're waiting on (from us or from them).",
    "Be specific and use real facts from the context below — never invent anything not present. If a section has nothing, say so briefly (e.g. \"Nothing completed recently.\").",
    "",
    `Client: ${client.name} (status: ${client.status ?? "unknown"})${contact?.name ? `, primary contact: ${contact.name}` : ""}`,
    "",
    "Recently completed tasks (most recent first):",
    completedLines,
    "",
    "Open tasks (soonest due first):",
    openLines,
    "",
    "Recent messages (most recent first):",
    msgLines,
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
