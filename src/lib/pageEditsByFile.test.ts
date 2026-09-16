import { describe, it, expect } from "vitest";
import { countEdits, withPageEdit, type PageEdit } from "./pageFrameProtocol";
import { replaceSetFiles } from "./imageSet";

// An HTML review version can hold several pages, and a client or teammate can
// reword more than one of them before sending. These pin down that the rewording
// stays with its own page, that a page put back as it was stops counting, and
// that sending swaps only the reworded pages for new files, in place and named.

const edit = (node: number, before: string, after: string): PageEdit => ({ node, i: 0, before, after });

describe("rewording kept page by page", () => {
  it("keeps each page's changes apart", () => {
    let edits = withPageEdit({}, "tdf_a", edit(1, "Hello", "Hi"));
    edits = withPageEdit(edits, "tdf_b", edit(4, "Buy now", "Order today"));
    expect(Object.keys(edits).sort()).toEqual(["tdf_a", "tdf_b"]);
    expect(countEdits(edits)).toBe(2);
  });

  it("merges a second change to the same text on the same page", () => {
    let edits = withPageEdit({}, "tdf_a", edit(1, "Hello", "Hi"));
    edits = withPageEdit(edits, "tdf_a", edit(1, "Hi", "Hey there"));
    expect(edits.tdf_a).toEqual([{ node: 1, i: 0, before: "Hello", after: "Hey there" }]);
    expect(countEdits(edits)).toBe(1);
  });

  it("drops a page once its text is put back as it was, so it is never sent", () => {
    let edits = withPageEdit({}, "tdf_a", edit(1, "Hello", "Hi"));
    edits = withPageEdit(edits, "tdf_b", edit(2, "Old", "New"));
    edits = withPageEdit(edits, "tdf_a", edit(1, "Hi", "Hello"));
    expect(Object.keys(edits)).toEqual(["tdf_b"]);
    expect(countEdits(edits)).toBe(1);
  });

  it("counts nothing when nothing changed", () => {
    expect(countEdits({})).toBe(0);
  });
});

describe("sending reworded pages", () => {
  const set = [
    { file: "tdf_email1", label: "Current partners" },
    { file: "tdf_email2", label: "" },
  ];

  it("swaps only the reworded page, keeping its place and its name", () => {
    expect(replaceSetFiles(set, { tdf_email1: "tdf_new1" })).toEqual([
      { file: "tdf_new1", label: "Current partners" },
      { file: "tdf_email2", label: "" },
    ]);
  });

  it("swaps several pages at once", () => {
    expect(replaceSetFiles(set, { tdf_email1: "tdf_new1", tdf_email2: "tdf_new2" }).map((i) => i.file)).toEqual(["tdf_new1", "tdf_new2"]);
  });

  it("leaves the version as it was when nothing was reworded", () => {
    expect(replaceSetFiles(set, {})).toEqual(set);
  });
});
