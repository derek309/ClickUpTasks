import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation, configuredLocations } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Reads and writes a client's SaaS URL, which lives in GoHighLevel as the
// contact custom field "SaaS" (fieldKey contact.saas).
//
// GoHighLevel is the source of truth. The value is mirrored onto our
// contacts row so a list can show it without a GHL call per client, but every
// edit here goes to GHL first and the mirror is only updated once GHL has
// accepted it. A mirror that can silently disagree with the system of record
// is worse than no mirror.
//
// The field id differs per location and one of Derek's two locations does not
// define the field at all, so it is resolved by fieldKey at request time
// rather than hardcoded. Resolutions are cached for the life of the lambda:
// the definition changes about never, and re-fetching it on every keystroke
// would be a second round trip for nothing.

export const maxDuration = 30;

const FIELD_KEY = "contact.saas";
const fieldIdCache = new Map<string, string | null>();

async function saasFieldId(locationId: string, token: string): Promise<string | null> {
  if (fieldIdCache.has(locationId)) return fieldIdCache.get(locationId)!;
  const res = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null; // don't cache a failure; the next call can retry
  const j = await res.json();
  const hit = (j.customFields ?? []).find((f: any) => f?.fieldKey === FIELD_KEY);
  const id = hit?.id ?? null;
  fieldIdCache.set(locationId, id);
  return id;
}

// A Private Integration token is scoped to one location and GET /contacts/{id}
// takes no location, so the only way to find a contact's home is to try each
// configured token until one returns it. Read-only, so trying several is
// harmless — the same reasoning as ../contact/route.ts.
async function findContact(ghlContactId: string): Promise<{ locationId: string; token: string; contact: any } | null> {
  for (const locationId of await configuredLocations()) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    try {
      const res = await fetch(`https://services.leadconnectorhq.com/contacts/${ghlContactId}`, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      if (j?.contact?.id) return { locationId, token, contact: j.contact };
    } catch { /* try the next location */ }
  }
  return null;
}

function readSaas(contact: any, fieldId: string | null): string {
  for (const f of (contact?.customFields ?? []) as any[]) {
    if (f?.id === fieldId || f?.fieldKey === FIELD_KEY || f?.key === FIELD_KEY) {
      return typeof f.value === "string" ? f.value : (f.fieldValue ?? "");
    }
  }
  return "";
}

async function mirror(contactRowId: string, value: string) {
  if (!adminConfigured) return;
  await supabaseAdmin.from("contacts").update({ saas_url: value || null }).eq("id", contactRowId);
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const ghlContactId = typeof b.ghlContactId === "string" ? b.ghlContactId.trim() : "";
  const contactRowId = typeof b.contactId === "string" ? b.contactId.trim() : "";
  const write = typeof b.url === "string";
  if (!ghlContactId) return NextResponse.json({ error: "No contact." }, { status: 400 });

  const found = await findContact(ghlContactId);
  if (!found) return NextResponse.json({ error: "Couldn't find that contact in GoHighLevel." }, { status: 404 });
  const fieldId = await saasFieldId(found.locationId, found.token);

  if (!write) {
    const url = readSaas(found.contact, fieldId);
    if (contactRowId) await mirror(contactRowId, url);
    return NextResponse.json({ url, editable: !!fieldId });
  }

  if (!fieldId) {
    return NextResponse.json({ error: "This sub-account has no SaaS field in GoHighLevel yet, so there's nowhere to save it." }, { status: 501 });
  }

  // Normalized on the way in rather than on display: a bare "acme.com" typed
  // into the box should be a working link everywhere it is shown, including
  // inside GoHighLevel where we do not control the rendering.
  const raw = (b.url as string).trim();
  const url = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${ghlContactId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${found.token}`, Version: "2021-07-28",
      Accept: "application/json", "Content-Type": "application/json",
    },
    body: JSON.stringify({ customFields: [{ id: fieldId, value: url }] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return NextResponse.json({ error: `GoHighLevel API ${res.status}: ${t.slice(0, 240)}` }, { status: 502 });
  }
  if (contactRowId) await mirror(contactRowId, url);
  return NextResponse.json({ url, editable: true });
}
