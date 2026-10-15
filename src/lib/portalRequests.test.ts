import { describe, expect, it } from "vitest";
import {
  doneWord, expectedLine, portalEmail, firstAskedLine, groupedQueue, nextRequest, portalQueue, portalRequestFromTask, queuePosition, requestKind, rowDate, stateWord, thanksLine,
  type PortalRequest,
} from "./portalRequests";
import { orderRequests, type ClientRequest } from "./clientRequests";
import type { Subtask } from "./data";

// Thu Oct 15 2026. Fri 16, Mon 19, Tue 20, Wed 21, Thu 22.
const THU = "2026-10-15";

const r = (key: string, needBy: string | null, more: Partial<PortalRequest> = {}): PortalRequest => ({
  key, taskId: `t_${key}`, stepId: key, ask: `Ask ${key}`, listId: null, needBy, startedAt: "2026-10-15T15:00:00.000Z", clientOrder: null,
  taskTitle: `Task ${key}`, taskDue: null, kind: "question", ...more,
});

describe("the portal's queue", () => {
  const list = [r("undated", null), r("later", "2026-11-03"), r("week", "2026-10-21"), r("today", THU), r("late2", "2026-10-13"), r("late1", "2026-10-09")];

  it("is in the same order as our side (clientRequests.orderRequests)", () => {
    const ours = orderRequests(list.map((x) => ({ ...x, stepId: x.key }) as unknown as ClientRequest), THU).map((x) => x.stepId);
    expect(portalQueue(list, THU).map((x) => x.key)).toEqual(ours);
    expect(ours).toEqual(["late1", "late2", "today", "week", "later", "undated"]);
  });
  it("keeps our dragged order inside a group", () => {
    const dragged = list.map((x) => (x.key === "late2" ? { ...x, clientOrder: 1 } : x.key === "late1" ? { ...x, clientOrder: 2 } : x));
    expect(portalQueue(dragged, THU).map((x) => x.key).slice(0, 2)).toEqual(["late2", "late1"]);
  });
  it("groups Overdue, Today, This week, Later, leaving empty groups out", () => {
    const g = groupedQueue(portalQueue(list, THU), THU);
    expect(g.map((x) => [x.label, x.items.map((i) => i.key)])).toEqual([
      ["Overdue", ["late1", "late2"]], ["Today", ["today"]], ["This week", ["week"]], ["Later", ["later", "undated"]],
    ]);
    expect(groupedQueue([r("a", "2026-10-21")], THU).map((x) => x.group)).toEqual(["week"]);
    expect(groupedQueue([], THU)).toEqual([]);
  });
  it("says where one is: 1 of 6, and 2 of 6 once one is answered on this visit", () => {
    const q = portalQueue(list, THU);
    expect(queuePosition(q, "late1")).toEqual({ n: 1, of: 6 });
    expect(queuePosition(q, "undated")).toEqual({ n: 6, of: 6 });
    // late1 answered: the queue is 5 long, the next reads 2 of 6.
    expect(queuePosition(q.filter((x) => x.key !== "late1"), "late2", 1)).toEqual({ n: 2, of: 6 });
    expect(queuePosition(q, "gone")).toBeNull();
  });
  it("the next one is the first that is not this one nor one answered", () => {
    const q = portalQueue(list, THU);
    expect(nextRequest(q, "late1")?.key).toBe("late2");
    expect(nextRequest(q, "today")?.key).toBe("late1");
    expect(nextRequest(q, null, ["late1", "late2"])?.key).toBe("today");
    expect(nextRequest([r("a", null)], "a")).toBeNull();
  });
});

