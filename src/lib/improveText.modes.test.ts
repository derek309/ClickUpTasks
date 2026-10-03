import { describe, it, expect } from "vitest";
import { improvePrompt, cleanImproved, draftReplyPrompt } from "./improveText";

describe("Improve, Shorter and Draft prompts", () => {
  it("asks to keep the tags when the message is HTML", () => {
    const p = improvePrompt("<p>hi <a href=\"https://a.com\">there</a></p>", "email", "shorter", true);
    expect(p).toMatch(/shorter/i);
    expect(p).toMatch(/Keep its tags/);
  });
  it("strips a code fence the model wraps HTML in", () => {
    expect(cleanImproved("```html\n<p>Hi</p>\n```")).toBe("<p>Hi</p>");
  });
  it("puts the task after the conversation and leaves the sign off to the signature", () => {
    const p = draftReplyPrompt({ me: "Derek Fox", them: "James", conversation: "THEM: hi", task: "Title: Homepage" });
    expect(p).toMatch(/Do not add a sign off/);
    expect(p.indexOf("THEM: hi")).toBeLessThan(p.indexOf("Title: Homepage"));
  });
});
