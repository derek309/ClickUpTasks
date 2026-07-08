import { describe, it, expect } from "vitest";
import { titleCase } from "./db";

describe("titleCase (contact/client display names)", () => {
  it("capitalizes each lowercase word", () => {
    expect(titleCase("amanda standley")).toBe("Amanda Standley");
    expect(titleCase("bob accardo")).toBe("Bob Accardo");
  });
  it("leaves existing capitals and digits alone", () => {
    expect(titleCase("ABC Corp")).toBe("ABC Corp");
    expect(titleCase("24 hour fitness")).toBe("24 Hour Fitness");
  });
  it("handles empty input", () => {
    expect(titleCase("")).toBe("");
  });
});
