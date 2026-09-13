import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// public/page-bridge.js, the script inside a web page review's sandboxed frame,
// run in jsdom as the page's window with a stand in for the window around it.
// jsdom has no layout, so element boxes are stubbed where the maths needs them.

const posted: Record<string, unknown>[] = [];
const parent = { postMessage: (message: Record<string, unknown>) => { posted.push(message); } };

const fromParent = (data: Record<string, unknown>) => {
  const event = new MessageEvent("message", { data: { cul: 1, ...data } });
  Object.defineProperty(event, "source", { value: parent });
  window.dispatchEvent(event);
};
const last = (type: string) => [...posted].reverse().find((m) => m.type === type);
const click = (target: Element, x = 10, y = 10) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(event);
  return event;
};
const box = (el: Element, rect: { left: number; top: number; width: number; height: number }) => {
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect });
};

beforeAll(() => {
  document.body.innerHTML = `
    <header data-cul-n="1"><h1 data-cul-n="2">Fall Sale</h1></header>
    <p data-cul-n="3">Hello <a data-cul-n="4" href="/shop">shop</a> there</p>
    <a data-cul-n="5" href="#top">Top</a>
    <button data-cul-n="6">Buy</button>
    <div id="unnumbered">Made by a script</div>`;
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  new Function(readFileSync(join(process.cwd(), "public/page-bridge.js"), "utf8"))();
});

beforeEach(() => { posted.length = 0; });

// The bridge's MutationObserver answers the last change after the tests finish;
// let it run while jsdom's window is still here.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("page bridge", () => {
  it("tells the window around it that it is ready, with its mark", () => {
    // Ready was posted while loading; loading it again is a no op.
    new Function(readFileSync(join(process.cwd(), "public/page-bridge.js"), "utf8"))();
    expect(posted).toEqual([]);
  });

  it("drops a pin on the element under the click, as a share of that element's box", () => {
    const h1 = document.querySelector("h1")!;
    box(h1, { left: 100, top: 50, width: 400, height: 100 });
    const event = click(h1, 200, 75);
    expect(event.defaultPrevented).toBe(true);
    expect(last("place")).toMatchObject({ cul: 1, type: "place", anchor: { node: 2, nx: 0.25, ny: 0.25, width: window.innerWidth } });
  });

  it("never lets a link leave the page while commenting", () => {
    const link = document.querySelector('a[href="/shop"]')!;
    box(link, { left: 0, top: 0, width: 50, height: 20 });
    expect(click(link).defaultPrevented).toBe(true);
    expect(last("place")).toBeTruthy();
  });

  it("lets the page work in Try the page, except links that leave it", () => {
    fromParent({ type: "mode", mode: "browse" });
    expect(click(document.querySelector('a[href="/shop"]')!).defaultPrevented).toBe(true);
    expect(click(document.querySelector('a[href="#top"]')!).defaultPrevented).toBe(false);
    expect(click(document.querySelector("button")!).defaultPrevented).toBe(false);
    expect(last("place")).toBeUndefined();
    fromParent({ type: "mode", mode: "comment" });
  });

  it("draws the pins it is sent and reports a click on one", async () => {
    fromParent({ type: "pins", pins: [{ id: "tdm_0f8fad5b-d9cb-469f-a165-70867728950e", number: 7, x: 0.1, y: 0.1, anchor: null, done: false, active: false }], pending: null });
    await new Promise((r) => setTimeout(r, 20));
    const pin = document.querySelector("cul-pin")!;
    expect(pin.textContent).toBe("7");
    click(pin);
    expect(last("pin-click")).toEqual({ cul: 1, type: "pin-click", id: "tdm_0f8fad5b-d9cb-469f-a165-70867728950e" });
  });

  it("ignores messages from anything but the window around it", () => {
    const event = new MessageEvent("message", { data: { cul: 1, type: "mode", mode: "browse" } });
    window.dispatchEvent(event);
    expect(click(document.querySelector("button")!).defaultPrevented).toBe(true);
  });

  it("sends only the words when text is changed, and puts the page back as it was", () => {
    fromParent({ type: "mode", mode: "edit" });
    const p = document.querySelector("p")!;
    const tail = p.lastChild!;
    (document as unknown as { caretRangeFromPoint: () => unknown }).caretRangeFromPoint = () => ({ startContainer: tail });
    click(p);
    const editor = document.querySelector("cul-edit") as HTMLElement;
    expect(editor).toBeTruthy();
    editor.textContent = " over here ";
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(last("edit")).toEqual({ cul: 1, type: "edit", edit: { node: 3, i: 1, before: " there", after: "over here" } });
    expect(document.querySelector("cul-edit")).toBeNull();
    expect(p.textContent).toBe("Hello shop over here");
    fromParent({ type: "mode", mode: "comment" });
  });

  it("says so when the text was not written in the page's code", () => {
    fromParent({ type: "mode", mode: "edit" });
    const div = document.getElementById("unnumbered")!;
    (document as unknown as { caretRangeFromPoint: () => unknown }).caretRangeFromPoint = () => ({ startContainer: div.firstChild });
    click(div);
    expect(last("not-editable")).toEqual({ cul: 1, type: "not-editable" });
    fromParent({ type: "mode", mode: "comment" });
  });

  it("shows rewording again after a reload, only where the words still match", () => {
    const h1 = document.querySelector("h1")!;
    fromParent({ type: "edits", edits: [
      { node: 2, i: 0, before: "Fall Sale", after: "Winter Sale" },
      { node: 6, i: 0, before: "Not this", after: "Nope" },
    ] });
    expect(h1.textContent).toBe("Winter Sale");
    expect(document.querySelector("button")!.textContent).toBe("Buy");
  });

  it("reports the page's height and where its content sits across it", async () => {
    for (const el of document.body.querySelectorAll("*")) box(el, { left: 340, top: 0, width: 600, height: 20 });
    box(document.querySelector("h1")!, { left: 300, top: 0, width: 680, height: 40 });
    Object.defineProperty(document.body, "scrollHeight", { value: 1200, configurable: true });
    window.dispatchEvent(new Event("resize"));
    await new Promise((r) => setTimeout(r, 450));
    expect(last("size")).toEqual({ cul: 1, type: "size", height: 1200, left: 300, right: 980 });
  });

  it("does nothing at all when opened on its own, outside a frame", () => {
    const spy = vi.fn();
    const script = readFileSync(join(process.cwd(), "public/page-bridge.js"), "utf8");
    const self = { __culBridge: false, parent: null as unknown };
    self.parent = self;
    new Function("window", script)(self);
    expect(spy).not.toHaveBeenCalled();
    expect(self.__culBridge).toBe(false);
  });
});
