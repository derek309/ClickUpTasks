// @vitest-environment node
//
// Pinned to node on purpose. vitest runs every other test in jsdom, where a DOM
// exists, and that is exactly the setting that hid safeMessageHtml returning ""
// on the server. The document sanitizer runs in a Vercel function, so it is
// tested where it runs.
import { describe, it, expect } from "vitest";
import { sanitizeDocHtml, DOC_MAX_HTML_CHARS, DOC_MAX_RAW_CHARS } from "./docHtml";

describe("sanitizeDocHtml removes anything that can run", () => {
  it("drops a script and its contents", () => {
    expect(sanitizeDocHtml("<p>Hi</p><script>alert(1)</script>")).toBe("<p>Hi</p>");
  });
  it("drops an image with an onerror handler", () => {
    expect(sanitizeDocHtml('<p>Hi<img src=x onerror="alert(1)"></p>')).toBe("<p>Hi</p>");
  });
  it("drops iframes, svg and math with what is inside them", () => {
    expect(sanitizeDocHtml('<p>a</p><iframe src="https://x.test"></iframe><svg><script>1</script></svg><math><mi>x</mi></math>')).toBe("<p>a</p>");
  });
  it("strips style, class, id and name, which can restyle or clobber the app", () => {
    expect(sanitizeDocHtml('<p style="color:red" class="x" id="me" name="n" onclick="x()">text</p>')).toBe("<p>text</p>");
  });
});

describe("sanitizeDocHtml keeps links safe", () => {
  const hrefOf = (html: string) => /href="([^"]*)"/.exec(sanitizeDocHtml(html))?.[1] ?? null;

  it("keeps an https link and forces it to open safely in a new tab", () => {
    expect(sanitizeDocHtml('<p><a href="https://bibboards.com" target="_self">site</a></p>'))
      .toBe('<p><a href="https://bibboards.com" rel="noopener noreferrer nofollow" target="_blank">site</a></p>');
  });
  it("keeps mailto and tel", () => {
    expect(hrefOf('<a href="mailto:brian@bibboards.com">mail</a>')).toBe("mailto:brian@bibboards.com");
    expect(hrefOf('<a href="tel:+19165551234">call</a>')).toBe("tel:+19165551234");
  });
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["mixed case javascript:", "JaVaScRiPt:alert(1)"],
    ["javascript: split by a tab", "java\tscript:alert(1)"],
    ["data:", "data:text/html;base64,PHNjcmlwdD4="],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["protocol relative", "//evil.test/x"],
    ["relative", "/admin"],
  ])("drops a %s href but keeps the link text", (_label, href) => {
    const out = sanitizeDocHtml(`<p><a href="${href}">click</a></p>`);
    expect(out).not.toContain("href");
    expect(out).toContain("click");
  });
});

describe("sanitizeDocHtml keeps what the editor writes", () => {
  it("keeps headings, formatting, lists, quotes and rules", () => {
    const html = "<h2>Title</h2><h3>Sub</h3><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p><ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol><blockquote><p>q</p></blockquote><hr><pre><code>x</code></pre>";
    // sanitize-html writes void tags self closed: <hr> comes back as <hr />.
    // Both are valid HTML and the editor reads either.
    expect(sanitizeDocHtml(html)).toBe(html.replace("<hr>", "<hr />"));
  });
  it("keeps a TipTap checklist's state and drops its checkbox markup", () => {
    const tiptap = '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Send the proof</p></div></li></ul>';
    expect(sanitizeDocHtml(tiptap)).toBe('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Send the proof</p></li></ul>');
  });
  it("only accepts real checklist attribute values", () => {
    expect(sanitizeDocHtml('<ul data-type="evil"><li data-type="taskItem" data-checked="maybe"><p>x</p></li></ul>'))
      .toBe('<ul><li data-type="taskItem" data-checked="false"><p>x</p></li></ul>');
  });
  it("turns an h1 into the top heading the editor has, and b and i into strong and em", () => {
    expect(sanitizeDocHtml("<h1>Big</h1><p><b>b</b><i>i</i></p>")).toBe("<h2>Big</h2><p><strong>b</strong><em>i</em></p>");
  });
  it("keeps plain text", () => {
    expect(sanitizeDocHtml("Just words")).toBe("Just words");
  });
  it("gives the same result when run twice", () => {
    const messy = '<h1>T</h1><p style="x">a <a href="https://x.test">l</a><script>1</script></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>c</p></div></li></ul>';
    const once = sanitizeDocHtml(messy);
    expect(sanitizeDocHtml(once)).toBe(once);
  });
});

describe("document size limits", () => {
  it("allow a raw request comfortably larger than a cleaned document", () => {
    expect(DOC_MAX_RAW_CHARS).toBeGreaterThan(DOC_MAX_HTML_CHARS);
  });
});
