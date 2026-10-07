import { describe, it, expect, vi, beforeEach } from "vitest";

// The Claude Code switch (Derek, 2026-10-07): on makes one "Claude Code" token
// for that teammate, off deletes it, and only such a token lets the MCP act as
// them. Supabase is a small in-memory stub.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const db: { api_tokens: Row[]; profiles: Row[] } = { api_tokens: [], profiles: [] };
function query(table: keyof typeof db) {
  const filters: [string, unknown][] = [];
  let op: "select" | "delete" | "update" = "select";
  const rows = () => db[table].filter((r) => filters.every(([k, v]) => r[k] === v));
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (k: string, v: unknown) => { filters.push([k, v]); return q; };
  q.limit = () => q;
  q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  q.insert = async (r: Row) => { db[table].push(r); return { error: null }; };
  q.delete = () => { op = "delete"; return q; };
  q.update = () => { op = "update"; return q; };
  q.then = (res: (v: unknown) => void) => {
    if (op === "delete") { const gone = new Set(rows()); db[table] = db[table].filter((r) => !gone.has(r)); return res({ error: null }); }
    if (op === "update") return res({ error: null });
    return res({ data: rows(), error: null });
  };
  return q;
}
vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: keyof typeof db) => query(t) } }));
vi.mock("./tokenCrypto", () => ({
  hashToken: (raw: string) => `h:${raw}`,
  mintToken: () => ({ raw: "cut_new", hash: "h:cut_new", enc: "enc" }),
}));

import { setClaudeCodeAccess, memberForClaudeToken, claudeCodeOwners, CLAUDE_CODE_TOKEN } from "./claudeCodeAccess";

beforeEach(() => {
  db.api_tokens = [{ id: "t_ext", owner_id: "p_justin", name: "Chrome extension", token_hash: "h:cut_ext" }];
  db.profiles = [{ id: "p_justin", member_id: "e34a" }];
});

describe("Claude Code access", () => {
  it("on makes one Claude Code token, and it acts as its owner", async () => {
    expect(await setClaudeCodeAccess("p_justin", true)).toEqual({});
    await setClaudeCodeAccess("p_justin", true);
    expect(db.api_tokens.filter((t) => t.name === CLAUDE_CODE_TOKEN)).toHaveLength(1);
    expect([...(await claudeCodeOwners())]).toEqual(["p_justin"]);
    expect(await memberForClaudeToken("cut_new")).toBe("e34a");
  });
  it("a token that isn't the Claude Code one doesn't get in", async () => {
    expect(await memberForClaudeToken("cut_ext")).toBeNull();
    expect(await memberForClaudeToken("not_a_token")).toBeNull();
  });
  it("off deletes it, so the same token stops working", async () => {
    await setClaudeCodeAccess("p_justin", true);
    await setClaudeCodeAccess("p_justin", false);
    expect(db.api_tokens.map((t) => t.name)).toEqual(["Chrome extension"]);
    expect(await memberForClaudeToken("cut_new")).toBeNull();
  });
});
