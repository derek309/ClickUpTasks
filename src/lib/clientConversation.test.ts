import { describe, expect, it } from "vitest";
import { automaticKind, collectClientDrafts, dayLabel, emailBeingAnswered, feedRows, firstWords, newestLine, taskChoices, whereNewMessageGoes } from "./clientConversation";
import type { EmailDraft, Message, Task } from "./data";

const msg = (p: Partial<Message> & Pick<Message, "id" | "at" | "direction" | "channel">): Message => ({
  contactId: "ct_1", clientId: "cl_1", taskId: null, subject: null, body: "", ghlMessageId: null, createdBy: null, read: true, attachments: [], cc: [], bcc: [], ...p,
});
const task = (p: Partial<Task> & Pick<Task, "id" | "title">): Task => ({
  projectId: "p_1", clientId: "cl_1", description: "", status: "todo", priority: "normal", assigneeId: null, contactId: "ct_1", due: null,
  recurrence: "none", labelIds: [], ghlTaskId: null, subtasks: [], attachments: [], comments: [], createdAt: "2026-10-01T00:00:00Z", ...p,
} as unknown as Task);
const draft = (p: Partial<EmailDraft> = {}): EmailDraft => ({ subject: "Ads", body: "<p>Hi Pamela, the ads are updated.</p>", createdAt: "2026-10-13T10:00:00Z", ...p });

describe("firstWords", () => {
  it("keeps a short line whole", () => {
    expect(firstWords("Got it, thanks!")).toBe("Got it, thanks!");
  });
  it("cuts a long line at a word with an ellipsis", () => {
    expect(firstWords("Use this one for California 14 organizations and 68 plans across the state", 40)).toBe("Use this one for California 14…");
  });
});

describe("newestLine", () => {
  const opts = { first: "Pamela", meId: "u_derek", nameOf: (id: string) => (id === "u_justin" ? "Justin Smith" : null), ago: () => "2h ago" };
  it("says what they wrote last, in their first name", () => {
    const line = newestLine([
      msg({ id: "a", at: "2026-10-12T10:00:00Z", direction: "outbound", channel: "email", body: "<p>Which disclaimer?</p>", createdBy: "u_derek" }),
      msg({ id: "b", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", body: "<p>Use this one for California.</p>", read: false }),
    ], opts);
    expect(line).toEqual({ text: 'Pamela, 2h ago: "Use this one for California."', theirs: true, unread: true, at: "2026-10-13T10:00:00Z" });
  });
  it("says You when you wrote last, and a teammate's first name when they did", () => {
    expect(newestLine([msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "outbound", channel: "sms", body: "Got it", createdBy: "u_derek" })], opts)?.text).toBe('You, 2h ago: "Got it"');
    expect(newestLine([msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "outbound", channel: "chat", body: "On it", createdBy: "u_justin" })], opts)?.text).toBe('Justin, 2h ago: "On it"');
  });
  it("leaves out calls and other inboxes, and is null with nothing said", () => {
    expect(newestLine([msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "call", body: "Missed call" })], opts)).toBeNull();
  });
});

