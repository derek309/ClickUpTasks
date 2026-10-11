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
