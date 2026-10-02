import { describe, it, expect } from "vitest";
import { allowEntry, inboundGmailQuery, isBlocked } from "./inbox";

describe("Always let in", () => {
  it("keeps an address, and turns a bare domain into @domain", () => {
    expect(allowEntry(" Jane@Acme.com ")).toBe("jane@acme.com");
    expect(allowEntry("acme.com")).toBe("@acme.com");
    expect(allowEntry("@acme.com")).toBe("@acme.com");
    expect(allowEntry("not an address")).toBeNull();
    expect(allowEntry("a{b}@x.com")).toBeNull();
  });

  it("matches the sender the same way a block does", () => {
    expect(isBlocked("billing@acme.com", ["@acme.com"])).toBe(true);
    expect(isBlocked("jane@acme.com", ["jane@acme.com"])).toBe(true);
    expect(isBlocked("bob@other.com", ["@acme.com"])).toBe(false);
  });

  it("reads every tab, and only the people let in for the catch-up", () => {
    expect(inboundGmailQuery(2, [])).toBe("in:inbox newer_than:2d -from:me");
    expect(inboundGmailQuery(2, ["jane@acme.com", "@kp.org"])).toBe("in:inbox newer_than:2d -from:me");
    expect(inboundGmailQuery(14, ["@kp.org"], true)).toBe("in:inbox {from:kp.org} newer_than:14d -from:me");
  });
});
