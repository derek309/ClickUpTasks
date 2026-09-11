import { describe, it, expect } from "vitest";
import { draftLinkHtml, placeDraftLink, draftLinkAsButton } from "./draftLink";

const link = { url: "https://clickuptasks.vercel.app/doc/doc_abc", label: "Review \"Menu\"" };
const line = draftLinkHtml(link);

describe("placeDraftLink", () => {
  it("puts the link where the AI marked it, once", () => {
    const html = "<p>Hi,</p><p>Please open it:</p><p>[[LINK]]</p><p>Questions? Ask.</p><p>[[LINK]]</p><p>Best,<br>Derek</p>";
    expect(placeDraftLink(html, link)).toBe(`<p>Hi,</p><p>Please open it:</p>${line}<p>Questions? Ask.</p><p>Best,<br>Derek</p>`);
  });
  it("with no mark, goes just above the sign off", () => {
    const html = "<p>Hi,</p><p>Please take a look.</p><p>Best,<br>Derek</p>";
    expect(placeDraftLink(html, link)).toBe(`<p>Hi,</p><p>Please take a look.</p>${line}<p>Best,<br>Derek</p>`);
  });
  it("with no mark and no sign off, goes at the end", () => {
    expect(placeDraftLink("<p>Hi,</p>", link)).toBe(`<p>Hi,</p>${line}`);
  });
  it("drops the mark when there is no link", () => {
    expect(placeDraftLink("<p>Hi [[LINK]]</p><p>[[LINK]]</p>", null)).toBe("<p>Hi </p>");
  });
});

describe("draftLinkAsButton", () => {
  it("turns the link line into a button with the team's wording", () => {
    const body = `<p>Hi,</p><h3><a target="_blank" rel="noopener" href="${link.url}"><strong>Open the menu →</strong></a></h3><p>Best</p>`;
    const out = draftLinkAsButton(body, link);
    expect(out).toContain(`<a href="${link.url}" style="display:inline-block;`);
    expect(out).toContain(">Open the menu</a>");
    expect(out.startsWith("<p>Hi,</p><table")).toBe(true);
    expect(out.endsWith("</table><p>Best</p>")).toBe(true);
  });
  it("also takes an older plain link paragraph", () => {
    expect(draftLinkAsButton(`<p><a href="${link.url}">Review</a></p>`, link)).toContain("<table");
  });
  it("leaves the body alone without a link or when the link was removed", () => {
    expect(draftLinkAsButton("<p>Hi</p>", link)).toBe("<p>Hi</p>");
    expect(draftLinkAsButton("<p>Hi</p>", null)).toBe("<p>Hi</p>");
  });
});
