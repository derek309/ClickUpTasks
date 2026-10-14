import { describe, expect, it } from "vitest";
import { doneByMonth, doneLines, monthCount, ongoingWork, repeatWords, type DoneItem } from "./portalDone";

const t = (id: string, title: string, extra: Partial<DoneItem> = {}): DoneItem => ({ id, title, status: "done", projectId: null, due: null, ...extra });

describe("portal Done tab", () => {
  it("says how often in words", () => {
    expect(repeatWords("Every month")).toEqual({ every: "Every month", short: "monthly" });
    expect(repeatWords("Every 2 weeks")).toEqual({ every: "Every two weeks", short: "every two weeks" });
    expect(repeatWords("Monthly on the 1st")).toEqual({ every: "Monthly on the 1st", short: "monthly" });
  });

  it("makes one card per recurring job, from its rows in any list", () => {
    const cards = ongoingWork([
      t("a", "Stores Newsletter", { repeat: "Every 2 weeks", doneAt: "2026-09-18T17:00:00Z", projectId: "p1" }),
      t("b", "Stores Newsletter", { repeat: "Every 2 weeks", doneAt: "2026-10-07T17:00:00Z", projectId: "p1" }),
      t("c", "Stores Newsletter ", { repeat: "Every 2 weeks", status: "delegated", due: "2026-10-15", projectId: "p2" }),
      t("d", "Promotional Newsletter", { repeat: "Every month", status: "todo", due: "2026-11-06" }),
      // Never done and on hold: left out.
      t("e", "Ambassador newsletter", { repeat: "Every month", status: "on_hold" }),
      // Done before, now on hold: shown, with no next date.
      t("f", "Run Clubs Newsletter", { repeat: "Every month", doneAt: "2026-10-01T17:00:00Z" }),
      t("g", "Run Clubs Newsletter", { repeat: "Every month", status: "on_hold", due: "2026-11-01" }),
      t("h", "One off", { doneAt: "2026-10-01T17:00:00Z" }),
      // Stopped repeating six weeks ago: no longer ongoing.
      t("w", "Create Weekly Blog Posts", { repeat: "Every week", doneAt: "2026-09-01T17:00:00Z" }),
    ], new Date("2026-10-13T12:00:00Z"));
    expect(cards.map((c) => [c.title, c.every, c.lastDone, c.nextDue])).toEqual([
      ["Stores Newsletter", "Every two weeks", "2026-10-07T17:00:00Z", "2026-10-15"],
      ["Promotional Newsletter", "Every month", null, "2026-11-06"],
      ["Run Clubs Newsletter", "Every month", "2026-10-01T17:00:00Z", null],
    ]);
  });

  it("folds a one off done many times in a month, and marks recurring rows", () => {
    const lines = doneLines([
      t("r1", "Reply to Brian Goodell", { doneAt: "2026-09-02T17:00:00Z" }),
      t("r2", "Reply to Brian Goodell", { doneAt: "2026-09-30T17:00:00Z" }),
      t("r3", "reply to brian goodell", { doneAt: "2026-09-10T17:00:00Z" }),
      t("x1", "Tyvek Press Release", { doneAt: "2026-09-08T17:00:00Z" }),
      t("x2", "Tyvek Press Release", { doneAt: "2026-09-09T17:00:00Z" }),
      t("n", "Promotional Newsletter", { repeat: "Every month", doneAt: "2026-09-18T17:00:00Z" }),
    ]);
    expect(lines.map((l) => (l.kind === "fold" ? `${l.label} x${l.count}` : `${l.task.title} ${l.marker}`))).toEqual([
      "Answered your emails x3", "Promotional Newsletter monthly", "Tyvek Press Release x2",
    ]);
  });

  it("groups by the month it was done, newest first, with counts", () => {
    const now = new Date("2026-10-13T12:00:00");
    const months = doneByMonth([
      t("a", "A", { doneAt: "2026-10-12T17:00:00Z" }),
      t("b", "B", { doneAt: "2026-09-15T17:00:00Z" }),
      t("c", "C", { doneAt: "2026-09-16T17:00:00Z" }),
      t("d", "D", { due: "2026-07-14" }),
    ], "newest", now);
    expect(months.map((m) => [m.label, monthCount(m)])).toEqual([
      ["October 2026", "1 done so far"], ["September 2026", "2 done"], ["July 2026", "1 done"],
    ]);
    expect(doneByMonth([t("a", "A", { doneAt: "2026-10-12T17:00:00Z" }), t("b", "B", { doneAt: "2026-09-15T17:00:00Z" })], "oldest", now)[0].label).toBe("September 2026");
  });
});
