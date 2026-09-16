import { describe, it, expect } from "vitest";
import { NO_SUBJECT, bodyPreview, buildPendingSends, pendingSendCount, type ClientDraftInput, type ScheduledInput, type TaskDraftInput } from "./pendingSends";
import type { EmailDraft } from "./data";

// Three places an unsent email can hide, one list. The ordering is the point:
// what goes out by itself is kept apart from what needs a person, and the draft
// written nine days ago and forgotten has to be the one you see first.

const NOW = Date.parse("2026-09-15T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

const draft = (over: Partial<EmailDraft> = {}): EmailDraft => ({
  subject: "Following up", body: "<p>Hi there</p>", createdAt: ago(1), updatedAt: ago(1), ...over,
});
const onTask = (taskId: string, d: Partial<EmailDraft> = {}): TaskDraftInput => ({ taskId, clientId: "c_1", draft: draft(d) });
const onClient = (clientId: string, d: Partial<EmailDraft> = {}): ClientDraftInput => ({ clientId, draft: draft(d), updatedAt: ago(1) });
const queued = (id: string, at: string, over: Partial<ScheduledInput> = {}): ScheduledInput => ({
  id, clientId: "c_1", taskId: null, channel: "email", subject: "Later", body: "<p>Soon</p>", scheduledAt: at, ...over,
});

describe("everything written but not sent", () => {
  it("keeps what sends itself apart from what needs a person", () => {
    const g = buildPendingSends([onTask("t_1")], [onClient("c_2")], [queued("s_1", inDays(1))], NOW);
    expect(g.scheduled.map((p) => p.kind)).toEqual(["scheduled"]);
    expect(g.drafts.map((p) => p.kind)).toEqual(["task_draft", "client_draft"]);
    expect(pendingSendCount(g)).toBe(3);
  });

  it("reads drafts oldest first, so the forgotten one is at the top", () => {
    const g = buildPendingSends(
      [onTask("fresh", { updatedAt: ago(0) }), onTask("old", { updatedAt: ago(9) }), onTask("middle", { updatedAt: ago(3) })],
      [], [], NOW,
    );
    expect(g.drafts.map((p) => p.taskId)).toEqual(["old", "middle", "fresh"]);
  });

  it("puts a task draft and a client draft in one list, ordered together by age", () => {
    const g = buildPendingSends([onTask("t_new", { updatedAt: ago(1) })], [onClient("c_old", { updatedAt: ago(5) })], [], NOW);
    expect(g.drafts.map((p) => p.kind)).toEqual(["client_draft", "task_draft"]);
  });

  it("reads scheduled soonest first, and says which are already overdue", () => {
    const g = buildPendingSends([], [], [queued("later", inDays(2)), queued("due", ago(1)), queued("soon", inDays(1))], NOW);
    expect(g.scheduled.map((p) => p.id)).toEqual(["scheduled:due", "scheduled:soon", "scheduled:later"]);
    expect(g.scheduled.map((p) => p.overdue)).toEqual([true, false, false]);
  });

  it("dates a draft by when it was last touched, not when it was started", () => {
    const g = buildPendingSends([onTask("t_1", { createdAt: ago(9), updatedAt: ago(1) })], [], [], NOW);
    expect(g.drafts[0].at).toBe(ago(1));
  });

  it("falls back to the day it was started when a draft has never been edited", () => {
    const g = buildPendingSends([onTask("t_1", { createdAt: ago(4), updatedAt: undefined })], [], [], NOW);
    expect(g.drafts[0].at).toBe(ago(4));
  });

  it("gives an email with no subject line something to be called", () => {
    const g = buildPendingSends([onTask("t_1", { subject: "   " })], [], [], NOW);
    expect(g.drafts[0].subject).toBe(NO_SUBJECT);
  });

  it("heads a text message with its own body, and does not print it twice", () => {
    const g = buildPendingSends([], [], [queued("s_1", inDays(1), { channel: "sms", subject: null, body: "Running ten minutes late" })], NOW);
    expect(g.scheduled[0].subject).toBe("Running ten minutes late");
    expect(g.scheduled[0].preview).toBe("");
    expect(g.scheduled[0].channel).toBe("sms");
  });

  it("carries the task a row belongs to, and null when it belongs to the client", () => {
    const g = buildPendingSends([onTask("t_9")], [onClient("c_2")], [queued("s_1", inDays(1), { taskId: "t_5" })], NOW);
    expect(g.drafts.find((p) => p.kind === "task_draft")!.taskId).toBe("t_9");
    expect(g.drafts.find((p) => p.kind === "client_draft")!.taskId).toBe(null);
    expect(g.scheduled[0].taskId).toBe("t_5");
  });

  it("gives every row an id of its own, so two drafts never share one", () => {
    const g = buildPendingSends([onTask("t_1"), onTask("t_2")], [onClient("t_1")], [queued("t_1", inDays(1))], NOW);
    const ids = [...g.drafts, ...g.scheduled].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is empty when nothing is waiting", () => {
    expect(pendingSendCount(buildPendingSends([], [], [], NOW))).toBe(0);
  });
});

describe("the preview under a row", () => {
  it("turns the body into one line of plain text", () => {
    expect(bodyPreview("<p>Hi Sam,</p><p>Here is the <strong>draft</strong>.</p>")).toBe("Hi Sam, Here is the draft.");
  });

  it("cuts a long body rather than pushing the row onto a second line", () => {
    const long = `<p>${"word ".repeat(80)}</p>`;
    const out = bodyPreview(long);
    expect(out.length).toBeLessThanOrEqual(141);
    expect(out.endsWith("…")).toBe(true);
  });

  it("survives an empty body", () => {
    expect(bodyPreview("")).toBe("");
  });
});
