import { describe, it, expect } from "vitest";
import { smsText } from "./smsText";

describe("smsText", () => {
  it("turns the editor's HTML into lines, links written out", () => {
    const html = '<p>Haha, sorry you got mixed up in that. <br><br>Do you have time next week? <a target="_blank" rel="noopener" href="https://api.leadconnectorhq.com/widget/booking/abc">book a time here</a> <br><br>- Derek Fox; ClickUpLocal </p>';
    expect(smsText(html)).toBe("Haha, sorry you got mixed up in that.\n\nDo you have time next week? book a time here: https://api.leadconnectorhq.com/widget/booking/abc\n\n- Derek Fox; ClickUpLocal");
  });
  it("leaves plain text alone, and a bare link stays a link", () => {
    expect(smsText("Perfect, me too.")).toBe("Perfect, me too.");
    expect(smsText('<p><a href="https://x.com">https://x.com</a> &amp; more</p>')).toBe("https://x.com & more");
  });
});
