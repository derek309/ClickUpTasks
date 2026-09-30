// Pairing a GoHighLevel message with the row the app already has for it.
//
// GoHighLevel is the record of every client conversation, and each teammate's
// Gmail two way sync files a copy of their email there. The app stores the
// same email from Gmail first, so when the GoHighLevel pull reads it back the
// two have to be recognised as one message: the GoHighLevel id is stamped on
// the existing row (which is also what "confirmed in GoHighLevel" means)
// instead of a second copy being inserted.
//
// GoHighLevel gives no header that ties its copy to Gmail's (checked live
// 2026-09-30: the email detail has its own id, threadId and provider, no
// Message-ID), so the pairing is by content and time. Measured on live data
// the same day: every real pair landed 0 to 40 seconds apart, and the nearest
// unrelated email from the same contact was 381 seconds away. Bodies often
// differ in detail (GoHighLevel keeps "&lt;", Outlook's VML junk, a quoted
// chain cut differently), so the first 60 normalised characters OR the
// subject without Re/Fw is enough, inside a 120 second window.
//
// Pure, no server imports: shared by the pull, the Gmail ingest and tests.

/* Collapses an email or text to comparable text. Also the key the older
   outbound dedupe (inboundIngest) matches on, so it lives here once. */
// Angle brackets are decoded BEFORE tags are stripped: GoHighLevel keeps
// "Name &lt;a@b.com&gt;" as text where Gmail's copy has "Name <a@b.com>",
// and both have to lose the address the same way.
export const normalizeBody = (s: string) => (s || "")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200);

export const MATCH_WINDOW_MS = 120 * 1000;
const PREFIX = 60;

const bareSubject = (s: string | null | undefined) => (s || "").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase();

export type MatchSide = {
  channel: string;
  direction: string;
  body: string | null;
  subject?: string | null;
  /** epoch ms */
  at: number;
};
export type MatchCandidate = MatchSide & { id: string };

function sameContent(a: MatchSide, b: MatchSide): boolean {
  // A call has no text worth comparing ("Missed call" from one path, "Call ·
  // 2m 5s" from another), so the time window alone decides.
  if (a.channel === "call") return true;
  const pa = normalizeBody(a.body ?? "").slice(0, PREFIX);
  const pb = normalizeBody(b.body ?? "").slice(0, PREFIX);
  if (pa && pa === pb) return true;
  const sa = bareSubject(a.subject), sb = bareSubject(b.subject);
  return !!sa && sa === sb;
}

/** The id of the local row this GoHighLevel message is a copy of, or null.
 *  Nearest in time wins; ids in `claimed` were already paired this run. */
export function matchGhlToLocal(ghl: MatchSide, candidates: MatchCandidate[], claimed: Set<string> = new Set()): string | null {
  let best: { id: string; gap: number } | null = null;
  for (const c of candidates) {
    if (claimed.has(c.id) || c.channel !== ghl.channel || c.direction !== ghl.direction) continue;
    const gap = Math.abs(c.at - ghl.at);
    if (gap > MATCH_WINDOW_MS || !sameContent(ghl, c)) continue;
    if (!best || gap < best.gap) best = { id: c.id, gap };
  }
  return best?.id ?? null;
}

/** A stored ghl_message_id that is a real GoHighLevel id. The retired webhook
 *  path wrote "synthetic:…" keys that GoHighLevel never issued. */
export const isRealGhlId = (id: string | null | undefined): id is string => !!id && !id.startsWith("synthetic:");
