import { describe, expect, it } from "vitest";
import { nextStepFromContext, whatsNextContext } from "./nextStepSuggest";

describe("the next step a What's next context asks for", () => {
  it("reads the original ask (t_mv01d2mnx)", () => {
    expect(nextStepFromContext("Brian approved the designed version (version 4) by email; Derek marked it approved. His original ask: put it in the Bulk customers blast."))
      .toBe("Put it in the Bulk customers blast");
  });
  it("reads wants us to, and a sentence that starts with a doing word", () => {
    expect(nextStepFromContext("Pam wants us to schedule the October post.")).toBe("Schedule the October post");
    expect(nextStepFromContext("Looks good. Send the final file to the printer!")).toBe("Send the final file to the printer");
  });
  it("asks nothing when the words ask nothing", () => {
    expect(nextStepFromContext("Brian approved it.")).toBeNull();
    expect(nextStepFromContext("")).toBeNull();
    expect(nextStepFromContext(null)).toBeNull();
  });
  it("reads the closest context first", () => {
    expect(whatsNextContext({ notes: "Ask: post it", prevNotes: "Build it", description: "" })).toBe("Ask: post it\n\nBuild it");
  });
});
