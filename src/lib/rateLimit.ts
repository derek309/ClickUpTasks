import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const WINDOW_MS = 10 * 60 * 1000;

// Postgres-backed rate limiting (see supabase/waiting-rate-limit.sql) for the
// public /api/waiting/[token]/* routes — token-gated but otherwise
// unauthenticated, so nothing else stops a scripted loop. Fails open (allows
// the request) if the DB call itself errors, so a rate-limit bug never takes
// down the public page for real clients.
export async function isRateLimited(req: NextRequest, token: string, limit = 20): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const key = `${token}:${ip}:${bucket}`;
  const { data, error } = await supabaseAdmin.rpc("increment_rate_limit", { p_key: key });
  if (error) return false;
  return (data as number) > limit;
}
