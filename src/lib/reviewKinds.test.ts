import { describe, it, expect } from "vitest";
import { commentHint, isFileKind, kindNoun, kindQuery, kindTitle, kindWhat, noDocumentYet, parseKind } from "./reviewKinds";

describe("reviewKinds", () => {
  it("reads a kind from anything, and anything unknown is the text document", () => {
    expect(parseKind("image")).toBe("image");
    expect(parseKind("page")).toBe("page");
    expect(parseKind("video")).toBe("video");
    expect(parseKind("doc")).toBe("doc");
    expect(parseKind("PAGE")).toBe("doc");
    expect(parseKind(undefined)).toBe("doc");
    expect(parseKind(null)).toBe("doc");
  });

  it("knows which kinds keep a file id as their body", () => {
    expect(isFileKind("doc")).toBe(false);
    expect(isFileKind("image")).toBe(true);
    expect(isFileKind("page")).toBe(true);
    expect(isFileKind("video")).toBe(true);
  });

  it("names each kind the way the app and the emails already do", () => {
    expect(kindNoun("doc")).toBe("client document");
    expect(kindNoun("image")).toBe("image review");
    expect(kindNoun("page")).toBe("HTML review");
    expect(commentHint("doc")).toBe("Write a comment, or select words in the document to comment on them…");
    expect(commentHint("page")).toBe("Write a comment, or click a spot on the page to comment on it…");
    expect(kindWhat("page")).toBe("page");
    expect(kindTitle("page")).toBe("HTML review");
    expect(noDocumentYet("doc")).toBe("This task has no client document yet.");
    expect(noDocumentYet("image")).toBe("This task has no image review yet.");
    expect(noDocumentYet("page")).toBe("This task has no HTML review yet.");
    expect(kindNoun("video")).toBe("video review");
    expect(kindTitle("video")).toBe("Video review");
    expect(noDocumentYet("video")).toBe("This task has no video review yet.");
    // A video review has no spots to click yet, so its hint promises none.
    expect(commentHint("video")).toBe("Write a comment about the video…");
  });

  it("builds the team route's query string", () => {
    expect(kindQuery("doc")).toBe("");
    expect(kindQuery("page")).toBe("?kind=page");
  });
});
