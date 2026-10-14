import { describe, it, expect } from "vitest";
import { clientFirstName } from "./clientFirstName";

describe("clientFirstName", () => {
  it("uses the contact's first name when the contact is a person", () => {
    expect(clientFirstName({ name: "Kim Lee" }, "The Artist Workshop")).toBe("Kim");
    expect(clientFirstName({ name: "  Pam   Macias " }, "Pam Macias")).toBe("Pam");
  });
  it("never says The: a business keeps its whole name", () => {
    expect(clientFirstName(null, "The Artist Workshop")).toBe("The Artist Workshop");
    expect(clientFirstName({ name: "The Artist Workshop" }, "The Artist Workshop")).toBe("The Artist Workshop");
  });
  it("treats a contact named for its company, an email or Unnamed contact as no person", () => {
    expect(clientFirstName({ name: "Fairway Homes", company: "fairway homes" }, "Fairway Homes")).toBe("Fairway Homes");
    expect(clientFirstName({ name: "kim@example.com" }, "Kim's Bakery")).toBe("Kim's Bakery");
    expect(clientFirstName({ name: "Unnamed contact" }, "Lincoln Automotive")).toBe("Lincoln Automotive");
  });
  it("falls back when there is no name at all", () => {
    expect(clientFirstName(null, "  ")).toBe("them");
    expect(clientFirstName({ name: "" }, "", "there")).toBe("there");
  });
});
