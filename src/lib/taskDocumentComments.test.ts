// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Posting a comment with a pin, against a small fake of the tables it touches.
// The rule under test is the one that keeps a pin honest: a video's comment
// marks a MOMENT (pin_t, no spot), every other kind's marks a SPOT (x and y, no
// moment). The database check says the same thing, so a mismatch that slipped
// through here would be a 500 from Postgres rather than a message anyone can act
// on, and a spot stored on a video would put its pin at the top left corner.

type Row = Record<string, any>;
let versionFile: Row | null;
let inserted: Row[];

function builder(table: string) {
  const b: any = {
    _table: table,
    select: () => b,
    insert: (row: Row) => { inserted.push(row); return Promise.resolve({ error: null }); },
    eq: () => b,
    is: () => b,
    in: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve({
      data: table === "task_document_files" ? versionFile : null,
      error: null,
    }),
    then: (resolve: (r: { data: Row[]; error: null }) => unknown) =>
      // publishedBodies: the version the pin's file belongs to was published.
      Promise.resolve({ data: table === "task_document_versions" && versionFile ? [{ version: 1, body: versionFile.id }] : [], error: null }).then(resolve),
  };
  return b;
}

vi.mock("./supabaseAdmin", () => ({
  supabaseAdmin: {
    from: (t: string) => builder(t),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://storage/signed" } }) }) },
  },
}));
vi.mock("./db", () => ({ TASK_FILES_BUCKET: "task-files" }));

const { postDocComment, docVideoUrl } = await import("./taskDocumentFiles");

const FILE = "tdf_0f8fad5b-d9cb-469f-a165-70867728950e";
const DOC = "tdoc_1";
const actor = { id: "u_derek", label: "Derek" };
const post = (pin: unknown) => postDocComment(DOC, "fix this", actor, { pin });

beforeEach(() => { inserted = []; });

describe("postDocComment pins", () => {
  it("stores a moment on a video review, with no spot", async () => {
    versionFile = { id: FILE, name: "cut.mp4", path: `doc/${DOC}/${FILE}.mp4`, purpose: "video", cleared_at: null };
    const r = await post({ fileId: FILE, t: 42.4 });
    expect(r.ok).toBe(true);
    expect(inserted[0]).toMatchObject({ pin_file_id: FILE, pin_t: 42.4, pin_x: null, pin_y: null, pin_number: 1 });
  });

  it("stores a spot on an image review, with no moment", async () => {
    versionFile = { id: FILE, name: "flyer.png", path: `doc/${DOC}/${FILE}.png`, purpose: "image", cleared_at: null };
    const r = await post({ fileId: FILE, x: 0.25, y: 0.5 });
    expect(r.ok).toBe(true);
    expect(inserted[0]).toMatchObject({ pin_file_id: FILE, pin_x: 0.25, pin_y: 0.5, pin_t: null });
  });

  it("refuses a spot on a video: there is nothing to point at in a moving picture", async () => {
    versionFile = { id: FILE, name: "cut.mp4", path: `doc/${DOC}/${FILE}.mp4`, purpose: "video", cleared_at: null };
    const r = await post({ fileId: FILE, x: 0.25, y: 0.5 });
    expect(r.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a moment on an image: it would store a pin nobody can see", async () => {
    versionFile = { id: FILE, name: "flyer.png", path: `doc/${DOC}/${FILE}.png`, purpose: "image", cleared_at: null };
    const r = await post({ fileId: FILE, t: 42 });
    expect(r.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a pin carrying both a spot and a moment before it reaches the file", async () => {
    versionFile = { id: FILE, name: "cut.mp4", path: `doc/${DOC}/${FILE}.mp4`, purpose: "video", cleared_at: null };
    const r = await post({ fileId: FILE, x: 0.25, y: 0.5, t: 42 });
    expect(r.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a pin on a version that is no longer on the review", async () => {
    versionFile = null;
    const r = await post({ fileId: FILE, t: 42 });
    expect(r.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});

describe("docVideoUrl", () => {
  it("signs a video that is still stored", async () => {
    versionFile = { id: FILE, name: "cut.mp4", path: `doc/${DOC}/${FILE}.mp4`, purpose: "video", cleared_at: null };
    expect(await docVideoUrl(DOC, FILE, true)).toEqual({ url: "https://storage/signed" });
  });

  it("says a cleared video was cleared, which is not the same as missing", async () => {
    // The purge deletes the bytes 30 days after approval and leaves the row, so
    // the page can explain itself with the comments still under it.
    versionFile = { id: FILE, name: "cut.mp4", path: `doc/${DOC}/${FILE}.mp4`, purpose: "video", cleared_at: "2026-08-01T00:00:00Z" };
    expect(await docVideoUrl(DOC, FILE, true)).toEqual({ cleared: true });
  });

  it("gives nothing for a version that is not on the review", async () => {
    versionFile = null;
    expect(await docVideoUrl(DOC, FILE, true)).toBeNull();
  });
});
