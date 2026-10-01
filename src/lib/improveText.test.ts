import { describe, it, expect } from "vitest";
import { improvePrompt, cleanImproved } from "./improveText";

describe("Improve with AI", () => {
  it("asks for fixes only, never dashes", () => {
    const p = improvePrompt("hi pam thanks for the fotos", "email");
    expect(p).toContain("Keep the writer's own words");
    expect(p).toContain("Never use em dashes");
    expect(p.endsWith("hi pam thanks for the fotos")).toBe(true);
  });
  it("keeps a text short", () => {
    expect(improvePrompt("yep ill have it up tonite", "sms")).toContain("text message");
  });
  it("strips quotes, labels and any dash the model slipped in", () => {
    expect(cleanImproved('"Hi Pam — thanks for the photos."')).toBe("Hi Pam, thanks for the photos.");
    expect(cleanImproved("MESSAGE: Sounds good.\n")).toBe("Sounds good.");
  });
});
