// The email that asks a client to review a document, image review or HTML review:
// a short intro, the review link as its own bold line, and the context "Write with
// AI" uses later. Shared by the task drawer (after Send for review or Email client)
// and Claude over MCP, so both draft the same email. Pure: no browser or server.
import { draftLinkHtml, escapeHtml, type DraftLink } from "./draftLink";
import { kindWhat, type ReviewKind } from "./reviewKinds";

export type ReviewEmailInput = {
  kind: ReviewKind;
  /** The client's review link, or null when it can't be copied. */
  url: string | null;
  name: string;
  /** The document's words, for Write with AI (empty for image and HTML reviews). */
  text: string;
  /** What changed since the version the client saw, or null on a first send. */
  changes: string | null;
  /** The contact's name, for "Hi Brian,". Missing or blank says "Hi,". */
  greetName?: string | null;
};

/** The opening line of an email to a client: "Hi Brian," from the contact's
 *  name, or "Hi," with none (Derek, 2026-09-14: "add the hi CLIENTS NAME").
 *  First word only, since contacts store the full name. */
export function greetingHtml(contactName?: string | null): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  return `<p>Hi${first ? ` ${escapeHtml(first)}` : ""},</p>`;
}
export type ReviewEmail = { subject: string; body: string; link: DraftLink | null; aiContext: string };

// What the client can do from the link: one sentence for every kind, with only the
// way they comment or change it told apart (Derek, 2026-09-13: image and HTML
// reviews "need to be the same as doc").
const HOW: Record<ReviewKind, string> = {
  doc: ", edit it",
  image: " on any spot",
  page: " on any spot, change the wording",
  // A video review has no spots to comment on yet; that is the next slice.
  video: "",
};

export function buildReviewEmail(review: ReviewEmailInput): ReviewEmail {
  const what = kindWhat(review.kind);
  const link = review.url ? { url: review.url, label: `Open "${review.name}" to review` } : null;
  const name = escapeHtml(review.name);
  const can = `look it over, leave comments${HOW[review.kind]}, send changes or approve it`;
  const intro = greetingHtml(review.greetName) + (review.changes
    ? `<p>We made some updates to "${name}". Take a look and approve it when it looks right:</p>`
    : `<p>"${name}" is ready for your review. You can ${can} here:</p>`);
  const aiContext = [
    review.changes
      ? `We updated the ${what} "${review.name}" and are asking the client to review the changes and approve it.`
      : `We are asking the client to review the ${what} "${review.name}". From the link they can ${can}.`,
    review.changes ? `What changed since the version they saw before:\n${review.changes}` : null,
    review.text ? `The ${what}'s text:\n${review.text}` : null,
  ].filter(Boolean).join("\n\n");
  return {
    subject: review.changes ? `Updated for your review: ${review.name}` : `Please review: ${review.name}`,
    body: intro + draftLinkHtml(link),
    link,
    aiContext,
  };
}
