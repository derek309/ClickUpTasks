import { describe, expect, it } from "vitest";
import { addChangesRound, currentStep, guessStepStage, statusForStep, stepAfter, stepProgress, stepStage, type Subtask } from "./data";

const s = (id: string, title: string, extra: Partial<Subtask> = {}): Subtask => ({ id, title, done: false, ...extra });

describe("steps", () => {
  it("reads a stage from older items' words", () => {
    expect(guessStepStage("Send to client to review")).toBe("review");
    expect(guessStepStage("Make Brian's changes")).toBe("changes_requested");
    expect(guessStepStage("Draft document")).toBe("in_progress");
  });
  it("a step given to a teammate is Delegated, whatever its stage", () => {
    expect(stepStage(s("a", "Schedule the send", { assigneeId: "u_m", stage: "in_progress" }), "u_d")).toBe("delegated");
    expect(stepStage(s("a", "Schedule the send", { assigneeId: "u_d", stage: "waiting" }), "u_d")).toBe("waiting");
  });
  it("the current step is the first not done, client changes aside", () => {
    const list = [s("c", "Swap the logo", { fromClient: true }), s("a", "Draft", { done: true }), s("b", "Review")];
    expect(currentStep(list)?.id).toBe("b");
    expect(stepAfter(list, "b")).toBeNull();
  });
  it("counts handoffs as finished when they are", () => {
    expect(stepProgress([s("a", "x", { done: true, assigneeId: "u_m" }), s("b", "y")])).toEqual({ done: 1, total: 2, pct: 50 });
    expect(stepProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it("status follows the step, except On hold and Done", () => {
    expect(statusForStep("in_progress", "review")).toBe("review");
    expect(statusForStep("on_hold", "review")).toBeNull();
    expect(statusForStep("done", "review")).toBeNull();
    expect(statusForStep("review", "review")).toBeNull();
    expect(statusForStep("review", null)).toBeNull();
  });
  it("adds a round of changes after the review step, once", () => {
    let n = 0;
    const list = [s("a", "Draft", { done: true }), s("r", "Client review", { stage: "review" }), s("z", "Schedule")];
    const out = addChangesRound(list, "r", "Brian", "page:2", () => `n${++n}`)!;
    expect(out.map((x) => [x.title, x.done])).toEqual([["Draft", true], ["Client review", true], ["Make Brian's changes", false], ["Schedule", false]]);
    expect(addChangesRound(out, "r", "Brian", "page:2", () => "x")).toBeNull();
  });
});

import { holdOnStep, releaseFromSteps, stepHolding } from "./data";
import { reviewFollowUpDays } from "./reviewReminders";

describe("what a step holds", () => {
  const list = [s("a", "Draft", { holds: ["doc"] }), s("b", "Review")];
  it("puts a deliverable on one step only", () => {
    const moved = holdOnStep(list, "b", "doc");
    expect(moved[0].holds).toBeUndefined();
    expect(moved[1].holds).toEqual(["doc"]);
    expect(stepHolding(moved, "doc")?.id).toBe("b");
  });
  it("leaves a step that already holds it alone", () => {
    expect(holdOnStep(list, "a", "doc")[0]).toBe(list[0]);
  });
  it("takes it off", () => {
    expect(stepHolding(releaseFromSteps(list, "doc"), "doc")).toBeNull();
  });
});

describe("review follow up", () => {
  it("comes the day after the last reminder", () => {
    expect(reviewFollowUpDays(1)).toBe(4);
    expect(reviewFollowUpDays(2)).toBe(7);
    expect(reviewFollowUpDays(0)).toBe(2);
  });
});

import { compactTemplateStep, needMet, planFromSteps, stepsFromTemplate, templatesFor, templateSteps } from "./data";

describe("plans", () => {
  it("reads old templates of plain titles", () => {
    expect(templateSteps({ checklistItems: ["Draft", { title: "Review", stage: "review" }, " "] })).toEqual([{ title: "Draft" }, { title: "Review", stage: "review" }]);
  });
  it("makes a task's steps from a plan", () => {
    let n = 0;
    const out = stepsFromTemplate({ checklistItems: ["Draft", { title: "Review", stage: "review", makes: "page", needs: ["store list link"] }] }, () => `s${++n}`);
    expect(out).toEqual([{ id: "s1", title: "Draft", done: false }, { id: "s2", title: "Review", done: false, stage: "review", makes: "page", needs: ["store list link"] }]);
  });
  it("saves a plain step as a plain title", () => {
    expect(compactTemplateStep({ title: " Draft ", needs: [" "] })).toBe("Draft");
  });
  it("saves a task's steps as a plan, leaving rounds of changes out", () => {
    const subs = [
      s("a", "Write the email", { done: true, holds: ["email", "att:x1"] }),
      s("b", "Client review", { stage: "review", holds: ["page"] }),
      s("c", "Make Brian's changes", { addedFor: "page:2", stage: "changes_requested" }),
      s("d", "Schedule the send", { assigneeId: "u_m" }),
      s("e", "Swap the logo", { fromClient: true }),
    ];
    const names: Record<string, string> = { email: "Draft email", "att:x1": "Store list", page: "HTML review" };
    expect(planFromSteps(subs, "u_d", (k) => names[k] ?? null)).toEqual([
      { title: "Write the email", stage: "in_progress", makes: "email", needs: ["Draft email", "Store list"] },
      { title: "Client review", stage: "review", makes: "page", needs: ["HTML review"] },
      "Schedule the send",
    ]);
  });
  it("meets a need by name, loosely", () => {
    expect(needMet("store list link", ["Store list"])).toBe(true);
    expect(needMet("Draft email", ["draft email"])).toBe(true);
    expect(needMet("product photos", ["Store list"])).toBe(false);
  });
  it("offers a client's templates first, never another client's", () => {
    const all = [{ name: "A", clientId: "cl_x" }, { name: "B", clientId: null }, { name: "C", clientId: "cl_y" }];
    expect(templatesFor(all, "cl_x").map((t) => t.name)).toEqual(["A", "B"]);
  });
});

import { inWindow, stepWindow, todoProgress } from "./data";

describe("step pages", () => {
  it("counts a step's to-dos", () => {
    expect(todoProgress([{ id: "a", title: "x", done: true }, { id: "b", title: "y", done: false }])).toEqual({ done: 1, total: 2 });
    expect(todoProgress(undefined)).toEqual({ done: 0, total: 0 });
  });
  it("finds a step's conversation window", () => {
    const subs = [s("a", "Draft", { done: true, doneAt: "2026-10-05T10:00:00Z" }), s("b", "Review"), s("c", "Send", { startedAt: "2026-10-09T09:00:00Z", doneAt: "2026-10-10T09:00:00Z" })];
    expect(stepWindow(subs, "a", "2026-10-01T00:00:00Z")).toEqual({ from: "2026-10-01T00:00:00Z", to: "2026-10-05T10:00:00Z" });
    expect(stepWindow(subs, "b", "2026-10-01T00:00:00Z")).toEqual({ from: "2026-10-05T10:00:00Z", to: null });
    const w = stepWindow(subs, "c", "2026-10-01T00:00:00Z");
    expect(inWindow("2026-10-09T12:00:00Z", w)).toBe(true);
    expect(inWindow("2026-10-11T12:00:00Z", w)).toBe(false);
  });
});

import { addApprovedStep, addCheckInStep, addTellClientStep, addedReason, changesNeedTelling, changesStepFor, changesTelling } from "./data";

describe("steps added by what happens", () => {
  let n = 0;
  const id = () => `n${++n}`;
  const now = "2026-10-11T10:00:00Z";
  it("a round of changes takes the review and the client's comments", () => {
    const list = [s("r", "Client review", { stage: "review", holds: ["page"] }), s("z", "Schedule")];
    const out = addChangesRound(list, "r", "Brian", "page:2", id, { review: "page", todos: [{ id: "t1", title: "Fix the logo", done: false, fromClient: true, commentId: "c1" }], now })!;
    expect(out[0]).toMatchObject({ done: true, doneAt: now });
    expect(out[0].holds).toBeUndefined();
    expect(out[1]).toMatchObject({ title: "Make Brian's changes", holds: ["page"], todos: [{ title: "Fix the logo" }] });
    expect(out[2].title).toBe("Schedule");
  });
  it("approval with nothing after it asks what's next, once", () => {
    const out = addApprovedStep([s("r", "Client review", { stage: "review" })], "r", "Brian", "the newsletter", "ok:page:2", id, now)!;
    expect(out.map((x) => [x.title, x.done, x.stage])).toEqual([["Client review", true, "review"], ["Brian approved the newsletter: what's next?", false, "approved"]]);
    expect(addApprovedStep(out, "r", "Brian", "x", "ok:page:2", id)).toBeNull();
  });
  it("client changes go to the open changes step, or a new one before the current step", () => {
    const list = [s("a", "Draft", { done: true }), s("b", "Schedule")];
    const made = changesStepFor(list, "Brian", id, now);
    expect(made.made).toBe(true);
    expect(made.list.map((x) => x.title)).toEqual(["Draft", "Changes from Brian", "Schedule"]);
    const again = changesStepFor(made.list, "Brian", id, now);
    expect(again).toMatchObject({ made: false, stepId: made.stepId });
  });
  it("finished changes tell the client unless a review comes next", () => {
    const list = [s("c", "Changes from Brian", { stage: "changes_requested" }), s("z", "Schedule")];
    expect(changesNeedTelling(list, "c", null)).toBe(true);
    expect(changesNeedTelling([s("c", "Make changes", { stage: "changes_requested" }), s("r", "Send again", { stage: "review" })], "c", null)).toBe(false);
    const out = addTellClientStep(list, "c", "Brian", id, now)!;
    expect(out[1]).toMatchObject({ title: "Let Brian know the changes are done", holds: ["email"] });
  });
  it("uses the plan's own next step when it already makes the email", () => {
    expect(changesTelling([s("c", "Changes", { stage: "changes_requested" }), s("t", "Tell Brian", { makes: "email" })], "c", null)).toBe("use");
    expect(changesTelling([s("c", "Changes", { stage: "changes_requested" })], "c", null)).toBe("add");
  });
  it("says why a step was added", () => {
    expect(addedReason("tell:s1", "Brian")).toBe("Added when the changes were marked done");
    expect(addedReason("page:2", "Brian")).toBe("Added when Brian sent changes");
    expect(addedReason(undefined, "Brian")).toBeNull();
  });
  it("sending the email starts a check-in that a reply finishes", () => {
    const out = addCheckInStep([s("t", "Let Brian know")], "t", "Brian", "2026-10-14", id, now)!;
    expect(out[1]).toMatchObject({ title: "Check in if Brian hasn't replied", stage: "waiting", due: "2026-10-14", finishWhen: "reply" });
  });
});

import { addClientReviewStep } from "./data";

describe("a review going to the client", () => {
  it("finishes our step, which keeps the review and email, and starts the client's", () => {
    const list = [s("a", "Draft the newsletter", { holds: ["doc", "att:x"] }), s("b", "Schedule")];
    const out = addClientReviewStep(list, "a", "Derek", "the newsletter", "doc", "2026-10-15", () => "n1", "2026-10-11T10:00:00Z")!;
    expect(out[0]).toMatchObject({ done: true, holds: ["att:x", "doc", "email"] });
    expect(out[1]).toMatchObject({ title: "Waiting on Derek to review the newsletter", onClient: true, stage: "waiting", due: "2026-10-15", waitsOn: "doc" });
    expect(out[1].holds).toBeUndefined();
    expect(out[2].title).toBe("Schedule");
  });
  it("adds nothing while the client's step is current", () => {
    expect(addClientReviewStep([s("c", "Derek reviews", { onClient: true })], "c", "Derek", "x", "doc", null, () => "n")).toBeNull();
  });
  it("adds one waiting step even when the send is reported twice", () => {
    const once = addClientReviewStep([s("a", "Create document")], "a", "Derek", "Newsletter", "doc", null, () => "n1")!;
    expect(addClientReviewStep(once, "a", "Derek", "the document", "doc", null, () => "n2")).toBeNull();
  });
});

import { addApprovalStep, addEmailSentRecord } from "./data";

describe("the document's stage as steps", () => {
  it("records an approval and starts the next planned step", () => {
    const out = addApprovalStep([s("a", "Create content", { holds: ["doc"] }), s("b", "Schedule")], "a", "Newsletter approved", "ok:doc:1", () => "n1", "2026-10-11T10:00:00Z")!;
    expect(out.hasNext).toBe(true);
    expect(out.list.map((x) => [x.title, x.done])).toEqual([["Create content", true], ["Newsletter approved", true], ["Schedule", false]]);
    expect(addApprovalStep(out.list, "a", "x", "ok:doc:1", () => "n")).toBeNull();
  });
  it("with nothing planned, the approval asks what's next", () => {
    const out = addApprovalStep([s("a", "Create content")], "a", "Derek approved the newsletter", "ok:doc:1", () => "n1")!;
    expect(out.list[1]).toMatchObject({ title: "Derek approved the newsletter: what's next?", done: false, stage: "approved" });
  });
  it("records the review email on the client's step, not as a step of its own", () => {
    const out = addEmailSentRecord([s("a", "Create", { done: true }), s("c", "Waiting on Derek", { onClient: true })], "c", "Derek", () => "n1", "2026-10-11T10:00:00Z")!;
    expect(out.map((x) => x.title)).toEqual(["Create", "Waiting on Derek"]);
    expect(out[1].emailedAt).toBe("2026-10-11T10:00:00Z");
  });
});

import { carryForward } from "./data";

describe("outcomes and carrying work forward", () => {
  it("a review sent records its outcome", () => {
    const out = addClientReviewStep([s("a", "Write")], "a", "Derek", "x", "doc", null, () => "n")!;
    expect(out[0].outcome).toBe("Sent to Derek for review");
  });
  it("carries unfinished client work, not links, files or approved work", () => {
    expect(carryForward(["doc", "page", "att:1", "email"], (k) => k === "page")).toEqual(["doc", "email"]);
  });
});

import { namedForWork } from "./data";

describe("a what's next step named by what it makes", () => {
  it("takes the name of the work picked", () => {
    expect(namedForWork(s("a", "Derek approved the document: what's next?", { addedFor: "ok:doc:1" }), "page")).toBe("Create HTML Review");
  });
  it("never renames a step someone named", () => {
    expect(namedForWork(s("a", "Build the email", { addedFor: "ok:doc:1" }), "page")).toBeNull();
    expect(namedForWork(s("a", "What's next?"), "doc")).toBeNull();
  });
});

import { holdOnStep as hold2, releaseFromSteps as release2 } from "./data";

describe("a step's name goes back when its work comes off", () => {
  const named = s("a", "Create HTML for review", { holds: ["page"], namedFrom: { title: "Derek approved the document: what's next?", key: "page", as: "Create HTML for review" } });
  it("taken off: the old name returns", () => {
    expect(release2([named], "page")[0]).toMatchObject({ title: "Derek approved the document: what's next?" });
    expect(release2([named], "page")[0].namedFrom).toBeUndefined();
  });
  it("moved to another step: the old name returns", () => {
    expect(hold2([named, s("b", "Other")], "b", "page")[0].title).toBe("Derek approved the document: what's next?");
  });
  it("renamed by hand since: keeps the new name", () => {
    expect(release2([{ ...named, title: "Build it" }], "page")[0].title).toBe("Build it");
  });
});

import { reviewRound } from "./data";

describe("the round a review step is", () => {
  const list = [
    s("a", "Create"),
    s("w1", "Waiting on Derek", { onClient: true, addedFor: "sent:a" }),
    s("c1", "Make Derek's changes", { addedFor: "doc:1" }),
    s("w2", "Waiting on Derek", { onClient: true, addedFor: "sent:c1" }),
    s("ok", "Approved", { addedFor: "ok:doc:2" }),
  ];
  it("counts the client's reviews", () => {
    expect(reviewRound(list, list[1])).toBe("Review round 1");
    expect(reviewRound(list, list[3])).toBe("Review round 2");
  });
  it("names the changes round and the version it answered", () => {
    expect(reviewRound(list, list[2])).toBe("Changes round 1 · version 1");
  });
  it("names the approved version; other steps have none", () => {
    expect(reviewRound(list, list[4])).toBe("Approved version 2");
    expect(reviewRound(list, list[0])).toBeNull();
  });
});

describe("rounds are counted per review", () => {
  it("the HTML's first review is round 1 after the document's", () => {
    const list = [
      s("a", "Create"),
      s("w1", "Waiting on Derek", { onClient: true, addedFor: "sent:a", waitsOn: "doc" }),
      s("b", "Create HTML"),
      s("w2", "Waiting on Derek", { onClient: true, addedFor: "sent:b", waitsOn: "page" }),
      s("c1", "Make Derek's changes", { addedFor: "page:1" }),
      s("w3", "Waiting on Derek", { onClient: true, addedFor: "sent:c1", waitsOn: "page" }),
    ];
    expect(reviewRound(list, list[3])).toBe("Review round 1");
    expect(reviewRound(list, list[5])).toBe("Review round 2");
    expect(reviewRound(list, list[4])).toBe("Changes round 1");
  });
});

import { approvalToReopen } from "./data";

describe("deleting the step an approval started", () => {
  it("asks what's next again when nothing is left after it", () => {
    const list = [s("ok", "Derek approved the newsletter", { done: true, addedFor: "ok:doc:1", outcome: "Next step started" }), s("x", "Checklist")];
    expect(approvalToReopen(list, "x")).toEqual({ id: "ok", title: "Derek approved the newsletter: what's next?" });
  });
  it("leaves it when more steps follow, or the step before was not an approval", () => {
    const list = [s("ok", "Approved", { done: true, addedFor: "ok:doc:1", outcome: "Next step started" }), s("x", "Checklist"), s("y", "Schedule")];
    expect(approvalToReopen(list, "x")).toBeNull();
    expect(approvalToReopen([s("a", "Write", { done: true }), s("x", "Checklist")], "x")).toBeNull();
  });
});

import { homeStepFor } from "./data";

describe("where client work goes back to", () => {
  it("the step that made it, else the one that sent it", () => {
    const list = [s("a", "Write", { madeHere: ["doc"] }), s("b", "Changes", { holds: ["doc"] })];
    expect(homeStepFor(list, "doc", "b")?.id).toBe("a");
    const sent = [s("a", "Build HTML"), s("w", "Waiting", { onClient: true, addedFor: "sent:a", waitsOn: "page" }), s("b", "Fix", { holds: ["page"] })];
    expect(homeStepFor(sent, "page", "b")?.id).toBe("a");
    expect(homeStepFor(list, "doc", "a")).toBeNull();
  });
});

import { mergeSubtasks } from "./data";

describe("a browser save keeps what the server did meanwhile", () => {
  const a = s("a", "Write"), b = s("b", "Waiting", { onClient: true });
  it("keeps a step the server added, in its place", () => {
    const local = [{ ...a, done: true }, b];
    const remote = [a, s("srv", "Make Brian's changes"), b];
    expect(mergeSubtasks([a, b], local, remote).map((x) => [x.id, x.done])).toEqual([["a", true], ["srv", false], ["b", false]]);
  });
  it("keeps the server's change to a step this edit did not touch", () => {
    const remote = [a, { ...b, done: true, outcome: "Brian replied" }];
    expect(mergeSubtasks([a, b], [{ ...a, title: "Write it" }, b], remote)[1]).toMatchObject({ done: true, outcome: "Brian replied" });
  });
  it("this edit wins on what it changed, and its deletes stick", () => {
    const remote = [{ ...a, title: "Server" }, b];
    expect(mergeSubtasks([a, b], [{ ...a, title: "Mine" }], remote).map((x) => x.title)).toEqual(["Mine"]);
  });
});

import { ownNewSteps } from "./data";

describe("new automatic steps go on the task's owner", () => {
  it("assigns new steps only, never the client's or a handoff", () => {
    const before = [s("a", "Write")];
    const after = [s("a", "Write"), s("c", "Changes from Pam"), s("w", "Waiting", { onClient: true }), s("r", "Request", { fromClient: true }), s("h", "Handoff", { handoff: {} })];
    expect(ownNewSteps(before, after, "u_derek").map((x) => x.assigneeId ?? null)).toEqual([null, "u_derek", null, null, null]);
  });
});

describe("step history", () => {
  it("keeps a deleted step whole, and notes finished and reopened ones", async () => {
    const { stepChangeEvents } = await import("./data");
    const before = [
      { id: "a", title: "Write it", done: false, notes: "<p>Do this</p>" },
      { id: "b", title: "For Claude", done: false, assigneeId: "u_claude" },
      { id: "c", title: "Send it", done: true },
      { id: "r", title: "Client asked", done: false, fromClient: true },
    ];
    const after = [{ ...before[0], done: true }, { ...before[2], done: false }];
    const ev = stepChangeEvents(before, after);
    expect(ev.map((e) => e.body)).toEqual(['finished the step "Write it"', 'deleted the step "For Claude"', 'reopened the step "Send it"']);
    expect(ev[1]).toMatchObject({ step: before[1], stepAt: 1 });
  });
});

describe("needs you", () => {
  it("says why the current step is your move after the client wrote or Claude finished, and nothing otherwise", async () => {
    const { needsYou, CLAUDE_ID } = await import("./data");
    const base = { status: "in_progress" as const, assigneeId: "u_derek" };
    const claude = { ...base, subtasks: [{ id: "a", title: "Draft it", done: true, assigneeId: CLAUDE_ID }, { id: "b", title: "Send it", done: false, startedAt: "x" }] };
    expect(needsYou(claude, "u_derek", "Pam")).toBe("Claude finished. Your turn");
    expect(needsYou(claude, "u_justin", "Pam")).toBeNull();
    const changes = { ...base, subtasks: [{ id: "c", title: "Changes from Pam", done: false, addedFor: "changes", startedAt: "x" }, { id: "r", title: "Bigger logo", done: false, fromClient: true, stepId: "c" }] };
    expect(needsYou(changes, "u_derek", "Pam")).toBe("Pam sent changes: 1 to do");
    const replied = { ...base, subtasks: [{ id: "w", title: "Check in", done: true, finishWhen: "reply" as const, outcome: "Pam replied" }, { id: "n", title: "Next", done: false, startedAt: "x" }] };
    expect(needsYou(replied, "u_derek", "Pam")).toBe("Pam replied. Your turn");
    const asked = { ...base, subtasks: [{ id: "d", title: "Changes to the page", done: false, addedFor: "page:2", startedAt: "x" }] };
    expect(needsYou(asked, "u_derek", "Pam")).toBe("Pam asked for changes");
    // Only the client writing and Claude finishing: a teammate finishing, or
    // a review coming back approved, does not put it in Needs you.
    const teammate = { ...base, subtasks: [{ id: "a", title: "Draft it", done: true, assigneeId: "u_justin" }, { id: "b", title: "Send it", done: false, startedAt: "x" }] };
    expect(needsYou(teammate, "u_derek", "Pam")).toBeNull();
    const approved = { ...base, subtasks: [{ id: "a", title: "Pam reviews", done: true, addedFor: "ok:page:2", onClient: true }, { id: "b", title: "Publish", done: false, startedAt: "x" }] };
    expect(needsYou(approved, "u_derek", "Pam")).toBeNull();
    const waiting = { ...base, subtasks: [{ id: "w", title: "Check in", done: false, finishWhen: "reply" as const, startedAt: "x" }] };
    expect(needsYou(waiting, "u_derek", "Pam")).toBeNull();
    expect(needsYou({ ...base, subtasks: [{ id: "p", title: "Plain", done: false }] }, "u_derek")).toBeNull();
  });

  it("leaves Needs you once you act, and comes back when something new arrives", async () => {
    const { needsYou } = await import("./data");
    const base = { status: "in_progress" as const, assigneeId: "u_derek" };
    const email = (at: string) => ({ messageId: at, from: "pam@x.com", subject: "Hi", body: "Videos?", at });
    const seen = { ...base, subtasks: [{ id: "r", title: "Reply to Pam", done: false, startedAt: "2026-10-13T10:00:00Z", fromEmails: [email("2026-10-13T10:00:00Z")], seenAt: "2026-10-13T12:00:00Z" }] };
    expect(needsYou(seen, "u_derek", "Pam")).toBeNull();
    const again = { ...base, subtasks: [{ ...seen.subtasks[0], fromEmails: [...seen.subtasks[0].fromEmails, email("2026-10-13T15:00:00Z")] }] };
    expect(needsYou(again, "u_derek", "Pam")).toBe("Pam wrote. Reply");
  });

  it("a new portal request after the changes step was cleared brings it back; older requests without a time do not", async () => {
    const { needsYou, needsYouSince } = await import("./data");
    const base = { status: "in_progress" as const, assigneeId: "u_derek" };
    const step = { id: "c", title: "Changes from Pam", done: false, addedFor: "changes", startedAt: "2026-10-13T10:00:00Z", seenAt: "2026-10-13T12:00:00Z" };
    const old = { id: "r1", title: "Bigger logo", done: false, fromClient: true, stepId: "c" };
    // Cleared, and the only request has no time (written before at existed): stays cleared.
    expect(needsYou({ ...base, subtasks: [step, old] }, "u_derek", "Pam")).toBeNull();
    // A request written before the clear: stays cleared.
    const before = { id: "r2", title: "New photo", done: false, fromClient: true, stepId: "c", at: "2026-10-13T11:00:00Z" };
    expect(needsYou({ ...base, subtasks: [step, old, before] }, "u_derek", "Pam")).toBeNull();
    // A new one after the clear: back in Needs you, with the count.
    const fresh = { id: "r3", title: "Change the hours", done: false, fromClient: true, stepId: "c", at: "2026-10-13T15:00:00Z" };
    expect(needsYou({ ...base, subtasks: [step, old, before, fresh] }, "u_derek", "Pam")).toBe("Pam sent changes: 3 to do");
    expect(needsYouSince([step, old, before, fresh], step)).toBe("2026-10-13T15:00:00Z");
    // Already ticked off, or on another step: does not count.
    expect(needsYou({ ...base, subtasks: [step, { ...fresh, done: true }] }, "u_derek", "Pam")).toBeNull();
    expect(needsYou({ ...base, subtasks: [step, { ...fresh, stepId: "other" }] }, "u_derek", "Pam")).toBeNull();
    // Cleared again after it: gone until the next one.
    expect(needsYou({ ...base, subtasks: [{ ...step, seenAt: "2026-10-13T16:00:00Z" }, old, before, fresh] }, "u_derek", "Pam")).toBeNull();
  });

  it("a new client comment on a cleared changes round brings it back", async () => {
    const { needsYou } = await import("./data");
    const base = { status: "in_progress" as const, assigneeId: "u_derek" };
    const round = { id: "m", title: "Make Pam's changes", done: false, addedFor: "page:2", startedAt: "2026-10-13T10:00:00Z", seenAt: "2026-10-13T12:00:00Z",
      todos: [{ id: "t1", title: "Fix the typo", done: false, fromClient: true, commentId: "k1" }] };
    expect(needsYou({ ...base, subtasks: [round] }, "u_derek", "Pam")).toBeNull();
    const more = { ...round, todos: [...round.todos, { id: "t2", title: "Swap the photo", done: false, fromClient: true, commentId: "k2", at: "2026-10-13T14:00:00Z" }] };
    expect(needsYou({ ...base, subtasks: [more] }, "u_derek", "Pam")).toBe("Pam asked for changes");
    // Our own to-do with a time is not the client's.
    const ours = { ...round, todos: [...round.todos, { id: "t3", title: "Check mobile", done: false, at: "2026-10-13T14:00:00Z" }] };
    expect(needsYou({ ...base, subtasks: [ours] }, "u_derek", "Pam")).toBeNull();
  });

  it("the × clears only the step that needs you, and nothing when nothing does", async () => {
    const { needsYou, clearedFromNeedsYou } = await import("./data");
    const base = { status: "in_progress" as const, assigneeId: "u_derek" };
    const email = { messageId: "m", from: "pam@x.com", subject: "Hi", body: "Videos?", at: "2026-10-13T10:00:00Z" };
    const task = { ...base, subtasks: [
      { id: "a", title: "Draft", done: true, doneAt: "2026-10-13T09:00:00Z" },
      { id: "r", title: "Reply to Pam", done: false, startedAt: "2026-10-13T10:00:00Z", fromEmails: [email] },
      { id: "z", title: "Send", done: false },
    ] };
    const cleared = clearedFromNeedsYou(task, "u_derek", "2026-10-13T12:00:00Z")!;
    expect(cleared.map((x) => x.seenAt)).toEqual([undefined, "2026-10-13T12:00:00Z", undefined]);
    expect(cleared.map((x) => x.done)).toEqual([true, false, false]);
    expect(needsYou({ ...task, subtasks: cleared }, "u_derek", "Pam")).toBeNull();
    expect(clearedFromNeedsYou(task, "u_other", "2026-10-13T12:00:00Z")).toBeNull();
    expect(clearedFromNeedsYou({ ...task, subtasks: cleared }, "u_derek", "2026-10-13T13:00:00Z")).toBeNull();
  });

  it("the Needs you setting: open clears on open, step on a tick, x on neither", async () => {
    const { needsYouClearsOn } = await import("./data");
    expect(needsYouClearsOn(undefined, "open")).toBe(true);
    expect(needsYouClearsOn("open", "open")).toBe(true);
    expect(needsYouClearsOn("open", "tick")).toBe(false);
    expect(needsYouClearsOn("step", "open")).toBe(false);
    expect(needsYouClearsOn("step", "tick")).toBe(true);
    expect(needsYouClearsOn("x", "open")).toBe(false);
    expect(needsYouClearsOn("x", "tick")).toBe(false);
    expect(needsYouClearsOn("nonsense", "open")).toBe(true);
  });

  it("a tick is something going from not done to done", async () => {
    const { tickedAStep } = await import("./data");
    const before = [{ id: "a", title: "A", done: true }, { id: "b", title: "B", done: false }];
    expect(tickedAStep(before, [before[0], { ...before[1], done: true }])).toBe(true);
    expect(tickedAStep(before, [{ ...before[0], done: false }, before[1]])).toBe(false);
    expect(tickedAStep(before, [...before, { id: "c", title: "C", done: true }])).toBe(false);
    expect(tickedAStep(before, before)).toBe(false);
  });
});

describe("following up while waiting", () => {
  it("a text after an email joins the open check in, says Text, and moves its date", async () => {
    const { addCheckInStep, followUpsLine } = await import("./data");
    const list = [
      { id: "e", title: "Email Ryan", done: true, outcome: "Email sent to Ryan" },
      { id: "c", title: "Check in if Ryan hasn't replied", done: false, finishWhen: "reply" as const, due: "2026-10-15", addedFor: "checkin:e" },
      { id: "t", title: "Text Ryan", done: false },
    ];
    const out = addCheckInStep(list, "t", "Ryan", "2026-10-16", () => "new", "2026-10-13T12:00:00Z", "sms")!;
    expect(out.filter((x) => x.finishWhen === "reply")).toHaveLength(1);
    expect(out.find((x) => x.id === "t")).toMatchObject({ done: true, outcome: "Text sent to Ryan" });
    expect(out.find((x) => x.id === "c")).toMatchObject({ due: "2026-10-16", followUps: [{ via: "sms", at: "2026-10-13T12:00:00Z" }] });
    expect(followUpsLine([{ via: "email", at: "2026-10-13T12:00:00Z" }, { via: "call", at: "2026-10-14T12:00:00Z" }])).toBe("Emailed Oct 13, called Oct 14");
  });
});

import { stepForNewWork } from "./data";

describe("where Claude's work goes on a task with steps", () => {
  const C = "u_claude";
  it("on Claude's own open step", () => {
    const list = [s("a", "Research", { done: true, doneAt: "2026-10-12T10:00:00Z" }), s("b", "Draft the blog post", { assigneeId: C }), s("c", "Derek review")];
    expect(stepForNewWork(list, "doc", { claudeId: C })).toEqual({ holdOn: "b", madeOn: "b" });
  });
  it("moves on from the step Claude just finished, the way a tick carries it (October Newsletter)", () => {
    const list = [
      s("a", "Draft Email Campaign HTML", { done: true, doneAt: "2026-10-12T20:09:00Z", assigneeId: C }),
      s("b", "Derek review: newsletter email"), s("c", "Send the newsletter to Brandon for review"),
    ];
    expect(stepForNewWork(list, "page", { claudeId: C })).toEqual({ holdOn: "b", madeOn: "a" });
    // Already approved: finished work stays where it was made.
    expect(stepForNewWork(list, "page", { claudeId: C, finished: true })).toEqual({ holdOn: "a", madeOn: "a" });
  });
  it("else the current step, never the client's own waiting step", () => {
    const list = [s("a", "Draft", { done: true, doneAt: "2026-10-12T10:00:00Z", assigneeId: "u_derek" }), s("w", "Waiting on Brian", { onClient: true }), s("b", "Schedule")];
    expect(stepForNewWork(list, "doc", { claudeId: C })).toEqual({ holdOn: "b", madeOn: "b" });
  });
  it("the step named wins, and no open steps means nowhere", () => {
    const list = [s("a", "Draft", { assigneeId: C }), s("b", "Review")];
    expect(stepForNewWork(list, "image", { claudeId: C, stepId: "b" })).toEqual({ holdOn: "b", madeOn: "b" });
    expect(stepForNewWork([s("a", "Draft", { done: true })], "doc", { claudeId: C })).toBeNull();
    expect(stepForNewWork([], "doc", { claudeId: C })).toBeNull();
  });
});

import { saysReview, stepForWork } from "./data";

describe("the review step wins: where unfinished work goes when a step is ticked", () => {
  const blog = () => [
    s("a", "Draft the blog post", { done: true, doneAt: "2026-10-13T10:00:00Z", assigneeId: "u_claude", holds: ["doc"] }),
    s("b", "Create the stat image in ChatGPT"),
    s("c", "Derek review"),
    s("d", "Publish"),
  ];
  it("a review word in the title, any case, as a word", () => {
    expect(["Derek review", "Review the draft", "REVIEWING it", "Derek review: newsletter email"].every(saysReview)).toBe(true);
    expect(["Preview the page", "Create the stat image", "Publish"].some(saysReview)).toBe(false);
  });
  it("blog task: 1 Draft done, the work goes to 3 Derek review, not 2 the stat image", () => {
    const list = blog();
    expect(stepForWork(list, "a", list[1])?.id).toBe("c");
    expect(stepForNewWork(list, "doc", { claudeId: "u_claude" })).toEqual({ holdOn: "c", madeOn: "a" });
    // Approved work still stays where it was made.
    expect(stepForNewWork(list, "doc", { claudeId: "u_claude", finished: true })).toEqual({ holdOn: "a", madeOn: "a" });
  });
  it("no review step: the next open step, as before", () => {
    const list = [s("a", "Write it", { done: true }), s("b", "Make the image"), s("c", "Publish")];
    expect(stepForWork(list, "a", list[1])?.id).toBe("b");
  });
  it("never the client's own waiting step, a portal request, a done step, or a review before the ticked one", () => {
    const list = [
      s("r0", "Review the brief"),
      s("a", "Write it", { done: true }),
      s("w", "Waiting on Brian to review it", { onClient: true }),
      s("p", "Please review my logo", { fromClient: true }),
      s("x", "Derek review", { done: true }),
      s("b", "Make the image"),
    ];
    expect(stepForWork(list, "a", list[5])?.id).toBe("b");
  });
  it("nothing next and no review step: nowhere", () => {
    expect(stepForWork([s("a", "Write it", { done: true })], "a", null)).toBeNull();
  });
});
