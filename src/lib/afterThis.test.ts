import { describe, expect, it } from "vitest";
import { addAfterThisStep, afterThisOf, afterThisWho, doneNextLabel, finishIntoNext, finishOpensWhatsNext, patchForAction, patchForWho, remindKind, remindWord, suggestedAfter } from "./afterThis";
import { CLAUDE_ID, type Subtask } from "./data";

const step = (p: Partial<Subtask> & Pick<Subtask, "id" | "title">): Subtask => ({ done: false, ...p } as Subtask);
const NOW = "2026-10-15T16:00:00.000Z";

describe("After this", () => {
  it("is the plan's next open step after the current one", () => {
    const subs = [step({ id: "a", title: "Reply to Pam", done: true }), step({ id: "b", title: "Reply to Pam again" }), step({ id: "c", title: "Wait for Pam's reply", finishWhen: "reply" })];
    expect(afterThisOf(subs, "b")?.id).toBe("c");
    expect(afterThisOf(subs, "c")).toBeNull();
  });
  it("is empty when the next step only asks what's next", () => {
    const subs = [step({ id: "a", title: "Build it" }), step({ id: "b", title: "Build it: what's next?", addedFor: "next:a" })];
    expect(afterThisOf(subs, "a")).toBeNull();
    expect(finishOpensWhatsNext(subs, "a")).toBe(true);
  });
  it("filled, Done starts the next step without What's next", () => {
    const subs = [step({ id: "a", title: "Reply to Pam", startedAt: NOW }), step({ id: "b", title: "Make the ad" })];
    expect(finishOpensWhatsNext(subs, "a")).toBe(false);
    const out = finishIntoNext(subs, "a", { now: NOW, outcome: "Done", byId: "u_derek" })!;
    expect(out.subtasks[0]).toMatchObject({ done: true, doneAt: NOW, outcome: "Done", doneBy: "u_derek" });
    expect(out.next).toMatchObject({ id: "b", startedAt: NOW, done: false });
  });
  it("adds a named next step right after the current one", () => {
    const subs = [step({ id: "a", title: "Reply" }), step({ id: "z", title: "Later", done: true })];
    const list = addAfterThisStep(subs, "a", "Wait for Pam", "n1", { finishWhen: "reply" });
    expect(list.map((x) => x.id)).toEqual(["a", "n1", "z"]);
    expect(list[1]).toMatchObject({ title: "Wait for Pam", done: false, finishWhen: "reply" });
  });
  it("suggests waiting for the client's reply after an email to them, two business days out", () => {
    // Thursday Oct 15: the check in is Monday Oct 19.
    expect(suggestedAfter(step({ id: "a", title: "Reply to Pamela: class times", fromEmails: [{ messageId: "m", from: "Pam", subject: "x", body: "", at: NOW }] }), "Pamela", "2026-10-15"))
      .toEqual({ title: "Wait for Pamela's reply", finishWhen: "reply", stage: "waiting", due: "2026-10-19" });
    expect(suggestedAfter(step({ id: "a", title: "Email Pamela" }), "Pamela", "2026-10-15")?.title).toBe("Wait for Pamela's reply");
    expect(suggestedAfter(step({ id: "a", title: "Design the page" }), "Pamela", "2026-10-15")).toBeNull();
    expect(suggestedAfter(step({ id: "a", title: "Email Pamela", assigneeId: CLAUDE_ID }), "Pamela", "2026-10-15")).toBeNull();
  });
  it("Done says whose turn comes next", () => {
    const o = { meId: "u_derek", ownerId: "u_derek", clientFirst: "Pamela", nameOf: (id: string) => (id === "u_justin" ? "Justin" : "Someone") };
    expect(doneNextLabel("client", o)).toBe("Done · Pamela's turn next");
    expect(doneNextLabel(CLAUDE_ID, o)).toBe("Done · Claude next");
    expect(doneNextLabel("u_derek", o)).toBe("Done · your turn next");
    expect(doneNextLabel(null, o)).toBe("Done · your turn next");
    expect(doneNextLabel("u_justin", o)).toBe("Done · Justin's turn next");
  });
  it("whose turn: the client's is a wait, Claude's has no date or reminder", () => {
    const o = { ownerId: "u_derek", meId: "u_derek" };
    expect(afterThisWho(step({ id: "b", title: "Wait", finishWhen: "reply", assigneeId: "u_derek" }), "u_derek")).toBe("client");
    expect(patchForWho({}, "client", o)).toMatchObject({ finishWhen: "reply", stage: "waiting", assigneeId: undefined });
    expect(patchForWho({ remind: { every: 2 } }, "client", o)).not.toHaveProperty("remind");
    expect(patchForWho({ remind: { every: 2 }, due: "2026-10-19" }, CLAUDE_ID, o)).toMatchObject({ assigneeId: CLAUDE_ID, due: undefined, remind: undefined });
    expect(patchForWho({ remind: { at: "morning" } }, "u_justin", o)).not.toHaveProperty("remind");
    expect(patchForWho({ remind: { at: "morning" } }, "u_derek", o)).toMatchObject({ remind: undefined });
  });
  it("a reminder only for someone else's turn, and how it reads", () => {
    const o = { ownerId: "u_derek", meId: "u_derek" };
    expect(remindKind("client", o)).toBe("client");
    expect(remindKind("u_justin", o)).toBe("teammate");
    expect(remindKind(CLAUDE_ID, o)).toBeNull();
    expect(remindKind("u_derek", o)).toBeNull();
    expect(remindWord({ every: "once" }, "Pamela", "Mon, Oct 19")).toBe("email Pamela on Mon, Oct 19");
    expect(remindWord({ every: 2 }, "Pamela")).toBe("remind Pamela every 2 days");
    expect(remindWord({ at: "day_before" }, "Justin")).toBe("remind Justin the day before");
  });
  it("an action word sets what the step makes or writes", () => {
    expect(patchForAction("doc")).toEqual({ makes: "doc", draftMessage: undefined });
    expect(patchForAction("text")).toEqual({ makes: undefined, draftMessage: { channel: "sms", body: "" } });
    expect(patchForAction(null)).toEqual({ makes: undefined, draftMessage: undefined });
  });
});
