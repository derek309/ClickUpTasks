import { describe, expect, it } from "vitest";
import { BRIEF_TOKEN_PATTERN, briefToText, cleanDue, cleanLinkDays, cleanOutsideName, formatDue, scrubContacts, templateHtml } from "./brief";

describe("briefToText", () => {
  it("reads as a message: title, due, capital headings, bullets, files", () => {
    const text = briefToText({
      title: "Grand opening postcard", due: "2026-10-06",
      html: "<h2>The job</h2><p>A two sided postcard.</p><h2>Must include</h2><ul><li><p>Address &amp; hours</p></li><li><p>QR code</p></li></ul>",
      files: ["logo.svg", "photo.jpg"],
    });
    expect(text).toBe([
      "Grand opening postcard", "Due Tue, Oct 6", "", "THE JOB", "A two sided postcard.", "", "MUST INCLUDE", "• Address & hours", "• QR code",
      "", "Files: logo.svg, photo.jpg",
    ].join("\n"));
  });

  it("uses the plain name with no title, and drops empty bullets from a template", () => {
    const text = briefToText({ title: "", due: null, html: templateHtml("design"), files: [] });
    expect(text.startsWith("Project instructions\n\nTHE JOB")).toBe(true);
    expect(text).not.toContain("•");
  });
});

describe("scrubContacts", () => {
  it("takes out emails and phone numbers, keeps sizes, prices and dates", () => {
    const out = scrubContacts("Call 541 555 0199 or +1 (541) 555-0100, mail anna@bakery.com. 6 x 9 in, $25, 2026");
    expect(out).not.toMatch(/555|@/);
    expect(out).toContain("6 x 9 in, $25, 2026");
  });
});

describe("small cleaners", () => {
  it("dates", () => {
    expect(cleanDue("2026-10-06")).toBe("2026-10-06");
    expect(cleanDue("")).toBeNull();
    expect(cleanDue("next week")).toBeUndefined();
    expect(formatDue("2026-10-06")).toBe("Tue, Oct 6");
  });
  it("link days fall back to two weeks", () => {
    expect(cleanLinkDays(7)).toBe(7);
    expect(cleanLinkDays(365)).toBe(14);
    expect(cleanLinkDays("30")).toBe(14);
  });
  it("names", () => {
    expect(cleanOutsideName("  Ana <b>\n Ruiz ")).toBe("Ana b Ruiz");
    expect(cleanOutsideName(42)).toBe("");
  });
  it("token shape", () => {
    expect(BRIEF_TOKEN_PATTERN.test("brf_" + "a".repeat(43))).toBe(true);
    expect(BRIEF_TOKEN_PATTERN.test("doc_" + "a".repeat(43))).toBe(false);
  });
});
