import { describe, it, expect } from "vitest";
import { buildReviewEmail } from "./reviewEmail";

const URL = "https://clickuptasks.vercel.app/doc/doc_abc";

describe("buildReviewEmail", () => {
  it("invites the client to a first document review, with the link as its own line", () => {
    const email = buildReviewEmail({ kind: "doc", url: URL, name: "Fall flyer", text: "Hello there", changes: null });
    expect(email.subject).toBe("Please review: Fall flyer");
    expect(email.body).toBe(
      `<p>Hi,</p><p>"Fall flyer" is ready for your review. You can read it, make changes, leave comments or approve it here:</p>`
      + `<h3><a href="${URL}"><strong>Open &quot;Fall flyer&quot; to review →</strong></a></h3>`,
    );
    expect(email.link).toEqual({ url: URL, label: `Open "Fall flyer" to review` });
    expect(email.aiContext).toBe(
      `We are asking the client to review the document "Fall flyer". From the link they can read it, edit it, comment and approve it.`
      + `\n\nThe document's text:\nHello there`,
    );
  });

  it("says a new version of an image review changed, and has no text to quote", () => {
    const email = buildReviewEmail({ kind: "image", url: URL, name: "Logo", text: "", changes: "A new version of the image." });
    expect(email.subject).toBe("Updated for your review: Logo");
    expect(email.body.startsWith(`<p>Hi,</p><p>We made a new version of "Logo". Take a look and approve it when it looks right:</p>`)).toBe(true);
    expect(email.aiContext).toBe(
      `We updated the image "Logo" and are asking the client to review the changes and approve it.`
      + `\n\nWhat changed since the version they saw before:\nA new version of the image.`,
    );
  });

  it("tells the client they can reword an HTML review, and escapes the name in the body only", () => {
    const email = buildReviewEmail({ kind: "page", url: null, name: "Tom & <Jerry>", text: "", changes: null });
    expect(email.body).toBe(
      `<p>Hi,</p><p>"Tom &amp; &lt;Jerry&gt;" is ready for your review. Click any spot on the page to leave a comment, change the wording right on the page, or approve it here:</p>`,
    );
    expect(email.link).toBeNull();
    expect(email.subject).toBe("Please review: Tom & <Jerry>");
    expect(email.aiContext).toContain("change the wording right on the page");
  });
});
