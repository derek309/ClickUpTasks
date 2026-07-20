import { NextRequest, NextResponse } from "next/server";
import { requireApiToken } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Create a brand-new GoHighLevel contact under a chosen sub-account (from the
// extension's "+ Add as contact" button, when match-client found nothing to
// auto-select) — the one write path in the app that creates a GHL contact
// rather than only ever syncing one in. Also promotes it straight to a
// tracked Client (status: "lead"), mirroring addClientContact in Cockpit.tsx,
// so it's immediately selectable in the extension's client picker for task
// creation in the same session.
//
// Admin-only: this bloats a real CRM and can't be undone from here, unlike
// most other extension actions.

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller.role !== "admin") return NextResponse.json({ error: "Only admins can create new GoHighLevel contacts." }, { status: 403 });

  const { subAccountId, name, email } = await req.json().catch(() => ({}));
  if (!subAccountId || !String(name ?? "").trim())
    return NextResponse.json({ error: "Missing subAccountId or name." }, { status: 400 });

  const { data: sub } = await supabaseAdmin.from("clients").select("id, ghl_location_id").eq("id", subAccountId).maybeSingle();
  if (!sub?.ghl_location_id) return NextResponse.json({ error: "That sub-account has no GoHighLevel location configured." }, { status: 400 });

  const token = await tokenForLocation(sub.ghl_location_id);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  const cleanName = String(name).trim();
  const cleanEmail = String(email ?? "").trim();
  const [firstName, ...rest] = cleanName.split(/\s+/);

  let ghlRes: Response;
  try {
    ghlRes = await fetch("https://services.leadconnectorhq.com/contacts/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: sub.ghl_location_id, name: cleanName, firstName, lastName: rest.join(" ") || undefined, email: cleanEmail || undefined }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: `GoHighLevel request failed: ${String(e?.message ?? e)}` }, { status: 502 });
  }
  const ghlJson = await ghlRes.json().catch(() => ({} as any));
  if (!ghlRes.ok) return NextResponse.json({ error: ghlJson?.message || `GoHighLevel API ${ghlRes.status}` }, { status: 502 });
  const ghlContactId = ghlJson.contact?.id;
  if (!ghlContactId) return NextResponse.json({ error: "GoHighLevel didn't return a contact id." }, { status: 502 });

  // Same id convention the GHL sync route uses (ghl/sync/route.ts) so this
  // contact is indistinguishable from one that arrived via the normal sync.
  const contactId = `ct_ghl_${ghlContactId}`;
  const clientId = `cl_${contactId}`;

  const { error: contactErr } = await supabaseAdmin.from("contacts").upsert({
    id: contactId, client_id: subAccountId, name: cleanName, email: cleanEmail, phone: null,
    ghl_contact_id: ghlContactId, company_name: null, city: null, state: null,
  });
  if (contactErr) return NextResponse.json({ error: `Contact created in GoHighLevel but failed to save locally: ${contactErr.message}` }, { status: 500 });

  const { error: clientErr } = await supabaseAdmin.from("clients").upsert({
    id: clientId, name: cleanName, color: "#a855f7", ghl_location_id: "", status: "lead", type: "client", assigned_to: [],
  });
  if (clientErr) return NextResponse.json({ error: `Contact saved but couldn't be promoted to a client: ${clientErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, contactId, clientId, name: cleanName });
}
