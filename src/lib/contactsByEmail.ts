// SERVER-ONLY: every contact that has an email, keyed by its trimmed, lower
// case address (first contact wins when two share one). Used to match an
// outside email or meeting attendee to a known contact.
//
// Paged because PostgREST stops a single response at 1000 rows with no error,
// and there are 3,500+ contacts: one plain select matched only the first 1000,
// so replies from everyone else were treated as unknown senders.
import { supabaseAdmin } from "./supabaseAdmin";

const PAGE = 1000;

export async function contactsByEmail<T extends { email?: string | null }>(columns: string): Promise<Map<string, T>> {
  const byEmail = new Map<string, T>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("contacts").select(columns).not("email", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`contacts lookup failed: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    for (const c of rows) {
      const e = (c.email ?? "").trim().toLowerCase();
      if (e && !byEmail.has(e)) byEmail.set(e, c);
    }
    // Stop on an empty page, not a short one, so a project whose row cap is
    // set below 1000 still pages to the end.
    if (rows.length === 0) break;
  }
  return byEmail;
}
