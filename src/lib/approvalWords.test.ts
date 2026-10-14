import { describe, expect, it } from "vitest";
import { readsAsApproval, reviewToApprove } from "./approvalWords";

describe("an email that reads as an approval", () => {
  it("says yes (Brian, t_mv01d2mnx)", () => {
    for (const t of ["approved", "Approved!", "Looks good, go ahead", "perfect, send it", "Love it", "Good to go.", "LGTM", "Yes please send it"]) expect(readsAsApproval(t)).toBe(true);
  });
  it("asks for more, or says no", () => {
    for (const t of ["Looks good but change the headline", "Not approved yet", "Can you swap the photo? Then approved", "approved?", "Thanks, got it", "", "Please fix the logo"]) expect(readsAsApproval(t)).toBe(false);
  });
  it("is short", () => {
    expect(readsAsApproval(`approved ${"word ".repeat(50)}`)).toBe(false);
  });
});

describe("which review an email approves", () => {
  it("the one on the step, else the one out, else the only open one", () => {
    expect(reviewToApprove({ page: { status: "draft", version: 4 }, doc: { status: "with_client", version: 2 } }, ["page"])).toBe("page");
    expect(reviewToApprove({ page: { status: "draft", version: 4 }, doc: { status: "with_client", version: 2 } })).toBe("doc");
    expect(reviewToApprove({ page: { status: "draft", version: 4 } })).toBe("page");
    expect(reviewToApprove({ page: { status: "approved", version: 4 } })).toBeNull();
    expect(reviewToApprove({ page: { status: "draft", version: 0 } })).toBeNull();
    expect(reviewToApprove({ page: { status: "draft", version: 1 }, image: { status: "draft", version: 1 } })).toBeNull();
  });
});
