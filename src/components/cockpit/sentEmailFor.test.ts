// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sentEmailFor } from "./EmailWindow";
import type { EmailDraft, Message } from "@/lib/data";

// Matching a draft to the email it became. The rule that matters is the time
// one: a review's standard email is built word for word the same every time, so
// "same words" alone cannot mean "this draft was sent".

const SUBJECT = "Your review is ready";
const BODY = "<p>\"Spring Flyer\" is ready for your review.</p>";

const draft = (createdAt: string): EmailDraft => ({ subject: SUBJECT, body: BODY, createdAt, updatedAt: createdAt });

const sent = (at: string): Message => ({
  id: "m_1", contactId: "c_1", clientId: "cl_1", channel: "email", direction: "outbound",
  subject: SUBJECT, body: BODY, ghlMessageId: null, createdBy: "u_derek", at,
  read: true, attachments: [], cc: [], bcc: [],
} as Message);

describe("sentEmailFor", () => {
  it("finds the email a draft became when it went out after the draft was written", () => {
    expect(sentEmailFor(draft("2026-09-18T10:00:00Z"), [sent("2026-09-18T10:05:00Z")])?.id).toBe("m_1");
  });

  it("ignores an identical email sent BEFORE the draft was written", () => {
    // Email client on a review already in Client review builds the same words
    // again. Without this the fresh draft was deleted the instant it appeared.
    expect(sentEmailFor(draft("2026-09-18T11:00:00Z"), [sent("2026-09-18T10:05:00Z")])).toBeNull();
  });

  it("ignores an email whose words do not match", () => {
    expect(sentEmailFor(draft("2026-09-18T10:00:00Z"), [{ ...sent("2026-09-18T10:05:00Z"), body: "<p>Something else</p>" }])).toBeNull();
  });

  it("copes with no messages loaded and with a draft that has no written time", () => {
    expect(sentEmailFor(draft("2026-09-18T10:00:00Z"), null)).toBeNull();
    const undated = { ...draft(""), createdAt: "" } as EmailDraft;
    expect(sentEmailFor(undated, [sent("2026-09-18T10:05:00Z")])?.id).toBe("m_1");
  });
});
