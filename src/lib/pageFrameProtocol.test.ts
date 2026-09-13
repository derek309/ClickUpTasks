import { describe, it, expect } from "vitest";
import { cleanEdit, mergeEdits, readFrameMessage } from "./pageFrameProtocol";

const frame = { name: "the frame's window" };
const from = (data: unknown, source: unknown = frame) => readFrameMessage({ source, data }, frame);
const ANCHOR = { node: 4, nx: 0.5, ny: 0.5, width: 390 };

describe("readFrameMessage", () => {
  it("accepts the bridge's messages from the frame", () => {
    expect(from({ cul: 1, type: "ready" })).toEqual({ type: "ready" });
    expect(from({ cul: 1, type: "place", x: 0.2, y: 0.9, anchor: ANCHOR })).toEqual({ type: "place", x: 0.2, y: 0.9, anchor: ANCHOR });
    expect(from({ cul: 1, type: "place", x: 0.2, y: 0.9 })).toEqual({ type: "place", x: 0.2, y: 0.9, anchor: null });
    expect(from({ cul: 1, type: "pin-click", id: "tdm_0f8fad5b-d9cb-469f-a165-70867728950e" })).toMatchObject({ type: "pin-click" });
    expect(from({ cul: 1, type: "edit", edit: { node: 3, i: 0, before: "Hello", after: "Hi" } })).toMatchObject({ type: "edit" });
  });

  it.each([
    ["another window", { cul: 1, type: "ready" }, { name: "some other window" }],
    ["no source", { cul: 1, type: "ready" }, null],
  ])("ignores a message from %s", (_label, data, source) => {
    expect(from(data, source)).toBeNull();
  });

  it("ignores everything when there is no frame yet", () => {
    expect(readFrameMessage({ source: undefined, data: { cul: 1, type: "ready" } }, undefined)).toBeNull();
  });

  it.each([
    ["no bridge mark", { type: "ready" }],
    ["an unknown type", { cul: 1, type: "steal" }],
    ["a spot off the page", { cul: 1, type: "place", x: 2, y: 0.5 }],
    ["a broken anchor", { cul: 1, type: "place", x: 0.5, y: 0.5, anchor: { node: "3" } }],
    ["a pin id that is not a comment id", { cul: 1, type: "pin-click", id: "javascript:alert(1)" }],
    ["an edit with no words before", { cul: 1, type: "edit", edit: { node: 1, i: 0, before: "  ", after: "x" } }],
    ["an edit that is too long", { cul: 1, type: "edit", edit: { node: 1, i: 0, before: "a", after: "x".repeat(5001) } }],
    ["a string", "ready"],
  ])("refuses %s", (_label, data) => {
    expect(from(data)).toBeNull();
  });
});

describe("cleanEdit", () => {
  it("refuses a negative element or run number", () => {
    expect(cleanEdit({ node: -1, i: 0, before: "a", after: "b" })).toBeNull();
    expect(cleanEdit({ node: 1, i: -1, before: "a", after: "b" })).toBeNull();
  });
});

describe("mergeEdits", () => {
  it("keeps the first words before and the latest words after", () => {
    let edits = mergeEdits([], { node: 2, i: 0, before: "Hello there", after: "Hi there" });
    edits = mergeEdits(edits, { node: 2, i: 0, before: "Hi there", after: "Hey there" });
    expect(edits).toEqual([{ node: 2, i: 0, before: "Hello there", after: "Hey there" }]);
  });

  it("drops a piece of text put back the way it was", () => {
    let edits = mergeEdits([], { node: 2, i: 0, before: "Hello", after: "Hi" });
    edits = mergeEdits(edits, { node: 2, i: 0, before: "Hi", after: " Hello " });
    expect(edits).toEqual([]);
  });

  it("keeps different pieces of text apart", () => {
    let edits = mergeEdits([], { node: 2, i: 0, before: "A", after: "B" });
    edits = mergeEdits(edits, { node: 2, i: 1, before: "C", after: "D" });
    expect(edits).toHaveLength(2);
  });
});
