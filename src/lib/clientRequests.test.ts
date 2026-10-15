import { describe, expect, it } from "vitest";
import {
  agoWords, businessDaysBetween, chasedRequest, comingUpForClient, daysLate, expectedMove, expectedMoveComment, finishRequestStep, lastAnswerAt, openCheckIt,
  orderRequests, parseReminderId, planForClient, remindersOn, reorderedClientOrder, requestEmail, requestFromTask, requestGroup, requestRowId, requestStageToday,
  requestStepForThread, requestSubject, type ClientRequest, type StepHistory,
} from "./clientRequests";
import type { Subtask } from "./data";

// Wed Oct 15 2026 is a Thursday. Fri 16, Sat 17, Sun 18, Mon 19, Tue 20, Wed 21, Thu 22, Fri 23.
const THU = "2026-10-15", FRI = "2026-10-16", SAT = "2026-10-17", MON = "2026-10-19", TUE = "2026-10-20", WED = "2026-10-21", THU2 = "2026-10-22";

const req = (stepId: string, needBy: string | null, more: Partial<ClientRequest> = {}): ClientRequest => ({
  clientId: "cl_brian", taskId: `t_${stepId}`, taskTitle: `Task ${stepId}`, taskDue: null, listId: null, stepId, title: `Step ${stepId}`,
  needBy, startedAt: "2026-10-15T15:00:00.000Z", clientOrder: null, ...more,
});
const h = (first: string, last: string, sent = 1): StepHistory => ({ first, last, sent });

describe("the queue", () => {
  it("is overdue first, then today, this week, later, undated last; dragged order inside a group", () => {
    const list = [req("undated", null), req("later", "2026-11-03"), req("week", WED), req("today", THU), req("late2", "2026-10-13"), req("late1", "2026-10-09")];
    expect(orderRequests(list, THU).map((r) => r.stepId)).toEqual(["late1", "late2", "today", "week", "later", "undated"]);
    expect(requestGroup(null, THU)).toBe("later");
    expect(requestGroup("2026-10-22", THU)).toBe("week");
    expect(requestGroup("2026-10-23", THU)).toBe("later");
    // Dragged: late2 above late1, inside Overdue only.
    const dragged = list.map((r) => (r.stepId === "late2" ? { ...r, clientOrder: 1 } : r.stepId === "late1" ? { ...r, clientOrder: 2 } : r));
    expect(orderRequests(dragged, THU).map((r) => r.stepId).slice(0, 2)).toEqual(["late2", "late1"]);
    // An undated one dragged first stays in Later.
    const undatedFirst = list.map((r) => (r.stepId === "undated" ? { ...r, clientOrder: 1 } : r));
    expect(orderRequests(undatedFirst, THU).map((r) => r.stepId).slice(-2)).toEqual(["undated", "later"]);
  });
  it("chases the top one with reminders on: on by default with a need by date, off when turned off", () => {
    expect(remindersOn(req("a", WED))).toBe(true);
    expect(remindersOn(req("a", null))).toBe(false);
    expect(remindersOn(req("a", WED, { remind: { off: true } }))).toBe(false);
    expect(remindersOn(req("a", null, { remind: { every: 2 } }))).toBe(true);
    const ordered = orderRequests([req("a", "2026-10-13", { remind: { off: true } }), req("b", WED)], THU);
    expect(chasedRequest(ordered)?.stepId).toBe("b");
  });
  it("a drag numbers the group in its new order", () => {
    const group = [{ stepId: "a", clientOrder: null }, { stepId: "b", clientOrder: null }, { stepId: "c", clientOrder: null }];
    expect(reorderedClientOrder(group, "c", "a")).toEqual([{ stepId: "c", clientOrder: 1 }, { stepId: "a", clientOrder: 2 }, { stepId: "b", clientOrder: 3 }]);
    expect(reorderedClientOrder(group, "a", "a")).toEqual([]);
  });
  it("reads a task's current client step as a request", () => {
    const subtasks: Subtask[] = [{ id: "s1", title: "Build it", done: true }, { id: "s2", title: "Wait for Brian's approval", done: false, finishWhen: "reply", stage: "waiting", due: WED, clientOrder: 4 }];
    expect(requestFromTask({ id: "t1", title: "Flyer", clientId: "cl_b", projectId: "p1", due: "2026-10-24", subtasks })).toMatchObject({ stepId: "s2", needBy: WED, clientOrder: 4, taskDue: "2026-10-24", listId: "p1" });
    expect(requestFromTask({ id: "t1", title: "Flyer", clientId: "cl_b", subtasks: [{ id: "s1", title: "Build it", done: false }] })).toBeNull();
  });
});

