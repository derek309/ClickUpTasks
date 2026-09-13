import { describe, it, expect } from "vitest";
import { isFileKind, kindNoun, kindQuery, kindTitle, kindWhat, noDocumentYet, parseKind } from "./reviewKinds";

describe("reviewKinds", () => {
  it("reads a kind from anything, and anything unknown is the text document", () => {
    expect(parseKind("image")).toBe("image");
    expect(parseKind("page")).toBe("page");
    expect(parseKind("doc")).toBe("doc");
    expect(parseKind("PAGE")).toBe("doc");
    expect(parseKind(undefined)).toBe("doc");
    expect(parseKind(null)).toBe("doc");
  });

  it("knows which kinds keep a file id as their body", () => {
    expect(isFileKind("doc")).toBe(false);
    expect(isFileKind("image")).toBe(true);
    expect(isFileKind("page")).toBe(true);
  });

  it("names each kind the way the app and the emails already do", () => {
    expect(kindNoun("doc")).toBe("client document");
    expect(kindNoun("image")).toBe("image");
    expect(kindNoun("page")).toBe("web page");
    expect(kindWhat("page")).toBe("page");
    expect(kindTitle("page")).toBe("Web page review");
    expect(noDocumentYet("doc")).toBe("This task has no client document yet.");
    expect(noDocumentYet("image")).toBe("This task has no image review yet.");
    expect(noDocumentYet("page")).toBe("This task has no web page review yet.");
  });

  it("builds the team route's query string", () => {
    expect(kindQuery("doc")).toBe("");
    expect(kindQuery("page")).toBe("?kind=page");
  });
});
