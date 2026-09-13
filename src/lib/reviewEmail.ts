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
};
export type ReviewEmail = { subject: string; body: string; link: DraftLink | null; aiContext: string };

// What the client can do from the link, per kind (Derek, 2026-09-12: web page review).
const INVITE: Record<ReviewKind, string> = {
  doc: "You can read it, make changes, leave comments or approve it here:",
  image: "Click any spot on the image to leave a comment, or approve it here:",
  page: "Click any spot on the page to leave a comment, change the wording right on the page, or approve it here:",
};
const CAN: Record<ReviewKind, string> = {
  doc: "read it, edit it, comment and approve it",
  image: "click any spot on it to leave a numbered comment or a file, ask for changes, or approve it",
  page: "click any spot on it to leave a numbered comment or a file, change the wording right on the page, or approve it",
};

export function buildReviewEmail(review: ReviewEmailInput): ReviewEmail {
  const what = kindWhat(review.kind);
  const link = review.url ? { url: review.url, label: `Open "${review.name}" to review` } : null;
  const name = escapeHtml(review.name);
  const intro = review.changes
    ? `<p>Hi,</p><p>We made ${review.kind === "doc" ? "some updates to" : "a new version of"} "${name}". Take a look and approve it when it looks right:</p>`
    : `<p>Hi,</p><p>"${name}" is ready for your review. ${INVITE[review.kind]}</p>`;
  const aiContext = [
    review.changes
      ? `We updated the ${what} "${review.name}" and are asking the client to review the changes and approve it.`
      : `We are asking the client to review the ${what} "${review.name}". From the link they can ${CAN[review.kind]}.`,
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
