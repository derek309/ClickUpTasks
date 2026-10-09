import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deleteGmailDraft } from "@/lib/googleMail";

// A reply Claude drafted is in the conversation in the Inbox and, as a copy,
// in Gmail (mcp draft_email_reply). Sent or thrown away in the Inbox, the
// Gmail copy goes too, so it isn't sent twice (Derek, 2026-10-09). Only a
// draft in the caller's own Drafts, and only the Gmail draft it names.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string };
  if (!caller.memberId) return NextResponse.json({ ok: true, gmail: false });
  if (!b.id) return NextResponse.json({ error: "No draft." }, { status: 400 });
  const { data: row } = await supabaseAdmin.from("inbox_prefs").select("prefs").eq("member_id", caller.memberId).maybeSingle();
  const d = ((row?.prefs as { queuedDrafts?: { id: string; gmailDraftId?: string; gmailMailbox?: string }[] } | null)?.queuedDrafts ?? []).find((x) => x.id === b.id);
  if (!d?.gmailDraftId || !d.gmailMailbox) return NextResponse.json({ ok: true, gmail: false });
  try {
    await deleteGmailDraft(d.gmailMailbox, d.gmailDraftId);
    return NextResponse.json({ ok: true, gmail: true });
  } catch (e) {
    return NextResponse.json({ ok: true, gmail: false, note: e instanceof Error ? e.message : "Gmail didn't remove it." });
  }
}