describe("collectClientDrafts", () => {
  const notSent = () => false;
  it("gathers task emails, step texts, Claude's queue and the client's own email, oldest first", () => {
    const tasks = [
      task({ id: "t_1", title: "Reply to Pamela", draftEmail: draft({ updatedAt: "2026-10-13T12:00:00Z" }) }),
      task({ id: "t_2", title: "Testimonials", subtasks: [{ id: "s_1", title: "Text Pamela", done: false, startedAt: "2026-10-13T09:00:00Z", draftMessage: { channel: "sms", body: "Just a nudge" } }] as Task["subtasks"] }),
      task({ id: "t_3", title: "Done one", status: "done", draftEmail: draft() }),
    ];
    const out = collectClientDrafts({
      tasks, messages: [], sentAlready: notSent,
      queued: [{ id: "q_1", kind: "text", body: "From Claude", createdAt: "2026-10-13T08:00:00Z", by: "Claude" }],
      clientDraft: { clientId: "cl_1", draft: draft({ subject: "Quick check", createdAt: "2026-10-13T13:00:00Z" }) },
    });
    expect(out.map((d) => [d.id, d.kind, d.source])).toEqual([
      ["queued:q_1", "sms", "queued"],
      ["step:t_2:s_1", "sms", "step"],
      ["task:t_1", "email", "task"],
      ["client:cl_1", "email", "client"],
    ]);
    expect(out[2].text).toBe("Hi Pamela, the ads are updated.");
  });
  it("leaves off a task email that already went, a done step and an empty client email", () => {
    const tasks = [
      task({ id: "t_1", title: "Sent", draftEmail: draft() }),
      task({ id: "t_2", title: "Steps", subtasks: [{ id: "s_1", title: "Text", done: true, draftMessage: { channel: "sms", body: "old" } }] as Task["subtasks"] }),
    ];
    const out = collectClientDrafts({ tasks, messages: [], queued: [], sentAlready: (d) => d.subject === "Ads", clientDraft: { clientId: "cl_1", draft: draft({ subject: " ", body: "<p></p>" }) } });
    expect(out).toEqual([]);
  });
});

describe("whereNewMessageGoes", () => {
  const tasks = [
    task({ id: "t_ads", title: "Confirm the Medicare disclaimer" }),
    task({ id: "t_convo", title: "Reply to Pamela", priority: "conversation" }),
    task({ id: "t_meet", title: "Meeting with Pamela", priority: "conversation" }),
  ];
  it("goes on the task their newest message is on", () => {
    const messages = [msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", taskId: "t_ads" })];
    expect(whereNewMessageGoes({ channel: "email", tasks, messages, contactId: "ct_1", first: "Pamela" })).toEqual({ taskId: "t_ads", taskTitle: "Confirm the Medicare disclaimer", says: 'Goes on "Confirm the Medicare disclaimer", the task it answers' });
  });
  it("else on their open Conversation task, never a meeting's", () => {
    const messages = [msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "sms", taskId: null })];
    expect(whereNewMessageGoes({ channel: "sms", tasks, messages, contactId: "ct_1", first: "Pamela" }).taskId).toBe("t_convo");
    expect(whereNewMessageGoes({ channel: "sms", tasks: tasks.filter((t) => t.id !== "t_convo"), messages, contactId: "ct_1", first: "Pamela" }).taskId).toBeNull();
  });
  it("skips a task that is done", () => {
    const messages = [msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", taskId: "t_done" })];
    const out = whereNewMessageGoes({ channel: "email", tasks: [task({ id: "t_done", title: "Old", status: "done" })], messages, contactId: "ct_1", first: "Pamela" });
    expect(out).toEqual({ taskId: null, taskTitle: null, says: "Goes on Pamela's conversation, on no task" });
  });
  it("says a portal chat needs a task", () => {
    expect(whereNewMessageGoes({ channel: "chat", tasks: [], messages: [], contactId: "ct_1", first: "Pamela" }).says).toMatch(/needs a task/);
  });
});

