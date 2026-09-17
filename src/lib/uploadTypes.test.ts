// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  extOf, isShareableFileName, isPreviewableImage, sharedFileKind, isActiveContentType,
  cleanFileName, storageSafeName, formatFileSize, isReviewVideo, maxUploadBytes,
  MAX_SHARED_FILE_BYTES, MAX_VIDEO_BYTES,
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

describe("isPreviewableImage", () => {
  it("previews what a browser can draw and nothing else", () => {
    for (const n of ["a.PNG", "b.jpg", "c.jpeg", "d.gif", "e.webp"]) expect(isPreviewableImage(n)).toBe(true);
    for (const n of ["f.heic", "g.pdf", "h.svg", "photo"]) expect(isPreviewableImage(n)).toBe(false);
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

describe("isReviewVideo and maxUploadBytes", () => {
  it("takes only the video extensions a browser plays, in any case", () => {
    for (const n of ["cut.mp4", "Cut.MOV", "cut.webm", "cut.m4v"]) expect(isReviewVideo(n)).toBe(true);
    for (const n of ["logo.png", "brief.pdf", "cut.avi", "cut.mkv", "cut"]) expect(isReviewVideo(n)).toBe(false);
  });
  it("raises the cap for a video review's video and nothing else", () => {
    expect(maxUploadBytes("video")).toBe(MAX_VIDEO_BYTES);
    expect(maxUploadBytes("file")).toBe(MAX_SHARED_FILE_BYTES);
    expect(maxUploadBytes("image")).toBe(MAX_SHARED_FILE_BYTES);
  });
});

describe("formatFileSize", () => {
  it("reads in B, KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(MAX_SHARED_FILE_BYTES)).toBe("25 MB");
    expect(formatFileSize(MAX_VIDEO_BYTES)).toBe("500 MB");
  });
});
