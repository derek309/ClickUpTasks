import { describe, expect, it } from "vitest";
import { addLeadItems, descriptionLabel, doneLine, lastTickFinishes, lineExtras, turnOf, turnWord, whatsNextButton, whatsNextSays, workingSections } from "./stepThenNext";
import { CLAUDE_ID } from "./data";

const o = { meId: "u_derek", clientFirst: "Brian", nameOf: (id: string) => ({ u_justin: "Justin", u_mich: "Michaella" } as Record<string, string>)[id] ?? "Someone" };

describe("the working step card (Derek, 2026-10-17)", () => {
  it("shows the step, top to bottom: Description, Checklist, what it uses, + Add, Done", () => {
    expect(workingSections({ done: false, description: true, checklist: true, using: true, canAdd: true, canFinish: true }))
      .toEqual(["description", "checklist", "using", "add", "done"]);
  });
  it("shows nothing empty: no Description or Checklist without something in it", () => {
    expect(workingSections({ done: false, description: false, checklist: false, using: false, canAdd: true, canFinish: true })).toEqual(["add", "done"]);
  });
  it("a done step has no + Add and no Done", () => {
    expect(workingSections({ done: true, description: true, checklist: true, using: false, canAdd: true, canFinish: true })).toEqual(["description", "checklist"]);
  });
  it("+ Add offers Checklist and Description while the step has neither, the other once one exists", () => {
    expect(addLeadItems({ description: false, checklist: false })).toEqual(["checklist", "description"]);
    expect(addLeadItems({ description: true, checklist: false })).toEqual(["checklist"]);
    expect(addLeadItems({ description: false, checklist: true })).toEqual(["description"]);
    expect(addLeadItems({ description: true, checklist: true })).toEqual([]);
  });
});

describe("whose turn", () => {
  const who = { meId: "u_derek", ownerId: "u_derek" };
  it("reads the step", () => {
    expect(turnOf({ assigneeId: undefined }, who)).toBe("me");
    expect(turnOf({ assigneeId: "u_mich" }, who)).toBe("teammate");
    expect(turnOf({ assigneeId: CLAUDE_ID }, who)).toBe("claude");
    expect(turnOf({ onClient: true }, who)).toBe("client");
    expect(turnOf({ finishWhen: "reply" }, who)).toBe("client");
  });
  it("client and Claude steps lead with their words; others read Description", () => {
    expect(descriptionLabel("client", "Brian")).toEqual({ label: "What we need from Brian", tone: "client" });
    expect(descriptionLabel("claude", "Brian")).toEqual({ label: "What Claude should do", tone: "claude" });
    expect(descriptionLabel("me", "Brian")).toEqual({ label: "Description", tone: null });
    expect(descriptionLabel("teammate", "Brian").label).toBe("Description");
  });
  it("the turn word", () => {
    expect(turnWord(null, o)).toBe("Your turn");
    expect(turnWord("u_derek", o)).toBe("Your turn");
    expect(turnWord("u_mich", o)).toBe("Michaella's turn");
    expect(turnWord(CLAUDE_ID, o)).toBe("Claude's turn");
    expect(turnWord("client", o)).toBe("Brian's turn");
  });
  it("the … offers by turn: a teammate's dates, the client's reminders, nothing for Claude", () => {
    expect(lineExtras("teammate")).toEqual(["priority", "onList", "checkBack"]);
    expect(lineExtras("client")).toEqual(["reminders", "priority"]);
    expect(lineExtras("me")).toEqual(["priority"]);
    expect(lineExtras("claude")).toEqual([]);
  });
});

describe("the last tick is Done", () => {
  const todos = [{ id: "a", done: true }, { id: "b", done: false }];
  it("ticking the last open to do finishes the step", () => {
    expect(lastTickFinishes(todos, "b")).toBe(true);
  });
  it("not while another is open, or the client's portal item is", () => {
    expect(lastTickFinishes([...todos, { id: "c", done: false }], "b")).toBe(false);
    expect(lastTickFinishes(todos, "b", [{ done: false }])).toBe(false);
    expect(lastTickFinishes(todos, "b", [{ done: true }])).toBe(true);
  });
  it("unticking never finishes, so it can't finish twice", () => {
    expect(lastTickFinishes([{ id: "a", done: true }], "a")).toBe(false);
    expect(lastTickFinishes(todos, "missing")).toBe(false);
  });
});

describe("What's next's button follows whose turn", () => {
  it("Save for you, Give to a teammate, Give to Claude, Write the client's email", () => {
    expect(whatsNextButton("u_derek", o)).toBe("Save");
    expect(whatsNextButton(null, o)).toBe("Save");
    expect(whatsNextButton("u_justin", o)).toBe("Give to Justin");
    expect(whatsNextButton(CLAUDE_ID, o)).toBe("Give to Claude");
    expect(whatsNextButton("client", o)).toBe("Write Brian's email");
  });
  it("says in one line what will happen", () => {
    expect(whatsNextSays("client", o)).toBe("We email Brian the ask and wait for the reply.");
    expect(whatsNextSays(CLAUDE_ID, o)).toBe("Claude starts on it today.");
  });
  it("the step folds to one line", () => {
    expect(doneLine("Hand off", "u_mich", o)).toBe("✓ Hand off · done by Michaella");
    expect(doneLine("Hand off", "u_derek", o)).toBe("✓ Hand off · done by you");
    expect(doneLine("Hand off", null, o)).toBe("✓ Hand off · done");
  });
});
