import { describe, it, expect } from "vitest";
import { clientFirstName, clientIsBusiness } from "./clientFirstName";

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
  it("uses the first word of a client named for a person when the contact gives no person", () => {
    expect(clientFirstName(null, "Carol Lindenmuth")).toBe("Carol");
    expect(clientFirstName({ name: "" }, "Pamela Macias")).toBe("Pamela");
    expect(clientFirstName({ name: "Unnamed contact" }, "Carol Lindenmuth")).toBe("Carol");
  });
  it("keeps the whole name of a client that looks like a business", () => {
    expect(clientFirstName(null, "The Artist Workshop")).toBe("The Artist Workshop");
    expect(clientFirstName(null, "Trinity Insurance Partners")).toBe("Trinity Insurance Partners");
    expect(clientFirstName(null, "Lincoln Automotive")).toBe("Lincoln Automotive");
    expect(clientFirstName(null, "Acme Widgets Sales Team West")).toBe("Acme Widgets Sales Team West");
    expect(clientFirstName(null, "Brandon & Vanessa")).toBe("Brandon & Vanessa");
  });
  it("tells a business from a person", () => {
    for (const b of ["The Artist Workshop", "Trinity Insurance Partners", "Smith Realty", "Oak Studio", "Hill Club", "Blue LLC", "Red Inc.", "One Two Three Four"]) expect(clientIsBusiness(b)).toBe(true);
    for (const p of ["Carol Lindenmuth", "Pamela Macias", "Jack Flynn", "Mary Ann Smith"]) expect(clientIsBusiness(p)).toBe(false);
  });
});
