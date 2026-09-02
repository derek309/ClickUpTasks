import { describe, it, expect, vi } from "vitest";
import { save, unsavedCount } from "./db";

// save() is the seam every write in the app goes through, and its whole job is
// to be right about whether something actually landed. These are the three
// cases that matter: it worked, it will never work, and it might work if we
// wait.
describe("save", () => {
  it("returns on the first success without retrying", async () => {
    const run = vi.fn().mockResolvedValue({ error: null, data: [1] });
    const res = await save(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(res?.error).toBeNull();
  });

  it("retries a transport failure and reports the eventual success", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ error: { message: "fetch failed" } })
      .mockResolvedValueOnce({ error: null, data: [] });
    const res = await save(run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(res?.error).toBeNull();
  });

  it("gives up immediately on a rejection that will not change", async () => {
    const before = unsavedCount();
    const run = vi.fn().mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint "x"' } });
    await save(run);
    // One attempt, not four: a constraint violation is not a network blip, and
    // retrying it only delays telling someone.
    expect(run).toHaveBeenCalledTimes(1);
    expect(unsavedCount()).toBe(before + 1);
  });

  it("counts a write that never lands, so the UI can say the screen is wrong", async () => {
    const before = unsavedCount();
    const run = vi.fn().mockResolvedValue({ error: { message: "network unreachable" } });
    await save(run);
    expect(run).toHaveBeenCalledTimes(4); // the first attempt plus three retries
    expect(unsavedCount()).toBe(before + 1);
  });

  it("treats a thrown error as a failure rather than letting it escape", async () => {
    const before = unsavedCount();
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(save(run)).resolves.toBeTruthy();
    expect(unsavedCount()).toBe(before + 1);
  });
}, 30000);
