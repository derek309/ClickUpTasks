// The person's time zone for a meeting request, asked of the server when the
// draft is made (it reads GoHighLevel's timezone, state, ZIP and phone). Two
// seconds at most: past that, or on any failure, the state and phone we
// already hold decide, and with neither the request stays Pacific only.
import { authedFetch } from "@/lib/supabase";
import { resolveTimeZone } from "@/lib/meetingTimes";

type Who = { ghlContactId?: string | null; state?: string | null; phone?: string | null } | null | undefined;

const known = new Map<string, string | null>();

export async function theirTimeZone(who: Who, waitMs = 2000): Promise<string | null> {
  const local = () => resolveTimeZone({ state: who?.state, phone: who?.phone })?.timeZone ?? null;
  const id = who?.ghlContactId?.trim();
  if (!id) return local();
  if (known.has(id)) return known.get(id) ?? local();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), waitMs);
  try {
    const r = await authedFetch(`/api/ghl/contact-time-zone?contactId=${encodeURIComponent(id)}`, { signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return local();
    const tz = typeof j.timeZone === "string" && j.timeZone ? (j.timeZone as string) : null;
    known.set(id, tz);
    return tz ?? local();
  } catch {
    return local();
  } finally {
    clearTimeout(timer);
  }
}
