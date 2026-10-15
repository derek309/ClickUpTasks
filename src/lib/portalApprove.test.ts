import { describe, expect, it } from "vitest";
import { approveBody, docTokenFromUrl } from "./portalApprove";

const TOKEN = "doc_" + "a".repeat(43);

describe("one tap Approve in the portal", () => {
  it("reads the review link's token, and nothing else", () => {
    expect(docTokenFromUrl(`https://tasks.clickuplocal.com/doc/${TOKEN}`)).toBe(TOKEN);
    expect(docTokenFromUrl(`https://tasks.clickuplocal.com/doc/${TOKEN}?back=/waiting/x`)).toBe(TOKEN);
    expect(docTokenFromUrl(`https://tasks.clickuplocal.com/doc/${TOKEN}x`)).toBeNull();
    expect(docTokenFromUrl("https://tasks.clickuplocal.com/doc/doc_short")).toBeNull();
    expect(docTokenFromUrl("")).toBeNull();
  });
  it("approves the version shown, as the review page sends it", () => {
    expect(approveBody("page", { version: 3, body: "f1" })).toEqual({ baseVersion: 3, body: "f1", edits: {} });
    expect(approveBody("image", { version: 2, body: "f1" })).toEqual({ baseVersion: 2 });
    expect(approveBody("video", { version: 1, body: "" })).toEqual({ baseVersion: 1 });
    expect(approveBody("doc", { version: 4, body: "<p>Hi</p>" })).toEqual({ html: "<p>Hi</p>", baseVersion: 4 });
  });
});
