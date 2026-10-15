import { describe, it, expect } from "vitest";
import {
  addedPhrases, cleanReviewMeta, clientTurnSentence, htmlReviewTurn, pageKindFromName, pageKindOf, pageKindOfAction,
  readReviewMeta, withPick, withReviewMeta, type TurnInput,
} from "./htmlReview";

describe("the kind of an HTML review", () => {
  it("comes from the name when none is stored", () => {
    expect(pageKindFromName("October Real Estate Newsletter")).toBe("email");
    expect(pageKindFromName("Welcome email for new buyers")).toBe("email");
    expect(pageKindFromName("Holiday E-mails")).toBe("email");
    expect(pageKindFromName("Landing page for the open house")).toBe("page");
    expect(pageKindFromName("")).toBe("page");
    expect(pageKindFromName(null)).toBe("page");
    // A word that only contains "email" is not one.
    expect(pageKindFromName("Remailing list cleanup")).toBe("page");
  });
  it("is the stored one when there is one", () => {
    expect(pageKindOf({ pageKind: "page" }, "October Newsletter")).toBe("page");
    expect(pageKindOf({ pageKind: "email" }, "Home page")).toBe("email");
    expect(pageKindOf({}, "October Newsletter")).toBe("email");
  });
  it("is read from the two step actions", () => {
    expect(pageKindOfAction("page:email")).toBe("email");
    expect(pageKindOfAction("page:page")).toBe("page");
    expect(pageKindOfAction("page")).toBeNull();
    expect(pageKindOfAction("email")).toBeNull();
  });
});

describe("the review's meta in picks", () => {
  it("keeps only known fields, trimmed, and cleans the address", () => {
    expect(cleanReviewMeta({ pageKind: "email", subject: "  Hello\nthere ", junk: 1, slug: "https://x.com/Open House 2026!" }))
      .toEqual({ pageKind: "email", subject: "Hello there", slug: "open-house-2026" });
    expect(cleanReviewMeta({ pageKind: "video" })).toEqual({});
    expect(cleanReviewMeta(null)).toEqual({});
  });
  it("merges into picks without touching the option chosen", () => {
    const picks = { fileId: "f1", by: "client", at: "x", meta: { subject: "Old", pageKind: "email" } };
    const next = withReviewMeta(picks, { subject: "New" });
    expect(next).toEqual({ fileId: "f1", by: "client", at: "x", meta: { subject: "New", pageKind: "email" } });
    expect(readReviewMeta(next)).toEqual({ subject: "New", pageKind: "email" });
    expect(readReviewMeta(null)).toEqual({});
  });
  it("keeps the meta when the option chosen changes", () => {
    const picks = { fileId: "f1", meta: { pageKind: "email" } };
    expect(withPick(picks, null)).toEqual({ meta: { pageKind: "email" } });
    expect(withPick(picks, { fileId: "f2", by: "team", at: "t" })).toEqual({ fileId: "f2", by: "team", at: "t", meta: { pageKind: "email" } });
    expect(withPick({}, null)).toEqual({});
  });
});

const base: TurnInput = { status: "draft", sent: 0, needsSend: true, first: "Brandon", changes: 0, kind: "email" };
const say = (t: TurnInput) => { const r = htmlReviewTurn(t); return `${r.who}${r.rest}`; };