describe("the words", () => {
  it("late in business days, due today, else the need by date", () => {
    expect(stateWord("2026-10-14", THU)).toEqual({ text: "1 day late", tone: "late" });
    expect(stateWord("2026-10-09", THU)).toEqual({ text: "4 days late", tone: "late" });
    // Due Friday, read on Saturday: no business day has passed, still late.
    expect(stateWord("2026-10-16", "2026-10-17")).toEqual({ text: "1 day late", tone: "late" });
    expect(stateWord(THU, THU)).toEqual({ text: "Due today", tone: "today" });
    expect(stateWord("2026-10-16", THU)).toEqual({ text: "Need by Fri, Oct 16", tone: "plain" });
    expect(stateWord(null, THU)).toBeNull();
  });
  it("a row's date", () => {
    expect(rowDate("2026-10-14", THU)?.text).toBe("1 day late");
    expect(rowDate(THU, THU)).toEqual({ text: "Today", tone: "today" });
    expect(rowDate("2026-10-16", THU)).toEqual({ text: "Fri, Oct 16", tone: "plain" });
    expect(rowDate(null, THU)).toBeNull();
  });
  it("first asked, the thanks, and the expected line", () => {
    expect(firstAskedLine("2026-10-15T15:00:00.000Z")).toBe("First asked Oct 15");
    // 11 PM in California on the 14th is the 15th in UTC.
    expect(firstAskedLine("2026-10-15T06:00:00.000Z")).toBe("First asked Oct 14");
    expect(firstAskedLine(null)).toBeNull();
    expect(thanksLine(doneWord("review"), "Brian")).toBe("✓ Approved. Thanks, Brian.");
    expect(thanksLine(doneWord("upload"), null)).toBe("✓ Sent. Thanks.");
    expect(doneWord("question")).toBe("Answered");
    expect(expectedLine("Newsletter", "2026-10-27")).toBe("Your newsletter is expected Oct 27.");
    expect(expectedLine("PPAI flyer", "2026-10-27")).toBe("PPAI flyer is expected Oct 27.");
    expect(expectedLine("November classes", "2026-10-30")).toBe('We expect to finish "November classes" by Oct 30.');
    expect(expectedLine("your website", "2026-10-30")).toBe("Your website is expected Oct 30.");
    expect(expectedLine("The Fall Sale page", "2026-10-27")).toBe("The Fall Sale page is expected Oct 27.");
    expect(expectedLine("Newsletter", null)).toBeNull();
  });
  it("no dashes in what the client reads", () => {
    const words = [stateWord("2026-10-14", THU)!.text, stateWord("2026-10-16", THU)!.text, thanksLine("Approved", "Brian"), expectedLine("Newsletter", "2026-10-27")!, firstAskedLine("2026-10-15T15:00:00.000Z")!];
    for (const w of words) expect(w).not.toMatch(/[-–—]/);
  });
});

describe("a task's request", () => {
  const step = (s: Partial<Subtask>): Subtask => ({ id: "s1", title: "Step", done: false, ...s }) as Subtask;
  const task = (subtasks: Subtask[], more: Partial<Parameters<typeof portalRequestFromTask>[0]> = {}) => ({
    id: "t1", title: "Newsletter", clientId: "cl_brian", projectId: "p1", due: "2026-10-27", status: "waiting", waitingOnClient: false, subtasks, ...more,
  });

  it("is the current client step, worded as the email words it", () => {
    const t = task([step({ id: "s0", title: "Write it", done: true }), step({ id: "s1", title: "Brian: approve the PPAI flyer", finishWhen: "reply", stage: "waiting", due: "2026-10-16", startedAt: "2026-10-15T15:00:00.000Z", clientOrder: 2 })]);
    expect(portalRequestFromTask(t, { firstName: "Brian", reviewOpen: true })).toEqual({
      key: "s1", taskId: "t1", stepId: "s1", ask: "Approve the PPAI flyer", listId: "p1", needBy: "2026-10-16", startedAt: "2026-10-15T15:00:00.000Z",
      clientOrder: 2, taskTitle: "Newsletter", taskDue: "2026-10-27", kind: "review", replyTo: null,
    });
  });
  it("is an upload when it asks for files, a question otherwise", () => {
    const up = portalRequestFromTask(task([step({ title: "Send us your logo", finishWhen: "reply" })]), { firstName: "Brian", reviewOpen: false });
    expect(up?.kind).toBe("upload");
    const q = portalRequestFromTask(task([step({ title: "Pick the class times", finishWhen: "reply" })]), { firstName: "Brian", reviewOpen: false });
    expect(q?.kind).toBe("question");
    expect(requestKind({ reviewOpen: false, ask: "Upload the photos" })).toBe("upload");
    expect(requestKind({ reviewOpen: true, ask: "Upload the photos" })).toBe("review");
  });
  it("is the task itself when it waits on them with no client step, and nothing when it doesn't", () => {
    const legacy = portalRequestFromTask(task([step({ title: "Our step" })], { waitingOnClient: true }), { firstName: "Brian", reviewOpen: false });
    expect(legacy).toMatchObject({ key: "t1", stepId: null, ask: "Your answer on Newsletter", needBy: "2026-10-27", taskDue: null });
    expect(portalRequestFromTask(task([step({ title: "Our step" })]), { firstName: "Brian", reviewOpen: false })).toBeNull();
    expect(portalRequestFromTask(task([step({ finishWhen: "reply" })], { status: "done" }), { firstName: "Brian", reviewOpen: false })).toBeNull();
    expect(portalRequestFromTask(task([step({ finishWhen: "reply" })], { status: "on_hold" }), { firstName: "Brian", reviewOpen: false })).toBeNull();
  });
});