describe("emailBeingAnswered", () => {
  it("answers their newest email when it is newer than ours", () => {
    const messages = [
      msg({ id: "o", at: "2026-10-12T10:00:00Z", direction: "outbound", channel: "email", subject: "Disclaimer" }),
      msg({ id: "i", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", subject: "Re: Disclaimer" }),
    ];
    expect(emailBeingAnswered(messages)).toEqual({ id: "i", subject: "Re: Disclaimer", taskId: null });
  });
  it("is null once we wrote after them", () => {
    const messages = [
      msg({ id: "i", at: "2026-10-12T10:00:00Z", direction: "inbound", channel: "email", subject: "Hi" }),
      msg({ id: "o", at: "2026-10-13T10:00:00Z", direction: "outbound", channel: "email", subject: "Re: Hi" }),
    ];
    expect(emailBeingAnswered(messages)).toBeNull();
  });
});

// The real texts on Amanda Standley's conversation (2026-10-13) and the other
// GoHighLevel workflows seen across clients.
const ghl = (body: string, p: Partial<Message> = {}) => msg({ id: "g", at: "2026-10-13T20:20:05Z", direction: "outbound", channel: "sms", body, ...p });
describe("automaticKind", () => {
  it("names the workflows' texts and emails", () => {
    expect(automaticKind(ghl("[Reminder] Our appointment is starting shortly at 1:30 PM (PDT), you can find the meeting details in the calendar Appointment. Talk shortly, Derek; ClickUpLocal"))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hi Amanda,\n\nThis is a friendly reminder that your appointment with us starts in 10 minutes!", { channel: "email", subject: "Reminder: Upcoming Appointment on Tuesday, October 13, 2026 1:30 PM (PDT)" }))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hi Amanda Standley, Your appointment has been rescheduled to Tuesday, October 13, 2026 1:30 PM (PDT). - Derek Fox; ClickUpLocal"))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hi Amanda Standley, Our appointment is confirmed for Tuesday, October 13, 2026 1:00 PM (PDT), I've also sent a calendar invite."))).toBe("appointment reminder");
    expect(automaticKind(ghl("📅 Our meeting is starting right now! Check your email for the details!"))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hey Amanda, it's ClickUpLocal! We're glad to inform you that we have confirmed your payment of $850.00. Thank you!"))).toBe("payment receipt");
    expect(automaticKind(ghl("Hey Brian, We're glad to inform that we have received payment of $900.00"))).toBe("payment receipt");
    expect(automaticKind(ghl("Hi Amanda Subscription payment of $850.00 for invoice ClickUpLocal: All-in-One Business Suite is due on October 13, 2026"))).toBe("invoice notice");
    expect(automaticKind(ghl("<p>AUTO PAYMENT INFORMATION</p>", { channel: "email", subject: "[ClickUpLocal] Invoice auto payment information" }))).toBe("invoice notice");
    expect(automaticKind(ghl("Location Logo\n\nTHANK YOU FOR YOUR RECENT PURCHASE\n\nDear Amanda,", { channel: "email", subject: "[ClickUpLocal] Thank you for your recent purchase" }))).toBe("purchase thank you");
    expect(automaticKind(ghl("Thanks for choosing us! Would you leave us a review? https://g.page/r/abc"))).toBe("review request");
    expect(automaticKind(ghl("Summary of the call", { channel: "email", subject: "AI Call Recap: Amanda Standley" }))).toBe("automatic message");
  });
  it("calls the calendar's Accepted reply automatic", () => {
    expect(automaticKind(msg({ id: "a", at: "2026-10-13T18:55:56Z", direction: "inbound", channel: "email", subject: "Accepted: 📹 Amanda Standley & Derek Fox; ClickUpLocal @ Tue Oct 13, 2026 1:30pm", body: "Loomis Basin Chamber of Commerce has accepted this invitation." }))).toBe("calendar reply");
  });
  it("leaves what a person wrote alone, from GoHighLevel's app or ours", () => {
    expect(automaticKind(ghl("I have lunch from 12-1"))).toBeNull();
    expect(automaticKind(ghl("Or I can talk now if you want to do that."))).toBeNull();
    expect(automaticKind(ghl("Our meeting is starting! Let me know", { createdBy: "u_derek" }))).toBeNull();
    expect(automaticKind(ghl("Please review: Newsletter", { channel: "email", subject: "Please review: Newsletter", createdBy: "u_derek" }))).toBeNull();
    expect(automaticKind(msg({ id: "a", at: "2026-10-13T17:13:28Z", direction: "inbound", channel: "sms", body: "Morning! I had thought we scheduled a zoom for today" }))).toBeNull();
  });
  it("calls a message the data marks as bulk automatic", () => {
    expect(automaticKind(ghl("Big news this week", { channel: "email", bulk: true }))).toBe("automatic message");
  });
  it("keeps the calendar's reply out of the email being answered", () => {
    const messages = [
      msg({ id: "i", at: "2026-10-09T15:32:12Z", direction: "inbound", channel: "email", subject: "Re: Calendar", taskId: "t_cal" }),
      msg({ id: "acc", at: "2026-10-13T18:55:56Z", direction: "inbound", channel: "email", subject: "Accepted: Zoom" }),
    ];
    expect(emailBeingAnswered(messages)).toEqual({ id: "i", subject: "Re: Calendar", taskId: "t_cal" });
  });
});

describe("dayLabel", () => {
  const now = new Date("2026-10-14T19:00:00Z");
  it("says Today, Yesterday, then the weekday and date, in Pacific time", () => {
    expect(dayLabel("2026-10-14T16:00:00Z", now)).toBe("Today");
    expect(dayLabel("2026-10-14T05:00:00Z", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-13T05:00:00Z", now)).toBe("Mon, Oct 12");
  });
});

describe("feedRows", () => {
  const now = new Date("2026-10-14T19:00:00Z");
  const ms = [
    msg({ id: "a", at: "2026-10-13T17:13:28Z", direction: "inbound", channel: "sms", body: "Do you have time today?", taskId: "t_cal" }),
    msg({ id: "b", at: "2026-10-13T17:15:21Z", direction: "outbound", channel: "sms", body: "At 2", taskId: "t_cal", createdBy: "u_derek" }),
    msg({ id: "r", at: "2026-10-13T20:20:05Z", direction: "outbound", channel: "sms", body: "[Reminder] Our appointment is starting shortly", taskId: "t_cal" }),
    msg({ id: "c", at: "2026-10-14T18:06:26Z", direction: "outbound", channel: "sms", body: "Joining?", createdBy: "u_derek" }),
    msg({ id: "d", at: "2026-10-14T18:30:00Z", direction: "inbound", channel: "sms", body: "Yes" }),
    msg({ id: "call", at: "2026-10-14T18:31:00Z", direction: "inbound", channel: "call", body: "Call" }),
  ];
  const shape = (rows: ReturnType<typeof feedRows>) => rows.map((r) => r.kind === "day" ? `day ${r.label}` : r.kind === "task" ? `on ${r.taskId}` : r.kind === "auto" ? `auto ${r.label}` : r.kind === "new" ? "new" : r.m.id);
  it("puts a divider between days, the task once when it changes and folds the automatic ones", () => {
    expect(shape(feedRows(ms, { showAutomatic: false, seenAt: null, now }))).toEqual([
      "day Yesterday", "on t_cal", "a", "b", "auto appointment reminder", "day Today", "on null", "c", "d",
    ]);
  });
  it("shows the automatic ones whole when asked", () => {
    expect(shape(feedRows(ms, { showAutomatic: true, seenAt: null, now }))).toContain("r");
  });
  it("marks the first message from them since you last looked", () => {
    expect(shape(feedRows(ms, { showAutomatic: false, seenAt: "2026-10-14T00:00:00Z", now }))).toEqual([
      "day Yesterday", "on t_cal", "a", "b", "auto appointment reminder", "day Today", "on null", "c", "new", "d",
    ]);
    expect(shape(feedRows(ms, { showAutomatic: false, seenAt: "2026-10-14T19:00:00Z", now }))).not.toContain("new");
  });
});

describe("taskChoices", () => {
  it("lists the open tasks, the one talked on most lately first", () => {
    const tasks = [
      task({ id: "t_old", title: "Old", createdAt: "2026-09-01T00:00:00Z" }),
      task({ id: "t_new", title: "New", createdAt: "2026-10-10T00:00:00Z" }),
      task({ id: "t_talk", title: "Talked", createdAt: "2026-08-01T00:00:00Z" }),
      task({ id: "t_done", title: "Done", status: "done", createdAt: "2026-10-13T00:00:00Z" }),
    ];
    const messages = [{ taskId: "t_talk", at: "2026-10-13T10:00:00Z" }];
    expect(taskChoices(tasks, messages).map((t) => t.id)).toEqual(["t_talk", "t_new", "t_old"]);
  });
});
