import { diffWords } from "diff";
import { htmlToText } from "./data";

export type DiffPart = { type: "same" | "added" | "removed"; text: string };

/** What changed between two versions of a client review document, word by word.
 *
 *  Compares the TEXT, not the HTML, because the team wants to know what the
 *  client reworded; `formattingOnly` covers the case where every word matches but
 *  the markup does not (a word made bold, a line turned into a heading).
 *
 *  Parts are plain strings. Render them as React text nodes and never inject
 *  them as HTML: they come from whatever the client typed. jsdiff's Myers
 *  algorithm stays fast on long documents with small edits, which is the normal
 *  case, where a hand rolled word table would need memory for every pair. */
export function diffDocText(beforeHtml: string, afterHtml: string): { parts: DiffPart[]; formattingOnly: boolean } {
  const before = htmlToText(beforeHtml);
  const after = htmlToText(afterHtml);
  const parts: DiffPart[] = diffWords(before, after).map((c) => ({
    type: c.added ? "added" : c.removed ? "removed" : "same",
    text: c.value,
  }));
  return { parts, formattingOnly: before === after && beforeHtml.trim() !== afterHtml.trim() };
}

/** What changed between two versions, in a few plain lines for an email drafter:
 *  the wording added and the wording removed. Null when the text is the same
 *  (Derek, 2026-09-11: an email that says "we made changes, here's what changed"). */
export function summarizeDocChanges(beforeHtml: string, afterHtml: string, maxChars = 1500): string | null {
  const { parts } = diffDocText(beforeHtml, afterHtml);
  const pick = (type: DiffPart["type"]) => parts
    .filter((p) => p.type === type)
    .map((p) => p.text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const added = pick("added");
  const removed = pick("removed");
  if (!added.length && !removed.length) return null;
  const summary = [
    added.length ? `Added: ${added.map((t) => `"${t}"`).join(", ")}` : null,
    removed.length ? `Removed: ${removed.map((t) => `"${t}"`).join(", ")}` : null,
  ].filter(Boolean).join("\n");
  return summary.length > maxChars ? `${summary.slice(0, maxChars)}…` : summary;
}
