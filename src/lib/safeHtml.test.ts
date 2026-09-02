import { describe, it, expect } from "vitest";
import { safeMessageHtml } from "./safeHtml";

// These are the payloads an emailed attack actually looks like. The bodies
// reaching this function came from a client's public inbox by way of
// GoHighLevel, stored exactly as they arrived.
describe("sanitising an untrusted email body", () => {
  it("strips a script tag", () => {
    expect(safeMessageHtml('<p>hi</p><script>alert(1)</script>')).toBe("<p>hi</p>");
  });
  it("strips the event handler and keeps the image", () => {
    const out = safeMessageHtml('<img src="https://x.test/a.png" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).toContain("https://x.test/a.png");
  });
  it("drops a javascript: link but keeps the text", () => {
    const out = safeMessageHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });
  it("drops data: and blob: URLs, which is how a payload gets past a scheme check", () => {
    expect(safeMessageHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')).not.toContain("data:");
    expect(safeMessageHtml('<img src="blob:https://x.test/abc">')).not.toContain("blob:");
  });
  it("removes iframes, forms and inputs", () => {
    const out = safeMessageHtml('<iframe src="https://evil.test"></iframe><form action="/x"><input name="p"></form>');
    expect(out).not.toMatch(/iframe|form|input/);
  });
  it("keeps what an email is actually made of", () => {
    const out = safeMessageHtml(
      '<p><b>Hi</b> <i>there</i></p><ul><li>one</li></ul>'
      + '<table><tr><td>cell</td></tr></table>'
      + '<a href="https://example.com" title="t">link</a>',
    );
    expect(out).toContain("<b>Hi</b>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("cell");
    expect(out).toContain('href="https://example.com"');
  });
  it("keeps mailto and tel, which real signatures use", () => {
    expect(safeMessageHtml('<a href="mailto:a@b.test">mail</a>')).toContain("mailto:a@b.test");
    expect(safeMessageHtml('<a href="tel:+15551234">call</a>')).toContain("tel:");
  });
  it("survives the things that are not markup at all", () => {
    expect(safeMessageHtml("")).toBe("");
    expect(safeMessageHtml("just text")).toBe("just text");
  });
  // The nastier shapes: a payload that only becomes live once the browser has
  // fixed up the author's broken nesting.
  it("does not resurrect a script through malformed nesting", () => {
    expect(safeMessageHtml('<div><script>alert(1)</script></div>')).not.toContain("alert");
    expect(safeMessageHtml('<svg><script>alert(1)</script></svg>')).not.toContain("alert");
    expect(safeMessageHtml('<math><mi xlink:href="javascript:alert(1)">x</mi></math>')).not.toContain("javascript:");
  });
});
