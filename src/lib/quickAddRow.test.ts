import { describe, it, expect } from "vitest";
import { verbatimTaskRow, linesToRows, applyDumpDefaults, type TaskRow } from "./quickAddRow";

const defaults = {
  due: "2026-10-01", followUpAt: "2026-09-28", assignee: null,
  priority: "normal" as const, priorityTouched: false, size: null,
};

describe("a task typed and added as it is", () => {
  // The whole point of the path: Derek, 2026-09-28, "just created without
  // changing the name or title". The old fallback cut at 70 characters.
  it("keeps a long line whole rather than cutting it into a description", () => {
    const line = "Contact GoDaddy support to disconnect the associated product before the renewal bills";
    expect(line.length).toBeGreaterThan(70);
    const row = verbatimTaskRow(line);
    expect(row.title).toBe(line);
    expect(row.description).toBe("");
  });

  it("puts everything after the first line into the description, unreworded", () => {
    const row = verbatimTaskRow("Send the vendor page\nThey asked for the Tracy wording, not Lincoln's.\nDue before Friday.");
    expect(row.title).toBe("Send the vendor page");
    expect(row.description).toBe("They asked for the Tracy wording, not Lincoln's.\nDue before Friday.");
  });

  it("survives the whitespace a paste brings with it", () => {
    const row = verbatimTaskRow("\n\n   Call Amanda   \n\n");
    expect(row.title).toBe("Call Amanda");
    expect(row.description).toBe("");
  });

  it("starts automatic, so priority still follows the due date", () => {
    expect(verbatimTaskRow("Anything").priorityAuto).toBe(true);
  });
});

describe("a pasted list, one task per line", () => {
  it("makes one row per line and keeps the wording", () => {
    const rows = linesToRows("Book the venue\nSend the deposit\nChase the contract");
    expect(rows.map((r) => r.title)).toEqual(["Book the venue", "Send the deposit", "Chase the contract"]);
  });

  it("treats blank lines as spacing, not as tasks", () => {
    expect(linesToRows("One\n\n\nTwo\n   \nThree")).toHaveLength(3);
  });

  it("drops the bullet or number a doc paste brings with it", () => {
    const rows = linesToRows("- Book the venue\n* Send the deposit\n• Chase it\n1. Pay it\n2) File it");
    expect(rows.map((r) => r.title)).toEqual(["Book the venue", "Send the deposit", "Chase it", "Pay it", "File it"]);
  });

  // A hyphen inside the sentence is not a bullet, and a title is not a place
  // to be clever about punctuation.
  it("leaves a dash that is part of the sentence alone", () => {
    expect(linesToRows("Re-run the import")[0].title).toBe("Re-run the import");
  });

  it("gives back nothing for nothing", () => {
    expect(linesToRows("   \n\n  ")).toEqual([]);
  });
});

describe("filling in what a row did not answer", () => {
  const row = (p: Partial<TaskRow> = {}): TaskRow => ({ ...verbatimTaskRow("A task"), ...p });

  it("fills the gaps and leaves what the row already knows", () => {
    const [filled] = applyDumpDefaults([row({ due: "2026-12-25", assignee: "u_mich" })], defaults);
    expect(filled.due).toBe("2026-12-25");
    expect(filled.assignee).toBe("u_mich");
    const [empty] = applyDumpDefaults([row()], defaults);
    expect(empty.due).toBe("2026-10-01");
    expect(empty.assignee).toBeNull();
    expect(empty.followUpAt).toBe("2026-09-28");
  });

  it("leaves priority automatic when the select was never touched", () => {
    expect(applyDumpDefaults([row()], defaults)[0].priorityAuto).toBe(true);
  });

  it("makes a priority chosen by hand stick", () => {
    const [filled] = applyDumpDefaults([row()], { ...defaults, priority: "urgent", priorityTouched: true });
    expect(filled.priority).toBe("urgent");
    expect(filled.priorityAuto).toBe(false);
  });

  // The AI only says urgent when the text said so, so that is a statement
  // about the task rather than a default sitting in a box.
  it("keeps an urgent the text itself asked for, and makes it stick", () => {
    const [filled] = applyDumpDefaults([row({ priority: "urgent" })], defaults);
    expect(filled.priority).toBe("urgent");
    expect(filled.priorityAuto).toBe(false);
  });
});
