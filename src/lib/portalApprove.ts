// One tap Approve in the client portal (Derek, 2026-10-15): the focused
// request's Approve approves the review there and then, through the same
// public, token gated routes the review page itself uses, so nothing new is
// opened up. The portal asks for the review's link (/api/waiting/<token>/doc,
// which checks the task is this client's), reads the version under review
// (/api/doc/<docToken>), and approves that version (/api/doc/<docToken>/approve).
// The approve route still refuses when the client left comments or edits on
// the review; then the portal opens the review page so they can sort it there.
//
// The page is public, so this file imports nothing from the app.

export type ReviewKind = "doc" | "image" | "page" | "video";

const DOC_TOKEN = /\/doc\/(doc_[A-Za-z0-9_-]{43})(?:[/?#]|$)/;

/** The review link's token, from the URL the portal is handed. */
export function docTokenFromUrl(url: string): string | null {
  return DOC_TOKEN.exec(url)?.[1] ?? null;
}

/** What the approve route takes, as the review page sends it: an HTML review
 *  the version it showed and no rewording; an image or a video the version
 *  only; a document its text as it stands. */
export function approveBody(kind: ReviewKind, review: { version: number; body: string }): Record<string, unknown> {
  if (kind === "page") return { baseVersion: review.version, body: review.body, edits: {} };
  if (kind === "image" || kind === "video") return { baseVersion: review.version };
  return { html: review.body, baseVersion: review.version };
}

/** How it went: approved; open the review (comments or edits of theirs are
 *  on it, or it moved on); or a problem to show. */
export type ApproveOutcome = { ok: true } | { ok: false; open: true } | { ok: false; open: false; error: string };

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function approveFromPortal(portalToken: string, taskId: string, kind: ReviewKind): Promise<ApproveOutcome> {
  const problem = (error?: string): ApproveOutcome => ({ ok: false, open: false, error: error || "We couldn't approve it. Try again." });
  try {
    const linkRes = await post(`/api/waiting/${encodeURIComponent(portalToken)}/doc`, { taskId, kind });
    const link = await linkRes.json().catch(() => ({}));
    const docToken = linkRes.ok && typeof link.url === "string" ? docTokenFromUrl(link.url) : null;
    if (!docToken) return problem(link.error);
    const readRes = await fetch(`/api/doc/${encodeURIComponent(docToken)}`, { cache: "no-store" });
    const review = await readRes.json().catch(() => ({}));
    if (!readRes.ok || typeof review.version !== "number") return problem(review.error);
    if (review.status === "approved") return { ok: true };
    if (review.closed) return problem("This one is closed already.");
    const res = await post(`/api/doc/${encodeURIComponent(docToken)}/approve`, approveBody(kind, { version: review.version, body: typeof review.body === "string" ? review.body : "" }));
    if (res.ok) return { ok: true };
    // Their comments or edits are on it, or the team sent a newer version: look there.
    if (res.status === 409) return { ok: false, open: true };
    if (res.status === 429) return problem("Too many tries. Please wait a moment and try again.");
    const j = await res.json().catch(() => ({}));
    return problem(j.error);
  } catch {
    return problem("We couldn't reach the server. Check your connection and try again.");
  }
}
