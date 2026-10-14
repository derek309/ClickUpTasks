import { describe, it, expect } from "vitest";
import { CLAUDE_ID, type Subtask } from "./data";
import { setupSkipped, preselectWho, preselectWhen, whenChoices, whenKeyFor, rankTeammates, whoChoices, impliedBy } from "./stepSetup";

const step = (p: Partial<Subtask> = {}): Subtask => ({ id: "s_1", title: "Write the plan", done: false, ...p });
// A Wednesday: tomorrow is Thursday, three business days is Monday.
const WED = "2026-10-14";

describe("setupSkipped", () => {
  it("asks on a new step with nothing on it", () => {
    expect(setupSkipped(step())).toBe(false);
    expect(setupSkipped(step({ assigneeId: "u_derek" }))).toBe(false);
    expect(setupSkipped(step({ assigneeId: "u_derek", due: WED }))).toBe(false);
  });
  it("never asks when the step says who, when and what already", () => {
    expect(setupSkipped(step({ assigneeId: "u_derek", due: WED, holds: ["doc"] }))).toBe(true);
    expect(setupSkipped(step({ assigneeId: "u_derek", due: WED, todos: [{ id: "t", title: "x", done: false }] }))).toBe(true);
    expect(setupSkipped(step({ assigneeId: "u_derek", due: WED, notes: "<p>Do it</p>" }))).toBe(true);
    expect(setupSkipped(step({ assigneeId: "u_derek", due: WED, makes: "doc" }))).toBe(true);
    expect(setupSkipped(step({ assigneeId: "u_derek", due: WED, draftMessage: { channel: "sms", body: "" } }))).toBe(true);
  });
  it("empty directions are not something on it", () => {
    expect(setupSkipped(step({ assigneeId: "u_derek", due: WED, notes: "<p></p>" }))).toBe(false);
  });
  it("still asks when only who or when is missing", () => {
    expect(setupSkipped(step({ due: WED, holds: ["doc"] }))).toBe(false);
    expect(setupSkipped(step({ assigneeId: "u_derek", holds: ["doc"] }))).toBe(false);
  });
  it("never asks on a done step, the client's step, or a wait on a reply", () => {
    expect(setupSkipped(step({ done: true }))).toBe(true);
    expect(setupSkipped(step({ onClient: true }))).toBe(true);
    expect(setupSkipped(step({ finishWhen: "reply" }))).toBe(true);
  });
});

describe("pre-selection", () => {
  it("picks the step's own person, else you", () => {
    expect(preselectWho(step({ assigneeId: "u_justin" }), "u_derek")).toBe("u_justin");
    expect(preselectWho(step(), "u_derek")).toBe("u_derek");
    expect(preselectWho(step({ onClient: true }), "u_derek")).toBe("client");
  });
  it("picks the step's due date, else tomorrow in business days", () => {
    expect(preselectWhen(step({ due: "2026-10-20" }), WED)).toBe("2026-10-20");
    expect(preselectWhen(step(), WED)).toBe("2026-10-15");
    // Friday's tomorrow is Monday.
    expect(preselectWhen(step(), "2026-10-16")).toBe("2026-10-19");
  });
  it("Claude's turn is always today", () => {
    expect(preselectWhen(step({ due: "2026-10-20" }), WED, CLAUDE_ID)).toBe(WED);
  });
  it("reads a date as one of the choices, or a picked date", () => {
    expect(whenChoices(WED).map((c) => c.date)).toEqual([WED, "2026-10-15", "2026-10-19", "2026-10-21"]);
    expect(whenKeyFor("2026-10-19", WED)).toBe("3days");
    expect(whenKeyFor("2026-11-02", WED)).toBe("pick");
    expect(whenKeyFor(null, WED)).toBe(null);
  });
  it("talking to the client is your turn, today", () => {
    expect(impliedBy("email", "u_derek", WED)).toEqual({ who: "u_derek", when: WED });
    expect(impliedBy("text", "u_derek", WED)).toEqual({ who: "u_derek", when: WED });
    expect(impliedBy("doc", "u_derek", WED)).toEqual({});
  });
});

describe("whose turn choices", () => {
  it("ranks teammates by use, then team order, never you or Claude", () => {
    expect(rankTeammates(["u_derek", "u_justin", "u_mic", "u_andrea", CLAUDE_ID], { u_andrea: 3, u_mic: 1 }, "u_derek")).toEqual(["u_andrea", "u_mic", "u_justin"]);
  });
  const kinds = (l: { kind: string }[]) => l.map((c) => c.kind);
  it("is 3 or 5, never 4, with Someone else when people are left out", () => {
    // Three teammates and a client: one teammate fits beside Someone else.
    expect(kinds(whoChoices("u_derek", ["a", "b", "c"], true))).toEqual(["me", "teammate", "claude", "client", "else"]);
    // Two teammates and a client: all five, nobody left out.
    expect(kinds(whoChoices("u_derek", ["a", "b"], true))).toEqual(["me", "teammate", "teammate", "claude", "client"]);
    // Three teammates, no client.
    expect(kinds(whoChoices("u_derek", ["a", "b", "c"], false))).toEqual(["me", "teammate", "teammate", "claude", "else"]);
    // Alone with a client: three.
    expect(kinds(whoChoices("u_derek", [], true))).toEqual(["me", "claude", "client"]);
    // One teammate and a client would be four: Someone else makes five.
    expect(kinds(whoChoices("u_derek", ["a"], true))).toHaveLength(5);
    for (const n of [0, 1, 2, 3, 6]) for (const c of [true, false]) {
      const len = whoChoices("u_derek", ["a", "b", "c", "d", "e", "f"].slice(0, n), c).length;
      expect(len).not.toBe(4);
      expect(len).toBeLessThanOrEqual(5);
    }
  });
});
