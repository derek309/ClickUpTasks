import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Search the Inbox past the 30 days it loads (Derek, 2026-10-01): words in
// the message, the subject, or who it is from. Only what is yours: your own
// Gmail, and GoHighLevel conversations assigned to you or to nobody. Each
// match comes with its whole conversation so it opens like any other.
// GET ?q=words  →  { messages: rows }
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller?.memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Letters, digits and a few joiners only: the words go into a filter string.
  const words = (req.nextUrl.searchParams.get("q") ?? "").toLowerCase().replace(/[^\p{L}\p{N}@.\s-]/gu, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
  if (!words.length || words.join("").length < 3) return NextResponse.json({ messages: [] });
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  const like = `%${longest}%`;
  const or = `body.ilike.${like},subject.ilike.${like},peer_name.ilike.${like},peer_address.ilike.${like}`;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // Your own mail, and GoHighLevel rows that match; then only the GoHighLevel
  // ones from a conversation assigned to you or to nobody are kept.
  const [{ data: mine }, { data: ghlHits }] = await Promise.all([
    supabaseAdmin.from("messages").select("*").eq("mailbox_member_id", caller.memberId).lt("created_at", since).or(or).order("created_at", { ascending: false }).limit(200),
    supabaseAdmin.from("messages").select("*").not("ghl_conversation_id", "is", null).lt("created_at", since).or(or).order("created_at", { ascending: false }).limit(400),
  ]);
  const hitConvIds = [...new Set((ghlHits ?? []).map((r: any) => r.ghl_conversation_id as string))];
  const { data: openConvs } = hitConvIds.length
    ? await supabaseAdmin.from("ghl_conversations").select("id").in("id", hitConvIds).or(`assigned_member_id.is.null,assigned_member_id.eq.${caller.memberId}`)
    : { data: [] as any[] };
  const yours = new Set((openConvs ?? []).map((c: any) => c.id as string));
  const ghl = (ghlHits ?? []).filter((r: any) => yours.has(r.ghl_conversation_id));
  // Every word must match somewhere in the row.
  const hay = (r: any) => `${r.body ?? ""} ${r.subject ?? ""} ${r.peer_name ?? ""} ${r.peer_address ?? ""}`.toLowerCase();
  const hits = [...(mine ?? []), ...ghl].filter((r) => words.every((w) => hay(r).includes(w))).slice(0, 150);

  // The rest of each conversation, so a match opens whole.
  const gm = [...new Set(hits.filter((r) => r.gmail_thread_id && r.mailbox_member_id === caller.memberId).map((r) => r.gmail_thread_id as string))].slice(0, 60);
  const cv = [...new Set(hits.filter((r) => r.ghl_conversation_id).map((r) => r.ghl_conversation_id as string))].slice(0, 60);
  const [{ data: gmRows }, { data: cvRows }] = await Promise.all([
    gm.length ? supabaseAdmin.from("messages").select("*").eq("mailbox_member_id", caller.memberId).in("gmail_thread_id", gm).limit(1000) : Promise.resolve({ data: [] as any[] }),
    cv.length ? supabaseAdmin.from("messages").select("*").in("ghl_conversation_id", cv).limit(1000) : Promise.resolve({ data: [] as any[] }),
  ]);
  const byId = new Map<string, any>();
  for (const r of [...hits, ...(gmRows ?? []), ...(cvRows ?? [])]) byId.set(r.id, r);
  return NextResponse.json({ messages: [...byId.values()] });
}