describe("when each email goes", () => {
  it("asks first, then every 3 business days across weekends, the due day, then every business day late", () => {
    // Asked Thursday, need by next Thursday.
    expect(requestStageToday({ today: THU, needBy: THU2, history: null })).toBe("asked");
    expect(requestStageToday({ today: THU, needBy: THU2, history: h(THU, THU) })).toBeNull();
    expect(requestStageToday({ today: MON, needBy: THU2, history: h(THU, THU) })).toBeNull();
    // Three business days after Thursday is Tuesday, not Sunday.
    expect(requestStageToday({ today: TUE, needBy: THU2, history: h(THU, THU) })).toBe("reminder");
    expect(requestStageToday({ today: THU2, needBy: THU2, history: h(THU, TUE) })).toBe("due");
    expect(requestStageToday({ today: "2026-10-23", needBy: THU2, history: h(THU, THU2) })).toBe("late");
    expect(requestStageToday({ today: "2026-10-26", needBy: THU2, history: h(THU, "2026-10-23") })).toBe("late");
    // Never on a weekend, never twice a day.
    expect(requestStageToday({ today: SAT, needBy: THU2, history: null })).toBeNull();
    expect(requestStageToday({ today: "2026-10-23", needBy: THU2, history: h(THU, "2026-10-23") })).toBeNull();
  });
  it("the first email for a step whose date has come is due or late", () => {
    expect(requestStageToday({ today: THU, needBy: THU, history: null })).toBe("due");
    expect(requestStageToday({ today: THU, needBy: "2026-10-13", history: null })).toBe("late");
  });
  it("keeps the older choices: every 2, and once (asked and the due day only)", () => {
    expect(requestStageToday({ today: MON, needBy: "2026-10-30", remind: { every: 2 }, history: h(THU, THU) })).toBe("reminder");
    expect(requestStageToday({ today: TUE, needBy: "2026-10-30", remind: { every: "once" }, history: h(THU, THU) })).toBeNull();
    expect(requestStageToday({ today: THU2, needBy: THU2, remind: { every: "once" }, history: h(THU, THU) })).toBe("due");
    expect(requestStageToday({ today: "2026-10-23", needBy: THU2, remind: { every: "once" }, history: h(THU, THU2) })).toBeNull();
  });
  it("counts days late in business days", () => {
    expect(businessDaysBetween(FRI, MON)).toBe(1);
    expect(daysLate(FRI, TUE)).toBe(2);
    expect(daysLate(TUE, TUE)).toBe(0);
    expect(daysLate(null, TUE)).toBe(0);
  });
});

describe("one email a client a day", () => {
  const base = { today: TUE, nowIso: "2026-10-20T15:00:00.000Z", mode: "morning" as const, history: new Map<string, StepHistory>(), lastSentAt: null, lastSentDay: null, answeredAt: null, checkItOpen: false, reviewWaiting: false };
  it("chases only the top request", () => {
    const p = planForClient({ ...base, requests: [req("b", "2026-10-30"), req("a", WED)] });
    expect(p).toMatchObject({ stage: "asked", request: { stepId: "a" } });
  });
  it("sends nothing more once one went today, unless they answered since and this is the next one's first", () => {
    const sent = { lastSentAt: "2026-10-20T15:00:00.000Z", lastSentDay: TUE };
    expect(planForClient({ ...base, ...sent, requests: [req("a", WED)] })).toEqual({ skip: "already_today" });
    const answered = planForClient({ ...base, ...sent, nowIso: "2026-10-20T18:00:00.000Z", mode: "follow-on", answeredAt: "2026-10-20T17:55:00.000Z", requests: [req("a", WED)] });
    // About 10 minutes after their answer.
    expect(answered).toMatchObject({ stage: "asked", request: { stepId: "a" }, notBefore: "2026-10-20T18:05:00.000Z" });
    // A reminder (not a first ask) waits for tomorrow morning even after an answer.
    const hist = new Map([["a", h(THU, THU)]]);
    expect(planForClient({ ...base, ...sent, mode: "follow-on", answeredAt: "2026-10-20T17:55:00.000Z", history: hist, requests: [req("a", WED)] })).toEqual({ skip: "wait_for_morning" });
  });
  it("waits while a check it is open, or one is waiting for review", () => {
    expect(planForClient({ ...base, checkItOpen: true, requests: [req("a", WED)] })).toEqual({ skip: "check_it" });
    expect(planForClient({ ...base, reviewWaiting: true, requests: [req("a", WED)] })).toEqual({ skip: "review_waiting" });
    expect(planForClient({ ...base, today: SAT, requests: [req("a", WED)] })).toEqual({ skip: "weekend" });
  });
  it("five or more late: one summary instead, in the morning only", () => {
    const late = ["a", "b", "c", "d", "e"].map((id) => req(id, "2026-10-14"));
    expect(planForClient({ ...base, requests: late })).toMatchObject({ stage: "summary", request: null, overdue: 5 });
    expect(planForClient({ ...base, mode: "follow-on", requests: late })).toEqual({ skip: "wait_for_morning" });
    expect(planForClient({ ...base, requests: late.slice(0, 4) })).toMatchObject({ stage: "late", request: { stepId: "a" } });
  });
  it("coming up: what each day will bring if nothing is answered", () => {
    const up = comingUpForClient({ from: THU, days: 7, requests: [req("a", THU2)], history: new Map(), lastSentDay: null, checkItOpen: false });
    expect(up.map((x) => `${x.day} ${x.stage}`)).toEqual([`${THU} asked`, `${TUE} reminder`, `${THU2} due`, "2026-10-23 late"]);
    expect(comingUpForClient({ from: THU, days: 3, requests: [req("a", THU2)], history: new Map(), lastSentDay: null, checkItOpen: true })).toEqual([]);
  });
});

