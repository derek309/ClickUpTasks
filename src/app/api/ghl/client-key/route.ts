import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/serverAuth";
import { locationFromSaasUrl } from "@/lib/saasUrl";

// An admin sets a client's own GoHighLevel key, for that client's website
// (the "GoHighLevel key" line under SaaS account on a task). Stored in
// client_ghl_keys, never ghl_tokens: everything there is treated as one of
// ours (the message pull, calendars, lookups that try every key), so a
// client's key there would pull their customers into the team Inbox.
// The sub account is the one in the client's SaaS link; never Agency or
// Directory. The key is checked against GoHighLevel before it's saved and
// is never sent back to the browser. (2026-10-11)
const noStore = { "Cache-Control": "no-store" };

async function clientSubAccount(clientId: string): Promise<{ name: string; locationId: string | null; shared: boolean } | null> {
  if (!clientId.startsWith("cl_")) return null;
  const { data: client } = await supabaseAdmin.from("clients").select("id, name, linked_contact_id").eq("id", clientId).is("deleted_at", null).maybeSingle();
  if (!client) return null;
  const contactId = (client.linked_contact_id as string | null) || clientId.slice(3);
  const { data: contact } = await supabaseAdmin.from("contacts").select("saas_url").eq("id", contactId).maybeSingle();
  const locationId = locationFromSaasUrl(contact?.saas_url as string | null);
  if (!locationId) return { name: client.name as string, locationId: null, shared: false };
  const { data: shared } = await supabaseAdmin.from("clients").select("id").not("id", "like", "cl_%").eq("ghl_location_id", locationId).limit(1);
  return { name: client.name as string, locationId, shared: !!shared?.length };
}

/** Whether this client has a key, and for which sub account. Never the key. */
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = (req.nextUrl.searchParams.get("client_id") ?? "").trim();
  const sub = await clientSubAccount(clientId);
  if (!sub) return NextResponse.json({ locationId: null, connected: false }, { headers: noStore });
  const { data: key } = await supabaseAdmin.from("client_ghl_keys").select("location_id, updated_at").eq("client_id", clientId).maybeSingle();
  return NextResponse.json({
    locationId: sub.locationId, shared: sub.shared,
    connected: !!key && key.location_id === sub.locationId,
    // A key saved for an older SaaS link: say so rather than use it.
    stale: !!key && key.location_id !== sub.locationId,
    updatedAt: key?.updated_at ?? null,
  }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { client_id, token } = (await req.json().catch(() => ({}))) as { client_id?: string; token?: string };
  const key = String(token ?? "").trim();
  if (!client_id || !key) return NextResponse.json({ error: "A client and a key are both needed." }, { status: 400 });
  const sub = await clientSubAccount(client_id);
  if (!sub) return NextResponse.json({ error: "Only a client's own sub account can have a key here." }, { status: 400 });
  if (!sub.locationId) return NextResponse.json({ error: `Add ${sub.name}'s SaaS link first: the key is for the sub account it points at.` }, { status: 400 });
  if (sub.shared) return NextResponse.json({ error: "That SaaS link points at a shared sub account (Agency or Directory), not the client's own." }, { status: 400 });

  // Check it really opens that sub account before keeping it.
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(sub.locationId)}&limit=1`,
    { headers: { Authorization: `Bearer ${key}`, Version: "2021-07-28", Accept: "application/json" } });
  if (!res.ok) return NextResponse.json({ error: `GoHighLevel didn't accept that key for ${sub.name}'s sub account (${res.status}).` }, { status: 400 });

  const { error } = await supabaseAdmin.from("client_ghl_keys").upsert({ client_id, location_id: sub.locationId, token: key, created_by: admin.memberId, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: /client_ghl_keys/.test(error.message) ? "Run supabase/client-ghl-keys.sql first." : error.message }, { status: 400 });
  return NextResponse.json({ ok: true, locationId: sub.locationId }, { headers: noStore });
}

export async function DELETE(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = (req.nextUrl.searchParams.get("client_id") ?? "").trim();
  if (!clientId) return NextResponse.json({ error: "client_id is required." }, { status: 400 });
  const { error } = await supabaseAdmin.from("client_ghl_keys").delete().eq("client_id", clientId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
