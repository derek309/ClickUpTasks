import { describe, it, expect } from "vitest";
import { richToText } from "./inbox";

describe("a formatted email kept as text", () => {
  it("keeps paragraphs, bullets and link addresses", () => {
    const html = `<p>Hi <strong>James</strong>,</p><p>Here is the <a target="_blank" href="https://x.com/r/1?a=1&amp;b=2">sneak peek</a>.</p><ul><li><p>Home</p></li><li><p>About</p></li></ul><p>Tom &amp; Jerry</p>`;
    expect(richToText(html)).toBe("Hi James,\nHere is the sneak peek (https://x.com/r/1?a=1&b=2).\n• Home\n• About\n\nTom & Jerry");
  });
  it("shows a bare link once", () => {
    expect(richToText(`<p><a href="https://a.com">https://a.com</a></p>`)).toBe("https://a.com");
  });
});