describe("the emails", () => {
  it("names the stage in the subject", () => {
    const o = { needBy: "2026-10-17", firstAsked: THU, today: "2026-10-21" };
    expect(requestSubject("asked", { ...o, ask: "Approve the PPAI flyer" })).toBe("We need you to approve the PPAI flyer by Sat, Oct 17");
    expect(requestSubject("asked", { ...o, ask: "your class times" })).toBe("We need your class times by Sat, Oct 17");
    expect(requestSubject("reminder", { ...o, ask: "your class times" })).toBe("Reminder: your class times, first asked Oct 15");
    expect(requestSubject("due", { ...o, ask: "your class times" })).toBe("Your class times is due today");
    expect(requestSubject("late", { ...o, ask: "your PPAI flyer approval" })).toBe("Your PPAI flyer approval is 3 days late");
    expect(requestSubject("late", { ...o, ask: "Approve the flyer" })).toBe("3 days late: approve the flyer");
    expect(requestSubject("summary", { ...o, ask: "", overdue: 6 })).toBe("6 things we need from you are overdue");
  });
  it("asks one thing: when we first asked, what it holds up, one button, reply, the rest muted", () => {
    const e = requestEmail({
      stage: "late", firstName: "Brian", ask: "Approve the PPAI flyer", taskTitle: "Newsletter", needBy: FRI, firstAsked: THU, today: "2026-10-18",
      expected: "2026-10-27", link: { url: "https://x/waiting/tok?task=t1", label: "Open it in your client portal" }, listUrl: "https://x/waiting/tok", more: 5, sender: "Derek",
    });
    expect(e.subject).toBe("1 day late: approve the PPAI flyer");
    expect(e.body).toContain("<p>Hi Brian,</p>");
    expect(e.body).toContain("We still need you to approve the PPAI flyer. It was due Fri, Oct 16.");
    expect(e.body).toContain("We first asked on Oct 15, 3 days ago.");
    expect(e.body).toContain("It's what holds up Newsletter, which is expected Oct 27.");
    expect(e.body).toContain('href="https://x/waiting/tok?task=t1"');
    expect(e.body).toContain("Or reply to this email with your answer.");
    expect(e.body).toContain("5 things more are waiting on you.");
    expect(e.body).toContain("See everything we need");
    expect(e.body).toContain("Thanks!<br>Derek");
    // Never the list, never a dash.
    expect(e.body).not.toMatch(/<li>|—|–/);
    const asked = requestEmail({ stage: "asked", firstName: null, ask: "your logo", taskTitle: "your logo", needBy: null, firstAsked: THU, today: THU, expected: null, link: null, listUrl: null, more: 0, sender: null });
    expect(asked.body).toBe("<p>Hi there,</p><p>We need your logo.</p><p>Or reply to this email with your answer.</p><p>Thanks!</p>");
  });
  it("the summary: how many, and the full list link", () => {
    const e = requestEmail({ stage: "summary", firstName: "Brian", ask: "", taskTitle: "", needBy: null, firstAsked: THU, today: TUE, expected: null, link: null, listUrl: "https://x/waiting/tok", more: 0, overdue: 6, sender: "Derek" });
    expect(e.subject).toBe("6 things we need from you are overdue");
    expect(e.body).toContain("6 things we need from you are overdue.");
    expect(e.body).toContain('href="https://x/waiting/tok"');
  });
  it("says how long ago", () => {
    expect(agoWords(THU, THU)).toBe("today");
    expect(agoWords(THU, FRI)).toBe("1 day ago");
    expect(agoWords(THU, MON)).toBe("4 days ago");
  });
});

