import { describe, expect, it } from "vitest";
import { isPicture, isPictureName, pictureMime } from "./pictures";

describe("a file that is a picture", () => {
  it("goes by its kind", () => {
    expect(isPicture({ kind: "image", name: "photo" })).toBe(true);
  });
  it("is a picture by its name when the kind came from a vague type", () => {
    expect(isPicture({ kind: "doc", name: "m and m art.png" })).toBe(true);
    expect(isPicture({ kind: "doc", name: "Shot.JPEG" })).toBe(true);
  });
  it("leaves other files and links alone", () => {
    expect(isPicture({ kind: "pdf", name: "flyer.pdf" })).toBe(false);
    expect(isPicture({ kind: "doc", name: "logo.svg" })).toBe(false);
    expect(isPicture({ kind: "link", name: "art.png", url: "https://x.com/art.png" })).toBe(false);
    expect(isPictureName("notes.txt")).toBe(false);
  });
});

describe("the type a picture is stored under", () => {
  it("keeps an image type", () => {
    expect(pictureMime("a.png", "image/png")).toBe("image/png");
  });
  it("names the type from the file when the sender said octet-stream", () => {
    expect(pictureMime("m and m art.png", "application/octet-stream")).toBe("image/png");
    expect(pictureMime("a.jpg", "")).toBe("image/jpeg");
  });
  it("leaves a real other type alone", () => {
    expect(pictureMime("a.png", "application/pdf")).toBeNull();
    expect(pictureMime("notes.txt", "application/octet-stream")).toBeNull();
  });
});
