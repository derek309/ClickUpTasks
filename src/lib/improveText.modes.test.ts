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

describe("suggest times", async () => {
  const { pickThreeTimes, proposeTimesPrompt } = await import("./improveText");
  it("picks the first time on each of three days, skipping the next two hours", () => {
    const now = Date.parse("2026-10-05T17:00:00Z"); // 10 AM Pacific
    const slots = ["2026-10-05T11:00:00-07:00", "2026-10-05T14:00:00-07:00", "2026-10-05T15:00:00-07:00", "2026-10-06T09:00:00-07:00", "2026-10-06T10:00:00-07:00", "2026-10-08T13:00:00-07:00", "2026-10-09T13:00:00-07:00"];
    expect(pickThreeTimes(slots, now)).toEqual(["2026-10-05T14:00:00-07:00", "2026-10-06T09:00:00-07:00", "2026-10-08T13:00:00-07:00"]);
  });
  it("gives the AI the exact times and the link marker", () => {
    const p = proposeTimesPrompt({ me: "Derek", them: "James", conversation: "THEM: can we meet?", times: ["Tue, Oct 6, 9:00 AM"], minutes: 45 });
    expect(p).toMatch(/- Tue, Oct 6, 9:00 AM/);
    expect(p).toMatch(/\[\[LINK\]\]/);
  });
});
