// Per-user email signature, appended server-side rather than in the composer
// so it is genuinely always present (Derek: "emails sent through the
// messaging column should always include the users signature") — including
// on scheduled sends, AI-drafted sends, and the GHL fallback path, none of
// which go through the composer's own state.
//
// Stored as HTML (profiles.email_signature, see supabase/email-signature.sql)
// — authored in the same RichTextEditor the email composer uses, so bold,
// links, and line breaks survive. Values saved before that switch were plain
// text, so both helpers below normalize on read rather than needing a
// backfill.
//
// No sanitization pass here on purpose: the signature is the sender's own
// authored HTML going out under their own name, exactly like the email body
// beside it (the composer has always posted raw RichTextEditor HTML), and
// /api/signature pins every write to the caller's own row. This adds no
// surface the body didn't already have.
import { looksLikeHtml, htmlToText, plainTextToHtml } from "./data";

/** Append the sender's signature to an HTML email body. No-op when unset. */
export function appendSignatureHtml(bodyHtml: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim();
  if (!sig) return bodyHtml;
  const sigHtml = looksLikeHtml(sig) ? sig : plainTextToHtml(sig);
  return `${bodyHtml}<br><br>${sigHtml}`;
}

/** Append to a PLAIN TEXT body — the caller escapes the whole thing later, so
 *  the signature has to arrive as text, not markup (see /api/google/send's
 *  non-isHtml branch). */
export function appendSignatureText(bodyText: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim();
  if (!sig) return bodyText;
  const sigText = looksLikeHtml(sig) ? htmlToText(sig) : sig;
  return sigText ? `${bodyText}\n\n${sigText}` : bodyText;
}
