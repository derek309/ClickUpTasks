import { describe, it, expect } from "vitest";
import { waitingOn, reminderEmail, type DmRow } from "./missedMessages";

const H = 3_600_000;
const now = Date.parse("2026-10-05T20:00:00Z");
const row = (id: string, author: string, hoursAgo: number, extra: Partial<DmRow> = {}): DmRow => ({
  id, conversation_id: "c1", author_id: author, recipient_id: author === "m" ? "d" : "m", body: `msg ${id}`,
  created_at: new Date(now - hoursAgo * H).toISOString(), reminded_at: null, ...extra,
});

describe("messages waiting on someone", () => {
  it("reminds about an unanswered run once it is 2 hours old", () => {
    const due = waitingOn([row("1", "d", 5), row("2", "m", 3), row("3", "m", 2.5)], now);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ recipientId: "d", authorId: "m" });
    expect(due[0].messages.map((m) => m.id)).toEqual(["2", "3"]);
  });
  it("not when they answered, too soon, already reminded, or too old", () => {
    expect(waitingOn([row("1", "m", 3), row("2", "d", 1)], now)).toEqual([]);
    expect(waitingOn([row("1", "m", 1)], now)).toEqual([]);
    expect(waitingOn([row("1", "m", 3, { reminded_at: "x" })], now)).toEqual([]);
    expect(waitingOn([row("1", "m", 30)], now)).toEqual([]);
    expect(waitingOn([row("1", "m", 3, { body: "Perfect thank you." })], now)).toEqual([]);
    expect(waitingOn([row("1", "m", 3, { body: "👍" })], now)).toEqual([]);
    expect(waitingOn([row("1", "m", 3, { body: "Thanks, can you send the file?" })], now)).toHaveLength(1);
  });
  it("says it needs attention and quotes the message", () => {
    const e = reminderEmail({ authorName: "Michaella Pastrana", messages: [{ body: "Can you check the logo?", created_at: "2026-10-05T17:00:00Z" }], url: "https://x/?view=mail" });
    expect(e.subject).toBe("Michaella is waiting on you: a message in ClickUpTasks");
    expect(e.body).toMatch(/needs your attention/);
    expect(e.body).toMatch(/"Can you check the logo\?"/);
  });
});
