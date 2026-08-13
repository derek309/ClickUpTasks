// Shared verification for the WordPress<->ClickUpTasks shared-secret bridge
// (X-ClickUpTasks-Key / CLICKUPTASKS_API_KEY). The WP side of this bridge
// already uses hash_equals() (sales-tool.php's cul_sales_clickuptasks_key_ok);
// this is the equivalent timing-safe check for the Node side, which every
// inbound route until now compared with a plain !== (fine when the bridge
// was read-only/fire-and-forget, worth tightening now that it's gaining
// write capability via the Playbook toggle route).
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

export function verifyClickUpTasksKey(req: NextRequest): boolean {
  // Both sides trimmed. An env var set through a shell (`echo` into `vercel
  // env add`) carries a trailing newline that is invisible everywhere except
  // a byte comparison, and HTTP strips trailing whitespace from header values
  // in transit. That asymmetry made the bridge work in one direction and fail
  // in the other on 2026-08-12: WordPress matched the clean header against its
  // own clean wp-config value, while this side compared an env copy one byte
  // longer and bailed on the length guard below, reporting a key mismatch for
  // two values that are in fact the same secret.
  const expected = (process.env.CLICKUPTASKS_API_KEY || "").trim();
  const sent = (req.headers.get("x-clickuptasks-key") || "").trim();
  if (!expected || !sent) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(sent);
  // timingSafeEqual throws on a length mismatch rather than returning false —
  // guard it explicitly instead of letting an attacker's short/long guess 500.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
