import { describe, it, expect } from "vitest";
import { cleanImageLabel, cleanImageSet, formatImageSet, imageLabel, parseImageSet, pinImageLabel, setFiles, MAX_SET_IMAGES } from "./imageSet";

const id = (n: number) => `tdf_${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`;
const A = id(1);
const B = id(2);

describe("image sets", () => {
  it("reads every review made before sets as a set of one", () => {
    expect(parseImageSet(A)).toEqual([{ file: A, label: "" }]);
    expect(setFiles(A)).toEqual([A]);
    expect(parseImageSet("")).toEqual([]);
    expect(parseImageSet(null)).toEqual([]);
    expect(parseImageSet("[not json")).toEqual([]);
  });

  it("writes one unlabelled image as the plain id, and a set as JSON in order", () => {
    expect(formatImageSet([{ file: A, label: "" }])).toBe(A);
    const body = formatImageSet([{ file: A, label: "" }, { file: B, label: "Inside" }]);
    expect(body).toBe(`[{"file":"${A}","label":""},{"file":"${B}","label":"Inside"}]`);
    expect(parseImageSet(body)).toEqual([{ file: A, label: "" }, { file: B, label: "Inside" }]);
    expect(formatImageSet([{ file: A, label: "Front" }])).toBe(`[{"file":"${A}","label":"Front"}]`);
  });

  it("names two images Front and Back, one Image, and more Image 1, 2, 3, unless typed", () => {
    const two = [{ file: A, label: "" }, { file: B, label: "" }];
    expect([imageLabel(two, 0), imageLabel(two, 1)]).toEqual(["Front", "Back"]);
    expect(imageLabel([{ file: A, label: "" }], 0)).toBe("Image");
    const three = [...two, { file: id(3), label: "" }];
    expect(three.map((_, i) => imageLabel(three, i))).toEqual(["Image 1", "Image 2", "Image 3"]);
    expect(imageLabel([{ file: A, label: "Cover" }, { file: B, label: "" }], 0)).toBe("Cover");
  });

  it("accepts 1 to 10 different real images, and cleans labels", () => {
    expect(cleanImageSet([{ file: A, label: "  Front – side\n" }, { file: B }])).toEqual([{ file: A, label: "Front side" }, { file: B, label: "" }]);
    expect(cleanImageSet([])).toBeNull();
    expect(cleanImageSet([{ file: A }, { file: A }])).toBeNull();
    expect(cleanImageSet([{ file: "tdf_nope" }])).toBeNull();
    expect(cleanImageSet(Array.from({ length: MAX_SET_IMAGES + 1 }, (_, i) => ({ file: id(i + 1) })))).toBeNull();
    expect(cleanImageSet("not a list")).toBeNull();
    expect(cleanImageLabel("x".repeat(60))).toHaveLength(40);
  });

  it("tells a pin's image apart only when its version has more than one", () => {
    const set = formatImageSet([{ file: A, label: "" }, { file: B, label: "" }]);
    expect(pinImageLabel([set, A], B)).toBe("Back");
    expect(pinImageLabel([A], A)).toBeNull();
    expect(pinImageLabel([set], id(9))).toBeNull();
  });
});
