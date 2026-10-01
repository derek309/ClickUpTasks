import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isClientVisible } from "@/lib/extensionApi";
import { parseThreadKey, threadRows, canUseThread, ghlConversation, peerOf, escapeLike } from "@/lib/inboxServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Add someone who wrote in to a client, from the Inbox (Derek, 2026-10-01).
// { threadKey, clientId } links them to a client you already have;
// { threadKey, newClientName } makes a new client for them (admins).
// Either way their conversation, and anything else in your Inbox from the same
// address, moves onto that client, and what they send next lands there on its
// own, because the Gmail poll and the GoHighLevel pull now know them.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; clientId?: string; newClientName?: string };
  const ref = parseThreadKey(b.threadKey);
  if (!ref) return NextResponse.json({ error: "Unknown conversation." }, { status: 400 });
  const rows = await threadRows(ref, caller);
  const conv = ref.kind === "ghl" ? await ghlConversation(ref.id) : null;
  if (!rows.length || !(await canUseThread(caller, ref, rows, conv))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });
  const peer = peerOf(rows, conv);
  if (peer.contactId) return NextResponse.json({ error: "They are already a contact." }, { status: 400 });

  const newName = (b.newClientName ?? "").trim().slice(0, 120);
  if (!b.clientId && !newName) return NextResponse.json({ error: "Pick a client or name a new one." }, { status: 400 });
  if (b.clientId && caller.role !== "admin" && !(await isClientVisible(caller, b.clientId))) return NextResponse.json({ error: "You can't add to that client." }, { status: 403 });
  if (!b.clientId && caller.role !== "admin") return NextResponse.json({ error: "Only an admin can make a new client." }, { status: 403 });

  // The contact: GoHighLevel's own person when the conversation came from
  // there, otherwise one made from the email address.
  const email = peer.address?.includes("@") ? peer.address.toLowerCase() : null;
  const phone = !email ? peer.address ?? conv?.phone ?? null : conv?.phone ?? null;
  let contactId: string;
  if (conv?.ghl_contact_id) {
    contactId = `ct_ghl_${conv.ghl_contact_id}`;
    const { data: sub } = await supabaseAdmin.from("clients").select("id").eq("ghl_location_id", conv.location_id).limit(1).maybeSingle();
    const { error } = await supabaseAdmin.from("contacts").upsert({
      id: contactId, client_id: sub?.id ?? null, name: peer.name || conv.contact_name || phone || "Unknown",
      email: conv.email ?? email, phone: conv.phone ?? phone, ghl_contact_id: conv.ghl_contact_id,
    }, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    if (!email) return NextResponse.json({ error: "There's no email address to save." }, { status: 400 });
    const { data: existing } = await supabaseAdmin.from("contacts").select("id").ilike("email", escapeLike(email)).limit(1).maybeSingle();
    contactId = (existing?.id as string | undefined) ?? `ct_mail_${crypto.randomUUID()}`;
    if (!existing) {
      const { error } = await supabaseAdmin.from("contacts").insert({ id: contactId, client_id: null, name: peer.name || email, email });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // The client.
  let clientId: string;
  if (b.clientId) {
    const { data: client } = await supabaseAdmin.from("clients").select("id, linked_contact_ids").eq("id", b.clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "That client is gone." }, { status: 404 });
    clientId = client.id as string;
    const linked: string[] = Array.isArray(client.linked_contact_ids) ? (client.linked_contact_ids as string[]) : [];
    if (clientId !== `cl_${contactId}` && !linked.includes(contactId)) {
      await supabaseAdmin.from("clients").update({ linked_contact_ids: [...linked, contactId] }).eq("id", clientId);
    }
  } else {
    clientId = `cl_${contactId}`;
    const { data: has } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!has) {
      const { error } = await supabaseAdmin.from("clients").insert({
        id: clientId, name: newName, color: "#a855f7", ghl_location_id: "", status: "claimed", type: "client",
        assigned_to: caller.memberId ? [caller.memberId] : [],
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Their messages move onto the client: this conversation, and anything else
  // in the caller's Inbox from the same address.
  const ids = rows.map((r) => r.id as string);
  await supabaseAdmin.from("messages").update({ contact_id: contactId, client_id: clientId }).in("id", ids);
  if (email && caller.memberId) {
    await supabaseAdmin.from("messages").update({ contact_id: contactId, client_id: clientId })
      .is("contact_id", null).eq("mailbox_member_id", caller.memberId).eq("peer_address", email);
  }
  if (conv?.id) await supabaseAdmin.from("messages").update({ contact_id: contactId, client_id: clientId }).is("contact_id", null).eq("ghl_conversation_id", conv.id);
  return NextResponse.json({ ok: true, clientId, contactId });
}
