// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";

// Comments on a specific sentence (Derek, 2026-09-12): the words a comment quotes
// are cleaned before they are stored, and found again in the document to highlight.

vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {}, adminConfigured: true }));
vi.mock("@/lib/db", () => ({ TASK_FILES_BUCKET: "task-files" }));

const { cleanQuote } = await import("./taskDocumentFiles");
const { findQuote } = await import("@/components/cockpit/commentHighlights");

const schema = getSchema([StarterKit]);
const doc = Node.fromJSON(schema, {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Stores IN" }] },
    { type: "paragraph", content: [{ type: "text", text: "Fall race season is in full swing." }] },
    { type: "paragraph", content: [
      { type: "text", text: "Reply with the " },
      { type: "text", marks: [{ type: "bold" }], text: "designs" },
      { type: "text", text: " that are running low." },
    ] },
  ],
});
const found = (quote: string) => {
  const r = findQuote(doc, quote);
  return r ? doc.textBetween(r.from, r.to) : null;
};

describe("findQuote", () => {
  it("finds the words in their paragraph", () => {
    expect(found("race season")).toBe("race season");
  });
  it("finds words that run across bold text", () => {
    expect(found("the designs that are")).toBe("the designs that are");
  });
  it("ignores case when the exact words aren't there", () => {
    expect(found("FALL RACE")).toBe("Fall race");
  });
  it("uses the first line of a quote that spans paragraphs", () => {
    expect(found("full swing.\nReply with")).toBe("full swing.");
  });
  it("is null once the words are gone", () => {
    expect(found("winter sale")).toBeNull();
  });
});

describe("cleanQuote", () => {
  it("keeps one space between words and line breaks between paragraphs", () => {
    expect(cleanQuote("  Fall   race\tseason \r\n\n full swing  ")).toBe("Fall race season\nfull swing");
  });
  it("is null for nothing to quote", () => {
    expect(cleanQuote("   \n ")).toBeNull();
    expect(cleanQuote(42)).toBeNull();
    expect(cleanQuote(undefined)).toBeNull();
  });
  it("caps a long selection", () => {
    expect(cleanQuote("a".repeat(900))).toHaveLength(500);
  });
});
