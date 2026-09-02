import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// resolveGmailThread decides which Gmail thread a clipped email belongs to,
// and getting it wrong means a task watches somebody else's conversation. It
// takes three routes in descending order of trust, and the order is the point:
// an id Gmail confirmed beats an id we searched for.
vi.mock("google-auth-library", () => ({
  JWT: class { getAccessToken() { return Promise.resolve({ token: "t" }); } },
}));
const ORIGINAL = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL; vi.resetModules(); });
beforeEach(() => { vi.resetModules(); });

async function load() {
  process.env.GOOGLE_SA_CLIENT_EMAIL = "sa@test";
  process.env.GOOGLE_SA_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----";
  return await import("./googleMail");
}

/** A fetch that answers Gmail's two shapes: a message read, and a search. */
function gmailStub(handlers: { message?: any; search?: any }) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    const isSearch = u.includes("?q=");
    const body = isSearch ? handlers.search : handlers.message;
    if (!body) return { ok: false, status: 404, text: async () => "" } as never;
    return { ok: true, json: async () => body } as never;
  });
}

describe("resolving which Gmail thread an email belongs to", () => {
  it("prefers the message id the page gave us, and confirms it with Gmail", async () => {
    globalThis.fetch = gmailStub({
      message: { id: "abc", threadId: "thr_1", payload: { headers: [{ name: "Subject", value: "Hello" }] } },
    }) as never;
    const { resolveGmailThread } = await load();
    const hit = await resolveGmailThread("me@test", { messageId: "abc", subject: "Hello" });
    expect(hit).toMatchObject({ threadId: "thr_1", via: "messageId", subject: "Hello" });
  });

  it("falls back to the Message-ID header when the page id is wrong", async () => {
    // First call (the message read) 404s; the rfc822 search then succeeds.
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: false, status: 404, text: async () => "" } as never;
      if (call === 2) return { ok: true, json: async () => ({ messages: [{ id: "m2" }] }) } as never;
      return { ok: true, json: async () => ({ id: "m2", threadId: "thr_2", payload: { headers: [] } }) } as never;
    }) as never;
    const { resolveGmailThread } = await load();
    const hit = await resolveGmailThread("me@test", { messageId: "stale", rfc822: "<x@y>" });
    expect(hit).toMatchObject({ threadId: "thr_2", via: "rfc822" });
  });

  it("marks a subject match as a guess, because that is what it is", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ messages: [{ id: "m3" }] }) } as never;
      return { ok: true, json: async () => ({ id: "m3", threadId: "thr_3", payload: { headers: [] } }) } as never;
    }) as never;
    const { resolveGmailThread } = await load();
    const hit = await resolveGmailThread("me@test", { subject: "Quarterly review", fromEmail: "a@b.test" });
    expect(hit?.via).toBe("search");
  });

  it("returns nothing rather than guessing when it has nothing to go on", async () => {
    globalThis.fetch = gmailStub({}) as never;
    const { resolveGmailThread } = await load();
    expect(await resolveGmailThread("me@test", {})).toBeNull();
  });
});
