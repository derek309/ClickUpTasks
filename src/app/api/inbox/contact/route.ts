import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isClientVisible } from "@/lib/extensionApi";
import { parseThreadKey, threadRows, canUseThread, ghlConversation, peerOf, escapeLike } from "@/lib/inboxServer";
import { tokenForLocation } from "@/lib/ghlTokens";
import { resolveTrackedClientId } from "@/lib/ghlConversationTask";
import { savePerson } from "@/lib/ghlPerson";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Add someone who wrote in to a client, from the Inbox (Derek, 2026-10-01).
// { threadKey, clientId } links them to a client you already have;
// { threadKey, newClientName } makes a new client for them (admins).
// Either way their conversation, and anything else in your Inbox from the same
// address, moves onto that client, and what they send next lands there on its
// own, because the Gmail poll and the GoHighLevel pull now know them.
// Agency for anyone buying from us (a website or marketing prospect), Directory
// only for a business listed in the directory (Derek, 2026-10-02).
const SUB_ACCOUNTS = { agency: "c_agency", directory: "c_directory" } as const;
const API = "https://services.leadconnectorhq.com";

/** A new person into GoHighLevel, in the sub-account picked, so they live
 *  there and in ClickUpTasks. A duplicate GoHighLevel already has is reused. */
type NewDetails = { firstName?: string; lastName?: string; companyName?: string; phone?: string; website?: string; extras?: Partial<Record<"title" | "facebook" | "instagram" | "linkedin", string>> };
async function createGhlContact(sub: keyof typeof SUB_ACCOUNTS, name: string, email: string, d: NewDetails = {}): Promise<{ ghlContactId: string; subClientId: string } | { error: string }> {
  const { data: subClient } = await supabaseAdmin.from("clients").select("id, ghl_location_id").eq("id", SUB_ACCOUNTS[sub]).maybeSingle();
  const locationId = subClient?.ghl_location_id as string | undefined;
  const token = locationId ? await tokenForLocation(locationId) : null;
  if (!locationId || !token) return { error: `No GoHighLevel token for ${sub === "agency" ? "Agency" : "Directory"}.` };
  const [firstName, ...rest] = name.trim().split(/\s+/);
  const res = await fetch(`${API}/contacts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      locationId, email, firstName: d.firstName || firstName || email, lastName: d.lastName ?? (rest.join(" ") || undefined),
      ...(d.companyName ? { companyName: d.companyName } : {}), ...(d.phone ? { phone: d.phone } : {}), ...(d.website ? { website: d.website } : {}),
      source: "ClickUpTasks Inbox",
    }),
  });
  const j: any = await res.json().catch(() => null);
  const id = j?.contact?.id ?? j?.meta?.contactId ?? null; // meta.contactId: GoHighLevel already had them
  if (!id) return { error: `GoHighLevel didn't add them (${res.status}). ${String(j?.message ?? "").slice(0, 160)}` };
  // Job title and socials are custom fields: set once the contact exists.
  if (d.extras && Object.values(d.extras).some(Boolean)) await savePerson(id as string, { extras: d.extras }).catch(() => null);
  return { ghlContactId: id as string, subClientId: subClient!.id as string };
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { threadKey?: string; clientId?: string; newClientName?: string; address?: string; name?: string; sub?: string; details?: NewDetails; useContactId?: string };
  const ref = parseThreadKey(b.threadKey);
  if (!ref) return NextResponse.json({ error: "Unknown conversation." }, { status: 400 });
  const rows = await threadRows(ref, caller);
  const conv = ref.kind === "ghl" ? await ghlConversation(ref.id) : null;
  if (!rows.length || !(await canUseThread(caller, ref, rows, conv))) return NextResponse.json({ error: "That conversation isn't yours." }, { status: 403 });
  const peer = peerOf(rows, conv);
  const ids = rows.map((r) => r.id as string);

  // Who the conversation is with: the person picked from everyone on it
  // (Change contact), or the one it came from.
  const picked = (b.address ?? "").trim().toLowerCase();
  const email = picked.includes("@") ? picked : peer.address?.includes("@") ? peer.address.toLowerCase() : null;
  if (email?.endsWith("@clickuplocal.com")) return NextResponse.json({ error: "A teammate can't be the contact." }, { status: 400 });
  const personName = (b.name ?? "").trim() || (rows.find((r) => (r.peer_address ?? "").toLowerCase() === email)?.peer_name as string | undefined) || (email === peer.address?.toLowerCase() ? peer.name : null) || email || "Unknown";

  // "Use this one" on a duplicate: the conversation moves onto that contact and its client.
  if (b.useContactId && !b.clientId && !b.newClientName) {
    const { data: dup } = await supabaseAdmin.from("contacts").select("id, client_id").eq("id", b.useContactId).maybeSingle();
    if (!dup) return NextResponse.json({ error: "That contact is gone." }, { status: 404 });
    const clientId = await resolveTrackedClientId(dup.id as string, (dup.client_id as string | null) ?? "");
    if (caller.role !== "admin" && !(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "You can't see that client." }, { status: 403 });
    await supabaseAdmin.from("messages").update({ contact_id: dup.id, client_id: clientId }).in("id", ids);
    return NextResponse.json({ ok: true, clientId, contactId: dup.id });
  }

  // Already a contact: the conversation moves onto them and their client.
  if (email && !conv?.ghl_contact_id) {
    const { data: existing } = await supabaseAdmin.from("contacts").select("id, client_id").ilike("email", escapeLike(email)).limit(1).maybeSingle();
    if (existing && !b.clientId && !b.newClientName) {
      const clientId = await resolveTrackedClientId(existing.id as string, (existing.client_id as string | null) ?? "");
      if (clientId.startsWith("cl_") || clientId === existing.client_id) {
        if (caller.role !== "admin" && !(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "You can't see that client." }, { status: 403 });
        await supabaseAdmin.from("messages").update({ contact_id: existing.id, client_id: clientId }).in("id", ids);
        return NextResponse.json({ ok: true, clientId, contactId: existing.id });
      }
    }
  } else if (peer.contactId && !b.address) {
    return NextResponse.json({ error: "They are already a contact." }, { status: 400 });
  }

  const newName = (b.newClientName ?? "").trim().slice(0, 120);
  // A new person and no client picked yet: the screen asks where they go.
  if (!b.clientId && !newName) return NextResponse.json({ needsClient: true, address: email, name: personName });
  if (b.clientId && caller.role !== "admin" && !(await isClientVisible(caller, b.clientId))) return NextResponse.json({ error: "You can't add to that client." }, { status: 403 });
  if (!b.clientId && caller.role !== "admin") return NextResponse.json({ error: "Only an admin can make a new client." }, { status: 403 });

  // The contact: GoHighLevel's own person when the conversation came from
  // there; otherwise added to GoHighLevel in the sub-account picked.
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
    // A duplicate the screen found (same email or phone): that contact, not a new one.
    const { data: chosen } = b.useContactId ? await supabaseAdmin.from("contacts").select("id").eq("id", b.useContactId).maybeSingle() : { data: null };
    if (chosen) contactId = chosen.id as string;
    else if (existing) contactId = existing.id as string;
    else {
      const sub = b.sub === "directory" ? "directory" : "agency";
      const made = await createGhlContact(sub, personName, email, b.details ?? {});
      if ("error" in made) return NextResponse.json({ error: made.error }, { status: 502 });
      contactId = `ct_ghl_${made.ghlContactId}`;
      const fullName = [b.details?.firstName, b.details?.lastName].filter(Boolean).join(" ").trim() || personName;
      const { error } = await supabaseAdmin.from("contacts").upsert({
        id: contactId, client_id: made.subClientId, name: fullName, email, ghl_contact_id: made.ghlContactId,
        ...(b.details?.phone ? { phone: b.details.phone } : {}), ...(b.details?.companyName ? { company_name: b.details.companyName } : {}),
      }, { onConflict: "id" });
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
  await supabaseAdmin.from("messages").update({ contact_id: contactId, client_id: clientId }).in("id", ids);
  if (email && caller.memberId) {
    await supabaseAdmin.from("messages").update({ contact_id: contactId, client_id: clientId })
      .is("contact_id", null).eq("mailbox_member_id", caller.memberId).eq("peer_address", email);
  }
  if (conv?.id) await supabaseAdmin.from("messages").update({ contact_id: contactId, client_id: clientId }).is("contact_id", null).eq("ghl_conversation_id", conv.id);
  return NextResponse.json({ ok: true, clientId, contactId });
}
