import { describe, expect, it, vi } from "vitest";
vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: {}, adminConfigured: true }));
const { siteBase } = await import("./clientWebsite");

describe("a client's website address", () => {
  it("is tidied to https with no trailing slash", () => {
    expect(siteBase("paminsuranceca.com/")).toBe("https://paminsuranceca.com");
    expect(siteBase("https://www.example.com/blog/")).toBe("https://www.example.com/blog");
  });
  it("refuses plain http and nonsense", () => {
    expect(siteBase("http://example.com")).toBeNull();
    expect(siteBase("")).toBeNull();
  });
});
