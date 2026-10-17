import { describe, it, expect } from "vitest";
import { inboxLoadState, shouldApplyRead } from "./inboxModel";

describe("the Inbox shows nothing until its own read is in", () => {
  it("is loading before the first read, ready after it, failed only when the first read failed", () => {
    expect(inboxLoadState(false, null)).toBe("loading");
    expect(inboxLoadState(false, "network down")).toBe("failed");
    expect(inboxLoadState(true, null)).toBe("ready");
    // A refresh that fails later keeps the list showing.
    expect(inboxLoadState(true, "network down")).toBe("ready");
  });
});

describe("a bad read never replaces a good list", () => {
  const good = { messages: 900, states: 1248, convs: 40 };
  it("takes the first read whatever it holds", () => {
    expect(shouldApplyRead(null, { messages: 0, states: 0, convs: 0, partial: false })).toBe(true);
  });
  it("takes a normal read", () => {
    expect(shouldApplyRead(good, { messages: 905, states: 1250, convs: 41, partial: false })).toBe(true);
  });
  it("refuses a read with none of your marks when you had some", () => {
    expect(shouldApplyRead(good, { messages: 905, states: 0, convs: 41, partial: false })).toBe(false);
    expect(shouldApplyRead(good, { messages: 0, states: 0, convs: 41, partial: true })).toBe(false);
  });
  it("refuses a full read that came back with no messages or no conversations", () => {
    expect(shouldApplyRead(good, { messages: 0, states: 1248, convs: 40, partial: false })).toBe(false);
    expect(shouldApplyRead(good, { messages: 900, states: 1248, convs: 0, partial: false })).toBe(false);
    expect(shouldApplyRead(good, { messages: 0, states: 0, convs: 0, partial: false })).toBe(false);
  });
  it("takes a refresh of changed rows that brought no messages", () => {
    expect(shouldApplyRead(good, { messages: 0, states: 1248, convs: 40, partial: true })).toBe(true);
  });
  it("takes an empty read when nothing was there before", () => {
    expect(shouldApplyRead({ messages: 0, states: 0, convs: 0 }, { messages: 0, states: 0, convs: 0, partial: false })).toBe(true);
  });
});
