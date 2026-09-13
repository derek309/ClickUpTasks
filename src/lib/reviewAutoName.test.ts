// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// AI names for reviews: what counts as a usable name, when it is allowed to run at
// all, and the guarded write that lets a typed name always win. Supabase and Gemini
// are faked; nothing here calls either for real.

type Call = { table: string; op: "select" | "update"; payload?: any; filters: [string, unknown][] };
const calls: Call[] = [];
let updated: unknown = null;
let download: { size: number; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> } | null = null;

function builder(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const b: any = {
    select: () => b,
    update: (p: unknown) => { call.op = "update"; call.payload = p; return b; },
    eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
    is: (k: string, v: unknown) => { call.filters.push([`is:${k}`, v]); return b; },
    maybeSingle: () => b,
    then: (resolve: (r: unknown) => unknown) => {
      calls.push(call);
      const data = table === "tasks" ? { title: "Lincoln chamber mailer" } : updated;
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock("./supabaseAdmin", () => ({
  supabaseAdmin: { from: (t: string) => builder(t), storage: { from: () => ({ download: async () => ({ data: download, error: null }) }) } },
  adminConfigured: true,
}));
vi.mock("./db", () => ({ TASK_FILES_BUCKET: "task-files" }));

const { cleanReviewName, awaitsName, buildNamePrompt, nameReviewIfDefault } = await import("./reviewAutoName");

const WORDS = "<p>Join us for the fall open house at the Lincoln chamber this October with food, music and local vendors.</p>";
const unnamed = { id: "tdoc_1", task_id: "t_1", title: "", ai_named_at: null };
const geminiSays = (text: string) => vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 }));

beforeEach(() => {
  calls.length = 0;
  updated = null;
  download = null;
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cleanReviewName", () => {
  it("keeps a plain specific name", () => {
    expect(cleanReviewName("Fall Open House Flyer")).toBe("Fall Open House Flyer");
  });

  it("strips labels, quotes, dashes and ending punctuation", () => {
    expect(cleanReviewName(`Name: "Spring Menu – Dinner Specials."\nsecond line`)).toBe("Spring Menu Dinner Specials");
  });

  it("cuts a long answer at a word, under 60 characters", () => {
    const name = cleanReviewName("The Very Long Name Of A Quarterly Newsletter For Every Member Of The Lincoln Chamber")!;
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith(" ")).toBe(false);
    expect("The Very Long Name Of A Quarterly Newsletter For Every Member Of The Lincoln Chamber".startsWith(name)).toBe(true);
  });

  it("refuses generic or empty answers", () => {
    for (const raw of ["Document", "New Image Review", "HTML review", "  ", "Untitled", "-"]) expect(cleanReviewName(raw)).toBeNull();
  });
});

describe("awaitsName", () => {
  it("only while the title is blank, the AI never ran, and the column exists", () => {
    expect(awaitsName(unnamed)).toBe(true);
    expect(awaitsName({ ...unnamed, title: "Typed by Derek" })).toBe(false);
    expect(awaitsName({ ...unnamed, ai_named_at: "2026-09-13T20:00:00Z" })).toBe(false);
    expect(awaitsName({ id: "tdoc_1", title: "" })).toBe(false);
  });
});

describe("buildNamePrompt", () => {
  it("gives the task title as a hint and asks for no dashes", () => {
    const prompt = buildNamePrompt("page", "Lincoln chamber mailer", "Pasted code.html", "Page title: October News");
    expect(prompt).toContain("Task title: Lincoln chamber mailer");
    expect(prompt).toContain("File name: Pasted code.html");
    expect(prompt).toContain("Never use quotes, dashes");
  });
});

describe("nameReviewIfDefault", () => {
  it("never runs on a review someone named, and never calls Gemini for it", async () => {
    const fetch = geminiSays("Anything");
    vi.stubGlobal("fetch", fetch);
    expect(await nameReviewIfDefault({ ...unnamed, title: "Typed by Derek" }, { kind: "doc", html: WORDS })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("waits for a document to have enough words, without marking it", async () => {
    const fetch = geminiSays("Anything");
    vi.stubGlobal("fetch", fetch);
    expect(await nameReviewIfDefault(unnamed, { kind: "doc", html: "<p>Hello there</p>" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("names it with a write that only lands while the title is still blank", async () => {
    vi.stubGlobal("fetch", geminiSays("Fall Open House Invite"));
    updated = { ...unnamed, title: "Fall Open House Invite" };
    expect(await nameReviewIfDefault(unnamed, { kind: "doc", html: WORDS })).toEqual(updated);
    const write = calls.find((c) => c.op === "update")!;
    expect(write.payload.title).toBe("Fall Open House Invite");
    expect(write.payload.ai_named_at).toBeTruthy();
    expect(write.filters).toEqual(expect.arrayContaining([["id", "tdoc_1"], ["title", ""], ["is:ai_named_at", null]]));
  });

  it("marks a try with no usable answer, so it doesn't ask again on every save", async () => {
    vi.stubGlobal("fetch", geminiSays("Document"));
    expect(await nameReviewIfDefault(unnamed, { kind: "doc", html: WORDS })).toBeNull();
    const write = calls.find((c) => c.op === "update")!;
    expect(write.payload).not.toHaveProperty("title");
    expect(write.payload.ai_named_at).toBeTruthy();
  });

  it("lets a name typed in the meantime win (the guarded write matches nothing)", async () => {
    vi.stubGlobal("fetch", geminiSays("Fall Open House Invite"));
    updated = null;
    expect(await nameReviewIfDefault(unnamed, { kind: "doc", html: WORDS })).toBeNull();
  });

  it("shows Gemini the image itself, read only", async () => {
    const fetch = geminiSays("Chamber Mixer Poster");
    vi.stubGlobal("fetch", fetch);
    download = { size: 4, text: async () => "", arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer };
    updated = { ...unnamed, title: "Chamber Mixer Poster" };
    await nameReviewIfDefault(unnamed, { kind: "image", path: "docs/tdoc_1/a-poster.png", fileName: "poster.png" });
    const body = JSON.parse((fetch.mock.calls[0] as any)[1].body);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: "image/png", data: "iVBORw==" });
  });

  it("reads a page's words and its title tag", async () => {
    const fetch = geminiSays("October Chamber News");
    vi.stubGlobal("fetch", fetch);
    download = { size: 10, text: async () => "<html><head><title>October News</title></head><body><h1>Chamber mixer</h1></body></html>", arrayBuffer: async () => new ArrayBuffer(0) };
    updated = { ...unnamed, title: "October Chamber News" };
    await nameReviewIfDefault(unnamed, { kind: "page", path: "docs/tdoc_1/a-page.txt", fileName: "Pasted code.html" });
    const prompt = JSON.parse((fetch.mock.calls[0] as any)[1].body).contents[0].parts[0].text;
    expect(prompt).toContain("Page title: October News");
    expect(prompt).toContain("Chamber mixer");
  });

  it("does nothing without a Gemini key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await nameReviewIfDefault(unnamed, { kind: "doc", html: WORDS })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
