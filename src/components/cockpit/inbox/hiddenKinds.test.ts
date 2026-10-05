import { describe, it, expect } from "vitest";
import { isHiddenKind } from "./inboxModel";

describe("kinds kept out of someone's Inbox", () => {
  it("hides the kinds named, social covering all four, and never team or client chats", () => {
    const hide = ["email", "sms", "social", "call"];
    for (const c of ["email", "sms", "call", "fb", "ig", "web", "gbp"]) expect(isHiddenKind({ channel: c }, hide)).toBe(true);
    expect(isHiddenKind({ channel: "team" }, hide)).toBe(false);
    expect(isHiddenKind({ channel: "chat" }, hide)).toBe(false);
    expect(isHiddenKind({ channel: "email" }, undefined)).toBe(false);
  });
});
