import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "./supabaseAdmin";

// Rate limiting for the public /api/waiting/[token]/* routes — token-gated
// but otherwise unauthenticated, so nothing else stops a scripted loop once
// a share link leaks.
//
// Store: Postgres, via the increment_rate_limit() function in
// supabase/waiting-rate-limit.sql. There is no Upstash/Vercel KV binding on
// this project, and an in-memory counter would be per-lambda (therefore
// near useless on Vercel), so the database the app already talks to is the
// only real shared store available.
//
// Scheme: fixed windows. The counter key embeds floor(now / windowMs), so
// every key is self-expiring and the SQL function's own sweep of rows older
// than an hour is all the cleanup needed. The known tradeoff of fixed (vs.
// sliding) windows is that a burst straddling a boundary can briefly pass up
// to 2x the limit; that is fine at these magnitudes. IMPORTANT: every window
// below must stay well under that 1-hour sweep, or a long window's rows get
// deleted mid-window and the counter silently resets.

export type WaitingAction = "read" | "message" | "respond" | "status" | "request" | "upload";

type Rule = {
  /** Max requests per window for one token+IP pair. */
  limit: number;
  windowMs: number;
  /** Optional second cap across ALL IPs using the same share token. Only
   *  worth the extra round trip on the routes with a real per-call cost, and
   *  it is what stops an attacker from multiplying their budget by rotating
   *  IPs while holding one leaked token. Set generously: a client org can
   *  legitimately have several people on different networks on one link. */
  tokenLimit?: number;
};

const MINUTE = 60_000;

// Limits are sized off what each route actually COSTS when abused, then set
// several times above the heaviest realistic client session:
//
//  read     Cheap reads, but WaitingView polls this every 15s while the tab
//           is visible (= 40/10min) and re-loads after every send. 150 leaves
//           roughly 3x headroom over that natural ceiling — enough for two
//           tabs open plus a busy send/reload cycle — while still cutting a
//           scraper to 15/min instead of unbounded.
//  message  DB insert + a notification row + an OUTBOUND EMAIL to the team
//  respond  (notifyTeamOfClientActivity). Per-call cost lands in a human's
//  status   inbox, so these are the inbox-flooding vector. 20/10min is one
//           every 30s sustained, far above real typing, and caps the blast.
//  request  Same email cost PLUS it creates a real task (and possibly a
//           project) on the team's board. Board pollution is the expensive
//           part. 10/30min is still more new requests than any real client
//           raises in a sitting.
//  upload   Up to 25MB of permanent storage per call, the only route with an
//           unbounded money cost. 25/30min covers a client dragging in a
//           batch of screenshots and stays far above the 2-3 files a normal
//           session sends.
export const RATE_LIMITS: Record<WaitingAction, Rule> = {
  read:    { limit: 150, windowMs: 10 * MINUTE },
  message: { limit: 20,  windowMs: 10 * MINUTE },
  respond: { limit: 20,  windowMs: 10 * MINUTE },
  status:  { limit: 20,  windowMs: 10 * MINUTE },
  request: { limit: 10,  windowMs: 30 * MINUTE, tokenLimit: 30 },
  upload:  { limit: 25,  windowMs: 30 * MINUTE, tokenLimit: 60 },
};

/** Seconds until the current fixed window rolls over — exact for this
 *  scheme, so Retry-After tells the caller the truth rather than a guess. */
export function retryAfterSeconds(windowMs: number, now: number = Date.now()): number {
  return Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Increment one counter and return its new value, or null if the store
 *  itself failed. Null means "unknown", which callers treat as allowed. */
async function bump(key: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc("increment_rate_limit", { p_key: key });
  if (error) return null;
  return typeof data === "number" ? data : null;
}

/**
 * Returns a ready-to-send 429 response if the caller is over the limit for
 * this action, or null to let the request proceed.
 *
 * FAILS OPEN BY DESIGN. If the Postgres call errors, bump() returns null and
 * the over-limit comparisons below are skipped, so the request is allowed.
 * That is the deliberate choice: this limiter guards against abuse of a
 * public endpoint, it is not an authorization boundary (the share token is).
 * A limiter outage locking real clients out of their own page would be a
 * worse, more visible failure than briefly letting an abuser through.
 */
export async function rateLimit(req: NextRequest, token: string, action: WaitingAction): Promise<NextResponse | null> {
  const rule = RATE_LIMITS[action];
  const bucket = Math.floor(Date.now() / rule.windowMs);
  const ip = clientIp(req);

  // Both counters in one round trip. The action is part of the key so a
  // chatty poll on `read` can never starve the budget a client needs to
  // actually send a message or upload a file.
  const [perIp, perToken] = await Promise.all([
    bump(`${action}:${token}:${ip}:${bucket}`),
    rule.tokenLimit === undefined ? Promise.resolve(null) : bump(`${action}:${token}:all:${bucket}`),
  ]);

  const overIp = perIp !== null && perIp > rule.limit;
  const overToken = rule.tokenLimit !== undefined && perToken !== null && perToken > rule.tokenLimit;
  if (!overIp && !overToken) return null;

  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rule.windowMs)) } },
  );
}
