import { describe, it, expect } from "vitest";
import { emailWindowTitle, recipientName } from "./emailHeader";

describe("emailWindowTitle", () => {
  it("is the email itself: the person's first name and the subject", () => {
    expect(emailWindowTitle("Ryan Smith", "ryan@x.com", "Please review: October Newsletter", "Draft email"))
      .toBe("Email to Ryan: Please review: October Newsletter");
  });
  it("drops the colon until there is a subject", () => {
    expect(emailWindowTitle("Ryan Smith", "ryan@x.com", "   ", "Draft email")).toBe("Email to Ryan");
  });
  it("calls a business by its whole name, not its first word", () => {
    expect(emailWindowTitle("The Artist Workshop", "hi@aw.com", "Hello")).toBe("Email to The Artist Workshop: Hello");
  });
  it("uses the address when there is no name worth showing", () => {
    expect(emailWindowTitle(null, "ryan@x.com", "Hi")).toBe("Email to ryan@x.com: Hi");
    expect(emailWindowTitle("Unnamed contact", "ryan@x.com", "")).toBe("Email to ryan@x.com");
    expect(emailWindowTitle("ryan@x.com", "ryan@x.com", "")).toBe("Email to ryan@x.com");
  });
  it("falls back to the window's own name with nobody to send to", () => {
    expect(emailWindowTitle(null, null, "", "Draft email")).toBe("Draft email");
    expect(emailWindowTitle(null, null, "Hi", "Draft email")).toBe("Draft email: Hi");
  });
});

describe("recipientName", () => {
  it("keeps a real name, tidied", () => {
    expect(recipientName("  Derek   Fox ")).toBe("Derek Fox");
  });
  it("has none for a blank, an address or Unnamed contact", () => {
    expect(recipientName("")).toBeNull();
    expect(recipientName(null)).toBeNull();
    expect(recipientName("a@b.com")).toBeNull();
    expect(recipientName("unnamed contact")).toBeNull();
  });
});
