import { describe, it, expect } from "vitest";
import { sidebarWidthFor, SIDEBAR_MIN_PX, SIDEBAR_MAX_PX, SIDEBAR_CHROME_PX } from "./sidebarWidth";

// 8px a letter is close enough to 15px Inter to reason about.
const measure = (s: string) => s.length * 8;

describe("sidebar width", () => {
  it("stays at the old width when every name already fits", () => {
    expect(sidebarWidthFor(["Kim Fox", "Personal"], measure)).toBe(SIDEBAR_MIN_PX);
  });
  it("grows to fit the longest name", () => {
    expect(sidebarWidthFor(["Kim Fox", "Carol Lindenmuth Reading"], measure)).toBe(24 * 8 + SIDEBAR_CHROME_PX);
  });
  it("never grows past the cap, where the name truncates instead", () => {
    expect(sidebarWidthFor(["Shobhana Beauty Studio – Beauty & Hair Salon In Grant Line Road"], measure)).toBe(SIDEBAR_MAX_PX);
  });
  it("is the old width with nothing to show", () => {
    expect(sidebarWidthFor([], measure)).toBe(SIDEBAR_MIN_PX);
  });
});
