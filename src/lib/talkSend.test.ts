import { describe, expect, it } from "vitest";
import { talkSendPatch, talkStepPlan } from "./talkSend";
import type { Subtask } from "./data";

const step = (p: Partial<Subtask> & Pick<Subtask, "id" | "title">): Subtask => ({ done: false, ...p } as Subtask);
const NOW = "2026-10-14T17:00:00.000Z";
let n = 0;
const makeId = () => `s_new${++n}`;

describe("talkStepPlan", () => {
  it("finishes a text step holding the text, from that step", () => {
    const subs = [step({ id: "a", title: "Text Pamela", draftMessage: { channel: "sms", body: "Hi" } })];
    const plan = talkStepPlan(subs, null, "sms", "2026-10-14", null, "a");
    expect(plan?.kind).toBe("finish");
    expect(plan?.due).toBe("2026-10-19");
  });
  it("follows up on a check in that is waiting on their reply", () => {
    const subs = [step({ id: "a", title: "Email Pamela", done: true }), step({ id: "b", title: "Check in", finishWhen: "reply" })];
    expect(talkStepPlan(subs, null, "email", "2026-10-14")?.kind).toBe("wait");
  });
  it("leaves a step that isn't about talking to them", () => {
    expect(talkStepPlan([step({ id: "a", title: "Design the page" })], null, "email", "2026-10-14")).toBeNull();
  });
});

describe("talkSendPatch", () => {
  it("ticks the step, clears its draft and adds the check in", () => {
    const subs = [step({ id: "a", title: "Text Pamela", draftMessage: { channel: "sms", body: "Hi" } })];
    const plan = talkStepPlan(subs, null, "sms", "2026-10-14", null, "a")!;
    const out = talkSendPatch({ subtasks: subs, status: "todo", due: "2026-10-15", assigneeId: null }, plan, "sms", "Pamela", makeId, NOW)!;
    const list = out.patch.subtasks!;
    expect(list[0]).toMatchObject({ id: "a", done: true, outcome: "Text sent to Pamela", draftMessage: undefined });
    expect(list[1]).toMatchObject({ title: "Check in if Pamela hasn't replied", finishWhen: "reply", due: "2026-10-19" });
    expect(out.patch.followUpAt).toBe("2026-10-19");
    expect(out.patch.due).toBe("2026-10-19");
  });
  it("records a follow up on a wait and clears the draft", () => {
    const subs = [step({ id: "b", title: "Check in", finishWhen: "reply", draftMessage: { channel: "sms", body: "Nudge" } })];
    const plan = talkStepPlan(subs, null, "sms", "2026-10-14")!;
    const out = talkSendPatch({ subtasks: subs, status: "waiting", due: null, assigneeId: null }, plan, "sms", "Pamela", makeId, NOW)!;
    expect(out.patch.subtasks![0]).toMatchObject({ draftMessage: undefined, followUps: [{ via: "sms", at: NOW }] });
  });
});

describe("talkSendPatch with After this filled", () => {
  it("a wait on the client: the send joins it with its own check in date, no check in step added", () => {
    const subs = [step({ id: "a", title: "Reply to Pamela", holds: ["email"] }), step({ id: "b", title: "Wait for Pam's class times", finishWhen: "reply", stage: "waiting", due: "2026-10-20" })];
    const plan = talkStepPlan(subs, null, "email", "2026-10-14")!;
    expect(plan.after?.id).toBe("b");
    expect(plan.due).toBe("2026-10-20");
    const out = talkSendPatch({ subtasks: subs, status: "in_progress", due: null, assigneeId: null }, plan, "email", "Pamela", makeId, NOW)!;
    const list = out.patch.subtasks!;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ done: true, outcome: "Email sent to Pamela" });
    expect(list[1]).toMatchObject({ id: "b", due: "2026-10-20", startedAt: NOW, followUps: [{ via: "email", at: NOW }] });
    expect(out.patch.followUpAt).toBe("2026-10-20");
  });
  it("a step of ours: the send finishes this step and starts that one, no check in", () => {
    const subs = [step({ id: "a", title: "Reply to Pamela", holds: ["email"] }), step({ id: "b", title: "Build the ad", makes: "page" })];
    const plan = talkStepPlan(subs, null, "email", "2026-10-14")!;
    const out = talkSendPatch({ subtasks: subs, status: "waiting", due: null, assigneeId: null }, plan, "email", "Pamela", makeId, NOW)!;
    const list = out.patch.subtasks!;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ done: true, outcome: "Email sent to Pamela" });
    expect(list[1]).toMatchObject({ id: "b", startedAt: NOW, done: false });
    expect(out.patch.followUpAt).toBeUndefined();
    expect(out.patch.status).toBe("in_progress");
  });
});
