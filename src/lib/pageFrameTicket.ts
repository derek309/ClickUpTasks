// SERVER ONLY. The short lived ticket in a web page review's frame URL
// (/page-frame/[ticket]). The frame's own address is readable by the page's
// scripts, so it must never hold the client's document link or anything else
// worth stealing: a ticket only opens that one page file, for 30 minutes.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const FRAME_TICKET_TTL_MS = 30 * 60_000;
export const FRAME_TICKET_PATTERN = /^pf_[A-Za-z0-9_-]{16,400}\.[A-Za-z0-9_-]{43}$/;

// Its own key, derived from a server secret with a label so it can never be used
// as, or mistaken for, the key it came from. TOKEN_ENC_KEY is set in production;
// a local .env.local only has the service role key.
function signingKey(): Buffer | null {
  const secret = process.env.TOKEN_ENC_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return secret ? createHash("sha256").update(`page-frame:${secret}`).digest() : null;
}

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/** A ticket for one page file on one document, or null when no secret is set. */
export function mintFrameTicket(documentId: string, fileId: string, now = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = Buffer.from(JSON.stringify({ d: documentId, f: fileId, e: now + FRAME_TICKET_TTL_MS })).toString("base64url");
  return `pf_${payload}.${sign(key, payload)}`;
}

/** What a ticket opens, or null for a bad shape, a wrong signature or an expired one. */
export function readFrameTicket(ticket: string, now = Date.now()): { documentId: string; fileId: string } | null {
  if (!FRAME_TICKET_PATTERN.test(ticket)) return null;
  const key = signingKey();
  if (!key) return null;
  const [payload, mac] = ticket.slice(3).split(".");
  const expected = Buffer.from(sign(key, payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { d, f, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { d?: unknown; f?: unknown; e?: unknown };
    if (typeof d !== "string" || typeof f !== "string" || typeof e !== "number" || e <= now) return null;
    return { documentId: d, fileId: f };
  } catch {
    return null;
  }
}
