import { describe, expect, it } from "vitest";
import { signatureCut } from "./data";

const cut = (text: string, signer?: string) => { const at = signatureCut(text, signer); return at < 0 ? text : text.slice(0, at).trimEnd(); };

describe("signatureCut", () => {
  it("keeps a first name sign off and folds the legal text under it", () => {
    const t = "done\n\nBrian\n\nBibBoards is a registered trademark of BibBoards, Inc.\nBibBoards products are patented";
    expect(cut(t, "Brian Goodell")).toBe("done\n\nBrian");
  });
  it("folds a signature block that starts with the full name", () => {
    const t = "If there are none, what happened?\n\nAmanda Standley\nDirector, Loomis Basin Chamber\n916.660.5062";
    expect(cut(t, "Amanda Standley")).toBe("If there are none, what happened?");
  });
  it("folds at a -- line", () => {
    expect(cut("Thanks!\n-- \nJo\nAcme", "Jo")).toBe("Thanks!");
  });
  it("leaves a message that only ends with the first name alone", () => {
    expect(cut("See you then,\nBrian", "Brian Goodell")).toBe("See you then,\nBrian");
  });
  it("does nothing without a signer or a match", () => {
    expect(signatureCut("Hello there", null)).toBe(-1);
    expect(signatureCut("Hello there\nBob", "Brian Goodell")).toBe(-1);
  });
});
