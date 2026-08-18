import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(url && key);

// Retries a request through a transient gateway blip (502/503/504, or a
// network-level throw) before giving up — 2026-08-17: Supabase's API Gateway
// sat in a degraded state for hours, and every read/write in this app is
// otherwise one-shot. A write that failed silently reverted to whatever was
// last in the DB the next time that row got refetched (a client-facing
// symptom that looked exactly like "the date I set just goes back to the old
// one" — see Melissa Lamberti's follow-up date). Reads get the same benefit
// for free, which also means a failed row-count check (db.ts fetchAllRows)
// is less likely to need its own unknown-size-paging fallback in the first
// place. Only retries on retryable status codes / thrown errors — a real 4xx
// (bad request, RLS rejection) fails immediately, same as before.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;
async function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS) return res;
      lastError = res;
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  // Unreachable — the loop above always returns or throws on the final
  // attempt — but satisfies the compiler.
  throw lastError;
}

// A single shared browser client. Falls back to placeholder values if env is
// missing so the app can still render a "set up your database" message.
export const supabase = createClient(url ?? "https://placeholder.supabase.co", key ?? "placeholder", {
  global: { fetch: retryingFetch },
});

/** fetch() wrapper that attaches the signed-in user's JWT for our API routes. */
export async function authedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return fetch(input, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
}
