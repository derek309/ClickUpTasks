import { describe, it, expect } from "vitest";
import { actionDidSomething, actionTouched, mergeActions, reviewLeftEmpty, undoAction, type ActionRecord, type ActionState } from "./undoAction";
import { answerWhatsNext, holdOnStep, type EmailDraft, type Subtask } from "./data";

// Derek, 2026-10-15: "If we click Email a follow up, or create a doc, or email
// or anything, and we hit Esc and never enter anything, cancel and remove it."

const step = (id: string, title: string, more: Partial<Subtask> = {}): Subtask => ({ id, title, done: false, ...more });
const draft = (body: string, more: Partial<EmailDraft> = {}): EmailDraft => ({ subject: "Checking in", body, createdAt: "2026-10-15T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z", replyTo: null, ...more });
const rec = (before: ActionState, after: ActionState, slot = "email"): ActionRecord => ({ slot, before, after });

const waiting = step("s1", "Send the proposal", { done: true });
const checkIn = step("s2", "Check in with Carol", { finishWhen: "reply", assigneeId: "u_me" });
const template = "<p>Hi Carol,</p><p>Just checking in on the proposal.</p>";

describe("an action left with nothing entered", () => {
  it("takes back an untouched template: the follow up email and its hold go", () => {
    const before = { subtasks: [waiting, checkIn], draftEmail: null };
    const after = { subtasks: holdOnStep(before.subtasks, "s2", "email"), draftEmail: draft(template) };
    const back = undoAction(rec(before, after), after);
    expect(back?.draftEmail).toBeNull();
    expect(back?.subtasks?.find((s) => s.id === "s2")?.holds).toBeUndefined();
    expect(back?.removed).toEqual([]);
  });

  it("takes off the step the action made, with its draft", () => {
    const before = { subtasks: [waiting], draftEmail: null };
    const made = step("s9", "Email Carol", { due: "2026-10-15", assigneeId: "u_me", holds: ["email"] });
    const after = { subtasks: [waiting, made], draftEmail: draft("<p>Hi Carol,</p>") };
    const back = undoAction(rec(before, after), after);
    expect(back?.subtasks?.map((s) => s.id)).toEqual(["s1"]);
    expect(back?.removed).toEqual(["s9"]);
    expect(back?.draftEmail).toBeNull();
  });

  it("keeps everything once text was typed into the email", () => {
    const before = { subtasks: [waiting], draftEmail: null };
    const after = { subtasks: [waiting, step("s9", "Email Carol", { holds: ["email"] })], draftEmail: draft("<p>Hi Carol,</p>") };
    const typed = { ...after, draftEmail: draft("<p>Hi Carol,</p><p>The roof is done.</p>") };
    expect(actionTouched(rec(before, after), typed)).toBe(true);
    expect(undoAction(rec(before, after), typed)).toBeNull();
  });

  it("keeps it when only the subject, a file or a copy was added", () => {
    const before = { subtasks: [], draftEmail: null };
    const after = { subtasks: [], draftEmail: draft(template) };
    expect(undoAction(rec(before, after), { subtasks: [], draftEmail: draft(template, { subject: "The roof" }) })).toBeNull();
    expect(undoAction(rec(before, after), { subtasks: [], draftEmail: draft(template, { attachments: [{ id: "a1", name: "roof.jpg", kind: "file" } as never] }) })).toBeNull();
    expect(undoAction(rec(before, after), { subtasks: [], draftEmail: draft(template, { cc: ["pam@example.com"] }) })).toBeNull();
  });

  it("reads the same words as untouched however the editor wrote them, and ignores the link the app adds", () => {
    const before = { subtasks: [], draftEmail: null };
    const after = { subtasks: [], draftEmail: draft(template) };
    const now = { subtasks: [], draftEmail: draft("<p>Hi Carol,</p>\n<p>Just checking in on the proposal. </p>", { link: { url: "https://x.test/r/1", label: "Open" }, updatedAt: "2026-10-15T10:01:00Z" }) };
    expect(undoAction(rec(before, after), now)?.draftEmail).toBeNull();
  });

  it("puts back the draft it replaced", () => {
    const old = draft("<p>Hi Carol, here is the old one.</p>", { createdAt: "2026-10-14T09:00:00Z", subject: "Old" });
    const before = { subtasks: [], draftEmail: old };
    const after = { subtasks: [], draftEmail: draft(template) };
    expect(undoAction(rec(before, after), after)?.draftEmail).toBe(old);
  });

  it("asks What's next again when the pick that renamed it is left untouched", () => {
    const asking = step("s3", "Send the proposal: what's next?", { addedFor: "next:s1", assigneeId: "u_me" });
    const before = { subtasks: [waiting, asking] };
    const after = { subtasks: answerWhatsNext(before.subtasks, "s3", "Text Carol", { draftMessage: { channel: "sms", body: "" } }) };
    expect(after.subtasks[1].title).toBe("Text Carol");
    const back = undoAction(rec(before, after, "msg:s3"), after);
    const s3 = back?.subtasks?.find((s) => s.id === "s3");
    expect(s3?.title).toBe("Send the proposal: what's next?");
    expect(s3?.asked).toBeUndefined();
    expect(s3?.draftMessage).toBeUndefined();
    expect(s3?.assigneeId).toBe("u_me");
  });

  it("takes back a follow up text started from a template when it was never changed", () => {
    const before = { subtasks: [waiting, checkIn] };
    const body = "Hi Carol, I sent you an email about the proposal. Did you get it?";
    const after = { subtasks: before.subtasks.map((s) => (s.id === "s2" ? { ...s, draftMessage: { channel: "sms" as const, body } } : s)) };
    expect(undoAction(rec(before, after, "msg:s2"), after)?.subtasks?.[1].draftMessage).toBeUndefined();
    const edited = { subtasks: after.subtasks.map((s) => (s.id === "s2" ? { ...s, draftMessage: { channel: "sms" as const, body: `${body} Thanks!` } } : s)) };
    expect(undoAction(rec(before, after, "msg:s2"), edited)).toBeNull();
  });

  it("never takes off a step that got anything else: notes, to dos, a file, an outcome, a new name", () => {
    const before = { subtasks: [waiting] };
    const made = step("s9", "Checklist", { assigneeId: "u_me" });
    const after = { subtasks: [waiting, made] };
    const r = rec(before, after, "step:s9");
    const withIt = (p: Partial<Subtask>) => ({ subtasks: [waiting, { ...made, ...p }] });
    expect(undoAction(r, withIt({ notes: "<p>Use the blue logo</p>" }))).toBeNull();
    expect(undoAction(r, withIt({ todos: [{ id: "t1", title: "Logo", done: false }] }))).toBeNull();
    expect(undoAction(r, withIt({ holds: ["att:a1"] }))).toBeNull();
    expect(undoAction(r, withIt({ outcome: "Done" }))).toBeNull();
    expect(undoAction(r, withIt({ title: "Get the logo" }))).toBeNull();
    expect(undoAction(r, withIt({ due: "2026-10-20" }))).toBeNull();
    expect(undoAction(r, after)?.removed).toEqual(["s9"]);
  });

  it("does not count the app's own bookkeeping or a round trip through the database as entered", () => {
    const before = { subtasks: [waiting] };
    const made = step("s9", "Text Carol", { assigneeId: "u_me", due: "2026-10-15", draftMessage: { channel: "sms", body: "" } });
    const after = { subtasks: [waiting, made] };
    // Keys reordered, nulls for missing fields, the start stamped.
    const saved = { title: "Text Carol", draftMessage: { body: "", channel: "sms" }, due: "2026-10-15", id: "s9", done: false, assigneeId: "u_me", note: null, startedAt: "2026-10-15T10:00:00Z", seenAt: "2026-10-15T10:00:00Z" } as unknown as Subtask;
    expect(undoAction(rec(before, after, "step:s9"), { subtasks: [waiting, saved] })?.removed).toEqual(["s9"]);
  });

  it("has nothing to take back when the action only opened what was there", () => {
    const state = { subtasks: [waiting], draftEmail: draft(template) };
    expect(actionDidSomething(rec(state, state))).toBe(false);
    expect(undoAction(rec(state, state), state)).toBeNull();
  });

  it("is kept when the draft was sent or thrown away meanwhile", () => {
    const before = { subtasks: [waiting], draftEmail: null };
    const after = { subtasks: holdOnStep([waiting], "s1", "email"), draftEmail: draft(template) };
    expect(undoAction(rec(before, after), { ...after, draftEmail: null })).toBeNull();
  });

  it("merges a second untouched action on the same slot back to before the first", () => {
    const s0 = { subtasks: [waiting], draftEmail: null };
    const s1 = { subtasks: [waiting, step("s9", "Email Carol", { holds: ["email"] })], draftEmail: null };
    const s2 = { ...s1, draftEmail: draft(template) };
    const merged = mergeActions(rec(s0, s1), rec(s1, s2));
    expect(merged.before).toBe(s0);
    expect(undoAction(merged, s2)?.removed).toEqual(["s9"]);
    // The first one was used: the second stands alone.
    const used = { ...s1, subtasks: [waiting, step("s9", "Email Carol", { holds: ["email"], notes: "<p>x</p>" })] };
    expect(mergeActions(rec(s0, s1), rec(used, { ...used, draftEmail: draft(template) })).before).toBe(used);
  });
});

describe("a review made by opening it", () => {
  const empty = { version: 0, body: "", title: "", madeTitle: "", typed: null, files: 0, comments: 0, busy: false };
  it("is left empty with nothing written, named, uploaded or commented", () => {
    expect(reviewLeftEmpty(empty)).toBe(true);
    expect(reviewLeftEmpty({ ...empty, typed: "<p></p>" })).toBe(true);
  });
  it("is kept once anything went into it", () => {
    expect(reviewLeftEmpty({ ...empty, typed: "<p>Hello</p>" })).toBe(false);
    expect(reviewLeftEmpty({ ...empty, body: "<p>Saved</p>" })).toBe(false);
    expect(reviewLeftEmpty({ ...empty, title: "Spring flyer" })).toBe(false);
    expect(reviewLeftEmpty({ ...empty, files: 1 })).toBe(false);
    expect(reviewLeftEmpty({ ...empty, comments: 1 })).toBe(false);
    expect(reviewLeftEmpty({ ...empty, version: 1 })).toBe(false);
    expect(reviewLeftEmpty({ ...empty, busy: true })).toBe(false);
  });
});
