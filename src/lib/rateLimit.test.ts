import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// rateLimit.ts pulls in supabaseAdmin at module load, which builds a real
// Supabase client from env that isn't present under vitest. Stub it with a
// controllable rpc() so these tests exercise the limiter's own logic.
const rpc = vi.fn();
vi.mock("./supabaseAdmin", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => rpc(...args) },
  adminConfigured: true,
}));

const { rateLimit, retryAfterSeconds, RATE_LIMITS } = await import("./rateLimit");

/** Minimal stand-in for the one NextRequest field the limiter reads. */
const req = (ip = "203.0.113.9") =>
  ({ headers: new Headers({ "x-forwarded-for": ip }) }) as unknown as Parameters<typeof rateLimit>[0];

/** Make every counter come back at `n`. */
const counterAt = (n: number) => rpc.mockResolvedValue({ data: n, error: null });

beforeEach(() => rpc.mockReset());
afterEach(() => vi.useRealTimers());

describe("retryAfterSeconds", () => {
  it("reports the time left in the current fixed window", () => {
    const win = 600_000; // 10 min
    // 2 minutes into a window leaves 8.
    expect(retryAfterSeconds(win, win * 5 + 120_000)).toBe(480);
  });

  it("never returns 0, so Retry-After is always actionable", () => {
    const win = 600_000;
    expect(retryAfterSeconds(win, win * 5)).toBe(600);
    expect(retryAfterSeconds(win, win * 6 - 1)).toBe(1);
  });
});

describe("RATE_LIMITS", () => {
  // supabase/waiting-rate-limit.sql sweeps rows older than 1 hour. A window
  // at or beyond that would have its counter deleted mid-window and silently
  // reset, so this guards the coupling between the two files.
  it("keeps every window well under the SQL sweep horizon", () => {
    for (const [action, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.windowMs, action).toBeLessThanOrEqual(30 * 60_000);
    }
  });

  it("never lets the shared token-wide cap sit below the per-IP cap", () => {
    for (const [action, rule] of Object.entries(RATE_LIMITS)) {
      if (rule.tokenLimit === undefined) continue;
      expect(rule.tokenLimit, action).toBeGreaterThanOrEqual(rule.limit);
    }
  });

  it("gives reads far more headroom than the 15s WaitingView poll needs", () => {
    const pollsPerWindow = RATE_LIMITS.read.windowMs / 15_000;
    expect(RATE_LIMITS.read.limit).toBeGreaterThan(pollsPerWindow * 2);
  });
});

describe("rateLimit", () => {
  it("allows a request under the limit", async () => {
    counterAt(3);
    expect(await rateLimit(req(), "tok_abcdefghijklmnop", "message")).toBeNull();
  });

  it("allows the request that exactly hits the limit", async () => {
    counterAt(RATE_LIMITS.message.limit);
    expect(await rateLimit(req(), "tok_abcdefghijklmnop", "message")).toBeNull();
  });

  it("blocks with 429 and a Retry-After header once over", async () => {
    counterAt(RATE_LIMITS.message.limit + 1);
    const res = await rateLimit(req(), "tok_abcdefghijklmnop", "message");
    expect(res?.status).toBe(429);
    const retryAfter = Number(res?.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(RATE_LIMITS.message.windowMs / 1000);
  });

  // The whole point of the deferred-audit fix: a limiter outage must not
  // lock real clients out of their own page.
  it("FAILS OPEN when the store errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    expect(await rateLimit(req(), "tok_abcdefghijklmnop", "upload")).toBeNull();
  });

  it("fails open when the store returns a non-numeric count", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await rateLimit(req(), "tok_abcdefghijklmnop", "upload")).toBeNull();
  });

  it("scopes counters per action, so polling can't starve uploads", async () => {
    counterAt(1);
    const token = "tok_abcdefghijklmnop";
    await rateLimit(req(), token, "read");
    await rateLimit(req(), token, "upload");
    const keys = rpc.mock.calls.map((c) => (c[1] as { p_key: string }).p_key);
    expect(keys.some((k) => k.startsWith("read:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("upload:"))).toBe(true);
  });

  it("scopes counters per token+IP, so one abuser can't drain a NAT neighbour", async () => {
    counterAt(1);
    await rateLimit(req("198.51.100.1"), "tok_aaaaaaaaaaaaaaaa", "message");
    await rateLimit(req("198.51.100.1"), "tok_bbbbbbbbbbbbbbbb", "message");
    const [a, b] = rpc.mock.calls.map((c) => (c[1] as { p_key: string }).p_key);
    expect(a).not.toBe(b);
  });

  it("also enforces a token-wide cap on the costly routes, defeating IP rotation", async () => {
    // Per-IP counter is fine; the shared token-wide counter (":all:") is over.
    rpc.mockImplementation((...args: unknown[]) => {
      const key = (args[1] as { p_key: string } | undefined)?.p_key ?? "";
      return Promise.resolve({ data: key.includes(":all:") ? RATE_LIMITS.upload.tokenLimit! + 1 : 1, error: null });
    });
    const res = await rateLimit(req("192.0.2.77"), "tok_abcdefghijklmnop", "upload");
    expect(res?.status).toBe(429);
    // Confirm both counters really were consulted, and on distinct keys.
    const keys = rpc.mock.calls.map((c) => (c[1] as { p_key: string }).p_key);
    expect(keys).toHaveLength(2);
    expect(keys.filter((k) => k.includes(":all:"))).toHaveLength(1);
  });

  it("does not spend a second round trip on routes with no token-wide cap", async () => {
    counterAt(1);
    await rateLimit(req(), "tok_abcdefghijklmnop", "read");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
