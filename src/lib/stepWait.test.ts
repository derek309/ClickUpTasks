import { describe, it, expect } from "vitest";
import { addCheckInStep, checkInTitle, type Subtask } from "./data";
import { replyWaitTitle, showCheckingAgain, stepRemindersOn, waitChoiceKeys } from "./stepWait";

const sent = { id: "s_tell", title: "Let Carol know the changes are done", done: true, holds: ["email", "mail:m1"] } as Subtask;
const wait = (title: string, more: Partial<Subtask> = {}) => ({ id: "s_check", title, done: false, stage: "waiting", addedFor: "checkin:s_tell", finishWhen: "reply", ...more }) as Subtask;
const subjects: Record<string, string> = { m1: "Re: Your website changes are done" };

describe("checkInTitle", () => {
  it("names what the check in waits for", () => {
    expect(checkInTitle("Carol", "Your website changes are done")).toBe("Carol's reply to: Your website changes are done");
    expect(checkInTitle("Carol", "Re: Fwd: Your website changes are done")).toBe("Carol's reply to: Your website changes are done");
    expect(checkInTitle("Carol", "  ")).toBe("Carol's reply");
    expect(checkInTitle("Carol")).toBe("Carol's reply");
  });
  it("is the name a new check in step gets, with the email's subject", () => {
    const out = addCheckInStep([{ id: "t", title: "Let Carol know", done: false } as Subtask], "t", "Carol", "2026-10-19", () => "n", "2026-10-16T12:00:00Z", "email", "Your changes")!;
    expect(out[1].title).toBe("Carol's reply to: Your changes");
    const text = addCheckInStep([{ id: "t", title: "Text Carol", done: false } as Subtask], "t", "Carol", "2026-10-19", () => "n", "2026-10-16T12:00:00Z", "sms", "ignored")!;
    expect(text[1].title).toBe("Carol's reply");
  });
});

describe("replyWaitTitle", () => {
  it("shows an old check in as the reply it waits for, by the sent email's subject", () => {
    const step = wait("Check in if Carol Lindenmuth hasn't replied");
    expect(replyWaitTitle(step, [sent, step], "Carol", (id) => subjects[id])).toBe("Carol's reply to: Your website changes are done");
  });
  it("falls back to the waiting card's email, then to the bare reply", () => {
    const step = wait("Check in if Carol hasn't replied");
    expect(replyWaitTitle(step, [sent, step], "Carol", () => null, "Pet care page")).toBe("Carol's reply to: Pet care page");
    expect(replyWaitTitle(step, [sent, step], "Carol", () => null)).toBe("Carol's reply");
    expect(replyWaitTitle(wait("Carol's reply"), [sent], "Carol", (id) => subjects[id])).toBe("Carol's reply to: Your website changes are done");
  });
  it("keeps a name someone typed, and any step that is not a check in", () => {
    expect(replyWaitTitle(wait("Wait for Carol's reply"), [sent], "Carol", (id) => subjects[id])).toBe("Wait for Carol's reply");
    expect(replyWaitTitle(wait("Call Carol about the deposit"), [sent], "Carol", (id) => subjects[id])).toBe("Call Carol about the deposit");
    expect(replyWaitTitle(wait("Check in if Carol hasn't replied", { addedFor: undefined }), [sent], "Carol", (id) => subjects[id])).toBe("Check in if Carol hasn't replied");
    expect(replyWaitTitle(wait("Carol's reply to: Old subject"), [sent], "Carol", (id) => subjects[id])).toBe("Carol's reply to: Old subject");
  });
});

describe("the client's step sentence: checking again", () => {
  it("is dropped whenever reminders are on", () => {
    expect(showCheckingAgain({ remindersOn: true, followUp: "2026-10-20", needBy: "2026-10-17" })).toBe(false);
  });
  it("is dropped when it repeats the need by date", () => {
    expect(showCheckingAgain({ remindersOn: false, followUp: "2026-10-17", needBy: "2026-10-17" })).toBe(false);
  });
  it("stays with reminders off and a different date", () => {
    expect(showCheckingAgain({ remindersOn: false, followUp: "2026-10-20", needBy: "2026-10-17" })).toBe(true);
    expect(showCheckingAgain({ remindersOn: false, followUp: "2026-10-20", needBy: null })).toBe(true);
    expect(showCheckingAgain({ remindersOn: false, followUp: null, needBy: null })).toBe(false);
  });
  it("reads reminders on from the step: on by default with a need by date, off when turned off or nobody to email", () => {
    expect(stepRemindersOn({ due: "2026-10-17" }, true)).toBe(true);
    expect(stepRemindersOn({ due: "2026-10-17", remind: { off: true } }, true)).toBe(false);
    expect(stepRemindersOn({ due: null }, true)).toBe(false);
    expect(stepRemindersOn({ due: "2026-10-17" }, false)).toBe(false);
  });
});

describe("a wait's What's next choices", () => {
  it("has no Email a follow up while reminders are on", () => {
    expect(waitChoiceKeys({ canEmail: true, heldDraft: false, canText: true, remindersOn: true })).toEqual(["text", "call"]);
  });
  it("keeps Email a follow up with reminders off", () => {
    expect(waitChoiceKeys({ canEmail: true, heldDraft: false, canText: true, remindersOn: false })).toEqual(["email", "text", "call"]);
  });
  it("still sends a follow up already written, and needs an email address for either", () => {
    expect(waitChoiceKeys({ canEmail: true, heldDraft: true, canText: false, remindersOn: true })).toEqual(["send", "call"]);
    expect(waitChoiceKeys({ canEmail: false, heldDraft: false, canText: false, remindersOn: false })).toEqual(["call"]);
  });
});
