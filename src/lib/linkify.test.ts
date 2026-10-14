import { describe, expect, it } from "vitest";
import { linkifyParts, shortLinkLabel } from "./linkify";

describe("a link's short name", () => {
  it("says what a known link is", () => {
    expect(shortLinkLabel("https://mail.google.com/mail/u/0/#search/ppa/FMfcgzQhsdkjf")).toBe("Gmail");
    expect(shortLinkLabel("https://chatgpt.com/c/6acfa6f6-ceb4-83e8-b663-27b6fbf564d9")).toBe("ChatGPT chat");
    expect(shortLinkLabel("https://docs.google.com/document/d/1x/edit")).toBe("Google Doc");
    expect(shortLinkLabel("https://docs.google.com/spreadsheets/d/1x/edit")).toBe("Google Sheet");
    expect(shortLinkLabel("https://drive.google.com/file/d/1x/view")).toBe("Google Drive file");
  });
  it("is the site and the part of the path that reads as a name", () => {
    expect(shortLinkLabel("https://www.example.com/blog/how-to-fix-the-thing")).toBe("example.com · How to fix the thing");
  });
  it("is the site alone when the path is only ids", () => {
    expect(shortLinkLabel("https://example.com/6acfa6f6-ceb4-83e8-b663-27b6fbf564d9")).toBe("example.com");
  });
});

describe("text with links in it", () => {
  it("cuts a to do into its words and its links", () => {
    const parts = linkifyParts("Email sent to PPAI https://mail.google.com/mail/u/0/#search/ppa/FMfcgzQh and done.");
    expect(parts).toEqual([
      { text: "Email sent to PPAI " },
      { href: "https://mail.google.com/mail/u/0/#search/ppa/FMfcgzQh", label: "Gmail" },
      { text: " and done." },
    ]);
  });
  it("leaves text with no link as it is", () => {
    expect(linkifyParts("Call Brian")).toEqual([{ text: "Call Brian" }]);
  });
});
