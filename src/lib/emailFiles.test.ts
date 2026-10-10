import { describe, it, expect, vi, beforeEach } from "vitest";
import { isSignatureImage, kbOf, emailMessageKey, emailFileSources, planEmailFileCopy } from "./emailFiles";

/* eslint-disable @typescript-eslint/no-explicit-any */

// An email's files land on the task its conversation is linked to (Derek,
// 2026-10-09), without signature logos and without the same file twice.

describe("isSignatureImage", () => {
  const img = (name: string, size: string, gm = true) => ({ kind: "image" as const, name, size, ...(gm ? { gmailAttachmentId: "x" } : {}) });
  it("catches Gmail's small image001.png logos", () => {
    expect(isSignatureImage(img("image001.png", "12 KB"))).toBe(true);
    expect(isSignatureImage(img("image.jpg", "4 KB"))).toBe(true);
    expect(isSignatureImage(img("IMAGE02.GIF", "800 B"))).toBe(true);
  });
  it("keeps real photos and anything not from Gmail", () => {
    expect(isSignatureImage(img("image001.png", "1.2 MB"))).toBe(false);
    expect(isSignatureImage(img("image001.png", "150 KB"))).toBe(false);
    expect(isSignatureImage(img("kitchen.jpg", "12 KB"))).toBe(false);
    expect(isSignatureImage(img("image001.png", "12 KB", false))).toBe(false);
    expect(isSignatureImage({ kind: "pdf", name: "image001.png", size: "12 KB", gmailAttachmentId: "x" })).toBe(false);
  });
  it("reads sizes as kilobytes", () => {
    expect(kbOf("1.5 MB")).toBe(1500);
    expect(kbOf("90 KB")).toBe(90);
    expect(kbOf("512 B")).toBeCloseTo(0.512);
    expect(kbOf("")).toBe(0);
  });
});

describe("dedupe markers", () => {
  it("names one email the same in every mailbox", () => {
    expect(emailMessageKey({ id: "m1", rfc822_message_id: "<ABC@mail.gmail.com>", gmail_message_id: "g1" })).toBe("rfc:abc@mail.gmail.com");
    expect(emailMessageKey({ id: "m2", rfc822_message_id: "abc@mail.gmail.com", gmail_message_id: "g2" })).toBe("rfc:abc@mail.gmail.com");
    expect(emailMessageKey({ id: "m3", gmail_message_id: "g3" })).toBe("gm:g3");
    expect(emailMessageKey({ id: "m4" })).toBe("msg:m4");
  });
  it("numbers two files of the same name", () => {
    expect(emailFileSources("rfc:a", [{ name: "Photo.jpg" }, { name: "photo.jpg" }, { name: "plan.pdf" }]))
      .toEqual(["email:rfc:a:photo.jpg", "email:rfc:a:photo.jpg#2", "email:rfc:a:plan.pdf"]);
  });
});

describe("planEmailFileCopy", () => {
  const files = [
    { id: "1", name: "image001.png", kind: "image" as const, size: "8 KB", gmailAttachmentId: "g1" },
    { id: "2", name: "kitchen.jpg", kind: "image" as const, size: "2.1 MB", gmailAttachmentId: "g2" },
    { id: "3", name: "quote.pdf", kind: "pdf" as const, size: "300 KB", gmailAttachmentId: "g3" },
    { id: "4", name: "huge.mov", kind: "doc" as const, size: "40 MB", gmailAttachmentId: "g4" },
    { id: "5", name: "nothing.txt", kind: "doc" as const, size: "1 KB" },
  ];
  it("skips signature logos, oversize files and files it cannot fetch", () => {
    expect(planEmailFileCopy("rfc:a", files, []).map((p) => p.file.name)).toEqual(["kitchen.jpg", "quote.pdf"]);
  });
  it("skips files already on the task", () => {
    const plan = planEmailFileCopy("rfc:a", files, [{ emailSource: "email:rfc:a:kitchen.jpg" }]);
    expect(plan.map((p) => p.file.name)).toEqual(["quote.pdf"]);
  });
  it("skips a stored file already on the task by its path", () => {
    const sent = [{ id: "s", name: "plan.pdf", kind: "pdf" as const, size: "10 KB", path: "t_1/f_x-plan.pdf" }];
    expect(planEmailFileCopy("rfc:b", sent, [{ path: "t_1/f_x-plan.pdf" }])).toEqual([]);
    expect(planEmailFileCopy("rfc:b", sent, [])).toHaveLength(1);
  });
});

