import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";
import { parseThreadKey, threadRows, canUseThread, ghlConversation } from "@/lib/inboxServer";

const API = "https://services.leadconnectorhq.com";

// Hand a GoHighLevel conversation to a teammate (memberId), or to nobody (null)
// so it shows for everyone. GoHighLevel has no assignee on a conversation: it
// follows its contact's owner, so the contact is what changes (needs Edit
// Contacts, contacts.write, on the Private Integration). The local copy moves
// at once, so it leaves the caller's Inbox without waiting for the timer.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; memberId?: string | null };
  const ref = parseThreadKey(b.threadKey);
  if (!ref || ref.kind !== "ghl") return NextResponse.json({ error: "Only GoHighLevel conversations can be assigned." }, { status: 400 });
  const conv = await ghlConversation(ref.id);
  if (!conv) return NextResponse.json({ error: "That conversation hasn't synced yet. Try again in a few minutes." }, { status: 404 });
  const rows = await threadRows(ref, caller);
  if (!(await canUseThread(caller, ref, rows, conv))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });

  const memberId = typeof b.memberId === "string" && b.memberId ? b.memberId : null;
  let ghlUserId: string | null = null;
  if (memberId) {
    const { data: prof } = await supabaseAdmin.from("profiles").select("ghl_user_id, name").eq("member_id", memberId).maybeSingle();
    ghlUserId = (prof?.ghl_user_id as string | null)?.trim() || null;
    if (!ghlUserId) return NextResponse.json({ error: `${prof?.name ?? "That teammate"} has no GoHighLevel user linked. Add it in Settings, Team.` }, { status: 400 });
  }

  const token = await tokenForLocation(conv.location_id as string);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token for this sub-account." }, { status: 501 });
  if (conv.ghl_contact_id) {
    const res = await fetch(`${API}/contacts/${encodeURIComponent(conv.ghl_contact_id as string)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo: ghlUserId }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      const hint = res.status === 401 || res.status === 403 ? " Add Edit Contacts to the Private Integration." : "";
      return NextResponse.json({ error: `GoHighLevel refused the change (${res.status}).${hint} ${t.slice(0, 160)}` }, { status: 502 });
    }
  }
  await supabaseAdmin.from("ghl_conversations")
    .update({ assigned_member_id: memberId, assigned_ghl_user_id: ghlUserId, updated_at: new Date().toISOString() })
    .eq("ghl_contact_id", conv.ghl_contact_id ?? "-").eq("location_id", conv.location_id);
  await supabaseAdmin.from("ghl_conversations").update({ assigned_member_id: memberId, assigned_ghl_user_id: ghlUserId }).eq("id", ref.id);
  // What GoHighLevel said before, so the 15 minute pull keeps this choice
  // until GoHighLevel shows a change of its own (lib/ghlPull withLocalAssign).
  // Its own write: before supabase/inbox-audit.sql the columns are missing.
  // A second assign before GoHighLevel caught up keeps the first "before".
  const mark = { local_assign_from: (conv.local_assign_from as string | null | undefined) ?? (conv.assigned_ghl_user_id as string | null) ?? "", assigned_at: new Date().toISOString() };
  if (conv.ghl_contact_id) await supabaseAdmin.from("ghl_conversations").update(mark).eq("ghl_contact_id", conv.ghl_contact_id).eq("location_id", conv.location_id);
  else await supabaseAdmin.from("ghl_conversations").update(mark).eq("id", ref.id);
  return NextResponse.json({ ok: true, memberId });
}
