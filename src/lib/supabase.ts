import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(url && key);

// A single shared browser client. Falls back to placeholder values if env is
// missing so the app can still render a "set up your database" message.
export const supabase = createClient(url ?? "https://placeholder.supabase.co", key ?? "placeholder");
