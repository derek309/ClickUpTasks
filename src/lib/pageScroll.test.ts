import { describe, expect, it } from "vitest";
import { keepBottomTop, scrollsInside } from "./pageScroll";

describe("scrollsInside", () => {
  it("is the box when it can scroll and holds more than it shows (a computer)", () => {
    expect(scrollsInside({ overflowY: "auto", scrollHeight: 2000, clientHeight: 600 })).toBe(true);
    expect(scrollsInside({ overflowY: "scroll", scrollHeight: 2000, clientHeight: 600 })).toBe(true);
  });
  it("is the page when the box grows to its content (a phone)", () => {
    expect(scrollsInside({ overflowY: "auto", scrollHeight: 2000, clientHeight: 2000 })).toBe(false);
    // A rounding pixel is not a scroll.
    expect(scrollsInside({ overflowY: "auto", scrollHeight: 2001, clientHeight: 2000 })).toBe(false);
  });
  it("is the page when the box can't scroll at all", () => {
    expect(scrollsInside({ overflowY: "visible", scrollHeight: 2000, clientHeight: 600 })).toBe(false);
    expect(scrollsInside({ overflowY: "hidden", scrollHeight: 2000, clientHeight: 600 })).toBe(false);
  });
});

describe("keepBottomTop", () => {
  it("keeps what was at the bottom in place when earlier messages go in above", () => {
    // 400px from the end before; 600px added above; still 400px from the end.
    expect(keepBottomTop({ scrollHeight: 3000, scrollTop: 2600 }, 3600)).toBe(3200);
  });
  it("holds the top of the list at the same message", () => {
    expect(keepBottomTop({ scrollHeight: 1000, scrollTop: 0 }, 1500)).toBe(500);
  });
  it("never goes above the top", () => {
    expect(keepBottomTop({ scrollHeight: 1000, scrollTop: 0 }, 800)).toBe(0);
  });
});
