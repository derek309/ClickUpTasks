// SERVER-ONLY Supabase client using the service role key. Never import this
// into a client component — the service role key bypasses all row-level
// security and must never reach the browser.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const adminConfigured = Boolean(url && serviceKey);

export const supabaseAdmin = createClient(url, serviceKey || "placeholder", {
  auth: { autoRefreshToken: false, persistSession: false },
});
