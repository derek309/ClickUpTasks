// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("./db", () => ({ TASK_FILES_BUCKET: "task-files" }));

const { isDocFilePath, checkFileName, checkFileSize, shouldCheckpoint, CHECKPOINT_EVERY_MS, docFileFolder } = await import("./taskDocumentFiles");

const DOC = "tdoc_1";
const UUID = "0b3c2a57-1f7e-4c11-9d2e-6a0c9f1b2e3d";

describe("isDocFilePath", () => {
  it("takes a file directly in this document's folder", () => {
    expect(isDocFilePath(DOC, `${docFileFolder(DOC)}${UUID}-logo.png`)).toBe(true);
  });
  it("refuses another document's folder, other areas of the bucket, sub folders and junk", () => {
    expect(isDocFilePath(DOC, `doc/tdoc_2/${UUID}-logo.png`)).toBe(false);
    expect(isDocFilePath(DOC, `waiting/c_1/t_1/${UUID}-logo.png`)).toBe(false);
    expect(isDocFilePath(DOC, `${docFileFolder(DOC)}x/${UUID}-logo.png`)).toBe(false);
    expect(isDocFilePath(DOC, `${docFileFolder(DOC)}${UUID}-../../secret.png`)).toBe(false);
    expect(isDocFilePath(DOC, `${docFileFolder(DOC)}logo.png`)).toBe(false);
    expect(isDocFilePath(DOC, 42)).toBe(false);
  });
});

describe("checkFileName", () => {
  it("cleans a good name and refuses types a browser would run", () => {
    expect(checkFileName('My "Logo".png')).toEqual({ ok: true, name: "My Logo.png" });
    expect(checkFileName("page.html").ok).toBe(false);
    expect(checkFileName("icon.svg").ok).toBe(false);
    expect(checkFileName("").ok).toBe(false);
    expect(checkFileName(null).ok).toBe(false);
  });
});

describe("checkFileSize", () => {
  it("passes a real size under 25 MB and refuses the rest", () => {
    expect(checkFileSize(1024)).toBeNull();
    expect(checkFileSize(25 * 1024 * 1024 + 1)?.status).toBe(413);
    expect(checkFileSize(0)?.status).toBe(400);
    expect(checkFileSize("12")?.status).toBe(400);
  });
});

describe("shouldCheckpoint", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  const recent = new Date(now - 60_000).toISOString();
  const old = new Date(now - CHECKPOINT_EVERY_MS).toISOString();

  it("keeps a Save draft click right away", () => {
    expect(shouldCheckpoint({ body: "<p>b</p>", latestBody: "<p>a</p>", since: recent, explicit: true }, now)).toBe(true);
  });
  it("keeps plain typing only once ten minutes have passed", () => {
    expect(shouldCheckpoint({ body: "<p>b</p>", latestBody: "<p>a</p>", since: recent, explicit: false }, now)).toBe(false);
    expect(shouldCheckpoint({ body: "<p>b</p>", latestBody: "<p>a</p>", since: old, explicit: false }, now)).toBe(true);
  });
  it("never keeps an empty draft or one that matches the last entry", () => {
    expect(shouldCheckpoint({ body: "  ", latestBody: null, since: old, explicit: true }, now)).toBe(false);
    expect(shouldCheckpoint({ body: "<p>a</p>", latestBody: "<p>a</p>", since: old, explicit: true }, now)).toBe(false);
  });
});
