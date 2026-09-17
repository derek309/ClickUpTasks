import { describe, it, expect } from "vitest";
import { cleanAnchor, cleanPin, formatPinTime, publishedFiles, MAX_PIN_SECONDS } from "./reviewPins";

const FILE = "tdf_0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "tdf_7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ANCHOR = { node: 12, nx: 0.25, ny: 0.5, width: 1280 };

describe("cleanPin", () => {
  it("keeps a spot on an image, rounded to four places", () => {
    expect(cleanPin({ fileId: FILE, x: 0.123456, y: 1 })).toEqual({ fileId: FILE, x: 0.1235, y: 1, anchor: null, t: null });
  });

  it("keeps a pin on a web page with its anchor", () => {
    expect(cleanPin({ fileId: FILE, x: 0.4, y: 0.1, anchor: ANCHOR })).toEqual({ fileId: FILE, x: 0.4, y: 0.1, anchor: ANCHOR, t: null });
  });

  it("keeps a moment in a video, rounded to a tenth, with no spot", () => {
    expect(cleanPin({ fileId: FILE, t: 42.37 })).toEqual({ fileId: FILE, x: null, y: null, anchor: null, t: 42.4 });
    expect(cleanPin({ fileId: FILE, t: 0 })).toEqual({ fileId: FILE, x: null, y: null, anchor: null, t: 0 });
  });

  it.each([
    ["nothing", null],
    // A pin is a spot or a moment, never both: the database says the same.
    ["a moment and a spot together", { fileId: FILE, x: 0.5, y: 0.5, t: 12 }],
    ["a moment with an anchor", { fileId: FILE, t: 12, anchor: ANCHOR }],
    ["a moment before the video starts", { fileId: FILE, t: -1 }],
    ["a moment past the longest video", { fileId: FILE, t: MAX_PIN_SECONDS + 1 }],
    ["a moment that is not a number", { fileId: FILE, t: "12" }],
    ["an infinite moment", { fileId: FILE, t: Infinity }],
    ["neither a spot nor a moment", { fileId: FILE }],
    ["a spot off the image", { fileId: FILE, x: 1.2, y: 0.5 }],
    ["a negative spot", { fileId: FILE, x: 0.5, y: -0.1 }],
    ["a spot that is not a number", { fileId: FILE, x: "0.5", y: 0.5 }],
    ["an infinite spot", { fileId: FILE, x: Infinity, y: 0.5 }],
    ["something that is not a file id", { fileId: "../doc/secret", x: 0.5, y: 0.5 }],
    ["a broken anchor", { fileId: FILE, x: 0.5, y: 0.5, anchor: { node: -1, nx: 0.5, ny: 0.5, width: 1280 } }],
  ])("refuses %s", (_label, raw) => {
    expect(cleanPin(raw)).toBeNull();
  });
});

describe("formatPinTime", () => {
  it("reads as a video's own clock, with hours only once there are any", () => {
    expect(formatPinTime(0)).toBe("0:00");
    expect(formatPinTime(42.9)).toBe("0:42");
    expect(formatPinTime(95)).toBe("1:35");
    expect(formatPinTime(3903)).toBe("1:05:03");
  });
});

describe("cleanAnchor", () => {
  it.each([
    ["a fractional element number", { ...ANCHOR, node: 1.5 }],
    ["a spot outside the element", { ...ANCHOR, nx: 1.01 }],
    ["a width too narrow to be a page", { ...ANCHOR, width: 100 }],
    ["a width too wide", { ...ANCHOR, width: 5000 }],
    ["a width that is not whole", { ...ANCHOR, width: 390.5 }],
  ])("refuses %s", (_label, raw) => {
    expect(cleanAnchor(raw)).toBeNull();
  });
});

describe("publishedFiles", () => {
  it("lists each file the client was shown once, oldest first", () => {
    expect(publishedFiles([
      { version: 3, body: OTHER },
      { version: 1, body: FILE },
      { version: 2, body: FILE },
      { version: 4, body: OTHER },
    ])).toEqual([FILE, OTHER]);
  });

  it("counts a page the client edited, which is a new file", () => {
    expect(publishedFiles([{ version: 1, body: FILE }, { version: 2, body: OTHER }])).toEqual([FILE, OTHER]);
  });

  it("skips an empty body", () => {
    expect(publishedFiles([{ version: 1, body: "" }])).toEqual([]);
  });
});
