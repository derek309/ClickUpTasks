import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { trashGmailThread } from "@/lib/googleMail";
import { parseThreadKey, threadRows, canUseThread } from "@/lib/inboxServer";

// Delete in the Inbox moves a conversation to its Trash (the caller's own
// inbox_state, written by the browser) and, for an email, to Gmail's Trash in
// the mailbox it is in, where Gmail keeps it 30 days (Derek, 2026-10-01).
// restore: true brings it back out of both. A GoHighLevel conversation only
// leaves the Inbox: deleting there erases it for the whole team.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; restore?: boolean };
  const ref = parseThreadKey(b.threadKey);
  if (!ref) return NextResponse.json({ ok: true, gmail: false });
  if (ref.kind !== "gm") return NextResponse.json({ ok: true, gmail: false });
  const rows = await threadRows(ref, caller);
  if (!rows.length || !(await canUseThread(caller, ref, rows))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });
  const owner = rows.find((r) => r.mailbox_member_id)?.mailbox_member_id as string | undefined;
  const { data: prof } = await supabaseAdmin.from("profiles").select("email").eq("member_id", owner ?? "-").maybeSingle();
  if (!prof?.email) return NextResponse.json({ ok: true, gmail: false, note: "Not in a mailbox the app reads." });
  try {
    await trashGmailThread(prof.email as string, ref.id, !!b.restore);
    return NextResponse.json({ ok: true, gmail: true });
  } catch (e) {
    return NextResponse.json({ ok: true, gmail: false, note: e instanceof Error ? e.message : "Gmail didn't move it." });
  }
}
