import { NextRequest, NextResponse } from "next/server";
import { requireUser, callerCanSeeTask } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { aiRateLimit, GEMINI_URL, geminiHeaders } from "@/lib/ai";
import { parseThreadKey, threadRows, canUseThread, ghlConversation } from "@/lib/inboxServer";
import { draftReplyPrompt, cleanImproved } from "@/lib/improveText";
import { richToText } from "@/lib/inbox";
import { looksLikeHtml } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Draft a reply in the Inbox's email box (Derek, 2026-10-02): reads the
// conversation and the task it is linked to, and writes a first draft for the
// person to change and send. Nothing is sent from here.

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await aiRateLimit(caller.id);
  if (limited) return limited;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; taskId?: string };
  const ref = parseThreadKey(b.threadKey);
  if (!ref) return NextResponse.json({ error: "Open an email conversation first." }, { status: 400 });
  const rows = await threadRows(ref, caller);
  if (!rows.length) return NextResponse.json({ error: "That conversation is gone." }, { status: 404 });
  const conv = ref.kind === "ghl" ? await ghlConversation(ref.id) : null;
  if (!(await canUseThread(caller, ref, rows, conv))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });

  const plain = (s: string | null | undefined) => (looksLikeHtml(s ?? "") ? richToText(s ?? "") : (s ?? "")).trim();
  const newestFirst = rows.slice(0, 6);
  const lines = [...newestFirst].reverse().map((r: any) =>
    `${r.direction === "outbound" ? "ME" : (r.peer_name || "THEM")} (${String(r.created_at).slice(0, 10)}):\n${plain(r.body).slice(0, 1500)}`);
  const them = newestFirst.find((r: any) => r.direction === "inbound")?.peer_name as string | undefined;

  // The task the conversation is linked to, when the caller can see it.
  const taskId = (typeof b.taskId === "string" && b.taskId) || (rows.find((r: any) => r.task_id)?.task_id as string | undefined);
  let task: string | null = null;
  if (taskId && (await callerCanSeeTask(req, taskId))) {
    const { data: t } = await supabaseAdmin.from("tasks").select("title, status, due, description, comments").eq("id", taskId).maybeSingle();
    if (t) {
      const notes = ((t.comments as any[]) ?? []).filter((c) => c?.kind !== "event" && c?.body).slice(-5).map((c) => `- ${plain(c.body).slice(0, 300)}`);
      task = [`Title: ${t.title}`, `Status: ${t.status}`, t.due ? `Due: ${t.due}` : null, t.description ? `Description: ${plain(t.description as string).slice(0, 1200)}` : null, notes.length ? `Latest notes:\n${notes.join("\n")}` : null]
        .filter(Boolean).join("\n");
    }
  }
  const { data: prof } = await supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle();

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST", headers: geminiHeaders(apiKey),
      body: JSON.stringify({ contents: [{ parts: [{ text: draftReplyPrompt({ me: (prof?.name as string | null) ?? null, them: them ?? null, conversation: lines.join("\n\n"), task }) }] }], generationConfig: { temperature: 0.4 } }),
    });
    if (!res.ok) { const t = await res.text().catch(() => ""); return NextResponse.json({ error: `Gemini API ${res.status}: ${t.slice(0, 240)}` }, { status: 502 }); }
    const json: any = await res.json();
    const out: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out?.trim()) return NextResponse.json({ error: "The AI returned nothing. Try again." }, { status: 502 });
    return NextResponse.json({ text: cleanImproved(out), usedTask: !!task });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
}
