import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isGhlContactVisible } from "@/lib/extensionApi";
import { escapeLike } from "@/lib/inboxServer";
import { readPerson, savePerson, phoneKey, type PersonExtraKey, type PersonDetails } from "@/lib/ghlPerson";
import { mergeExtraEmails, missingExtraColumn } from "@/lib/contactEmails";
import { rowToContact } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const maxDuration = 30;

// The people cards in the Inbox (Derek, 2026-10-02).
// GET ?contactId=ct_…            the contact as GoHighLevel holds it
// GET ?email=…&phone=…           contacts that already have that email or
//                                phone, so a new person is not added twice
// POST { contactId, details }    save the changes to GoHighLevel, then here
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;

  const contactId = sp.get("contactId");
  if (contactId) {
    const { data: c } = await supabaseAdmin.from("contacts").select("id, ghl_contact_id").eq("id", contactId).maybeSingle();
    if (!c?.ghl_contact_id) return NextResponse.json({ error: "Not in GoHighLevel." }, { status: 404 });
    if (!(await isGhlContactVisible(caller, c.ghl_contact_id as string))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const got = await readPerson(c.ghl_contact_id as string);
    if (!got) return NextResponse.json({ error: "GoHighLevel didn't send this contact." }, { status: 502 });
    // Opening them is a resync (Derek, 2026-10-07: an email changed in
    // GoHighLevel kept showing the old one here), so our copy follows.
    const contact = await syncFromGhl(contactId, got.details);
    return NextResponse.json({ details: got.details, contact, ghlUrl: `https://app.gohighlevel.com/v2/location/${got.locationId}/contacts/detail/${c.ghl_contact_id}` });
  }

  // Duplicates: the same email, or the same phone however it is written.
  const email = (sp.get("email") ?? "").trim().toLowerCase();
  const phone = phoneKey(sp.get("phone"));
  const found = new Map<string, any>();
  if (email.includes("@")) {
    const { data } = await supabaseAdmin.from("contacts").select("id, name, email, phone, client_id").ilike("email", escapeLike(email)).limit(5);
    for (const r of data ?? []) found.set(r.id as string, r);
  }
  if (phone.length === 10) {
    const { data } = await supabaseAdmin.from("contacts").select("id, name, email, phone, client_id").ilike("phone", `%${phone.slice(-4)}%`).limit(200);
    for (const r of data ?? []) if (phoneKey(r.phone as string) === phone) found.set(r.id as string, r);
  }
  const subIds = [...new Set([...found.values()].map((r) => r.client_id as string).filter(Boolean))];
  const { data: subs } = subIds.length ? await supabaseAdmin.from("clients").select("id, name").in("id", subIds) : { data: [] as any[] };
  const subName = new Map((subs ?? []).map((s: any) => [s.id as string, s.name as string]));
  return NextResponse.json({
    matches: [...found.values()].slice(0, 5).map((r) => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, where: subName.get(r.client_id) ?? null,
      sameEmail: !!email && (r.email ?? "").toLowerCase() === email,
    })),
  });
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { contactId?: string; details?: Record<string, unknown> };
  const { data: c } = await supabaseAdmin.from("contacts").select("id, ghl_contact_id").eq("id", b.contactId ?? "-").maybeSingle();
  if (!c?.ghl_contact_id) return NextResponse.json({ error: "Not in GoHighLevel." }, { status: 404 });
  if (!(await isGhlContactVisible(caller, c.ghl_contact_id as string))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const d = b.details ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : undefined);
  const email = str(d.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  const extras: Partial<Record<PersonExtraKey, string>> = {};
  const rawExtras = (d.extras ?? {}) as Record<string, unknown>;
  for (const k of ["title", "facebook", "instagram", "linkedin"] as const) { const v = str(rawExtras[k]); if (v !== undefined) extras[k] = v; }
  const saved = await savePerson(c.ghl_contact_id as string, {
    firstName: str(d.firstName), lastName: str(d.lastName), companyName: str(d.companyName),
    email, phone: str(d.phone), website: str(d.website), extras,
  });
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 502 });
  const again = await readPerson(c.ghl_contact_id as string).catch(() => null);
  return NextResponse.json({ ok: true, contact: again ? await syncFromGhl(c.id as string, again.details) : null });
}

/** Our copy of the contact, brought up to what GoHighLevel holds: name, main
 *  email, phone, company and their other addresses (contactEmails.ts). */
async function syncFromGhl(contactId: string, d: PersonDetails) {
  const { data: had } = await supabaseAdmin.from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!had) return null;
  const name = [d.firstName, d.lastName].filter(Boolean).join(" ").trim();
  const row = {
    ...(name ? { name } : {}), ...(d.email ? { email: d.email } : {}), phone: d.phone || null, company_name: d.companyName || null,
  };
  const extra = { additional_emails: mergeExtraEmails(d.email || had.email, had.email, had.additional_emails, d.additionalEmails ?? []) };
  let { data, error } = await supabaseAdmin.from("contacts").update({ ...row, ...extra }).eq("id", contactId).select().maybeSingle();
  if (missingExtraColumn(error)) ({ data, error } = await supabaseAdmin.from("contacts").update(row).eq("id", contactId).select().maybeSingle());
  return !error && data ? rowToContact(data) : rowToContact(had);
}
