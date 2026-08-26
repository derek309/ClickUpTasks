// Per-user email signature, appended server-side rather than in the composer
// so it is genuinely always present (Derek: "emails sent through the
// messaging column should always include the users signature") — including
// on scheduled sends, AI-drafted sends, and the GHL fallback path, none of
// which go through the composer's own state.
//
// Stored as PLAIN TEXT (profiles.email_signature, see supabase/
// email-signature.sql). Escaped here on the way into an HTML body, so there
// is no stored markup to sanitize and the value behaves identically no
// matter which sender path picks it up.
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Append the sender's signature to an HTML email body. No-op when unset. */
export function appendSignatureHtml(bodyHtml: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim();
  if (!sig) return bodyHtml;
  return `${bodyHtml}<br><br>${escapeHtml(sig).replace(/\r\n|\r|\n/g, "<br>")}`;
}
