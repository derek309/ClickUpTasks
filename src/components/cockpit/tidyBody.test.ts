import { describe, it, expect } from "vitest";
import { tidyBody } from "@/components/cockpit/TaskMessaging";

describe("tidyBody", () => {
  it("pulls a lone link up onto the sentence that introduces it", () => {
    expect(tidyBody("And the automations\nhttps://app.gohighlevel.com/workflows"))
      .toBe("And the automations https://app.gohighlevel.com/workflows");
  });
  it("leaves a link that was given its own paragraph alone", () => {
    expect(tidyBody("Here you go\n\nhttps://example.com"))
      .toBe("Here you go\n\nhttps://example.com");
  });
  it("does not glue two links together", () => {
    expect(tidyBody("https://one.example\nhttps://two.example"))
      .toBe("https://one.example\nhttps://two.example");
  });
  it("leaves a link that is already inline alone", () => {
    expect(tidyBody("See https://example.com for the list")).toBe("See https://example.com for the list");
  });
  it("collapses stacked blank lines to one break", () => {
    expect(tidyBody("One\n\n\n\nTwo")).toBe("One\n\nTwo");
  });
  it("trims the ends", () => {
    expect(tidyBody("\n\n  Hello  \n\n")).toBe("Hello");
  });
});
