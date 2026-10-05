import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { aiRateLimit, GEMINI_URL, geminiHeaders } from "@/lib/ai";
import { parseThreadKey, threadRows, canUseThread, ghlConversation } from "@/lib/inboxServer";
import { proposeTimesPrompt, pickThreeTimes, cleanImproved } from "@/lib/improveText";
import { richToText } from "@/lib/inbox";
import { looksLikeHtml } from "@/lib/data";
import { freeSlots, bookingLinks } from "@/lib/calendarService";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Suggest times in a reply (Phase 4, Derek, 2026-10-05). Three real open times
// from the chosen GoHighLevel calendar, picked here (never by the AI), written
// into a short reply with the calendar's booking page. Text a person checks and
// sends: nothing is sent or booked from here.

const TZ = "America/Los_Angeles";
const nice = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await aiRateLimit(caller.id);
  if (limited) return limited;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI isn't configured yet (missing GEMINI_API_KEY)." }, { status: 501 });

  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; calendarId?: string };
  if (!b.calendarId) return NextResponse.json({ error: "Pick a calendar." }, { status: 400 });
  const ref = parseThreadKey(b.threadKey);
  if (!ref) return NextResponse.json({ error: "Open an email conversation first." }, { status: 400 });
  const rows = await threadRows(ref, caller);
  if (!rows.length) return NextResponse.json({ error: "That conversation is gone." }, { status: 404 });
  const conv = ref.kind === "ghl" ? await ghlConversation(ref.id) : null;
  if (!(await canUseThread(caller, ref, rows, conv))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });

  const open = await freeSlots(b.calendarId, 10);
  if ("error" in open) return NextResponse.json({ error: open.error }, { status: 502 });
  const times = pickThreeTimes(open.slots, Date.now());
  if (!times.length) return NextResponse.json({ error: "That calendar has no open times in the next ten days." }, { status: 409 });
  const link = (await bookingLinks({ id: caller.id, memberId: caller.memberId })).find((l) => l.calendarId === b.calendarId);

  const plain = (s: string | null | undefined) => (looksLikeHtml(s ?? "") ? richToText(s ?? "") : (s ?? "")).trim();
  const lines = rows.slice(0, 6).reverse().map((r: any) => `${r.direction === "outbound" ? "ME" : (r.peer_name || "THEM")}:\n${plain(r.body).slice(0, 1200)}`);
  const them = rows.find((r: any) => r.direction === "inbound")?.peer_name as string | undefined;
  const { data: prof } = await supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle();

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST", headers: geminiHeaders(apiKey),
      body: JSON.stringify({ contents: [{ parts: [{ text: proposeTimesPrompt({ me: (prof?.name as string | null) ?? null, them: them ?? null, conversation: lines.join("\n\n"), times: times.map(nice), minutes: open.minutes }) }] }], generationConfig: { temperature: 0.4 } }),
    });
    if (!res.ok) { const t = await res.text().catch(() => ""); return NextResponse.json({ error: `Gemini API ${res.status}: ${t.slice(0, 240)}` }, { status: 502 }); }
    const json: any = await res.json();
    const out: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out?.trim()) return NextResponse.json({ error: "The AI returned nothing. Try again." }, { status: 502 });
    return NextResponse.json({ text: cleanImproved(out), times, url: link?.url ?? null, calendarName: link?.label ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
}
