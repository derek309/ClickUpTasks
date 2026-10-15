// SERVER-ONLY. The GoHighLevel numbers we can text from, in every connected
// sub account (lib/textFrom has the rule for which one a text uses).
//
// GET /phone-system/numbers/location/{locationId} (Version 2021-07-28, scope
// phonenumbers.read) lists a location's numbers; only ones that can send a
// text are kept. The sub account's name comes from GET /locations/{id}
// (locations.readonly), else from its row on the Clients board. A location
// whose token lacks the scope says so, rather than failing the whole list.
// Kept for an hour: numbers rarely change, and every text send reads it.
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { phoneKey, type TextAccount, type TextNumber } from "@/lib/textFrom";

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = "https://services.leadconnectorhq.com";
const HOUR = 60 * 60 * 1000;

let cache: { at: number; ttl: number; accounts: TextAccount[] } | null = null;
let inflight: Promise<TextAccount[]> | null = null;

/** Every sub account and its text numbers. Never holds or returns a token. */
export async function listTextAccounts(opts: { fresh?: boolean; now?: number } = {}): Promise<TextAccount[]> {
  const now = opts.now ?? Date.now();
  if (!opts.fresh && cache && now - cache.at < cache.ttl) return cache.accounts;
  inflight ??= readAccounts().finally(() => { inflight = null; });
  const accounts = await inflight;
  // A list where nothing came back is kept for five minutes, not the hour, so
  // a fixed token is picked up soon without asking on every send.
  cache = { at: now, ttl: accounts.some((a) => a.numbers.length) ? HOUR : 5 * 60 * 1000, accounts };
  return accounts;
}

/** Every number we can text from, across the sub accounts. */
export async function listTextNumbers(opts: { fresh?: boolean } = {}): Promise<TextNumber[]> {
  return (await listTextAccounts(opts)).flatMap((a) => a.numbers);
}

/** For tests: forget the hour's list. */
export function clearTextNumberCache() { cache = null; inflight = null; }

async function readAccounts(): Promise<TextAccount[]> {
  const locations = await configuredLocations();
  const [boardNames, people] = await Promise.all([clientBoardNames(locations), teamByGhlUser()]);
  const out = await Promise.all(locations.map(async (locationId): Promise<TextAccount> => {
    const token = await tokenForLocation(locationId);
    const fallbackName = boardNames.get(locationId) ?? locationId;
    if (!token) return { locationId, name: fallbackName, numbers: [], error: "No GoHighLevel token for this sub account." };
    const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" };
    const [name, listed] = await Promise.all([locationName(locationId, headers), readNumbers(locationId, headers)]);
    const accountName = name ?? fallbackName;
    if ("error" in listed) return { locationId, name: accountName, numbers: [], error: listed.error };
    const numbers = listed.numbers
      .filter((n) => typeof n?.phoneNumber === "string" && phoneKey(n.phoneNumber).length >= 10)
      // A number that says it cannot text is left out; one that says nothing is kept.
      .filter((n) => n?.capabilities?.sms !== false)
      .map((n): TextNumber => ({
        number: n.phoneNumber as string,
        label: (typeof n.friendlyName === "string" && n.friendlyName.trim() && n.friendlyName.trim() !== n.phoneNumber ? n.friendlyName.trim() : null)
          ?? (typeof n.linkedUser === "string" && people.get(n.linkedUser) ? `${people.get(n.linkedUser)}'s line` : null),
        locationId, locationName: accountName,
        isDefault: n.isDefaultNumber === true,
      }));
    return { locationId, name: accountName, numbers };
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readNumbers(locationId: string, headers: Record<string, string>): Promise<{ numbers: any[] } | { error: string }> {
  try {
    const res = await fetch(`${API}/phone-system/numbers/location/${encodeURIComponent(locationId)}?pageSize=200`, { headers, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) return { error: "GoHighLevel won't list this account's numbers: its Private Integration needs Phone numbers (read) turned on." };
    if (res.status === 404) return { error: "This account has no phone system in GoHighLevel." };
    if (!res.ok) return { error: `GoHighLevel didn't list the numbers (${res.status}).` };
    const j = await res.json().catch(() => null);
    const list = Array.isArray(j?.numbers) ? j.numbers : Array.isArray(j?.data?.numbers) ? j.data.numbers : [];
    return { numbers: list };
  } catch {
    return { error: "GoHighLevel didn't answer in time." };
  }
}

async function locationName(locationId: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(`${API}/locations/${encodeURIComponent(locationId)}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const name = j?.location?.name ?? j?.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch { return null; }
}

/** The sub account rows on the Clients board ("Agency", "Directory"), by location. */
async function clientBoardNames(locations: string[]): Promise<Map<string, string>> {
  if (!locations.length) return new Map();
  const { data } = await supabaseAdmin.from("clients").select("ghl_location_id, name").in("ghl_location_id", locations);
  return new Map(((data ?? []) as any[]).filter((r) => r.name).map((r) => [r.ghl_location_id as string, r.name as string]));
}

/** GoHighLevel user id to the teammate's first name, for a number linked to someone. */
async function teamByGhlUser(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from("profiles").select("name, ghl_user_id").not("ghl_user_id", "is", null);
  return new Map(((data ?? []) as any[]).filter((r) => r.ghl_user_id && r.name).map((r) => [r.ghl_user_id as string, String(r.name).split(/\s+/)[0]]));
}

/** Our number on a contact's texts, newest first, for the default rule. Read
 *  without failing when supabase/message-our-number.sql has not run yet. */
export async function textHistory(scope: { contactId?: string | null; conversationId?: string | null }): Promise<{ channel: string; direction: string; at: string; ourNumber: string | null }[]> {
  if (!scope.contactId && !scope.conversationId) return [];
  let q = supabaseAdmin.from("messages").select("channel, direction, created_at, our_number").in("channel", ["sms", "call"]);
  q = scope.conversationId ? q.eq("ghl_conversation_id", scope.conversationId) : q.eq("contact_id", scope.contactId as string);
  const { data, error } = await q.not("our_number", "is", null).order("created_at", { ascending: false }).limit(20);
  if (error || !data) return [];
  return (data as any[]).map((r) => ({ channel: r.channel as string, direction: r.direction as string, at: r.created_at as string, ourNumber: (r.our_number as string | null) ?? null }));
}

/** A stored message row with our number on it, when there is one. Falls back
 *  to the row without it while the column does not exist yet, so a send is
 *  never lost to a missing column. */
export async function insertMessageRow(row: Record<string, unknown>): Promise<{ error: { message: string } | null }> {
  const { error } = await supabaseAdmin.from("messages").insert(row);
  if (error && "our_number" in row && /our_number/.test(error.message ?? "")) {
    const rest = { ...row };
    delete rest.our_number;
    return await supabaseAdmin.from("messages").insert(rest);
  }
  return { error };
}

/** Several rows at once, the same way: without our number if the column is missing. */
export async function insertMessageRows(rows: Record<string, unknown>[]): Promise<{ error: { message: string } | null }> {
  const { error } = await supabaseAdmin.from("messages").insert(rows);
  if (error && rows.some((r) => "our_number" in r) && /our_number/.test(error.message ?? "")) {
    return await supabaseAdmin.from("messages").insert(rows.map((r) => { const rest = { ...r }; delete rest.our_number; return rest; }));
  }
  return { error };
}