// copyEmailFilesToTask against a small in-memory Supabase that applies writes.
const reads = vi.fn(async () => Buffer.from("bytes"));
vi.mock("./googleMail", () => ({ readGmailAttachment: (...a: unknown[]) => (reads as any)(...a) }));
vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: {}, adminConfigured: true }));
vi.mock("./db", () => ({ TASK_FILES_BUCKET: "task-files" }));

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
const storage: { op: string; args: unknown[] }[] = [];
function fakeDb() {
  const from = (table: string) => {
    const preds: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const b: any = {
      select: () => b, order: () => b,
      eq: (k: string, v: unknown) => { preds.push((r) => r[k] === v); return b; },
      in: (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[k])); return b; },
      update: (p: Row) => { patch = p; return b; },
      maybeSingle: () => { const r = (tables[table] ?? []).find((x) => preds.every((p) => p(x))) ?? null; return Promise.resolve({ data: r, error: null }); },
      then: (res: (v: unknown) => unknown) => {
        const rows = (tables[table] ?? []).filter((x) => preds.every((p) => p(x)));
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: patch ? null : rows, error: null }).then(res);
      },
    };
    return b;
  };
  const bucket = {
    upload: async (...args: unknown[]) => { storage.push({ op: "upload", args }); return { error: null }; },
    copy: async (...args: unknown[]) => { storage.push({ op: "copy", args }); return { error: null }; },
    remove: async (...args: unknown[]) => { storage.push({ op: "remove", args }); return { error: null }; },
  };
  // append_task_attachments (supabase/task-attachments-append.sql): adds only
  // what isn't on the task yet, by emailSource or path, and returns it.
  const rpc = (name: string, args: { task_id: string; items: Row[] }) => {
    if (name !== "append_task_attachments") return Promise.resolve({ data: null, error: { message: "no such function" } });
    const t = (tables.tasks ?? []).find((x) => x.id === args.task_id);
    const list = ((t?.attachments as Row[] | undefined) ?? []);
    const add = args.items.filter((i) => !list.some((a) => (i.emailSource && a.emailSource === i.emailSource) || (i.path && a.path === i.path)));
    if (t && add.length) t.attachments = [...list, ...add];
    return Promise.resolve({ data: add, error: null });
  };
  return { from, rpc, storage: { from: () => bucket } } as any;
}

const { copyEmailFilesToTask, copyThreadFilesToTask } = await import("./emailFilesServer");

describe("copyEmailFilesToTask", () => {
  beforeEach(() => {
    reads.mockClear();
    storage.length = 0;
    tables = {
      messages: [
        { id: "m1", gmail_message_id: "g1", rfc822_message_id: "<one@x>", mailbox_member_id: "u_derek", created_at: "2026-10-01", attachments: [
          { id: "a", name: "image001.png", kind: "image", size: "8 KB", gmailAttachmentId: "ga" },
          { id: "b", name: "kitchen.jpg", kind: "image", size: "2 MB", gmailAttachmentId: "gb", mimeType: "image/jpeg" },
        ] },
        // Justin's copy of the same email (CC): same Message-ID.
        { id: "m2", gmail_message_id: "g2", rfc822_message_id: "<one@x>", mailbox_member_id: "u_justin", created_at: "2026-10-01", attachments: [
          { id: "c", name: "kitchen.jpg", kind: "image", size: "2 MB", gmailAttachmentId: "gc" },
        ] },
        // The team's reply, its file already in storage.
        { id: "m3", gmail_message_id: "g3", rfc822_message_id: "<two@x>", mailbox_member_id: "u_derek", created_at: "2026-10-02", attachments: [
          { id: "d", name: "quote.pdf", kind: "pdf", size: "300 KB", path: "inbox/u_derek/quote.pdf" },
        ] },
      ],
      tasks: [{ id: "t_1", attachments: [{ id: "old", name: "brief.pdf", kind: "pdf", size: "1 KB", path: "t_1/brief.pdf" }], deleted_at: null }],
      profiles: [{ member_id: "u_derek", email: "derek@x.com" }, { member_id: "u_justin", email: "justin@x.com" }],
    };
  });

  it("copies the real file, not the logo, and keeps what was on the task", async () => {
    const db = fakeDb();
    const { added } = await copyEmailFilesToTask(db, "m1", "t_1");
    expect(added.map((a) => a.name)).toEqual(["kitchen.jpg"]);
    expect(reads).toHaveBeenCalledWith("derek@x.com", "g1", "gb");
    const atts = tables.tasks[0].attachments;
    expect(atts.map((a: Row) => a.name)).toEqual(["brief.pdf", "kitchen.jpg"]);
    expect(atts[1].path).toMatch(/^t_1\/f_\w+-kitchen\.jpg$/);
    expect(atts[1].emailSource).toBe("email:rfc:one@x:kitchen.jpg");
  });

  it("never copies the same file twice, from either mailbox", async () => {
    const db = fakeDb();
    await copyEmailFilesToTask(db, "m1", "t_1");
    await copyEmailFilesToTask(db, "m1", "t_1");
    await copyEmailFilesToTask(db, "m2", "t_1");
    expect(reads).toHaveBeenCalledTimes(1);
    expect(tables.tasks[0].attachments).toHaveLength(2);
  });

  it("copies a stored file in storage instead of fetching it again", async () => {
    const db = fakeDb();
    const { added } = await copyEmailFilesToTask(db, "m3", "t_1");
    expect(reads).not.toHaveBeenCalled();
    expect(storage[0].op).toBe("copy");
    expect(storage[0].args[0]).toBe("inbox/u_derek/quote.pdf");
    expect(added[0].path).toMatch(/^t_1\//);
  });

  it("linking a thread brings every earlier file once", async () => {
    const n = await copyThreadFilesToTask(fakeDb(), ["m1", "m2", "m3"], "t_1");
    expect(n).toBe(2);
    expect(tables.tasks[0].attachments.map((a: Row) => a.name)).toEqual(["brief.pdf", "kitchen.jpg", "quote.pdf"]);
  });

  it("leaves a deleted task alone and never throws", async () => {
    tables.tasks[0].deleted_at = "2026-10-08";
    expect((await copyEmailFilesToTask(fakeDb(), "m1", "t_1")).added).toEqual([]);
    reads.mockRejectedValueOnce(new Error("gmail down"));
    tables.tasks[0].deleted_at = null;
    const r = await copyEmailFilesToTask(fakeDb(), "m1", "t_1");
    expect(r.skipped).toEqual(["kitchen.jpg"]);
    expect(tables.tasks[0].attachments).toHaveLength(1);
  });
});
