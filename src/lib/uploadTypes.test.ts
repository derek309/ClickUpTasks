// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  extOf, isShareableFileName, sharedFileKind, isActiveContentType,
  cleanFileName, storageSafeName, formatFileSize, MAX_SHARED_FILE_BYTES,
} from "./uploadTypes";

describe("isShareableFileName", () => {
  it("takes photos, documents, sheets, slides and clips in any case", () => {
    for (const n of ["logo.PNG", "brief.pdf", "copy.docx", "plan.xlsx", "deck.key", "clip.mov"]) {
      expect(isShareableFileName(n)).toBe(true);
    }
  });
  it("refuses anything a browser would run, and names with no extension", () => {
    for (const n of ["page.html", "icon.svg", "feed.xml", "app.js", "x.htm", "README", "trick.pdf.html"]) {
      expect(isShareableFileName(n)).toBe(false);
    }
  });
});

describe("extOf", () => {
  it("is empty without a dot and the last part otherwise", () => {
    expect(extOf("file")).toBe("");
    expect(extOf("a.b.JPG")).toBe("jpg");
  });
});

describe("sharedFileKind", () => {
  it("sorts by extension", () => {
    expect(sharedFileKind("a.heic")).toBe("image");
    expect(sharedFileKind("a.pdf")).toBe("pdf");
    expect(sharedFileKind("a.csv")).toBe("sheet");
    expect(sharedFileKind("a.mp4")).toBe("video");
    expect(sharedFileKind("a.docx")).toBe("doc");
  });
});

describe("isActiveContentType", () => {
  it("flags types a browser renders as code", () => {
    for (const t of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/javascript", "application/ecmascript"]) {
      expect(isActiveContentType(t)).toBe(true);
    }
    for (const t of ["image/png", "application/pdf", "video/mp4", ""]) expect(isActiveContentType(t)).toBe(false);
  });
});

describe("cleanFileName", () => {
  it("drops quotes, backslashes and control characters, and caps the length", () => {
    expect(cleanFileName('a"b\\c\r\nd.pdf')).toBe("abcd.pdf");
    expect(cleanFileName("x".repeat(300))).toHaveLength(200);
    expect(cleanFileName("  ")).toBe("file");
  });
});

describe("storageSafeName", () => {
  it("keeps only safe path characters and never a slash", () => {
    expect(storageSafeName("../My Logo (final).png")).toBe(".._My_Logo_final_.png");
    expect(storageSafeName("a/b.pdf")).not.toContain("/");
  });
});

describe("formatFileSize", () => {
  it("reads in B, KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(MAX_SHARED_FILE_BYTES)).toBe("25.0 MB");
  });
});
