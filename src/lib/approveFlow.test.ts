import { describe, expect, it } from "vitest";
import { tickedSteps, type Subtask } from "./data";

// t_mv01d2mnx "MEDAL of brands", 2026-10-13: Derek finished step 6 at 18:01:05
// and, 7 seconds later, his Done on step 7 (which Claude had finished at 17:57,
// still open on his page) flipped it back open.
const medal = (): Subtask[] => [
  { id: "s5", title: "Waiting on Brian to review the review", done: true, onClient: true, waitsOn: "page", outcome: "Brian approved" },
  { id: "s6", title: "Reply to brian: Updated for your review", done: true, doneAt: "2026-10-13T18:01:05.289Z", outcome: "Done", assigneeId: "u_derek" },
  { id: "s7", title: "Build the HTML review version", done: true, doneAt: "2026-10-13T17:57:00.000Z", outcome: "Done", assigneeId: "u_claude", addedFor: "next:s6" },
];

describe("finishing a step never reopens one", () => {
  it("a finish on a later step already done changes nothing", () => {
    expect(tickedSteps(medal(), "s7", true)).toBeNull();
    expect(tickedSteps(medal(), "s6", true)).toBeNull();
  });

  it("a finish on an open step finishes it, and only it", () => {
    const list = medal().map((x) => (x.id === "s6" ? { ...x, done: false } : x));
    const out = tickedSteps(list, "s6", true)!;
    expect(out.map((x) => [x.id, x.done])).toEqual([["s5", true], ["s6", true], ["s7", true]]);
  });

  it("a reopen is only ever asked for, and a plain tick still flips", () => {
    expect(tickedSteps(medal(), "s7", false)!.find((x) => x.id === "s7")!.done).toBe(false);
    expect(tickedSteps(medal(), "s7")!.find((x) => x.id === "s7")!.done).toBe(false);
    expect(tickedSteps(medal(), "nope", true)).toBeNull();
  });
});

import { addReviewApproval, approvalHolder, needsYou } from "./data";

describe("the step an approval finishes", () => {
  const open = (): Subtask[] => [
    { id: "a", title: "Write it", done: true },
    { id: "c", title: "Build the HTML review version", done: false, assigneeId: "u_claude" },
  ];
  it("holds, then made here, then Claude's step when Claude made the newest version", () => {
    expect(approvalHolder(open(), "page", "u_claude")?.id).toBe("c");
    expect(approvalHolder(open(), "page", "u_derek")).toBeNull();
    expect(approvalHolder([...open(), { id: "h", title: "Fix the page", done: false, holds: ["page"] }], "page", "u_claude")?.id).toBe("h");
    expect(approvalHolder([...open(), { id: "m", title: "Make it", done: false, madeHere: ["page"] }], "page", null)?.id).toBe("m");
    expect(approvalHolder([...open(), { id: "w", title: "Waiting", done: false, onClient: true, waitsOn: "page" }], "page", "u_claude")).toBeNull();
  });

  it("asks what's next, and only a client's own approval says Needs you", () => {
    let n = 0;
    const made = addReviewApproval(open(), "page", 4, { first: "Brian", name: "the review", byClient: false, ownerId: "u_derek", makeId: () => `n${++n}`, latestBy: "u_claude", doneBy: "u_derek" })!;
    expect(made.fromId).toBe("c");
    const list = made.list.map((x) => (x.id === made.approvalId ? { ...x, assigneeId: "u_derek" } : x));
    expect(list.map((x) => [x.title, x.done])).toEqual([["Write it", true], ["Build the HTML review version", true], ["Brian approved: what's next?", false]]);
    // Derek marked it himself: not news to him.
    expect(needsYou({ status: "approved", assigneeId: "u_derek", subtasks: list }, "u_derek", "Brian")).toBeNull();
    // Brian pressed Approve: it is.
    const byClient = list.map((x) => (x.id === "c" ? { ...x, doneBy: "client" } : x));
    expect(needsYou({ status: "approved", assigneeId: "u_derek", subtasks: byClient }, "u_derek", "Brian")).toBe("Brian approved. Your turn");
  });
});

import { stepProgress } from "./data";

