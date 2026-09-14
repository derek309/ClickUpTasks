import { describe, it, expect } from "vitest";
import { buildReviewEmail, greetingHtml } from "./reviewEmail";

const URL = "https://clickuptasks.vercel.app/doc/doc_abc";

describe("buildReviewEmail", () => {
  it("invites the client to a first document review, with the link as its own line", () => {
    const email = buildReviewEmail({ kind: "doc", url: URL, name: "Fall flyer", text: "Hello there", changes: null });
    expect(email.subject).toBe("Please review: Fall flyer");
    expect(email.body).toBe(
      `<p>Hi,</p><p>"Fall flyer" is ready for your review. You can look it over, leave comments, edit it, send changes or approve it here:</p>`
      + `<h3><a href="${URL}"><strong>Open &quot;Fall flyer&quot; to review →</strong></a></h3>`,
    );
    expect(email.link).toEqual({ url: URL, label: `Open "Fall flyer" to review` });
    expect(email.aiContext).toBe(
      `We are asking the client to review the document "Fall flyer". From the link they can look it over, leave comments, edit it, send changes or approve it.`
      + `\n\nThe document's text:\nHello there`,
    );
  });

  it("words an updated image review the same way as an updated document", () => {
    const email = buildReviewEmail({ kind: "image", url: URL, name: "Logo", text: "", changes: "A new version of the image." });
    expect(email.subject).toBe("Updated for your review: Logo");
    expect(email.body.startsWith(`<p>Hi,</p><p>We made some updates to "Logo". Take a look and approve it when it looks right:</p>`)).toBe(true);
    expect(email.aiContext).toBe(
      `We updated the image "Logo" and are asking the client to review the changes and approve it.`
      + `\n\nWhat changed since the version they saw before:\nA new version of the image.`,
    );
  });

  it("tells the client they can reword an HTML review, and escapes the name in the body only", () => {
    const email = buildReviewEmail({ kind: "page", url: null, name: "Tom & <Jerry>", text: "", changes: null });
    expect(email.body).toBe(
      `<p>Hi,</p><p>"Tom &amp; &lt;Jerry&gt;" is ready for your review. You can look it over, leave comments on any spot, change the wording, send changes or approve it here:</p>`,
    );
    expect(email.link).toBeNull();
    expect(email.subject).toBe("Please review: Tom & <Jerry>");
    expect(email.aiContext).toContain("change the wording");
  });

  it("greets the contact by first name, and says Hi with no name", () => {
    const email = buildReviewEmail({ kind: "doc", url: null, name: "Flyer", text: "", changes: null, greetName: "Brian Goodell" });
    expect(email.body.startsWith(`<p>Hi Brian,</p><p>"Flyer" is ready for your review.`)).toBe(true);
    expect(greetingHtml("  ")).toBe("<p>Hi,</p>");
    expect(greetingHtml(null)).toBe("<p>Hi,</p>");
    expect(greetingHtml("<Tom> Jones")).toBe("<p>Hi &lt;Tom&gt;,</p>");
  });
});
