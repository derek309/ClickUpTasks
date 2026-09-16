import { describe, it, expect } from "vitest";
import { buildOpenReviews, openReviewCount, reviewName, type OpenReviewDoc, type ReviewVersionRow } from "./openReviews";
import { daysSince, waitedFor } from "./elapsed";

// The board answers one question: what is out with a client, and whose move is
// it. Getting the order wrong is the whole failure it exists to prevent — the
// review nobody has touched in nine days has to be the one you see first.

const NOW = Date.parse("2026-09-15T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const doc = (over: Partial<OpenReviewDoc> & { id: string }): OpenReviewDoc => ({
  taskId: `t_${over.id}`, kind: "doc", title: "A document", status: "with_client",
  version: 1, clientViewedAt: null, ...over,
});
const sent = (documentId: string, days: number): ReviewVersionRow => ({ documentId, kind: "sent", createdAt: ago(days) });
const replied = (documentId: string, days: number): ReviewVersionRow => ({ documentId, kind: "client_submitted", createdAt: ago(days) });

describe("what is out with a client", () => {
  it("puts what they sent back above what we are waiting on", () => {
    const g = buildOpenReviews(
      [doc({ id: "a" }), doc({ id: "b", status: "client_submitted" })],
      [sent("a", 2), sent("b", 5), replied("b", 1)],
      NOW,
    );
    expect(g.yourMove.map((r) => r.id)).toEqual(["b"]);
    expect(g.withClient.map((r) => r.id)).toEqual(["a"]);
    expect(openReviewCount(g)).toBe(2);
  });

  it("reads the longest wait first, so the forgotten one is at the top", () => {
    const g = buildOpenReviews(
      [doc({ id: "today" }), doc({ id: "old" }), doc({ id: "middle" })],
      [sent("today", 0), sent("old", 9), sent("middle", 3)],
      NOW,
    );
    expect(g.withClient.map((r) => r.id)).toEqual(["old", "middle", "today"]);
    expect(g.withClient.map((r) => r.days)).toEqual([9, 3, 0]);
  });

  it("reads our own queue newest first, since that is who is waiting on us", () => {
    const g = buildOpenReviews(
      [doc({ id: "x", status: "client_submitted" }), doc({ id: "y", status: "client_submitted" })],
      [replied("x", 6), replied("y", 1)],
      NOW,
    );
    expect(g.yourMove.map((r) => r.id)).toEqual(["y", "x"]);
  });

  it("times a reply from the reply, not from the send", () => {
    const g = buildOpenReviews([doc({ id: "a", status: "client_submitted" })], [sent("a", 10), replied("a", 2)], NOW);
    expect(g.yourMove[0].days).toBe(2);
  });

  it("uses the latest send when a review has been sent more than once", () => {
    const g = buildOpenReviews([doc({ id: "a" })], [sent("a", 12), sent("a", 3)], NOW);
    expect(g.withClient[0].days).toBe(3);
  });

  it("never mixes one review's versions into another's", () => {
    const g = buildOpenReviews([doc({ id: "a" }), doc({ id: "b" })], [sent("a", 1), sent("b", 8)], NOW);
    expect(g.withClient.map((r) => [r.id, r.days])).toEqual([["b", 8], ["a", 1]]);
  });

  it("says whether the client ever opened it", () => {
    const g = buildOpenReviews(
      [doc({ id: "seen", clientViewedAt: ago(1) }), doc({ id: "unseen" })],
      [sent("seen", 2), sent("unseen", 2)],
      NOW,
    );
    expect(g.withClient.find((r) => r.id === "seen")!.opened).toBe(true);
    expect(g.withClient.find((r) => r.id === "unseen")!.opened).toBe(false);
  });

  it("keeps a review with no send on record, at the bottom rather than the top", () => {
    const g = buildOpenReviews([doc({ id: "nodate" }), doc({ id: "old" })], [sent("old", 4)], NOW);
    expect(g.withClient.map((r) => r.id)).toEqual(["old", "nodate"]);
    expect(g.withClient[1].days).toBe(null);
  });

  it("is empty when nothing is out", () => {
    const g = buildOpenReviews([], [], NOW);
    expect(openReviewCount(g)).toBe(0);
  });
});

describe("how a review reads", () => {
  it("falls back to the kind's own name when nobody named it", () => {
    expect(reviewName({ title: "Fall postcard", kind: "image" })).toBe("Fall postcard");
    expect(reviewName({ title: "   ", kind: "image" })).toBe("Image review");
    expect(reviewName({ title: null, kind: "page" })).toBe("HTML review");
    expect(reviewName({ title: null, kind: "doc" })).toBe("Client document");
  });

  it("counts whole days, and never a negative one", () => {
    expect(daysSince(ago(3), NOW)).toBe(3);
    expect(daysSince(ago(0), NOW)).toBe(0);
    expect(daysSince(new Date(NOW + 86_400_000).toISOString(), NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBe(null);
    expect(daysSince("not a date", NOW)).toBe(null);
  });

  it("says the wait in words", () => {
    expect(waitedFor(0)).toBe("today");
    expect(waitedFor(1)).toBe("1 day");
    expect(waitedFor(9)).toBe("9 days");
    expect(waitedFor(null)).toBe("not sent yet");
  });
});
