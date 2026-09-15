import { describe, it, expect } from "vitest";
import { openClientComments, type ChangeComment } from "./reviewChanges";

// Which comments turn the client's Approve button into Submit changes.

const SHARED = "2026-09-15T10:00:00.000Z";
const c = (over: Partial<ChangeComment> = {}): ChangeComment => ({ fromClient: true, completedAt: null, createdAt: "2026-09-15T11:00:00.000Z", pin: null, ...over });

describe("openClientComments", () => {
  it("counts the client's own open comment written after the version was shared", () => {
    expect(openClientComments([c()], [], SHARED)).toHaveLength(1);
  });

  it("ignores the team's comments and resolved ones", () => {
    expect(openClientComments([c({ fromClient: false }), c({ completedAt: "2026-09-15T12:00:00Z" })], [], SHARED)).toEqual([]);
  });

  it("ignores a comment left on an earlier round, before this version was shared", () => {
    expect(openClientComments([c({ createdAt: "2026-09-14T09:00:00.000Z" })], [], SHARED)).toEqual([]);
  });

  it("counts a pin only on a file of the newest version", () => {
    const onNewest = c({ pin: { fileId: "f_new" }, createdAt: "2026-09-01T00:00:00Z" });
    const onOld = c({ pin: { fileId: "f_old" } });
    expect(openClientComments([onNewest, onOld], ["f_new"], SHARED)).toEqual([onNewest]);
  });

  it("counts every open client comment when nothing was ever shared", () => {
    expect(openClientComments([c({ createdAt: "2020-01-01T00:00:00Z" })], [], null)).toHaveLength(1);
  });
});
