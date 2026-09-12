import { describe, it, expect } from "vitest";
import { cleanPin, sentImages } from "./imagePins";

const FILE = "tdf_0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "tdf_7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("cleanPin", () => {
  it("keeps a spot on an image, rounded to four places", () => {
    expect(cleanPin({ fileId: FILE, x: 0.123456, y: 1 })).toEqual({ fileId: FILE, x: 0.1235, y: 1 });
  });

  it.each([
    ["nothing", null],
    ["a spot off the image", { fileId: FILE, x: 1.2, y: 0.5 }],
    ["a negative spot", { fileId: FILE, x: 0.5, y: -0.1 }],
    ["a spot that is not a number", { fileId: FILE, x: "0.5", y: 0.5 }],
    ["an infinite spot", { fileId: FILE, x: Infinity, y: 0.5 }],
    ["something that is not an image file id", { fileId: "../doc/secret", x: 0.5, y: 0.5 }],
  ])("refuses %s", (_label, raw) => {
    expect(cleanPin(raw)).toBeNull();
  });
});

describe("sentImages", () => {
  it("lists each image the client was sent once, oldest first", () => {
    expect(sentImages([
      { version: 3, kind: "sent", body: OTHER },
      { version: 1, kind: "sent", body: FILE },
      { version: 2, kind: "client_submitted", body: FILE },
      { version: 4, kind: "client_approved", body: OTHER },
    ])).toEqual([FILE, OTHER]);
  });

  it("does not count an image only the client's answer carried", () => {
    expect(sentImages([{ version: 1, kind: "client_submitted", body: FILE }])).toEqual([]);
  });
});
