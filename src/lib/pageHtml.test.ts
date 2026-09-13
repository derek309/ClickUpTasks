// @vitest-environment node
import { describe, it, expect } from "vitest";
import { applyTextEdits, cleanEdits, framePage, pageText, pageTooBig, PAGE_CHANGED, PAGE_MAX_BYTES } from "./pageHtml";

const PAGE = `<!doctype html>
<html>
<head><title>Sale</title><style>.a { color: red }</style></head>
<body>
  <header class="top"><h1>
    Fall Restock Sale
  </h1></header>
  <p class=a>Hi &amp; bye<br/>two</p>
  <table><tr><td>Price</td></tr></table>
  <img src="a.png"/>
  <a href="/shop"><button>Shop now</button></a>
  <script>document.title = "x"</script>
</body>
</html>`;

const unstamp = (html: string) => html.replace(/ data-cul-n="\d+"/g, "");
const stampOf = (html: string, tag: string) => Number(new RegExp(`<${tag}[^>]*data-cul-n="(\\d+)"`).exec(html)?.[1]);

describe("framePage", () => {
  it("numbers the elements without changing a single other byte", () => {
    const framed = framePage(PAGE);
    expect(unstamp(framed)).toBe(PAGE);
    expect(framed).toContain('<img src="a.png" data-cul-n=');
    expect(framed).toMatch(/<br data-cul-n="\d+"\/>/);
  });

  it("numbers in page order and leaves the head, styles and scripts alone", () => {
    const framed = framePage(PAGE);
    expect(framed).toContain("<head><title>Sale</title><style>");
    expect(framed).toContain("<script>document.title");
    expect(stampOf(framed, "body")).toBe(0);
    expect(stampOf(framed, "header")).toBe(1);
    expect(stampOf(framed, "h1")).toBe(2);
    expect(stampOf(framed, "p")).toBe(3);
  });

  it("puts the bridge first in the head, before any of the page's own scripts", () => {
    const framed = framePage(PAGE, '<script src="/page-bridge.js"></script>');
    expect(framed).toContain('<head><script src="/page-bridge.js"></script><title>');
  });

  it("puts the bridge at the very start of a page with no head or html tag", () => {
    expect(framePage("<p>Hello</p>", "<script></script>")).toBe('<script></script><p data-cul-n="0">Hello</p>');
  });
});

describe("applyTextEdits", () => {
  const framed = framePage(PAGE);
  const h1 = stampOf(framed, "h1");
  const p = stampOf(framed, "p");
  const td = stampOf(framed, "td");
  const button = stampOf(framed, "button");

  it("rewords a heading and keeps its own line breaks and indent", () => {
    const r = applyTextEdits(PAGE, [{ node: h1, i: 0, before: "Fall Restock Sale", after: "Winter Sale" }]);
    expect(r).toEqual({ ok: true, html: PAGE.replace("\n    Fall Restock Sale\n  ", "\n    Winter Sale\n  ") });
  });

  it("treats text split by an entity as one piece, and counts the pieces after a line break", () => {
    const first = applyTextEdits(PAGE, [{ node: p, i: 0, before: "Hi & bye", after: "Hello & goodbye" }]);
    expect(first.ok && first.html).toContain("<p class=a>Hello &amp; goodbye<br/>two</p>");
    const second = applyTextEdits(PAGE, [{ node: p, i: 1, before: "two", after: "three" }]);
    expect(second.ok && second.html).toContain("<br/>three</p>");
  });

  it("finds text in a table cell and on a button", () => {
    const r = applyTextEdits(PAGE, [
      { node: td, i: 0, before: "Price", after: "Today only" },
      { node: button, i: 0, before: "Shop now", after: "Buy" },
    ]);
    expect(r.ok && r.html).toContain("<td>Today only</td>");
    expect(r.ok && r.html).toContain("<button>Buy</button>");
  });

  it("never lets new words become code", () => {
    const r = applyTextEdits(PAGE, [{ node: button, i: 0, before: "Shop now", after: '<script>alert("x")</script>' }]);
    expect(r.ok && r.html).toContain("<button>&lt;script&gt;alert(\"x\")&lt;/script&gt;</button>");
  });

  it("refuses everything when a piece no longer reads what the client saw", () => {
    const r = applyTextEdits(PAGE, [
      { node: h1, i: 0, before: "Fall Restock Sale", after: "Winter Sale" },
      { node: button, i: 0, before: "Shop later", after: "Buy" },
    ]);
    expect(r).toEqual({ ok: false, error: PAGE_CHANGED });
  });

  it("refuses an element or a piece of text that is not there", () => {
    expect(applyTextEdits(PAGE, [{ node: 9999, i: 0, before: "x", after: "y" }]).ok).toBe(false);
    expect(applyTextEdits(PAGE, [{ node: h1, i: 3, before: "Fall Restock Sale", after: "y" }]).ok).toBe(false);
  });

  it("cannot touch the text of a script", () => {
    const script = PAGE.indexOf("<script>");
    expect(applyTextEdits(PAGE, [{ node: 0, i: 5, before: 'document.title = "x"', after: "y" }]).ok).toBe(false);
    expect(script).toBeGreaterThan(0);
  });
});

describe("cleanEdits", () => {
  it("keeps the latest edit to each piece of text", () => {
    expect(cleanEdits([
      { node: 1, i: 0, before: "A", after: "B" },
      { node: 1, i: 0, before: "A", after: "C" },
    ])).toEqual([{ node: 1, i: 0, before: "A", after: "C" }]);
  });

  it("refuses a malformed or overlong list", () => {
    expect(cleanEdits("nope")).toBeNull();
    expect(cleanEdits([{ node: "1" }])).toBeNull();
    expect(cleanEdits(Array.from({ length: 501 }, (_, i) => ({ node: i, i: 0, before: "a", after: "b" })))).toBeNull();
  });
});

describe("pageText", () => {
  it("reads like the page, without the head, styles or scripts", () => {
    expect(pageText(PAGE)).toBe("Fall Restock Sale\nHi & bye\ntwo\nPrice\nShop now");
  });

  it("keeps the words of links and buttons side by side apart", () => {
    expect(pageText('<nav><a href="/a">Shop</a><a href="/b">About</a><button>Menu</button></nav>')).toBe("Shop About Menu");
  });
});

describe("pageTooBig", () => {
  it("allows exactly 2 MB and refuses one byte more", () => {
    expect(pageTooBig("a".repeat(PAGE_MAX_BYTES))).toBe(false);
    expect(pageTooBig("a".repeat(PAGE_MAX_BYTES + 1))).toBe(true);
    expect(pageTooBig("é".repeat(PAGE_MAX_BYTES / 2 + 1))).toBe(true);
  });
});