describe("ids, replies and the expected date", () => {
  it("reads a reminder's stage and step back from its id", () => {
    expect(parseReminderId(requestRowId("late", "s_ab_c1", "1234-5678"))).toEqual({ kind: "request", stage: "late", stepId: "s_ab_c1" });
    expect(parseReminderId(requestRowId("summary", null, "1234"))).toEqual({ kind: "request", stage: "summary", stepId: null });
    expect(parseReminderId("smr_step_s_x9_abcd-ef")).toEqual({ kind: "step", stage: "reminder", stepId: "s_x9" });
    expect(parseReminderId("smr_portal_abc").kind).toBe("portal");
  });
  it("finds the step an emailed reply answers from the thread", () => {
    const rows = [
      { id: requestRowId("asked", "s_old", "u1"), sent_message_id: "m1", task_id: "t1", scheduled_at: "2026-10-15T15:00:00Z" },
      { id: requestRowId("reminder", "s_new", "u2"), sent_message_id: "m2", task_id: "t2", scheduled_at: "2026-10-20T15:00:00Z" },
      { id: "smr_portal_x", sent_message_id: "m3", task_id: null },
    ];
    expect(requestStepForThread(rows, ["m1", "m9"])).toEqual({ stepId: "s_old", taskId: "t1" });
    expect(requestStepForThread(rows, ["m1", "m2"])).toEqual({ stepId: "s_new", taskId: "t2" });
    expect(requestStepForThread(rows, ["m3"])).toBeNull();
  });
  it("a reply finishes that one step and puts a check it step after it, holding their email", () => {
    const subtasks: Subtask[] = [
      { id: "a", title: "Wait for Brian's flyer approval", done: false, finishWhen: "reply", stage: "waiting", startedAt: "x" },
      { id: "b", title: "Wait for Brian's logo", done: false, finishWhen: "reply", stage: "waiting", startedAt: "x" },
      { id: "c", title: "Print it", done: false },
    ];
    const email = { messageId: "msg_1", from: "Brian", subject: "Re: flyer", body: "Looks good", at: "2026-10-20T18:00:00Z", fileKey: "k1" };
    const out = finishRequestStep(subtasks, "a", { first: "Brian", email, now: "2026-10-20T18:00:00Z", today: TUE, makeId: () => "n1" })!;
    expect(out.map((s) => s.id)).toEqual(["a", "n1", "b", "c"]);
    expect(out[0]).toMatchObject({ done: true, outcome: "Brian replied", doneBy: "client" });
    expect(out[1]).toMatchObject({ title: "Brian replied: check it", done: false, due: TUE, addedFor: "checkit:a", fromEmails: [email] });
    // The other wait on Brian stays open.
    expect(out[2].done).toBe(false);
    expect(openCheckIt(out)).toBe(true);
    expect(finishRequestStep(subtasks, "c", { first: "Brian", email, now: "x", today: TUE, makeId: () => "n2" })).toBeNull();
    // Ticking check it counts as their answer for the next ask.
    const ticked = out.map((s) => (s.id === "n1" ? { ...s, done: true, doneAt: "2026-10-20T19:00:00Z" } : s));
    expect(openCheckIt(ticked)).toBe(false);
    expect(lastAnswerAt(ticked)).toBe("2026-10-20T19:00:00Z");
  });
  it("moves the task's expected date by the business days late, keeping pace and never piling up", () => {
    expect(expectedMove({ taskDue: "2026-10-24", expectedFrom: null, needBy: FRI, today: TUE })).toEqual({ due: "2026-10-27", from: "2026-10-24", late: 2 });
    // The next day, counted from the first date, not the moved one.
    expect(expectedMove({ taskDue: "2026-10-27", expectedFrom: "2026-10-24", needBy: FRI, today: WED })).toEqual({ due: "2026-10-28", from: "2026-10-24", late: 3 });
    // Already there, or moved further by hand: nothing.
    expect(expectedMove({ taskDue: "2026-10-28", expectedFrom: "2026-10-24", needBy: FRI, today: WED })).toBeNull();
    expect(expectedMove({ taskDue: null, expectedFrom: null, needBy: FRI, today: WED })).toBeNull();
    expect(expectedMove({ taskDue: "2026-10-24", expectedFrom: null, needBy: WED, today: WED })).toBeNull();
    expect(expectedMoveComment("2026-10-27", "Brian", "Approve the flyer", 3)).toBe('Expected date moved to Oct 27: Brian\'s "Approve the flyer" is 3 days late');
  });
});
