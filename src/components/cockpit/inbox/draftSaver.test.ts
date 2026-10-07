import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { draftSaver, readDraft } from "./inboxPrefs";

// The Inbox box's saved draft (Derek, 2026-10-07: "it sends the message, but
// then it doesn't clear out the message box ... particularly on SMS").
describe("the reply box's saved draft", () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is saved half a second after the last keystroke", () => {
    const s = draftSaver("me", "ghl:cv");
    const saved = vi.fn();
    s.later("derek@", saved);
    s.later("derek@clickuplocal.com", saved);
    vi.advanceTimersByTime(499);
    expect(readDraft("me", "ghl:cv")).toBe("");
    vi.advanceTimersByTime(1);
    expect(readDraft("me", "ghl:cv")).toBe("derek@clickuplocal.com");
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("stays gone after a send that came within half a second of typing", () => {
    const s = draftSaver("me", "ghl:cv");
    s.later("derek@clickuplocal.com");
    // Enter: the box clears and the draft goes, before the save was due.
    s.now("");
    vi.advanceTimersByTime(5_000);
    expect(readDraft("me", "ghl:cv")).toBe("");
  });

  it("keeps the words when a send fails", () => {
    const s = draftSaver("me", "ghl:cv");
    s.later("derek@clickuplocal.com");
    s.now("");
    s.now("derek@clickuplocal.com");
    vi.advanceTimersByTime(5_000);
    expect(readDraft("me", "ghl:cv")).toBe("derek@clickuplocal.com");
  });

  it("is per conversation", () => {
    draftSaver("me", "ghl:a").now("for a");
    draftSaver("me", "ghl:b").now("");
    expect(readDraft("me", "ghl:a")).toBe("for a");
  });
});
