// SERVER ONLY. A person's details as GoHighLevel holds them, for the Inbox's
// people cards (Derek, 2026-10-02: click a name to see and change a contact,
// saved to GoHighLevel). Name, company, email, phone and website are standard
// contact fields; job title and socials are custom fields in each
// sub-account, found by their names, so only the ones a sub-account has are
// offered.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation, configuredLocations } from "@/lib/ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = "https://services.leadconnectorhq.com";
const HEADERS = (token: string) => ({ Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" });

export type PersonExtraKey = "title" | "facebook" | "instagram" | "linkedin";
export const EXTRA_MATCH: Record<PersonExtraKey, RegExp> = {
  title: /^(job ?title|title|position|role)$/i,
  facebook: /facebook/i,
  instagram: /instagram/i,
  linkedin: /linked ?in/i,
};
export type PersonDetails = {
  firstName: string; lastName: string; companyName: string; email: string; phone: string; website: string;
  /** The custom fields this sub-account has, with their values. */
  extras: { key: PersonExtraKey; id: string; label: string; value: string }[];
};

// Re-read every 10 minutes, so a field added in GoHighLevel shows up soon.
const fieldCache = new Map<string, { at: number; fields: { key: PersonExtraKey; id: string; label: string }[] }>();
/** This sub-account's job title and social fields, by name. */
export async function extraFields(locationId: string, token: string): Promise<{ key: PersonExtraKey; id: string; label: string }[]> {
  const hit = fieldCache.get(locationId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.fields;
  const res = await fetch(`${API}/locations/${encodeURIComponent(locationId)}/customFields`, { headers: HEADERS(token), signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) return [];
  const all: any[] = (await res.json().catch(() => null))?.customFields ?? [];
  const out: { key: PersonExtraKey; id: string; label: string }[] = [];
  for (const key of Object.keys(EXTRA_MATCH) as PersonExtraKey[]) {
    const f = all.find((x) => x?.model !== "opportunity" && EXTRA_MATCH[key].test(String(x?.name ?? "")));
    if (f?.id) out.push({ key, id: f.id as string, label: String(f.name) });
  }
  fieldCache.set(locationId, { at: Date.now(), fields: out });
  return out;
}

/** The sub-account a contact lives in, then its token. */
export async function contactHome(ghlContactId: string): Promise<{ locationId: string; token: string } | null> {
  const { data: row } = await supabaseAdmin.from("contacts").select("client_id").eq("ghl_contact_id", ghlContactId).limit(1).maybeSingle();
  const { data: sub } = row?.client_id ? await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", row.client_id).maybeSingle() : { data: null };
  const home = (sub?.ghl_location_id as string | null) || null;
  const all = await configuredLocations();
  for (const locationId of home && all.includes(home) ? [home, ...all.filter((l) => l !== home)] : all) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    const res = await fetch(`${API}/contacts/${encodeURIComponent(ghlContactId)}`, { headers: HEADERS(token), signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (res?.ok) return { locationId, token };
  }
  return null;
}

export async function readPerson(ghlContactId: string): Promise<{ details: PersonDetails; locationId: string } | null> {
  const home = await contactHome(ghlContactId);
  if (!home) return null;
  const res = await fetch(`${API}/contacts/${encodeURIComponent(ghlContactId)}`, { headers: HEADERS(home.token), signal: AbortSignal.timeout(8000) });
  const c: any = (await res.json().catch(() => null))?.contact;
  if (!c) return null;
  const fields = await extraFields(home.locationId, home.token);
  const valueOf = (id: string) => {
    const f = ((c.customFields ?? []) as any[]).find((x) => x?.id === id);
    return typeof f?.value === "string" ? f.value : String(f?.fieldValue ?? "");
  };
  return {
    locationId: home.locationId,
    details: {
      firstName: c.firstName ?? "", lastName: c.lastName ?? "", companyName: c.companyName ?? "",
      email: c.email ?? "", phone: c.phone ?? "", website: c.website ?? "",
      extras: fields.map((f) => ({ ...f, value: valueOf(f.id) })),
    },
  };
}

/** The changes, into GoHighLevel first; our copy follows once it took them. */
export async function savePerson(ghlContactId: string, d: Partial<Omit<PersonDetails, "extras">> & { extras?: Partial<Record<PersonExtraKey, string>> }): Promise<{ ok: true } | { error: string }> {
  const home = await contactHome(ghlContactId);
  if (!home) return { error: "GoHighLevel doesn't know this contact." };
  const fields = await extraFields(home.locationId, home.token);
  const customFields = fields.filter((f) => d.extras && f.key in d.extras).map((f) => ({ id: f.id, value: d.extras![f.key] ?? "" }));
  const body: Record<string, unknown> = {};
  for (const k of ["firstName", "lastName", "companyName", "email", "phone", "website"] as const) if (d[k] !== undefined) body[k] = d[k];
  if (customFields.length) body.customFields = customFields;
  const res = await fetch(`${API}/contacts/${encodeURIComponent(ghlContactId)}`, {
    method: "PUT", headers: { ...HEADERS(home.token), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { error: `GoHighLevel didn't save it (${res.status}). ${t.slice(0, 160)}` };
  }
  const name = [d.firstName, d.lastName].filter((x) => x !== undefined).join(" ").trim();
  await supabaseAdmin.from("contacts").update({
    ...(name ? { name } : {}), ...(d.email !== undefined ? { email: d.email || null } : {}),
    ...(d.phone !== undefined ? { phone: d.phone || null } : {}), ...(d.companyName !== undefined ? { company_name: d.companyName || null } : {}),
  }).eq("ghl_contact_id", ghlContactId);
  return { ok: true };
}

/** Same last ten digits, written any way. */
export const phoneKey = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