describe("progress", () => {
  it("an open what's next is not a step to count", () => {
    const list: Subtask[] = [
      { id: "a", title: "Build it", done: true },
      { id: "q", title: "Brian approved: what's next?", done: false, addedFor: "ok:page:4" },
    ];
    expect(stepProgress(list)).toMatchObject({ done: 1, total: 1 });
    expect(stepProgress([...list.slice(0, 1), { ...list[1], done: true }])).toMatchObject({ done: 2, total: 2 });
  });
});

import { turnReason } from "./data";

describe("why it is your turn", () => {
  const name = (id: string) => ({ u_justin: "Justin" } as Record<string, string>)[id] ?? "Someone";
  const claudes = { title: "Build the HTML review version", done: true, assigneeId: "u_claude" };
  it("says who closed the step before, not whose it was", () => {
    expect(turnReason({ ...claudes, outcome: "Brian approved (version 4)", doneBy: "u_derek" }, "u_derek", "Brian", name)).toBe("You marked it approved. Your turn");
    expect(turnReason({ ...claudes, outcome: "Brian approved (version 4)", doneBy: "u_justin" }, "u_derek", "Brian", name)).toBe("Justin marked it approved. Your turn");
    expect(turnReason({ ...claudes, outcome: "Brian approved (version 4)", doneBy: "client" }, "u_derek", "Brian", name)).toBe("Brian approved. Your turn");
    expect(turnReason({ ...claudes, outcome: "Done", doneBy: "u_claude" }, "u_derek", "Brian", name)).toBe("Claude finished its part. Your turn");
    // Before doneBy was kept: Claude's step reads as Claude's.
    expect(turnReason({ ...claudes, outcome: "Done" }, "u_derek", "Brian", name)).toBe("Claude finished its part. Your turn");
    expect(turnReason({ ...claudes, outcome: "Done", doneBy: "u_derek" }, "u_derek", "Brian", name)).toBeNull();
    expect(turnReason({ ...claudes, outcome: "Done", doneBy: "u_justin" }, "u_derek", "Brian", name)).toBe('Justin finished "Build the HTML review version". Your turn');
    expect(turnReason({ ...claudes, done: false }, "u_derek", "Brian", name)).toBeNull();
  });
});

import { answerWhatsNext, pickStepTitle, pickedSays, reopenWhatsNext } from "./data";

describe("a pick answers What's next for good, until Change", () => {
  const q = (): Subtask[] => [
    { id: "s7", title: "Build the HTML review version", done: true, assigneeId: "u_claude" },
    { id: "q", title: "Brian approved: what's next?", done: false, addedFor: "ok:page:4", assigneeId: "u_derek", suggested: { name: "Put it in the Bulk customers blast" } },
  ];
  it("Give it to Claude makes it Claude's step, named from the context, and Change asks again", () => {
    const given = answerWhatsNext(q(), "q", q()[1].suggested!.name, { assigneeId: "u_claude", due: "2026-10-14" });
    expect(given[1]).toMatchObject({ title: "Put it in the Bulk customers blast", assigneeId: "u_claude", asked: { title: "Brian approved: what's next?", assigneeId: "u_derek" } });
    expect(pickedSays(given[1], "u_derek", "u_derek", "2026-10-14", () => "")).toBe("Given to Claude, due today");
    const back = reopenWhatsNext(given, "q")!;
    expect(back[1]).toMatchObject({ title: "Brian approved: what's next?", assigneeId: "u_derek" });
    expect(back[1].asked).toBeUndefined();
    expect(reopenWhatsNext(back, "q")).toBeNull();
  });
  it("an action names the step for what it does", () => {
    expect(pickStepTitle("email", "Brian")).toBe("Email Brian");
    expect(pickStepTitle("page", "Brian")).toBe("Create HTML Review");
    expect(answerWhatsNext(q(), "q", pickStepTitle("email", "Brian"))[1].title).toBe("Email Brian");
    // A step not asking is only patched.
    expect(answerWhatsNext(q(), "s7", "x", { due: "2026-10-15" })[0]).toMatchObject({ title: "Build the HTML review version", due: "2026-10-15" });
  });
});
