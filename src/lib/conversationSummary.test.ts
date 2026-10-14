import { describe, expect, it } from "vitest";
import { conversationSummary, snippet } from "./conversationSummary";
import type { Comment, Message, TaskAction } from "./data";

const msg = (id: string, direction: "inbound" | "outbound", at: string, body: string, extra: Partial<Message> = {}) =>
  ({ id, contactId: "c", clientId: "cl", taskId: "t", channel: "email", direction, subject: "Hi", body, ghlMessageId: null, createdBy: null, at, read: true, attachments: [], cc: [], bcc: [], ...extra }) as Message;
const ago = () => "2h ago";
const base = { comments: [] as Comment[], taskCreatedAt: "2026-10-01T00:00:00Z", firstName: "Pam", ago };

describe("conversationSummary", () => {
  it("says nothing yet when nothing was said", () => {
    expect(conversationSummary(base)).toEqual({ count: 0, line: "nothing yet" });
  });

  it("names the client when the newest is from them, with the start of it", () => {
    const r = conversationSummary({ ...base, messages: [
      msg("m1", "outbound", "2026-10-13T10:00:00Z", "<p>Here is the copy.</p>"),
      msg("m2", "inbound", "2026-10-14T10:00:00Z", "<p>Looks great! Can we change the second headline to mention the free quote and the new office hours?</p>", { peerName: "Pam Macias" }),
    ] });
    expect(r.count).toBe(2);
    expect(r.line).toBe("2 · last from Pam, 2h ago: Looks great! Can we change the second headline to mention…");
  });

  it("says from us for our own message and a team note for a note", () => {
    expect(conversationSummary({ ...base, messages: [msg("m1", "outbound", "2026-10-14T10:00:00Z", "Sent")] }).line).toBe("1 · last from us, 2h ago: Sent");
    const note: Comment = { id: "c1", authorId: "u", body: "Pam likes mornings", at: "2026-10-14T11:00:00Z" };
    expect(conversationSummary({ ...base, comments: [note], messages: [msg("m1", "outbound", "2026-10-14T10:00:00Z", "Sent")] }).line).toBe("2 · a team note, 2h ago: Pam likes mornings");
  });

  it("leaves out logged changes, calls and replies to actions, like the tab", () => {
    const event: Comment = { id: "e", authorId: "u", body: "changed status", at: "2026-10-14T12:00:00Z", kind: "event" };
    const call = msg("m9", "outbound", "2026-10-14T12:00:00Z", "call", { channel: "call" });
    const reply = { id: "a2", taskId: "t", kind: "note", authorId: "u", parentId: "a1", body: "reply", at: "2026-10-14T12:00:00Z", nextStep: null, nextStepDue: null, nextStepDoneAt: null } as TaskAction;
    expect(conversationSummary({ ...base, comments: [event], messages: [call], actions: [reply] })).toEqual({ count: 0, line: "nothing yet" });
  });
});

describe("snippet", () => {
  it("keeps a short text whole and cuts a long one at a word", () => {
    expect(snippet("  short   text ")).toBe("short text");
    expect(snippet("a".repeat(80))).toBe(`${"a".repeat(60)}…`);
  });
});