describe("what the portal asks: the step, never the task's name", () => {
  // Carol's task as it stood on 2026-10-15: our email went, and the check in waits on her reply.
  const carol = (more: Partial<Subtask> = {}): Subtask[] => [
    { id: "s_tell", title: "Let Carol know the changes are done", done: true, holds: ["mail:msg_tell"], addedFor: "tell:s_x" } as Subtask,
    { id: "s_check", title: "Check in if Carol Lindenmuth hasn't replied", done: false, stage: "waiting", addedFor: "checkin:s_tell", due: "2026-10-16", finishWhen: "reply", startedAt: "2026-10-15T13:50:29.310Z", ...more } as Subtask,
    { id: "s_live", title: "Go live", done: false } as Subtask,
  ];
  const task = (subtasks: Subtask[]) => ({ id: "t_carol", title: "Website Upgrade 2026", clientId: "cl_carol", projectId: "p_web", due: null, status: "waiting", waitingOnClient: false, subtasks });
  const email = { subject: "Your site changes are done", preview: "Done, as you asked: the town list is gone from the search box." };

  it("a reply wait is a reply to our email, with the email under it", () => {
    const r = portalRequestFromTask(task(carol()), { firstName: "Carol", reviewOpen: false, emails: { msg_tell: email } })!;
    expect(r.ask).toBe("Reply to: Your site changes are done");
    expect(r.replyTo).toEqual(email);
    expect(r.kind).toBe("question");
    expect(r.taskTitle).toBe("Website Upgrade 2026");
  });
  it("without the email, the step that sent it names it", () => {
    const r = portalRequestFromTask(task(carol()), { firstName: "Carol", reviewOpen: false })!;
    expect(r.ask).toBe("Reply to: Let Carol know the changes are done");
    expect(r.replyTo).toBeNull();
  });
  it("a step written about them asks them", () => {
    const steps = [{ id: "s1", title: "Carol signs off on the site and sends her pet care details", done: false, finishWhen: "reply", due: "2026-10-16" } as Subtask];
    expect(portalRequestFromTask(task(steps), { firstName: "Carol", reviewOpen: false })!.ask).toBe("Sign off on the site and send your pet care details");
  });
  it("never the bare task name", () => {
    const steps = [{ id: "s1", title: "Wait for Carol's reply", done: false, onClient: true, due: "2026-10-16" } as Subtask];
    expect(portalRequestFromTask(task(steps), { firstName: "Carol", reviewOpen: false })!.ask).toBe("Your answer on Website Upgrade 2026");
  });
  it("our email reads past the greeting, short", () => {
    expect(portalEmail("Re: Your site changes are done", "Hi Carol,\nDone, as you asked:\nThe town list is gone.")).toEqual({ subject: "Your site changes are done", preview: "Done, as you asked: The town list is gone." });
    expect(portalEmail("", "Hi")).toBeNull();
    expect(portalEmail("S", "x ".repeat(200))!.preview.length).toBeLessThanOrEqual(220);
  });
});