describe("the status sentence and the one button", () => {
  it("a draft is your turn, with Send to the client for review", () => {
    expect(say(base)).toBe("Your turn, version 1, not sent yet");
    expect(htmlReviewTurn(base).button).toEqual({ label: "Send to Brandon for review", action: "send" });
    expect(htmlReviewTurn(base).dot).toBe("ours");
  });
  it("with the client: their turn, the need by date, no button", () => {
    const t = { ...base, status: "with_client" as const, sent: 2, needsSend: false, needBy: "2026-10-16" };
    expect(say(t)).toBe("Brandon's turn, version 2, need by Fri, Oct 16");
    expect(htmlReviewTurn(t).button).toBeNull();
    expect(htmlReviewTurn(t).dot).toBe("theirs");
    expect(say({ ...t, needBy: null })).toBe("Brandon's turn, version 2");
  });
  it("changes back: your turn, how many, and Send version 2", () => {
    const t = { ...base, status: "client_submitted" as const, sent: 1, needsSend: false, changes: 3 };
    expect(say(t)).toBe("Your turn: Brandon sent 3 changes on version 1");
    expect(htmlReviewTurn(t).button).toEqual({ label: "Send version 2 to Brandon", action: "send" });
    expect(say({ ...t, changes: 1 })).toBe("Your turn: Brandon sent 1 change on version 1");
    expect(say({ ...t, changes: 0 })).toBe("Your turn: Brandon sent changes on version 1");
  });
  it("a new version made while it waits on the client is yours to send", () => {
    const t = { ...base, status: "with_client" as const, sent: 1, needsSend: true };
    expect(say(t)).toBe("Your turn, version 2, not sent yet");
    expect(htmlReviewTurn(t).button?.label).toBe("Send version 2 to Brandon");
  });
  it("approved: Schedule it for an email, Done for a page", () => {
    const t = { ...base, status: "approved" as const, sent: 2, needsSend: false, approvedAt: "2026-10-16T15:00:00Z" };
    expect(say(t)).toBe("Approved by Brandon, Oct 16");
    expect(htmlReviewTurn(t).button).toEqual({ label: "Schedule it", action: "schedule" });
    expect(htmlReviewTurn({ ...t, kind: "page" }).button).toEqual({ label: "Done", action: "done" });
    expect(say({ ...t, approvedByTeam: true })).toBe("Approved for Brandon, Oct 16");
    expect(htmlReviewTurn(t).dot).toBe("approved");
  });
  it("completed has no button", () => {
    expect(htmlReviewTurn({ ...base, status: "completed", sent: 2 }).button).toBeNull();
  });
  it("says the client when there is no first name", () => {
    expect(htmlReviewTurn({ ...base, first: "" }).button?.label).toBe("Send to the client for review");
  });
  it("reads from the client's side on their page", () => {
    const c = (t: Parameters<typeof clientTurnSentence>[0]) => { const r = clientTurnSentence(t); return `${r.who}${r.rest}`; };
    expect(c({ status: "with_client", version: 2, changes: 0, needBy: "2026-10-16" })).toBe("Your turn, version 2, need by Fri, Oct 16");
    expect(c({ status: "client_submitted", version: 1, changes: 3 })).toBe("Our turn: you sent 3 changes on version 1");
    expect(c({ status: "approved", version: 2, changes: 0, approvedAt: "2026-10-16T15:00:00Z" })).toBe("Approved by you, Oct 16");
  });
});

describe("the new words on a version", () => {
  it("are the phrases added, line by line", () => {
    const before = "October might be our favorite month.\nThe market in September, the overview";
    const after = "The Bayside Fall Festival is this Saturday, and October might be our favorite month.\nThe September market";
    const phrases = addedPhrases(before, after);
    expect(phrases.some((p) => p.includes("Bayside Fall Festival"))).toBe(true);
    expect(phrases.some((p) => p.includes("September market") || p.includes("market"))).toBe(true);
    expect(phrases.every((p) => !p.includes("\n"))).toBe(true);
  });
  it("are none when nothing changed, or only punctuation was added", () => {
    expect(addedPhrases("Same words here", "Same words here")).toEqual([]);
    expect(addedPhrases("Hello there", "Hello there!")).toEqual([]);
    expect(addedPhrases("anything", "")).toEqual([]);
  });
  it("never repeat and stay a sensible size", () => {
    const after = Array.from({ length: 100 }, (_, i) => `New line number ${i}`).join("\n");
    const phrases = addedPhrases("", after);
    expect(phrases.length).toBeLessThanOrEqual(60);
    expect(new Set(phrases).size).toBe(phrases.length);
  });
});
