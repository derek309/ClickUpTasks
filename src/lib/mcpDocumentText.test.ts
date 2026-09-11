// @vitest-environment node
import { describe, it, expect } from "vitest";
// The MCP tools' document text conversion (mcp/core.mjs), checked against the
// app's own sanitizer so what Claude writes is exactly what the editor keeps.
import { docTextToHtml, docHtmlToText } from "../../mcp/core.mjs";
import { sanitizeDocHtml } from "./docHtml";

describe("docTextToHtml", () => {
  it("builds headings, paragraphs, lists, quotes and inline marks", () => {
    const html = docTextToHtml([
      "## Stores IN: What is running low?",
      "",
      "Hi {{contact.first_name}},",
      "",
      "Line one",
      "line two with **bold**, *italic* and [Restock at Wholesale](https://shop.example.com/a?b=1&c=2)",
      "",
      "- first",
      "- second",
      "",
      "1. one",
      "2. two",
      "",
      "> a quote",
    ].join("\n"));
    expect(html).toBe(
      "<h2>Stores IN: What is running low?</h2>"
      + "<p>Hi {{contact.first_name}},</p>"
      + '<p>Line one<br>line two with <strong>bold</strong>, <em>italic</em> and <a href="https://shop.example.com/a?b=1&amp;c=2">Restock at Wholesale</a></p>'
      + "<ul><li><p>first</p></li><li><p>second</p></li></ul>"
      + "<ol><li><p>one</p></li><li><p>two</p></li></ol>"
      + "<blockquote><p>a quote</p></blockquote>",
    );
  });

  it("puts a heading and the text right under it in separate blocks", () => {
    expect(docTextToHtml("### Hours\nOpen daily")).toBe("<h3>Hours</h3><p>Open daily</p>");
  });

  it("never produces markup from the input itself", () => {
    const html = docTextToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) [y](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/<script|<img|href="javascript/i);
    // The quote is escaped, so the would-be attribute stays inside the href value.
    expect(html).not.toMatch(/"\s*onmouseover/i);
    expect(html).toContain("&quot;onmouseover");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is kept as is by the app's sanitizer, apart from the forced link attributes", () => {
    const html = docTextToHtml("## Title\n\nSome **bold** text\n\n- a\n- b\n\n[Go](https://example.com)");
    const clean = sanitizeDocHtml(html);
    expect(docHtmlToText(clean)).toBe(docHtmlToText(html));
    expect(clean).toContain("<h2>Title</h2>");
    expect(clean).toContain("<strong>bold</strong>");
  });
});

describe("docHtmlToText", () => {
  it("round trips what docTextToHtml writes", () => {
    const text = "## Title\n\nHi there,\nsecond line with **bold** and [a link](https://example.com)\n\n- one\n- two\n\n1. first\n1. second\n\n> quoted";
    expect(docHtmlToText(docTextToHtml(text))).toBe(text);
  });

  it("reads the editor's own saved HTML, links and entities included", () => {
    const saved = '<p>Tom &amp; Jerry&nbsp;say &quot;hi&quot;</p><p><a target="_blank" rel="noopener noreferrer nofollow" href="https://x.com">Shop</a></p>';
    expect(docHtmlToText(saved)).toBe('Tom & Jerry say "hi"\n\n[Shop](https://x.com)');
  });
});
