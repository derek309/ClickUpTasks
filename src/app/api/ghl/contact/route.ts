import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireAdmin } from "@/lib/serverAuth";
import { rowToContact } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Re-pulls one contact's name/email/phone/company/city/state from
// GoHighLevel on demand — the bulk sync (../sync/route.ts) re-syncs an
// entire sub-account (a big Directory location is ~30 sequential GHL API
// calls), which is overkill when someone just wants to check whether a
// single contact's info changed. Admin-gated, matching contacts write
// being admin-only everywhere else in this app.
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { contactId, locationId, ghlContactId } = await req.json().catch(() => ({} as any));
  if (!contactId || !locationId || !ghlContactId)
    return NextResponse.json({ error: "Missing contactId, locationId, or ghlContactId." }, { status: 400 });

  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(ghlContactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!res.ok) { const text = await res.text().catch(() => ""); return NextResponse.json({ error: `GoHighLevel API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 }); }
  const json = await res.json();
  const c = json?.contact;
  if (!c) return NextResponse.json({ error: "Contact not found in GoHighLevel." }, { status: 404 });

  const row = {
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || c.email || "Unnamed contact",
    email: c.email ?? "",
    phone: c.phone ?? null,
    company_name: c.companyName ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
  };
  const { data, error } = await supabaseAdmin.from("contacts").update(row).eq("id", contactId).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Contact not found locally." }, { status: 404 });
  return NextResponse.json({ contact: rowToContact(data) });
}
