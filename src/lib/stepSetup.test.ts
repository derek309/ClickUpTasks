import { describe, it, expect } from "vitest";
import { CLAUDE_ID, type Subtask } from "./data";
import { setupSkipped, preselectWho, preselectWhen, whenChoices, whenKeyFor, rankTeammates, whoChoices, impliedBy, recommendActions, historyKinds, setupHistory, stepKinds, actionGroup } from "./stepSetup";

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
    expect(whenChoices(WED).map((c) => c.date)).toEqual([WED, "2026-10-15", "2026-10-19", "2026-10-19"]);
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

describe("three recommended actions", () => {
  const ALL = ["directions", "checklist", "email", "text", "chat", "doc", "image", "page", "video", "claude"];
  it("the name's suggestion first, then the fallbacks", () => {
    expect(recommendActions({ lead: ["doc"], available: ALL })).toEqual(["doc", "directions", "checklist"]);
    expect(recommendActions({ available: ALL })).toEqual(["directions", "checklist", "claude"]);
  });
  it("the action already chosen comes first", () => {
    expect(recommendActions({ preset: "video", lead: ["doc"], available: ALL })).toEqual(["video", "doc", "directions"]);
  });
  it("then what the context asks for, then history", () => {
    expect(recommendActions({ lead: ["page"], context: "email", history: ["image", "page"], available: ALL })).toEqual(["page", "email", "image"]);
    expect(recommendActions({ context: "doc", history: ["video"], available: ALL })).toEqual(["doc", "video", "directions"]);
  });
  it("never the same action twice", () => {
    expect(recommendActions({ lead: ["doc"], context: "doc", history: ["doc", "doc"], available: ALL })).toEqual(["doc", "directions", "checklist"]);
  });
  it("never three from one group", () => {
    const r = recommendActions({ lead: ["doc"], context: "image", history: ["page", "video"], available: ALL });
    expect(r).toEqual(["doc", "image", "directions"]);
    expect(new Set(r.map(actionGroup)).size).toBeGreaterThan(1);
  });
  it("only what is on offer", () => {
    expect(recommendActions({ lead: ["doc"], context: "email", available: ["directions", "checklist"] })).toEqual(["directions", "checklist"]);
  });
  it("a campaign, bulk or newsletter step never gets Email from context or history", () => {
    expect(recommendActions({ context: "email", history: ["email", "page"], available: ALL, stepName: "Schedule Campaign to bulk customers" })).toEqual(["page", "directions", "checklist"]);
    expect(recommendActions({ context: "email", available: ALL, stepName: "Send the newsletter" })[0]).not.toBe("email");
    // An ordinary step does.
    expect(recommendActions({ context: "email", available: ALL, stepName: "Send Brian the plan" })[0]).toBe("email");
  });
});

describe("history", () => {
  const T = (id: string, clientId: string, createdAt: string, subtasks: Partial<Subtask>[]) => ({ id, clientId, createdAt, subtasks: subtasks.map((x) => ({ title: "", ...x })) });
  it("reads what a step held as actions", () => {
    expect(stepKinds({ holds: ["doc", "att:1", "email"] })).toEqual(["doc", "email"]);
    expect(stepKinds({ todos: [{ id: "t", title: "x", done: false }], draftMessage: { channel: "sms", body: "" } })).toEqual(["checklist", "text"]);
    expect(stepKinds({})).toEqual([]);
  });
  it("takes this client's steps and your own, never this task's, the newest first", () => {
    const tasks = [
      T("t_old", "cl_a", "2026-01-01", [{ title: "Old flyer", holds: ["image"] }]),
      T("t_self", "cl_a", "2026-10-01", [{ title: "Flyer", holds: ["video"] }]),
      T("t_new", "cl_a", "2026-10-02", [{ title: "Spring flyer", holds: ["page"] }, { title: "Call", holds: [] }]),
      T("t_mine", "cl_b", "2026-09-01", [{ title: "Flyer for Pam", holds: ["doc"], assigneeId: "u_me" }, { title: "Flyer", holds: ["video"], assigneeId: "u_other" }]),
    ];
    const h = setupHistory(tasks, { id: "t_self", clientId: "cl_a" }, "u_me");
    expect(h.map((x) => x.kinds[0])).toEqual(["page:page", "doc", "image"]);
  });
  it("reads an HTML review as the kind it was made as", () => {
    expect(stepKinds({ holds: ["page"], pageKind: "email" })).toEqual(["page:email"]);
    expect(stepKinds({ holds: ["page"] })).toEqual(["page:page"]);
    expect(actionGroup("page:email")).toBe("make");
  });
  it("ranks kinds by how many words the names share", () => {
    const h = [
      { words: ["spring", "flyer"], kinds: ["image"] },
      { words: ["flyer"], kinds: ["page"] },
      { words: ["blog"], kinds: ["doc"] },
    ];
    expect(historyKinds("Make the spring flyer", h)).toEqual(["image", "page"]);
    expect(historyKinds("Call Pam", h)).toEqual([]);
    expect(historyKinds("", h)).toEqual([]);
  });
});

describe("What's next picks", () => {
  it("the suggestion first, then context, history and its own fallbacks", () => {
    const avail = ["suggestion", "email", "text", "doc", "page", "meetnow", "claude"];
    expect(recommendActions({ lead: ["suggestion"], history: ["doc"], available: avail, fallbacks: ["claude", "email"] })).toEqual(["suggestion", "doc", "claude"]);
    expect(recommendActions({ available: avail, fallbacks: ["claude", "email", "text"] })).toEqual(["claude", "email", "text"]);
  });
});
