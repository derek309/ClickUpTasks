import { describe, it, expect } from "vitest";
import { inboxKind, isInboxNotification, latestCommentBy } from "./extensionInbox";

// The Inboxes app must never show a client's email or text twice, so the
// inbound email/SMS/call notifications have to fall out while mentions,
// comments, portal chat and client reviews stay in.
describe("inboxKind", () => {
  it("keeps a mention", () => {
    expect(inboxKind({ text: "Justin mentioned you in “Website refresh”", actor_id: "u_justin" })).toBe("mention");
  });
  it("keeps a Journal mention without a task", () => {
    expect(inboxKind({ text: "Justin mentioned you in the Agency chat", actor_id: "u_justin" })).toBe("mention");
  });
  it("keeps a comment on your task", () => {
    expect(inboxKind({ text: "Justin commented on “Website refresh”", actor_id: "u_justin" })).toBe("comment");
  });
  it("keeps a client portal chat message", () => {
    expect(inboxKind({ text: "Amanda Standley sent a message on \"Logo files\".", actor_id: null })).toBe("client_chat");
  });
  it("keeps what a client did on a review", () => {
    for (const text of [
      "Amanda Standley commented on the web page on \"Review test document\".",
      "Amanda Standley approved the image on \"Logo files\".",
      "Amanda Standley sent changes to the client document on \"Proposal\".",
      "Amanda Standley asked for changes on the image on \"Logo files\".",
      "Amanda Standley approved \"Logo files\".",
      "Amanda Standley flagged \"Logo files\" for a closer look.",
      "Amanda Standley requested changes on \"Logo files\".",
    ]) expect(inboxKind({ text, actor_id: null })).toBe("client_review");
  });
  it("drops a reminder or a logged email that only sounds like a review", () => {
    expect(inboxKind({ text: "No approval yet on \"Logo files\" after 7 days. A check in email is ready to review on the task.", actor_id: null })).toBeNull();
    expect(inboxKind({ text: "ClickUpLocal sent an email: Invoice approved \"Logo files\".", actor_id: null })).toBeNull();
  });
  it("drops an inbound email or text, which Inboxes already reads from Gmail and GHL", () => {
    expect(inboxKind({ text: "Amanda Standley emailed: Re: proof", actor_id: null })).toBeNull();
    expect(inboxKind({ text: "New SMS from Amanda Standley", actor_id: null })).toBeNull();
  });
  it("drops a teammate event that is not a mention or comment", () => {
    expect(inboxKind({ text: "Justin handed you “Logo files”", actor_id: "u_justin" })).toBeNull();
  });
  it("copes with no text", () => {
    expect(inboxKind({ text: null, actor_id: null })).toBeNull();
  });
});

describe("isInboxNotification", () => {
  it("counts messages and what a client did, not teammate activity or DMs", () => {
    expect(isInboxNotification({ kind: "message", actorId: "u_justin" })).toBe(true);
    expect(isInboxNotification({ kind: "activity", actorId: null })).toBe(true);
    expect(isInboxNotification({ kind: "activity", actorId: "u_justin" })).toBe(false);
    expect(isInboxNotification({ kind: "dm", actorId: "u_justin" })).toBe(false);
  });
});

describe("latestCommentBy", () => {
  const comments = [
    { authorId: "u_justin", body: "First look done" },
    { authorId: "u_derek", body: "Thanks" },
    { authorId: "u_justin", body: "status changed", kind: "event" },
    { authorId: "u_justin", body: "  @Derek Fox can you approve?  " },
  ];
  it("returns the author's newest real comment, trimmed", () => {
    expect(latestCommentBy(comments, "u_justin")).toBe("@Derek Fox can you approve?");
  });
  it("skips event lines and other authors", () => {
    expect(latestCommentBy(comments.slice(0, 3), "u_justin")).toBe("First look done");
  });
  it("includes event lines when asked, for a client's review notes", () => {
    const review = [...comments, { authorId: "client", body: "Amanda approved the image (version 2)", kind: "event" }];
    expect(latestCommentBy(review, "client", true)).toBe("Amanda approved the image (version 2)");
    expect(latestCommentBy(comments.slice(0, 3), "u_justin", true)).toBe("status changed");
  });
  it("returns null without an author or comments", () => {
    expect(latestCommentBy(comments, null)).toBeNull();
    expect(latestCommentBy(undefined, "u_justin")).toBeNull();
  });
});
