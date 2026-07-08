import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(url && key);

// A single shared browser client. Falls back to placeholder values if env is
// missing so the app can still render a "set up your database" message.
export const supabase = createClient(url ?? "https://placeholder.supabase.co", key ?? "placeholder");

/** fetch() wrapper that attaches the signed-in user's JWT for our API routes. */
export async function authedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return fetch(input, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
}
