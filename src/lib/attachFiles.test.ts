import { describe, it, expect } from "vitest";
import type { Attachment } from "@/lib/data";
import { attachCopy, canShowPicture, displayFileName, fileTypeLabel, isLinkItem, taskAttachChoices } from "./attachFiles";

const file = (over: Partial<Attachment> & { id: string; name: string }): Attachment => ({ kind: "image", size: "", ...over });

describe("displayFileName", () => {
  it("cleans the old Gmail clipper's names", () => {
    expect(displayFileName("bibSNAP%20%20floor%20matt%20.png:https://mail.google.com/mail/u/0")).toBe("bibSNAP floor matt.png");
    expect(displayFileName("retail%20wire%20rack%20image.jpeg:https://mail.google.com/mail/u/0")).toBe("retail wire rack image.jpeg");
    expect(displayFileName("6-ft-rack.jpeg.jpg:https://mail.google.com/mail/u/0")).toBe("6-ft-rack.jpeg.jpg");
  });
  it("leaves a good name alone", () => {
    expect(displayFileName("Screenshot")).toBe("Screenshot");
    expect(displayFileName("contract v3.pdf")).toBe("contract v3.pdf");
    expect(displayFileName("screenshot 2026-08-28 at 10:31:12.png")).toBe("screenshot 2026-08-28 at 10:31:12.png");
    expect(displayFileName("100% done.pdf")).toBe("100% done.pdf");
  });
  it("strips an http suffix and an escaped one", () => {
    expect(displayFileName("plan.pdf:http://example.com/x")).toBe("plan.pdf");
    expect(displayFileName("plan%20B.pdf%3Ahttps%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0")).toBe("plan B.pdf");
  });
  it("keeps a broken escape and never returns nothing", () => {
    expect(displayFileName("a%2 b%20c.png")).toBe("a%2 b c.png");
    expect(displayFileName("")).toBe("File");
    expect(displayFileName("https://example.com/a.png")).toBe("https://example.com/a.png");
  });
});

describe("fileTypeLabel and canShowPicture", () => {
  it("labels a file by its real extension", () => {
    expect(fileTypeLabel({ name: "plan.pdf:https://mail.google.com/mail/u/0", kind: "doc" })).toBe("PDF");
    expect(fileTypeLabel({ name: "notes", kind: "doc" })).toBe("FILE");
  });
  it("draws a clipped picture once its name is clean", () => {
    expect(canShowPicture({ name: "bibSNAP%20%20floor%20matt%20.png:https://mail.google.com/mail/u/0", kind: "doc", path: "t/1.png" })).toBe(true);
    expect(canShowPicture({ name: "Screenshot", kind: "image", path: "t/2.png" })).toBe(true);
    expect(canShowPicture({ name: "photo.heic", kind: "image", path: "t/3.heic" })).toBe(false);
    expect(canShowPicture({ name: "a.png", kind: "image" })).toBe(false);
  });
});

describe("taskAttachChoices", () => {
  const gmailLink = file({ id: "l1", name: "Open the email in Gmail", kind: "link", url: "https://mail.google.com/mail/u/0/#inbox/abc" });
  const drive = file({ id: "l2", name: "Drive folder", kind: "link", url: "https://drive.google.com/x" });
  const rack = file({ id: "f1", name: "6-ft-rack.jpeg.jpg:https://mail.google.com/mail/u/0", path: "t/rack.jpg" });
  const shot = file({ id: "f2", name: "Screenshot", path: "t/shot.png" });
  const pdf = file({ id: "f3", name: "quote.pdf", kind: "pdf", path: "t/quote.pdf" });
  const inGmail = file({ id: "g1", name: "big.zip", kind: "doc", gmailAttachmentId: "ANGjd" });

  it("never offers a link", () => {
    const ids = taskAttachChoices([gmailLink, drive, rack], []).map((c) => c.item.id);
    expect(ids).toEqual(["f1"]);
    expect(isLinkItem(gmailLink)).toBe(true);
    expect(isLinkItem(rack)).toBe(false);
  });
  it("marks what is attached and what is not", () => {
    const choices = taskAttachChoices([rack, shot, pdf], [attachCopy(shot, "a_1")]);
    expect(choices.map((c) => [c.item.id, c.state])).toEqual([["f1", "available"], ["f2", "attached"], ["f3", "available"]]);
  });
  it("greys a file that only Gmail has", () => {
    expect(taskAttachChoices([inGmail], [])).toEqual([{ item: inGmail, state: "gmailOnly" }]);
  });
  it("offers one stored file once", () => {
    expect(taskAttachChoices([rack, { ...rack, id: "f1b" }], [])).toHaveLength(1);
  });
  it("attaches a copy under the readable name", () => {
    const copy = attachCopy(rack, "a_9");
    expect(copy).toMatchObject({ id: "a_9", name: "6-ft-rack.jpeg.jpg", path: "t/rack.jpg" });
    expect(rack.name).toBe("6-ft-rack.jpeg.jpg:https://mail.google.com/mail/u/0");
  });
});
