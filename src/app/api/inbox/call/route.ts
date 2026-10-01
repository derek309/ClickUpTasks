import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";
import { canUseThread, ghlConversation } from "@/lib/inboxServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = "https://services.leadconnectorhq.com";

// A call's recording and transcript from GoHighLevel, for the Inbox (Derek,
// 2026-10-01: voicemail). Read on demand and never stored: GoHighLevel keeps
// them. GET ?message=<messages.id>&part=audio streams the recording;
// &part=transcript returns { lines: [{ who, text }] }.
// Needs View Conversation Messages on the Private Integration.
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("message") ?? "";
  const part = req.nextUrl.searchParams.get("part") === "transcript" ? "transcript" : "audio";
  const { data: row } = await supabaseAdmin.from("messages").select("id, channel, ghl_message_id, ghl_conversation_id, client_id").eq("id", id).maybeSingle();
  if (!row || row.channel !== "call" || !row.ghl_message_id || !row.ghl_conversation_id) return NextResponse.json({ error: "No recording for this call." }, { status: 404 });
  const conv = await ghlConversation(row.ghl_conversation_id as string);
  if (!conv) return NextResponse.json({ error: "That call hasn't synced yet." }, { status: 404 });
  if (!(await canUseThread(caller, { kind: "ghl", id: conv.id }, [row], conv))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const token = await tokenForLocation(conv.location_id as string);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token for this sub-account." }, { status: 501 });
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-04-15" };
  const loc = encodeURIComponent(conv.location_id as string), msg = encodeURIComponent(row.ghl_message_id as string);

  if (part === "audio") {
    const res = await fetch(`${API}/conversations/messages/${msg}/locations/${loc}/recording`, { headers });
    if (!res.ok) return NextResponse.json({ error: res.status === 404 ? "This call has no recording." : `GoHighLevel didn't send the recording (${res.status}).` }, { status: res.status === 404 ? 404 : 502 });
    const type = res.headers.get("content-type") ?? "audio/wav";
    if (!/^audio\//i.test(type)) return NextResponse.json({ error: "This call has no recording." }, { status: 404 });
    return new NextResponse(new Uint8Array(await res.arrayBuffer()), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  }
  const res = await fetch(`${API}/conversations/locations/${loc}/messages/${msg}/transcription`, { headers: { ...headers, Accept: "application/json" } });
  if (!res.ok) return NextResponse.json({ lines: [], note: res.status === 404 ? "No transcript for this call." : `GoHighLevel didn't send the transcript (${res.status}).` });
  const json: any = await res.json().catch(() => null);
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.transcription) ? json.transcription : Array.isArray(json?.sentences) ? json.sentences : [];
  const lines = list
    .sort((a, b) => (Number(a?.sentenceIndex) || 0) - (Number(b?.sentenceIndex) || 0))
    .map((s) => ({ who: Number(s?.mediaChannel) === 1 ? "them" : "us", text: String(s?.transcript ?? "").trim() }))
    .filter((l) => l.text);
  return NextResponse.json({ lines });
}
