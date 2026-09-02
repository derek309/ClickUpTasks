import { describe, it, expect, vi } from "vitest";

// The module builds a Supabase admin client at import time, which needs env
// this test has no business supplying: the comparison under test is pure.
vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: {}, adminConfigured: false }));

const { normalizeBody, DEDUP_WINDOW_MS } = await import("./inboundIngest");

// GoHighLevel's two-way sync imports a copy of every email the app sent
// through Google Workspace. Those copies carry no ghl_message_id to match on,
// so the only thing standing between the Journal and every sent email
// appearing twice is this comparison.
describe("recognising GoHighLevel's copy of an email we already sent", () => {
  it("ignores the markup GHL wraps a body in", () => {
    expect(normalizeBody("<p>Hello <b>there</b></p>")).toBe(normalizeBody("Hello there"));
  });
  it("ignores entity encoding and whitespace differences", () => {
    expect(normalizeBody("Ben&nbsp;&amp;  Jerry")).toBe(normalizeBody("Ben & Jerry"));
    expect(normalizeBody("one\n\n  two")).toBe(normalizeBody("one two"));
  });
  it("still tells two different messages apart", () => {
    expect(normalizeBody("Ready for review")).not.toBe(normalizeBody("Ready for approval"));
  });
  it("survives an empty or missing body", () => {
    expect(normalizeBody("")).toBe("");
    expect(normalizeBody(undefined as unknown as string)).toBe("");
  });
  // Ten minutes: long enough for a sync round trip, short enough that a
  // genuine follow-up saying the same thing is not swallowed as a duplicate.
  it("keeps the dedup window at ten minutes", () => {
    expect(DEDUP_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});
