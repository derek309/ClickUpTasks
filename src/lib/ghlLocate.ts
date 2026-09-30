// SERVER-ONLY. Which GoHighLevel sub-account a contact actually lives in.
//
// Not from clients.ghl_location_id: that field is a real location id on the
// sub-account rows, and on ordinary clients it has been repurposed to hold
// the company name shown on the Clients board ("BibBoards", "eXp Realty").
//
// A Private Integration token is scoped to one location and GET /contacts/{id}
// takes no location, so asking each connected token in turn and seeing which
// one knows the contact identifies the location. Read-only, so trying several
// is harmless. First written for /api/ghl/backfill-conversations; shared now
// with the 15 minute pull.
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";

export type TokenHealth = { locationId: string; ok: boolean; status: number };

export function createLocator() {
  const cache = new Map<string, string | null>();
  let locations: Promise<string[]> | null = null;
  // Tokens GoHighLevel rejected this run (401): not asked again.
  const rejected = new Set<string>();

  async function locationForContact(ghlContactId: string): Promise<string | null> {
    if (cache.has(ghlContactId)) return cache.get(ghlContactId)!;
    locations ??= configuredLocations();
    for (const loc of await locations) {
      if (rejected.has(loc)) continue;
      const token = await tokenForLocation(loc);
      if (!token) continue;
      try {
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(ghlContactId)}`, {
          headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 401) { rejected.add(loc); continue; }
        // A 404 means this location genuinely does not have the contact, so
        // keep asking. Anything else is inconclusive and also worth moving on
        // from — the next run will try again.
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.contact) { cache.set(ghlContactId, loc); return loc; }
        }
      } catch { /* network or timeout: treat as not found here */ }
    }
    cache.set(ghlContactId, null);
    return null;
  }
  return { locationForContact };
}

/** Whether GoHighLevel still accepts each stored token. A rejected token is
 *  the quiet way this whole pull stops working (the Agency token was found
 *  rejected on 2026-09-30), so Settings shows it. */
export async function tokenHealth(): Promise<TokenHealth[]> {
  const locations = await configuredLocations();
  return Promise.all(locations.map(async (locationId) => {
    const token = await tokenForLocation(locationId);
    if (!token) return { locationId, ok: false, status: 0 };
    try {
      const res = await fetch(`https://services.leadconnectorhq.com/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=1`, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      return { locationId, ok: res.ok, status: res.status };
    } catch {
      return { locationId, ok: false, status: 0 };
    }
  }));
}
