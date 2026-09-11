import { describe, it, expect } from "vitest";
import { diffDocText, type DiffPart } from "./docDiff";
import { htmlToText } from "./data";

// The team reads this to see what a client changed in a review document, so the
// cases that matter are the everyday edits: a word added, a word cut, a word
// swapped, nothing changed, and only the formatting changed.
const changes = (parts: DiffPart[]) => parts.filter((p) => p.type !== "same").map((p) => `${p.type}:${p.text.trim()}`);

describe("diffDocText", () => {
  it("marks a word the client added", () => {
    const r = diffDocText("<p>Get a hoodie now</p>", "<p>Get a custom hoodie now</p>");
    expect(changes(r.parts)).toEqual(["added:custom"]);
    expect(r.formattingOnly).toBe(false);
  });

  it("marks a word the client cut", () => {
    const r = diffDocText("<p>Get a custom hoodie now</p>", "<p>Get a hoodie now</p>");
    expect(changes(r.parts)).toEqual(["removed:custom"]);
  });

  it("shows a swapped word as one removal and one addition", () => {
    const r = diffDocText("<p>The deal ends tonight</p>", "<p>The deal ends tomorrow</p>");
    expect(changes(r.parts)).toEqual(["removed:tonight", "added:tomorrow"]);
  });

  it("reports no changes for identical versions", () => {
    const r = diffDocText("<p>Same words</p>", "<p>Same words</p>");
    expect(changes(r.parts)).toEqual([]);
    expect(r.formattingOnly).toBe(false);
  });

  it("flags a change that is only formatting", () => {
    const r = diffDocText("<p>Ends tonight</p>", "<p><strong>Ends</strong> tonight</p>");
    expect(changes(r.parts)).toEqual([]);
    expect(r.formattingOnly).toBe(true);
  });

  it("rebuilds the new text from the unchanged and added parts", () => {
    const after = "<p>Get a custom hoodie now for $29</p>";
    const r = diffDocText("<p>Get a hoodie now</p>", after);
    const rebuilt = r.parts.filter((p) => p.type !== "removed").map((p) => p.text).join("");
    expect(rebuilt).toBe(htmlToText(after));
  });
});
