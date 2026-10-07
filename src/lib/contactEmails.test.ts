import { describe, it, expect } from "vitest";
import { ghlExtraEmails, mergeExtraEmails, missingExtraColumn } from "./contactEmails";

// Carol's address changed in GoHighLevel (Derek, 2026-10-07): her old one
// must keep matching her, and GoHighLevel's additional emails come along.
describe("a contact's other email addresses", () => {
  it("reads GoHighLevel's additional emails as strings or { email }", () => {
    expect(ghlExtraEmails({ additionalEmails: ["A@x.com", { email: "b@x.com" }, "", "nope", { email: "a@x.com" }] })).toEqual(["a@x.com", "b@x.com"]);
    expect(ghlExtraEmails({})).toEqual([]);
    expect(ghlExtraEmails(null)).toEqual([]);
  });
  it("keeps the old main address when it changes, never the new one", () => {
    expect(mergeExtraEmails("carol@k2omnigroup.com", "Carol.Lindenmuth@exprealty.com", [], [])).toEqual(["carol.lindenmuth@exprealty.com"]);
    expect(mergeExtraEmails("carol@k2omnigroup.com", "carol@k2omnigroup.com", ["old@x.com"], ["carol@k2omnigroup.com", "new@x.com"])).toEqual(["new@x.com", "old@x.com"]);
  });
  it("adds nothing when there is nothing else", () => {
    expect(mergeExtraEmails("a@x.com", null, null, [])).toEqual([]);
  });
  it("knows when the column isn't there yet", () => {
    expect(missingExtraColumn({ message: 'column "additional_emails" does not exist' })).toBe(true);
    expect(missingExtraColumn({ message: "other" })).toBe(false);
    expect(missingExtraColumn(null)).toBe(false);
  });
});
